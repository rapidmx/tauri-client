///////////////////////////////////////////////////////////////////////////////
// Copyright (C) 2026 Jean-Philippe Steinmetz
// SPDX-License-Identifier: MPL-2.0
///////////////////////////////////////////////////////////////////////////////
/**
 * Thin, typed wrapper around the Tauri commands the Rust side (`src-tauri/src/commands.rs` and
 * `src-tauri/src/oauth/mod.rs`) exposes for the account/sign-in flow this session's frontend
 * actually wires up. Kept as one small module, rather than importing `@tauri-apps/api/core`
 * directly from `App.tsx`, so every command name and payload shape lives in exactly one place
 * (matching each Rust command function 1:1 - see the doc comment on each export below for which
 * Rust function it calls), and so `App.tsx` and its tests never need to know whether a given call
 * goes through `invoke()` or an event listener - both are re-exported here as plain async
 * functions and subscriptions.
 *
 * Now also covers `get_session_token` (the `getAccessToken` callback every account's `ApiClient`
 * uses, see `src/lib/apiClients.ts`) and the native Tier 2 search commands (`src-tauri/src/search/
 * commands.rs`), wrapped here so `src/lib/searchTransport.ts`'s `LocalIndexTransport` adapter has
 * one typed call per Rust command, matching every other export in this module. The desktop menu
 * still has no TS-side wrapper - nothing in this frontend calls it directly (it's wired entirely
 * Rust-side, see `src-tauri/src/menu.rs`).
 */
import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

/** Mirrors `oauth::ServerInfo` (`src-tauri/src/oauth/mod.rs`) - what `resolve_server` returns once
 * it has resolved the `_rapidmx.<domain>` TXT record and fetched `.well-known/rapidmx/server-info`
 * for the caller's email domain. */
export interface ServerInfo {
    serverUrl: string;
    authServerUrl: string;
}

/** Mirrors `accounts::AccountSummary` (`src-tauri/src/accounts/mod.rs`) - the non-secret fields of
 * a persisted account. Never carries a token; those live only in the OS keychain (see
 * `src-tauri/src/keychain.rs`), keyed by `id`. */
export interface AccountSummary {
    id: string;
    label: string;
    email: string;
    serverUrl: string;
    authServerUrl: string;
}

/** Payload of the `rapidmx://sign-in-error` event, emitted by the Rust deep-link handler
 * (`src-tauri/src/deep_link.rs`) when the OAuth callback fails verification or the token/session
 * exchange itself fails (see `oauth::mod.rs`'s `complete_sign_in`). */
export interface SignInErrorPayload {
    message: string;
}

const EVENT_ACCOUNT_ADDED = "rapidmx://account-added";
const EVENT_SIGN_IN_ERROR = "rapidmx://sign-in-error";

/** Calls the `resolve_server` command - DNS TXT lookup (`_rapidmx.<domain>`) plus a
 * `.well-known/rapidmx/server-info` fetch, both done in Rust (never from the webview - a plain
 * browser fetch can't do a DNS TXT lookup at all, see `federation/dns.rs`'s doc comment). */
export function resolveServer(email: string): Promise<ServerInfo> {
    return invoke<ServerInfo>("resolve_server", { email });
}

/**
 * Calls the `add_account` command, which:
 * 1. registers a pending PKCE verifier/state pair (`oauth::mod.rs`),
 * 2. opens the system browser to `${authServerUrl}/oauth/authorize` via the `opener` plugin,
 * 3. returns immediately (does NOT wait for sign-in to complete).
 *
 * Completion arrives later as a `rapidmx://account-added` (success) or `rapidmx://sign-in-error`
 * (failure) event, once the OS routes the `rapidmx://auth/callback` deep link back into this app
 * and the Rust deep-link handler finishes the code/token/session-token exchange - see
 * `onAccountAdded`/`onSignInError` below and this repo's README for the full flow.
 */
export function addAccount(email: string, serverUrl: string, authServerUrl: string, label?: string): Promise<void> {
    return invoke<void>("add_account", { email, serverUrl, authServerUrl, label: label ?? null });
}

/** Calls the `list_accounts` command - every account persisted in the app-data account store
 * (`src-tauri/src/accounts/store.rs`), regardless of whether its refresh token is still valid. */
export function listAccounts(): Promise<AccountSummary[]> {
    return invoke<AccountSummary[]>("list_accounts");
}

/** Calls the `remove_account` command - deletes the account record and its keychain entry (see
 * `accounts::mod.rs::remove_account`). Does not attempt to revoke the token server-side; auth-server
 * has no such endpoint documented yet (see this repo's README's "Known gaps" section). */
export function removeAccount(accountId: string): Promise<void> {
    return invoke<void>("remove_account", { accountId });
}

