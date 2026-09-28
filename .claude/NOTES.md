# Code review notes — rapidmx/tauri-client

This file exists so that Claude sessions working in this repo don't re-litigate settled
decisions or re-discover the same issues from scratch. It is local to this repo (not tied to
any one machine's global Claude memory), so it travels with the code.

**Maintenance rule:** when a standing decision changes, update the section below in place
(don't just append a contradiction lower down). When a new investigation/session produces a
decision, finding, or reverted approach worth remembering, add a dated entry under Session Log.
Keep entries terse — this is a reference, not a transcript.

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
  `destroy()`, `destroyAll()`, `retryPendingDeletions()` are real. `moveEntity()`, `indexedVersions()`,
  `pruneEntities()`, `setWindow()`, `setBuilding()`, `pruneInaccessible()` reject clearly ("does not
  implement ... yet") - **no Rust command exists for any of these six yet**; extending
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

## Future work

- Run a real `cargo check` (at minimum) against `src-tauri/` and work through "Unverified Rust API
  assumptions" above in the order listed - that's the fastest path to a genuinely building repo.
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
