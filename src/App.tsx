///////////////////////////////////////////////////////////////////////////////
// Copyright (C) 2026 Jean-Philippe Steinmetz
// SPDX-License-Identifier: MPL-2.0
///////////////////////////////////////////////////////////////////////////////
/**
 * The real (if simple - see `.claude/NOTES.md`) account-switcher shell: a sidebar of every signed-in
 * account (click one to make it active), an "Add account" form, and, for whichever account is
 * active, `@rapidmx/web-client`'s real `apps/www` pages mounted client-side via `@rapidrest/react`'s
 * `mountRouter()` (`src/lib/routes.ts`'s `wwwRoutes`/`loadWwwShell()`) - the multi-account,
 * multi-server experience this whole app exists for, replacing the single-page, no-router
 * placeholder the previous pass shipped (see that file's own prior revision history).
 *
 * `window.rapidmx` (`src/lib/rapidmxShim.ts`) is kept pointed at whichever account is active
 * (`setActiveAccountConfig()`), and each signed-in account gets one live `ApiClient`
 * (`src/lib/apiClients.ts`) whose `getAccessToken` transparently refreshes through the Rust side -
 * both per this task's own design section.
 *
 * The `#app-mount` container is `key`ed by the active account's id: switching accounts changes the
 * key, so React discards and recreates the DOM node itself rather than reusing one `mountRouter()`
 * already called `createRoot()` on - `ReactDOMClient.createRoot()` on an already-rendered container
 * is a hard error otherwise. A fresh node every switch also means a fresh `Router` instance, so one
 * account's navigation history/scroll state is never carried into another's.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { mountRouter } from "@rapidrest/react/client";
import { openUrl } from "@tauri-apps/plugin-opener";
import { getApiClient, syncApiClients } from "./lib/apiClients.js";
import { unregisterAccountMailboxes } from "./lib/mailboxRegistry.js";
import { setActiveAccountConfig } from "./lib/rapidmxShim.js";
import { loadWwwShell, wwwRoutes } from "./lib/routes.js";
import { resolveWwwShellProps } from "./lib/shellProps.js";
import {
    addAccount,
    listAccounts,
    onAccountAdded,
    onSignInError,
    removeAccount,
    resolveServer,
    type AccountSummary,
} from "./lib/tauri.js";

/** Element id `mountRouter({ rootId })` mounts into - must match the `<main id="...">` below. */
const APP_MOUNT_ID = "app-mount";

