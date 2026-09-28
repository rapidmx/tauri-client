///////////////////////////////////////////////////////////////////////////////
// Copyright (C) 2026 Jean-Philippe Steinmetz
// SPDX-License-Identifier: MPL-2.0
///////////////////////////////////////////////////////////////////////////////
//! The account/sign-in `#[tauri::command]`s `src/lib/tauri.ts` calls - one function per export
//! there, same names (in snake_case, Tauri's own JS<->Rust command-name convention), same
//! parameter and return shapes (`serde`'s `camelCase` rename on every struct below matches the TS
//! interfaces exactly - see each struct's own module). Registered in `lib.rs`'s
//! `tauri::generate_handler!` call.
//!
//! The native Tier 2 search commands have their own file, `search/commands.rs` - not aggregated
//! here, since nothing in this session's frontend calls them yet (see that module's own doc
//! comment).

use tauri::{AppHandle, State};

use crate::accounts::{store as account_store, AccountSummary};
use crate::error::CommandResult;
use crate::federation::{self, ServerInfo};
use crate::keychain;
use crate::oauth::{self, PendingSignIns};

/// Design doc, "Multi-server 'Add account' flow" steps 1-3 - DNS TXT lookup plus the
/// `.well-known/rapidmx/server-info` fetch, both done here in Rust (a plain webview `fetch()`
/// cannot perform a DNS TXT lookup at all).
#[tauri::command]
pub async fn resolve_server(email: String) -> CommandResult<ServerInfo> {
    federation::resolve_server_info(&email).await.map_err(|err| err.to_string())
}

/// Design doc, "Sign-in flow" step 1 - opens the system browser and registers the pending PKCE
/// state. Returns immediately; see `src/lib/tauri.ts`'s `addAccount()` doc comment for how
/// completion is reported back asynchronously via `rapidmx://account-added`/`rapidmx://sign-in-error`.
#[tauri::command]
pub fn add_account(
    app: AppHandle,
    pending: State<'_, PendingSignIns>,
    email: String,
    server_url: String,
    auth_server_url: String,
    label: Option<String>,
) -> CommandResult<()> {
    oauth::begin_sign_in(&app, &pending, email, server_url, auth_server_url, label).map_err(|err| err.to_string())
}

/// Every account persisted in the local account store (`accounts/store.rs`), regardless of whether
/// its refresh token is still valid server-side.
#[tauri::command]
pub fn list_accounts(app: AppHandle) -> CommandResult<Vec<AccountSummary>> {
    account_store::list(&app).map_err(|err| err.to_string())
}

/// Removes both halves of an account: its non-secret record (`accounts/store.rs`) and its keychain
/// entry (`keychain.rs`). Does not attempt to revoke the token server-side - auth-server has no
/// such endpoint documented yet (flagged in this repo's README's "Known gaps" section). Succeeds
/// even if one or both halves were already absent, so a retry after a partial failure is safe.
#[tauri::command]
pub fn remove_account(app: AppHandle, account_id: String) -> CommandResult<()> {
    account_store::remove(&app, &account_id).map_err(|err| err.to_string())?;
    keychain::delete_refresh_token(&app, &account_id).map_err(|err| err.to_string())
}

/// A fresh, short-lived session JWT for `account_id` - the `getAccessToken` callback every
/// account's `@rapidmx/react-shared` `ApiClient` (`src/lib/apiClients.ts`) invokes before each
/// request. Transparently repeats the OAuth refresh grant and the `/oauth/session-token` exchange
/// (`oauth::refresh_session_token`) every single call - see that function's own doc comment for why
/// that's the correct, if not maximally efficient, first pass. Never caches anything itself; a
/// caller wanting fewer round-trips would need to add caching at this layer or `refresh_session_token`'s
/// own, not in the frontend.
#[tauri::command]
pub async fn get_session_token(app: AppHandle, account_id: String) -> CommandResult<String> {
    oauth::refresh_session_token(&app, &account_id).await.map_err(|err| err.to_string())
}
