///////////////////////////////////////////////////////////////////////////////
// Copyright (C) 2026 Jean-Philippe Steinmetz
// SPDX-License-Identifier: MPL-2.0
///////////////////////////////////////////////////////////////////////////////
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const initMock = vi.fn();
const indexEntitiesMock = vi.fn();
const removeEntityMock = vi.fn();
const moveEntityMock = vi.fn();
const indexedVersionsMock = vi.fn();
const searchMock = vi.fn();
const getCoverageMock = vi.fn();
const destroyMock = vi.fn();
const destroyMailboxMock = vi.fn();
const destroyAllMock = vi.fn();

vi.mock("../../src/lib/tauri.js", () => ({
    searchCommands: {
        init: (...args: unknown[]) => initMock(...args),
        indexEntities: (...args: unknown[]) => indexEntitiesMock(...args),
        removeEntity: (...args: unknown[]) => removeEntityMock(...args),
        moveEntity: (...args: unknown[]) => moveEntityMock(...args),
        indexedVersions: (...args: unknown[]) => indexedVersionsMock(...args),
        search: (...args: unknown[]) => searchMock(...args),
        getCoverage: (...args: unknown[]) => getCoverageMock(...args),
        destroy: (...args: unknown[]) => destroyMock(...args),
        destroyMailbox: (...args: unknown[]) => destroyMailboxMock(...args),
        destroyAll: (...args: unknown[]) => destroyAllMock(...args),
    },
}));

import { createNativeSearchTransport, installNativeSearchTransport, NATIVE_SEARCH_TRANSPORT_READY } from "../../src/lib/searchTransport.js";

const resolver = (mailboxUid: string): string | undefined => (mailboxUid === "mb-1" ? "acct-1" : undefined);

describe("createNativeSearchTransport", () => {
    beforeEach(() => {
        initMock.mockReset().mockResolvedValue(undefined);
        indexEntitiesMock.mockReset().mockResolvedValue({ indexed: 1 });
        removeEntityMock.mockReset().mockResolvedValue(undefined);
        moveEntityMock.mockReset().mockResolvedValue(undefined);
        indexedVersionsMock.mockReset().mockResolvedValue({ e1: "v1" });
        searchMock.mockReset().mockResolvedValue({ hits: [{ entityUid: "e1", rank: 1.5 }] });
        getCoverageMock.mockReset().mockResolvedValue({ entityCount: 3 });
        destroyMock.mockReset().mockResolvedValue(true);
        destroyMailboxMock.mockReset().mockResolvedValue(true);
        destroyAllMock.mockReset().mockResolvedValue(true);
    });

    it("issues a fresh, monotonic generation from its own counter", () => {
        const transport = createNativeSearchTransport(resolver);
        expect(transport.nextGeneration()).toBe(1);
        expect(transport.nextGeneration()).toBe(2);
    });

    it("init() base64-encodes the index key and resolves the account id", async () => {
        const transport = createNativeSearchTransport(resolver);
        await transport.init({ mailboxUid: "mb-1", indexKey: new Uint8Array([1, 2, 3]) });
        expect(initMock).toHaveBeenCalledWith("acct-1", btoa(String.fromCharCode(1, 2, 3)));
    });

    it("init() rejects for a mailbox with no registered account", async () => {
        const transport = createNativeSearchTransport(resolver);
        await expect(transport.init({ mailboxUid: "mb-unknown", indexKey: new Uint8Array() })).rejects.toThrow(
            "No account is registered for mailbox mb-unknown"
        );
        expect(initMock).not.toHaveBeenCalled();
    });

    it("indexEntities() delegates and always reports budgetReached: false", async () => {
        const transport = createNativeSearchTransport(resolver);
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
        const result = await transport.indexEntities("mb-1", entities);
        expect(indexEntitiesMock).toHaveBeenCalledWith("acct-1", entities);
        expect(result).toEqual({ budgetReached: false });
    });

    it("removeEntity() delegates with the resolved account id", async () => {
        const transport = createNativeSearchTransport(resolver);
        await transport.removeEntity("mb-1", "e1");
        expect(removeEntityMock).toHaveBeenCalledWith("acct-1", "e1");
    });

    it("search() converts Date filters to ISO strings and defaults flags/text", async () => {
        const transport = createNativeSearchTransport(resolver);
        const before = new Date("2026-02-01T00:00:00.000Z");
        const page = await transport.search("mb-1", { text: "hello", before }, 20, 0);
        expect(searchMock).toHaveBeenCalledWith(
            "acct-1",
            "mb-1",
            {
                from: undefined,
                to: undefined,
                cc: undefined,
                subject: undefined,
                hasAttachment: undefined,
                before: before.toISOString(),
                after: undefined,
                folderUid: undefined,
                flags: [],
                text: "hello",
            },
            20,
            0
        );
        expect(page).toEqual({ hits: [{ entityUid: "e1", rank: 1.5 }], hasMore: false });
    });

    it("coverage() reports a conservative incomplete/not-building state", async () => {
        const transport = createNativeSearchTransport(resolver);
        const coverage = await transport.coverage("mb-1");
        expect(getCoverageMock).toHaveBeenCalledWith("acct-1", "mb-1");
        expect(coverage).toEqual({ indexedCount: 3, building: false, complete: false });
    });

    it("destroy() drops only that mailbox's rows, never the account's whole index", async () => {
        const transport = createNativeSearchTransport(resolver);
        await expect(transport.destroy("mb-1")).resolves.toBe(true);
        expect(destroyMailboxMock).toHaveBeenCalledWith("acct-1", "mb-1");
        expect(destroyMock).not.toHaveBeenCalled();
    });

    it("destroy() resolves false instead of rejecting when the native call fails", async () => {
        destroyMailboxMock.mockRejectedValueOnce(new Error("invalid account id"));
        const transport = createNativeSearchTransport(resolver);
        await expect(transport.destroy("mb-1")).resolves.toBe(false);
    });

    it("destroy() resolves false without calling Rust for an unregistered mailbox", async () => {
        const transport = createNativeSearchTransport(resolver);
        await expect(transport.destroy("mb-unknown")).resolves.toBe(false);
        expect(destroyMailboxMock).not.toHaveBeenCalled();
    });

    it("destroyAll() delegates directly", async () => {
        const transport = createNativeSearchTransport(resolver);
        await expect(transport.destroyAll(5000)).resolves.toBe(true);
        expect(destroyAllMock).toHaveBeenCalled();
    });

    it("retryPendingDeletions() is a real no-op success", async () => {
        const transport = createNativeSearchTransport(resolver);
        await expect(transport.retryPendingDeletions()).resolves.toBeUndefined();
    });

    it("moveEntity() and indexedVersions() delegate with the resolved account id", async () => {
        const transport = createNativeSearchTransport(resolver);
        await transport.moveEntity("mb-1", "e1", "archive", "v2");
        expect(moveEntityMock).toHaveBeenCalledWith("acct-1", "e1", "archive", "v2");
        await expect(transport.indexedVersions("mb-1", ["e1", "e2"])).resolves.toEqual({ e1: "v1" });
        expect(indexedVersionsMock).toHaveBeenCalledWith("acct-1", ["e1", "e2"]);
    });

    it("pruneInaccessible() resolves, keeping the interface's never-rejects contract", async () => {
        const transport = createNativeSearchTransport(resolver);
        await expect(transport.pruneInaccessible(["mb-1"])).resolves.toBeUndefined();
    });

    it.each(["pruneEntities", "setWindow", "setBuilding"] as const)(
        "%s() rejects clearly - no Rust command exists for it yet",
        async (method) => {
            const transport = createNativeSearchTransport(resolver);
            const call = (transport[method] as (...args: unknown[]) => Promise<unknown>)("mb-1", "x", "y", {});
            await expect(call).rejects.toThrow(`does not implement "${method}" yet`);
        }
    );
});

