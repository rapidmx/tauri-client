// @vitest-environment node
///////////////////////////////////////////////////////////////////////////////
// Copyright (C) 2026 Jean-Philippe Steinmetz
// SPDX-License-Identifier: MPL-2.0
///////////////////////////////////////////////////////////////////////////////
// Exercises `installRapidMxShim()`'s `typeof window === "undefined"` guard, which the rest of this
// suite's jsdom environment can never reach (jsdom always provides a `window`) - a real Tauri mobile
// worker context or a server-side prerender step (neither of which this app has today, but the guard
// exists for symmetry with every other module here that checks `typeof window`) is what this covers.
import { describe, expect, it } from "vitest";
import { installRapidMxShim } from "../../src/lib/rapidmxShim.js";

describe("installRapidMxShim (no window)", () => {
    it("is a no-op when there is no window global", () => {
        expect(typeof window).toBe("undefined");
        expect(() => installRapidMxShim()).not.toThrow();
    });
});
