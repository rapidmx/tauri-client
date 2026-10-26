///////////////////////////////////////////////////////////////////////////////
// Copyright (C) 2026 Jean-Philippe Steinmetz
// SPDX-License-Identifier: MPL-2.0
///////////////////////////////////////////////////////////////////////////////
import { afterEach, describe, expect, it, vi } from "vitest";

const { destroyUnlockedKeys, personalSessions, destroyAllLocalIndexes } = vi.hoisted(() => ({
    destroyUnlockedKeys: vi.fn(),
    personalSessions: vi.fn((): { mailboxUid: string }[] => []),
    destroyAllLocalIndexes: vi.fn(() => Promise.resolve(true)),
}));
vi.mock("@rapidmx/web-client/lib/crypto/keySession.js", () => ({ destroyUnlockedKeys, personalSessions }));
vi.mock("@rapidmx/web-client/shared/search/localIndexRpcClient.js", () => ({ destroyAllLocalIndexes }));

import {
    createShellSignOutHost,
    getActiveAccountId,
    notifyShellSignOut,
    onShellSignOut,
    reloadApp,
    recordActiveAccount,
} from "../../src/lib/accountSession.js";
import { __resetMailboxRegistryForTests, registerMailboxAccount } from "../../src/lib/mailboxRegistry.js";

describe("accountSession", () => {
    afterEach(() => {
        recordActiveAccount(undefined);
        vi.unstubAllGlobals();
    });

    it("tracks the active account", () => {
        expect(getActiveAccountId()).toBeUndefined();
        recordActiveAccount("a1");
        expect(getActiveAccountId()).toBe("a1");
    });

    it("tells every listener which account's shell signed out, until it unsubscribes", () => {
        const first = vi.fn();
        const second = vi.fn();
        const unsubscribe = onShellSignOut(first);
        onShellSignOut(second);
        notifyShellSignOut("a1");
        expect(first).toHaveBeenCalledWith("a1");
        expect(second).toHaveBeenCalledWith("a1");
        unsubscribe();
        notifyShellSignOut("b2");
        expect(first).toHaveBeenCalledTimes(1);
        expect(second).toHaveBeenCalledWith("b2");
    });

    it("reloads the app document", () => {
        const reload = vi.fn();
        vi.stubGlobal("location", { reload });
        reloadApp();
        expect(reload).toHaveBeenCalledTimes(1);
    });

    describe("createShellSignOutHost", () => {
        afterEach(() => {
            destroyUnlockedKeys.mockClear();
            destroyAllLocalIndexes.mockClear();
            personalSessions.mockReturnValue([]);
            localStorage.clear();
            __resetMailboxRegistryForTests();
        });

        it("destroys every mailbox's keys while it is the only account signed in", () => {
            createShellSignOutHost("a1", () => 1).destroyKeys();
            expect(destroyUnlockedKeys).toHaveBeenCalledTimes(1);
            expect(destroyUnlockedKeys).toHaveBeenCalledWith();
        });

        it("destroys only its own and unclaimed mailboxes' keys while other accounts are signed in", () => {
            registerMailboxAccount("mine", "a1");
            registerMailboxAccount("mine-unlocked", "a1");
            registerMailboxAccount("theirs", "b2");
            personalSessions.mockReturnValue([{ mailboxUid: "mine-unlocked" }, { mailboxUid: "theirs" }, { mailboxUid: "unclaimed" }]);
            createShellSignOutHost("a1", () => 2).destroyKeys();
            expect(destroyUnlockedKeys.mock.calls.map(([uid]) => uid as string).sort()).toEqual(["mine", "mine-unlocked", "unclaimed"]);
        });

        it("destroys the local indexes, then reports the sign-out, even when the destroy fails", async () => {
            const signedOut = vi.fn();
            const unsubscribe = onShellSignOut(signedOut);
            const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
            try {
                const host = createShellSignOutHost("a1", () => 2);
                await host.finish();
                expect(destroyAllLocalIndexes).toHaveBeenCalledTimes(1);
                expect(signedOut).toHaveBeenCalledWith("a1");

                destroyAllLocalIndexes.mockRejectedValueOnce(new Error("no OPFS"));
                await expect(host.finish()).resolves.toBeUndefined();
                expect(warn).toHaveBeenCalledWith("[rapidmx] Could not destroy the signed-out account's local indexes:", expect.any(Error));
                expect(signedOut).toHaveBeenCalledTimes(2);
            } finally {
                unsubscribe();
                warn.mockRestore();
            }
        });
    });
});
