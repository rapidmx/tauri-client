///////////////////////////////////////////////////////////////////////////////
// Copyright (C) 2026 Jean-Philippe Steinmetz
// SPDX-License-Identifier: MPL-2.0
///////////////////////////////////////////////////////////////////////////////
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
    __resetMailboxRegistryForTests,
    accountMailboxes,
    MAILBOX_ACCOUNTS_KEY,
    registerMailboxAccount,
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

    it("overwrites a mailbox's previous owner on re-registration", () => {
        registerMailboxAccount("mb-1", "acct-a");
        registerMailboxAccount("mb-1", "acct-b");
        expect(resolveMailboxAccount("mb-1")).toBe("acct-b");
    });

    it("forgets only the given account's mailboxes", () => {
        registerMailboxAccount("mb-1", "acct-a");
        registerMailboxAccount("mb-2", "acct-a");
        registerMailboxAccount("mb-3", "acct-b");
        unregisterAccountMailboxes("acct-a");
        expect(resolveMailboxAccount("mb-1")).toBeUndefined();
        expect(resolveMailboxAccount("mb-2")).toBeUndefined();
        expect(resolveMailboxAccount("mb-3")).toBe("acct-b");
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
        expect(JSON.parse(localStorage.getItem(MAILBOX_ACCOUNTS_KEY)!)).toEqual({ "mb-1": "acct-a" });
        __resetMailboxRegistryForTests();
        expect(accountMailboxes("acct-a")).toEqual(["mb-1"]);
        unregisterAccountMailboxes("acct-a");
        expect(localStorage.getItem(MAILBOX_ACCOUNTS_KEY)).toBeNull();
    });

    it("writes nothing when a mailbox is registered again to the same account", () => {
        registerMailboxAccount("mb-1", "acct-a");
        const setItem = vi.spyOn(Storage.prototype, "setItem");
        registerMailboxAccount("mb-1", "acct-a");
        expect(setItem).not.toHaveBeenCalled();
    });

    it.each([["not json"], ["null"], ['"text"'], ['{"mb-1":"acct-a","mb-2":7}']])("ignores what it can't use in %s", (stored) => {
        localStorage.setItem(MAILBOX_ACCOUNTS_KEY, stored);
        expect(resolveMailboxAccount("mb-2")).toBeUndefined();
        expect(resolveMailboxAccount("0")).toBeUndefined();
    });

    it("reads a stored entry", () => {
        localStorage.setItem(MAILBOX_ACCOUNTS_KEY, '{"mb-1":"acct-a","mb-2":7}');
        expect(resolveMailboxAccount("mb-1")).toBe("acct-a");
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
