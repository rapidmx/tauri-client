///////////////////////////////////////////////////////////////////////////////
// Copyright (C) 2026 Jean-Philippe Steinmetz
// SPDX-License-Identifier: MPL-2.0
///////////////////////////////////////////////////////////////////////////////
/**
 * Installs `window.rapidmx`, the exact duck-type shim `@rapidmx/web-client` and
 * `@rapidmx/react-shared` already check for (confirmed this session by reading both):
 * `apps/shared/keyboard/platform.ts`'s `isElectronClient()` and
 * `apps/shared/search/localIndexSizePreference.ts`'s `isElectronRuntime()` both test only
 * `typeof window !== "undefined" && "rapidmx" in window` / `window.rapidmx !== undefined` - neither
 * reads anything off it at detection time. Recognized as "a desktop-class client" this way,
 * `web-client` picks up the 1 GB local-index default (`localIndexSizePreference.ts`'s
 * `ELECTRON_DEFAULT_BYTE_BUDGET_BYTES`) and the `Ctrl+N`/`Ctrl+Shift+T` keyboard bindings
 * (`platform.ts`'s `currentEnvironment().electron`) - both meant generically for "the desktop
 * shell", not literally Electron, despite the flag's name.
 *
 * Shape copied verbatim from `@rapidmx/electron-client`'s own `src/main/preload.ts`/
 * `src/renderer/global.d.ts` (confirmed by reading both) - `window.rapidmx.getConfig()` resolves the
 * `{ serverUrl, authServerUrl }` pair the signed-in shell renders against. Electron's version reads
 * this once, from its own main process, for the one account that process ever renders.
 * `tauri-client` is multi-account, so this module instead tracks whichever account is currently
 * *active* in the account-switcher UI (`setActiveAccountConfig()`, called by `src/App.tsx` on every
 * switch) and resolves `getConfig()` against that - `web-client`'s pages always see "the config of
 * the account currently on screen", which is the only account whose `window.rapidmx` should matter
 * to them at all (nothing in `web-client` is multi-account-aware; it was never going to be handed
 * more than one config at a time).
 */

/** What `window.rapidmx.getConfig()` resolves - mirrors `@rapidmx/electron-client`'s own
 * `RapidMxConfig` (`src/main/config.ts`) field-for-field. */
export interface RapidMxConfig {
    /** Base origin of the RapidMX server the active account's data comes from. */
    serverUrl: string;
    /** Base origin of the active account's separate auth-server deployment. */
    authServerUrl: string;
}

declare global {
    interface Window {
        /** See this module's own doc comment - installed by `installRapidMxShim()`, read by
         * `@rapidmx/web-client`/`@rapidmx/react-shared`'s desktop-client duck-typing. */
        rapidmx?: {
            getConfig: () => Promise<RapidMxConfig>;
        };
    }
}

let activeConfig: RapidMxConfig | undefined;

/**
 * Sets what the next `window.rapidmx.getConfig()` call resolves to - called by `src/App.tsx`
 * whenever the active account changes (including to `undefined`, when the last account is removed
 * or none has been chosen yet). Takes effect immediately; an in-flight `getConfig()` call already
 * awaiting a *previous* config is unaffected (this module never queues/replaces a promise already
 * handed out, only what the *next* call sees).
 */
export function setActiveAccountConfig(config: RapidMxConfig | undefined): void {
    activeConfig = config;
}

/**
 * Installs `window.rapidmx` - call this once, as early as possible in the frontend bootstrap
 * (`src/main.tsx`, before `mountRouter()` ever runs), per this module's own doc comment on why the
 * duck-type check needs the property to exist at all, independent of whether an account is active
 * yet. Safe to call more than once (idempotent - re-installs the same shape); safe in a non-browser
 * environment (a no-op, for symmetry with every other module here that guards `typeof window`).
 */
export function installRapidMxShim(): void {
    if (typeof window === "undefined") {
        return;
    }
    window.rapidmx = {
        getConfig: () =>
            activeConfig
                ? Promise.resolve(activeConfig)
                : Promise.reject(new Error("No RapidMX account is active yet.")),
    };
}
