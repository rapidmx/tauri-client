///////////////////////////////////////////////////////////////////////////////
// Copyright (C) 2026 Jean-Philippe Steinmetz
// SPDX-License-Identifier: MPL-2.0
///////////////////////////////////////////////////////////////////////////////
//! The OAuth2/PKCE sign-in flow (design doc, "Sign-in flow" steps 1-7) end to end: opening the
//! system browser to `/oauth/authorize` (`begin_sign_in`), and - once the OS routes the
//! `rapidmx://auth/callback` deep link back (`deep_link.rs`) - verifying `state`, exchanging the
//! authorization code for tokens, exchanging the access token for a short-lived session JWT, and
//! persisting the new account (`complete_sign_in`).
//!
//! **Tokens never enter the webview's JS context**, per the design doc's explicit requirement:
//! every HTTP call in this module (`reqwest`, direct HTTPS) runs in the Rust process, never
//! through the webview's own `fetch`. The only things that ever cross the Tauri IPC boundary into
//! JS are `AccountSummary` (id/label/email/serverUrl/authServerUrl - never a token) via
//! `rapidmx://account-added`, and a plain error message via `rapidmx://sign-in-error` - see
//! `deep_link.rs`.
//!
//! **auth-server's `POST /oauth/session-token` contract is now confirmed** (per this task's
//! briefing, 2026-09-27): `Authorization: Bearer <oauth-access-token>` in, `{ "token": "<session-jwt>"
//! }` out - matching `SessionTokenResponse` below exactly, no changes needed to
//! `exchange_code_for_session`/`refresh_session_token`'s existing shape. Step 1/4 (`/oauth/authorize`,
//! `/oauth/token`) are auth-server's *existing* OAuth2/PKCE authorization server. Still genuinely
//! **unverified**: this module has never been compiled or run against a real auth-server (no Rust
//! toolchain in this sandbox - see `.claude/NOTES.md`), so "confirmed" means "confirmed against the
//! contract as documented", not "confirmed by an actual successful exchange".

pub mod pkce;

use std::collections::HashMap;
use std::sync::Mutex;

use chrono::{DateTime, Utc};
use serde::Deserialize;
use tauri::AppHandle;
use tauri_plugin_opener::OpenerExt;
use url::Url;
use uuid::Uuid;

use crate::accounts::{store as account_store, AccountSummary};
use crate::config::{OAUTH_CLIENT_ID, OAUTH_REDIRECT_URI, OAUTH_SCOPE, PENDING_SIGN_IN_TTL_SECONDS};
use crate::error::{AppError, AppResult};
use crate::keychain;

/// One "Add account" attempt that has opened the system browser and is waiting for the
/// `rapidmx://auth/callback` deep link - keyed by its own `state` value in `PendingSignIns`.
///
/// `Debug` is implemented by hand, not derived, so `code_verifier` (a PKCE secret - possession of
/// it is exactly what lets `oauth/mod.rs`'s code exchange prove it's the same party that started
/// this sign-in) never ends up in a `{:?}`-formatted log line or test failure message.
struct PendingSignIn {
    code_verifier: String,
    email: String,
    server_url: String,
    auth_server_url: String,
    label: Option<String>,
    created_at: DateTime<Utc>,
}

impl std::fmt::Debug for PendingSignIn {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("PendingSignIn")
            .field("code_verifier", &"<redacted>")
            .field("email", &self.email)
            .field("server_url", &self.server_url)
            .field("auth_server_url", &self.auth_server_url)
            .field("label", &self.label)
            .field("created_at", &self.created_at)
            .finish()
    }
}

/// Every in-flight sign-in this app process has started but not yet completed. Managed Tauri state
/// (`app.manage(PendingSignIns::default())` in `lib.rs`) - a plain `Mutex<HashMap>` is enough,
/// since "Add account" is a human-paced, low-concurrency action (see `accounts/store.rs`'s own
/// reasoning for the same choice).
#[derive(Default)]
pub struct PendingSignIns(Mutex<HashMap<String, PendingSignIn>>);

#[derive(Debug, Deserialize)]
struct TokenResponse {
    access_token: String,
    refresh_token: String,
    #[allow(dead_code)]
    expires_in: u64,
}

