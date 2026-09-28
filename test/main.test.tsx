///////////////////////////////////////////////////////////////////////////////
// Copyright (C) 2026 Jean-Philippe Steinmetz
// SPDX-License-Identifier: MPL-2.0
///////////////////////////////////////////////////////////////////////////////
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// src/main.tsx has module-level side effects (reads document.getElementById("root") and calls
// createRoot().render(...) at import time, mirroring electron-client's own renderer/main.tsx test
// pattern) - every test below does vi.resetModules() + a fresh dynamic import() so each scenario
// starts clean, and mocks react-dom/client + App.js so this stays a unit test of main.tsx's own
// two branches (container found vs. not), not an integration test of App itself (already covered
// by test/App.test.tsx).
const renderMock = vi.fn();
const createRootMock = vi.fn((container: Element) => {
    void container;
    return { render: renderMock };
});

const installRapidMxShimMock = vi.fn();
const installNativeSearchTransportMock = vi.fn();

vi.mock("react-dom/client", () => ({
    createRoot: (container: Element) => createRootMock(container),
}));
vi.mock("../src/App.js", () => ({
    App: () => null,
}));
// Both stubbed to plain sync no-ops: main.tsx's own two real modules (`rapidmxShim.ts`,
// `searchTransport.ts`) are unit-tested on their own (`test/lib/rapidmxShim*.test.ts`,
// `test/lib/searchTransport.test.ts`) - this file only needs to prove main.tsx calls them before
// rendering, not exercise what they do. Using the real (async, console-warning) `searchTransport.ts`
// here left a warning logged after this file's own environment had already torn down.
vi.mock("../src/lib/rapidmxShim.js", () => ({
    installRapidMxShim: () => installRapidMxShimMock(),
}));
vi.mock("../src/lib/searchTransport.js", () => ({
    installNativeSearchTransport: (...args: unknown[]) => installNativeSearchTransportMock(...args),
}));

beforeEach(() => {
    vi.resetModules();
    renderMock.mockClear();
    createRootMock.mockClear();
    installRapidMxShimMock.mockClear();
    installNativeSearchTransportMock.mockClear().mockResolvedValue(undefined);
    document.body.innerHTML = "";
});

afterEach(() => {
    document.body.innerHTML = "";
});

describe("src/main.tsx", () => {
    it("mounts the App into #root when it exists", async () => {
        const container = document.createElement("div");
        container.id = "root";
        document.body.appendChild(container);

        await import("../src/main.js");

        expect(installRapidMxShimMock).toHaveBeenCalledTimes(1);
        expect(installNativeSearchTransportMock).toHaveBeenCalledTimes(1);
        expect(createRootMock).toHaveBeenCalledWith(container);
        expect(renderMock).toHaveBeenCalledTimes(1);
    });

    it("throws when no #root element exists", async () => {
        await expect(import("../src/main.js")).rejects.toThrow('main.tsx: no element with id="root" found in index.html.');
        expect(createRootMock).not.toHaveBeenCalled();
    });

    it("installs window.rapidmx and the native search transport before anything else", async () => {
        const container = document.createElement("div");
        container.id = "root";
        document.body.appendChild(container);

        await import("../src/main.js");

        // Both installers run before `createRoot().render()` - `window.rapidmx` must exist, and the
        // search transport must be installed, before `App` (and anything it mounts) ever renders.
        expect(installRapidMxShimMock.mock.invocationCallOrder[0]).toBeLessThan(renderMock.mock.invocationCallOrder[0]);
        expect(installNativeSearchTransportMock.mock.invocationCallOrder[0]).toBeLessThan(renderMock.mock.invocationCallOrder[0]);
    });
});
