# Release Notes

## Unreleased

RapidMX's native desktop and mobile client - a Tauri v2 shell that replaces the `electron-client`
proof-of-concept. Signs in to any self-hosted RapidMX server via OAuth2/PKCE against auth-server's
real authorization endpoints, holding multiple accounts' refresh tokens in the OS keychain, and lays
the groundwork for a native, SQLCipher-encrypted local search index. This initial scaffold's
frontend is a minimal placeholder (list/add/remove accounts) - the real multi-account UI, mounting
`@rapidmx/web-client`'s own page components, is future work pending two APIs still being finalized
in parallel efforts (`@rapidrest/react`'s CSR bootstrap, `@rapidmx/react-shared`'s explicit-context
API client - see `src/lib/webClientBridge.ts` and `.claude/NOTES.md`).

### Known limitations

- The Rust/Tauri core (`src-tauri/`) was written without access to a Rust toolchain and has not
  been compiled or run - see `.claude/NOTES.md` for the specific API surfaces (hickory-resolver,
  the `tauri-plugin-secure-keystore` Rust API, rusqlite's bundled-sqlcipher+FTS5 interaction, the
  `tauri::menu` API) that most need verification against a real build before this is relied upon.
- auth-server's `/oauth/session-token` endpoint and restapi's `.well-known/rapidmx/server-info`
  endpoint are implemented against documented contracts from parallel efforts, not confirmed live
  endpoints.
