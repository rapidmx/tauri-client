///////////////////////////////////////////////////////////////////////////////
// Copyright (C) 2026 Jean-Philippe Steinmetz
// SPDX-License-Identifier: MPL-2.0
///////////////////////////////////////////////////////////////////////////////
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
    __resetMailboxRegistryForTests,
    accountMailboxes,
    MAILBOX_ACCOUNTS_KEY,
    recordPersonalUnlock,
    registerMailboxAccount,
    releasedAccountMailboxes,
    releasedBySignOut,
    resolveMailboxAccount,
    unregisterAccountMailboxes,
} from "../../src/lib/mailboxRegistry.js";

describe("mailboxRegistry", () => {
    beforeEach(() => {
        localStorage.clear();
        __resetMailboxRegistryForTests();
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it("resolves undefined for an unregistered mailbox", () => {
        expect(resolveMailboxAccount("mb-1")).toBeUndefined();
    });

    it("resolves the account a mailbox was registered under", () => {
        registerMailboxAccount("mb-1", "acct-a");
        expect(resolveMailboxAccount("mb-1")).toBe("acct-a");
    });

    it("keeps every account that registers a mailbox, resolving to the first, or to the one that unlocked it itself", () => {
        registerMailboxAccount("mb-1", "acct-a");
        registerMailboxAccount("mb-1", "acct-b");
        expect(resolveMailboxAccount("mb-1")).toBe("acct-a");
        expect(accountMailboxes("acct-a")).toEqual(["mb-1"]);
        expect(accountMailboxes("acct-b")).toEqual(["mb-1"]);
        recordPersonalUnlock("mb-1", "acct-b");
        expect(resolveMailboxAccount("mb-1")).toBe("acct-b");
    });

    it("forgets only the given account's registrations, and a mailbox once no account is left for it", () => {
        registerMailboxAccount("mb-1", "acct-a");
        registerMailboxAccount("mb-2", "acct-a");
        registerMailboxAccount("mb-3", "acct-b");
        recordPersonalUnlock("mb-2", "acct-a");
        registerMailboxAccount("mb-2", "acct-b");
        unregisterAccountMailboxes("acct-a");
        expect(resolveMailboxAccount("mb-1")).toBeUndefined();
        expect(resolveMailboxAccount("mb-2")).toBe("acct-b");
        expect(resolveMailboxAccount("mb-3")).toBe("acct-b");
        expect(accountMailboxes("acct-a")).toEqual([]);
        expect(JSON.parse(localStorage.getItem(MAILBOX_ACCOUNTS_KEY)!)).toEqual({
            "mb-2": { accounts: ["acct-b"] },
            "mb-3": { accounts: ["acct-b"] },
        });
    });

    describe("releasedBySignOut", () => {
        const signedIn =
            (...ids: string[]) =>
            (id: string): boolean =>
                ids.includes(id);

        it("releases a mailbox only the signing-out account reaches, or that no account is registered for", () => {
            registerMailboxAccount("mb-1", "acct-a");
            expect(releasedBySignOut("mb-1", "acct-a", signedIn("acct-a", "acct-b"))).toBe(true);
            expect(releasedBySignOut("mb-unknown", "acct-a", signedIn("acct-a", "acct-b"))).toBe(true);
        });

        it("keeps a mailbox another signed-in account also reaches, unless the signing-out account unlocked it itself", () => {
            // An owner (acct-a) and a delegate (acct-b) signed in side by side both list acct-a's mailbox.
            registerMailboxAccount("mb-a", "acct-a");
            registerMailboxAccount("mb-a", "acct-b");
            expect(releasedBySignOut("mb-a", "acct-a", signedIn("acct-a", "acct-b"))).toBe(false);
            expect(releasedBySignOut("mb-a", "acct-b", signedIn("acct-a", "acct-b"))).toBe(false);
            recordPersonalUnlock("mb-a", "acct-a");
            expect(releasedBySignOut("mb-a", "acct-a", signedIn("acct-a", "acct-b"))).toBe(true);
            // The delegate's sign-out leaves the owner's own unlock and index alone.
            expect(releasedBySignOut("mb-a", "acct-b", signedIn("acct-a", "acct-b"))).toBe(false);
        });

        it("ignores a registration left by an account that is no longer signed in", () => {
            registerMailboxAccount("mb-1", "acct-gone");
            registerMailboxAccount("mb-1", "acct-a");
            expect(releasedBySignOut("mb-1", "acct-a", signedIn("acct-a", "acct-b"))).toBe(true);
        });

        it("lists the account's released mailboxes", () => {
            registerMailboxAccount("mine", "acct-a");
            registerMailboxAccount("both", "acct-a");
            registerMailboxAccount("both", "acct-b");
            registerMailboxAccount("theirs", "acct-b");
            expect(releasedAccountMailboxes("acct-a", signedIn("acct-a", "acct-b"))).toEqual(["mine"]);
            expect(releasedAccountMailboxes("acct-a", signedIn("acct-a"))).toEqual(["mine", "both"]);
        });
    });

    it("lists an account's mailboxes", () => {
        registerMailboxAccount("mb-1", "acct-a");
        registerMailboxAccount("mb-2", "acct-b");
        registerMailboxAccount("mb-3", "acct-a");
        expect(accountMailboxes("acct-a")).toEqual(["mb-1", "mb-3"]);
        expect(accountMailboxes("acct-c")).toEqual([]);
    });

    it("keeps the map across a restart, and removes the stored key once it is empty", () => {
        registerMailboxAccount("mb-1", "acct-a");
        recordPersonalUnlock("mb-1", "acct-b");
        expect(JSON.parse(localStorage.getItem(MAILBOX_ACCOUNTS_KEY)!)).toEqual({ "mb-1": { accounts: ["acct-a", "acct-b"], unlockedBy: "acct-b" } });
        __resetMailboxRegistryForTests();
        expect(accountMailboxes("acct-a")).toEqual(["mb-1"]);
        expect(resolveMailboxAccount("mb-1")).toBe("acct-b");
        unregisterAccountMailboxes("acct-b");
        unregisterAccountMailboxes("acct-a");
        expect(localStorage.getItem(MAILBOX_ACCOUNTS_KEY)).toBeNull();
    });

    it("writes nothing when a mailbox is registered or unlocked again by the same account", () => {
        registerMailboxAccount("mb-1", "acct-a");
        recordPersonalUnlock("mb-1", "acct-a");
        const setItem = vi.spyOn(Storage.prototype, "setItem");
        registerMailboxAccount("mb-1", "acct-a");
        recordPersonalUnlock("mb-1", "acct-a");
        expect(setItem).not.toHaveBeenCalled();
    });

    it.each([
        ["not json"],
        ["null"],
        ['"text"'],
        ['{"mb-1":"acct-a","mb-2":7}'],
        ['{"mb-2":null}'],
        ['{"mb-2":{"accounts":[]}}'],
        ['{"mb-2":{"accounts":"acct-a"}}'],
        ['{"mb-2":{"accounts":[7]}}'],
    ])("ignores what it can't use in %s", (stored) => {
        localStorage.setItem(MAILBOX_ACCOUNTS_KEY, stored);
        expect(resolveMailboxAccount("mb-2")).toBeUndefined();
        expect(resolveMailboxAccount("0")).toBeUndefined();
    });

    it("reads a stored entry, in an earlier build's form too", () => {
        localStorage.setItem(
            MAILBOX_ACCOUNTS_KEY,
            JSON.stringify({
                "mb-1": "acct-a",
                "mb-2": { accounts: ["acct-a", 7, "acct-b"], unlockedBy: "acct-b" },
                "mb-3": { accounts: ["acct-a"], unlockedBy: "acct-gone" },
            })
        );
        expect(resolveMailboxAccount("mb-1")).toBe("acct-a");
        expect(resolveMailboxAccount("mb-2")).toBe("acct-b");
        expect(accountMailboxes("acct-b")).toEqual(["mb-2"]);
        // An unlocker that isn't one of the mailbox's accounts is dropped.
        expect(resolveMailboxAccount("mb-3")).toBe("acct-a");
    });

    it("works in memory when storage is blocked", () => {
        vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
            throw new Error("blocked");
        });
        vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
            throw new Error("blocked");
        });
        registerMailboxAccount("mb-1", "acct-a");
        expect(resolveMailboxAccount("mb-1")).toBe("acct-a");
    });
});
