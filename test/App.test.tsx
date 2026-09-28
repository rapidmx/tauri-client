///////////////////////////////////////////////////////////////////////////////
// Copyright (C) 2026 Jean-Philippe Steinmetz
// SPDX-License-Identifier: MPL-2.0
///////////////////////////////////////////////////////////////////////////////
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AccountSummary } from "../src/lib/tauri.js";

const listAccountsMock = vi.fn();
const resolveServerMock = vi.fn();
const addAccountMock = vi.fn();
const removeAccountMock = vi.fn();
const onAccountAddedMock = vi.fn();
const onSignInErrorMock = vi.fn();

vi.mock("../src/lib/tauri.js", () => ({
    listAccounts: (...args: unknown[]) => listAccountsMock(...args),
    resolveServer: (...args: unknown[]) => resolveServerMock(...args),
    addAccount: (...args: unknown[]) => addAccountMock(...args),
    removeAccount: (...args: unknown[]) => removeAccountMock(...args),
    onAccountAdded: (...args: unknown[]) => onAccountAddedMock(...args),
    onSignInError: (...args: unknown[]) => onSignInErrorMock(...args),
}));

const syncApiClientsMock = vi.fn();
const getApiClientMock = vi.fn();
vi.mock("../src/lib/apiClients.js", () => ({
    syncApiClients: (...args: unknown[]) => syncApiClientsMock(...args),
    getApiClient: (...args: unknown[]) => getApiClientMock(...args),
}));

const unregisterAccountMailboxesMock = vi.fn();
vi.mock("../src/lib/mailboxRegistry.js", () => ({
    unregisterAccountMailboxes: (...args: unknown[]) => unregisterAccountMailboxesMock(...args),
}));

const setActiveAccountConfigMock = vi.fn();
vi.mock("../src/lib/rapidmxShim.js", () => ({
    setActiveAccountConfig: (...args: unknown[]) => setActiveAccountConfigMock(...args),
}));

const loadWwwShellMock = vi.fn();
vi.mock("../src/lib/routes.js", () => ({
    wwwRoutes: [{ template: "/", load: () => Promise.resolve({ default: () => null }) }],
    loadWwwShell: (...args: unknown[]) => loadWwwShellMock(...args),
}));

const resolveWwwShellPropsMock = vi.fn();
vi.mock("../src/lib/shellProps.js", () => ({
    resolveWwwShellProps: (...args: unknown[]) => resolveWwwShellPropsMock(...args),
}));

const mountRouterMock = vi.fn();
vi.mock("@rapidrest/react/client", () => ({
    mountRouter: (...args: unknown[]) => mountRouterMock(...args),
}));

const openUrlMock = vi.fn();
vi.mock("@tauri-apps/plugin-opener", () => ({
    openUrl: (...args: unknown[]) => openUrlMock(...args),
}));

const account: AccountSummary = {
    id: "a1",
    label: "Work",
    email: "user@example.com",
    serverUrl: "https://mail.example.com",
    authServerUrl: "https://auth.example.com",
};
const accountB: AccountSummary = {
    id: "b2",
    label: "Personal",
    email: "me@example.org",
    serverUrl: "https://mail.example.org",
    authServerUrl: "https://auth.example.org",
};

/** Captured by the two subscription mocks below, so tests can fire an event the same way the Rust
 * side would - by invoking the callback `App` registered. */
let accountAddedHandler: ((account: AccountSummary) => void) | undefined;
let signInErrorHandler: ((payload: { message: string }) => void) | undefined;

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void; reject: (err: unknown) => void } {
    let resolve!: (value: T) => void;
    let reject!: (err: unknown) => void;
    const promise = new Promise<T>((res, rej) => {
        resolve = res;
        reject = rej;
    });
    return { promise, resolve, reject };
}

beforeEach(() => {
    accountAddedHandler = undefined;
    signInErrorHandler = undefined;
    listAccountsMock.mockReset().mockResolvedValue([]);
    resolveServerMock.mockReset();
    addAccountMock.mockReset();
    removeAccountMock.mockReset();
    syncApiClientsMock.mockReset();
    getApiClientMock.mockReset().mockReturnValue(undefined);
    unregisterAccountMailboxesMock.mockReset();
    setActiveAccountConfigMock.mockReset();
    loadWwwShellMock.mockReset().mockResolvedValue(undefined);
    resolveWwwShellPropsMock.mockReset().mockResolvedValue({});
    mountRouterMock.mockReset().mockResolvedValue(undefined);
    openUrlMock.mockReset().mockResolvedValue(undefined);
    const unlistenAdded = vi.fn();
    const unlistenError = vi.fn();
    onAccountAddedMock.mockReset().mockImplementation((handler: (account: AccountSummary) => void) => {
        accountAddedHandler = handler;
        return Promise.resolve(unlistenAdded);
    });
    onSignInErrorMock.mockReset().mockImplementation((handler: (payload: { message: string }) => void) => {
        signInErrorHandler = handler;
        return Promise.resolve(unlistenError);
    });
});

