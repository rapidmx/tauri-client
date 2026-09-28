///////////////////////////////////////////////////////////////////////////////
// Copyright (C) 2026 Jean-Philippe Steinmetz
// SPDX-License-Identifier: MPL-2.0
///////////////////////////////////////////////////////////////////////////////
import { beforeEach, describe, expect, it } from "vitest";
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
