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
 * 2. The linked `web-client`'s built `dist/apps/**` (what its `exports` map resolves) now ships
 * `shared/search/localIndexRpcClient.js` exporting `setLocalIndexTransport`, plus
 * `localIndexTransport.d.ts`. Only three of this interface's types are exported by that `.d.ts`
 * (`LocalIndexTransport`, `PruneLocalEntitiesOptions`, `SetLocalIndexBuildingCompletion`); the
 * parameter and result types below come from `web-client`'s worker and schema modules, which the
 * package does not export. The mirror is kept for the whole set so there is one consistent source
 * of truth here; it was checked field-for-field against the source when written and has not changed
 * since in `web-client`'s search modules.
 *
 * **The runtime wiring is real, with a defensive fallback**: `installNativeSearchTransport()` below
 * dynamically imports `localIndexRpcClient.js` and calls `setLocalIndexTransport` when it is present
 * as a function. The fallback (a logged warning, not a throw) only runs if a future `web-client`
 * build drops that export. **It is switched off** (`NATIVE_SEARCH_TRANSPORT_READY`) until this
 * transport can complete a build pass, so web-client's own Worker/OPFS transport stays installed,
 * wrapped so its prune and a shell sign-out never delete another signed-in account's indexes
 * (`createMultiAccountWorkerTransport()`).
 */
