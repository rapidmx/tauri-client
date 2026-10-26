///////////////////////////////////////////////////////////////////////////////
// Copyright (C) 2026 Jean-Philippe Steinmetz
// SPDX-License-Identifier: MPL-2.0
///////////////////////////////////////////////////////////////////////////////
//! Crate root - shared between the desktop entry point (`main.rs`, which just calls `run()`) and
//! the mobile entry point (`#[cfg_attr(mobile, tauri::mobile_entry_point)]` below), per Tauri v2's
//! own project structure convention (see `Cargo.toml`'s `[lib]` block doc comment).
//!
//! Module map:
//! - `accounts` - the non-secret account record + its on-disk JSON store.
//! - `commands` - the account/sign-in `#[tauri::command]`s the frontend actually calls today.
//! - `config` - this app's own OAuth client identity constants (client_id, redirect_uri, ...).
//! - `deep_link` - routes `rapidmx://auth/callback` into `oauth::complete_sign_in`.
//! - `error` - the one error type every other module uses.
//! - `federation` - "Add account" server discovery (DNS TXT + `.well-known/rapidmx/server-info`).
//! - `keychain` - OS-keychain refresh-token storage, one entry per account.
//! - `menu` - desktop-only application menu (not compiled/used on mobile).
//! - `navigation` - keeps the webview on this app's own pages (refuses web-client's sign-out redirect).
//! - `oauth` - the OAuth2/PKCE sign-in flow itself.
//! - `search` - the native Tier 2 FTS5 local index (in-memory SQLite, libsodium-XChaCha20-Poly1305
//!   encrypted at rest), one database per account.

pub mod accounts;
pub mod commands;
pub mod config;
pub mod deep_link;
pub mod error;
pub mod federation;
pub mod keychain;
#[cfg(desktop)]
pub mod menu;
pub mod navigation;
pub mod oauth;
pub mod search;

use oauth::{session::SessionTokens, PendingSignIns};
use search::LocalIndexManager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default();
    // Registered first, as the plugin requires: a second launch (on Windows and Linux, the one the OS
    // starts for a `rapidmx://auth/callback` deep link) hands its URL to this instance's deep-link
    // `on_open_url` handler, where the pending sign-in lives, and exits. See `deep_link`.
    #[cfg(desktop)]
    let builder = builder.plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| {
        focus_main_window(app);
    }));
    builder
        .plugin(navigation::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_deep_link::init())
        .plugin(tauri_plugin_secure_keystore::init())
        .manage(PendingSignIns::default())
        .manage(SessionTokens::default())
        .manage(LocalIndexManager::default())
        .setup(|app| {
            let handle = app.handle();

            #[cfg(desktop)]
            {
                menu::apply_application_menu(handle)?;
            }

            deep_link::register(handle)?;

            Ok(())
        })
        .on_menu_event(|app, event| {
            #[cfg(desktop)]
            menu::handle_menu_event(app, &event);
            #[cfg(not(desktop))]
            {
                let _ = (app, event);
            }
        })
        .invoke_handler(tauri::generate_handler![
            commands::resolve_server,
            commands::add_account,
            commands::list_accounts,
            commands::remove_account,
            commands::get_session_token,
            search::commands::search_local_init,
            search::commands::search_local_index_entities,
            search::commands::search_local_remove_entity,
            search::commands::search_local_move_entity,
            search::commands::search_local_indexed_versions,
            search::commands::search_local_search,
            search::commands::search_local_get_coverage,
            search::commands::search_local_destroy,
            search::commands::search_local_destroy_mailbox,
            search::commands::search_local_destroy_all,
        ])
        .run(tauri::generate_context!())
        .expect("error while running the RapidMX Tauri application");
}

/// Brings the main window forward when a second launch was folded into this instance (the user
/// came back from their browser's sign-in page, or started the app again). Best effort.
#[cfg(desktop)]
fn focus_main_window(app: &tauri::AppHandle) {
    use tauri::Manager;
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
    }
}
