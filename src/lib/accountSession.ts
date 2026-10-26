///////////////////////////////////////////////////////////////////////////////
// Copyright (C) 2026 Jean-Philippe Steinmetz
// SPDX-License-Identifier: MPL-2.0
///////////////////////////////////////////////////////////////////////////////
/**
 * Which account's `apps/www` shell is on screen, and how its "Sign out" signs out only that account.
 *
 * web-client's `AppShell` signs out on its own as if one user had the origin: it destroys every
 * mailbox's unlocked keys and every local search index on the device, posts a cookie logout to
 * auth-server and navigates the page there. Here every account shares this webview, one key session
 * and one OPFS, and the Rust side holds the account's refresh token. So each mounted shell gets a
 * `signOutHost` (`createShellSignOutHost()`, passed by `App.tsx` through the shell's props): the shell
 * keeps saving compose windows and clearing its caches, and leaves the keys, the indexes, the logout and
 * the navigation to it. It destroys only the account's keys, then its local indexes (one by one, naming the
 * account, while other accounts are signed in), and reports the sign-out here, where `App.tsx` removes the
 * account and reloads. The sidebar's "Remove" destroys the same keys and indexes (`signOutAccountLocally()`)
 * before it removes an account. The navigation to auth-server is also refused on the Rust side
 * (`src-tauri/src/navigation.rs`).
 */
import { destroyUnlockedKeys, personalSessions } from "@rapidmx/web-client/lib/crypto/keySession.js";
import { releasedAccountMailboxes, releasedBySignOut } from "./mailboxRegistry.js";
import { destroyIndexesWithin } from "./searchTransport.js";

let activeAccountId: string | undefined;
const signOutListeners = new Set<(accountId: string) => void>();

/** Records the account whose shell is mounted - called by `App.tsx` on every switch. */
export function recordActiveAccount(accountId: string | undefined): void {
    activeAccountId = accountId;
}

/** The account whose shell is mounted, if any. */
export function getActiveAccountId(): string | undefined {
    return activeAccountId;
}

/** Calls `listener` with the account id each time that account's shell signs out. Returns the unsubscribe. */
export function onShellSignOut(listener: (accountId: string) => void): () => void {
    signOutListeners.add(listener);
    return () => {
        signOutListeners.delete(listener);
    };
}

/** Reports that `accountId`'s shell signed out. */
export function notifyShellSignOut(accountId: string): void {
    for (const listener of [...signOutListeners]) {
        listener(accountId);
    }
}

/** Reloads the app document, which resets every module-level state web-client's sign-out left behind
 * (its local index client's signed-out flag, the compose "signing out" mark, the emptied key session). */
export function reloadApp(): void {
    window.location.reload();
}

/** web-client's `ShellSignOutHost` (`apps/shared/components/layout/AppShell.tsx`), restated as this app
 * restates its other web-client interfaces (see `searchTransport.ts`'s doc comment). */
export interface ShellSignOutHost {
    destroyKeys(): void;
    finish(): Promise<void>;
}

/** Whether `accountId` is the only account in `signedInAccountIds` (or none is listed). */
function onlyAccount(accountId: string, signedInAccountIds: readonly string[]): boolean {
    return signedInAccountIds.every((id) => id === accountId);
}

/**
 * Destroys `accountId`'s unlocked keys: every mailbox's while it is the only account signed in. With others,
 * those of the mailboxes its sign-out releases (`mailboxRegistry.ts` `releasedBySignOut()`): the ones
 * registered to it (a mailbox is registered when this account opens, lists or unlocks it) that it unlocked
 * with its own keys or that no other signed-in account reaches, and every mailbox unlocked with its own keys
 * that no other signed-in account is registered for, since it can't be shown to be another account's. A
 * shared mailbox opened with one of those keys goes with it (`destroyUnlockedKeys()`).
 */
export function destroyAccountKeys(accountId: string, signedInAccountIds: readonly string[]): void {
    if (onlyAccount(accountId, signedInAccountIds)) {
        destroyUnlockedKeys();
        return;
    }
    const isSignedIn = (id: string): boolean => signedInAccountIds.includes(id);
    const mailboxUids = new Set(releasedAccountMailboxes(accountId, isSignedIn));
    for (const { mailboxUid } of personalSessions()) {
        if (releasedBySignOut(mailboxUid, accountId, isSignedIn)) {
            mailboxUids.add(mailboxUid);
        }
    }
    for (const mailboxUid of mailboxUids) {
        destroyUnlockedKeys(mailboxUid);
    }
}

/**
 * Destroys `accountId`'s local indexes: every index on the device through web-client's
 * `destroyAllLocalIndexes()` while it is the only account signed in (which also stops any index opening
 * again until a reload), and otherwise the mailboxes its sign-out releases (`releasedAccountMailboxes()`),
 * each through web-client's `destroyLocalIndex()`, within `destroyAllLocalIndexes()`'s own timeout. The
 * account is named here rather than read from the active one, which a switch can change while a sign-out
 * waits on its compose windows. Never rejects.
 */
export async function destroyAccountLocalIndexes(accountId: string, signedInAccountIds: readonly string[]): Promise<void> {
    try {
        const { destroyAllLocalIndexes, destroyLocalIndex, DESTROY_ALL_TIMEOUT_MS } = await import(
            "@rapidmx/web-client/shared/search/localIndexRpcClient.js"
        );
        if (onlyAccount(accountId, signedInAccountIds)) {
            await destroyAllLocalIndexes();
            return;
        }
        const mailboxUids = releasedAccountMailboxes(accountId, (id) => signedInAccountIds.includes(id));
        await destroyIndexesWithin(mailboxUids, destroyLocalIndex, DESTROY_ALL_TIMEOUT_MS);
    } catch (err) {
        console.warn("[rapidmx] Could not destroy the signed-out account's local indexes:", err);
    }
}

/** Destroys `accountId`'s keys, then its local indexes, as its shell's sign-out does - what the sidebar's
 * "Remove" runs before removing the account. Never rejects. */
export async function signOutAccountLocally(accountId: string, signedInAccountIds: () => readonly string[]): Promise<void> {
    destroyAccountKeys(accountId, signedInAccountIds());
    await destroyAccountLocalIndexes(accountId, signedInAccountIds());
}

/**
 * The `signOutHost` for `accountId`'s shell. `destroyKeys` is `destroyAccountKeys()` and `finish`
 * `destroyAccountLocalIndexes()` for this account, with the accounts signed in at the time, followed by a
 * report of the sign-out (`onShellSignOut()`) even when the destroy failed, so the account is removed either
 * way. Never rejects.
 */
export function createShellSignOutHost(accountId: string, signedInAccountIds: () => readonly string[]): ShellSignOutHost {
    return {
        destroyKeys(): void {
            destroyAccountKeys(accountId, signedInAccountIds());
        },
        async finish(): Promise<void> {
            await destroyAccountLocalIndexes(accountId, signedInAccountIds());
            notifyShellSignOut(accountId);
        },
    };
}