import { subscribeKeySession } from "@rapidmx/web-client/lib/crypto/keySession.js";
import { accountMailboxes, registerMailboxAccount } from "./mailboxRegistry.js";
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
    /** `flags` (`,a,b,`), when given, replaces the row's flags too. */
    moveEntity(mailboxUid: string, entityUid: string, folderUid: string, entityVersion?: string, flags?: string): Promise<void>;
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

        async moveEntity(mailboxUid: string, entityUid: string, folderUid: string, entityVersion?: string, flags?: string): Promise<void> {
            await searchCommands.moveEntity(accountIdFor(mailboxUid), entityUid, folderUid, entityVersion, flags);
        },

        indexedVersions(mailboxUid: string, entityUids: string[]): Promise<Record<string, string>> {
            return searchCommands.indexedVersions(accountIdFor(mailboxUid), entityUids);
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
            // Only this mailbox's rows: the account's one index file holds its other mailboxes too.
            return searchCommands.destroyMailbox(accountId, mailboxUid).catch(() => false);
        },

        destroyAll(): Promise<boolean> {
            return searchCommands.destroyAll();
        },

        pruneInaccessible(): Promise<void> {
            // Not implemented natively yet (no Rust command), but the interface promises this never
            // rejects - web-client calls it fire-and-forget on every mailbox-list change.
            return Promise.resolve();
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
 * Whether `installNativeSearchTransport()` replaces web-client's own Worker/OPFS transport. Off until
 * the native transport implements `pruneEntities`, `setWindow` and `setBuilding` (a build pass awaits
 * `setWindow` right after `init`) and mailboxes are registered with their accounts before its `init`
 * (`mailboxRegistry.ts`; only the Worker wrapper registers them today): installed before then, it
 * would replace a working transport with one that can't finish a single build. WebView2 and WKWebView
 * support Worker and OPFS, so the default works.
 */
export const NATIVE_SEARCH_TRANSPORT_READY = false;

/** web-client's `PENDING_DELETIONS_KEY` (`localIndexRpcClient.ts`), where its Worker transport lists the
 * deletions a page load could not finish; `"*"` there stands for every index on the device. */
export const DEFAULT_PENDING_DELETIONS_KEY = "rapidmx-localsearch-pending-deletions";
const ALL_INDEXES = "*";

/** Whether web-client's pending-deletions list holds a wipe of every index. */
function pendingWipeOfEveryIndex(pendingDeletionsKey: string): boolean {
    try {
        const pending: unknown = JSON.parse(localStorage.getItem(pendingDeletionsKey) ?? "[]");
        return Array.isArray(pending) && pending.includes(ALL_INDEXES);
    } catch {
        return false;
    }
}

export interface MultiAccountWorkerOptions {
    /** How many accounts are signed in (`apiClients.ts` `signedInAccountCount()`). */
    signedInAccountCount: () => number;
    /** The account whose shell is mounted (`accountSession.ts` `getActiveAccountId()`). */
    activeAccountId?: () => string | undefined;
    pendingDeletionsKey?: string;
}

/**
 * web-client's own Worker/OPFS `worker` transport, made safe for several accounts sharing this webview's
 * origin and so its OPFS. web-client assumes one user per origin.
 *
 * `pruneInaccessible` (on every mailbox-list change, with the active account's list) would delete every
 * other signed-in account's local index directories (a full download-and-decrypt rebuild of a zero-access
 * mailbox, with no full-text search until it finishes). It runs only while exactly one account is signed
 * in, which is also what clears a removed account's directories once only one account is left; until
 * then they stay, still encrypted under that mailbox's derived index key. The worker's prune also forgets
 * each pruned mailbox's zero-access sync state (`rapidmx:za-index-sync:`), so skipping it keeps the other
 * accounts' sync state too, and their next sync pass resumes rather than re-importing every segment.
 *
 * `destroyAll`, which only a sign-out calls (the shell's `signOutHost`, `accountSession.ts`), would delete
 * every account's indexes and mark the page signed out, so no index opens again until a reload. While
 * more than one account is signed in it destroys only the mailboxes registered to the active account
 * (`mailboxRegistry.ts`), one by one, within the same timeout; the worker's own destroy forgets each
 * one's zero-access sync state with it.
 *
 * `retryPendingDeletions` would finish an earlier load's interrupted wipe of every index, other accounts'
 * included; while more than one account is signed in it leaves such a list for a later load.
 *
 * `init` and `pruneInaccessible` register the mailboxes they name to the active account, which is how a
 * sign-out knows them.
 */
export function createMultiAccountWorkerTransport(
    worker: LocalIndexTransport,
    {
        signedInAccountCount,
        activeAccountId = () => undefined,
        pendingDeletionsKey = DEFAULT_PENDING_DELETIONS_KEY,
    }: MultiAccountWorkerOptions
): LocalIndexTransport {
    const severalSignedIn = (): boolean => signedInAccountCount() > 1;
    const register = (mailboxUid: string): void => {
        const accountId = activeAccountId();
        if (accountId) {
            registerMailboxAccount(mailboxUid, accountId);
        }
    };

    async function destroyAccountIndexes(accountId: string | undefined, timeoutMs: number): Promise<boolean> {
        const mailboxUids = accountId ? accountMailboxes(accountId) : [];
        // Each destroy never rejects, and records its own deletion for a retry when it fails.
        const work = Promise.all(mailboxUids.map((mailboxUid) => worker.destroy(mailboxUid))).then((results) =>
            results.every(Boolean)
        );
        let timer: ReturnType<typeof setTimeout> | undefined;
        const timeout = new Promise<boolean>((resolve) => {
            timer = setTimeout(() => resolve(false), timeoutMs);
        });
        const result = await Promise.race([work, timeout]);
        clearTimeout(timer);
        return result;
    }

    return {
        ...worker,
        init(params: InitParams): Promise<void> {
            // Registered first, so a sign-out still finds an index whose open failed halfway.
            register(params.mailboxUid);
            return worker.init(params);
        },
        destroyAll(timeoutMs: number): Promise<boolean> {
            return severalSignedIn() ? destroyAccountIndexes(activeAccountId(), timeoutMs) : worker.destroyAll(timeoutMs);
        },
        pruneInaccessible(accessibleMailboxUids: Iterable<string>): Promise<void> {
            const accessible = [...accessibleMailboxUids];
            accessible.forEach(register);
            return signedInAccountCount() === 1 ? worker.pruneInaccessible(accessible) : Promise.resolve();
        },
        retryPendingDeletions(): Promise<void> {
            return severalSignedIn() && pendingWipeOfEveryIndex(pendingDeletionsKey) ? Promise.resolve() : worker.retryPendingDeletions();
        },
    };
}

/**
 * Registers each mailbox unlocked while an account's shell is mounted to that account
 * (`mailboxRegistry.ts`), so a sign-out (`accountSession.ts` `createShellSignOutHost()`) destroys the keys
 * of a mailbox it unlocked but never opened an index for or listed. web-client itself destroys a mailbox's
 * open local index the moment its keys are destroyed (`localIndexRpcClient.ts`), whichever shell is mounted.
 */
export function registerUnlockedMailboxes(activeAccountId: () => string | undefined): void {
    subscribeKeySession(({ mailboxUid, state }) => {
        const accountId = activeAccountId();
        if (state === "unlocked" && accountId) {
            registerMailboxAccount(mailboxUid, accountId);
        }
    });
}

/**
 * Installs `web-client`'s active `LocalIndexTransport`, once, at startup, before any search UI mounts:
 * `createNativeSearchTransport()` when `enabled` (`NATIVE_SEARCH_TRANSPORT_READY` by default), and
 * otherwise web-client's own Worker/OPFS transport wrapped by `createMultiAccountWorkerTransport()` (left
 * as it is when this build exports no `workerLocalIndexTransport`). Either way the active account's
 * unlocks are registered to it (`registerUnlockedMailboxes()`). It stays defensive: a missing export logs a warning rather than throwing.
 * Never throws.
 */
export async function installNativeSearchTransport(
    resolveAccountId: (mailboxUid: string) => string | undefined,
    {
        enabled = NATIVE_SEARCH_TRANSPORT_READY,
        signedInAccountCount = () => 0,
        activeAccountId,
    }: { enabled?: boolean; signedInAccountCount?: () => number; activeAccountId?: () => string | undefined } = {}
): Promise<void> {
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
        const install = setLocalIndexTransport as (transport: LocalIndexTransport) => void;
        if (activeAccountId) {
            registerUnlockedMailboxes(activeAccountId);
        }
        if (enabled) {
            install(createNativeSearchTransport(resolveAccountId));
            return;
        }
        const worker = module.workerLocalIndexTransport as LocalIndexTransport | undefined;
        if (worker) {
            const pendingDeletionsKey = module.PENDING_DELETIONS_KEY as string | undefined;
            install(createMultiAccountWorkerTransport(worker, { signedInAccountCount, activeAccountId, pendingDeletionsKey }));
        }
    } catch (err) {
        console.warn("[rapidmx] Could not install the native search transport:", err);
    }
}
