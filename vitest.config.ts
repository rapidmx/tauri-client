import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

// This repo's frontend is currently a minimal placeholder (see .claude/NOTES.md) - a single-page
// React app that boots the Tauri webview and exposes a "Sign in" button wired to the Rust-side
// OAuth flow via `invoke()`. `@tauri-apps/api`'s `invoke` is mocked in `test/setup.ts` since there
// is no real Tauri runtime (or Rust binary) available in this sandbox or in a plain `vitest run`.
export default defineConfig({
    plugins: [react()],
    resolve: {
        dedupe: ["react", "react-dom"],
    },
    test: {
        globals: true,
        environment: "jsdom",
        setupFiles: ["./test/setup.ts"],
        include: ["test/**/*.test.ts", "test/**/*.test.tsx"],
        clearMocks: true,
        coverage: {
            enabled: true,
            provider: "v8",
            include: ["src/**/*.ts", "src/**/*.tsx"],
            exclude: ["**/node_modules/**", "**/test/**"],
            reporter: ["text", "json", "html", "lcov"],
            thresholds: {
                "src/**": {
                    branches: 100,
                    functions: 100,
                    lines: 100,
                    statements: 100,
                },
            },
            reportsDirectory: "coverage",
        },
        reporters: ["default", "junit"],
        outputFile: {
            junit: "junit.xml",
        },
    },
});
