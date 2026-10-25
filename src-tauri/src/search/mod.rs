///////////////////////////////////////////////////////////////////////////////
// Copyright (C) 2026 Jean-Philippe Steinmetz
// SPDX-License-Identifier: MPL-2.0
///////////////////////////////////////////////////////////////////////////////
//! Native Tier 2 local full-text search index - one in-memory `rusqlite` connection per account,
//! kept open ("warm") across commands for as long as this app process runs (mirrors
//! `localIndexRpcClient.ts`'s own per-mailbox Worker connection map, scoped per-account here - see
//! `search/schema.rs`'s doc comment for that granularity decision).
//!
//! **Encryption at rest, without SQLCipher/OpenSSL**: JP's standing preference is libsodium over
//! OpenSSL in every project, and SQLCipher's open-source build has no non-OpenSSL provider that
//! fits (see `Cargo.toml`'s comment on the `rusqlite` dependency for the full reasoning). Instead:
//! the live connection is *always* `Connection::open_in_memory()` - its pages never touch disk in
//! any form, encrypted or not - and persistence is our own job, one level up: `persist()` below
//! serializes the whole in-memory database to a single byte blob (`Connection::serialize()`) and
//! encrypts that ONE blob with libsodium's XChaCha20-Poly1305 (a fresh random 24-byte nonce per
//! write, stored alongside the ciphertext - never reused, so there is no counter/state to persist
//! or get wrong) before writing it to disk; `open_or_rebuild()` reverses that on startup. This
//! trades SQLCipher's per-page cipher (durable after every single write) for whole-blob writes -
//! see `persist()`'s own doc comment for when those happen and the tradeoff that implies.
//!
//! **Not verified against a real build** (see `.claude/NOTES.md`) - in particular: that binding
//! stringified integers for a `has_attachments INTEGER` comparison and for `LIMIT`/`OFFSET` relies
//! correctly on SQLite's documented type-affinity coercion rules (a bound parameter has no affinity
//! of its own; comparing/using it against a column or clause with INTEGER/NUMERIC affinity is
//! documented to coerce it).

pub mod commands;
pub mod key;
pub mod schema;

use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use libsodium_rs::crypto_aead::xchacha20poly1305::{self, Key, Nonce};
use rusqlite::Connection;
use serde::Serialize;
use tauri::{AppHandle, Manager};

use crate::error::{AppError, AppResult};
use schema::{
    build_match_expression, build_search_predicates, LocalIndexEntity, LocalSearchPredicateFields, BM25_WEIGHTS_SQL, CREATE_SCHEMA_SQL,
    MOVE_ENTITY_SQL, SCHEMA_VERSION, UPSERT_ENTITY_SQL,
};

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct IndexEntitiesResult {
    pub indexed: i64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Coverage {
    pub entity_count: i64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalSearchHit {
    pub entity_uid: String,
    pub rank: f64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalSearchPage {
    pub hits: Vec<LocalSearchHit>,
}

/// One account's live, in-memory connection plus what `persist()` needs to flush it back to disk.
struct OpenIndex {
    conn: Connection,
    key: [u8; key::LOCAL_INDEX_KEY_LEN],
    path: PathBuf,
}

/// Every open per-account index this app process currently holds - managed Tauri state
/// (`app.manage(LocalIndexManager::default())` in `lib.rs`).
#[derive(Default)]
pub struct LocalIndexManager(Mutex<HashMap<String, OpenIndex>>);

fn search_dir(app: &AppHandle) -> AppResult<PathBuf> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|err| AppError::Other(format!("could not resolve the app data directory: {err}")))?
        .join("search");
    fs::create_dir_all(&dir)?;
    Ok(dir)
}

/// The index file name for `account_id`. The id arrives over IPC from the webview, so anything but
/// `[A-Za-z0-9_-]` (an account id is a UUID) is refused before it reaches a path: `../` segments or
/// an absolute path would otherwise let a caller write and delete `.rmxidx` files outside the
/// search directory.
fn index_file_name(account_id: &str) -> AppResult<String> {
    if account_id.is_empty() || !account_id.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_') {
        return Err(AppError::Other("invalid account id".to_string()));
    }
    // `.rmxidx` (not `.sqlite3`) - deliberately not a valid SQLite file at all, just this app's own
    // opaque `nonce || ciphertext` container (see `persist()`), so nothing (an OS file-type
    // handler, a stray `sqlite3` CLI invocation) ever mistakes it for an openable database.
    Ok(format!("{account_id}.rmxidx"))
}

