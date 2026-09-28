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
//!   case: the user was sent back to this already-open app from their browser).
//! - `get_current` - the URL that *launched* this app process, checked once at startup. Realistic
//!   for a cold-started app on some platforms/OS versions where the deep link launches a fresh
//!   process rather than activating an existing one; harmless to also check here even where it
//!   can't happen.
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