#[derive(Debug, Deserialize)]
struct SessionTokenResponse {
    token: String,
}

fn http_client() -> AppResult<reqwest::Client> {
    reqwest::Client::builder()
        .build()
        .map_err(AppError::Http)
}

/// Step 1: builds `${authServerUrl}/oauth/authorize` with a fresh PKCE pair and `state`, opens it
/// in the system browser via the `opener` plugin, and registers the pending sign-in so the eventual
/// `rapidmx://auth/callback` deep link (`deep_link.rs`) can find it again by `state`. Returns as
/// soon as the browser has been asked to open - does NOT wait for the user to finish signing in;
/// see this module's doc comment and `src/lib/tauri.ts`'s `addAccount()` for how completion is
/// reported back to the frontend asynchronously.
pub fn begin_sign_in(
    app: &AppHandle,
    pending: &PendingSignIns,
    email: String,
    server_url: String,
    auth_server_url: String,
    label: Option<String>,
) -> AppResult<()> {
    let pkce = pkce::generate();
    let state = pkce::generate_state();

    let mut authorize_url = Url::parse(&format!("{}/oauth/authorize", auth_server_url.trim_end_matches('/')))?;
    authorize_url
        .query_pairs_mut()
        .append_pair("response_type", "code")
        .append_pair("client_id", OAUTH_CLIENT_ID)
        .append_pair("redirect_uri", OAUTH_REDIRECT_URI)
        // Confirmed this session (see this module's doc comment): an `openid`-scoped authorize
        // request needs `offline_access` too, or `/oauth/token` will not issue a refresh token at
        // all - and this app cannot function without one (every subsequent session JWT comes from
        // a refresh, see `refresh_session_token` below; there is no long-lived browser session to
        // fall back on the way a cookie-based web client has).
        .append_pair("scope", OAUTH_SCOPE)
        .append_pair("code_challenge", &pkce.challenge)
        .append_pair("code_challenge_method", "S256")
        .append_pair("state", &state);

    app.opener()
        .open_url(authorize_url.as_str(), None::<&str>)
        .map_err(|err| AppError::OAuth(format!("could not open the system browser: {err}")))?;

    let mut guard = pending.0.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
    guard.insert(
        state,
        PendingSignIn {
            code_verifier: pkce.verifier,
            email,
            server_url,
            auth_server_url,
            label,
            created_at: Utc::now(),
        },
    );
    Ok(())
}

/// Steps 4-5: exchanges `code` for tokens, then the access token for a session JWT.
async fn exchange_code_for_session(
    auth_server_url: &str,
    code: &str,
    code_verifier: &str,
) -> AppResult<(TokenResponse, String)> {
    let client = http_client()?;

    let token_url = format!("{}/oauth/token", auth_server_url.trim_end_matches('/'));
    let params = [
        ("grant_type", "authorization_code"),
        ("code", code),
        ("redirect_uri", OAUTH_REDIRECT_URI),
        ("client_id", OAUTH_CLIENT_ID),
        ("code_verifier", code_verifier),
    ];
    let token_response: TokenResponse = client
        .post(&token_url)
        .form(&params)
        .send()
        .await?
        .error_for_status()
        .map_err(AppError::Http)?
        .json()
        .await?;

    // Step 5. `authApiFetch()`-style bearer auth, per the design doc - this is a plain
    // authenticated REST call, not part of the OAuth2 spec proper, hence no shared helper with the
    // token exchange above beyond both using this same `client`.
    let session_token_url = format!("{}/oauth/session-token", auth_server_url.trim_end_matches('/'));
    let session_response: SessionTokenResponse = client
        .post(&session_token_url)
        .bearer_auth(&token_response.access_token)
        .send()
        .await?
        .error_for_status()
        .map_err(AppError::Http)?
        .json()
        .await?;

    Ok((token_response, session_response.token))
}