fn db_path(app: &AppHandle, account_id: &str) -> AppResult<PathBuf> {
    let file_name = index_file_name(account_id)?;
    Ok(search_dir(app)?.join(file_name))
}

fn to_sodium_key(key: &[u8; key::LOCAL_INDEX_KEY_LEN]) -> AppResult<Key> {
    Key::from_bytes(key).map_err(|err| AppError::Other(format!("invalid local index key: {err}")))
}

/// Encrypts `plaintext` (a full `Connection::serialize()` snapshot) with a fresh random nonce and
/// returns `nonce || ciphertext`, ready to write to disk as-is - the nonce travels with its blob so
/// decryption never needs any external state to reconstruct it. A new random nonce every call is
/// sufficient (never reused, never derived from a counter) because XChaCha20-Poly1305's 192-bit
/// nonce is large enough that random generation alone already makes a collision astronomically
/// unlikely, unlike the 96-bit nonce AES-GCM (and the browser's own per-page VFS) has to worry
/// about more carefully.
fn encrypt_blob(key: &Key, plaintext: &[u8]) -> AppResult<Vec<u8>> {
    let nonce = Nonce::generate();
    let ciphertext = xchacha20poly1305::encrypt(plaintext, None, &nonce, key).map_err(|err| AppError::Other(format!("encrypting the local index failed: {err}")))?;
    let mut blob = Vec::with_capacity(nonce.as_bytes().len() + ciphertext.len());
    blob.extend_from_slice(nonce.as_bytes());
    blob.extend_from_slice(&ciphertext);
    Ok(blob)
}

/// Reverses `encrypt_blob()`. A wrong key and a corrupted/foreign file are indistinguishable here
/// (both just fail the Poly1305 tag check) - callers treat any failure as "discard and rebuild",
/// the same posture the old SQLCipher design already documented.
fn decrypt_blob(key: &Key, blob: &[u8]) -> AppResult<Vec<u8>> {
    if blob.len() < xchacha20poly1305::NPUBBYTES {
        return Err(AppError::Other("local index file is too short to contain a nonce".to_string()));
    }
    let (nonce_bytes, ciphertext) = blob.split_at(xchacha20poly1305::NPUBBYTES);
    let nonce_bytes: [u8; xchacha20poly1305::NPUBBYTES] = nonce_bytes
        .try_into()
        .map_err(|_| AppError::Other("invalid nonce length in local index file".to_string()))?;
    let nonce = Nonce::from_bytes(nonce_bytes);
    xchacha20poly1305::decrypt(ciphertext, None, &nonce, key).map_err(|err| AppError::Other(format!("decrypting the local index failed: {err}")))
}

/// Deserializes `plaintext` (a prior `Connection::serialize()` snapshot) into a fresh in-memory
/// connection - `rusqlite`'s `deserialize()` requires SQLite-allocated memory (via `sqlite3_malloc64`,
/// released through the same allocator on drop), which our own `Vec<u8>` plaintext isn't, so this
/// goes through `deserialize_read_exact()` instead: it allocates the SQLite-owned buffer itself and
/// fills it by reading from any `std::io::Read`, which a `Cursor` over our plaintext satisfies
/// safely with no unsafe code on this side at all.
fn try_load(plaintext: &[u8]) -> AppResult<Connection> {
    let mut conn = Connection::open_in_memory()?;
    conn.deserialize_read_exact("main", std::io::Cursor::new(plaintext), plaintext.len(), false)?;
    Ok(conn)
}

/// How many uids one `indexed_versions_in` statement binds. SQLite refuses a statement with more
/// than `SQLITE_MAX_VARIABLE_NUMBER` (32766 in the bundled build) parameters, and a zero-access
/// sync's live tail can hold more pending uids than that.
const INDEXED_VERSIONS_CHUNK: usize = 500;

