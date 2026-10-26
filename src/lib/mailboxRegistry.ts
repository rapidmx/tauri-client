///////////////////////////////////////////////////////////////////////////////
// Copyright (C) 2026 Jean-Philippe Steinmetz
// SPDX-License-Identifier: MPL-2.0
///////////////////////////////////////////////////////////////////////////////
/**
 * Maps a mailbox uid back to the account id that owns it - what `src/lib/searchTransport.ts`'s
 * `createNativeSearchTransport()` needs (the real `LocalIndexTransport` interface keys every method
 * by `mailboxUid` alone, never `accountId`; the Rust side is scoped by account id, see that module's
 * own doc comment), and what a shell's sign-out needs to destroy only the signing-out account's local
 * indexes while other accounts share this webview's storage.
 *
 * `createMultiAccountWorkerTransport()` (`searchTransport.ts`) registers every mailbox the active
 * account opens a local index for or lists as accessible, and `registerUnlockedMailboxes()` every mailbox
 * it unlocks; a sign-out destroys those mailboxes' keys and indexes. The map is kept in `localStorage` (mailbox
 * and account ids only), so a sign-out also finds the indexes an account built in an earlier session.
 * Storage that is blocked or unreadable only makes this an in-memory map for the session.
 */

/** The `localStorage` key the map is kept under, as a JSON object of mailbox uid to account id. */
export const MAILBOX_ACCOUNTS_KEY = "rapidmx:mailbox-accounts";

let mailboxToAccount: Map<string, string> | undefined;

function load(): Map<string, string> {
    if (!mailboxToAccount) {
        mailboxToAccount = new Map();
        try {
            const stored: unknown = JSON.parse(localStorage.getItem(MAILBOX_ACCOUNTS_KEY) ?? "{}");
            const entries = typeof stored === "object" && stored !== null ? Object.entries(stored) : [];
            for (const [mailboxUid, accountId] of entries) {
                if (typeof accountId === "string") {
                    mailboxToAccount.set(mailboxUid, accountId);
                }
            }
        } catch {
            // Unreadable or blocked storage: start empty.
        }
    }
    return mailboxToAccount;
}

function save(map: Map<string, string>): void {
    try {
        if (map.size === 0) {
            localStorage.removeItem(MAILBOX_ACCOUNTS_KEY);
        } else {
            localStorage.setItem(MAILBOX_ACCOUNTS_KEY, JSON.stringify(Object.fromEntries(map)));
        }
    } catch {
        // Blocked storage: the in-memory map still serves this session.
    }
}

/** Records that `mailboxUid` belongs to `accountId`, overwriting any previous owner. */
export function registerMailboxAccount(mailboxUid: string, accountId: string): void {
    const map = load();
    if (map.get(mailboxUid) !== accountId) {
        map.set(mailboxUid, accountId);
        save(map);
    }
}

/** Forgets every mailbox `accountId` owns - call when an account is removed (`removeAccount()`), so
 * a stale mapping never resolves to an account whose keychain entry and store record are already
 * gone. */
export function unregisterAccountMailboxes(accountId: string): void {
    const map = load();
    for (const [mailboxUid, owner] of map) {
        if (owner === accountId) {
            map.delete(mailboxUid);
        }
    }
    save(map);
}

/** The account id `mailboxUid` was last registered under, or `undefined` if it never was. */
export function resolveMailboxAccount(mailboxUid: string): string | undefined {
    return load().get(mailboxUid);
}

/** Every mailbox uid registered under `accountId`. */
export function accountMailboxes(accountId: string): string[] {
    return [...load()].filter(([, owner]) => owner === accountId).map(([mailboxUid]) => mailboxUid);
}

/** Test-only escape hatch - see `apiClients.ts`'s identically-shaped `__resetApiClientsForTests()`.
 * Drops the in-memory map, so the next call reads `localStorage` again. */
export function __resetMailboxRegistryForTests(): void {
    mailboxToAccount = undefined;
}
