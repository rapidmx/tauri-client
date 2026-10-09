# RapidMX: Native Client

A [Tauri v2](https://v2.tauri.app/) desktop and mobile native app for RapidMX - the real, shippable
successor to [`electron-client`](https://github.com/rapidmx/electron-client) (an Electron
proof-of-concept that this repo replaces, not extends). Unlike that repo's single hardcoded
`serverUrl`/`authServerUrl` pair, this app signs in to **any** independently self-hosted RapidMX
server and holds **multiple accounts open at once**, with instant switching and no re-login - like
Slack's or Discord's account switcher.

See [`.claude/NOTES.md`](.claude/NOTES.md) for this repo's full standing decisions and session log,
including exactly what's implemented vs. stubbed and every place this session's Rust code could not
be verified against a real build (there is no Rust toolchain in the sandbox that built the first
version of this repo).

## How this app works (target design)

1. **Sign-in** opens the system browser to auth-server's `/auth/authorize` sign-in page (OAuth2 +
   PKCE, a registered `PUBLIC` client - the page calls `/oauth/authorize` itself), receives
   `rapidmx://auth/callback` back via a deep link, and
   exchanges the code for tokens - entirely in the Rust process via `reqwest`, never through the
   webview, so an OAuth token never enters the webview's JS context at all. See
   `src-tauri/src/oauth/mod.rs`.
2. **"Add account"** resolves a typed email address's `_rapidmx.<domain>` DNS TXT record (mirroring
   `restapi`'s server-side `FederationUtils.ts`, reimplemented here in Rust since that logic can't be
   imported across languages) to find the account's RapidMX server, then fetches
   `.well-known/rapidmx/server-info` for its separate auth-server URL. See
   `src-tauri/src/federation/`.
3. Each account's refresh token lives only in the OS keychain (Keychain/Credential Manager/Secret
   Service/Android Keystore/iOS Keychain via `tauri-plugin-secure-keystore`), one entry per account -
   never on disk in plain form, never in the webview. See `src-tauri/src/keychain.rs`.
4. A native Tier 2 full-text search index, one per account, mirroring `web-client`'s FTS5 schema
   natively. The live index is in-memory SQLite; it is persisted as a single blob encrypted with
   libsodium's XChaCha20-Poly1305, since SQLCipher would need OpenSSL. See `src-tauri/src/search/`.
5. The UI is `@rapidmx/web-client`'s real page components, mounted client-side per account with
   `mountRouter()` from `@rapidrest/react`. Each account gets its own `ApiClient` carrying that
   account's session token, and `web-client`'s `lib/` (the former `@rapidmx/react-shared`, merged
   in) supplies the API clients.

## What this session actually built vs. stubbed

**Full detail is in `.claude/NOTES.md`** - short version:

- **Complete, real implementations** (Rust, written carefully but **not compiled or run** - see
  "Known limitations" below): the OAuth2/PKCE flow end to end, DNS-based server discovery, the
  account store, OS-keychain wrapper, the desktop application menu (ported from `electron-client`'s
  `menu.ts`), and the native SQLCipher+FTS5 search schema/commands.
- **Deliberately stubbed, with a documented contract**: `src/lib/webClientBridge.ts` - the actual
  CSR-mount of `@rapidmx/web-client`'s pages. It depends on two APIs still being finalized in
  parallel efforts (`@rapidrest/react`'s CSR bootstrap, `@rapidmx/react-shared`'s explicit-context
  API client) that don't exist in this sandbox's checked-out copies of those repos yet - the file
  documents the expected contract rather than guessing at exact, likely-to-be-wrong parameter names.
- **This session's actual frontend** (`src/App.tsx`) is a minimal placeholder: it proves the Tauri
  window boots and can drive the real Rust-side OAuth flow (list accounts already on disk, add a new
  one via a real system-browser sign-in, remove one) - not the real account-switcher UI.

## Server prerequisites (every deployment this app signs in to)

Operators must do all of these before the app can sign in to a deployment. None are done by this repo.

1. **Register the OAuth client.** Create one PUBLIC client on the deployment's auth-server with the
   uid **`7f3c2b9e-5a1d-4c8e-9b6f-0d2a1e4c7b53`** (the value of `OAUTH_CLIENT_ID`). auth-server keys
   clients by record uid, and a caller-supplied uid is kept, so the same uid works on every
   deployment. Fields: `clientType: "public"`, `tokenEndpointAuthMethod: "none"`,
   `requirePkce: true`, `redirectUris: ["rapidmx://auth/callback"]`,
   `grantTypes: ["authorization_code", "refresh_token"]`, `responseTypes: ["code"]`,
   `scope: "openid profile email offline_access"` (`offline_access` is required, or no refresh token
   is issued), and `firstParty: true` so the consent screen is skipped. Creating it needs a trusted
   administrator.
2. **Allow the webview's origin in CORS.** The app's API calls come from the Tauri webview, whose
   origin is `tauri://localhost` (macOS, Linux) or `https://tauri.localhost` (Windows). Without
   them, the browser blocks every API call. Either add both to the server's `cors.origins` list, or
   set it to `"*"`. The same list gates the mail push websocket: a request whose `Origin` is not on
   the list is refused with a 1008 close, so push updates need the list too. (Auth bearer requests
   send no credentials, so the origins need no credentials flag.)
3. **Serve the discovery endpoint.** Sign-in and "Add account" fetch
   `GET /.well-known/rapidmx/server-info` from the server host to learn its auth-server URL. That
   route is defined in `restapi`, but the `server` repo does not mount it yet, so it currently
   returns 404. The fix is a `ServerInfoRoute` in `server/src/{mongo,sql}/routes/` with
   `@Route("/.well-known/rapidmx/server-info")` extending `ServerInfoRouteMongo`/`ServerInfoRouteSQL`
   from `restapi`.

## Known gaps / not yet done

- **Message bodies, vCard import, quoted pictures and attachment downloads still use cookie-only
  requests in `web-client`** (`fetchBodyContent`, `fetchVCardText`, `fetchContentHtml`,
  `serverImageResolver`, and the `attachmentContentUrl` links). A native host fails on these until
  `web-client` routes them through the host's `ApiClient`. This is the largest remaining gap.
- **No token revocation on "Remove account"** - auth-server has no documented revoke endpoint yet;
  removing an account here only deletes this app's own local record and keychain entry.
- **No automatic near-expiry session-token refresh loop** - `oauth::refresh_session_token()` exists
  and implements the refresh grant, but nothing schedules it yet.

## Development

This repo needs both a Node/Yarn toolchain (for the frontend, actually runnable in this sandbox) and
a Rust/Tauri CLI toolchain (for `src-tauri/`, **not available in the sandbox this repo was first
built in** - see `.claude/NOTES.md`).

```bash
git clone https://github.com/rapidmx/tauri-client
cd tauri-client
corepack enable
yarn install
yarn lint
yarn test
yarn build          # frontend only (tsc --noEmit + vite build) - does not touch src-tauri
yarn dev            # requires a real Rust/Tauri toolchain - runs `tauri dev`
```

## What this repo deliberately does not do yet

- No real multi-account switcher UI, no CSR-mounted `@rapidmx/web-client` pages (see above).
- No mobile builds actually attempted (`tauri android init`/`tauri ios init` were never run - see
  `.gitignore`'s note on `src-tauri/gen`).
- No packaging/code signing/auto-update.
- No wiring between the native search index and any real mailbox data or E2E key-unlock flow -
  `search_local_init`'s `master_key_base64` parameter has nothing in this app yet that supplies it.
