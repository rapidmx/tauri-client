///////////////////////////////////////////////////////////////////////////////
// Copyright (C) 2026 Jean-Philippe Steinmetz
// SPDX-License-Identifier: MPL-2.0
///////////////////////////////////////////////////////////////////////////////
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ApiClient } from "@rapidmx/react-shared/util/api.js";
import type { AccountSummary } from "../../src/lib/tauri.js";
import { resolveWwwShellProps } from "../../src/lib/shellProps.js";

const account: AccountSummary = {
    id: "a1",
    label: "Work",
    email: "work@example.com",
    serverUrl: "https://mail.example.com",
    authServerUrl: "https://auth.example.com",
};

describe("resolveWwwShellProps", () => {
    let warnSpy: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
        warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    });

    afterEach(() => {
        warnSpy.mockRestore();
    });

    it("supplies only authServerUrl and the stock defaults when there is no ApiClient", async () => {
        const props = await resolveWwwShellProps(account, undefined);
        expect(props).toEqual({
            authServerUrl: account.authServerUrl,
            branding: undefined,
            appearance: undefined,
            userUid: undefined,
            impersonating: false,
            trusted: false,
        });
        expect(warnSpy).not.toHaveBeenCalled();
    });

    it("fetches branding from the account's ApiClient", async () => {
        const branding = { companyName: "Acme", title: "Acme" };
        const client: ApiClient = { fetch: vi.fn().mockResolvedValue(branding), setUnauthorizedObserver: vi.fn() };
        const props = await resolveWwwShellProps(account, client);
        expect(client.fetch).toHaveBeenCalledWith("/system/branding");
        expect(props.branding).toEqual(branding);
    });

    it("degrades to no branding, logging a warning, when the fetch fails", async () => {
        const client: ApiClient = { fetch: vi.fn().mockRejectedValue(new Error("offline")), setUnauthorizedObserver: vi.fn() };
        const props = await resolveWwwShellProps(account, client);
        expect(props.branding).toBeUndefined();
        expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("Work"), expect.any(Error));
    });
});