/// `entity_version` for whichever of `entity_uids` are indexed, leaving out rows without one - a
/// batched query per `INDEXED_VERSIONS_CHUNK` uids, the same as `localIndexWorker.ts`'s `indexedVersions`.
fn indexed_versions_in(conn: &Connection, entity_uids: &[String]) -> AppResult<HashMap<String, String>> {
    let mut versions = HashMap::new();
    for chunk in entity_uids.chunks(INDEXED_VERSIONS_CHUNK) {
        let placeholders = vec!["?"; chunk.len()].join(", ");
        let mut stmt = conn.prepare(&format!("SELECT entity_uid, entity_version FROM entities WHERE entity_uid IN ({placeholders}) AND entity_version IS NOT NULL"))?;
        let rows = stmt.query_map(rusqlite::params_from_iter(chunk), |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?)))?;
        for row in rows {
            let (uid, version) = row?;
            versions.insert(uid, version);
        }
    }
    Ok(versions)
}

/// Loads `path` (if present and decryptable) into a fresh in-memory connection, or starts an empty
/// one otherwise - a missing file, a wrong/rotated key, or corruption are all handled the same way
/// (start fresh), matching the discard-and-rebuild posture `schema.rs`'s own doc comment describes.
/// Always ends with the current schema applied, whichever path was taken.
fn open_or_rebuild(path: &Path, key: &[u8; key::LOCAL_INDEX_KEY_LEN]) -> AppResult<Connection> {
    let sodium_key = to_sodium_key(key)?;

    let loaded = fs::read(path).ok().and_then(|blob| decrypt_blob(&sodium_key, &blob).ok());

    let conn = match loaded.and_then(|plaintext| try_load(&plaintext).ok()) {
        Some(conn)
            if conn
                .query_row("SELECT value FROM meta WHERE key = 'schema_version'", [], |row| row.get::<_, String>(0))
                .ok()
                .and_then(|value: String| value.parse::<i64>().ok())
                == Some(SCHEMA_VERSION) =>
        {
            conn
        }
        // Either nothing on disk yet, a wrong/rotated key, a corrupted blob, an invalid serialized
        // database, or a stale schema version - all get the same treatment: start over.
        _ => Connection::open_in_memory()?,
    };

    conn.execute_batch(CREATE_SCHEMA_SQL)?;
    conn.execute(
        "INSERT INTO meta(key, value) VALUES ('schema_version', ?1) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        [SCHEMA_VERSION.to_string()],
    )?;

    Ok(conn)
}

/// Serializes `conn`'s entire in-memory database and writes it to `path` as one encrypted blob,
/// atomically (write to a sibling temp file, then rename over the real path - a crash mid-write
/// leaves the previous, still-valid file in place rather than a torn one).
///
/// **Called after every mutating call** (`index_entities()`, `remove_entity()`) rather than on a
/// debounced timer - the simplest correct option, and adequate for this session's scope, but a
/// real cost for a very large configured byte budget (multi-GB accounts re-serializing/
/// re-encrypting their whole index on every batch). A batched/debounced flush is the natural
/// upgrade if that turns out to matter in practice; not built here to keep this pass's scope to
/// "correct and simple," matching this session's own stated preference for not over-engineering
/// ahead of a real, observed need.
fn persist(conn: &Connection, path: &Path, key: &[u8; key::LOCAL_INDEX_KEY_LEN]) -> AppResult<()> {
    let sodium_key = to_sodium_key(key)?;
    let plaintext = conn.serialize("main")?;
    let blob = encrypt_blob(&sodium_key, &plaintext)?;
    let tmp_path = path.with_extension("rmxidx.tmp");
    fs::write(&tmp_path, &blob)?;
    fs::rename(&tmp_path, path)?;
    Ok(())
}

impl LocalIndexManager {
    fn with_connection<T>(&self, account_id: &str, f: impl FnOnce(&mut Connection) -> AppResult<T>) -> AppResult<T> {
        let mut guard = self.0.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
        let entry = guard
            .get_mut(account_id)
            .ok_or_else(|| AppError::Other(format!("local search index for account {account_id} is not initialized - call init first")))?;
        f(&mut entry.conn)
    }

    /// Same as `with_connection()`, but flushes the whole (now-modified) database to disk via
    /// `persist()` immediately afterward - see that function's own doc comment for the tradeoff.
    /// Used by every mutating operation; read-only operations (`search`, `get_coverage`) use
    /// `with_connection()` instead, since there is nothing new to persist.
    fn with_connection_persisted<T>(&self, account_id: &str, f: impl FnOnce(&mut Connection) -> AppResult<T>) -> AppResult<T> {
        let mut guard = self.0.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
        let entry = guard
            .get_mut(account_id)
            .ok_or_else(|| AppError::Other(format!("local search index for account {account_id} is not initialized - call init first")))?;
        let result = f(&mut entry.conn)?;
        persist(&entry.conn, &entry.path, &entry.key)?;
        Ok(result)
    }