/** Subscribes to `rapidmx://account-added`, fired once per successful `add_account` sign-in. Returns
 * the same `UnlistenFn` `@tauri-apps/api/event`'s own `listen()` returns. */
export function onAccountAdded(handler: (account: AccountSummary) => void): Promise<UnlistenFn> {
    return listen<AccountSummary>(EVENT_ACCOUNT_ADDED, (event) => handler(event.payload));
}

/** Subscribes to `rapidmx://sign-in-error`, fired when a pending `add_account` sign-in fails at any
 * step (state mismatch, token exchange, session-token exchange). */
export function onSignInError(handler: (payload: SignInErrorPayload) => void): Promise<UnlistenFn> {
    return listen<SignInErrorPayload>(EVENT_SIGN_IN_ERROR, (event) => handler(event.payload));
}

/**
 * Calls the `get_session_token` command - a fresh session JWT for `accountId`, transparently doing
 * a real OAuth refresh-token grant plus the `/oauth/session-token` exchange server-side
 * (`oauth::refresh_session_token`). This is exactly the `getAccessToken` callback every account's
 * `@rapidmx/react-shared` `ApiClient` needs (see `src/lib/apiClients.ts`) - that library calls it
 * fresh before every single request, so this never caches anything on the JS side either.
 */
export function getSessionToken(accountId: string): Promise<string> {
    return invoke<string>("get_session_token", { accountId });
}

/** Mirrors `search::schema::LocalIndexEntity` (`src-tauri/src/search/schema.rs`) - one indexable
 * row of the native Tier 2 local search index. */
export interface LocalIndexEntity {
    entityType: string;
    entityUid: string;
    mailboxUid: string;
    folderUid?: string;
    dateForSort: string;
    participants: string;
    flags: string;
    hasAttachments: boolean;
    subject?: string;
    body?: string;
    attachmentText?: string;
    byteSize: number;
    entityVersion?: string;
}

/** Mirrors `search::schema::LocalSearchPredicateFields`. */
export interface LocalSearchPredicateFields {
    from?: string;
    to?: string;
    cc?: string;
    subject?: string;
    hasAttachment?: boolean;
    before?: string;
    after?: string;
    folderUid?: string;
    flags?: string[];
    text?: string;
}

/** Mirrors `search::IndexEntitiesResult`. */
export interface LocalIndexEntitiesResult {
    indexed: number;
}

/** Mirrors `search::Coverage`. */
export interface LocalIndexCoverage {
    entityCount: number;
}

/** Mirrors `search::LocalSearchHit`/`LocalSearchPage`. */
export interface LocalSearchHit {
    entityUid: string;
    rank: number;
}

export interface LocalIndexSearchPage {
    hits: LocalSearchHit[];
}

/**
 * Thin, typed `invoke()` wrappers around the native Tier 2 local search commands
 * (`src-tauri/src/search/commands.rs`), one per Rust command - used only by `src/lib/searchTransport.ts`'s
 * `LocalIndexTransport` adapter, never called directly by UI code (mirroring how `resolveServer`/
 * `addAccount`/etc. above are the only thing `App.tsx` calls, never a raw `invoke()`).
 */
export const searchCommands = {
    /** Calls `search_local_init`. `masterKeyBase64` is standard-base64-encoded key material - see
     * `search/key.rs`'s own doc comment and `src/lib/searchTransport.ts`'s doc comment for why what
     * this adapter actually passes here is not quite what that Rust module's own naming implies. */
    init(accountId: string, masterKeyBase64: string): Promise<void> {
        return invoke<void>("search_local_init", { accountId, masterKeyBase64 });
    },
    indexEntities(accountId: string, entities: LocalIndexEntity[]): Promise<LocalIndexEntitiesResult> {
        return invoke<LocalIndexEntitiesResult>("search_local_index_entities", { accountId, entities });
    },
    removeEntity(accountId: string, entityUid: string): Promise<void> {
        return invoke<void>("search_local_remove_entity", { accountId, entityUid });
    },
    search(
        accountId: string,
        mailboxUid: string,
        parsed: LocalSearchPredicateFields,
        limit: number,
        offset?: number
    ): Promise<LocalIndexSearchPage> {
        return invoke<LocalIndexSearchPage>("search_local_search", { accountId, mailboxUid, parsed, limit, offset: offset ?? null });
    },
    getCoverage(accountId: string, mailboxUid: string): Promise<LocalIndexCoverage> {
        return invoke<LocalIndexCoverage>("search_local_get_coverage", { accountId, mailboxUid });
    },
    destroy(accountId: string): Promise<boolean> {
        return invoke<boolean>("search_local_destroy", { accountId });
    },
    destroyAll(): Promise<boolean> {
        return invoke<boolean>("search_local_destroy_all", {});
    },
};
