///////////////////////////////////////////////////////////////////////////////
// Copyright (C) 2026 Jean-Philippe Steinmetz
// SPDX-License-Identifier: MPL-2.0
///////////////////////////////////////////////////////////////////////////////
/**
 * Maps a mailbox uid back to the accounts that reach it - what `src/lib/searchTransport.ts`'s
 * `createNativeSearchTransport()` needs (the real `LocalIndexTransport` interface keys every method
 * by `mailboxUid` alone, never `accountId`; the Rust side is scoped by account id, see that module's
 * own doc comment), and what a sign-out needs to destroy only the signing-out account's keys and local
 * indexes while other accounts share this webview's storage.
 *
 * `createMultiAccountWorkerTransport()` (`searchTransport.ts`) registers every mailbox the active
 * account opens a local index for or lists as accessible, and `registerUnlockedMailboxes()` every mailbox
 * it unlocks. A mailbox can be registered to several accounts (an owner and a delegate signed in side by
 * side both list it), and the account that unlocked it with its own keys is recorded as well
 * (`recordPersonalUnlock()`). A sign-out takes a mailbox's keys and index with it only when
 * `releasedBySignOut()` says so: this account unlocked it, or no other signed-in account still reaches it.
 * The map is kept in `localStorage` (mailbox and account ids only), so a sign-out also finds the indexes an
 * account built in an earlier session. Storage that is blocked or unreadable only makes this an in-memory
 * map for the session.
 */

/** The `localStorage` key the map is kept under, as a JSON object of mailbox uid to
 * `{ accounts: string[], unlockedBy?: string }` (an earlier build stored one account id string, still read). */
export const MAILBOX_ACCOUNTS_KEY = "rapidmx:mailbox-accounts";

interface MailboxEntry {
    /** Every account that opened, listed or unlocked the mailbox, the first registered first. */
    accounts: string[];
    /** The account that last unlocked the mailbox with its own keys (not a shared session); one of `accounts`. */
    unlockedBy?: string;
}

let registry: Map<string, MailboxEntry> | undefined;

function parseEntry(stored: unknown): MailboxEntry | undefined {
    if (typeof stored === "string") {
        return { accounts: [stored] };
    }
    if (typeof stored !== "object" || stored === null) {
        return undefined;
    }
    const { accounts, unlockedBy } = stored as { accounts?: unknown; unlockedBy?: unknown };
    const ids = Array.isArray(accounts) ? accounts.filter((id): id is string => typeof id === "string") : [];
    if (ids.length === 0) {
        return undefined;
    }
    return typeof unlockedBy === "string" && ids.includes(unlockedBy) ? { accounts: ids, unlockedBy } : { accounts: ids };
}

function load(): Map<string, MailboxEntry> {
    if (!registry) {
        registry = new Map();
        try {
            const stored: unknown = JSON.parse(localStorage.getItem(MAILBOX_ACCOUNTS_KEY) ?? "{}");
            const entries = typeof stored === "object" && stored !== null ? Object.entries(stored) : [];
            for (const [mailboxUid, value] of entries) {
                const entry = parseEntry(value);
                if (entry) {
                    registry.set(mailboxUid, entry);
                }
            }
        } catch {
            // Unreadable or blocked storage: start empty.
        }
    }
    return registry;
}

function save(map: Map<string, MailboxEntry>): void {
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

/** Records that `accountId` reaches `mailboxUid`, alongside any account already registered for it. */
export function registerMailboxAccount(mailboxUid: string, accountId: string): void {
    const map = load();
    const entry = map.get(mailboxUid);
    if (!entry) {
        map.set(mailboxUid, { accounts: [accountId] });
    } else if (!entry.accounts.includes(accountId)) {
        entry.accounts.push(accountId);
    } else {
        return;
    }
    save(map);
}

/** Records that `accountId` unlocked `mailboxUid` with its own keys, registering the mailbox to it as well,
 * so its sign-out destroys that mailbox's keys and index even while another account reaches it. */
export function recordPersonalUnlock(mailboxUid: string, accountId: string): void {
    registerMailboxAccount(mailboxUid, accountId);
    const map = load();
    const entry = map.get(mailboxUid)!;
    if (entry.unlockedBy !== accountId) {
        entry.unlockedBy = accountId;
        save(map);
    }
}

/** Forgets every registration of `accountId` - call when an account is removed (`removeAccount()`), so
 * a stale mapping never resolves to an account whose keychain entry and store record are already
 * gone. A mailbox no other account is registered for is dropped. */
export function unregisterAccountMailboxes(accountId: string): void {
    const map = load();
    for (const [mailboxUid, entry] of map) {
        entry.accounts = entry.accounts.filter((id) => id !== accountId);
        if (entry.unlockedBy === accountId) {
            delete entry.unlockedBy;
        }
        if (entry.accounts.length === 0) {
            map.delete(mailboxUid);
        }
    }
    save(map);
}

/** The account `mailboxUid` belongs to - the one that unlocked it with its own keys, else the first one
 * registered - or `undefined` if it never was registered. */
export function resolveMailboxAccount(mailboxUid: string): string | undefined {
    const entry = load().get(mailboxUid);
    return entry?.unlockedBy ?? entry?.accounts[0];
}

/** Every mailbox uid registered under `accountId`. */
export function accountMailboxes(accountId: string): string[] {
    return [...load()].filter(([, entry]) => entry.accounts.includes(accountId)).map(([mailboxUid]) => mailboxUid);
}

/**
 * Whether `accountId` signing out takes `mailboxUid`'s keys and local index with it: it unlocked the
 * mailbox with its own keys, or no other account still signed in (`isSignedIn`) is registered for it. A
 * mailbox registered to no account is released too, since it can't be shown to be another account's. One
 * that another signed-in account still reaches, and that this account didn't unlock, stays: the index
 * directory and the key session are per mailbox, shared by every account in this webview.
 */
export function releasedBySignOut(mailboxUid: string, accountId: string, isSignedIn: (accountId: string) => boolean): boolean {
    const entry = load().get(mailboxUid);
    if (!entry || entry.unlockedBy === accountId) {
        return true;
    }
    return !entry.accounts.some((other) => other !== accountId && isSignedIn(other));
}

/** The mailboxes registered under `accountId` that its sign-out releases (`releasedBySignOut()`). */
export function releasedAccountMailboxes(accountId: string, isSignedIn: (accountId: string) => boolean): string[] {
    return accountMailboxes(accountId).filter((mailboxUid) => releasedBySignOut(mailboxUid, accountId, isSignedIn));
}

/** Test-only escape hatch - see `apiClients.ts`'s identically-shaped `__resetApiClientsForTests()`.
 * Drops the in-memory map, so the next call reads `localStorage` again. */
export function __resetMailboxRegistryForTests(): void {
    registry = undefined;
}
