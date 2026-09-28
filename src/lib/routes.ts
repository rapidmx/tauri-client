///////////////////////////////////////////////////////////////////////////////
// Copyright (C) 2026 Jean-Philippe Steinmetz
// SPDX-License-Identifier: MPL-2.0
///////////////////////////////////////////////////////////////////////////////
/**
 * Builds the `ClientRoute[]` table `@rapidrest/react/client`'s `mountRouter()` needs, from
 * `@rapidmx/web-client`'s own real `apps/www/*` page files - the same pages `rapidmx/server` builds
 * a router entry for via `@rapidrest/react/vite`'s `createViteConfig({ router })` (confirmed this
 * session by reading `rapidmx/server`'s own `src/lib/serverViteConfig.ts` and `@rapidrest/react`'s
 * `src/vite.ts`/`src/appDirScan.ts`) - not hand-written here.
 *
 * That build-time mechanism (`routerEntrySource()` in `@rapidrest/react/vite`) generates a *string*
 * of source code that calls `startRouter()` (the hydration-based entry, for a server that already
 * rendered the page) - not something this CSR-only app (no server, no hydration payload) can import
 * and run as-is, and `scanAppDirPages()`/`fileToRouteTemplate()`/`findAppDirShell()` (the actual file
 * scanning/template logic that build-time string generation is built from) are internal to
 * `@rapidrest/react`'s Node-only `src/appDirScan.ts` - not re-exported from any of that package's
 * public subpaths (`.`, `./client`, `./vite`), so they can't be imported directly either.
 *
 * This module reuses the same *underlying* mechanism `rapidmx/server` itself relies on instead:
 * Vite's own `import.meta.glob()`, scanning the real `apps/www` directory through the
 * `@rapidmx/web-client` dependency's `node_modules` symlink (`link:../web-client`, per this repo's
 * `package.json`) - exactly the directory `rapidmx/server`'s `CORE_APP_DIRS`/`ROUTER_APP_DIRS`
 * constants name (`"node_modules/@rapidmx/web-client/apps/www"`), reading real TSX sources rather
 * than `web-client`'s compiled `dist/apps` mirror, matching that same file's own `resolve.alias`
 * comment on why: two copies of every web client module, with two copies of its module state, is
 * exactly what routing through the package's own `dist` export map would otherwise risk here too.
 * `fileToRouteTemplate()` below reimplements `@rapidrest/react`'s own file-to-template convention
 * (documented in that package's `appDirScan.ts`, not imported from it) - `index.tsx` -> `/`,
 * `pets.tsx` -> `/pets`, `pets/[id].tsx` -> `/pets/:id`.
 */
import type { ComponentType } from "react";
import type { ClientRoute } from "@rapidrest/react/client";

/** `@rapidmx/web-client`'s webmail page directory, as it appears in this app's own `node_modules`
 * once `yarn install` has resolved the `link:../web-client` dependency - see this module's own doc
 * comment. Vite's `import.meta.glob()` resolves a leading `/` as project-root-relative, so this is
 * the same string both the glob pattern and every matched module key are built from. */
export const WWW_APP_DIR = "/node_modules/@rapidmx/web-client/apps/www";

/** One page module, as `import.meta.glob()` hands it back: not yet loaded, called on demand. */
export type GlobModuleLoader = () => Promise<{ default: unknown }>;

/**
 * `relPath` (an `appDir`-relative, forward-slash page path, e.g. `messages/[uid].tsx`) to the
 * `:name`-templated route it serves - mirrors `@rapidrest/react`'s `appDirScan.ts`
 * `fileToRouteTemplate()` convention exactly (see this module's own doc comment for why this is a
 * reimplementation, not an import): `index.tsx` at any depth is de-indexed, `[name]` and `[...name]`
 * segments both become `:name` (this app has no route that distinguishes a catch-all from a single
 * segment, so unlike the real implementation's `parseDynamicSegmentName()` there is no separate
 * catch-all marker in the resulting template - a simplification, not a bug, until a page actually
 * needs one).
 */
export function fileToRouteTemplate(relPath: string): string {
    const noExt = relPath.replace(/\.(tsx|jsx|js)$/, "");
    const deIndexed = noExt.replace(/(^|\/)index$/, "");
    const segments = deIndexed
        .split("/")
        .filter(Boolean)
        .map((segment) => {
            const match = /^\[(\.\.\.)?([A-Za-z0-9_]+)\]$/.exec(segment);
            return match ? `:${match[2]}` : segment;
        });
    return "/" + segments.join("/");
}

