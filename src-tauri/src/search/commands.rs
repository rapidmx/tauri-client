///////////////////////////////////////////////////////////////////////////////
// Copyright (C) 2026 Jean-Philippe Steinmetz
// SPDX-License-Identifier: MPL-2.0
///////////////////////////////////////////////////////////////////////////////
//! `#[tauri::command]` wrappers around `LocalIndexManager` (`search/mod.rs`), named and shaped to
//! mirror `web-client`'s `apps/shared/search/localIndexRpcClient.ts` public API at the interface
//! level - `indexLocalEntities`/`searchLocal`/`getLocalCoverage`/`destroyLocalIndex` plus a few more
//! (see this module's own function list) - so a future pass adding a `src/lib/searchBridge.ts` can
//! swap that file's transport from Worker `postMessage` RPC to a plain Tauri `invoke()` with
//! minimal interface change, per the task briefing.
//!
//! **Registered in `lib.rs`'s `tauri::generate_handler!` (so they're real, callable commands), but
//! not called from anywhere in this session's frontend** - `src/lib/tauri.ts` only wraps the
//! account/sign-in commands in `commands.rs`. Wiring a real search UI up to these is future work,
//! and depends on this app first having somewhere to get a mailbox's unlocked master key from (see
//! `search_local_init`'s own doc comment).

use base64::engine::general_purpose::STANDARD as BASE64;
use base64::Engine as _;
use tauri::{AppHandle, State};

use crate::error::CommandResult;
use crate::search::schema::{LocalIndexEntity, LocalSearchPredicateFields};
use crate::search::{Coverage, IndexEntitiesResult, LocalIndexManager, LocalSearchPage};

/// Mirrors `initLocalIndex()`. `master_key_base64` is this account's already-unlocked E2E mailbox
/// master key, standard-base64-encoded - **there is nothing in this app yet that produces one**
/// (the E2E key-unlock flow is a separate subsystem out of scope this session, per the task
/// briefing's own "This session's scope" framing of the search feature as schema/interface work,
/// not full key-lifecycle wiring). This command exists so the *shape* of that future integration
/// is already in place.
#[tauri::command]
pub fn search_local_init(app: AppHandle, manager: State<'_, LocalIndexManager>, account_id: String, master_key_base64: String) -> CommandResult<()> {
    let master_key = BASE64.decode(master_key_base64).map_err(|err| format!("master_key_base64 is not valid base64: {err}"))?;
    manager.init(&app, &account_id, &master_key).map_err(|err| err.to_string())
}

/// Mirrors `indexLocalEntities()`.
#[tauri::command]
pub fn search_local_index_entities(manager: State<'_, LocalIndexManager>, account_id: String, entities: Vec<LocalIndexEntity>) -> CommandResult<IndexEntitiesResult> {
    manager.index_entities(&account_id, &entities).map_err(|err| err.to_string())
}

/// Mirrors `removeLocalEntity()`.
#[tauri::command]
pub fn search_local_remove_entity(manager: State<'_, LocalIndexManager>, account_id: String, entity_uid: String) -> CommandResult<()> {
    manager.remove_entity(&account_id, &entity_uid).map_err(|err| err.to_string())
}

/// Mirrors `searchLocal()`. `offset` defaults to 0 when omitted, matching that function's own
/// default parameter.
#[tauri::command]
pub fn search_local_search(
    manager: State<'_, LocalIndexManager>,
    account_id: String,
    mailbox_uid: String,
    parsed: LocalSearchPredicateFields,
    limit: i64,
    offset: Option<i64>,
) -> CommandResult<LocalSearchPage> {
    manager
        .search(&account_id, &mailbox_uid, &parsed, limit, offset.unwrap_or(0))
        .map_err(|err| err.to_string())
}

/// Mirrors `getLocalCoverage()`.
#[tauri::command]
pub fn search_local_get_coverage(manager: State<'_, LocalIndexManager>, account_id: String, mailbox_uid: String) -> CommandResult<Coverage> {
    manager.get_coverage(&account_id, &mailbox_uid).map_err(|err| err.to_string())
}

/// Mirrors `destroyLocalIndex()`.
#[tauri::command]
pub fn search_local_destroy(app: AppHandle, manager: State<'_, LocalIndexManager>, account_id: String) -> CommandResult<bool> {
    manager.destroy(&app, &account_id).map_err(|err| err.to_string())
}

/// Mirrors `destroyAllLocalIndexes()` - every account's index, not just one.
#[tauri::command]
pub fn search_local_destroy_all(app: AppHandle, manager: State<'_, LocalIndexManager>) -> CommandResult<bool> {
    manager.destroy_all(&app).map_err(|err| err.to_string())
}
