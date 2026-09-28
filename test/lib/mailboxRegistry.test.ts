///////////////////////////////////////////////////////////////////////////////
// Copyright (C) 2026 Jean-Philippe Steinmetz
// SPDX-License-Identifier: MPL-2.0
///////////////////////////////////////////////////////////////////////////////
import { beforeEach, describe, expect, it } from "vitest";
import {
    __resetMailboxRegistryForTests,
    registerMailboxAccount,
    resolveMailboxAccount,
    unregisterAccountMailboxes,
} from "../../src/lib/mailboxRegistry.js";

describe("mailboxRegistry", () => {
    beforeEach(() => {
        __resetMailboxRegistryForTests();
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
});
