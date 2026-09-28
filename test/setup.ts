///////////////////////////////////////////////////////////////////////////////
// Copyright (C) 2026 Jean-Philippe Steinmetz
// SPDX-License-Identifier: MPL-2.0
///////////////////////////////////////////////////////////////////////////////
import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

// There is no real Tauri runtime in `vitest run` (or this sandbox generally - see
// .claude/NOTES.md) - `@tauri-apps/api/core`'s `invoke()` and `@tauri-apps/api/event`'s `listen()`
// are mocked per-test-file (`vi.mock(...)`) rather than here, so each test controls its own
// resolved/rejected values instead of sharing one global mock across the whole suite.
afterEach(() => {
    cleanup();
});
