///////////////////////////////////////////////////////////////////////////////
// Copyright (C) 2026 Jean-Philippe Steinmetz
// SPDX-License-Identifier: MPL-2.0
///////////////////////////////////////////////////////////////////////////////
/**
 * Adapts this app's real native Tier 2 search commands (`src-tauri/src/search/commands.rs`, wrapped
 * as `searchCommands` in `src/lib/tauri.ts`) to `@rapidmx/web-client`'s `LocalIndexTransport`
 * interface, so `web-client`'s own search call sites (`searchTier2.ts`, `LocalIndexLifecycle.tsx`,
 * `localIndexBuilder.ts`, ...) can run against this app's SQLCipher-backed Rust index instead of the
 * browser's Worker/OPFS/WASM one, unmodified - exactly the swap point `web-client`'s own
 * `apps/shared/search/localIndexTransport.ts` doc comment describes: "A host app with no
 * Worker/OPFS/WASM at all - tauri-client, backed instead by real SQLCipher-encrypted SQLite via a
 * Rust rusqlite invoke() command - implements this same shape and installs it once at startup via
 * localIndexRpcClient.ts's setLocalIndexTransport()."
 *
 * **`LocalIndexTransport` is NOT imported from `@rapidmx/web-client` here - it is re-declared below,
 * by hand, from a direct reading of that repo's source.** Two real problems, found this session,
 * make a real import impossible right now (see `.claude/NOTES.md`'s 2026-09-27 entry for the full
 * writeup - this is the single most important unverified-risk item this session found):
 *
 * 1. `apps/shared/search/localIndexTransport.ts` is uncommitted, in-progress source in `web-client`
 * (`git status` there shows it untracked, alongside a modified `localIndexRpcClient.ts` and a new
 * test file) - part of "a parallel effort landing around the same time as this task", per this
 * task's own briefing.
 * 2. `web-client`'s installable package (what `link:../web-client` actually resolves through its
 * `exports` map, i.e. `dist/apps/**`) has **not been rebuilt since that source landed** -
 * `dist/apps/shared/search/` has no `localIndexTransport.js`/`.d.ts` at all, and the compiled
 * `dist/apps/shared/search/localIndexRpcClient.js` has no `setLocalIndexTransport` export either
 * (confirmed by grepping both files directly). Since `web-client`'s `package.json` declares an
 * `exports` map, Node/TypeScript's module resolution refuses any subpath not listed there - there is
 * no way to import a file `dist/` doesn't have, and this task's hard constraints forbid rebuilding
 * `web-client` (a write outside this repo) to fix that here.
 *
 * The interface below is a byte-for-byte field mirror of the real
 * `apps/shared/search/localIndexTransport.ts` source as read this session - replace it with a real
 * `import type { LocalIndexTransport, ... } from "@rapidmx/web-client/shared/search/localIndexTransport.js"`
 * the moment `web-client` publishes a build that includes that file (delete this local copy at the
 * same time, don't keep both).
 *
 * **The runtime wiring has the same problem, handled defensively**: `installNativeSearchTransport()`
 * below dynamically imports `localIndexRpcClient.js` and only calls `setLocalIndexTransport` if it
 * actually exists as a function on the imported module - today (against the currently-installable
 * `@rapidmx/web-client`) it does not, so this is a documented, logged no-op until `web-client`'s dist
 * catches up, at which point this starts working with no code change here at all.
 */
import { searchCommands, type LocalIndexEntity as RustLocalIndexEntity } from "./tauri.js";

/** Mirrors `web-client`'s `apps/shared/search/localIndexWorker.ts` `GenerationParams`. */
export interface GenerationParams {
    generation?: number;
}

/** Mirrors `web-client`'s `InitParams` - see this module's own doc comment for why this is a local
 * copy, not an import. `indexKey` is the mailbox's already-HKDF-derived local-index key
 * (`localIndexKey.ts`'s `deriveLocalIndexKey()`), NOT the raw E2E master key `search_local_init`'s
 * own Rust-side naming (`master_key_base64`) implies - see `installNativeSearchTransport()`'s `init`
 * implementation below for exactly how this adapter reconciles that mismatch (flagged in
 * `.claude/NOTES.md` as a real, unresolved design gap, not silently papered over). */
export interface InitParams extends GenerationParams {
    mailboxUid: string;
    indexKey: Uint8Array;
}

export interface IndexEntitiesResult {
    budgetReached: boolean;
    evictedBefore?: string;
}

export interface WindowState {
    evictedBefore?: string;
}

export interface LocalSearchHit {
    entityUid: string;
    rank: number;
}

export interface LocalSearchPage {
    hits: LocalSearchHit[];
    hasMore: boolean;
}

export interface Coverage {
    indexedFrom?: string;
    indexedCount: number;
    building: boolean;
    complete: boolean;
    coveredUntil?: string;
}