    /// A no-op if this account's index is already open this session - mirrors `initLocalIndex()`'s
    /// idempotence in `localIndexRpcClient.ts`.
    pub fn init(&self, app: &AppHandle, account_id: &str, master_key: &[u8]) -> AppResult<()> {
        let mut guard = self.0.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
        if guard.contains_key(account_id) {
            return Ok(());
        }
        let key = key::derive_local_index_key(master_key, account_id)?;
        let path = db_path(app, account_id)?;
        let conn = open_or_rebuild(&path, &key)?;
        guard.insert(account_id.to_string(), OpenIndex { conn, key, path });
        Ok(())
    }

    /// Upserts every entity (see `UPSERT_ENTITY_SQL`'s own doc comment for why this is an upsert,
    /// not a delete-then-insert) inside one transaction - mirrors `indexLocalEntities()`.
    pub fn index_entities(&self, account_id: &str, entities: &[LocalIndexEntity]) -> AppResult<IndexEntitiesResult> {
        self.with_connection_persisted(account_id, |conn| {
            let tx = conn.transaction()?;
            let mut indexed: i64 = 0;
            {
                let mut stmt = tx.prepare(UPSERT_ENTITY_SQL)?;
                for entity in entities {
                    stmt.execute(rusqlite::params![
                        entity.entity_type,
                        entity.entity_uid,
                        entity.mailbox_uid,
                        entity.folder_uid,
                        entity.date_for_sort,
                        entity.participants,
                        entity.flags,
                        i64::from(entity.has_attachments),
                        entity.subject,
                        entity.body,
                        entity.attachment_text,
                        entity.byte_size,
                        entity.entity_version,
                    ])?;
                    indexed += 1;
                }
            }
            tx.commit()?;
            Ok(IndexEntitiesResult { indexed })
        })
    }

    /// Drops one message from the index (a delete) - mirrors `removeLocalEntity()`. A no-op (not an
    /// error) if `entity_uid` isn't present.
    pub fn remove_entity(&self, account_id: &str, entity_uid: &str) -> AppResult<()> {
        self.with_connection_persisted(account_id, |conn| {
            conn.execute("DELETE FROM entities WHERE entity_uid = ?1", [entity_uid])?;
            Ok(())
        })
    }

    /// Re-points an indexed message at a new folder in place (an archive, a move) - mirrors
    /// `moveLocalEntity()`, setting its flags too when `flags` (`,a,b,`) is given. A no-op if
    /// `entity_uid` isn't present.
    pub fn move_entity(&self, account_id: &str, entity_uid: &str, folder_uid: &str, entity_version: Option<&str>, flags: Option<&str>) -> AppResult<()> {
        self.with_connection_persisted(account_id, |conn| {
            conn.execute(MOVE_ENTITY_SQL, rusqlite::params![folder_uid, entity_version, entity_uid, flags])?;
            Ok(())
        })
    }

    /// `entity_version` for whichever of `entity_uids` are already indexed - mirrors
    /// `getIndexedVersions()`, so a rebuild skips re-fetching and decrypting unchanged messages.
    pub fn indexed_versions(&self, account_id: &str, entity_uids: &[String]) -> AppResult<HashMap<String, String>> {
        self.with_connection(account_id, |conn| indexed_versions_in(conn, entity_uids))
    }

