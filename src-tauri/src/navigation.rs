///////////////////////////////////////////////////////////////////////////////
// Copyright (C) 2026 Jean-Philippe Steinmetz
// SPDX-License-Identifier: MPL-2.0
///////////////////////////////////////////////////////////////////////////////
//! Keeps every webview on this app's own pages. web-client's shell signs out by navigating the
//! whole document to the account's auth-server, as a browser tab would. Here that page would
//! replace the account switcher with one that has no IPC and no way back, so a navigation to any
//! other http(s) origin is refused. The sign-out itself is finished in JS: the active account's
//! local indexes are destroyed, the account removed and the app reloaded
//! (`src/lib/accountSession.ts`). Nothing else this app renders navigates its document away -
//! the CSP allows no frames, and the consoles and sign-in open in the system browser.

use tauri::plugin::{Builder, TauriPlugin};
use tauri::{Manager, Runtime};
use url::Url;

/// Whether a navigation to `url` stays on this app's own pages: any scheme other than http(s)
/// (`tauri://localhost`, `about:blank`), `http(s)://tauri.localhost` (Windows and Android), or the
/// origin of `dev_url`, the dev server a development build loads its frontend from.
pub fn is_app_url(url: &Url, dev_url: Option<&Url>) -> bool {
    match url.scheme() {
        "http" | "https" => {
            url.host_str() == Some("tauri.localhost")
                || dev_url.is_some_and(|dev| dev.origin() == url.origin())
        }
        _ => true,
    }
}

/// The plugin that refuses navigations `is_app_url()` rejects. Registered from `lib.rs`.
pub fn init<R: Runtime>() -> TauriPlugin<R> {
    Builder::new("app-navigation")
        .on_navigation(|webview, url| {
            // Only a development build loads its pages from the dev server.
            let dev_url = if cfg!(dev) {
                webview.config().build.dev_url.clone()
            } else {
                None
            };
            let allowed = is_app_url(url, dev_url.as_ref());
            if !allowed {
                eprintln!(
                    "[rapidmx] Refused navigation of the app window to {}",
                    url.origin().ascii_serialization()
                );
            }
            allowed
        })
        .build()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn url(value: &str) -> Url {
        Url::parse(value).unwrap()
    }

    #[test]
    fn allows_the_app_pages_on_every_platform() {
        assert!(is_app_url(&url("tauri://localhost/mail/inbox"), None));
        assert!(is_app_url(&url("http://tauri.localhost/"), None));
        assert!(is_app_url(&url("https://tauri.localhost/calendar"), None));
        assert!(is_app_url(&url("about:blank"), None));
    }

    #[test]
    fn allows_the_dev_server_only_when_given() {
        let dev = url("http://localhost:1420");
        assert!(is_app_url(&url("http://localhost:1420/mail"), Some(&dev)));
        assert!(!is_app_url(&url("http://localhost:1420/mail"), None));
        assert!(!is_app_url(&url("http://localhost:1421/"), Some(&dev)));
    }

    #[test]
    fn refuses_another_origin() {
        let dev = url("http://localhost:1420");
        assert!(!is_app_url(&url("https://auth.example.com/"), Some(&dev)));
        assert!(!is_app_url(&url("https://auth.example.com/"), None));
        assert!(!is_app_url(
            &url("https://tauri.localhost.example.com/"),
            None
        ));
        assert!(!is_app_url(&url("http://evil.tauri.localhost/"), None));
    }
}
