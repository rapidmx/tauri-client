# Code review notes — rapidmx/tauri-client

This file exists so that Claude sessions working in this repo don't re-litigate settled
decisions or re-discover the same issues from scratch. It is local to this repo (not tied to
any one machine's global Claude memory), so it travels with the code.

**Maintenance rule:** when a standing decision changes, update the section below in place
(don't just append a contradiction lower down). When a new investigation/session produces a
decision, finding, or reverted approach worth remembering, add a dated entry under Session Log.
Keep entries terse — this is a reference, not a transcript.

## Agent model assignments (JP, 2026-10-28)

Standing rule for every AI agent working on this project (applies to all RapidMX and RapidREST repositories):

General code and review is to be performed with Sonnet 5.5 (`claude-sonnet-5-5`), with architecture, planning and
investigation performed by Opus 5.5 (`claude-opus-5-5`). The following table details specific sub-categories or
specialties.

When categories overlap, the more specific one wins: for example, Security & Performance (Opus) overrides Code and Code
Review (Sonnet) for security and performance topics.

| Kind of work | Model |
|---|---|
| Design (specs, plans, architecture proposals) | Opus 5.5 (`claude-opus-5-5`) |
| Code (implementation, refactoring, evaluation) | Sonnet 5.5 (`claude-sonnet-5-5`) |
| Code Review (finding and verifying defects in diffs or code) | Sonnet 5.5 (`claude-sonnet-5-5`) |
| Security & Performance (analysis, code review, planning) | Opus 5.5 (`claude-opus-5-5`) |
| Simple operations (bash/terminal commands, file operations, project initialization and similar mechanical tasks) | Haiku 5.5 (`claude-haiku-5-5`) |

## Standing decisions

- **Commit discipline.** Never `git commit` unless explicitly asked for *that specific piece of
  work*. Default to leaving changes staged/unstaged (or, for a from-scratch repo, simply
  uncommitted after `git init`) and saying so. Same rule as `electron-client`'s own NOTES.md and
  every other sibling repo - copied here verbatim per that convention, not paraphrased.
- **Commit message style: a flat list of one-line, verb-led items — no summary/title line, no
  `-`/`*` bullet markers.** This is dictated by how `release` (`@rapidrest/cli`) builds
  `CHANGELOG.md` (`collectChangelogBullets`/`classifyChangelogLine` in that repo's
  `src/lib/release.ts` treat every non-blank line of a commit's full message as its own changelog
  bullet - no subject/body distinction, and a `-`/`*` prefix breaks that function's verb
  detection). Lead each line with an imperative verb where it fits (`Add`/`Fix`/`Remove`, `-ing`
  forms become `Added`/`Fixed`/`Removed`; anything else defaults to `Changed`). A blank line before
  a trailing git trailer (`Co-Authored-By:`, etc.) is fine; nothing else should follow the item
  list. Copied verbatim from `electron-client`'s own NOTES.md, which itself copied it verbatim per
  that entry's own instruction (see that file's 2026-09-secret history note on why paraphrasing it
  caused a real incident once).
- **Never bump the `version` field** - not in `package.json`, not in `src-tauri/Cargo.toml`, not
  in `src-tauri/tauri.conf.json`'s own `version` (three places version-like strings exist in this
  repo - keep all three in sync by hand if a real release ever bumps them, but that's JP's call to
  make, not something to do unprompted). This repo's initial `0.1.0` across all three is a
  from-scratch starting point, not a bump of anything previously published - normal and expected
  for a brand-new repo, not an exception to this rule.
- **Not yet part of the sibling repos' lock-step version train** (see
  `project_lockstep_versions` in JP's cross-repo memory) - this is a fresh repo with its own
  `0.1.0`. If/when JP folds it into that shared versioning scheme, that's his call to make
  explicitly, not something to infer or do preemptively.
- **This repo replaces `electron-client`, it does not extend it.** `electron-client` was an
  intentionally minimal proof-of-concept (see that repo's own NOTES.md: "one page, no router, no
  packaging... exists to prove `@rapidmx/web-client`'s components genuinely run outside
  `@rapidrest/react`'s SSR machinery, not to be a shippable desktop app"). This repo is the real,
  shippable follow-through - multi-account, multi-server, native search, mobile targets. Do not
  treat `electron-client` as still under active development once this repo's real UI lands;
  confirm with JP before making further Electron-side changes at that point.

## Verification status (updated 2026-09-27, third pass - a real toolchain landed mid-session)

**A Rust toolchain is now available and was used for real** (`cargo` 1.98.1 / `rustc` 1.98.1,
`x86_64-pc-windows-msvc`) - the "no toolchain in this sandbox" limitation the first two passes
documented no longer applies; don't re-derive that caveat from stale context. `cargo check`,
`cargo clippy`, `cargo test` (29/29 passing), and `cargo build --release` are all clean (zero
errors, zero warnings besides expected/harmless `LNK4099` linker notes - see below). The JS/
frontend side was already verified in the first two passes and is unaffected by this one.

Every item the earlier "Unverified Rust API assumptions" list flagged is now resolved, one way or
another:

1. **`tauri-plugin-secure-keystore`'s Rust-side API** - confirmed correct in shape
   (`SecureKeystoreExt::{set_item, get_item, delete_item}` exists), but the exact request/response
   types were wrong (`SetItemRequest { key, value }`, `ItemKey { key }`,
   `GetItemResponse { value: Option<String> }` - not bare `String`/`Option<String>` params).
   `keychain.rs` fixed against the crate's real source (now cached locally at
   `~/.cargo/registry/src/.../tauri-plugin-secure-keystore-0.0.3-beta.1/src/{lib,models}.rs`).
2. **hickory-resolver 0.26's error/lookup API** - `Resolver::builder_tokio()?.build()` needed a
   second `?` (`.build()` is itself fallible, `Result<Resolver<P>, NetError>` - the original code
   was missing that one). `Lookup` has no `.iter()`; use `.answers() -> &[Record]`. `Record`'s
   `data` is a public field (`pub data: RData`), not a method. `TXT` has no `.iter()` either; its
   chunks are the public field `txt_data: Box<[Box<[u8]>]>`. `federation/dns.rs` fixed accordingly;
   `.is_no_records_found()` turned out to exist and compile as originally guessed.
3. **FTS5 support** - moot now; see "encryption at rest without SQLCipher" below. Plain `bundled`
   SQLite's FTS5 (`-DSQLITE_ENABLE_FTS5` unconditional) is what's actually used, and it works -
   `search::schema::tests` (FTS5-backed query building) pass.
4. **SQLCipher's key-setting mechanism** - moot; SQLCipher itself was dropped (see below).
5. **`tauri::menu`'s predefined-role method names** - all correct as originally written; compiled
   clean, `menu::tests` pass.
6. **The `deep-link` plugin's `mobile` config shape** - compiles and matches the plugin's own
   `Deserialize` schema (a build-time-checked `tauri.conf.json` shape, not just a runtime guess);
   still **not** exercised against a real Android/iOS deep link delivery, which no CI here can do -
   the compile-time confirmation is real, but it's not the same as an end-to-end mobile test.
7. **`capabilities/default.json` permission identifier strings** - accepted by `tauri build`'s own
   schema validation (part of what `cargo build` now runs) - the identifiers were right.

**One real, unrelated compile bug this pass also found and fixed**: `oauth/mod.rs`'s
`PendingSignIn` needed a `Debug` impl for test assertions, but was deliberately given a **hand-
written** one (not `#[derive(Debug)]`) that redacts `code_verifier` - that field is a PKCE secret,
and a derived `Debug` would have printed it verbatim into any `{:?}`-formatted log line or test
failure message.

### Encryption at rest, without SQLCipher/OpenSSL (architecture change this pass)

JP's standing preference, stated directly this session: libsodium over OpenSSL in every project.
`bundled-sqlcipher-vendored-openssl` (the original design) turned out to be a real, hard blocker on
this machine - see "Session Log" below for the full story - and more fundamentally, **SQLCipher's
open-source build has no non-OpenSSL crypto provider that fits** (its other options - Apple
CommonCrypto, NSS, LibTomCrypt - aren't libsodium either, and `libsqlite3-sys` only wires up the
OpenSSL one regardless of which you'd want). SQLCipher itself was dropped, not just its crypto
backend swapped.

**New design**: plain `bundled` SQLite (`rusqlite` features: `bundled`, `functions`, `serialize` -
no SQLCipher variant at all). The live connection is *always* `Connection::open_in_memory()` - its
pages never touch disk, encrypted or not. Persistence is this crate's own job, one level up:
`search/mod.rs`'s `persist()` serializes the whole in-memory database (`Connection::serialize()`)
and encrypts that one blob with libsodium's XChaCha20-Poly1305 (`libsodium-rs` 0.2.5, jedisct1's
safe Rust bindings - not raw `libsodium-sys-stable` FFI) before writing it to disk; `open_or_rebuild()`
reverses that on startup via `deserialize_read_exact()` (not `deserialize()` directly, which needs
SQLite-allocated memory our own decrypted `Vec<u8>` isn't - `deserialize_read_exact()` allocates
that buffer itself and fills it from any `std::io::Read`, so a `Cursor` over the plaintext works
with no unsafe code on this side). A missing file, wrong/rotated key, corrupted blob, or stale
schema version are all treated identically: start over in memory, same discard-and-rebuild posture
the SQLCipher design already had.

**Real tradeoff, not free**: `persist()` runs after every mutating call (`index_entities()`,
`remove_entity()`), not on a debounced timer - correct and simple, but a real cost for a very large
configured byte budget (a multi-GB account re-serializing/re-encrypting its whole index on every
batch). A batched/debounced flush is the natural upgrade if that turns out to matter in practice;
deliberately not built this pass to keep scope to "correct and simple" rather than over-engineer
ahead of a real, observed need.

## Design decisions specific to this repo (not inherited from `electron-client`)

