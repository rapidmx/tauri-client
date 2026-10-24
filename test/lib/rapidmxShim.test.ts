///////////////////////////////////////////////////////////////////////////////
// Copyright (C) 2026 Jean-Philippe Steinmetz
// SPDX-License-Identifier: MPL-2.0
///////////////////////////////////////////////////////////////////////////////
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { installRapidMxShim, setActiveAccountConfig } from "../../src/lib/rapidmxShim.js";

describe("rapidmxShim", () => {
    beforeEach(() => {
        setActiveAccountConfig(undefined);
        delete (window as { rapidmx?: unknown }).rapidmx;
    });

    it("installs window.rapidmx so desktop-client duck-typing recognizes this app", () => {
        installRapidMxShim();
        expect(window.rapidmx).toBeDefined();
        expect(typeof window.rapidmx?.getConfig).toBe("function");
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it("reports a desktop form factor on a computer and mobile in a phone or tablet web view", () => {
        installRapidMxShim();
        expect(window.rapidmx?.formFactor).toBe("desktop");
        vi.spyOn(navigator, "userAgent", "get").mockReturnValue("Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 wry");
        installRapidMxShim();
        expect(window.rapidmx?.formFactor).toBe("mobile");
    });

    it("rejects getConfig() when no account is active yet", async () => {
        installRapidMxShim();
        await expect(window.rapidmx!.getConfig()).rejects.toThrow("No RapidMX account is active yet.");
    });

    it("resolves getConfig() with whatever setActiveAccountConfig() last set", async () => {
        installRapidMxShim();
        setActiveAccountConfig({ serverUrl: "https://mail.example.com", authServerUrl: "https://auth.example.com" });
        await expect(window.rapidmx!.getConfig()).resolves.toEqual({
            serverUrl: "https://mail.example.com",
            authServerUrl: "https://auth.example.com",
        });
    });

    it("reflects a later setActiveAccountConfig(undefined) on the next call", async () => {
        installRapidMxShim();
        setActiveAccountConfig({ serverUrl: "https://mail.example.com", authServerUrl: "https://auth.example.com" });
        setActiveAccountConfig(undefined);
        await expect(window.rapidmx!.getConfig()).rejects.toThrow("No RapidMX account is active yet.");
    });

    it("is safe to call twice (idempotent)", () => {
        installRapidMxShim();
        const first = window.rapidmx;
        installRapidMxShim();
        expect(window.rapidmx).not.toBe(first);
        expect(typeof window.rapidmx?.getConfig).toBe("function");
    });
});