    /// Mirrors `searchLocal()`: combines `build_search_predicates()`'s structured `WHERE` clause
    /// with `build_match_expression()`'s FTS5 `MATCH` (when there's any text to match), ranked by
    /// `bm25()` when a `MATCH` is present, else by recency.
    pub fn search(&self, account_id: &str, mailbox_uid: &str, parsed: &LocalSearchPredicateFields, limit: i64, offset: i64) -> AppResult<LocalSearchPage> {
        self.with_connection(account_id, |conn| {
            let (where_clause, mut params) = build_search_predicates(parsed, mailbox_uid);
            let match_expression = build_match_expression(parsed);

            let sql = match &match_expression {
                Some(_) => format!(
                    "SELECT e.entity_uid, bm25(entities_fts, {BM25_WEIGHTS_SQL}) AS rank \
                     FROM entities e JOIN entities_fts ON entities_fts.rowid = e.rowid \
                     WHERE {where_clause} AND entities_fts MATCH ? \
                     ORDER BY rank LIMIT ? OFFSET ?"
                ),
                None => format!(
                    "SELECT e.entity_uid, 0.0 AS rank FROM entities e \
                     WHERE {where_clause} ORDER BY e.date_for_sort DESC LIMIT ? OFFSET ?"
                ),
            };
            if let Some(expression) = &match_expression {
                params.push(expression.clone());
            }
            params.push(limit.to_string());
            params.push(offset.to_string());

            let mut stmt = conn.prepare(&sql)?;
            let bind_refs: Vec<&dyn rusqlite::ToSql> = params.iter().map(|value| value as &dyn rusqlite::ToSql).collect();
            let hits = stmt
                .query_map(bind_refs.as_slice(), |row| {
                    Ok(LocalSearchHit {
                        entity_uid: row.get(0)?,
                        rank: row.get(1)?,
                    })
                })?
                .collect::<rusqlite::Result<Vec<_>>>()?;
            Ok(LocalSearchPage { hits })
        })
    }

    /// Mirrors `getLocalCoverage()` - simplified to just a row count for this mailbox (the browser
    /// version's `Coverage` shape also tracks the covered date range/build-in-progress state,
    /// which is orchestrated by `localIndexBuilder.ts` on the main thread, not the Worker/schema
    /// layer this module mirrors - out of scope until a real incremental-build pass is added here).
    pub fn get_coverage(&self, account_id: &str, mailbox_uid: &str) -> AppResult<Coverage> {
        self.with_connection(account_id, |conn| {
            let entity_count: i64 = conn.query_row("SELECT count(*) FROM entities WHERE mailbox_uid = ?1", [mailbox_uid], |row| row.get(0))?;
            Ok(Coverage { entity_count })
        })
    }

    /// Deletes one mailbox's rows from its account's open index and persists it - what web-client's
    /// per-mailbox `destroyLocalIndex()` means here, since one account file holds every mailbox of
    /// that account (deleting the whole file would wipe the account's other mailboxes too). Returns
    /// `false` when the account's index isn't open this session: the file can't be edited without
    /// its key, so the rows stay until a later call finds it open.
    pub fn destroy_mailbox(&self, account_id: &str, mailbox_uid: &str) -> AppResult<bool> {
        {
            let guard = self.0.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
            if !guard.contains_key(account_id) {
                return Ok(false);
            }
        }
        self.with_connection_persisted(account_id, |conn| {
            conn.execute("DELETE FROM entities WHERE mailbox_uid = ?1", [mailbox_uid])?;
            Ok(true)
        })
    }

    /// Closes (if open) and deletes one account's index file - mirrors `destroyLocalIndex()`.
    /// Returns `true` if the file was removed (or never existed), `false` if deletion failed (e.g.
    /// held open elsewhere) - the same "retry on next load" contract `localIndexRpcClient.ts`
    /// documents, though this crate does not yet implement the retry bookkeeping that file's own
    /// `readPendingDeletions`/`writePendingDeletions` do (a reasonable follow-up once this is
    /// actually wired to the E2E key-destruction lifecycle events it exists to serve).
    pub fn destroy(&self, app: &AppHandle, account_id: &str) -> AppResult<bool> {
        {
            let mut guard = self.0.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
            guard.remove(account_id);
        }
        let path = db_path(app, account_id)?;
        // A leftover temp file from a `persist()` interrupted mid-write (see that function's own
        // doc comment on the write-temp-then-rename sequence) - harmless either way (the rename
        // never completed, so the real `path` was never touched by it), but worth cleaning up.
        let _ = fs::remove_file(path.with_extension("rmxidx.tmp"));
        if !path.exists() {
            return Ok(true);
        }
        Ok(fs::remove_file(&path).is_ok())
    }