- **One encrypted-at-rest database file per ACCOUNT, not per mailbox** (`search/schema.rs`,
  `search/key.rs`) - the browser (`web-client`) implementation opens one database per *mailbox*.
  Consolidated here because: the task's own design section explicitly frames it as "one
  encrypted... database per ACCOUNT"; this index's whole-database encryption (see "Encryption at
  rest, without SQLCipher/OpenSSL" above - an in-memory connection persisted as one libsodium-
  encrypted blob, vs. the browser's hand-rolled per-page AES-GCM VFS, which only exists there
  because no SQLCipher WASM build exists) makes one connection per account strictly cheaper than
  per-mailbox; and it matches this app's own account-scoped keychain/account-store granularity
  everywhere else. The existing `entities.mailbox_uid` column (present in the browser schema too,
  mostly redundant there) does the real partitioning work here - every query is scoped by it
  explicitly.
- **The session JWT from `POST /oauth/session-token` is deliberately not persisted or returned
  anywhere yet** (`oauth::complete_sign_in`'s own doc comment) - this session's frontend has
  nowhere to use it (no CSR-mounted `web-client` pages yet). A future pass wiring that up needs to
  extend `complete_sign_in`'s return value (or add a sibling function) to hand it to whatever
  mounts an account's UI - it must still never touch disk, unlike the refresh token.
- **No positive/negative DNS caching in `federation::dns`**, unlike `restapi`'s server-side
  `FederationUtils.ts` (which caches for 24h/24h/60s via a `SimpleStore`) - this client only
  resolves a domain once per human-paced "Add account" click, not on every outbound message the
  way a mail server does, so the caching that actually matters is the account store itself (the
  result is persisted there once sign-in succeeds). Revisit only if this lookup is ever called
  from a hot path.
- **`electron-client`'s three-`tsconfig` split (base/main/test) collapsed to two** (`tsconfig.json`
  for `src/` alone, `tsconfig.test.json` for `src/`+`test/`) - there is no Electron main/renderer
  process split here, so there was never a reason for a third config in the first place. Mirrors
  the *shape* of that repo's convention (a base config `noEmit`, extended/widened by a test-scoped
  one) without carrying over a distinction that doesn't apply.
- **`tsconfig.eslint.json` exists but is not referenced by `eslint.config.mjs`'s `parserOptions.project`**
  - this mirrors `electron-client`'s own repo exactly (that file exists there too, also unreferenced
  by its own `eslint.config.mjs`). Kept for the same convention-parity reason, not because it's
  load-bearing - `tsconfig.json` and `tsconfig.test.json` are what lint's type-aware rules actually
  use, and are what should be run directly (`yarn tsc -p tsconfig.json --noEmit` /
  `yarn tsc -p tsconfig.test.json --noEmit`) to sanity-check the frontend, not
  `tsconfig.eslint.json` (which fails standalone: its `rootDir`-inheriting base config plus a
  `test/**` include pattern conflict when run as its own program).

## Session Log

### 2026-09-27 — Initial scaffold: repo conventions, full Rust module structure, placeholder frontend

First version of this repo. Primary deliverable of a larger multi-repo effort (see this repo's own
README for the parallel-effort dependencies this design assumes: `auth-server`'s
`/oauth/session-token` endpoint, `restapi`'s `.well-known/rapidmx/server-info` endpoint, and
`@rapidrest/react`/`@rapidmx/react-shared`'s new CSR-mount/explicit-context-client APIs - none of
which exist in this sandbox's checked-out sibling repos yet, per the task's own briefing).

- **Repo conventions copied from `electron-client`** verbatim where they transfer
  (`.editorconfig`, `.gitattributes`, `.npmignore`, `.prettier.json`, `.yarnrc.yml`, `LICENSE`
  (MPL-2.0, byte-for-byte copy), `eslint.config.mjs`, the `package.json` shape) and adapted where
  they don't (no Electron main/renderer split; `.gitignore` gained Rust/Tauri-specific entries;
  `tsconfig.json` dropped the `main`/`renderer` split - see "Design decisions" above).
- **Full `src-tauri/` module structure written** - `config`, `error`, `accounts` (+`store`),
  `keychain`, `federation` (+`dns`), `oauth` (+`pkce`), `deep_link`, `menu` (desktop-only, a direct
  port of `electron-client`'s `src/main/menu.ts` to `tauri::menu`), `search` (+`schema`, `key`,
  `commands`), `commands` (the account/sign-in commands the frontend actually calls). See "The
  single biggest constraint" section above for exactly what is and isn't verified.
- **`Cargo.toml` declares every plugin/feature this design needs**: `tauri-plugin-deep-link`,
  `tauri-plugin-opener` (not `tauri-plugin-shell` - see that file's own comment on why `opener` is
  the right one), `tauri-plugin-secure-keystore`, `rusqlite` with
  `bundled-sqlcipher-vendored-openssl`+`functions`, `hickory-resolver` with `tokio`+`system-config`,
  `hkdf`+`sha2`, `reqwest` with `rustls-tls`, plus the `[lib]` `crate-type` block Tauri's mobile
  build needs. Package versions were checked against current crates.io/npm listings via web search
  this session (not assumed from training-data-era memory, which would be badly stale for a
  September 2026 session) - see each dependency's own Cargo.toml comment for what was confirmed.
