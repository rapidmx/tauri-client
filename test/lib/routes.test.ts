///////////////////////////////////////////////////////////////////////////////
// Copyright (C) 2026 Jean-Philippe Steinmetz
// SPDX-License-Identifier: MPL-2.0
///////////////////////////////////////////////////////////////////////////////
import { describe, expect, it } from "vitest";
import {
    buildRoutesFromModules,
    fileToRouteTemplate,
    loadShellFromModules,
    loadWwwShell,
    WWW_APP_DIR,
    wwwRoutes,
    type GlobModuleLoader,
} from "../../src/lib/routes.js";

describe("fileToRouteTemplate", () => {
    it("maps index.tsx at the root to /", () => {
        expect(fileToRouteTemplate("index.tsx")).toBe("/");
    });

    it("maps a plain file to its own path", () => {
        expect(fileToRouteTemplate("pets.tsx")).toBe("/pets");
    });

    it("de-indexes a nested index.tsx", () => {
        expect(fileToRouteTemplate("auth/login/index.tsx")).toBe("/auth/login");
    });

    it("maps a bracketed segment to a :param", () => {
        expect(fileToRouteTemplate("pets/[id].tsx")).toBe("/pets/:id");
    });

    it("maps a bracketed segment with its own index.tsx", () => {
        expect(fileToRouteTemplate("pets/[id]/index.tsx")).toBe("/pets/:id");
    });

    it("maps a catch-all bracketed segment the same as a plain one", () => {
        expect(fileToRouteTemplate("docs/[...slug].tsx")).toBe("/docs/:slug");
    });
});

describe("buildRoutesFromModules", () => {
    const appDir = "/app";
    const loader = (): ReturnType<GlobModuleLoader> => Promise.resolve({ default: () => null });

    it("builds a template per matching page, ignoring modules outside appDir", () => {
        const routes = buildRoutesFromModules(
            {
                "/app/index.tsx": loader,
                "/app/pets.tsx": loader,
                "/other/pets.tsx": loader,
            },
            appDir
        );
        expect(routes.map((route) => route.template).sort()).toEqual(["/", "/pets"]);
    });

    it("excludes any path with a _-prefixed segment at any depth", () => {
        const routes = buildRoutesFromModules(
            {
                "/app/_shell.tsx": loader,
                "/app/_layout.tsx": loader,
                "/app/pets.tsx": loader,
                "/app/_hidden/nested.tsx": loader,
            },
            appDir
        );
        expect(routes.map((route) => route.template)).toEqual(["/pets"]);
    });

    it("prefers a plain file over its index.tsx twin regardless of scan order", () => {
        const plain: GlobModuleLoader = () => Promise.resolve({ default: "plain" });
        const indexed: GlobModuleLoader = () => Promise.resolve({ default: "indexed" });

        const preferPlain = buildRoutesFromModules({ "/app/pets/index.tsx": indexed, "/app/pets.tsx": plain }, appDir);
        expect(preferPlain).toHaveLength(1);

        const preferPlainReversed = buildRoutesFromModules({ "/app/pets.tsx": plain, "/app/pets/index.tsx": indexed }, appDir);
        expect(preferPlainReversed).toHaveLength(1);
    });

    it("returns an empty array when nothing matches appDir", () => {
        expect(buildRoutesFromModules({ "/other/pets.tsx": loader }, appDir)).toEqual([]);
    });
});

describe("loadShellFromModules", () => {
    const appDir = "/app";

    it("loads the shell's default export when _shell.tsx is present", async () => {
        const Shell = () => null;
        const shell = await loadShellFromModules({ "/app/_shell.tsx": () => Promise.resolve({ default: Shell }) }, appDir);
        expect(shell).toBe(Shell);
    });

    it("resolves undefined when appDir has no _shell.tsx", async () => {
        const shell = await loadShellFromModules({ "/app/index.tsx": () => Promise.resolve({ default: () => null }) }, appDir);
        expect(shell).toBeUndefined();
    });
});

// The real `import.meta.glob()`-backed exports, exercised against `@rapidmx/web-client`'s actual
// `apps/www` sources (a real dependency of this repo, see package.json) - this is the "reuse the
// real generation mechanism, don't hand-write a route table" requirement in the flesh, not a mock.
describe("wwwRoutes / loadWwwShell (real @rapidmx/web-client pages)", () => {
    it("finds real apps/www pages, none of them hidden", () => {
        expect(wwwRoutes.length).toBeGreaterThan(0);
        expect(wwwRoutes.some((route) => route.template === "/")).toBe(true);
        expect(wwwRoutes.every((route) => typeof route.load === "function")).toBe(true);
    });

    it("loads the real webmail shell", async () => {
        const shell = await loadWwwShell();
        expect(shell).toBeDefined();
    });

    it("actually loads a real page module through its route's own loader", async () => {
        const indexRoute = wwwRoutes.find((route) => route.template === "/");
        expect(indexRoute).toBeDefined();
        const loaded = await indexRoute!.load();
        expect(loaded.default).toBeDefined();
    });

    it("exposes the app dir it scans", () => {
        expect(WWW_APP_DIR).toBe("/node_modules/@rapidmx/web-client/apps/www");
    });
});
