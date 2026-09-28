///////////////////////////////////////////////////////////////////////////////
// Copyright (C) 2026 Jean-Philippe Steinmetz
// SPDX-License-Identifier: MPL-2.0
///////////////////////////////////////////////////////////////////////////////
//! The native Tier 2 local index's SQLite schema - mirrors the **shape** (not the code, which is
//! OPFS/WASM-specific with no native equivalent) of `web-client`'s
//! `apps/shared/search/localIndexSchema.ts` (`specs/search.md` §13): `entities` is the real row
//! store, `entities_fts` an FTS5 *external content* table over it kept in sync by the three
//! triggers below - the same standard SQLite external-content-FTS5 pattern that file's own doc
//! comment describes, for the same reason (one copy of the text, not two).
//!
//! **Granularity decision - one database file per ACCOUNT, not per mailbox** (the task's own
//! open question): `web-client`'s browser implementation opens one database per *mailbox*
//! (`localIndexSchema.ts`'s own doc comment: "One database per mailbox"), with `entities.mailbox_uid`
//! present mainly for classification/filtering within that single-mailbox file. Consolidated here
//! to one encrypted-at-rest file per *account* instead, using that same `mailbox_uid` column to
//! do real partitioning across however many mailboxes an account has (a shared/delegated mailbox,
//! say) - chosen because: (1) the task's own design section frames it this way ("one encrypted...
//! database per ACCOUNT"); (2) this index's whole-database encryption (see `mod.rs`'s own doc
//! comment - an in-memory connection persisted as one libsodium-encrypted blob, unlike the
//! browser's hand-rolled per-page AES-GCM VFS that only exists there because no SQLCipher WASM
//! build exists - see the task briefing) makes opening one connection per account rather than per
//! mailbox strictly cheaper, with no per-mailbox key-unlock ceremony needed beyond
//! what `key.rs` already does once per account; (3) it matches this app's own account-scoped
//! keychain/account-store granularity everywhere else (`keychain.rs`, `accounts/store.rs`) - one
//! HKDF-derived key per account, not per mailbox. Every query in this module scopes by
//! `mailbox_uid` explicitly (see `build_search_predicates`) so this consolidation is invisible to
//! a caller that only ever queries one mailbox at a time.
//!
//! **Schema versioning is independent of the web client's** - `SCHEMA_VERSION` here starts at 1;
//! there is no shared version space with `localIndexSchema.ts`'s own `SCHEMA_VERSION` to stay in
//! sync with; the two are different storage engines (a libsodium-encrypted serialized blob here
//! vs. a hand-rolled per-page encrypted VFS there) with independently evolving schemas that merely
//! happen to look similar today.

use serde::{Deserialize, Serialize};

/// Bump whenever `CREATE_SCHEMA_SQL` changes in a way an existing on-disk database can't be
/// reconciled with in place - a mismatch against `meta`'s stored `schema_version` row means the
/// whole file should be discarded and rebuilt (see `mod.rs`'s `open_or_rebuild`), the same
/// invalidation path a decryption failure (wrong/rotated master key) already has to take.
pub const SCHEMA_VERSION: i64 = 1;

/// Column order in `entities_fts` (`subject, participants, body, attachment_text`) is load-bearing:
/// `BM25_WEIGHTS_SQL` below assumes that exact positional order, matching `searchScoring.ts`'s
/// `SEARCH_FIELD_WEIGHTS` (`subject: 3, participants: 2, body: 1, attachmentText: 1`) so this
/// tier's local ranking agrees with the other tiers' re-scoring, the same rationale as
/// `localIndexSchema.ts`'s own identical comment.
pub const CREATE_SCHEMA_SQL: &str = r#"
CREATE TABLE IF NOT EXISTS meta (
    key TEXT PRIMARY KEY,
    value TEXT
);

CREATE TABLE IF NOT EXISTS entities (
    rowid INTEGER PRIMARY KEY,
    entity_type TEXT NOT NULL,
    entity_uid TEXT NOT NULL UNIQUE,
    mailbox_uid TEXT NOT NULL,
    folder_uid TEXT,
    date_for_sort TEXT NOT NULL,
    participants TEXT,
    flags TEXT,
    has_attachments INTEGER NOT NULL DEFAULT 0,
    subject TEXT,
    body TEXT,
    attachment_text TEXT,
    byte_size INTEGER NOT NULL DEFAULT 0,
    entity_version TEXT
);
CREATE INDEX IF NOT EXISTS idx_entities_date ON entities(date_for_sort);
CREATE INDEX IF NOT EXISTS idx_entities_mailbox ON entities(mailbox_uid);

