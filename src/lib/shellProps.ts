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
 * `userUid` comes from auth-server's `/api/profiles/me`, read with this account's bearer session.
 * `appearance` stays `undefined`: no endpoint for it has been confirmed reachable from a
 * bearer-token `ApiClient`. `AppShell`/`AppChrome` already treat every one of these props as
 * optional and fall back to stock defaults, the same as the *server-rendered* path already does when
 * it has no props at all (`apps/www/_layout.tsx`'s own doc comment: "falling back to the stock
 * defaults there is acceptable") - so an `undefined` here is a real, working degraded state, not a
 * crash.
 */
import { createApiClient, type ApiClient } from "@rapidmx/web-client/lib/util/api.js";
import { getSessionToken, type AccountSummary } from "./tauri.js";

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
    const userUid = apiClient ? await currentUserUid(account) : undefined;
    return {
        authServerUrl: account.authServerUrl,
        branding,
        appearance: undefined,
        userUid,
        impersonating: false,
        trusted: false,
    };
}

/** The signed-in user's uid, from auth-server's own `/api/profiles/me` - the profile route the web
 * client's `getMyProfile()` reads, reached here with this account's bearer session instead of a
 * cookie. Undefined if it can't be read; the appearance cache is scoped by this uid, so an undefined
 * one simply means no per-user appearance. */
async function currentUserUid(account: AccountSummary): Promise<string | undefined> {
    try {
        const authClient = createApiClient({
            baseUrl: account.authServerUrl,
            getAccessToken: () => getSessionToken(account.id),
        });
        const profile = await authClient.fetch<{ uid: string }>("/profiles/me");
        return profile.uid;
    } catch (err) {
        console.warn(`[rapidmx] Could not read the signed-in user for "${account.label}":`, err);
        return undefined;
    }
}
