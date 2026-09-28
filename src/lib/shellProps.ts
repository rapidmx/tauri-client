///////////////////////////////////////////////////////////////////////////////
// Copyright (C) 2026 Jean-Philippe Steinmetz
// SPDX-License-Identifier: MPL-2.0
///////////////////////////////////////////////////////////////////////////////
/**
 * Builds the props `mountRouter()`'s `resolveProps` hands to `@rapidmx/web-client`'s `apps/www`
 * shell (`_shell.tsx`'s `WwwShellProps`, confirmed this session by reading that file directly) for
 * the active account - the "shell-level data (branding/appearance/current-user)" this task's
 * briefing asks for, fetched through that account's own `ApiClient` rather than the cookie-based
 * global `apiFetch()` (per `createApiClient()`'s own doc comment, the whole reason this app doesn't
 * use that mode - see `src/lib/apiClients.ts`).
 *
 * Only `branding` has a confirmed, reachable endpoint: `GET /system/branding`
 * (`react-shared/src/branding/brandingApi.ts`'s `getBranding()`, which does NOT accept a `client`
 * parameter - `brandingApi.ts` is not one of the six modules this task's briefing confirms were
 * converted to accept one - so this calls `apiClient.fetch()` directly, per that briefing's own
 * instruction for exactly this situation, rather than waiting for a wrapped helper to exist).
 *
 * `appearance` and `userUid` are left `undefined` rather than guessed at - no confirmed endpoint for
 * either was found reachable from a bearer-token `ApiClient` this session (see `.claude/NOTES.md`'s
 * "what I had to guess at" list). `AppShell`/`AppChrome` already treat every one of these props as
 * optional and fall back to stock defaults, the same as the *server-rendered* path already does when
 * it has no props at all (`apps/www/_layout.tsx`'s own doc comment: "falling back to the stock
 * defaults there is acceptable") - so an `undefined` here is a real, working degraded state, not a
 * crash.
 */
import type { ApiClient } from "@rapidmx/react-shared/util/api.js";
import type { AccountSummary } from "./tauri.js";

/** Mirrors `react-shared/src/branding/brandingApi.ts`'s `Branding` - not imported from there
 * because that module's only exports are `apiFetch()`-bound functions this file deliberately
 * doesn't call (see this module's own doc comment); the type alone is small enough to restate. */
export interface Branding {
    companyName: string;
    title: string;
    logoUrl?: string;
    iconUrl?: string;
    stylesheetUrl?: string;
    headerHtml?: string;
    footerHtml?: string;
}

/** The subset of `apps/www/_shell.tsx`'s `WwwShellProps` this app can currently supply. */
export interface WwwShellDataProps {
    authServerUrl: string;
    branding?: Branding;
    appearance?: unknown;
    userUid?: string;
    impersonating?: boolean;
    trusted?: boolean;
}

/**
 * Resolves `account`'s shell props for `mountRouter({ resolveProps })`. Never throws - a failed
 * branding fetch (offline, a server not actually reachable, a 401 from a not-yet-refreshed token)
 * degrades to `branding: undefined` (logged, not surfaced as a fatal error) rather than blocking the
 * whole page mount over one optional decoration.
 */
export async function resolveWwwShellProps(account: AccountSummary, apiClient: ApiClient | undefined): Promise<WwwShellDataProps> {
    let branding: Branding | undefined;
    if (apiClient) {
        try {
            branding = await apiClient.fetch<Branding>("/system/branding");
        } catch (err) {
            console.warn(`[rapidmx] Could not fetch branding for "${account.label}":`, err);
        }
    }
    return {
        authServerUrl: account.authServerUrl,
        branding,
        appearance: undefined,
        userUid: undefined,
        impersonating: false,
        trusted: false,
    };
}