CREATE VIRTUAL TABLE IF NOT EXISTS entities_fts USING fts5(
    subject, participants, body, attachment_text,
    content='entities', content_rowid='rowid', tokenize='unicode61'
);

CREATE TRIGGER IF NOT EXISTS entities_ai AFTER INSERT ON entities BEGIN
    INSERT INTO entities_fts(rowid, subject, participants, body, attachment_text)
    VALUES (new.rowid, new.subject, new.participants, new.body, new.attachment_text);
END;

CREATE TRIGGER IF NOT EXISTS entities_ad AFTER DELETE ON entities BEGIN
    INSERT INTO entities_fts(entities_fts, rowid, subject, participants, body, attachment_text)
    VALUES ('delete', old.rowid, old.subject, old.participants, old.body, old.attachment_text);
END;

CREATE TRIGGER IF NOT EXISTS entities_au AFTER UPDATE ON entities BEGIN
    INSERT INTO entities_fts(entities_fts, rowid, subject, participants, body, attachment_text)
    VALUES ('delete', old.rowid, old.subject, old.participants, old.body, old.attachment_text);
    INSERT INTO entities_fts(rowid, subject, participants, body, attachment_text)
    VALUES (new.rowid, new.subject, new.participants, new.body, new.attachment_text);
END;
"#;

/// The exact `bm25()` weight arguments every ranked query against `entities_fts` MUST pass, in
/// column order - see this module's own doc comment on why the order is load-bearing.
pub const BM25_WEIGHTS_SQL: &str = "3.0, 2.0, 1.0, 1.0";

pub const UPSERT_ENTITY_SQL: &str = "
INSERT INTO entities (entity_type, entity_uid, mailbox_uid, folder_uid, date_for_sort, participants, flags, has_attachments, subject, body, attachment_text, byte_size, entity_version)
VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13)
ON CONFLICT(entity_uid) DO UPDATE SET
    folder_uid = excluded.folder_uid, date_for_sort = excluded.date_for_sort, participants = excluded.participants,
    flags = excluded.flags, has_attachments = excluded.has_attachments, subject = excluded.subject,
    body = excluded.body, attachment_text = excluded.attachment_text, byte_size = excluded.byte_size,
    entity_version = excluded.entity_version
";

/// One message's decrypted content, ready to index - mirrors `LocalIndexEntity` in
/// `localIndexSchema.ts` field-for-field (camelCase over IPC/JSON, matching a future frontend's
/// expectations if/when `src/lib/searchBridge.ts` is added - see `search/commands.rs`'s own doc
/// comment).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalIndexEntity {
    pub entity_type: String,
    pub entity_uid: String,
    pub mailbox_uid: String,
    pub folder_uid: Option<String>,
    /// ISO 8601, UTC - compares correctly as plain text.
    pub date_for_sort: String,
    pub participants: String,
    /// Comma-delimited, leading/trailing commas included (`,read,flagged,`) - same simplest-possible
    /// substring-match encoding `localIndexSchema.ts` uses, for the same reason (no JSON1 dependency).
    pub flags: String,
    pub has_attachments: bool,
    pub subject: Option<String>,
    pub body: Option<String>,
    pub attachment_text: Option<String>,
    pub byte_size: i64,
    pub entity_version: Option<String>,
}

/// The structured (non-free-text) fields a search predicate can filter on - mirrors
/// `LocalSearchPredicateFields` in `localIndexSchema.ts`.
#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalSearchPredicateFields {
    pub from: Option<String>,
    pub to: Option<String>,
    pub cc: Option<String>,
    pub subject: Option<String>,
    pub has_attachment: Option<bool>,
    /// ISO 8601.
    pub before: Option<String>,
    /// ISO 8601.
    pub after: Option<String>,
    pub folder_uid: Option<String>,
    #[serde(default)]
    pub flags: Vec<String>,
    /// Free-text portion of the parsed query - kept alongside the structured fields (rather than a
    /// separate parameter) so one struct fully describes one search request, same as
    /// `ParsedSearchQuery`'s role on the TS side.
    #[serde(default)]
    pub text: String,
}