    /// Closes every open connection and deletes every account's index file - mirrors
    /// `destroyAllLocalIndexes()`. Used on a full sign-out of this app (all accounts), not just one.
    pub fn destroy_all(&self, app: &AppHandle) -> AppResult<bool> {
        {
            let mut guard = self.0.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
            guard.clear();
        }
        let dir = search_dir(app)?;
        let mut all_removed = true;
        if let Ok(entries) = fs::read_dir(&dir) {
            for entry in entries.flatten() {
                if fs::remove_file(entry.path()).is_err() {
                    all_removed = false;
                }
            }
        }
        Ok(all_removed)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use schema::LocalIndexEntity;

    #[test]
    fn index_file_name_refuses_an_account_id_that_could_leave_the_search_directory() {
        assert_eq!(index_file_name("7f3c2b9e-5a1d-4c8e-9b6f-0d2a1e4c7b53").unwrap(), "7f3c2b9e-5a1d-4c8e-9b6f-0d2a1e4c7b53.rmxidx");
        assert!(index_file_name("acct_1").is_ok());
        for bad in ["", "../x", "..", "C:/x", "C:\\x", "/x", "a/b", "a\\b", "a.b", "a b", "a\0b"] {
            assert!(index_file_name(bad).is_err(), "{bad:?} should be refused");
        }
    }

    fn entity(uid: &str, mailbox_uid: &str) -> LocalIndexEntity {
        LocalIndexEntity {
            entity_type: "message".to_string(),
            entity_uid: uid.to_string(),
            mailbox_uid: mailbox_uid.to_string(),
            folder_uid: Some("inbox".to_string()),
            date_for_sort: "2026-10-24T00:00:00Z".to_string(),
            participants: "a@example.com".to_string(),
            flags: String::new(),
            has_attachments: false,
            subject: Some("hello".to_string()),
            body: None,
            attachment_text: None,
            byte_size: 5,
            entity_version: None,
        }
    }

    fn count_in(manager: &LocalIndexManager, mailbox_uid: &str) -> i64 {
        manager.with_connection("acct", |conn| Ok(conn.query_row("SELECT count(*) FROM entities WHERE mailbox_uid = ?1", [mailbox_uid], |row| row.get(0))?)).unwrap()
    }

    #[test]
    fn destroy_mailbox_removes_only_that_mailboxs_rows_and_persists() {
        let dir = std::env::temp_dir().join(format!("rmx-search-test-{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(&dir).unwrap();
        let path = dir.join("acct.rmxidx");
        let key = [7u8; key::LOCAL_INDEX_KEY_LEN];
        let manager = LocalIndexManager::default();

        assert!(!manager.destroy_mailbox("acct", "mbx-own").unwrap(), "not open: nothing can be removed");

        let conn = open_or_rebuild(&path, &key).unwrap();
        manager.0.lock().unwrap().insert("acct".to_string(), OpenIndex { conn, key, path: path.clone() });
        manager.index_entities("acct", &[entity("m1", "mbx-own"), entity("m2", "mbx-delegated"), entity("m3", "mbx-delegated")]).unwrap();

        assert!(manager.destroy_mailbox("acct", "mbx-delegated").unwrap());
        assert_eq!(count_in(&manager, "mbx-delegated"), 0);
        assert_eq!(count_in(&manager, "mbx-own"), 1);

        // Persisted: the file reloads with the own mailbox's row and without the delegated ones.
        let reloaded = open_or_rebuild(&path, &key).unwrap();
        let rows: Vec<String> = reloaded
            .prepare("SELECT entity_uid FROM entities ORDER BY entity_uid")
            .unwrap()
            .query_map([], |row| row.get(0))
            .unwrap()
            .collect::<rusqlite::Result<_>>()
            .unwrap();
        assert_eq!(rows, vec!["m1".to_string()]);
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn indexed_versions_answers_for_more_uids_than_one_sqlite_statement_can_bind() {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch(CREATE_SCHEMA_SQL).unwrap();

        // More than SQLite's 32766-parameter limit, with indexed uids at both edges of a chunk.
        let uids: Vec<String> = (0..40_000).map(|i| format!("m{i}")).collect();
        let indexed = [0usize, INDEXED_VERSIONS_CHUNK - 1, INDEXED_VERSIONS_CHUNK, 39_999];
        for &i in &indexed {
            let e = entity(&uids[i], "mbx-own");
            conn.execute(
                UPSERT_ENTITY_SQL,
                rusqlite::params![
                    e.entity_type, e.entity_uid, e.mailbox_uid, e.folder_uid, e.date_for_sort, e.participants, e.flags,
                    i64::from(e.has_attachments), e.subject, e.body, e.attachment_text, e.byte_size, format!("v{i}"),
                ],
            )
            .unwrap();
        }

        let versions = indexed_versions_in(&conn, &uids).unwrap();

        assert_eq!(versions.len(), indexed.len());
        for &i in &indexed {
            assert_eq!(versions.get(&uids[i]), Some(&format!("v{i}")));
        }
    }
}
