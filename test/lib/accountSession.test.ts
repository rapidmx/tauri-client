///////////////////////////////////////////////////////////////////////////////
// Copyright (C) 2026 Jean-Philippe Steinmetz
// SPDX-License-Identifier: MPL-2.0
///////////////////////////////////////////////////////////////////////////////
import { afterEach, describe, expect, it, vi } from "vitest";
import { getActiveAccountId, notifyShellSignOut, onShellSignOut, reloadApp, recordActiveAccount } from "../../src/lib/accountSession.js";

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
});