- **`tauri.conf.json`** configures the `deep-link` plugin for both desktop (`schemes: ["rapidmx"]`)
  and a best-effort mobile custom-scheme registration (see unverified-assumption #6 above), a real
  CSP (`app.security.csp`, tighter than `electron-client`'s dev-mode carve-out needed to be - no
  Vite Fast Refresh inline-script problem to work around under Tauri's own dev server injection),
  and a bundle icon set - see below.
- **Icons are placeholder, hand-generated, not `tauri icon`-generated** - `cargo tauri icon` (the
  normal way to produce a real icon set from one source image) needs a Rust toolchain this sandbox
  doesn't have. Instead, a small Node script (not committed - it lived in the session's scratchpad,
  not this repo) generated structurally-valid solid-color PNGs at every size `tauri.conf.json`'s
  `bundle.icon` and the Windows Store manifest sizes reference, plus a minimal single-image `.ico`
  and `.icns` that wrap a PNG payload directly (both formats support embedded PNG icon data
  natively - Vista+ for `.ico`, Mac OS X 10.7+ `ic07` for `.icns`). These are real, openable image
  files, just an unbranded placeholder color - replace with real branding and regenerate via
  `cargo tauri icon` once a toolchain is available, per the Power Level branding conventions
  documented in JP's cross-repo memory (`project_powerlevel_branding`) if this app ends up
  White-labeled/rebranded, or RapidMX's own mark otherwise.
- **`src/lib/webClientBridge.ts` was the one deliberate frontend stub this pass** - documented the
  expected `mountRouter()`/`createApiClient()` contract without calling either. **Deleted in the
  2026-09-27 (second pass) session below** once both APIs landed for real and its role was fully
  absorbed into `src/lib/routes.ts`/`apiClients.ts`/`shellProps.ts`/`App.tsx` - see that entry.
- **Frontend (`src/App.tsx` + `src/lib/tauri.ts`) is a real, fully tested placeholder** - lists
  accounts already on disk, lets the user add one (kicks off `resolve_server` then `add_account`,
  both real Rust commands), removes one, and reacts to the two events the deep-link/OAuth flow
  emits (`rapidmx://account-added`, `rapidmx://sign-in-error`). `@tauri-apps/api`'s `invoke`/`listen`
  are mocked in tests (no real Tauri runtime in `vitest run`, same limitation `electron-client`'s
  own tests have with `electron`).
- **Actually run and green this session** (Node/Yarn ARE available here): `yarn install`,
  `yarn eslint ./src ./test` (0 errors), `yarn tsc -p tsconfig.json --noEmit` and
  `-p tsconfig.test.json --noEmit` (both clean), `yarn vitest run --coverage` (24 tests, 3 files,
  **100% statements/branches/functions/lines** across `src/**` - matches this codebase's standing
  100%-coverage-where-possible convention), and `yarn build` (tsc + `vite build`, real production
  output in `dist/`).
- **Real bug found and fixed by actually running `yarn build`**: `vite.config.ts`'s original
  `build.minify: "esbuild"` (a reasonable-looking, common Vite option) fails a real build on this
  repo's pinned Vite 8.3.1 - that version no longer bundles `esbuild` as a direct dependency for
  its own minifier (it's moved toward rolldown/oxc), so requesting it by name throws
  `Cannot find package 'esbuild'` rather than silently falling back. Fixed by using plain
  `minify: !TAURI_ENV_DEBUG` (a boolean) so Vite picks whatever its own current default minifier
  is, instead of naming one that isn't actually available. A `tsc --noEmit`-only check would never
  have caught this - only actually building did.
- **Not run this session, and cannot be in this sandbox**: `cargo check`/`cargo build`/`cargo test`/
  `cargo clippy` (no Rust toolchain at all - confirmed by checking `PATH`), `tauri dev`/`tauri build`
  (same reason, plus needs the frontend `dist/` this repo's own `yarn build` does produce), any
  real OAuth sign-in against a live `auth-server`, any real DNS lookup, any real keychain write, any
  real SQLCipher database open, an actual window on an actual display, and `tauri android
  init`/`tauri ios init` (so `src-tauri/gen/` doesn't exist in this repo yet - see `.gitignore`'s
  own note on that directory).
- **`git init` run, nothing committed** - same standing rule as every sibling repo; JP reviews and
  commits when ready.

### 2026-09-27 (second pass) — Wired against the real `@rapidrest/react`/`@rapidmx/react-shared`/
`@rapidmx/web-client` APIs the first pass could only stub against a guessed contract

The three parallel efforts the first pass's `src/lib/webClientBridge.ts` was waiting on all landed
this session (per this task's own briefing): `@rapidrest/react/client`'s `mountRouter()`,
`@rapidmx/react-shared`'s `createApiClient()`, `auth-server`'s `POST /oauth/session-token`, and
`restapi`'s `.well-known/rapidmx/server-info`. `webClientBridge.ts` is now **deleted** - its role is
fully absorbed into real code (see below), nothing in this repo imports it anymore.

**What's wired for real:**

- **`package.json`**: added `@rapidmx/react-shared` and `@rapidmx/web-client` as `link:../react-shared`/
  `link:../web-client` (mirroring `electron-client` exactly - both live in this same `rapidmx/` parent
  directory). `@rapidrest/react` is **`link:../../rapidrest/react`, not a semver npm range** - see the
  "Unverified/guessed" list below, item 1, for why that had to change from the first attempt.
- **`window.rapidmx` shim** (`src/lib/rapidmxShim.ts`) - shape confirmed by reading `electron-client`'s
  own `src/main/preload.ts`/`src/renderer/global.d.ts` directly: `{ getConfig: () => Promise<{serverUrl,
  authServerUrl}> }`. Installed in `main.tsx`, before `App` ever renders (confirmed by a dedicated
  `main.test.tsx` case asserting call order). Tracks whichever account is *active* in the switcher (not
  a single fixed config the way Electron's single-account shell can) via `setActiveAccountConfig()`,
  called from `App.tsx`'s mount effect on every account switch, including to `undefined` when no
  account is active - `getConfig()` rejects clearly in that state rather than resolving garbage.
- **Per-account `ApiClient`s** (`src/lib/apiClients.ts`) - one `createApiClient()` instance per account
  the Rust side lists (`syncApiClients()`, called from an effect keyed on the `accounts` array),
  `getAccessToken` wired to the new `get_session_token` Tauri command (real OAuth refresh grant +
  `/oauth/session-token` exchange, in Rust, on every call - see `oauth::refresh_session_token`'s
  updated doc comment). No locked/unlocked distinction exists yet (see this file's existing "Future
  work" below), so "every account the store lists" is treated as "every signed-in account" - correct
  today, since an account only ever enters the store via a completed OAuth exchange.
- **The real `apps/www` route table** (`src/lib/routes.ts`) - built via Vite's `import.meta.glob()`
  against `@rapidmx/web-client`'s actual `node_modules/@rapidmx/web-client/apps/www/**/*.tsx` (the
  same directory `rapidmx/server`'s own `src/lib/serverViteConfig.ts` names as `CORE_APP_DIRS`/
  `ROUTER_APP_DIRS`, confirmed by reading that file and `@rapidrest/react`'s `src/vite.ts`/
  `src/appDirScan.ts` directly), not hand-written. `fileToRouteTemplate()` reimplements
  `appDirScan.ts`'s file-to-template convention by hand (that function isn't part of
  `@rapidrest/react`'s public API surface - only `createViteConfig` and a few Node-only build helpers
  are, via the `./vite` subpath, and none of them produce a plain runtime `ClientRoute[]` a CSR-only
  app like this one can just call). `loadWwwShell()` loads `apps/www/_shell.tsx`'s real `AppChrome`
  frame the same way. Both are exercised in `test/lib/routes.test.ts` against the **real** linked
  `@rapidmx/web-client` dependency, not a mock - genuinely proven to find real pages, not just
  plausible-looking test code.
- **`App.tsx`** - a real (still simple) account-switcher shell: a sidebar (click an account to make it
  active, "Add account" form, "Remove"), a `#app-mount` container `key`ed by the active account's id
  (so switching accounts gives `mountRouter()` a fresh, unmounted DOM node each time - see that file's
  own doc comment for why that's load-bearing, not decorative), and "Open admin console"/"Open escrow
  console" buttons that call `@tauri-apps/plugin-opener`'s `openUrl()` against the active account's own
  `serverUrl` rather than mounting either console in-app, per the approved plan. `resolveProps` supplies
  shell data (`src/lib/shellProps.ts`) fetched through the active account's own `ApiClient`.
- **The native search transport adapter** (`src/lib/searchTransport.ts`) - implements
  `LocalIndexTransport` (the *real*, landed interface - see the "Unverified/guessed" list below, item 2,
  for why it's a hand-copied mirror rather than an import) over the existing native Tier 2 Rust commands.
  `nextGeneration()`, `init()`, `indexEntities()`, `removeEntity()`, `search()`, `coverage()`,
  `destroy()`, `destroyAll()`, `retryPendingDeletions()`, `moveEntity()` and `indexedVersions()` are real
  (the last two added 2026-10-23 for zero-access search: a move records the caller's `entityVersion` or
  clears it, and `UPSERT_ENTITY_SQL` now keeps a known `folder_uid` and `flags` when an imported segment
  document carries none, matching web-client's `localIndexSchema.ts`). `pruneEntities()`, `setWindow()`,
  `setBuilding()` reject clearly ("does not implement ... yet"), and `pruneInaccessible()` resolves as a
  no-op (its contract is never-rejects; 2026-10-24) - **no Rust command exists for any of these four yet**; extending
  `search/commands.rs` + `LocalIndexManager` (`search/mod.rs`) with matching methods is real follow-up
  work, not just a TODO comment. `src/lib/mailboxRegistry.ts` (a tiny `mailboxUid -> accountId` map) is
  what lets this adapter satisfy an interface keyed only by `mailboxUid` from a Rust backend keyed by
  `accountId` - **nothing populates it yet** (no mailbox-listing UI exists this pass either); a future
  pass wiring real Mail UI needs to call `registerMailboxAccount()` once it learns an account's mailbox
  uids.
- **Rust**: `oauth::begin_sign_in` now sends `scope=openid profile email offline_access`
  (`config::OAUTH_SCOPE`) - confirmed required or `/oauth/token` issues no refresh token at all.
  `federation::fetch_server_info` now treats an empty `authServerUrl` string (not a 404) as "this
  deployment has no auth-server configured", per the confirmed contract, returning a clear
  `AppError::Federation` instead of quietly carrying the empty string into a broken `/oauth/authorize`
  URL later. A new `get_session_token` command (`commands.rs`, registered in `lib.rs`) wraps the
  already-existing (but previously unwired-to-anything) `oauth::refresh_session_token` for the
  frontend's `getAccessToken` callback.

**Actually run and green this session** (same sandbox, Node/Yarn available, no Rust toolchain):
`yarn install` (twice - see item 1 below), `yarn eslint ./src ./test` (0 errors), `yarn tsc -p
tsconfig.json --noEmit` and `-p tsconfig.test.json --noEmit` (both clean), `yarn vitest run
--coverage` (**97 tests, 10 files, 100% statements/branches/functions/lines** across `src/**` - one
line in `routes.ts` carries a `/* v8 ignore next */` for a V8-coverage accounting artifact of Vite's
`import.meta.glob()` transform, not a real untested behavior - see that line's own comment), and
**`yarn build`** (`tsc` + real `vite build`) - **succeeded**, producing a real ~5 MB `dist/` with every
real `apps/www` page code-split (calendar, contacts, tasks, settings, mail, compose, S/MIME, the whole
real component tree), proving the wiring in this section isn't just type-checking cleanly but actually
bundles. Some `TOLERATED_TRANSFORM`/lightningcss warnings (BigInt literals in `wa-sqlite`'s WASM glue
targeted below their needed runtime; an unrecognized `@theme` at-rule since this app's own `vite.config.ts`
doesn't run Tailwind - it never imports `web-client`'s `app.css`, so pages render unstyled today) - noted
as real, minor gaps below, not build failures.

**Unverified/guessed, ranked most-important-to-check-first:**

1. **`@rapidrest/react` is consumed via `link:../../rapidrest/react`, not the `^2.1.0` on npm** -
   confirmed by trying the npm version first: `mountRouter`/`startRouter`/`ClientRoute` etc. genuinely
   don't exist in the published `2.1.0` (checked `node_modules/@rapidrest/react/dist/client/client.d.ts`
   directly - no `mountRouter` export). The *local* `D:\github\rapidrest\react` checkout has the same
   `"2.1.0"` version string in its own `package.json` but its `git status` shows uncommitted, in-progress
   changes to `src/router.ts`/`src/client.ts` (plus new test files) - a version that was never actually
   published. Its local `dist/` **is** rebuilt with the new exports (confirmed - newer mtime than the
   modified `src/`), so `link:`ing straight to that checkout (same pattern the task briefing itself
   floated: "link:../../rapidrest/react or similar") is what actually works today. **Once `rapidrest/react`
   publishes a real release containing `mountRouter`, switch this back to a semver range** (matching how
   `web-client` itself already depends on `@rapidrest/react`) - a `link:` to a sibling checkout's local,
   uncommitted state is not something to ship.
2. **`src/lib/searchTransport.ts`'s `LocalIndexTransport` interface is hand-copied, not imported** -
   confirmed the real, landed shape by reading `web-client`'s `apps/shared/search/localIndexTransport.ts`
   directly (15 methods, keyed by `mailboxUid` only - materially different from this task's own guessed
   12-function list, which this session's local copy replaced once the real shape was found). It's
   re-declared locally because `web-client`'s *installable* package can't serve it two different ways
   right now: (a) `apps/shared/search/localIndexTransport.ts` is itself uncommitted/untracked source in
   `web-client` (`git status` there shows it, plus a modified `localIndexRpcClient.ts` and a new test
   file - the "parallel effort landing around the same time as this task" the briefing mentions), and
   (b) **`web-client`'s own `dist/` has not been rebuilt since**: `dist/apps/shared/search/` has no
   `localIndexTransport.js`/`.d.ts` at all, and the compiled `dist/apps/shared/search/
   localIndexRpcClient.js` has **no `setLocalIndexTransport` export either** (confirmed by grepping both
   files directly) - unlike the `@rapidrest/react` situation above, `web-client`'s own `dist/` genuinely
   is stale even in the local checkout, so there was no working `link:` escape hatch here consistent
   with this task's hard constraint against modifying `web-client` itself (rebuilding it would touch a
   repo outside this task's scope). **Practical effect**: `installNativeSearchTransport()`
   (`searchTransport.ts`) dynamically imports the real `localIndexRpcClient.js` and only calls
   `setLocalIndexTransport` if it actually exists as a function - today it doesn't, so this is a
   real, logged (`console.warn`), non-fatal no-op every app start, confirmed by `main.test.tsx`'s
   captured stderr output. **This starts working with zero code changes here** the moment `web-client`
   publishes (or even just locally rebuilds) a `dist/` that includes `localIndexTransport.js` and the
   updated `localIndexRpcClient.js` - re-verify then, and delete this file's local type mirror in favor
   of a real `import type ... from "@rapidmx/web-client/shared/search/localIndexTransport.js"`.
3. **`search_local_init`'s `master_key_base64` and the real `LocalIndexTransport.init()`'s `indexKey`
   are not the same kind of key** - confirmed by reading both sides: the real interface's own field
   comment says `indexKey` is "the mailbox's already-derived local-index key
   (`localIndexKey.ts`'s `deriveLocalIndexKey()`)", i.e. already HKDF-derived and mailbox-scoped, while
   `search_local_init`/`search/key.rs`'s `derive_local_index_key()` re-derives *again*, scoped by
   *account* id, from whatever it's handed. `searchTransport.ts`'s `init()` passes the transport's
   `indexKey` bytes straight through as if they were the raw master key - real key material either way
   (so it won't crash), but not the derivation chain either side's own naming implies, and not something
   this session could resolve cleanly without either changing the Rust command's contract (add a
   variant that skips its own derivation) or `web-client`'s (out of scope - can't modify that repo).
   Flagged in `searchTransport.ts`'s own doc comment; needs a real design decision, not just a code fix.
4. **Deep, unresolved gap: most of `web-client`'s own `apps/www` page components have no way to reach a
   per-account bearer-token `ApiClient` at all**, confirmed by reading `_shell.tsx`/`AppShell.tsx` and
   `react-shared`'s own package.json: only 6 of `react-shared`'s ~40 REST modules
   (`mailApi`/`labelsApi`/`conversationsApi`/`searchApi`/`calendarApi`/`contactsApi`) accept an optional
   trailing `client?: ApiClient` at all, and **nothing in `web-client`'s own component tree passes one
   even to those six** - every page/hook just calls e.g. `getMailboxes()` with no arguments, relying on
   the global `apiFetch()`/`jwt` cookie, which a native multi-account bearer-token client fundamentally
   doesn't have. This session's `ApiClient`s are real and correctly wired for the two things they *can*
   reach today - `resolveProps`'s shell-level `apiClient.fetch("/system/branding")` call, and any future
   code that explicitly imports one of the six converted modules and passes a `client` - but the
   *mounted pages themselves* (mail list, calendar, etc.) will very likely 401 the moment they're
   actually exercised in a real webview, since nothing threads an `ApiClient` into their own data
   fetching. Also confirmed: `AppShell.tsx`'s `useSessionRefresh(userUid, authServerUrl, ...)` assumes a
   cookie-based session to refresh, another cookie-shaped assumption this bearer-token app doesn't
   satisfy. **Fixing this for real needs `web-client` to add something like an `ApiClientContext` its
   pages/hooks read from - out of scope here** (this task's hard constraint: don't modify `web-client`).
   This is the single most important open question for whoever picks this up next - not a small gap.
5. **`resolveWwwShellProps()`'s `appearance` and `userUid` are `undefined`, not guessed at** - no
   confirmed endpoint reachable from a bearer-token `ApiClient` was found for either this session (see
   `shellProps.ts`'s own doc comment for what was checked: `react-shared`'s `profileApi.ts` only talks
   to *auth-server*, not this server, via `authApiFetch`, which is cookie-based cross-origin and not
   something an `ApiClient` wraps). Only `branding` (`GET /system/branding`, confirmed real and public)
   is actually fetched.
6. Every "Unverified Rust API assumptions" item from the first pass was, at the time, still
   unverified - this session touched `oauth/mod.rs`, `federation/mod.rs`, `commands.rs`, and
   `config.rs` but had no Rust toolchain to check any of it against. **Resolved in the next pass**
   - see "Verification status" near the top of this file, and the dated entry below.

### 2026-09-27 (third pass) — A real toolchain landed; libsodium replaces SQLCipher/OpenSSL; full verification

JP installed Rust (`cargo`/`rustc`) on the host machine mid-session, then asked to use it to verify
this repo's previously-unverified Rust code. What actually happened along the way changed the local
search index's architecture, not just its verification status - worth reading in full before
touching `search/` again.

- **`rusqlite`'s `bundled-sqlcipher-vendored-openssl` feature turned out to be a real, unbuildable
  dead end on this machine**: it builds OpenSSL from source, which needs a full Perl (Windows'
  OpenSSL `Configure` script has always required one) - Git for Windows' bundled `perl` is too
  minimal (missing `Locale::Maketext::Simple`, and its own `cpan`/`CPAN.pm` is *also* broken, so it
  can't even install the missing module itself). Tried, in order, and abandoned: (1) installing
  Strawberry Perl / a prebuilt OpenSSL package via Chocolatey - blocked, this shell has no admin/UAC
  access and `choco install` silently no-ops without it (confirmed: the target directory it claimed
  to install to stayed empty); (2) manually downloading Shining Light Productions' Win64 OpenSSL
  dev installer and running it silently to a user-writable directory - also required admin
  regardless of target path (Inno Setup's `PrivilegesRequired=admin` isn't conditional on the
  install location), and the first download attempt was additionally corrupted (should have
  verified its published SHA256 before running it - didn't, and it cost a wasted round trip
  including an unwanted popup on JP's actual screen, since these installer launches are real GUI
  processes, not sandboxed). At that point JP asked the natural question instead of continuing to
  fight OpenSSL: "can we use libsodium instead? I always use libsodium instead of OpenSSL in my
  projects" - see `[[feedback_libsodium_over_openssl]]` (project memory) for this as a standing
  preference to apply to future sessions/repos too, not just this one.
- **This wasn't a simple swap** - SQLCipher's open-source build has no libsodium crypto provider
  option at all (OpenSSL is the only one `libsqlite3-sys` wires up), so avoiding OpenSSL meant
  dropping SQLCipher entirely, not just its backend. See "Encryption at rest, without SQLCipher/
  OpenSSL" near the top of this file for the resulting design (in-memory SQLite + whole-database
  `serialize()`/libsodium-XChaCha20-Poly1305-encrypted-blob persistence) and its real tradeoff
  (whole-blob writes on every mutation, not per-page). `Cargo.toml`, `search/key.rs`, and
  `search/mod.rs` were rewritten; `search/schema.rs` and `search/commands.rs` needed no logic
  changes (the schema/FTS5/query-building code has never cared what's encrypting the file
  underneath it).
- **`libsodium-rs`/`libsodium-sys-stable` (jedisct1's own crates) auto-download a prebuilt libsodium
  binary at build time on Windows - no local build tools needed, unlike SQLCipher's forced
  from-source OpenSSL build.** That download itself hit the same underlying network reality this
  session had already found (very slow bandwidth to some external hosts from this sandbox, not a
  blocked-connection issue - `curl` to `download.libsodium.org` connects instantly but transfers at
  ~30 KB/s, so the 26 MB prebuilt archive needs ~15 minutes, well past the crate's own hardcoded
  300s `ureq` timeout). Fix: downloaded the archive directly with `curl` (unbounded time, backgrounded)
  straight into the crate's own extracted source directory
  (`~/.cargo/registry/src/.../libsodium-sys-stable-1.24.0/libsodium-1.0.22-stable-msvc.zip`
  + `.minisig`) - its build script already has a "use the file on disk if present" path (checked
  before assuming this would work), so it never re-attempted the slow download once the files were
  there. Worth remembering for *any* future crate whose build script fetches a large prebuilt
  binary in this environment - pre-seed the registry cache the same way rather than fighting the
  timeout.
- **Full verification, actually run this time**: `cargo check`, `cargo clippy`, `cargo test`
  (29/29 passing), and `cargo build --release` are all clean - see "Verification status" above for
  the fixes each of the previously-"unverified" items needed (all were close, several were exactly
  right as first written). One real, unrelated bug found and fixed along the way: `PendingSignIn`
  needed `Debug` for test assertions but was given a hand-written impl (not derived) that redacts
  `code_verifier`, a PKCE secret that must never reach a `{:?}`-formatted log line.
- **Two trivial `clippy::doc_lazy_continuation` warnings fixed** (`menu.rs`, `search/schema.rs`) -
  a wrapped doc-comment line happened to start with `- `, which rustdoc's Markdown parser read as
  an indented list continuation. Reworded, no content change.
- **Not done this pass**: an actual `tauri dev`/`tauri build` run (this sandbox still has no
  display and no mobile SDKs/emulators - a real GUI launch remains unverified, same limitation
  `electron-client`'s own NOTES.md documents for itself), and re-running the full JS/TS suite (it
  was untouched this pass - no reason to expect it changed, but it wasn't re-verified either).

### 2026-09-27 (fourth pass) — `@rapidmx/react-shared` merged into `@rapidmx/web-client`; import paths updated

A parallel effort (happening concurrently in `react-shared` and `web-client`, not this repo) folds
`react-shared` entirely into `web-client`: its whole `src/` tree, including the brand-new
`util/apiClientContext.ts` (`ApiClientContext`/`useApiClient()`, added the same day specifically for
this app's benefit - see the third-pass/second-pass "Unverified/guessed" item 4 and "Future work"
above, both written *before* that file existed), moves unchanged into a new `lib/` directory inside
`web-client`, exported at `@rapidmx/web-client/lib/*.js`. This repo doesn't use `ApiClientContext`
yet (nothing here imports it - confirmed by grep), so there was nothing to migrate for that symbol
specifically, but the path now exists for whoever picks up that future-work item.

- **Every import of `@rapidmx/react-shared/util/api.js` rewritten to
  `@rapidmx/web-client/lib/util/api.js`**: `src/lib/apiClients.ts`, `src/lib/shellProps.ts`,
  `test/lib/apiClients.test.ts` (a `vi.mock()` call, not an `import`), `test/lib/shellProps.test.ts`.
  These four were the only real import-path hits in `src/**`/`test/**` - `rapidmxShim.ts`,
  `searchTransport.ts`, `tauri.ts`, `routes.ts`, and `mailboxRegistry.ts` only ever mentioned
  `@rapidmx/react-shared` in prose doc comments (explaining behavior, not importing anything from
  it), left as-is; `README.md`/`RELEASE_NOTES.md` also mention it narratively (describing past
  sessions) and were likewise left alone - updating historical narrative isn't this task's job.
- **`package.json`**: removed the `"@rapidmx/react-shared": "link:../react-shared"` dependency line
  entirely. `"@rapidmx/web-client": "link:../web-client"` unchanged.
- **`yarn install` still resolves `@rapidmx/react-shared@link:../react-shared` transitively** - not
  a mistake. `web-client`'s own `package.json` still lists `"@rapidmx/react-shared": "^0.22.0"` as of
  this session (its side of the merge hadn't landed yet - confirmed `D:\github\rapidmx\web-client\lib\`
  does not exist on disk, and `web-client`'s `package.json` `exports` map has no `./lib/*.js` entry,
  only the existing `./*.js` -> `./dist/apps/*.js`). This should disappear on its own once
  `web-client`'s own migration lands and its `package.json` drops the dependency.
- **Verification: lint clean (`yarn lint`, 0 errors), but `yarn build` and `yarn test` both fail**,
  and both failures are the expected other-side-of-the-race, not a bug introduced here: `tsc` reports
  `TS2307: Cannot find module '@rapidmx/web-client/lib/util/api.js'` for the two `src/` files above,
  and `vitest` fails all 5 `apiClients.test.ts` cases the same way (Vite's `import-analysis` can't
  resolve the same path at runtime) - `shellProps.test.ts`'s type-only `import type { ApiClient }`
  from the same path doesn't trip `vitest` (erased before bundling) but does still trip `tsc`'s
  `--noEmit` check. All other 92 tests pass. **This is expected to self-resolve once `web-client`
  finishes its own migration and starts publishing `./lib/*.js`** (or once its local checkout gets a
  `lib/` directory + matching `exports` entry) - re-run `yarn build`/`yarn test` then; do not chase
  this as a real regression in this repo without first re-checking whether `web-client/lib/` exists
  yet.

### 2026-09-27 (fifth pass) — the race resolved; full green, plus one obsolete test fixed

`web-client`'s own side of the merge landed (see its NOTES.md and the third-pass Rust-verification
entry above - both same day). `yarn install` + `yarn build` + `yarn test` all now pass for real:
**97/97 tests, 100% coverage**, no `TS2307` errors.

One test needed a real fix, not just a re-run: `test/lib/searchTransport.test.ts`'s "logs a warning
... when `setLocalIndexTransport` isn't exported yet" relied on the *real* `@rapidmx/web-client`
genuinely lacking that export - true when written, false now that the merge landed. It started
failing (0 warn calls - the real setter path ran instead). Fixed by explicitly mocking the module to
simulate absence (`vi.doMock(modulePath, () => ({ setLocalIndexTransport: undefined }))`) rather than
relying on incidental reality - this is what the *other* two tests in that `describe` block already
did correctly. One subtlety worth remembering: Vitest 5's mock proxy throws on any **undeclared**
property access (not just missing ones) - `() => ({})` alone isn't enough to simulate "no such
export"; the property must be explicitly present and `undefined`.

## Future work

- Work through "Unverified Rust API assumptions" above if anything there is still open - most were
  already resolved by the third-pass full `cargo check`/`clippy`/`test`/`build --release` run (see
  "Verification status" near the top of this file); that section's per-item detail is now historical
  record of what needed fixing, not a to-do list.
- **The single biggest open question** (see the 2026-09-27 second-pass session log's "Unverified/
  guessed" item 4): most of `@rapidmx/web-client`'s own `apps/www` page components have no way to
  reach a per-account bearer-token `ApiClient` at all - only 6 of `react-shared`'s REST modules
  accept one, and nothing in `web-client`'s own components passes one even to those six. Real Mail/
  Calendar/Contacts/Tasks data fetching from the mounted pages will very likely 401 until `web-client`
  adds something like an `ApiClientContext` its pages/hooks read from - that's a `web-client` change,
  out of scope for this repo's own writes.
- Once `web-client` publishes (or locally rebuilds) a `dist/` that includes
  `apps/shared/search/localIndexTransport.js` and an updated `localIndexRpcClient.js` exporting
  `setLocalIndexTransport`, re-verify `src/lib/searchTransport.ts`'s `installNativeSearchTransport()`
  actually installs (today it's a confirmed, logged no-op - see that file's own doc comment), and
  switch its hand-copied `LocalIndexTransport` type mirror to a real `import type` from that package.
- Extend `search/commands.rs` + `LocalIndexManager` (`search/mod.rs`) with `move_entity`,
  `indexed_versions`, `prune_entities`, `set_window`, `set_building`, `prune_inaccessible` - the six
  `LocalIndexTransport` methods `searchTransport.ts` currently rejects with "not implemented yet"
  because no matching Rust command exists.
- Resolve the `search_local_init` master-key vs. `LocalIndexTransport.init()`'s already-mailbox-derived
  `indexKey` mismatch (2026-09-27 second-pass item 3) - either give the Rust command a variant that
  skips its own re-derivation, or change `search/key.rs`'s derivation to match what the real transport
  interface actually hands it.
- Wire `src/lib/mailboxRegistry.ts`'s `registerMailboxAccount()` from wherever this app's (not-yet-built)
  real Mail UI learns an account's mailbox uids - nothing calls it yet, so the native search transport
  can't resolve any `mailboxUid` to an account today.
- Once `@rapidrest/react` actually publishes a release containing `mountRouter()`, switch
  `package.json`'s `@rapidrest/react` dependency from `link:../../rapidrest/react` back to a semver
  range (matching how `@rapidmx/web-client` itself already depends on it) - see 2026-09-27 second-pass
  item 1.
- Register `tauri-client` as a real `PUBLIC` OAuth client with auth-server (or find out how a
  parallel effort already has) - nothing here can complete a real sign-in until that exists.
- Wire `search_local_init`'s `master_key_base64` up to wherever this app's (not-yet-built) E2E
  key-unlock flow puts a mailbox's master key (see the master-key/`indexKey` mismatch item above too -
  these two are related but not identical).
- Re-evaluate `tauri-plugin-secure-keystore` specifically (see unverified-assumption #1) once its
  actual Rust API surface (or lack thereof) is confirmed - it may need forking, replacing with a
  different crate, or a different integration shape entirely.
- Wire up Tailwind (`@tailwindcss/vite` + importing `@rapidmx/web-client/shared/styles/app.css`,
  mirroring `rapidmx/server`'s own `serverViteConfig.ts`) - the real `yarn build` this session
  succeeded but produces unstyled pages today (confirmed: an "Unknown at rule: `@theme`" warning from
  `lightningcss`, since nothing in this app's own build processes that stylesheet at all yet).

### 2026-09-28 - Always wait for CI to go green before releasing

Standing process rule, applies to every rapidmx/rapidrest repo: push pending commits, wait for the GitHub Actions **Build** workflow on that push to report `success` (`https://api.github.com/repos/<org>/<repo>/actions/runs`, or ask JP for the downloaded log archive if API log access needs auth - it 403s without a token), and only then run `npx @rapidrest/cli release ...`. Do not tag/release first and diagnose CI failures afterward. During a 2026-09-28 multi-repo release wave, restapi was released immediately after pushing pending commits without waiting for CI; CI then failed on a real coverage-threshold regression the pending changes introduced (a missing test for `BasePluginRoute.newestSearchResult()`'s catch branch) - not a flake, as an incomplete local-only reproduction first suggested. Because the release commit/tag were already pushed, the fix had to land as a follow-up commit on top of an already-tagged release instead of before it.

### 2026-10-06 - Updated to the current auth-server, web-client and restapi contracts

Reviewed every commit in those three repos since 2026-09-27 against this app's contract. Four things
were wrong and are fixed here; four more are blockers outside this repo.

**Fixed in this repo**
- **`client_id` was a name, not a uid.** auth-server removed its separate `clientId` field (auth
  1c6a03e) and keys clients by record uid. `OAUTH_CLIENT_ID` is now the fixed uid
  `7f3c2b9e-5a1d-4c8e-9b6f-0d2a1e4c7b53`. A caller-supplied uid is kept on create (`RepoUtils.create`
  constructs from the input and only strips `_id`), so one fixed uid works on every deployment. The
  README lists the registration fields.
- **The browser opened the wrong page.** `/oauth/authorize` is a JSON API. An unauthenticated browser
  gets `{loginRequired: true}`, not a sign-in screen. The sign-in URL is now `/auth/authorize`, the
  www page that shows the sign-in UI and calls `/oauth/authorize` itself.
- **`userUid` was always undefined.** `resolveWwwShellProps` now reads auth-server's
  `/api/profiles/me` with the account's bearer session token, the same route the web client's
  `getMyProfile()` reads. Failure degrades to undefined with a warning. Without it the appearance
  cache has no per-user scope.
- **The `searchTransport.ts` comments were stale.** The built `web-client` now exports
  `setLocalIndexTransport` and ships `localIndexTransport.d.ts`, so the native transport is installed
  for real. The local interface mirror stays: that `.d.ts` exports only three of its types, and the
  rest come from worker modules the package does not export.

**Blockers outside this repo** (see the README's "Server prerequisites")
- **`server` does not mount `/.well-known/rapidmx/server-info`.** `restapi` 0.31.0 defines
  `BaseServerInfoRoute`, and its `ServerInfoRouteMongo`/`ServerInfoRouteSQL` are exported only from
  the library. `server/src` has no `@Route` for it, so discovery 404s. Fix: a `ServerInfoRoute` in
  `server/src/{mongo,sql}/routes/`.
- **CORS blocks the webview by default.** Its origin, `tauri://localhost` or `https://tauri.localhost`,
  gets no `Access-Control-Allow-Origin` unless `cors.origins` lists it or is `"*"`. The server's
  default is `["http://localhost:3000"]`. Operators must set this per deployment.
- **Mail push refuses the webview.** `restapi`'s `MailPushRoute` closes a websocket with 1008 when
  `Origin` is present and not on the list. The same `cors.origins` fix covers it.
- **Cookie-only paths in `web-client`.** `fetchBodyContent`, `fetchVCardText`, `fetchContentHtml`,
  `serverImageResolver` and the `attachmentContentUrl` links still send credentials as cookies, so a
  native host fails to show message bodies, vCards, quoted pictures and attachment downloads. Raw
  upload, raw MIME and contact-photo blobs are now routed through `ApiClient`
  (`withClientRaw`/`withClientBlob`).

**Confirmed unchanged, no action needed:** `/oauth/session-token` (`{token}` only, bearer-only, no
cookie), PKCE and the exact-match `redirect_uri`, the refresh grant with `offline_access`, token TTLs
and issuer, bearer `Authorization: jwt` acceptance on ordinary routes, and the route paths the web
client uses. Elevation gates only admin-scope actions, so a non-admin native user is unaffected.
Gravatar is now opt-in, which needs nothing from the host. `web-client`'s session-refresh no-op under
`ApiClientContext` is still in place.

**Verification:** `cargo check` and `cargo test` are clean (29/29). `yarn build` succeeds (its
lightningcss warnings are pre-existing, from `web-client`'s stylesheet). `vitest` passes 99/99 at
100% statements, branches, functions and lines.

### 2026-10-22 - Blank white window on first real run: two separate causes

Not committed except the `vite.config.ts` fix below. JP's first `yarn dev` showed a blank window with
no visible error - both causes together, debugged with a real `cargo tauri dev` run (background,
stdout captured to a file) rather than guessing from source, since the real failure was in the
webview's own module loading, not in anything the test suite or `yarn build` exercises.

1. **`package.json` had been hand-edited (uncommitted) to swap `@rapidmx/web-client`/`@rapidrest/react`
   from this repo's `link:` sibling paths to their published npm versions** - the right end state for
   real distribution, but it surfaced that **`@rapidrest/react`'s published `2.1.0` doesn't actually
   have `mountRouter()`**. It was built and merged into that repo's `main` (`2224430`) three commits
   ago, including real tests and docs, but never version-bumped and published - `npm view
   @rapidrest/react dist-tags` still showed `latest: 2.1.0` (confirmed directly against the registry,
   not assumed from the changelog). A commit that reads like a publish
   (`4d81b85 "Publish a prerelease version to npm..."`) only fixed the GitHub Actions workflow so it
   *can* publish a prerelease (npm requires a non-`latest` dist-tag for prerelease semver) - it changed
   `.github/workflows/publish.yml` only, nothing else. Reverted `package.json`/`yarn.lock` back to
   `link:` for local dev to unblock this immediately. **JP then actually published it** -
   `@rapidrest/react@2.2.0` appeared on the registry (`npm view @rapidrest/react dist-tags` now shows
   `latest: 2.2.0`) a few minutes into this same debugging session, and `package.json` went back to
   `"@rapidrest/react": "^2.2.0"` (JP's own edit, found already on disk - not mine). Confirmed clean
   with the real published version too: `yarn install`, `yarn build`, `vitest` (99/99) and a real
   `yarn dev` run all pass against it, the same as against `link:`.
2. **Reverting to `link:` wasn't enough by itself.** `@rapidmx/web-client` is its own separate yarn
   project with its own `node_modules/@rapidrest/react` - a real installed copy at the stale published
   `2.1.0`, never told to use this repo's linked sibling checkout. `web-client`'s own `apps/www` page
   modules (the ones this app mounts) import `@rapidrest/react/client` themselves (`Link`, `useRouter`,
   ...), so without deduping, Vite's dependency optimizer collapsed every import of that specifier -
   this app's own `App.tsx` included - onto whichever physical copy it scanned first, which was
   `web-client`'s stale one. The real symptom, from a captured `cargo tauri dev` run's stdout (Vite
   forwards an uncaught browser-side error to the terminal even with no devtools open):
   ```
   [vite] (client) [Unhandled error] SyntaxError: The requested module
   '/node_modules/.vite/deps/@rapidrest_react_client.js?v=...' does not provide an export named
   'mountRouter'
   ```
   A fatal ESM `SyntaxError` at module-load time halts the whole script before `main.tsx` ever calls
   `createRoot()` - that's why the window was *totally* blank, not even `App`'s always-rendered static
   sidebar (which doesn't depend on `mountRouter` succeeding - that call is inside a `useEffect`).
   Clearing `node_modules/.vite` alone did not fix it (it re-optimized to a new hash, same stale
   content) - the actual fix was adding `"@rapidrest/react"` to `vite.config.ts`'s existing
   `resolve.dedupe` array, next to the `react`/`react-dom` entries already there for the identical
   class of problem. Against the `link:` dependency, deduping makes `@rapidrest/react` drop out of
   Vite's optimized-deps list entirely (confirmed via `node_modules/.vite/deps/_metadata.json`) -
   deduped, it resolves to project source outside `node_modules`, so Vite stops treating it as an
   opaque dependency to pre-bundle at all. Against the real published `^2.2.0` (a real `node_modules`
   install, not a symlink), deduping instead keeps it *in* the optimized-deps list as normal, just
   pinned to this project's one root copy - confirmed its pre-bundled chunk actually contains
   `mountRouter` this time. Either way the dedupe entry is what matters: **`web-client`'s own
   `node_modules/@rapidrest/react` was still at the stale `2.1.0` as of this writing** (its own
   dependency range, `>=2.1.0 <3`, already allows `2.2.0` - it just hasn't had `yarn install` rerun
   there since the publish) - so the stale-second-copy hazard this dedupe guards against is still live
   today, not just a `link:`-only concern, until `web-client` updates its own lockfile too.
3. **No GUI automation available in this sandbox** to open devtools or screenshot the real window
   directly (tried; a screen-capture attempt via PowerShell just captured the host desktop's other
   windows, not the webview - this environment has no working desktop/window control). The real fix
   was confirmed by running `yarn dev` for real in the background with stdout captured to a file (the
   only way the actual browser-side error surfaced at all), and JP confirmed visually afterward.

## 2026-10-23 - @rapidmx/web-client from npm

- **`@rapidmx/web-client` is `^0.36.0` from npm, not `link:../web-client`** (the `link:` described in the earlier entries is gone; `@rapidrest/react` moved the same way in e01c02d).
- **Tailwind is now this app's own build dependency.** web-client's stylesheet (`apps/shared/styles`) starts with `@import "tailwindcss"`; through the `link:` that resolved from web-client's own `node_modules`, from the npm package it doesn't. `tailwindcss` and `@tailwindcss/vite` (`^4.3.3`, web-client's versions) are devDependencies, and `vite.config.ts` adds `tailwindcss()` as the server's `serverViteConfig.ts` does. web-client's CSS names its own `@source` paths, so the utility classes it uses are generated from `node_modules` too.
- Picking up a new web-client release is now a normal dependency bump (`yarn up @rapidmx/web-client`); local web-client changes reach this app only once released, or through a temporary `link:`.

## 2026-10-24: Review fixes (cross-repo adversarial review)

- **Concurrent refreshes revoked the token family (#31).** New `src-tauri/src/oauth/session.rs`: `SessionTokens` (managed state) holds one async lock and cached session JWT per account. `get_session_token` returns the cached JWT until 60s before its `exp` (read unverified from the payload), otherwise refreshes under the account's lock, so concurrent callers share one refresh grant instead of redeeming the same rotating refresh token twice (auth-server revokes the whole family when that happens). A token without `exp` or a failed refresh is not cached. `remove_account` drops the account's entry. This replaces the old "refresh on every call, never cache" first pass.
- **Native search transport replaced the working Worker transport (#33).** `@rapidmx/web-client` 0.36.0 exports `setLocalIndexTransport`, so the install stopped being a no-op and swapped in a transport that cannot finish a build pass (empty `mailboxRegistry`, and `setWindow`/`setBuilding`/`pruneEntities` reject). `installNativeSearchTransport()` now does nothing unless `NATIVE_SEARCH_TRANSPORT_READY` (false) or `{ enabled: true }`. Switch it on only once those three methods have Rust commands and `registerMailboxAccount()` is wired. `pruneInaccessible()` now resolves (never-rejects contract). This supersedes the 2026-09-27 second-pass item 2 claim that the swap "starts working with zero code changes".
- **Destroying one mailbox wiped the whole account index (#34), partly fixed.** New `search_local_destroy_mailbox` command and `LocalIndexManager::destroy_mailbox()` delete only that mailbox's rows and persist; the transport's `destroy(mailboxUid)` uses it (and resolves `false` rather than rejecting on failure). It returns `false` when the account's index isn't open, since the file can't be edited without its key. `search_local_destroy` (whole file) stays for account removal.
  - Deliberately left: the account file is still keyed by whichever mailbox calls `init` first, and a different first caller on a later launch silently discards the index. Fixing that means either per-mailbox files (contradicts the per-account decision above) or a stable account-level key (the open item 3 / Future work design decision). Needs JP's call before `registerMailboxAccount()` is wired. The silent discard-and-rebuild on a decrypt failure is the documented posture and was not changed.
- **CSP blocked blob: and remote images (#36).** `img-src` now also allows `blob:` (contact photos, the add-photo preview and resize) and `https:` (branding logo and icon on the server). Message bodies keep web-client's own stricter frame CSP. `connect-src`/`frame-src` unchanged. Inline cid images were not a CSP problem (their URLs resolve against the app origin; the cookie-auth blocker above). Test: `test/tauriConf.test.ts`.
- **Unvalidated auth-server URL (#38).** `oauth::require_https_base_url()` refuses anything but `https` with a host and no query, fragment or userinfo (plain `http` to loopback in debug builds only). `begin_sign_in` checks both `server_url` and `auth_server_url` before opening the browser (`opener`'s Rust API skips the capability scope), and `federation::fetch_server_info` refuses a non-https `authServerUrl` answer. Optional defense in depth (accepting only URLs `resolve_server` returned) not done.
- **Path traversal through `account_id` (#40).** `search::index_file_name()` refuses an account id outside `[A-Za-z0-9_-]` before any path is built, covering init, persist and destroy.
- Verification: `cargo build`/`cargo test` (39 Rust tests), `yarn lint`, `yarn build`, `npx vitest run` (106 tests, 100% coverage). The uncommitted `OAUTH_CLIENT_ID` change in `src-tauri/src/config.rs` was already in the working tree and is not part of this commit.

## 2026-10-25: moveEntity flags

- `moveEntity(mailboxUid, entityUid, folderUid, entityVersion?, flags?)` passes web-client's new `flags` (`,a,b,`) through the transport and `searchCommands.moveEntity` (sent as `null` when absent) to `search_local_move_entity`'s new `flags: Option<String>`. `MOVE_ENTITY_SQL` sets `flags = COALESCE(?4, flags)`: given flags replace the row's, none keep them - so a zero-access row the web-client builder or zero-access sync records keeps its flags here as on the Worker transport. Tests: `schema.rs` `move_entity_sets_flags_when_given_and_keeps_them_otherwise`, `test/lib/tauri.test.ts`, `test/lib/searchTransport.test.ts`.

## 2026-10-25: Second review fixes

- **Sign-in never completed on Windows/Linux (#152).** Those platforms start a new process for a `rapidmx://auth/callback` deep link, and the pending PKCE state lives only in the memory of the instance that called `begin_sign_in`. `tauri-plugin-single-instance` (desktop-only target dependency, `deep-link` feature; 2.5.1 locked, which moved `tauri-plugin-deep-link` from 2.5.0 to 2.6.0 in Cargo.lock) is now registered first in `lib.rs`: a second launch forwards its URL to the running instance's `on_open_url` handler and exits, and the main window is unminimized, shown and focused. A debug build also calls `deep_link().register_all()` on Windows/Linux, since nothing installed the scheme for it. `deep_link.rs`'s doc now says `get_current` is only reached on a real cold start, where no sign-in can be pending. Not yet verified by a real sign-in on Windows (needs a running auth-server).
- **Session JWT cache trusted the device clock against the server's `exp` (#153).** The cached expiry is now a deadline on the device's clock: receive time plus `exp - iat` (`session::local_expiry`; a token without a usable `iat` falls back to `exp`). `get_session_token` takes an optional `rejectedToken`: when it is still the cached token it is dropped and refreshed; callers rejecting an already-replaced token get the replacement without another refresh. `createAccountApiClient()` (`src/lib/apiClients.ts`, also used by `shellProps.ts`) registers each client's unauthorized observer and passes the token a 401 answered on the next request. The 401'd request itself is not retried.
- **A stalled refresh blocked the account forever (#154).** `oauth::http_client()` sets a 10s connect and 30s total timeout, so a refresh holding the account's lock fails and releases it. No extra `tokio::time::timeout` around `refresh()` (tokio is not a direct dependency, and every refresh path uses `http_client()`).
- **`remove_account` raced an in-flight refresh (#156).** `remove_account` is async and runs through `SessionTokens::remove()`, which takes the account's lock (waiting for a refresh in flight to store its rotated token), deletes the account record and keychain entry, and drops the slot while still holding the lock. Callers that waited then refresh for a missing account and fail. `refresh_session_token` also re-checks the account record before storing the rotated token. `SessionTokens::forget` is gone.
- **`indexed_versions_in()` bound every uid in one statement (defence in depth for web-client #122).** It now queries 500 uids per statement (`INDEXED_VERSIONS_CHUNK`), so a zero-access tail larger than SQLite's 32766-parameter limit can't fail the call. Test with 40,000 uids.
- Verification: `cargo build`, `cargo test` (45 Rust tests), `cargo clippy --all-targets` clean, `yarn lint`, `yarn build`, `yarn test` (108 tests, 100% coverage). The uncommitted `src-tauri/src/config.rs` change is still not part of this commit.
- **Import kept clearing a row's recorded version (#125, native half).** `UPSERT_ENTITY_SQL` (`search/schema.rs`) set `entity_version = excluded.entity_version`, so a zero-access document imported from the server (no version) cleared what the builder or the live-tail lookup recorded, and the row counted as unrecorded on the next pass. It now sets `entity_version = COALESCE(excluded.entity_version, entities.entity_version)`, matching web-client's worker SQL (9ceb6c6). Test: `schema.rs` `upsert_keeps_a_recorded_version_when_the_incoming_row_has_none`. Verified with `cargo build`, `cargo test`, `cargo clippy --all-targets`, `yarn lint`, `yarn build`, `yarn test`.

## 2026-10-25: Third review fixes

- **Webview JS could read and overwrite every account's refresh token (#235).** `capabilities/default.json` granted the main window `secure-keystore:default`, which allows the plugin's `get_item`/`set_item`/`delete_item` (and the lock-password commands) over IPC. Refresh tokens live under the predictable key `rapidmx-refresh-token:<accountId>` and `list_accounts` hands JS every account id, so any script in the webview (a sanitizer bypass, a compromised dependency, a branding injection) could take a long-lived refresh token off the device, or swap an account slot onto an attacker's token. That broke the "tokens never enter the webview's JS context" invariant (`oauth/mod.rs`, README). The permission is gone; the keystore plugin now has no webview capability at all. `keychain.rs` reaches it only through `SecureKeystoreExt` from Rust, which never goes through IPC and needs no capability, so sign-in (`complete_sign_in` stores the token), refresh (`get_session_token` loads and rotates it) and `remove_account` (deletes it) are unchanged. The unused `tauri-plugin-secure-keystore` npm package was removed too, so nothing invites a JS caller. Test: `test/tauriConf.test.ts` checks no capability file grants a `secure-keystore:` permission.
  - Not exercised: a real sign-in, refresh and account removal against a running auth-server after the change (none available here). The Rust path is the same code as before; only the IPC grant changed.
- Verification: `cargo build`, `cargo test` (46 Rust tests), `cargo clippy --all-targets` clean, `yarn lint`, `yarn build`, `yarn test` (109 tests, 100% coverage). The uncommitted `src-tauri/src/config.rs` change is still not part of this commit.

## 2026-10-26: Review round 5 fixes

- **Every account switch left the previous router running (#537).** `@rapidrest/react`'s `mountRouter()` creates a React root and adds window `pagehide`/`popstate`/`beforeunload` and document `click` listeners, and returns no way to remove either; re-keying `#app-mount` only dropped the DOM node. Each switch therefore kept the previous account's whole `apps/www` shell alive in a detached root (live connection, local-index timers, outbox jobs), and the first router ever mounted caught every plain-anchor click before the visible one. New `src/lib/mountScope.ts`: `createMountScope()` hands `mountRouter()` (which takes `win`/`doc` as arguments) proxies whose `addEventListener` adds the scope's `AbortSignal` (and adds nothing once it has aborted), and wraps the shell in a component that renders nothing once disposed. `App.tsx`'s active-account effect creates one per mount and disposes it in its cleanup, which removes that router's listeners and unmounts its pages and shell (their effect cleanups run). It also replaces the `mountToken` ref: a mount whose scope was disposed while `loadWwwShell()` was pending is skipped, and one already inside `mountRouter()` adds no listeners and renders nothing. The React root itself stays, holding an empty tree. Tests: `test/lib/mountScope.test.tsx` (including the real `mountRouter()`: its click listener stops intercepting and the page's effect cleanup runs on dispose), `test/App.test.tsx`.
  - Better long-term: an unmount/`signal` option on `mountRouter()` in `@rapidrest/react` (`src/router.ts`: pass `{ signal }` to every listener and `root.unmount()` on abort). Not in this repo; the scope would then become a thin call to it.
- **Each account's mail view deleted the other accounts' local search indexes (#538).** Every account shares this webview's origin and so its OPFS, while web-client's `LocalIndexLifecycle` prunes every index directory outside the active account's mailbox list. `installNativeSearchTransport()` now, while the native transport is off, installs web-client's own `workerLocalIndexTransport` wrapped by `createMultiAccountWorkerTransport()`, whose `pruneInaccessible` runs only when exactly one account is signed in (`apiClients.ts` `signedInAccountCount()`, passed from `main.tsx`; the default count is 0, so prune never runs without one). A removed account's directories are cleared by the next prune once one account is left; until then they stay, encrypted under each mailbox's derived index key.
  - Not fixed here (web-client): `pruneInaccessibleLocalIndexes()` (`apps/shared/search/localIndexRpcClient.ts`) calls `forgetZeroAccessSyncExcept(accessible)` itself before the transport, so it still drops the other accounts' `rapidmx:za-index-sync:` state. Their indexes survive, but the next zero-access sync pass re-imports every segment. Fix there: move the forget into `pruneInaccessibleLocalIndexesImpl` (so a host wrapper controls both steps) or add a host hook that widens the kept set; then this wrapper covers both.
  - **Done (web-client 341f7ec):** the forget moved into `pruneInaccessibleLocalIndexesImpl` (the Worker transport's own `pruneInaccessible`), so `createMultiAccountWorkerTransport()` skipping the prune now keeps the other accounts' `rapidmx:za-index-sync:` state as well as their directories; nothing else needed wiring here. The native transport's no-op prune keeps sync state too (right, as it keeps the indexes). Doc comment updated; `test/lib/searchTransport.test.ts` gains a test against the real web-client module: with two accounts signed in, `pruneInaccessibleLocalIndexes()` leaves another account's sync key, with one it removes it.
  - Not done: per-account mailbox registration (`registerMailboxAccount()`), which would allow pruning revoked mailboxes while several accounts are signed in. Nothing in this repo knows another account's mailbox list without a fetch per account.
- Verification: `cargo build`, `cargo test` (46 Rust tests), `cargo clippy --all-targets` clean, `yarn lint`, `yarn build`, `yarn test` (123 tests, 100% coverage). The uncommitted `src-tauri/src/config.rs` change is still not part of this commit.

## 2026-10-26: Review round 6 fixes

- **The shell's "Sign out" wiped every account's local indexes, stranded the window on auth-server and left the account signed in (#625).** web-client's `AppShell.handleSignOut()` assumes one user per origin: `destroyAllLocalIndexes()` (every OPFS index on the device, and its `signedOut` flag stops any index opening again), a cookie logout this app has no cookie for, and `window.location.href = authServerUrl`. Fixed here without a web-client change:
  - `createMultiAccountWorkerTransport()` now takes `{ signedInAccountCount, activeAccountId, pendingDeletionsKey }`. Its `init` and `pruneInaccessible` register the mailboxes they name to the active account (`mailboxRegistry.ts`, now persisted in `localStorage` under `rapidmx:mailbox-accounts`, so a sign-out also finds indexes built in earlier sessions; `accountMailboxes()` is new). `destroyAll`, which only a shell sign-out calls, destroys only the active account's registered mailboxes (each through the worker's own `destroy`, so a failure is retried on the next load) within the same timeout while more than one account is signed in, and forwards to the worker's wipe with one. Either way it then reports the sign-out through new `src/lib/accountSession.ts` (`recordActiveAccount`/`getActiveAccountId`, `onShellSignOut`/`notifyShellSignOut`, `reloadApp`). `retryPendingDeletions` leaves a pending wipe of every index (`"*"`) for a later load while several accounts are signed in.
  - `App.tsx` records the active account and, on a shell sign-out, calls `remove_account` (record and keychain refresh token), forgets its mailbox registrations and reloads the app, which resets what web-client's sign-out left in module state (the index client's `signedOut`, the compose signing-out mark). A failed removal shows the error and does not reload.
  - New `src-tauri/src/navigation.rs`: an `app-navigation` plugin whose `on_navigation` refuses any http(s) navigation outside `tauri.localhost` and, in a dev build (`cfg!(dev)`), the configured `devUrl` origin, so the shell's redirect to auth-server never replaces the account switcher. Other schemes (`tauri://localhost`, `about:`) pass. The CSP already allows no frames.
  - Tests: `test/lib/searchTransport.test.ts` (wrapper unit tests, and against web-client's real transport: with two accounts `destroyAllLocalIndexes()` leaves only the active account's mailbox pending, never `"*"`), `test/lib/mailboxRegistry.test.ts`, `test/lib/accountSession.test.ts`, `test/App.test.tsx`, `navigation.rs` unit tests.
  - Not fixed here (web-client, `apps/shared/components/layout/AppShell.tsx` `handleSignOut()`): it still calls `destroyUnlockedKeys()` with no mailbox, which empties every account's unlocked keys (one shared key session), and `destroyAllLocalIndexes()` (`apps/shared/search/localIndexRpcClient.ts`) still calls `forgetAllZeroAccessSync()` before the transport, so the other accounts' `rapidmx:za-index-sync:` state goes too (their indexes survive; their next sync re-imports every segment). Fix there: an optional `onSignOut` override on `AppShell`/`WwwShellProps` a host can pass (tauri would pass one that destroys only its account's keys and indexes and removes the account, and skip the logout POST and navigation), and move the forget into `destroyAllLocalIndexesImpl` as was done for prune in 341f7ec.
  - Server-side token revocation on sign-out is still not done (`remove_account` only deletes locally, as before).
- **An account switch stopped the outgoing account's lock watcher, so a later key destruction left its index open in the Worker with its key (#626).** `LocalIndexLifecycle` (mounted by `MailShell`) is web-client's only lock-to-destroy path, and the round-5 dispose unmounts it on a switch. New `watchKeyLocks()` (`searchTransport.ts`), installed with the wrapper, subscribes once to web-client's `subscribeKeySession()` and, when a mailbox whose index the wrapper opened (`isOpen`, tracked through `init`/`destroy`/`destroyAll`) is locked, cancels its build (`cancelLocalIndexBuild`, loaded lazily as `LocalIndexLifecycle` does) and calls `destroyLocalIndex()`, whichever account is mounted. A mounted `LocalIndexLifecycle` destroying the same index again finds nothing open. Tests in `test/lib/searchTransport.test.ts`.
  - Consequence worth knowing: web-client's sign-out `destroyUnlockedKeys()` locks every account's mailboxes (above), so it now also destroys the other accounts' indexes opened this session, as spec section 11 requires once their keys are gone. Scoping the key destruction in web-client fixes both.
  - Not fixed here (web-client): the same lock watcher belongs in `localIndexRpcClient.ts` (or a module-level subscription in `LocalIndexLifecycle.tsx`), which would also cover single-account web-client leaving Mail for Calendar before an idle lock; `LocalIndexLifecycle`'s doc comment still says keySession has no observer. tauri's watcher is then redundant but harmless.
- **Follow-up: #625/#626 finished with web-client's half.** web-client now takes an optional `signOutHost` (`{ destroyKeys(), finish() }`) on `AppShell`/`WwwShellProps`, moves `forgetAllZeroAccessSync()` into its Worker transport's `destroyAll` (and forgets a mailbox's sync state in its `destroy` too), and destroys an open local index itself the moment its mailbox locks (`localIndexRpcClient.ts`, whichever shell is mounted). Here:
  - New `createShellSignOutHost(accountId, signedInAccountCount)` (`accountSession.ts`), created once per mount in `App.tsx` and added to every `resolveProps` result. `destroyKeys` destroys every mailbox's keys with one account signed in; with several, only the mailboxes registered to the account plus any personally unlocked mailbox registered to no account (a shared one opened with them goes with it). `finish` calls web-client's `destroyAllLocalIndexes()` (scoped by the wrapper as before) and then `notifyShellSignOut()`, even if the destroy failed; `App.tsx` still removes the account and reloads. The shell no longer logs out over a cookie, navigates or wipes other accounts' keys and sync state.
  - The wrapper's `destroyAll` no longer reports the sign-out (the host does), and its open-index tracking (`isOpen`) and `watchKeyLocks()` are gone, as web-client's own lock watcher replaces them. New `registerUnlockedMailboxes()` (installed by `installNativeSearchTransport()` when given `activeAccountId`) registers each mailbox unlocked while an account is active to that account, so its sign-out finds a mailbox it unlocked without opening an index or listing it.
  - `mailboxRegistry.ts` doc updated. Server-side token revocation on sign-out is still not done.
  - Tests: `accountSession.test.ts` (host key scoping, finish order and failure), `searchTransport.test.ts` (registration on unlock; the real-transport sign-out now goes through the host and checks only the account's sync state goes), `App.test.tsx` (the same host on every `resolveProps`). Verification: `yarn lint`, `yarn build`, `yarn test` (158 tests, coverage thresholds met), `cargo build`/`cargo test` (49)/`cargo clippy --all-targets` (no Rust change), against a local web-client build copied into `node_modules`.
- Test flake fixed: `App.test.tsx` "skips a stale mount" could click the second account before the first became active (the first `loadWwwShell()` call, the deferred one, then belonged to the second account); it now waits for the first account's shell load. It failed once in twelve runs at HEAD as well.
- Verification: `cargo build`, `cargo test` (49 Rust tests), `cargo clippy --all-targets` clean, `yarn lint`, `yarn build`, `yarn test` (157 tests, 100% coverage). Not exercised in a real window (no GUI here): the refused navigation and the reload after a sign-out. The uncommitted `src-tauri/src/config.rs` change is still not part of this commit.

## 2026-10-26: Review round 7 fixes

- **A scoped sign-out destroyed the indexes of whichever account was active when `finish()` ran (#717).** `createShellSignOutHost().finish()` called web-client's `destroyAllLocalIndexes()`, which the wrapper scoped to `activeAccountId()`; `AppShell.handleSignOut()` awaits `flushComposeDrafts()` (up to 3s) between `destroyKeys()` and `finish()`, and the sidebar stays clickable, so a switch in that window destroyed the other account's indexes and zero-access sync state and left the signing-out account's on disk, unregistered. `accountSession.ts` now has `destroyAccountKeys(accountId, ids)` and `destroyAccountLocalIndexes(accountId, ids)`, which name the account: with one account signed in they wipe everything as before (`destroyUnlockedKeys()`, `destroyAllLocalIndexes()`); otherwise the index destroy goes through web-client's `destroyLocalIndex()` for each mailbox the account's sign-out releases (below), within `DESTROY_ALL_TIMEOUT_MS`, and never through `destroyAll`. The host takes `signedInAccountIds` (new in `apiClients.ts`, with `isSignedInAccount()`) instead of a count. The wrapper's own several-accounts `destroyAll` scoping stays only as a safety net for any other caller; its timeout race moved into the exported `destroyIndexesWithin()`. Tests: `accountSession.test.ts` (a switch between `destroyKeys()` and `finish()`), and the real-transport sign-out in `searchTransport.test.ts` now switches accounts in between and still leaves only the signing-out account's mailbox pending.
- **The sidebar's "Remove" left the removed account's keys unlocked and its indexes in place (#718).** `handleRemoveAccount` now runs new `signOutAccountLocally()` (the same key and index destruction as the shell's sign-out, while its registrations still name its mailboxes) before `removeAccount()`, then unregisters and drops the account, and reloads when it was the last account (its wipe sets web-client's index client signed out until a reload). A failed removal shows the error, as before; the keys and indexes are already gone by then, which is the safe side. Tests in `App.test.tsx` (order: local sign-out before `remove_account`; reload only for the last account).
  - Not done: the removed account's open compose windows are not flushed first (the shell's sign-out does that through web-client). Removing an account is a local action on a possibly inactive account, and a flush would need its mounted shell.
- **The mailbox registry kept one account per mailbox, so the last account to list a mailbox owned it (#719).** `mailboxRegistry.ts` now keeps every account registered for a mailbox, plus the account that unlocked it with its own keys (`recordPersonalUnlock()`, called by `registerUnlockedMailboxes()` for a session that is not `.shared`). Stored as `{ uid: { accounts: [...], unlockedBy? } }` under the same key; the earlier `{ uid: "accountId" }` form is still read. New `releasedBySignOut(uid, accountId, isSignedIn)`: a sign-out takes a mailbox's keys and index when that account unlocked it itself, or when no other signed-in account is registered for it (registrations left by accounts no longer signed in don't count; an unregistered personal session is released, as before). `releasedAccountMailboxes()` lists them. `destroyAccountKeys()`, `destroyAccountLocalIndexes()` and the wrapper's fallback `destroyAll` (given `isSignedIn` from `main.tsx`; without it every registered account counts, which keeps more) all use it. So a delegate's sign-out leaves the owner's personal unlock and index of the owner's mailbox alone, and the owner's sign-out takes them even when the delegate listed the mailbox last. `resolveMailboxAccount()` (native transport only, still off) now returns the personal unlocker, else the first registered account. `unregisterAccountMailboxes()` removes the account from every entry and drops entries left empty. Tests: `mailboxRegistry.test.ts`, `accountSession.test.ts`, `searchTransport.test.ts`.
  - Deliberately left: a mailbox this account listed but never unlocked itself, which another signed-in account still lists, keeps its index and keys when this account signs out (the index directory and key session are per mailbox and shared by both accounts). The unlocker is persisted, so an owner's sign-out after a reload still takes its own mailbox's index.
- Verification: `yarn lint`, `yarn build`, `yarn test` (175 tests, 100% coverage), `cargo build`, `cargo test` (49 Rust tests), `cargo clippy --all-targets` clean (no Rust change). Not exercised in a real window (no GUI here). The uncommitted `src-tauri/src/config.rs` change is still not part of this commit.