/// Builds the SQL `WHERE` predicate (and bind params, in order) for every structured operator this
/// index can evaluate - same known simplification as `buildSearchPredicates()` in
/// `localIndexSchema.ts`: `from`/`to`/`cc` all evaluate as a substring match against the combined
/// `participants` column (this schema keeps only that one field, not a precise per-role split).
pub fn build_search_predicates(parsed: &LocalSearchPredicateFields, mailbox_uid: &str) -> (String, Vec<String>) {
    let mut clauses = vec!["e.mailbox_uid = ?".to_string()];
    let mut params = vec![mailbox_uid.to_string()];

    if let Some(folder_uid) = &parsed.folder_uid {
        clauses.push("e.folder_uid = ?".to_string());
        params.push(folder_uid.clone());
    }
    if let Some(before) = &parsed.before {
        clauses.push("e.date_for_sort < ?".to_string());
        params.push(before.clone());
    }
    if let Some(after) = &parsed.after {
        clauses.push("e.date_for_sort > ?".to_string());
        params.push(after.clone());
    }
    if let Some(has_attachment) = parsed.has_attachment {
        clauses.push("e.has_attachments = ?".to_string());
        params.push(if has_attachment { "1".to_string() } else { "0".to_string() });
    }
    for flag in &parsed.flags {
        clauses.push("e.flags LIKE ?".to_string());
        params.push(format!("%,{flag},%"));
    }
    for participant in [&parsed.from, &parsed.to, &parsed.cc].into_iter().flatten() {
        clauses.push("e.participants LIKE ?".to_string());
        params.push(format!("%{participant}%"));
    }

    (clauses.join(" AND "), params)
}

fn escape_fts_phrase(value: &str) -> String {
    value.replace('"', "\"\"")
}

/// Builds the FTS5 `MATCH` expression for a parsed query's free-text and `subject:` portions, or
/// `None` when there's nothing to text-match on at all (a pure structured-filter query -
/// `build_search_predicates()`'s `WHERE` clause alone already narrows that case correctly).
/// Mirrors `buildMatchExpression()` in `localIndexSchema.ts`.
pub fn build_match_expression(parsed: &LocalSearchPredicateFields) -> Option<String> {
    let mut parts = Vec::new();
    if let Some(subject) = &parsed.subject {
        if !subject.is_empty() {
            parts.push(format!("subject:\"{}\"", escape_fts_phrase(subject)));
        }
    }
    if !parsed.text.trim().is_empty() {
        if parsed.subject.as_deref().is_some_and(|s| !s.is_empty()) {
            parts.push(format!("({})", parsed.text));
        } else {
            parts.push(parsed.text.clone());
        }
    }
    if parts.is_empty() {
        None
    } else {
        Some(parts.join(" AND "))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn build_search_predicates_always_scopes_by_mailbox() {
        let (where_clause, params) = build_search_predicates(&LocalSearchPredicateFields::default(), "mbx-1");
        assert_eq!(where_clause, "e.mailbox_uid = ?");
        assert_eq!(params, vec!["mbx-1".to_string()]);
    }

    #[test]
    fn build_search_predicates_adds_every_structured_filter() {
        let parsed = LocalSearchPredicateFields {
            from: Some("a@example.com".to_string()),
            to: Some("b@example.com".to_string()),
            cc: Some("c@example.com".to_string()),
            has_attachment: Some(true),
            before: Some("2026-01-01T00:00:00Z".to_string()),
            after: Some("2025-01-01T00:00:00Z".to_string()),
            folder_uid: Some("inbox".to_string()),
            flags: vec!["read".to_string(), "flagged".to_string()],
            ..Default::default()
        };
        let (where_clause, params) = build_search_predicates(&parsed, "mbx-1");
        assert!(where_clause.contains("e.folder_uid = ?"));
        assert!(where_clause.contains("e.has_attachments = ?"));
        assert_eq!(params[0], "mbx-1");
        assert!(params.contains(&"%,read,%".to_string()));
        assert!(params.contains(&"%,flagged,%".to_string()));
        assert!(params.contains(&"%a@example.com%".to_string()));
    }

    #[test]
    fn build_match_expression_is_none_for_a_pure_structured_query() {
        assert!(build_match_expression(&LocalSearchPredicateFields::default()).is_none());
    }

    #[test]
    fn build_match_expression_combines_subject_and_free_text() {
        let parsed = LocalSearchPredicateFields {
            subject: Some("hello \"world\"".to_string()),
            text: "urgent".to_string(),
            ..Default::default()
        };
        let expression = build_match_expression(&parsed).unwrap();
        assert_eq!(expression, "subject:\"hello \"\"world\"\"\" AND (urgent)");
    }

    #[test]
    fn build_match_expression_is_just_free_text_without_a_subject_filter() {
        let parsed = LocalSearchPredicateFields {
            text: "urgent".to_string(),
            ..Default::default()
        };
        assert_eq!(build_match_expression(&parsed).unwrap(), "urgent");
    }
}
