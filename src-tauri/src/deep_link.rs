///////////////////////////////////////////////////////////////////////////////
// Copyright (C) 2026 Jean-Philippe Steinmetz
// SPDX-License-Identifier: MPL-2.0
///////////////////////////////////////////////////////////////////////////////
//! Wires the `deep-link` plugin's `rapidmx://auth/callback` URLs (registered in
//! `tauri.conf.json`'s `plugins.deep-link`) into `oauth::complete_sign_in`, and reports the
//! outcome to the frontend as one of the two events `src/lib/tauri.ts` subscribes to.
//!
//! Two delivery paths, both handled identically here (mirroring the deep-link plugin's own
//! documented "two ways to receive a URL"):
//! - `on_open_url` - the app was already running when the OS routed the URL to it (the ordinary
//!   case: the user was sent back to this already-open app from their browser). macOS and the
//!   mobile platforms deliver it here themselves. Windows and Linux instead start a second process
//!   with the URL on its command line; `tauri-plugin-single-instance` (registered first in
//!   `lib.rs`, with its `deep-link` feature) forwards that URL here and exits the second process.
//!   That matters for sign-in: the pending PKCE state lives only in the memory of the instance
//!   that called `begin_sign_in`, so a second process could never complete it.
//! - `get_current` - the URL that *launched* this app process, checked once at startup. Only a
//!   real cold start reaches it now (no instance was running), where no sign-in can be pending, so
//!   a callback arriving this way fails with "no matching pending sign-in" and the user starts over.
//!
//! **Not verified against a real OS or a real auth-server** (see `.claude/NOTES.md`) - this module
//! was written against the deep-link plugin's own documented Rust API
//! (`tauri_plugin_deep_link::DeepLinkExt`, `on_open_url`/`get_current`), not compiled or run.

use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_deep_link::DeepLinkExt;
use url::Url;

use crate::error::AppError;
use crate::oauth::PendingSignIns;

pub const EVENT_ACCOUNT_ADDED: &str = "rapidmx://account-added";
pub const EVENT_SIGN_IN_ERROR: &str = "rapidmx://sign-in-error";

#[derive(Clone, serde::Serialize)]
struct SignInErrorPayload {
    message: String,
}

/// Handles one deep-link URL: if it's our own `rapidmx://auth/callback` (the only scheme/host this
/// app registers - see `tauri.conf.json`), runs `oauth::complete_sign_in` and emits the matching
/// event. Any other URL is ignored rather than treated as an error - a future deep link this app
/// doesn't yet understand shouldn't surface a confusing "sign-in failed" toast.
fn handle_url(app: &AppHandle, url: &Url) {
    if url.scheme() != "rapidmx" || url.host_str() != Some("auth") || url.path() != "/callback" {
        return;
    }

    let app = app.clone();
    let url = url.clone();
    tauri::async_runtime::spawn(async move {
        let pending = app.state::<PendingSignIns>();
        let result = crate::oauth::complete_sign_in(&app, &pending, &url).await;
        match result {
            Ok(account) => {
                let _ = app.emit(EVENT_ACCOUNT_ADDED, account);
            }
            Err(err) => {
                let message = describe_for_user(&err);
                let _ = app.emit(EVENT_SIGN_IN_ERROR, SignInErrorPayload { message });
            }
        }
    });
}

/// `AppError`'s `Display` impl is already reasonably user-facing (see `error.rs`), but this exists
/// as a single seam in case sign-in failures specifically ever need friendlier wording than the
/// raw underlying error (e.g. a network error mid-token-exchange) without changing `AppError`'s
/// general `Display` impl used by every other command's error path.
fn describe_for_user(err: &AppError) -> String {
    err.to_string()
}

/// Registers this app's deep-link handling. Called once from `lib.rs`'s `setup()`, before the
/// first window is shown.
pub fn register(app: &AppHandle) -> tauri::Result<()> {
    // A dev build isn't installed by the bundler, so nothing registered the `rapidmx` scheme for it
    // on Windows or Linux. Best effort: a failure only means the browser can't hand the callback back.
    #[cfg(all(debug_assertions, any(windows, target_os = "linux")))]
    let _ = app.deep_link().register_all();

    let handle_for_open = app.clone();
    app.deep_link().on_open_url(move |event| {
        for url in event.urls() {
            handle_url(&handle_for_open, &url);
        }
    });

    // Cold-start case - see this module's own doc comment.
    if let Ok(Some(urls)) = app.deep_link().get_current() {
        for url in urls {
            handle_url(app, &url);
        }
    }

    Ok(())
}