describe("installNativeSearchTransport", () => {
    const modulePath = "@rapidmx/web-client/shared/search/localIndexRpcClient.js";
    let warnSpy: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
        vi.resetModules();
        warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    });

    afterEach(() => {
        warnSpy.mockRestore();
        vi.doUnmock(modulePath);
    });

    it("leaves web-client's own transport in place until the native one is ready", async () => {
        expect(NATIVE_SEARCH_TRANSPORT_READY).toBe(false);
        const setLocalIndexTransport = vi.fn();
        vi.doMock(modulePath, () => ({ setLocalIndexTransport }));
        const { installNativeSearchTransport: install } = await import("../../src/lib/searchTransport.js");
        await expect(install(resolver)).resolves.toBeUndefined();
        expect(setLocalIndexTransport).not.toHaveBeenCalled();
        expect(warnSpy).not.toHaveBeenCalled();
    });

    it("logs a warning and does not throw when setLocalIndexTransport isn't exported yet", async () => {
        // Explicitly simulated, not incidental: `@rapidmx/web-client` genuinely exports
        // `setLocalIndexTransport` today (the react-shared merge and web-client's own swappable-
        // transport work have both landed), so this module is mocked here to lack it on purpose -
        // this test is about `installNativeSearchTransport()`'s own defensive handling of an absent
        // export, not about whether the export happens to be missing in this environment right now.
        // The property must still be explicitly declared (`undefined`, not omitted) - Vitest 5's
        // mock proxy throws on any *undeclared* property access, which would trip the code under
        // test's own `try/catch` and produce a different warning than the one this test asserts on.
        vi.doMock(modulePath, () => ({ setLocalIndexTransport: undefined }));
        const { installNativeSearchTransport: install } = await import("../../src/lib/searchTransport.js");
        await expect(install(resolver, { enabled: true })).resolves.toBeUndefined();
        expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("does not export setLocalIndexTransport"));
    });

    it("calls the real setter with a native transport once it exists", async () => {
        const setLocalIndexTransport = vi.fn();
        vi.doMock(modulePath, () => ({ setLocalIndexTransport }));
        const { installNativeSearchTransport: install } = await import("../../src/lib/searchTransport.js");
        await install(resolver, { enabled: true });
        expect(setLocalIndexTransport).toHaveBeenCalledTimes(1);
        const transport = setLocalIndexTransport.mock.calls[0][0] as ReturnType<typeof createNativeSearchTransport>;
        expect(typeof transport.nextGeneration).toBe("function");
    });

    it("warns instead of throwing when the dynamic import itself fails", async () => {
        vi.doMock(modulePath, () => {
            throw new Error("module not found");
        });
        const { installNativeSearchTransport: install } = await import("../../src/lib/searchTransport.js");
        await expect(install(resolver, { enabled: true })).resolves.toBeUndefined();
        expect(warnSpy).toHaveBeenCalledWith("[rapidmx] Could not install the native search transport:", expect.any(Error));
    });
});
