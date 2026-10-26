///////////////////////////////////////////////////////////////////////////////
// Copyright (C) 2026 Jean-Philippe Steinmetz
// SPDX-License-Identifier: MPL-2.0
///////////////////////////////////////////////////////////////////////////////
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App.js";
import { getActiveAccountId } from "./lib/accountSession.js";
import { signedInAccountCount } from "./lib/apiClients.js";
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

// Same "before any search UI mounts" requirement for the local-search transport. Until
// `NATIVE_SEARCH_TRANSPORT_READY` (`src/lib/searchTransport.ts`) is switched on, this keeps
// web-client's own Worker/OPFS transport, holding back its prune of other mailboxes' indexes and
// scoping a sign-out's wipe to the active account while several accounts share this webview's storage.
void installNativeSearchTransport(resolveMailboxAccount, { signedInAccountCount, activeAccountId: getActiveAccountId });

const container = document.getElementById("root");
if (!container) {
    throw new Error('main.tsx: no element with id="root" found in index.html.');
}

createRoot(container).render(
    <StrictMode>
        <App />
    </StrictMode>
);
