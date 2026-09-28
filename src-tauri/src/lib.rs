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
pub mod oauth;
pub mod search;

use oauth::PendingSignIns;
use search::LocalIndexManager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_deep_link::init())
        .plugin(tauri_plugin_secure_keystore::init())
        .manage(PendingSignIns::default())
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
            search::commands::search_local_search,
            search::commands::search_local_get_coverage,
            search::commands::search_local_destroy,
            search::commands::search_local_destroy_all,
        ])
        .run(tauri::generate_context!())
        .expect("error while running the RapidMX Tauri application");
}
