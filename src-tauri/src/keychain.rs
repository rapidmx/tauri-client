///////////////////////////////////////////////////////////////////////////////
// Copyright (C) 2026 Jean-Philippe Steinmetz
// SPDX-License-Identifier: MPL-2.0
///////////////////////////////////////////////////////////////////////////////
//! OS-keychain storage for OAuth refresh tokens, one entry per account (design doc step 6). Wraps
//! `tauri-plugin-secure-keystore`, whose README (see `.claude/NOTES.md`'s package-research entry)
//! advertises exactly the cross-platform coverage this needs: Android Keystore, iOS Keychain, and
//! on desktop the OS credential store (macOS Keychain Services, Windows Credential Manager, Linux
//! Secret Service).
//!
//! Confirmed against the plugin's real source this session (a full local checkout, now that a
//! toolchain is available to fetch and compile it - superseding this file's original "no local
//! checkout, guessed from the README" caveat): it exposes exactly the Rust-side extension trait
//! this module assumed, `SecureKeystoreExt::{set_item, get_item, delete_item}`, taking/returning
//! its own request/response structs (`SetItemRequest`, `ItemKey`, `GetItemResponse`) rather than
//! bare strings - so the refresh token, which step 4/5's token exchange deliberately keeps out of
//! the webview's JS context entirely (see `oauth/mod.rs`'s own doc comment), never has to
//! round-trip through JS just to be stored, exactly as hoped.

use tauri::AppHandle;
use tauri_plugin_secure_keystore::{GetItemResponse, ItemKey, SecureKeystoreExt, SetItemRequest};

use crate::error::{AppError, AppResult};

/// Keychain entry key for one account's refresh token - namespaced so this app's entries can never
/// collide with another app's use of the same OS credential store.
fn key_for(account_id: &str) -> String {
    format!("rapidmx-refresh-token:{account_id}")
}

/// Stores (or overwrites) `account_id`'s refresh token.
pub fn store_refresh_token(app: &AppHandle, account_id: &str, refresh_token: &str) -> AppResult<()> {
    app.secure_keystore()
        .set_item(SetItemRequest {
            key: key_for(account_id),
            value: refresh_token.to_string(),
        })
        .map_err(|err| AppError::Keychain(err.to_string()))
}

/// Loads `account_id`'s refresh token, or `None` if nothing is stored for it (already removed, or
/// an account record whose keychain write never completed).
pub fn load_refresh_token(app: &AppHandle, account_id: &str) -> AppResult<Option<String>> {
    let GetItemResponse { value } = app
        .secure_keystore()
        .get_item(ItemKey { key: key_for(account_id) })
        .map_err(|err| AppError::Keychain(err.to_string()))?;
    Ok(value)
}

/// Deletes `account_id`'s refresh token. Not an error if nothing was stored - `remove_account`
/// (`commands.rs`) calls this unconditionally alongside `accounts::store::remove()`.
pub fn delete_refresh_token(app: &AppHandle, account_id: &str) -> AppResult<()> {
    app.secure_keystore()
        .delete_item(ItemKey { key: key_for(account_id) })
        .map_err(|err| AppError::Keychain(err.to_string()))
}
