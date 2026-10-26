///////////////////////////////////////////////////////////////////////////////
// Copyright (C) 2026 Jean-Philippe Steinmetz
// SPDX-License-Identifier: MPL-2.0
///////////////////////////////////////////////////////////////////////////////
import { afterEach, describe, expect, it, vi } from "vitest";

const { destroyUnlockedKeys, personalSessions, destroyAllLocalIndexes, destroyLocalIndex } = vi.hoisted(() => ({
    destroyUnlockedKeys: vi.fn(),
    personalSessions: vi.fn((): { mailboxUid: string }[] => []),
    destroyAllLocalIndexes: vi.fn(() => Promise.resolve(true)),
    destroyLocalIndex: vi.fn((_mailboxUid: string) => Promise.resolve(true)),
}));
vi.mock("@rapidmx/web-client/lib/crypto/keySession.js", () => ({ destroyUnlockedKeys, personalSessions }));
vi.mock("@rapidmx/web-client/shared/search/localIndexRpcClient.js", () => ({
    destroyAllLocalIndexes,
    destroyLocalIndex,
    DESTROY_ALL_TIMEOUT_MS: 3000,
}));

import {
    createShellSignOutHost,
    getActiveAccountId,
    notifyShellSignOut,
    onShellSignOut,
    reloadApp,
    recordActiveAccount,
    signOutAccountLocally,
} from "../../src/lib/accountSession.js";
import { __resetMailboxRegistryForTests, recordPersonalUnlock, registerMailboxAccount } from "../../src/lib/mailboxRegistry.js";

const destroyedKeys = (): string[] => destroyUnlockedKeys.mock.calls.map(([uid]) => uid as string).sort();
const destroyedIndexes = (): string[] => destroyLocalIndex.mock.calls.map(([uid]) => uid).sort();

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
            destroyLocalIndex.mockClear();
            personalSessions.mockReturnValue([]);
            localStorage.clear();
            __resetMailboxRegistryForTests();
        });

        it("destroys every mailbox's keys while it is the only account signed in", () => {
            createShellSignOutHost("a1", () => ["a1"]).destroyKeys();
            expect(destroyUnlockedKeys).toHaveBeenCalledTimes(1);
            expect(destroyUnlockedKeys).toHaveBeenCalledWith();
        });

        it("destroys only its own and unclaimed mailboxes' keys while other accounts are signed in", () => {
            registerMailboxAccount("mine", "a1");
            registerMailboxAccount("mine-unlocked", "a1");
            registerMailboxAccount("theirs", "b2");
            registerMailboxAccount("left-behind", "gone");
            personalSessions.mockReturnValue([
                { mailboxUid: "mine-unlocked" },
                { mailboxUid: "theirs" },
                { mailboxUid: "unclaimed" },
                { mailboxUid: "left-behind" },
            ]);
            createShellSignOutHost("a1", () => ["a1", "b2"]).destroyKeys();
            expect(destroyedKeys()).toEqual(["left-behind", "mine", "mine-unlocked", "unclaimed"]);
        });

        it("keeps the keys of a mailbox another signed-in account also reaches, unless this account unlocked it itself", () => {
            // a1 owns "owned" and unlocked it; b2 is a delegate whose mailbox list registers it too.
            recordPersonalUnlock("owned", "a1");
            registerMailboxAccount("owned", "b2");
            registerMailboxAccount("delegated", "a1");
            recordPersonalUnlock("delegated", "c3");
            personalSessions.mockReturnValue([{ mailboxUid: "owned" }, { mailboxUid: "delegated" }]);

            // The delegate's sign-out leaves the owner's own unlock alone, whichever account listed it last.
            createShellSignOutHost("b2", () => ["a1", "b2", "c3"]).destroyKeys();
            expect(destroyUnlockedKeys).not.toHaveBeenCalled();

            // The owner's own sign-out takes it, but not a mailbox another signed-in account unlocked itself.
            createShellSignOutHost("a1", () => ["a1", "b2", "c3"]).destroyKeys();
            expect(destroyedKeys()).toEqual(["owned"]);
        });

        it("wipes every local index while it is the only account signed in", async () => {
            registerMailboxAccount("mine", "a1");
            await createShellSignOutHost("a1", () => ["a1"]).finish();
            expect(destroyAllLocalIndexes).toHaveBeenCalledTimes(1);
            expect(destroyLocalIndex).not.toHaveBeenCalled();
        });

        it("destroys the signing-out account's released indexes, not the active account's, while others are signed in", async () => {
            registerMailboxAccount("a-only", "a1");
            registerMailboxAccount("shared", "a1");
            registerMailboxAccount("shared", "b2");
            registerMailboxAccount("b-only", "b2");
            const host = createShellSignOutHost("a1", () => ["a1", "b2"]);
            host.destroyKeys();
            // The user switches to b2 while a1's sign-out waits on its compose windows.
            recordActiveAccount("b2");
            await host.finish();
            expect(destroyAllLocalIndexes).not.toHaveBeenCalled();
            expect(destroyedIndexes()).toEqual(["a-only"]);
            expect(destroyedKeys()).toEqual(["a-only"]);
        });

        it("reports the sign-out after destroying the local indexes, even when the destroy fails", async () => {
            const signedOut = vi.fn();
            const unsubscribe = onShellSignOut(signedOut);
            const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
            try {
                const host = createShellSignOutHost("a1", () => ["a1"]);
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

    describe("signOutAccountLocally", () => {
        afterEach(() => {
            destroyUnlockedKeys.mockClear();
            destroyAllLocalIndexes.mockClear();
            destroyLocalIndex.mockClear();
            personalSessions.mockReturnValue([]);
            localStorage.clear();
            __resetMailboxRegistryForTests();
        });

        it("destroys a removed account's keys, then its indexes, leaving the other accounts' alone", async () => {
            registerMailboxAccount("a-mine", "a1");
            recordPersonalUnlock("a-unlocked", "a1");
            registerMailboxAccount("b-mine", "b2");
            personalSessions.mockReturnValue([{ mailboxUid: "a-unlocked" }, { mailboxUid: "b-mine" }]);
            destroyLocalIndex.mockImplementation(() => {
                // Keys first: every key is gone by the time the first index is destroyed.
                expect(destroyUnlockedKeys).toHaveBeenCalledTimes(2);
                return Promise.resolve(true);
            });
            try {
                await expect(signOutAccountLocally("a1", () => ["a1", "b2"])).resolves.toBeUndefined();
            } finally {
                destroyLocalIndex.mockImplementation(() => Promise.resolve(true));
            }
            expect(destroyedKeys()).toEqual(["a-mine", "a-unlocked"]);
            expect(destroyedIndexes()).toEqual(["a-mine", "a-unlocked"]);
            expect(destroyAllLocalIndexes).not.toHaveBeenCalled();
        });

        it("destroys every key and index when the removed account is the last one", async () => {
            await signOutAccountLocally("a1", () => ["a1"]);
            expect(destroyUnlockedKeys).toHaveBeenCalledWith();
            expect(destroyAllLocalIndexes).toHaveBeenCalledTimes(1);
        });
    });
});
