import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

/**
 * Standard Tauri v2 + Vite setup (see https://v2.tauri.app/start/frontend/vite/). A few things
 * here are load-bearing for the Rust side, not just convention:
 *
 * - `clearScreen: false` - Tauri's own CLI output (cargo build errors, panics) would otherwise be
 *   wiped from the terminal by Vite's default screen-clearing on every reload.
 * - The fixed `server.port` (1420) is the port `src-tauri/tauri.conf.json`'s
 *   `build.devUrl` points the webview at in `tauri dev` - `strictPort: true` so a silently
 *   different port (e.g. 1420 already in use) fails loudly instead of the webview loading nothing.
 * - `server.host`/`server.hmr` honor `TAURI_DEV_HOST`, which the Tauri CLI sets when running
 *   against a real mobile device/simulator (iOS/Android) rather than the desktop webview - the dev
 *   server otherwise only binds to localhost, unreachable from a physical device on the network.
 * - `tailwindcss()` - `@rapidmx/web-client`'s own stylesheet (`apps/shared/styles`) is Tailwind v4 and names its own
 *   `@source` paths, so it builds here exactly as in the server (`serverViteConfig.ts`).
 * - `envPrefix: ["VITE_", "TAURI_"]` exposes `TAURI_*` env vars (platform/family/arch, set by the
 *   Tauri CLI at build time) to `import.meta.env`, in addition to Vite's own default `VITE_` prefix.
 */
const host = process.env.TAURI_DEV_HOST;

export default defineConfig({
    plugins: [react(), tailwindcss()],
    clearScreen: false,
    envPrefix: ["VITE_", "TAURI_"],
    resolve: {
        // Forces every import of react/react-dom (this app's own, and `@rapidmx/web-client`'s - a
        // `link:`ed sibling package with its own `node_modules`) onto one physical copy - without
        // this, hooks called from the mounted `apps/www` pages can fail with "Invalid hook call"
        // against a second React instance. Same reasoning, same fix, as `@rapidmx/electron-client`'s
        // own `vite.config.ts`.
        //
        // `@rapidrest/react` needs the same treatment for a different symptom: `web-client` is its
        // own separate yarn project and has never been told to use this repo's `link:`ed sibling
        // checkout for it, so `web-client/node_modules/@rapidrest/react` is whatever was last
        // actually published there (today: 2.1.0, which predates `mountRouter()`). `web-client`'s
        // `apps/www` page modules import `@rapidrest/react/client` themselves (for `Link`,
        // `useRouter`, ...), so without deduping, Vite's dependency optimizer can collapse every
        // import of that specifier - this app's own `App.tsx` included - onto whichever physical
        // copy it scans first, which may be `web-client`'s stale one: the exact failure this was
        // debugged from (`mountRouter` missing from the optimized chunk, a blank window, confirmed
        // against a real `yarn dev` run - see `.claude/NOTES.md`). Deduping forces every resolution
        // back to this project's own root copy (the current, linked sibling checkout) regardless of
        // which package's source did the importing.
        dedupe: ["react", "react-dom", "@rapidrest/react"],
    },
    server: {
        port: 1420,
        strictPort: true,
        host: host || false,
        hmr: host
            ? {
                  protocol: "ws",
                  host,
                  port: 1421,
              }
            : undefined,
        watch: {
            // Never rebuild the frontend because Rust source changed underneath it - `tauri dev`
            // already watches src-tauri itself and restarts the whole app on a Rust change.
            ignored: ["**/src-tauri/**"],
        },
    },
    build: {
        outDir: "dist",
        emptyOutDir: true,
        // Tauri's own webview already targets a modern enough runtime per-OS; match its docs'
        // recommended target split instead of Vite's browser-oriented default.
        target: process.env.TAURI_ENV_PLATFORM === "windows" ? "chrome105" : "safari13",
        // Deliberately not `minify: "esbuild"` - this Vite version (8.x) no longer bundles esbuild
        // as a direct dependency for its own sake (it's moved toward rolldown/oxc), so requesting
        // it by name fails a real build unless `esbuild` is installed as a separate devDependency
        // (confirmed by actually running `yarn build` in this sandbox - see .claude/NOTES.md).
        // Plain `minify: !TAURI_ENV_DEBUG` lets Vite pick its own current default minifier instead.
        minify: !process.env.TAURI_ENV_DEBUG,
        sourcemap: !!process.env.TAURI_ENV_DEBUG,
    },
});