/// Steps 4-5, repeated with a stored refresh token instead of an authorization code - "refresh by
/// repeating steps 4-5 near expiry using the stored refresh token (no browser popup needed)".
///
/// **Now wired**, as the `get_session_token` command (`commands.rs`), which the frontend's
/// `getAccessToken` callback on every account's `ApiClient` (`src/lib/apiClients.ts`) calls before
/// every request that needs a fresh token (`@rapidmx/react-shared`'s `createApiClient()` calls
/// `getAccessToken` fresh before every single call, never caching it - see that function's own doc
/// comment) - so this always does a real refresh-token grant, never a cached/reused access token.
/// That is more network round-trips than a real client would want (a session JWT presumably has its
/// own lifetime worth caching against, but `POST /oauth/session-token`'s response doesn't document
/// one - see this module's own doc comment on what is and isn't confirmed), but it is correct and
/// simple, and a good first pass; caching with a lifetime is future work once that response's real
/// shape is confirmed.
pub async fn refresh_session_token(app: &AppHandle, account_id: &str) -> AppResult<String> {
    let account = account_store::find(app, account_id)?.ok_or_else(|| AppError::AccountNotFound(account_id.to_string()))?;
    let refresh_token = keychain::load_refresh_token(app, account_id)?
        .ok_or_else(|| AppError::Keychain(format!("no refresh token stored for account {account_id}")))?;

    let client = http_client()?;
    let token_url = format!("{}/oauth/token", account.auth_server_url.trim_end_matches('/'));
    let params = [
        ("grant_type", "refresh_token"),
        ("refresh_token", refresh_token.as_str()),
        ("client_id", OAUTH_CLIENT_ID),
    ];
    let token_response: TokenResponse = client
        .post(&token_url)
        .form(&params)
        .send()
        .await?
        .error_for_status()
        .map_err(AppError::Http)?
        .json()
        .await?;

    // A refresh grant commonly rotates the refresh token itself (auth-server's own choice, not
    // confirmed here) - always overwrite the stored one with whatever came back, which is correct
    // whether or not it actually changed.
    keychain::store_refresh_token(app, account_id, &token_response.refresh_token)?;

    let session_token_url = format!("{}/oauth/session-token", account.auth_server_url.trim_end_matches('/'));
    let session_response: SessionTokenResponse = client
        .post(&session_token_url)
        .bearer_auth(&token_response.access_token)
        .send()
        .await?
        .error_for_status()
        .map_err(AppError::Http)?
        .json()
        .await?;

    Ok(session_response.token)
}

/// Parses the `rapidmx://auth/callback?code=...&state=...` deep link URL the OS handed back to
/// this app, and finds+removes the matching pending sign-in by `state` (removed unconditionally
/// once found, whether or not the rest of this function ultimately succeeds - a failed exchange
/// should not leave a stale pending entry a retry could collide with; the frontend surfaces the
/// failure via `rapidmx://sign-in-error` and the user simply clicks "Sign in" again, which starts
/// an entirely fresh `state`).
fn take_pending_sign_in(pending: &PendingSignIns, callback_url: &Url) -> AppResult<PendingSignIn> {
    let mut query: HashMap<String, String> = callback_url.query_pairs().into_owned().collect();

    if let Some(error) = query.remove("error") {
        let description = query.remove("error_description").unwrap_or_default();
        return Err(AppError::OAuth(format!("auth-server denied the request: {error} {description}")));
    }

    let state = query.remove("state").ok_or_else(|| AppError::OAuth("callback URL is missing state".to_string()))?;

    let mut guard = pending.0.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
    let entry = guard
        .remove(&state)
        .ok_or_else(|| AppError::OAuth("no matching pending sign-in - it may have expired, or this state was already used".to_string()))?;
    drop(guard);

    let age_seconds = (Utc::now() - entry.created_at).num_seconds();
    if age_seconds > PENDING_SIGN_IN_TTL_SECONDS {
        return Err(AppError::OAuth("this sign-in attempt expired - please try again".to_string()));
    }

    Ok(entry)
}

