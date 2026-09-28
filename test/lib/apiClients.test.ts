///////////////////////////////////////////////////////////////////////////////
// Copyright (C) 2026 Jean-Philippe Steinmetz
// SPDX-License-Identifier: MPL-2.0
///////////////////////////////////////////////////////////////////////////////
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AccountSummary } from "../../src/lib/tauri.js";

const getSessionTokenMock = vi.fn();
const createApiClientMock = vi.fn();

vi.mock("../../src/lib/tauri.js", () => ({
    getSessionToken: (...args: unknown[]) => getSessionTokenMock(...args),
}));

vi.mock("@rapidmx/web-client/lib/util/api.js", () => ({
    createApiClient: (...args: unknown[]) => createApiClientMock(...args),
}));

const accountA: AccountSummary = {
    id: "a1",
    label: "Work",
    email: "work@example.com",
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

describe("apiClients", () => {
    beforeEach(async () => {
        createApiClientMock.mockReset().mockImplementation((opts: unknown) => ({ __opts: opts, fetch: vi.fn(), setUnauthorizedObserver: vi.fn() }));
        getSessionTokenMock.mockReset().mockResolvedValue("session-jwt");
        const apiClients = await import("../../src/lib/apiClients.js");
        apiClients.__resetApiClientsForTests();
    });

    it("has no client for an account that was never synced", async () => {
        const { getApiClient } = await import("../../src/lib/apiClients.js");
        expect(getApiClient("a1")).toBeUndefined();
    });

    it("creates a client for each new account", async () => {
        const { getApiClient, syncApiClients } = await import("../../src/lib/apiClients.js");
        syncApiClients([accountA, accountB]);
        expect(getApiClient("a1")).toBeDefined();
        expect(getApiClient("b2")).toBeDefined();
        expect(createApiClientMock).toHaveBeenCalledTimes(2);
        expect(createApiClientMock).toHaveBeenCalledWith(expect.objectContaining({ baseUrl: accountA.serverUrl }));
    });

    it("wires getAccessToken to get_session_token for the right account id", async () => {
        const { syncApiClients } = await import("../../src/lib/apiClients.js");
        syncApiClients([accountA]);
        const options = createApiClientMock.mock.calls[0][0] as { getAccessToken: () => Promise<string> };
        await expect(options.getAccessToken()).resolves.toBe("session-jwt");
        expect(getSessionTokenMock).toHaveBeenCalledWith("a1");
    });

    it("keeps an existing client for an account still present on a later sync", async () => {
        const { getApiClient, syncApiClients } = await import("../../src/lib/apiClients.js");
        syncApiClients([accountA]);
        const first = getApiClient("a1");
        syncApiClients([accountA, accountB]);
        expect(getApiClient("a1")).toBe(first);
        expect(createApiClientMock).toHaveBeenCalledTimes(2);
    });

    it("drops the client for an account no longer present", async () => {
        const { getApiClient, syncApiClients } = await import("../../src/lib/apiClients.js");
        syncApiClients([accountA, accountB]);
        syncApiClients([accountB]);
        expect(getApiClient("a1")).toBeUndefined();
        expect(getApiClient("b2")).toBeDefined();
    });
});