describe("App", () => {
    it("renders 'no accounts' when none are stored", async () => {
        const { App } = await import("../src/App.js");
        render(<App />);
        expect(await screen.findByText("No accounts signed in yet.")).toBeInTheDocument();
        // No active account: the shim is cleared, nothing is mounted, and there's no console section.
        await waitFor(() => expect(setActiveAccountConfigMock).toHaveBeenCalledWith(undefined));
        expect(mountRouterMock).not.toHaveBeenCalled();
        expect(screen.queryByText("Open admin console")).not.toBeInTheDocument();
    });

    it("loads accounts already on disk, activates the first one, and mounts its pages", async () => {
        listAccountsMock.mockResolvedValue([account]);
        const { App } = await import("../src/App.js");
        render(<App />);
        expect(await screen.findByText(/Work.*user@example.com/)).toBeInTheDocument();
        await waitFor(() => expect(syncApiClientsMock).toHaveBeenCalledWith([account]));
        await waitFor(() =>
            expect(setActiveAccountConfigMock).toHaveBeenCalledWith({
                serverUrl: account.serverUrl,
                authServerUrl: account.authServerUrl,
            })
        );
        await waitFor(() => expect(mountRouterMock).toHaveBeenCalledTimes(1));
        const options = mountRouterMock.mock.calls[0][1] as { rootId: string; resolveProps: () => Promise<unknown> };
        expect(options.rootId).toBe("app-mount");
        expect(screen.getByRole("button", { name: /Work.*user@example.com/ })).toHaveAttribute("aria-pressed", "true");
    });

    it("resolveProps fetches shell data through the active account's own ApiClient", async () => {
        listAccountsMock.mockResolvedValue([account]);
        const fakeClient = { fetch: vi.fn(), setUnauthorizedObserver: vi.fn() };
        getApiClientMock.mockReturnValue(fakeClient);
        const { App } = await import("../src/App.js");
        render(<App />);
        await waitFor(() => expect(mountRouterMock).toHaveBeenCalledTimes(1));
        const options = mountRouterMock.mock.calls[0][1] as { resolveProps: () => Promise<unknown> };
        await options.resolveProps();
        expect(getApiClientMock).toHaveBeenCalledWith("a1");
        expect(resolveWwwShellPropsMock).toHaveBeenCalledWith(account, fakeClient);
    });

    it("shows an error status when loading accounts fails", async () => {
        listAccountsMock.mockRejectedValue(new Error("disk unavailable"));
        const { App } = await import("../src/App.js");
        render(<App />);
        expect(await screen.findByRole("status")).toHaveTextContent("disk unavailable");
    });

    it("does not update state after unmount when listAccounts resolves late", async () => {
        const { promise, resolve } = deferred<AccountSummary[]>();
        listAccountsMock.mockReturnValue(promise);
        const { App } = await import("../src/App.js");
        const { unmount } = render(<App />);
        unmount();
        await act(async () => {
            resolve([account]);
            await promise;
        });
    });

    it("does not update state after unmount when listAccounts rejects late", async () => {
        const { promise, reject } = deferred<AccountSummary[]>();
        listAccountsMock.mockReturnValue(promise);
        const { App } = await import("../src/App.js");
        const { unmount } = render(<App />);
        unmount();
        await act(async () => {
            reject(new Error("too late"));
            await promise.catch(() => undefined);
        });
    });

    it("validates that an email was entered before resolving", async () => {
        const { App } = await import("../src/App.js");
        render(<App />);
        fireEvent.submit(screen.getByRole("button", { name: "Sign in" }).closest("form")!);
        expect(await screen.findByRole("status")).toHaveTextContent("Enter an email address first.");
        expect(resolveServerMock).not.toHaveBeenCalled();
    });

    it("resolves the server and starts sign-in on submit", async () => {
        resolveServerMock.mockResolvedValue({ serverUrl: "https://mail.example.com", authServerUrl: "https://auth.example.com" });
        addAccountMock.mockResolvedValue(undefined);
        const { App } = await import("../src/App.js");
        render(<App />);
        fireEvent.change(screen.getByLabelText("Email address"), { target: { value: "user@example.com" } });
        fireEvent.click(screen.getByRole("button", { name: "Sign in" }));
        await waitFor(() => expect(addAccountMock).toHaveBeenCalledWith("user@example.com", "https://mail.example.com", "https://auth.example.com"));
        expect(await screen.findByRole("status")).toHaveTextContent("Continue signing in in your browser...");
    });

    it("shows an error status when resolveServer fails", async () => {
        resolveServerMock.mockRejectedValue(new Error("no _rapidmx TXT record"));
        const { App } = await import("../src/App.js");
        render(<App />);
        fireEvent.change(screen.getByLabelText("Email address"), { target: { value: "user@example.com" } });
        fireEvent.click(screen.getByRole("button", { name: "Sign in" }));
        expect(await screen.findByRole("status")).toHaveTextContent("no _rapidmx TXT record");
    });

    it("shows an error status when addAccount fails", async () => {
        resolveServerMock.mockResolvedValue({ serverUrl: "https://mail.example.com", authServerUrl: "https://auth.example.com" });
        addAccountMock.mockRejectedValue("opener plugin unavailable");
        const { App } = await import("../src/App.js");
        render(<App />);
        fireEvent.change(screen.getByLabelText("Email address"), { target: { value: "user@example.com" } });
        fireEvent.click(screen.getByRole("button", { name: "Sign in" }));
        expect(await screen.findByRole("status")).toHaveTextContent("opener plugin unavailable");
    });

    it("adds the account, activates it (none was active) and shows a success status", async () => {
        const { App } = await import("../src/App.js");
        render(<App />);
        await waitFor(() => expect(accountAddedHandler).toBeDefined());
        act(() => accountAddedHandler!(account));
        expect(await screen.findByText(/Work.*user@example.com/)).toBeInTheDocument();
        expect(screen.getByRole("status")).toHaveTextContent("Signed in as user@example.com.");
        expect(screen.getByRole("button", { name: /Work.*user@example.com/ })).toHaveAttribute("aria-pressed", "true");
    });

    it("a second account-added event does not steal activation from the first", async () => {
        const { App } = await import("../src/App.js");
        render(<App />);
        await waitFor(() => expect(accountAddedHandler).toBeDefined());
        act(() => accountAddedHandler!(account));
        await screen.findByText(/Work.*user@example.com/);
        act(() => accountAddedHandler!(accountB));
        await screen.findByText(/Personal.*me@example.org/);
        expect(screen.getByRole("button", { name: /Work.*user@example.com/ })).toHaveAttribute("aria-pressed", "true");
        expect(screen.getByRole("button", { name: /Personal.*me@example.org/ })).toHaveAttribute("aria-pressed", "false");
    });

    it("replaces an existing account with the same id instead of duplicating it", async () => {
        listAccountsMock.mockResolvedValue([account]);
        const { App } = await import("../src/App.js");
        render(<App />);
        await screen.findByText(/Work.*user@example.com/);
        await waitFor(() => expect(accountAddedHandler).toBeDefined());
        act(() => accountAddedHandler!({ ...account, label: "Work (renamed)" }));
        expect(await screen.findByText(/Work \(renamed\).*user@example.com/)).toBeInTheDocument();
        expect(screen.queryAllByRole("listitem")).toHaveLength(1);
    });

    it("shows an error status when the sign-in-error event arrives", async () => {
        const { App } = await import("../src/App.js");
        render(<App />);
        await waitFor(() => expect(signInErrorHandler).toBeDefined());
        act(() => signInErrorHandler!({ message: "state mismatch" }));
        expect(await screen.findByRole("status")).toHaveTextContent("state mismatch");
    });

    it("removes an account and forgets its mailbox registrations", async () => {
        listAccountsMock.mockResolvedValue([account]);
        removeAccountMock.mockResolvedValue(undefined);
        const { App } = await import("../src/App.js");
        render(<App />);
        await screen.findByText(/Work.*user@example.com/);
        fireEvent.click(screen.getByRole("button", { name: "Remove" }));
        expect(await screen.findByText("No accounts signed in yet.")).toBeInTheDocument();
        expect(removeAccountMock).toHaveBeenCalledWith("a1");
        expect(unregisterAccountMailboxesMock).toHaveBeenCalledWith("a1");
    });

    it("shows an error status when removing an account fails", async () => {
        listAccountsMock.mockResolvedValue([account]);
        removeAccountMock.mockRejectedValue(new Error("keychain locked"));
        const { App } = await import("../src/App.js");
        render(<App />);
        await screen.findByText(/Work.*user@example.com/);
        fireEvent.click(screen.getByRole("button", { name: "Remove" }));
        expect(await screen.findByRole("status")).toHaveTextContent("keychain locked");
    });

    it("unsubscribes both event listeners on unmount", async () => {
        const { App } = await import("../src/App.js");
        const { unmount } = render(<App />);
        await waitFor(() => expect(accountAddedHandler).toBeDefined());
        const addedUnlisten = await onAccountAddedMock.mock.results[0].value;
        const errorUnlisten = await onSignInErrorMock.mock.results[0].value;
        unmount();
        await waitFor(() => expect(addedUnlisten).toHaveBeenCalled());
        expect(errorUnlisten).toHaveBeenCalled();
    });

    it("switches the active account when another one is selected", async () => {
        listAccountsMock.mockResolvedValue([account, accountB]);
        const { App } = await import("../src/App.js");
        render(<App />);
        await screen.findByText(/Work.*user@example.com/);
        await waitFor(() => expect(mountRouterMock).toHaveBeenCalledTimes(1));

        fireEvent.click(screen.getByRole("button", { name: /Personal.*me@example.org/ }));

        await waitFor(() =>
            expect(setActiveAccountConfigMock).toHaveBeenCalledWith({
                serverUrl: accountB.serverUrl,
                authServerUrl: accountB.authServerUrl,
            })
        );
        expect(screen.getByRole("button", { name: /Personal.*me@example.org/ })).toHaveAttribute("aria-pressed", "true");
        expect(screen.getByRole("button", { name: /Work.*user@example.com/ })).toHaveAttribute("aria-pressed", "false");
        await waitFor(() => expect(mountRouterMock).toHaveBeenCalledTimes(2));
    });

    it("falls back to the first remaining account when the active one is removed", async () => {
        listAccountsMock.mockResolvedValue([account, accountB]);
        removeAccountMock.mockResolvedValue(undefined);
        const { App } = await import("../src/App.js");
        render(<App />);
        await screen.findByText(/Work.*user@example.com/);
        fireEvent.click(screen.getAllByRole("button", { name: "Remove" })[0]);
        await waitFor(() => expect(screen.queryByText(/Work.*user@example.com/)).not.toBeInTheDocument());
        await waitFor(() =>
            expect(screen.getByRole("button", { name: /Personal.*me@example.org/ })).toHaveAttribute("aria-pressed", "true")
        );
    });

    it("skips a stale mount from a slower, no-longer-active account load", async () => {
        listAccountsMock.mockResolvedValue([account, accountB]);
        const staleShell = deferred<undefined>();
        loadWwwShellMock.mockReturnValueOnce(staleShell.promise).mockResolvedValue(undefined);
        const { App } = await import("../src/App.js");
        render(<App />);
        await screen.findByText(/Work.*user@example.com/);
        // The first account's shell load is still pending when the user switches accounts.
        fireEvent.click(screen.getByRole("button", { name: /Personal.*me@example.org/ }));
        await waitFor(() => expect(mountRouterMock).toHaveBeenCalledTimes(1));

        // Letting the stale (first account's) load finish must not trigger a second, stale mount.
        await act(async () => {
            staleShell.resolve(undefined);
            await staleShell.promise;
        });
        expect(mountRouterMock).toHaveBeenCalledTimes(1);
    });

    it("does not render the consoles section, and clears window.rapidmx, when no account is active", async () => {
        const { App } = await import("../src/App.js");
        render(<App />);
        await screen.findByText("No accounts signed in yet.");
        expect(screen.queryByText("Open admin console")).not.toBeInTheDocument();
        expect(screen.queryByText("Open escrow console")).not.toBeInTheDocument();
    });

    it("opens the admin console in the system browser, built from the active account's server", async () => {
        listAccountsMock.mockResolvedValue([{ ...account, serverUrl: "https://mail.example.com/" }]);
        const { App } = await import("../src/App.js");
        render(<App />);
        await screen.findByText(/Work.*user@example.com/);
        fireEvent.click(await screen.findByRole("button", { name: "Open admin console" }));
        await waitFor(() => expect(openUrlMock).toHaveBeenCalledWith("https://mail.example.com/admin"));
    });

    it("opens the escrow console in the system browser", async () => {
        listAccountsMock.mockResolvedValue([account]);
        const { App } = await import("../src/App.js");
        render(<App />);
        await screen.findByText(/Work.*user@example.com/);
        fireEvent.click(await screen.findByRole("button", { name: "Open escrow console" }));
        await waitFor(() => expect(openUrlMock).toHaveBeenCalledWith("https://mail.example.com/escrow"));
    });

    it("shows an error status when opening a console fails", async () => {
        listAccountsMock.mockResolvedValue([account]);
        openUrlMock.mockRejectedValue(new Error("opener plugin unavailable"));
        const { App } = await import("../src/App.js");
        render(<App />);
        await screen.findByText(/Work.*user@example.com/);
        fireEvent.click(await screen.findByRole("button", { name: "Open admin console" }));
        expect(await screen.findByRole("status")).toHaveTextContent("opener plugin unavailable");
    });
});
