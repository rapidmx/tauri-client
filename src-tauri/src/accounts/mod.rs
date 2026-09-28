///////////////////////////////////////////////////////////////////////////////
// Copyright (C) 2026 Jean-Philippe Steinmetz
// SPDX-License-Identifier: MPL-2.0
///////////////////////////////////////////////////////////////////////////////
//! The non-secret half of "an account" this app remembers - `AccountSummary` is exactly what
//! `list_accounts`/`add_account`/`rapidmx://account-added` hand to the frontend (see
//! `src/lib/tauri.ts`'s identically-shaped TS interface). The secret half (the OAuth refresh
//! token) never appears here - it lives only in the OS keychain, see `keychain.rs`.

pub mod store;

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AccountSummary {
    /// A locally-generated identifier (see `store::add()`), never derived from anything
    /// server-issued - this app may hold accounts from many independent RapidMX deployments, whose
    /// own user/mailbox ids could collide with each other.
    pub id: String,
    /// Display label - defaults to the account's email address if the "Add account" flow (design
    /// doc step, `oauth::begin_sign_in`) wasn't given an explicit one.
    pub label: String,
    pub email: String,
    pub server_url: String,
    pub auth_server_url: String,
}