/// The full callback-side flow (steps 4-7, minus the actual near-expiry refresh scheduling - see
/// `refresh_session_token`'s own doc comment): verify `state`, exchange the code, store the
/// refresh token in the keychain, persist the new `AccountSummary`, and return it so the caller
/// (`deep_link.rs`) can emit `rapidmx://account-added`.
///
/// The session JWT `exchange_code_for_session` returns is deliberately **not** persisted or
/// returned by this function - this session's frontend has nowhere to use it yet (the CSR mount of
/// `@rapidmx/web-client` that would consume it, per `src/lib/webClientBridge.ts`, is out of scope
/// this session). A future pass wiring that up should extend this function's return value (or add
/// a sibling) to hand the session token back to whatever mounts the account's UI - it must still
/// never be persisted to disk itself, unlike the refresh token.
pub async fn complete_sign_in(app: &AppHandle, pending: &PendingSignIns, callback_url: &Url) -> AppResult<AccountSummary> {
    let entry = take_pending_sign_in(pending, callback_url)?;

    let query: HashMap<String, String> = callback_url.query_pairs().into_owned().collect();
    let code = query.get("code").ok_or_else(|| AppError::OAuth("callback URL is missing code".to_string()))?;

    let (token_response, _session_token) = exchange_code_for_session(&entry.auth_server_url, code, &entry.code_verifier).await?;

    let account_id = Uuid::new_v4().to_string();
    keychain::store_refresh_token(app, &account_id, &token_response.refresh_token)?;

    let summary = AccountSummary {
        id: account_id,
        label: entry.label.unwrap_or_else(|| entry.email.clone()),
        email: entry.email,
        server_url: entry.server_url,
        auth_server_url: entry.auth_server_url,
    };
    account_store::add(app, summary.clone())?;

    Ok(summary)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn callback_url(query: &str) -> Url {
        Url::parse(&format!("rapidmx://auth/callback?{query}")).unwrap()
    }

    #[test]
    fn take_pending_sign_in_rejects_an_unknown_state() {
        let pending = PendingSignIns::default();
        let err = take_pending_sign_in(&pending, &callback_url("code=abc&state=unknown")).unwrap_err();
        assert!(matches!(err, AppError::OAuth(_)));
    }

    #[test]
    fn take_pending_sign_in_surfaces_an_error_param_from_auth_server() {
        let pending = PendingSignIns::default();
        let err = take_pending_sign_in(&pending, &callback_url("error=access_denied&error_description=user+cancelled&state=x")).unwrap_err();
        match err {
            AppError::OAuth(message) => assert!(message.contains("access_denied")),
            other => panic!("expected AppError::OAuth, got {other:?}"),
        }
    }

    #[test]
    fn take_pending_sign_in_requires_a_state_param() {
        let pending = PendingSignIns::default();
        let err = take_pending_sign_in(&pending, &callback_url("code=abc")).unwrap_err();
        assert!(matches!(err, AppError::OAuth(_)));
    }

    #[test]
    fn take_pending_sign_in_succeeds_for_a_known_unexpired_state() {
        let pending = PendingSignIns::default();
        pending.0.lock().unwrap().insert(
            "known-state".to_string(),
            PendingSignIn {
                code_verifier: "verifier".to_string(),
                email: "user@example.com".to_string(),
                server_url: "https://mail.example.com".to_string(),
                auth_server_url: "https://auth.example.com".to_string(),
                label: None,
                created_at: Utc::now(),
            },
        );
        let entry = take_pending_sign_in(&pending, &callback_url("code=abc&state=known-state")).unwrap();
        assert_eq!(entry.email, "user@example.com");
        // Removed after a successful take - a replay of the same callback URL must fail.
        assert!(take_pending_sign_in(&pending, &callback_url("code=abc&state=known-state")).is_err());
    }

    #[test]
    fn take_pending_sign_in_rejects_an_expired_entry() {
        let pending = PendingSignIns::default();
        pending.0.lock().unwrap().insert(
            "stale-state".to_string(),
            PendingSignIn {
                code_verifier: "verifier".to_string(),
                email: "user@example.com".to_string(),
                server_url: "https://mail.example.com".to_string(),
                auth_server_url: "https://auth.example.com".to_string(),
                label: None,
                created_at: Utc::now() - chrono::Duration::seconds(PENDING_SIGN_IN_TTL_SECONDS + 1),
            },
        );
        let err = take_pending_sign_in(&pending, &callback_url("code=abc&state=stale-state")).unwrap_err();
        assert!(matches!(err, AppError::OAuth(_)));
    }
}