export function App(): React.JSX.Element {
    const [accounts, setAccounts] = useState<AccountSummary[]>([]);
    const [activeAccountId, setActiveAccountId] = useState<string | undefined>(undefined);
    const [email, setEmail] = useState("");
    const [status, setStatus] = useState<{ message: string; tone: "info" | "error" } | undefined>(undefined);
    const [pending, setPending] = useState(false);
    // Guards against a `mountRouter()` call that resolves after a *different* account has since
    // become active (a slow `resolveProps` branding fetch, say) from overwriting the newer mount.
    const mountToken = useRef(0);

    useEffect(() => {
        let cancelled = false;
        listAccounts()
            .then((loaded) => {
                if (!cancelled) {
                    setAccounts(loaded);
                }
            })
            .catch((err: unknown) => {
                if (!cancelled) {
                    setStatus({ message: describeError(err), tone: "error" });
                }
            });
        return () => {
            cancelled = true;
        };
    }, []);

    useEffect(() => {
        const unlistenAdded = onAccountAdded((account) => {
            setAccounts((current) => [...current.filter((existing) => existing.id !== account.id), account]);
            setStatus({ message: `Signed in as ${account.email}.`, tone: "info" });
            setPending(false);
            setActiveAccountId((current) => current ?? account.id);
        });
        const unlistenError = onSignInError((payload) => {
            setStatus({ message: payload.message, tone: "error" });
            setPending(false);
        });
        return () => {
            void unlistenAdded.then((unlisten) => unlisten());
            void unlistenError.then((unlisten) => unlisten());
        };
    }, []);

    // Keeps the live `ApiClient` map in sync with the account list, and picks a default active
    // account (the first one) once accounts exist and nothing is active yet - e.g. on first load,
    // before any "Add account"/sign-in event has happened this session.
    useEffect(() => {
        syncApiClients(accounts);
        setActiveAccountId((current) => {
            if (current && accounts.some((account) => account.id === current)) {
                return current;
            }
            return accounts[0]?.id;
        });
    }, [accounts]);

    const activeAccount = accounts.find((account) => account.id === activeAccountId);

    // Points `window.rapidmx` at the active account and mounts its `apps/www` pages - see this
    // file's own doc comment for why the container is `key`ed by account id rather than reused.
    useEffect(() => {
        if (!activeAccount) {
            setActiveAccountConfig(undefined);
            return;
        }
        setActiveAccountConfig({ serverUrl: activeAccount.serverUrl, authServerUrl: activeAccount.authServerUrl });

        const token = ++mountToken.current;
        const account = activeAccount;
        void (async () => {
            const shell = await loadWwwShell();
            if (mountToken.current !== token) {
                return;
            }
            await mountRouter(wwwRoutes, {
                rootId: APP_MOUNT_ID,
                shell,
                resolveProps: () => resolveWwwShellProps(account, getApiClient(account.id)),
            });
        })();
    }, [activeAccount]);

    const handleAddAccount = useCallback(
        (event: React.FormEvent<HTMLFormElement>) => {
            event.preventDefault();
            const trimmedEmail = email.trim();
            if (!trimmedEmail) {
                setStatus({ message: "Enter an email address first.", tone: "error" });
                return;
            }
            setPending(true);
            setStatus({ message: `Looking up ${trimmedEmail}'s RapidMX server...`, tone: "info" });
            resolveServer(trimmedEmail)
                .then((serverInfo) =>
                    addAccount(trimmedEmail, serverInfo.serverUrl, serverInfo.authServerUrl).then(() => {
                        setStatus({ message: "Continue signing in in your browser...", tone: "info" });
                    })
                )
                .catch((err: unknown) => {
                    setStatus({ message: describeError(err), tone: "error" });
                    setPending(false);
                });
        },
        [email]
    );

    const handleRemoveAccount = useCallback((accountId: string) => {
        removeAccount(accountId)
            .then(() => {
                unregisterAccountMailboxes(accountId);
                setAccounts((current) => current.filter((account) => account.id !== accountId));
            })
            .catch((err: unknown) => {
                setStatus({ message: describeError(err), tone: "error" });
            });
    }, []);

    // Only ever rendered (see the "Consoles" section below) while `activeAccount` is set, so this
    // reads it without its own re-check - a real `undefined` here would be a rendering bug, not a
    // reachable runtime state worth a defensive branch.
    const handleOpenConsole = useCallback(
        (path: "admin" | "escrow") => {
            void openUrl(`${activeAccount!.serverUrl.replace(/\/$/, "")}/${path}`).catch((err: unknown) => {
                setStatus({ message: describeError(err), tone: "error" });
            });
        },
        [activeAccount]
    );

    return (
        <div className="app-shell">
            <aside className="account-sidebar">
                <h1>RapidMX</h1>
                <section>
                    <h2>Accounts</h2>
                    {accounts.length === 0 ? (
                        <p>No accounts signed in yet.</p>
                    ) : (
                        <ul className="account-list">
                            {accounts.map((account) => (
                                <li key={account.id} className={account.id === activeAccountId ? "active" : undefined}>
                                    <button
                                        type="button"
                                        className="account-select"
                                        aria-pressed={account.id === activeAccountId}
                                        onClick={() => setActiveAccountId(account.id)}
                                    >
                                        {account.label} &mdash; {account.email}
                                    </button>
                                    <button type="button" onClick={() => handleRemoveAccount(account.id)}>
                                        Remove
                                    </button>
                                </li>
                            ))}
                        </ul>
                    )}
                </section>
                <section>
                    <h2>Add account</h2>
                    <form className="add-account-form" onSubmit={handleAddAccount}>
                        <input
                            type="email"
                            placeholder="you@example.com"
                            value={email}
                            disabled={pending}
                            onChange={(event) => setEmail(event.target.value)}
                            aria-label="Email address"
                        />
                        <button type="submit" disabled={pending}>
                            Sign in
                        </button>
                    </form>
                </section>
                {activeAccount && (
                    <section>
                        <h2>Consoles</h2>
                        <p>Admin and escrow consoles open in your system browser, not in this app.</p>
                        <button type="button" onClick={() => handleOpenConsole("admin")}>
                            Open admin console
                        </button>
                        <button type="button" onClick={() => handleOpenConsole("escrow")}>
                            Open escrow console
                        </button>
                    </section>
                )}
                <p className="status-message" data-tone={status?.tone} role="status">
                    {status?.message}
                </p>
            </aside>
            <main id={APP_MOUNT_ID} key={activeAccountId ?? "no-account"} className="app-mount" />
        </div>
    );
}

function describeError(err: unknown): string {
    return err instanceof Error ? err.message : String(err);
}
