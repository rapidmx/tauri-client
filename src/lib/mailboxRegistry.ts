///////////////////////////////////////////////////////////////////////////////
// Copyright (C) 2026 Jean-Philippe Steinmetz
// SPDX-License-Identifier: MPL-2.0
///////////////////////////////////////////////////////////////////////////////
/**
 * Maps a mailbox uid back to the account id that owns it - what `src/lib/searchTransport.ts`'s
 * `createNativeSearchTransport()` needs (the real `LocalIndexTransport` interface keys every method
 * by `mailboxUid` alone, never `accountId`; the Rust side is scoped by account id, see that module's
 * own doc comment).
 *
 * **Nothing in this repo populates this registry yet.** This pass has no mailbox-listing UI at all
 * (see `.claude/NOTES.md`) - a future pass wiring real Mail UI should call
 * `registerMailboxAccount(mailboxUid, accountId)` once it learns an account's mailbox uids (e.g. from
 * `GET /mail/mailboxes` on that account's `ApiClient`), typically right after that account's
 * `ApiClient` is created (`src/lib/apiClients.ts`'s `syncApiClients()`). Until then,
 * `resolveMailboxAccount()` returns `undefined` for every mailbox, and the native search transport's
 * methods reject clearly rather than silently doing nothing - see `searchTransport.ts`'s
 * `accountIdFor()`.
 */

const mailboxToAccount = new Map<string, string>();

/** Records that `mailboxUid` belongs to `accountId`, overwriting any previous owner. */
export function registerMailboxAccount(mailboxUid: string, accountId: string): void {
    mailboxToAccount.set(mailboxUid, accountId);
}

/** Forgets every mailbox `accountId` owns - call when an account is removed (`removeAccount()`), so
 * a stale mapping never resolves to an account whose keychain entry and store record are already
 * gone. */
export function unregisterAccountMailboxes(accountId: string): void {
    for (const [mailboxUid, owner] of mailboxToAccount) {
        if (owner === accountId) {
            mailboxToAccount.delete(mailboxUid);
        }
    }
}

/** The account id `mailboxUid` was last registered under, or `undefined` if it never was. */
export function resolveMailboxAccount(mailboxUid: string): string | undefined {
    return mailboxToAccount.get(mailboxUid);
}

/** Test-only escape hatch - see `apiClients.ts`'s identically-shaped `__resetApiClientsForTests()`. */
export function __resetMailboxRegistryForTests(): void {
    mailboxToAccount.clear();
}
