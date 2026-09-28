///////////////////////////////////////////////////////////////////////////////
// Copyright (C) 2026 Jean-Philippe Steinmetz
// SPDX-License-Identifier: MPL-2.0
///////////////////////////////////////////////////////////////////////////////
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App.js";
import { installRapidMxShim } from "./lib/rapidmxShim.js";
import { resolveMailboxAccount } from "./lib/mailboxRegistry.js";
import { installNativeSearchTransport } from "./lib/searchTransport.js";
import "./styles.css";

// `window.rapidmx` has to exist before `App` ever calls `mountRouter()` - `@rapidmx/web-client`'s
// desktop-client duck-typing (`isElectronClient()`/`isElectronRuntime()`) only checks that the
// property exists, not that it has resolved data yet, so installing it here - before React even
// renders - is as early as this bootstrap can make it. See `src/lib/rapidmxShim.ts`'s own doc
// comment for the exact shape and why.
installRapidMxShim();

// Same "before any search UI mounts" requirement for the native local-search transport - see
// `src/lib/searchTransport.ts`'s own doc comment for why this is currently a safe, logged no-op
// (the installable `@rapidmx/web-client` doesn't export `setLocalIndexTransport()` yet).
void installNativeSearchTransport(resolveMailboxAccount);

const container = document.getElementById("root");
if (!container) {
    throw new Error('main.tsx: no element with id="root" found in index.html.');
}

createRoot(container).render(
    <StrictMode>
        <App />
    </StrictMode>
);
