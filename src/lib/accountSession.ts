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
 * the navigation to it. It destroys only the account's keys, then its local indexes (the multi-account
 * transport in `searchTransport.ts` scopes the wipe while other accounts are signed in), and reports the
 * sign-out here, where `App.tsx` removes the account and reloads. The navigation to auth-server is also
 * refused on the Rust side (`src-tauri/src/navigation.rs`).
 */
import { destroyUnlockedKeys, personalSessions } from "@rapidmx/web-client/lib/crypto/keySession.js";
import { accountMailboxes, resolveMailboxAccount } from "./mailboxRegistry.js";

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

/**
 * The `signOutHost` for `accountId`'s shell.
 *
 * `destroyKeys` destroys every mailbox's unlocked keys while it is the only account signed in. With
 * others, it destroys those of the mailboxes registered to it (`mailboxRegistry.ts`; a mailbox is
 * registered when this account opens, lists or unlocks it) and of every mailbox unlocked with its own
 * keys that no account is registered for, since it can't be shown to be another account's. A shared
 * mailbox opened with one of those keys goes with it (`destroyUnlockedKeys()`).
 *
 * `finish` destroys the local indexes through web-client's `destroyAllLocalIndexes()`, which the
 * installed multi-account transport scopes to this account, and then reports the sign-out
 * (`onShellSignOut()`) even when that failed, so the account is removed either way. Never rejects.
 */
export function createShellSignOutHost(accountId: string, signedInAccountCount: () => number): ShellSignOutHost {
    return {
        destroyKeys(): void {
            if (signedInAccountCount() <= 1) {
                destroyUnlockedKeys();
                return;
            }
            const mailboxUids = new Set(accountMailboxes(accountId));
            for (const { mailboxUid } of personalSessions()) {
                const owner = resolveMailboxAccount(mailboxUid);
                if (owner === undefined || owner === accountId) {
                    mailboxUids.add(mailboxUid);
                }
            }
            for (const mailboxUid of mailboxUids) {
                destroyUnlockedKeys(mailboxUid);
            }
        },
        async finish(): Promise<void> {
            try {
                const { destroyAllLocalIndexes } = await import("@rapidmx/web-client/shared/search/localIndexRpcClient.js");
                await destroyAllLocalIndexes();
            } catch (err) {
                console.warn("[rapidmx] Could not destroy the signed-out account's local indexes:", err);
            }
            notifyShellSignOut(accountId);
        },
    };
}