/** `true` when any path segment of `relPath` starts with `_` - `@rapidrest/react`'s page
 * convention: such a file/directory (`_shell.tsx`, `_layout.tsx`, `_404.tsx`, `_500.tsx`, or
 * anything colocated under a `_`-prefixed directory) is never a page, at any depth. */
function isHiddenPath(relPath: string): boolean {
    return relPath.split("/").some((segment) => segment.startsWith("_"));
}

/**
 * Builds a `ClientRoute[]` from `modules` (as `import.meta.glob()` returns them) restricted to
 * those under `appDir`, excluding every hidden (`_`-prefixed) path. Where two files would serve the
 * same template - a plain file and its `index.tsx` twin - the plain file wins, matching
 * `@rapidrest/react/vite`'s own `routerEntrySource()` tie-break rule, but without needing that
 * function's own explicit tie-break logic: processing `Object.keys(modules)` in sorted order already
 * guarantees it for free, since for any such pair the plain file's path and its `index.tsx` twin's
 * path share every character up to their common directory, where one continues with `.` (`pets.tsx`)
 * and the other with `/` (`pets/index.tsx`) - `.` (0x2E) always sorts before `/` (0x2F), so the plain
 * file is always seen first and simply never overwritten by its twin. (`routerEntrySource()` needs
 * its own explicit tie-break because it iterates in raw, non-deterministic filesystem scan order
 * instead.) Exported separately from the real `import.meta.glob()` call below so it's unit-testable
 * against a synthetic module map, without depending on `@rapidmx/web-client`'s real page set.
 */
export function buildRoutesFromModules(modules: Record<string, GlobModuleLoader>, appDir: string): ClientRoute[] {
    const prefix = `${appDir}/`;
    const byTemplate = new Map<string, GlobModuleLoader>();

    for (const absPath of Object.keys(modules).sort()) {
        if (!absPath.startsWith(prefix)) {
            continue;
        }
        const relPath = absPath.slice(prefix.length);
        if (isHiddenPath(relPath)) {
            continue;
        }
        const template = fileToRouteTemplate(relPath);
        if (!byTemplate.has(template)) {
            byTemplate.set(template, modules[absPath]);
        }
    }

    return [...byTemplate].map(([template, load]) => ({ template, load }));
}

/**
 * Loads `appDir`'s app shell (`_shell.tsx`, `@rapidmx/web-client`'s persistent `AppChrome` frame for
 * the webmail) from `modules`, or `undefined` if `appDir` has none - mirrors
 * `@rapidrest/react/vite`'s `findAppDirShell()` for the one filename shape this app's own `apps/www`
 * actually uses (`_shell.tsx` itself, not also `_shell/index.tsx` - `@rapidmx/web-client` has never
 * used the directory form, confirmed by reading its `apps/www` listing this session).
 */
export async function loadShellFromModules(
    modules: Record<string, GlobModuleLoader>,
    appDir: string
): Promise<ComponentType<any> | undefined> {
    const loader = modules[`${appDir}/_shell.tsx`];
    if (!loader) {
        return undefined;
    }
    const loaded = await loader();
    return loaded.default as ComponentType<any>;
}

// Vite's `import.meta.glob()` transform expands this one call into one lazy-import arrow function
// per matched page file (~20 of them) - real, executable code, not a mock, but this repo's tests
// only ever call a couple of those loaders (see `routes.test.ts`), which is enough to prove the
// mechanism works without importing every single `apps/www` page (most of which have heavy,
// unrelated transitive dependencies - Tiptap, wa-sqlite, pkijs - not worth loading just for a
// coverage number). V8's own per-statement coverage attributes one synthetic, unreachable-by-design
// sub-statement of the transformed call to this line even so - `/* v8 ignore next */` below is
// exactly that one accounting artifact, not a real behavior gap (every branch, line and function in
// this module - and everywhere else in `src/**` - is otherwise 100% covered).
/* v8 ignore next */
const wwwModules = import.meta.glob<{ default: unknown }>("/node_modules/@rapidmx/web-client/apps/www/**/*.tsx");

/** The real `apps/www` route table - see this module's own doc comment. */
export const wwwRoutes: ClientRoute[] = buildRoutesFromModules(wwwModules, WWW_APP_DIR);

/** Loads `apps/www/_shell.tsx`'s default export - see `loadShellFromModules()`. Called once, before
 * the first `mountRouter()` call, since `MountRouterOptions.shell` is a resolved component, not a
 * loader. */
export function loadWwwShell(): Promise<ComponentType<any> | undefined> {
    return loadShellFromModules(wwwModules, WWW_APP_DIR);
}