/** Mirrors `web-client`'s `ParsedSearchQuery` (`@rapidmx/react-shared/search/queryGrammar.js`) -
 * the only part of that module's public API this adapter needs, so it's re-declared rather than
 * imported (that module IS resolvable via `react-shared`'s exports map, unlike `LocalIndexTransport`
 * - but keeping every type this file needs declared the same way, in one place, avoids a confusing
 * "some are imported, some aren't" split for a future reader tidying this up post-fix). */
export interface ParsedSearchQuery {
    text: string;
    from?: string;
    to?: string;
    cc?: string;
    subject?: string;
    hasAttachment?: boolean;
    before?: Date;
    after?: Date;
    folderUid?: string;
    flags?: string[];
}

export interface PruneLocalEntitiesOptions {
    folderUids?: string[];
    generation?: number;
}

export interface SetLocalIndexBuildingCompletion {
    complete: boolean;
    coveredFrom?: string;
    coveredUntil?: string;
    generation?: number;
}

/** Mirrors `web-client`'s `LocalIndexTransport` - see this module's own doc comment. */
export interface LocalIndexTransport {
    nextGeneration(): number;
    init(params: InitParams): Promise<void>;
    indexEntities(mailboxUid: string, entities: RustLocalIndexEntity[], generation?: number): Promise<IndexEntitiesResult>;
    removeEntity(mailboxUid: string, entityUid: string): Promise<void>;
    moveEntity(mailboxUid: string, entityUid: string, folderUid: string): Promise<void>;
    indexedVersions(mailboxUid: string, entityUids: string[]): Promise<Record<string, string>>;
    pruneEntities(
        mailboxUid: string,
        keepEntityUids: string[],
        since: string | undefined,
        options: PruneLocalEntitiesOptions
    ): Promise<number>;
    search(mailboxUid: string, parsed: ParsedSearchQuery, limit: number, offset: number): Promise<LocalSearchPage>;
    coverage(mailboxUid: string): Promise<Coverage>;
    setWindow(mailboxUid: string, timeFloorMonths: number, byteBudgetBytes: number, generation?: number): Promise<WindowState>;
    setBuilding(mailboxUid: string, building: boolean, completion: SetLocalIndexBuildingCompletion): Promise<void>;
    destroy(mailboxUid: string): Promise<boolean>;
    destroyAll(timeoutMs: number): Promise<boolean>;
    pruneInaccessible(accessibleMailboxUids: Iterable<string>): Promise<void>;
    retryPendingDeletions(): Promise<void>;
}

/** Base64-encodes raw key bytes without ever going through a `Blob`/`FileReader` - `btoa()` on a
 * binary string built one byte at a time, same trick `search_local_init`'s only other caller would
 * need. Small inputs only (a 32-byte derived key), so the loop is not a performance concern. */
function toBase64(bytes: Uint8Array): string {
    let binary = "";
    for (const byte of bytes) {
        binary += String.fromCharCode(byte);
    }
    return btoa(binary);
}

/** Not implemented: no Rust command exists yet for this operation (see this module's own doc
 * comment and `.claude/NOTES.md`'s follow-up list - `search/commands.rs` needs a matching
 * `#[tauri::command]` and `LocalIndexManager` method before this can do anything real). Rejects
 * immediately and clearly rather than hanging, so a caller's own error handling surfaces the gap
 * instead of a silent no-op. */
function notImplemented(operation: string): Promise<never> {
    return Promise.reject(
        new Error(`tauri-client's native search transport does not implement "${operation}" yet - see .claude/NOTES.md.`)
    );
}

/**
 * Builds a `LocalIndexTransport` backed by this app's real native Tier 2 search commands, for one
 * account at a time - `resolveAccountId` maps a `mailboxUid` (every method's own scoping key, per
 * the real interface - see this module's doc comment) back to whichever account owns it, since the
 * Rust side is scoped by account id, not mailbox id (`search/schema.rs`'s own "one database per
 * ACCOUNT" design decision). A `mailboxUid` this resolver doesn't recognize throws synchronously,
 * inside whichever method looked it up - every method here is async, so that surfaces as a rejected
 * promise like any other failure.
 */
