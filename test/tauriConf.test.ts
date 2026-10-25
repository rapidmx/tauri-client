///////////////////////////////////////////////////////////////////////////////
// Copyright (C) 2026 Jean-Philippe Steinmetz
// SPDX-License-Identifier: MPL-2.0
///////////////////////////////////////////////////////////////////////////////
import { readFileSync } from "fs";
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
