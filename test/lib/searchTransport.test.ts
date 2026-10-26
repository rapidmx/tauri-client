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

import { onShellSignOut } from "../../src/lib/accountSession.js";
import { __resetMailboxRegistryForTests, registerMailboxAccount, resolveMailboxAccount } from "../../src/lib/mailboxRegistry.js";
import {
    createMultiAccountWorkerTransport,
    createNativeSearchTransport,
    DEFAULT_PENDING_DELETIONS_KEY,
    installNativeSearchTransport,
    NATIVE_SEARCH_TRANSPORT_READY,
    type LocalIndexTransport,
} from "../../src/lib/searchTransport.js";

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
        expect(moveEntityMock).toHaveBeenCalledWith("acct-1", "e1", "archive", "v2", undefined);
        // A row's flags go along, so a zero-access row keeps them.
        await transport.moveEntity("mb-1", "e1", "archive", "v3", ",read,flagged,");
        expect(moveEntityMock).toHaveBeenLastCalledWith("acct-1", "e1", "archive", "v3", ",read,flagged,");
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

describe("createMultiAccountWorkerTransport", () => {
    const worker = (): LocalIndexTransport =>
        ({
            nextGeneration: vi.fn(() => 7),
            init: vi.fn(() => Promise.resolve()),
            destroy: vi.fn(() => Promise.resolve(true)),
            destroyAll: vi.fn(() => Promise.resolve(true)),
            pruneInaccessible: vi.fn(() => Promise.resolve()),
            retryPendingDeletions: vi.fn(() => Promise.resolve()),
        }) as unknown as LocalIndexTransport;
    const key = new Uint8Array([1]);
    let active: string | undefined;
    const activeAccountId = (): string | undefined => active;
    let signedOut: string[];
    let unsubscribe: () => void;

    beforeEach(() => {
        localStorage.clear();
        __resetMailboxRegistryForTests();
        active = "acct-a";
        signedOut = [];
        unsubscribe = onShellSignOut((accountId) => signedOut.push(accountId));
    });

    afterEach(() => {
        unsubscribe();
        vi.useRealTimers();
    });

    it("prunes through the worker transport while exactly one account is signed in", async () => {
        const inner = worker();
        const transport = createMultiAccountWorkerTransport(inner, { signedInAccountCount: () => 1 });
        await expect(transport.pruneInaccessible(new Set(["mb-1"]))).resolves.toBeUndefined();
        expect(inner.pruneInaccessible).toHaveBeenCalledWith(["mb-1"]);
        // Every other method is the worker transport's own.
        expect(transport.nextGeneration()).toBe(7);
    });

    it.each([2, 0])("skips the prune, so other accounts' indexes stay, with %i accounts signed in", async (count) => {
        const inner = worker();
        const transport = createMultiAccountWorkerTransport(inner, { signedInAccountCount: () => count });
        await expect(transport.pruneInaccessible(["mb-1"])).resolves.toBeUndefined();
        expect(inner.pruneInaccessible).not.toHaveBeenCalled();
    });

    it("registers the mailboxes the active account opens or lists, and tracks which indexes are open", async () => {
        const inner = worker();
        const transport = createMultiAccountWorkerTransport(inner, { signedInAccountCount: () => 2, activeAccountId });
        await transport.init({ mailboxUid: "mb-1", indexKey: key });
        expect(inner.init).toHaveBeenCalledWith({ mailboxUid: "mb-1", indexKey: key });
        await transport.pruneInaccessible(["mb-1", "mb-shared"]);
        active = "acct-b";
        await transport.init({ mailboxUid: "mb-2", indexKey: key });
        expect(resolveMailboxAccount("mb-1")).toBe("acct-a");
        expect(resolveMailboxAccount("mb-shared")).toBe("acct-a");
        expect(resolveMailboxAccount("mb-2")).toBe("acct-b");
        expect(transport.isOpen("mb-1")).toBe(true);
        expect(transport.isOpen("mb-shared")).toBe(false);

        await expect(transport.destroy("mb-1")).resolves.toBe(true);
        expect(inner.destroy).toHaveBeenCalledWith("mb-1");
        expect(transport.isOpen("mb-1")).toBe(false);
    });

    it("registers a mailbox whose open fails, but doesn't count it open", async () => {
        const inner = worker();
        vi.mocked(inner.init).mockRejectedValueOnce(new Error("OPFS busy"));
        const transport = createMultiAccountWorkerTransport(inner, { signedInAccountCount: () => 2, activeAccountId });
        await expect(transport.init({ mailboxUid: "mb-1", indexKey: key })).rejects.toThrow("OPFS busy");
        expect(resolveMailboxAccount("mb-1")).toBe("acct-a");
        expect(transport.isOpen("mb-1")).toBe(false);
    });

    it("registers nothing while no account is active", async () => {
        const transport = createMultiAccountWorkerTransport(worker(), { signedInAccountCount: () => 2 });
        await transport.init({ mailboxUid: "mb-1", indexKey: key });
        await transport.pruneInaccessible(["mb-2"]);
        expect(resolveMailboxAccount("mb-1")).toBeUndefined();
        expect(resolveMailboxAccount("mb-2")).toBeUndefined();
    });

    it("signs out with several accounts by destroying only the active account's indexes, then reports it", async () => {
        const inner = worker();
        const transport = createMultiAccountWorkerTransport(inner, { signedInAccountCount: () => 2, activeAccountId });
        await transport.init({ mailboxUid: "mb-a1", indexKey: key });
        registerMailboxAccount("mb-a2", "acct-a");
        active = "acct-b";
        await transport.init({ mailboxUid: "mb-b1", indexKey: key });
        active = "acct-a";

        await expect(transport.destroyAll(3000)).resolves.toBe(true);
        expect(inner.destroyAll).not.toHaveBeenCalled();
        expect(vi.mocked(inner.destroy).mock.calls.map(([uid]) => uid).sort()).toEqual(["mb-a1", "mb-a2"]);
        expect(transport.isOpen("mb-a1")).toBe(false);
        expect(transport.isOpen("mb-b1")).toBe(true);
        expect(signedOut).toEqual(["acct-a"]);
    });

    it("reports a failed destroy of one of the active account's indexes", async () => {
        const inner = worker();
        vi.mocked(inner.destroy).mockResolvedValueOnce(false);
        registerMailboxAccount("mb-a1", "acct-a");
        registerMailboxAccount("mb-a2", "acct-a");
        const transport = createMultiAccountWorkerTransport(inner, { signedInAccountCount: () => 3, activeAccountId });
        await expect(transport.destroyAll(3000)).resolves.toBe(false);
        expect(signedOut).toEqual(["acct-a"]);
    });

    it("stops waiting for the active account's destroys at the timeout", async () => {
        vi.useFakeTimers();
        const inner = worker();
        vi.mocked(inner.destroy).mockReturnValue(new Promise<boolean>(() => undefined));
        registerMailboxAccount("mb-a1", "acct-a");
        const transport = createMultiAccountWorkerTransport(inner, { signedInAccountCount: () => 2, activeAccountId });
        const result = transport.destroyAll(3000);
        await vi.advanceTimersByTimeAsync(3000);
        await expect(result).resolves.toBe(false);
        expect(signedOut).toEqual(["acct-a"]);
    });

    it("destroys nothing and reports nothing when several accounts are signed in but none is active", async () => {
        const inner = worker();
        registerMailboxAccount("mb-a1", "acct-a");
        active = undefined;
        const transport = createMultiAccountWorkerTransport(inner, { signedInAccountCount: () => 2, activeAccountId });
        await expect(transport.destroyAll(3000)).resolves.toBe(true);
        expect(inner.destroy).not.toHaveBeenCalled();
        expect(inner.destroyAll).not.toHaveBeenCalled();
        expect(signedOut).toEqual([]);
    });

    it("signs out with one account through the worker's own wipe of every index, then reports it", async () => {
        const inner = worker();
        const transport = createMultiAccountWorkerTransport(inner, { signedInAccountCount: () => 1, activeAccountId });
        await transport.init({ mailboxUid: "mb-a1", indexKey: key });
        await expect(transport.destroyAll(3000)).resolves.toBe(true);
        expect(inner.destroyAll).toHaveBeenCalledWith(3000);
        expect(inner.destroy).not.toHaveBeenCalled();
        expect(transport.isOpen("mb-a1")).toBe(false);
        expect(signedOut).toEqual(["acct-a"]);
    });

    it("holds back a pending wipe of every index while several accounts are signed in", async () => {
        const inner = worker();
        let count = 2;
        const transport = createMultiAccountWorkerTransport(inner, {
            signedInAccountCount: () => count,
            pendingDeletionsKey: "pending",
        });
        localStorage.setItem("pending", JSON.stringify(["*"]));
        await expect(transport.retryPendingDeletions()).resolves.toBeUndefined();
        expect(inner.retryPendingDeletions).not.toHaveBeenCalled();

        count = 1;
        await transport.retryPendingDeletions();
        expect(inner.retryPendingDeletions).toHaveBeenCalledTimes(1);
    });

    it.each([[JSON.stringify(["mb-1"])], [null], ["not json"], ['{"0":"*"}']])(
        "retries other pending deletions with several accounts signed in (%s)",
        async (pending) => {
            const inner = worker();
            if (pending !== null) {
                localStorage.setItem(DEFAULT_PENDING_DELETIONS_KEY, pending);
            }
            const transport = createMultiAccountWorkerTransport(inner, { signedInAccountCount: () => 2 });
            await transport.retryPendingDeletions();
            expect(inner.retryPendingDeletions).toHaveBeenCalledTimes(1);
        }
    );
});