export function createNativeSearchTransport(resolveAccountId: (mailboxUid: string) => string | undefined): LocalIndexTransport {
    let generation = 0;

    function accountIdFor(mailboxUid: string): string {
        const accountId = resolveAccountId(mailboxUid);
        if (!accountId) {
            throw new Error(`No account is registered for mailbox ${mailboxUid} - was it indexed before its account signed in?`);
        }
        return accountId;
    }

    return {
        // A fresh, monotonic generation needs no Rust involvement at all - it's purely this
        // transport instance's own counter, exactly as the real interface's own doc comment
        // describes ("A fresh, monotonic generation from this transport's own counter").
        nextGeneration(): number {
            generation += 1;
            return generation;
        },

        async init(params: InitParams): Promise<void> {
            const accountId = accountIdFor(params.mailboxUid);
            // `params.indexKey` is already a mailbox-scoped derived key (see this module's doc
            // comment on the real interface's own field comment); `search_local_init` re-derives
            // *again* from whatever it's handed, scoped by *account* id (`search/key.rs`). Passed
            // through as-is: real key material either way, just not the same derivation chain the
            // Rust side's own naming ("master_key_base64") implies - flagged, not silently hidden.
            await searchCommands.init(accountId, toBase64(params.indexKey));
        },

        async indexEntities(mailboxUid: string, entities: RustLocalIndexEntity[]): Promise<IndexEntitiesResult> {
            const accountId = accountIdFor(mailboxUid);
            await searchCommands.indexEntities(accountId, entities);
            // `search_local_index_entities` has no byte-budget eviction pass yet (see
            // `search/mod.rs`) - always reports "nothing evicted", the correct answer until that
            // exists.
            return { budgetReached: false };
        },

        async removeEntity(mailboxUid: string, entityUid: string): Promise<void> {
            const accountId = accountIdFor(mailboxUid);
            await searchCommands.removeEntity(accountId, entityUid);
        },

        moveEntity(): Promise<void> {
            return notImplemented("moveEntity");
        },

        indexedVersions(): Promise<Record<string, string>> {
            return notImplemented("indexedVersions");
        },

        pruneEntities(): Promise<number> {
            return notImplemented("pruneEntities");
        },

        async search(mailboxUid: string, parsed: ParsedSearchQuery, limit: number, offset: number): Promise<LocalSearchPage> {
            const accountId = accountIdFor(mailboxUid);
            const page = await searchCommands.search(
                accountId,
                mailboxUid,
                {
                    from: parsed.from,
                    to: parsed.to,
                    cc: parsed.cc,
                    subject: parsed.subject,
                    hasAttachment: parsed.hasAttachment,
                    before: parsed.before?.toISOString(),
                    after: parsed.after?.toISOString(),
                    folderUid: parsed.folderUid,
                    flags: parsed.flags ?? [],
                    text: parsed.text,
                },
                limit,
                offset
            );
            // `search_local_search` has no `limit + 1`-and-trim "more results exist" detection yet
            // (see `search/mod.rs`) - always reports "no more", the correct answer until that exists.
            return { hits: page.hits, hasMore: false };
        },

        async coverage(mailboxUid: string): Promise<Coverage> {
            const accountId = accountIdFor(mailboxUid);
            const coverage = await searchCommands.getCoverage(accountId, mailboxUid);
            // `search_local_get_coverage` only counts rows today (see `search/mod.rs`'s `Coverage`)
            // - it doesn't yet track a covered date range or whether a build pass ever completed, so
            // this conservatively reports "incomplete, not building" rather than fabricating values
            // a caller (e.g. Tier 3 narrowing) might treat as a real guarantee - see the real
            // interface's own doc comment on `complete`'s guarantee.
            return { indexedCount: coverage.entityCount, building: false, complete: false };
        },

        setWindow(): Promise<WindowState> {
            return notImplemented("setWindow");
        },

        setBuilding(): Promise<void> {
            return notImplemented("setBuilding");
        },

        async destroy(mailboxUid: string): Promise<boolean> {
            const accountId = resolveAccountId(mailboxUid);
            if (!accountId) {
                // Destroying an index for an already-forgotten mailbox is a no-op success, not an
                // error - matches the real interface's "never rejects" contract for this method.
                return false;
            }
            return searchCommands.destroy(accountId);
        },

        destroyAll(): Promise<boolean> {
            return searchCommands.destroyAll();
        },

        pruneInaccessible(): Promise<void> {
            return notImplemented("pruneInaccessible");
        },

        retryPendingDeletions(): Promise<void> {
            // Nothing is ever left "pending deletion" by this Rust backend today (deletes are
            // synchronous `DELETE` statements, not a queued/retried async cleanup the way the
            // browser's OPFS-based transport needs) - a real no-op success, not a gap.
            return Promise.resolve();
        },
    };
}

/**
 * Installs `createNativeSearchTransport()` as `web-client`'s active `LocalIndexTransport`, once, at
 * startup, before any search UI mounts - see this module's own doc comment for why this is currently
 * a safe, logged no-op rather than a real swap (the installable `@rapidmx/web-client` doesn't export
 * `setLocalIndexTransport` yet). Never throws.
 */
export async function installNativeSearchTransport(resolveAccountId: (mailboxUid: string) => string | undefined): Promise<void> {
    try {
        const module: Record<string, unknown> = await import("@rapidmx/web-client/shared/search/localIndexRpcClient.js");
        const setLocalIndexTransport = module.setLocalIndexTransport;
        if (typeof setLocalIndexTransport !== "function") {
            console.warn(
                "[rapidmx] @rapidmx/web-client does not export setLocalIndexTransport() in this build yet - " +
                    "the native SQLCipher search index is wired but not installed. See .claude/NOTES.md."
            );
            return;
        }
        (setLocalIndexTransport as (transport: LocalIndexTransport) => void)(createNativeSearchTransport(resolveAccountId));
    } catch (err) {
        console.warn("[rapidmx] Could not install the native search transport:", err);
    }
}
