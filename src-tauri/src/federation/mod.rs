///////////////////////////////////////////////////////////////////////////////
// Copyright (C) 2026 Jean-Philippe Steinmetz
// SPDX-License-Identifier: MPL-2.0
///////////////////////////////////////////////////////////////////////////////
//! "Add account" server discovery (design doc, "Multi-server 'Add account' flow", steps 1-3):
//! given an email address, find its owner's RapidMX server and separate auth-server.
//!
//! Step 3's `.well-known/rapidmx/server-info` endpoint is now confirmed live on `restapi` (per this
//! task's briefing, 2026-09-27): `GET /.well-known/rapidmx/server-info` (unauthenticated, on the
//! RapidMX server's own origin, not auth-server's) returns `{ "authServerUrl": "<url>" }` - and,
//! critically, returns an **empty string** (never a 404) when the deployment hasn't configured an
//! auth-server URL at all, which `fetch_server_info()` below now treats as an explicit
//! `AppError::Federation` (a clear "this server has no auth-server configured" message), not as a
//! successful resolution to a blank auth-server URL that would otherwise fail confusingly later, at
//! the `/oauth/authorize` step. `resolve_federation_policy()` (the DNS half) works against
//! `restapi`'s *existing* `_rapidmx.<domain>` TXT record convention, unrelated to this endpoint.

pub mod dns;

pub use dns::{resolve_federation_policy, FederationPolicy};

use serde::Deserialize;

use crate::error::{AppError, AppResult};

#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ServerInfo {
    pub server_url: String,
    pub auth_server_url: String,
}

/// The `.well-known/rapidmx/server-info` response shape this module expects - see this module's
/// own doc comment on why this is a best-effort contract, not a confirmed one.
#[derive(Debug, Deserialize)]
struct WellKnownServerInfo {
    #[serde(rename = "authServerUrl")]
    auth_server_url: String,
}

/// Extracts the domain portion of an email address - deliberately minimal (splits on the last
/// `@`), not a full RFC 5321 validator. Good enough for "which domain's `_rapidmx` TXT record do
/// we look up", the only thing this module needs it for; a malformed address either has no `@`
/// (rejected below) or produces a domain that simply won't resolve, which `resolve_federation_policy()`
/// already reports as "not a federated peer" rather than a hard error.
fn extract_domain(email: &str) -> AppResult<String> {
    match email.rsplit_once('@') {
        Some((_, domain)) if !domain.is_empty() => Ok(domain.to_lowercase()),
        _ => Err(AppError::Federation(format!("{email:?} is not a valid email address (no domain part)"))),
    }
}

/// Fetches `https://<host>/.well-known/rapidmx/server-info` - see this module's own doc comment.
/// Always HTTPS: this is a discovery request that will carry the resolved `authServerUrl` a user's
/// credentials are about to be sent to, so it must not be susceptible to a plaintext-HTTP
/// downgrade/MITM the way `electron-client`'s own dev-mode `RAPIDMX_AUTH_SERVER_URL` default
/// could be (see that repo's `.claude/NOTES.md`, 2026-09-23 entries).
async fn fetch_server_info(host: &str) -> AppResult<ServerInfo> {
    let url = format!("https://{host}/.well-known/rapidmx/server-info");
    let response = reqwest::get(&url).await?.error_for_status()?;
    let body: WellKnownServerInfo = response.json().await?;
    // Confirmed contract (see this module's own doc comment): an empty string, not a 404, is how
    // `restapi` says "no auth-server configured for this deployment" - surface that as a clear,
    // specific error now rather than letting an empty `authServerUrl` silently flow into
    // `oauth::begin_sign_in`, which would build a nonsensical `/oauth/authorize` URL against no
    // host at all and fail with a much more confusing error (or none, if `opener` doesn't validate
    // the URL before handing it to the OS).
    if body.auth_server_url.is_empty() {
        return Err(AppError::Federation(format!(
            "{host} has not configured an auth-server - this RapidMX deployment cannot sign in a native client yet. Ask its administrator to set an auth-server URL."
        )));
    }
    Ok(ServerInfo {
        server_url: format!("https://{host}"),
        auth_server_url: body.auth_server_url,
    })
}

/// The full "Add account" discovery flow (design doc steps 1-3): resolve `email`'s domain's
/// `_rapidmx` TXT record, then fetch the resolved host's `server-info` document. Returns
/// `AppError::Federation` (not `Ok(None)`, unlike `resolve_federation_policy()` itself) when no
/// policy is published at all - from this command's point of view (the frontend's "Add account"
/// button), a domain with no RapidMX server is simply an error to show the user, not a valid
/// "maybe" state to represent further.
pub async fn resolve_server_info(email: &str) -> AppResult<ServerInfo> {
    let domain = extract_domain(email)?;
    let policy = resolve_federation_policy(&domain)
        .await?
        .ok_or_else(|| AppError::Federation(format!("{domain} does not publish a _rapidmx TXT record - it may not run RapidMX.")))?;
    fetch_server_info(&policy.host).await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn extract_domain_lowercases_and_splits_on_last_at() {
        assert_eq!(extract_domain("user@Example.COM").unwrap(), "example.com");
    }

    #[test]
    fn extract_domain_uses_the_last_at_for_a_quoted_local_part() {
        // RFC 5321 allows an @ inside a quoted local-part - rsplit_once still finds the real
        // domain boundary as long as the domain itself never legally contains an @, which it can't.
        assert_eq!(extract_domain("\"a@b\"@example.com").unwrap(), "example.com");
    }

    #[test]
    fn extract_domain_rejects_a_string_with_no_at() {
        assert!(extract_domain("not-an-email").is_err());
    }

    #[test]
    fn extract_domain_rejects_an_empty_domain() {
        assert!(extract_domain("user@").is_err());
    }
}