describe("watchKeyLocks", () => {
    const keySessionPath = "@rapidmx/web-client/lib/crypto/keySession.js";
    const builderPath = "@rapidmx/web-client/shared/search/localIndexBuilder.js";
    let listener: ((event: { mailboxUid: string; state: "locked" | "unlocked" }) => void) | undefined;
    const cancelLocalIndexBuild = vi.fn();

    beforeEach(() => {
        vi.resetModules();
        listener = undefined;
        cancelLocalIndexBuild.mockReset();
        vi.doMock(keySessionPath, () => ({
            subscribeKeySession: (subscriber: typeof listener) => {
                listener = subscriber;
                return () => undefined;
            },
        }));
        vi.doMock(builderPath, () => ({ cancelLocalIndexBuild }));
    });

    afterEach(() => {
        vi.doUnmock(keySessionPath);
        vi.doUnmock(builderPath);
    });

    it("cancels the build and destroys the index of an open mailbox whose keys are destroyed", async () => {
        const { watchKeyLocks: watch } = await import("../../src/lib/searchTransport.js");
        const destroyLocalIndex = vi.fn();
        await watch((uid) => uid === "mb-open", destroyLocalIndex);
        listener!({ mailboxUid: "mb-open", state: "locked" });
        expect(destroyLocalIndex).toHaveBeenCalledWith("mb-open");
        await vi.waitFor(() => expect(cancelLocalIndexBuild).toHaveBeenCalledWith("mb-open"));
    });

    it("ignores an unlock, and a lock of a mailbox with no open index", async () => {
        const { watchKeyLocks: watch } = await import("../../src/lib/searchTransport.js");
        const destroyLocalIndex = vi.fn();
        await watch((uid) => uid === "mb-open", destroyLocalIndex);
        listener!({ mailboxUid: "mb-open", state: "unlocked" });
        listener!({ mailboxUid: "mb-closed", state: "locked" });
        expect(destroyLocalIndex).not.toHaveBeenCalled();
    });

    it("still destroys the index when the builder can't be loaded", async () => {
        vi.doMock(builderPath, () => {
            throw new Error("offline");
        });
        const { watchKeyLocks: watch } = await import("../../src/lib/searchTransport.js");
        const destroyLocalIndex = vi.fn();
        await watch(() => true, destroyLocalIndex);
        listener!({ mailboxUid: "mb-open", state: "locked" });
        expect(destroyLocalIndex).toHaveBeenCalledWith("mb-open");
    });
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

    it("keeps web-client's own Worker transport until the native one is ready, with its prune gated", async () => {
        expect(NATIVE_SEARCH_TRANSPORT_READY).toBe(false);
        const setLocalIndexTransport = vi.fn();
        const workerPrune = vi.fn(() => Promise.resolve());
        const workerLocalIndexTransport = { search: vi.fn(), pruneInaccessible: workerPrune };
        vi.doMock(modulePath, () => ({ setLocalIndexTransport, workerLocalIndexTransport, destroyLocalIndex: vi.fn(), PENDING_DELETIONS_KEY: undefined }));
        const { installNativeSearchTransport: install } = await import("../../src/lib/searchTransport.js");
        let accounts = 2;
        await expect(install(resolver, { signedInAccountCount: () => accounts })).resolves.toBeUndefined();
        expect(setLocalIndexTransport).toHaveBeenCalledTimes(1);
        const installed = setLocalIndexTransport.mock.calls[0][0] as LocalIndexTransport;
        expect(installed.search).toBe(workerLocalIndexTransport.search);
        await installed.pruneInaccessible(["mb-1"]);
        expect(workerPrune).not.toHaveBeenCalled();
        accounts = 1;
        await installed.pruneInaccessible(["mb-1"]);
        expect(workerPrune).toHaveBeenCalledWith(["mb-1"]);
        expect(warnSpy).not.toHaveBeenCalled();
    });

    it("destroys an index the installed transport opened once its keys are destroyed, and holds back a wipe pending under web-client's key", async () => {
        const keySessionPath = "@rapidmx/web-client/lib/crypto/keySession.js";
        let listener: ((event: { mailboxUid: string; state: "locked" | "unlocked" }) => void) | undefined;
        vi.doMock(keySessionPath, () => ({
            subscribeKeySession: (subscriber: typeof listener) => {
                listener = subscriber;
                return () => undefined;
            },
        }));
        try {
            const setLocalIndexTransport = vi.fn();
            const destroyLocalIndex = vi.fn();
            const workerLocalIndexTransport = {
                init: vi.fn(() => Promise.resolve()),
                retryPendingDeletions: vi.fn(() => Promise.resolve()),
            };
            vi.doMock(modulePath, () => ({
                setLocalIndexTransport,
                workerLocalIndexTransport,
                destroyLocalIndex,
                PENDING_DELETIONS_KEY: "web-client-pending",
            }));
            const { installNativeSearchTransport: install } = await import("../../src/lib/searchTransport.js");
            await install(resolver, { signedInAccountCount: () => 2 });
            const installed = setLocalIndexTransport.mock.calls[0][0] as LocalIndexTransport;
            await installed.init({ mailboxUid: "mb-1", indexKey: new Uint8Array([1]) });
            listener!({ mailboxUid: "mb-2", state: "locked" });
            expect(destroyLocalIndex).not.toHaveBeenCalled();
            listener!({ mailboxUid: "mb-1", state: "locked" });
            expect(destroyLocalIndex).toHaveBeenCalledWith("mb-1");

            localStorage.setItem("web-client-pending", JSON.stringify(["*"]));
            await installed.retryPendingDeletions();
            expect(workerLocalIndexTransport.retryPendingDeletions).not.toHaveBeenCalled();
        } finally {
            localStorage.clear();
            vi.doUnmock(keySessionPath);
        }
    });

    it("never prunes when no account count is supplied", async () => {
        const setLocalIndexTransport = vi.fn();
        const workerPrune = vi.fn(() => Promise.resolve());
        vi.doMock(modulePath, () => ({
            setLocalIndexTransport,
            workerLocalIndexTransport: { pruneInaccessible: workerPrune },
            destroyLocalIndex: vi.fn(),
            PENDING_DELETIONS_KEY: undefined,
        }));
        const { installNativeSearchTransport: install } = await import("../../src/lib/searchTransport.js");
        await install(resolver);
        await (setLocalIndexTransport.mock.calls[0][0] as LocalIndexTransport).pruneInaccessible(["mb-1"]);
        expect(workerPrune).not.toHaveBeenCalled();
    });

    it("leaves the transport alone when this web-client build exports no Worker transport", async () => {
        const setLocalIndexTransport = vi.fn();
        vi.doMock(modulePath, () => ({ setLocalIndexTransport, workerLocalIndexTransport: undefined }));
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

describe("installNativeSearchTransport with web-client's real Worker transport", () => {
    const syncKey = (mailboxUid: string): string => `rapidmx:za-index-sync:${mailboxUid}`;

    beforeEach(() => {
        vi.resetModules();
        localStorage.clear();
    });

    it("signs out one of several accounts by destroying only its registered indexes, without wiping every index or closing the others", async () => {
        const { installNativeSearchTransport: install } = await import("../../src/lib/searchTransport.js");
        const rpc = await import("@rapidmx/web-client/shared/search/localIndexRpcClient.js");
        const registry = await import("../../src/lib/mailboxRegistry.js");
        const session = await import("../../src/lib/accountSession.js");
        registry.__resetMailboxRegistryForTests();
        registry.registerMailboxAccount("mine", "acct-a");
        registry.registerMailboxAccount("other-account", "acct-b");
        session.recordActiveAccount("acct-a");
        const signedOut = vi.fn();
        const unsubscribe = session.onShellSignOut(signedOut);
        const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
        await install(resolver, { signedInAccountCount: () => 2, activeAccountId: session.getActiveAccountId });
        try {
            await rpc.destroyAllLocalIndexes(1000);
            // No Worker in jsdom, so the destroy is left pending for the next load - for this account's
            // mailbox only, never as a wipe of every index on the device.
            expect(JSON.parse(localStorage.getItem(rpc.PENDING_DELETIONS_KEY)!)).toEqual(["mine"]);
            expect(signedOut).toHaveBeenCalledWith("acct-a");
        } finally {
            unsubscribe();
            warn.mockRestore();
            session.recordActiveAccount(undefined);
            rpc.setLocalIndexTransport(rpc.workerLocalIndexTransport);
        }
    });

    it("keeps another signed-in account's zero-access sync state through its mail view's prune, and forgets it once one account is left", async () => {
        const { installNativeSearchTransport: install } = await import("../../src/lib/searchTransport.js");
        const rpc = await import("@rapidmx/web-client/shared/search/localIndexRpcClient.js");
        let accounts = 2;
        await install(resolver, { signedInAccountCount: () => accounts });
        try {
            localStorage.setItem(syncKey("mine"), "{}");
            localStorage.setItem(syncKey("other-account"), "{}");
            await rpc.pruneInaccessibleLocalIndexes(["mine"]);
            expect(localStorage.getItem(syncKey("other-account"))).toBe("{}");

            accounts = 1;
            await rpc.pruneInaccessibleLocalIndexes(["mine"]);
            expect(localStorage.getItem(syncKey("mine"))).toBe("{}");
            expect(localStorage.getItem(syncKey("other-account"))).toBeNull();
        } finally {
            rpc.setLocalIndexTransport(rpc.workerLocalIndexTransport);
        }
    });
});
