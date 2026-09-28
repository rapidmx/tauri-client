///////////////////////////////////////////////////////////////////////////////
// Copyright (C) 2026 Jean-Philippe Steinmetz
// SPDX-License-Identifier: MPL-2.0
///////////////////////////////////////////////////////////////////////////////
//! App-wide constants for the OAuth2/PKCE sign-in flow. Unlike `electron-client`'s `config.ts`
//! (a single hardcoded `serverUrl`/`authServerUrl` pair, read from env vars, good for exactly one
//! deployment), this app has no single server at all - every account resolves its own
//! `serverUrl`/`authServerUrl` at "Add account" time (see `federation/mod.rs`). What's constant
//! here is this *client application's* own identity in the OAuth flow, not any one deployment.

/// The registered PUBLIC OAuth2 client id for this native app, as this task's design section
/// describes step 1 of the sign-in flow. **Not yet actually registered anywhere** - a parallel
/// effort is expected to register a `tauri-client` PUBLIC client with every `auth-server`
/// deployment's OAuth client registry (or ship a seed migration doing so); until that lands, every
/// real `/oauth/authorize` request built from this constant will be rejected by a real
/// `auth-server` with an "unknown client_id" error. See `.claude/NOTES.md`.
pub const OAUTH_CLIENT_ID: &str = "tauri-client";

/// The custom URL scheme this app registers via the `deep-link` plugin (see `tauri.conf.json`'s
/// `plugins.deep-link.desktop.schemes` and `.mobile[].scheme`) and the redirect_uri sent to
/// `/oauth/authorize` (step 1) and `/oauth/token` (step 4). The task's design section notes
/// `/oauth/authorize`'s redirect_uri check has no scheme restriction, so a non-http(s) custom
/// scheme is expected to be accepted as-is.
pub const OAUTH_REDIRECT_URI: &str = "rapidmx://auth/callback";

/// The `scope` sent with every `/oauth/authorize` request (step 1) and reused verbatim as the
/// refresh grant's implicit scope (step 4's repeat in `oauth::refresh_session_token`, which never
/// sends `scope` itself - a refresh grant keeps whatever scope the original grant had). Confirmed
/// this session (per this task's briefing): `offline_access` is required alongside `openid` or
/// `/oauth/token` will not issue a refresh token at all, which this app cannot function without -
/// every session JWT it ever uses after the very first one comes from a refresh (see
/// `oauth::refresh_session_token`), not from a long-lived browser session.
pub const OAUTH_SCOPE: &str = "openid profile email offline_access";

/// PKCE code_verifier length in bytes of raw entropy, before base64url encoding - RFC 7636 §4.1
/// requires the base64url-encoded verifier to be 43-128 characters; 64 raw bytes base64url-encodes
/// (unpadded) to 86 characters, comfortably inside that range with a wide security margin (512
/// bits of entropy).
pub const PKCE_VERIFIER_BYTES: usize = 64;

/// Length in bytes of the random OAuth `state` parameter - CSRF protection for the authorize
/// redirect, unrelated to PKCE's own code_verifier/code_challenge pair.
pub const OAUTH_STATE_BYTES: usize = 32;

/// How long a pending sign-in (state + PKCE verifier registered by `add_account`, awaiting the
/// `rapidmx://auth/callback` deep link) is kept before being discarded as abandoned - generous,
/// since the user may take a while in the browser (SSO redirects, MFA, a password manager).
pub const PENDING_SIGN_IN_TTL_SECONDS: i64 = 10 * 60;
