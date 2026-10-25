///////////////////////////////////////////////////////////////////////////////
// Copyright (C) 2026 Jean-Philippe Steinmetz
// SPDX-License-Identifier: MPL-2.0
///////////////////////////////////////////////////////////////////////////////
import { readdirSync, readFileSync } from "fs";
import { resolve } from "path";
import { describe, expect, it } from "vitest";

const conf = JSON.parse(readFileSync(resolve(__dirname, "../src-tauri/tauri.conf.json"), "utf-8"));
const csp: Record<string, string> = conf.app.security.csp;
const sources = (directive: string): string[] => csp[directive].split(/\s+/);

describe("src-tauri/tauri.conf.json CSP", () => {
    it("lets the app show blob: images (contact photos, photo previews) and the servers' https images (branding)", () => {
        expect(sources("img-src")).toEqual(expect.arrayContaining(["'self'", "data:", "blob:", "https:"]));
    });

    it("keeps scripts, frames and plugins locked down", () => {
        expect(sources("script-src")).toEqual(["'self'"]);
        expect(sources("frame-src")).toEqual(["'none'"]);
        expect(sources("object-src")).toEqual(["'none'"]);
    });
});

describe("src-tauri/capabilities", () => {
    const dir = resolve(__dirname, "../src-tauri/capabilities");
    const permissions: string[] = readdirSync(dir)
        .filter((name) => name.endsWith(".json"))
        .flatMap((name) => JSON.parse(readFileSync(resolve(dir, name), "utf-8")).permissions ?? [])
        .map((permission: string | { identifier: string }) => (typeof permission === "string" ? permission : permission.identifier));

    it("grants the webview nothing from the secure keystore, so its JS can never read, replace or delete a refresh token", () => {
        expect(permissions.length).toBeGreaterThan(0);
        expect(permissions.filter((permission) => permission.startsWith("secure-keystore:"))).toEqual([]);
    });
});
