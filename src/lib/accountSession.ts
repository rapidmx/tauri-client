///////////////////////////////////////////////////////////////////////////////
// Copyright (C) 2026 Jean-Philippe Steinmetz
// SPDX-License-Identifier: MPL-2.0
///////////////////////////////////////////////////////////////////////////////
/**
 * Which account's `apps/www` shell is on screen, and the one event web-client's shell has no host hook
 * for: its "Sign out".
 *
 * web-client's `AppShell.handleSignOut()` assumes one user per origin: it destroys every local search
 * index on the device (`destroyAllLocalIndexes()`), posts a cookie logout to auth-server and navigates
 * the page to auth-server. Here every account shares this webview, the Rust side holds the account's
 * refresh token, and that navigation is refused (`src-tauri/src/navigation.rs`). The local-index
 * transport `createMultiAccountWorkerTransport()` (`searchTransport.ts`) sees the shell's
 * `destroyAll` - which only a sign-out calls - scopes it to the active account while others are signed
 * in, and then reports the sign-out here; `App.tsx` listens and removes that account.
 */

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
