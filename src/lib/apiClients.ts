///////////////////////////////////////////////////////////////////////////////
// Copyright (C) 2026 Jean-Philippe Steinmetz
// SPDX-License-Identifier: MPL-2.0
///////////////////////////////////////////////////////////////////////////////
/**
 * Holds one live `@rapidmx/react-shared` `ApiClient` per signed-in account - the explicit-context
 * client mode that repo added specifically for this app (`createApiClient()`, confirmed this session
 * by reading `react-shared/src/util/api.ts`), additive to its existing global-config `apiFetch()`
 * mode (which `@rapidmx/electron-client` uses instead - fine for its single account, wrong here per
 * `createApiClient()`'s own doc comment: "for a consumer... that needs several fully independent
 * origin/session contexts open at once, which the single module-level `apiBaseUrl` global can't
 * represent").
 *
 * Every account this app currently lists (`list_accounts`) is treated as "signed in" - there is no
 * separate locked/unlocked account status modeled anywhere yet (an account only ever enters the
 * store via a completed OAuth exchange, see `oauth::complete_sign_in`), so "every account the store
 * reports" already *is* "every signed-in account" today. If a locked/unlocked distinction is added
 * later (the E2E key-unlock flow this repo's `.claude/NOTES.md` already calls out as future work),
 * this module's caller should stop calling `syncApiClients()` with locked accounts, not this module
 * itself change - it has no way to know "locked" means anything different from "not yet".
 *
 * `getAccessToken` calls the `get_session_token` Tauri command (`src/lib/tauri.ts`), which does a
 * real OAuth refresh grant plus the `/oauth/session-token` exchange in Rust, transparently, on every
 * single call - `createApiClient()` itself calls `getAccessToken` fresh before every request rather
 * than caching it, so this module doesn't need its own caching/refresh-scheduling logic either.
 */
import { createApiClient, type ApiClient } from "@rapidmx/web-client/lib/util/api.js";
import { getSessionToken, type AccountSummary } from "./tauri.js";

const clients = new Map<string, ApiClient>();

/** The live `ApiClient` for `accountId`, or `undefined` if that account has no client yet (it was
 * never passed to `syncApiClients()`, or has since been removed). */
export function getApiClient(accountId: string): ApiClient | undefined {
    return clients.get(accountId);
}

/**
 * Reconciles the live `ApiClient` map against `accounts` (normally every account `App.tsx` just
 * loaded/received from the Rust side): creates a client for any new account id, and disposes of
 * (simply drops - `ApiClient` holds no resources of its own to close) any client whose account is no
 * longer present. Existing clients for accounts still present are left untouched, so an in-flight
 * request on one account's client is never disrupted by another account's list update.
 */
export function syncApiClients(accounts: AccountSummary[]): void {
    const currentIds = new Set(accounts.map((account) => account.id));
    for (const existingId of clients.keys()) {
        if (!currentIds.has(existingId)) {
            clients.delete(existingId);
        }
    }
    for (const account of accounts) {
        if (!clients.has(account.id)) {
            clients.set(
                account.id,
                createApiClient({
                    baseUrl: account.serverUrl,
                    getAccessToken: () => getSessionToken(account.id),
                })
            );
        }
    }
}

/** Test-only escape hatch - clears every held client so each test file starts from a known-empty
 * state without needing to reach into this module's private `Map` directly. */
export function __resetApiClientsForTests(): void {
    clients.clear();
}
