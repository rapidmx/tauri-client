///////////////////////////////////////////////////////////////////////////////
// Copyright (C) 2026 Jean-Philippe Steinmetz
// SPDX-License-Identifier: MPL-2.0
///////////////////////////////////////////////////////////////////////////////
//! Persists the account list (design doc, "Multi-server 'Add account' flow" step 5: "Persist the
//! new account (id, label, serverUrl, authServerUrl - NOT the token itself, that's keychain-only)
//! in a local app-data JSON/store file via Tauri's own app-data-dir APIs"). A single flat JSON
//! array in one file (`accounts.json`, under Tauri's resolved app-data directory) - this app's
//! account count is small (a human adding accounts by hand, not a bulk-import scenario), so there
//! is no need for anything more structured than "read the whole file, mutate, write the whole file
//! back" guarded by a process-wide mutex (see `AccountStore` below).
//!
//! Deliberately not using the `tauri-plugin-store` plugin (a reasonable alternative) - this file
//! format is simple enough, and this crate's own account list needs no key-value/JS-side access,
//! so a plain `serde_json` file plus this module's own load/save functions has one fewer
//! dependency and one fewer plugin permission to reason about.

use std::fs;
use std::path::PathBuf;
use std::sync::Mutex;

use tauri::{AppHandle, Manager};

use crate::accounts::AccountSummary;
use crate::error::{AppError, AppResult};

const ACCOUNTS_FILE_NAME: &str = "accounts.json";

/// Process-wide lock guarding every read-modify-write cycle against this file - `add`/`remove`
/// both need "read current list, check for a duplicate/find the entry, write it back" to be
/// atomic with respect to each other, which a bare `fs::read`+`fs::write` pair on its own is not
/// (two concurrent `add_account` calls could both read the same starting list and each write back
/// a list missing the other's addition). A single global `Mutex` is enough: this app has one
/// account store, and account mutation is already a rare, human-paced operation, not a hot path
/// worth finer-grained locking for.
static STORE_LOCK: Mutex<()> = Mutex::new(());

fn accounts_file_path(app: &AppHandle) -> AppResult<PathBuf> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|err| AppError::Other(format!("could not resolve the app data directory: {err}")))?;
    fs::create_dir_all(&dir)?;
    Ok(dir.join(ACCOUNTS_FILE_NAME))
}

fn read_all(app: &AppHandle) -> AppResult<Vec<AccountSummary>> {
    let path = accounts_file_path(app)?;
    if !path.exists() {
        return Ok(Vec::new());
    }
    let raw = fs::read_to_string(path)?;
    if raw.trim().is_empty() {
        return Ok(Vec::new());
    }
    Ok(serde_json::from_str(&raw)?)
}

fn write_all(app: &AppHandle, accounts: &[AccountSummary]) -> AppResult<()> {
    let path = accounts_file_path(app)?;
    let json = serde_json::to_string_pretty(accounts)?;
    // Write to a temp file then rename, so a crash/power-loss mid-write can never leave
    // accounts.json truncated or holding half-written JSON - the previous version (or nothing, on
    // first run) is always what's on disk until the rename, which POSIX/NTFS both make atomic for
    // a same-directory rename.
    let tmp_path = path.with_extension("json.tmp");
    fs::write(&tmp_path, json)?;
    fs::rename(&tmp_path, &path)?;
    Ok(())
}

/// Every account currently persisted, in no particular guaranteed order (insertion order in
/// practice, since `add()` appends - not relied upon by callers).
pub fn list(app: &AppHandle) -> AppResult<Vec<AccountSummary>> {
    let _guard = STORE_LOCK.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
    read_all(app)
}

/// Appends `account`, replacing any existing entry with the same `id` (an `add_account` retry
/// after a previous attempt's keychain write succeeded but the account-store write itself didn't,
/// say) rather than duplicating it.
pub fn add(app: &AppHandle, account: AccountSummary) -> AppResult<()> {
    let _guard = STORE_LOCK.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
    let mut accounts = read_all(app)?;
    accounts.retain(|existing| existing.id != account.id);
    accounts.push(account);
    write_all(app, &accounts)
}

/// Removes the account with id `account_id`. Not an error if no such account exists - `remove_account`
/// (the Tauri command, `commands.rs`) is idempotent from the frontend's point of view.
pub fn remove(app: &AppHandle, account_id: &str) -> AppResult<()> {
    let _guard = STORE_LOCK.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
    let mut accounts = read_all(app)?;
    accounts.retain(|existing| existing.id != account_id);
    write_all(app, &accounts)
}

/// Looks up one account by id, for callers (`oauth::refresh_session_token`, the future search
/// commands) that need its `serverUrl`/`authServerUrl` but not the whole list.
pub fn find(app: &AppHandle, account_id: &str) -> AppResult<Option<AccountSummary>> {
    let _guard = STORE_LOCK.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
    Ok(read_all(app)?.into_iter().find(|account| account.id == account_id))
}
