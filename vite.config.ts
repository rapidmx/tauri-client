import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

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
 * - `envPrefix: ["VITE_", "TAURI_"]` exposes `TAURI_*` env vars (platform/family/arch, set by the
 *   Tauri CLI at build time) to `import.meta.env`, in addition to Vite's own default `VITE_` prefix.
 */
const host = process.env.TAURI_DEV_HOST;

export default defineConfig({
    plugins: [react()],
    clearScreen: false,
    envPrefix: ["VITE_", "TAURI_"],
    resolve: {
        // Forces every import of react/react-dom (this app's own, and `@rapidmx/web-client`'s and
        // `@rapidmx/react-shared`'s, both `link:`ed sibling packages with their own `node_modules`)
        // onto one physical copy - without this, hooks called from the mounted `apps/www` pages can
        // fail with "Invalid hook call" against a second React instance. Same reasoning, same fix, as
        // `@rapidmx/electron-client`'s own `vite.config.ts`.
        dedupe: ["react", "react-dom"],
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
