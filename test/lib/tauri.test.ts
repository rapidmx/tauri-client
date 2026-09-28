///////////////////////////////////////////////////////////////////////////////
// Copyright (C) 2026 Jean-Philippe Steinmetz
// SPDX-License-Identifier: MPL-2.0
///////////////////////////////////////////////////////////////////////////////
import { describe, expect, it, vi } from "vitest";

const invokeMock = vi.fn();
const listenMock = vi.fn();

vi.mock("@tauri-apps/api/core", () => ({
    invoke: (...args: unknown[]) => invokeMock(...args),
}));
vi.mock("@tauri-apps/api/event", () => ({
    listen: (...args: unknown[]) => listenMock(...args),
}));

describe("src/lib/tauri", () => {
    it("resolveServer invokes resolve_server with the email", async () => {
        const { resolveServer } = await import("../../src/lib/tauri.js");
        invokeMock.mockResolvedValueOnce({ serverUrl: "https://mail.example.com", authServerUrl: "https://auth.example.com" });
        const result = await resolveServer("user@example.com");
        expect(invokeMock).toHaveBeenCalledWith("resolve_server", { email: "user@example.com" });
        expect(result).toEqual({ serverUrl: "https://mail.example.com", authServerUrl: "https://auth.example.com" });
    });

    it("addAccount invokes add_account with a null label when none is given", async () => {
        const { addAccount } = await import("../../src/lib/tauri.js");
        invokeMock.mockResolvedValueOnce(undefined);
        await addAccount("user@example.com", "https://mail.example.com", "https://auth.example.com");
        expect(invokeMock).toHaveBeenCalledWith("add_account", {
            email: "user@example.com",
            serverUrl: "https://mail.example.com",
            authServerUrl: "https://auth.example.com",
            label: null,
        });
    });

    it("addAccount passes an explicit label through", async () => {
        const { addAccount } = await import("../../src/lib/tauri.js");
        invokeMock.mockResolvedValueOnce(undefined);
        await addAccount("user@example.com", "https://mail.example.com", "https://auth.example.com", "Work");
        expect(invokeMock).toHaveBeenCalledWith(
            "add_account",
            expect.objectContaining({ label: "Work" })
        );
    });

    it("listAccounts invokes list_accounts", async () => {
        const { listAccounts } = await import("../../src/lib/tauri.js");
        const accounts = [{ id: "a1", label: "Work", email: "user@example.com", serverUrl: "s", authServerUrl: "a" }];
        invokeMock.mockResolvedValueOnce(accounts);
        const result = await listAccounts();
        expect(invokeMock).toHaveBeenCalledWith("list_accounts");
        expect(result).toEqual(accounts);
    });

    it("removeAccount invokes remove_account with the account id", async () => {
        const { removeAccount } = await import("../../src/lib/tauri.js");
        invokeMock.mockResolvedValueOnce(undefined);
        await removeAccount("a1");
        expect(invokeMock).toHaveBeenCalledWith("remove_account", { accountId: "a1" });
    });

    it("onAccountAdded listens for rapidmx://account-added and forwards the payload", async () => {
        const { onAccountAdded } = await import("../../src/lib/tauri.js");
        const handler = vi.fn();
        const unlisten = vi.fn();
        listenMock.mockImplementationOnce((_event: string, callback: (event: { payload: unknown }) => void) => {
            callback({ payload: { id: "a1" } });
            return Promise.resolve(unlisten);
        });
        const result = await onAccountAdded(handler);
        expect(listenMock).toHaveBeenCalledWith("rapidmx://account-added", expect.any(Function));
        expect(handler).toHaveBeenCalledWith({ id: "a1" });
        expect(result).toBe(unlisten);
    });

    it("onSignInError listens for rapidmx://sign-in-error and forwards the payload", async () => {
        const { onSignInError } = await import("../../src/lib/tauri.js");
        const handler = vi.fn();
        const unlisten = vi.fn();
        listenMock.mockImplementationOnce((_event: string, callback: (event: { payload: unknown }) => void) => {
            callback({ payload: { message: "boom" } });
            return Promise.resolve(unlisten);
        });
        const result = await onSignInError(handler);
        expect(listenMock).toHaveBeenCalledWith("rapidmx://sign-in-error", expect.any(Function));
        expect(handler).toHaveBeenCalledWith({ message: "boom" });
        expect(result).toBe(unlisten);
    });

    it("getSessionToken invokes get_session_token with the account id", async () => {
        const { getSessionToken } = await import("../../src/lib/tauri.js");
        invokeMock.mockResolvedValueOnce("session-jwt");
        const result = await getSessionToken("a1");
        expect(invokeMock).toHaveBeenCalledWith("get_session_token", { accountId: "a1" });
        expect(result).toBe("session-jwt");
    });

    describe("searchCommands", () => {
        it("init invokes search_local_init with the account id and base64 key", async () => {
            const { searchCommands } = await import("../../src/lib/tauri.js");
            invokeMock.mockResolvedValueOnce(undefined);
            await searchCommands.init("a1", "a2V5");
            expect(invokeMock).toHaveBeenCalledWith("search_local_init", { accountId: "a1", masterKeyBase64: "a2V5" });
        });

        it("indexEntities invokes search_local_index_entities", async () => {
            const { searchCommands } = await import("../../src/lib/tauri.js");
            invokeMock.mockResolvedValueOnce({ indexed: 1 });
            const entities = [
                {
                    entityType: "message",
                    entityUid: "e1",
                    mailboxUid: "mb-1",
                    dateForSort: "2026-01-01T00:00:00.000Z",
                    participants: "",
                    flags: ",,",
                    hasAttachments: false,
                    byteSize: 10,
                },
            ];
            const result = await searchCommands.indexEntities("a1", entities);
            expect(invokeMock).toHaveBeenCalledWith("search_local_index_entities", { accountId: "a1", entities });
            expect(result).toEqual({ indexed: 1 });
        });

        it("removeEntity invokes search_local_remove_entity", async () => {
            const { searchCommands } = await import("../../src/lib/tauri.js");
            invokeMock.mockResolvedValueOnce(undefined);
            await searchCommands.removeEntity("a1", "e1");
            expect(invokeMock).toHaveBeenCalledWith("search_local_remove_entity", { accountId: "a1", entityUid: "e1" });
        });

        it("search invokes search_local_search, defaulting offset to null when omitted", async () => {
            const { searchCommands } = await import("../../src/lib/tauri.js");
            invokeMock.mockResolvedValueOnce({ hits: [] });
            await searchCommands.search("a1", "mb-1", { text: "hello" }, 20);
            expect(invokeMock).toHaveBeenCalledWith("search_local_search", {
                accountId: "a1",
                mailboxUid: "mb-1",
                parsed: { text: "hello" },
                limit: 20,
                offset: null,
            });
        });

        it("search passes an explicit offset through", async () => {
            const { searchCommands } = await import("../../src/lib/tauri.js");
            invokeMock.mockResolvedValueOnce({ hits: [] });
            await searchCommands.search("a1", "mb-1", { text: "hello" }, 20, 40);
            expect(invokeMock).toHaveBeenCalledWith("search_local_search", expect.objectContaining({ offset: 40 }));
        });

        it("getCoverage invokes search_local_get_coverage", async () => {
            const { searchCommands } = await import("../../src/lib/tauri.js");
            invokeMock.mockResolvedValueOnce({ entityCount: 3 });
            const result = await searchCommands.getCoverage("a1", "mb-1");
            expect(invokeMock).toHaveBeenCalledWith("search_local_get_coverage", { accountId: "a1", mailboxUid: "mb-1" });
            expect(result).toEqual({ entityCount: 3 });
        });

        it("destroy invokes search_local_destroy", async () => {
            const { searchCommands } = await import("../../src/lib/tauri.js");
            invokeMock.mockResolvedValueOnce(true);
            const result = await searchCommands.destroy("a1");
            expect(invokeMock).toHaveBeenCalledWith("search_local_destroy", { accountId: "a1" });
            expect(result).toBe(true);
        });

        it("destroyAll invokes search_local_destroy_all", async () => {
            const { searchCommands } = await import("../../src/lib/tauri.js");
            invokeMock.mockResolvedValueOnce(true);
            const result = await searchCommands.destroyAll();
            expect(invokeMock).toHaveBeenCalledWith("search_local_destroy_all", {});
            expect(result).toBe(true);
        });
    });
});
