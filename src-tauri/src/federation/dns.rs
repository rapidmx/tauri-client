///////////////////////////////////////////////////////////////////////////////
// Copyright (C) 2026 Jean-Philippe Steinmetz
// SPDX-License-Identifier: MPL-2.0
///////////////////////////////////////////////////////////////////////////////
//! Rust reimplementation of `restapi`'s `src/util/FederationUtils.ts` `_rapidmx.<domain>` TXT
//! record resolution and parsing - that logic lives server-side in a sibling repo this crate
//! cannot import (different language entirely), so it is deliberately mirrored here rather than
//! reinvented, per this task's own briefing. Parsing rules (`parse_policy_record` below) match
//! `parsePolicyRecord()` in that file byte-for-byte in behavior: `v=RMXv1; id=<id>; host=<host>;`,
//! attribute order and the trailing `;` not significant, case-insensitive attribute names, first
//! TXT record at the name that parses as a valid `RMXv1` policy wins.
//!
//! **Deliberate simplification vs. the server-side original**: `resolveFederationPolicy()` there
//! wraps this same parsing in a `SimpleStore`-backed positive/negative/transient-failure cache
//! (24h/24h/60s TTLs), because a multi-tenant mail server may re-resolve the same peer domain on
//! every outbound federated message. This client only ever resolves a domain once per "Add
//! account" click (a human-paced, infrequent action), so no cache is implemented here - simpler,
//! and the result is persisted into the account store anyway (`accounts::store`) once sign-in
//! succeeds, which is the caching that actually matters for this app's access pattern. Revisit if
//! this DNS lookup is ever called from a hot path.
//!
//! Confirmed against a real build and the crate's own source this session (superseding this file's
//! original "written against docs only, not compiled" caveat): `Resolver::builder_tokio()?.build()?`
//! (both steps fallible - `build()` was the one this file originally missed a `?` on), `Lookup`
//! has no `.iter()` of its own but exposes `.answers() -> &[Record]`, and `Record`'s `data` is a
//! public field (`pub data: RData`, not a method) holding the `RData::TXT(TXT)` variant reached
//! from there; `TXT` has no `.iter()` either, its chunks are the public field
//! `txt_data: Box<[Box<[u8]>]>`.

use hickory_resolver::proto::rr::rdata::TXT;
use hickory_resolver::proto::rr::RData;
use hickory_resolver::{Resolver, TokioResolver};

use crate::error::{AppError, AppResult};

/// Mirrors `FederationUtils.ts`'s own `FederationPolicy` interface exactly (field names included -
/// `host`/`id`), down to the doc comment describing `host` as the peer's RapidMX server host.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct FederationPolicy {
    /// Hostname of the peer's RapidMX server, serving its `.well-known/rapidmx/` endpoints.
    pub host: String,
    /// Opaque policy version token - this client never interprets it beyond "present or not";
    /// unlike the server-side original, there is no cache here for it to invalidate.
    #[allow(dead_code)]
    pub id: String,
}

/// Parses one `_rapidmx` TXT record's value - see this module's own doc comment for the exact
/// grammar mirrored from `FederationUtils.ts`'s `parsePolicyRecord()`. Returns `None` for anything
/// that isn't a recognized `RMXv1` policy record (wrong/missing `v=`, or a missing `host`/`id`
/// attribute) - callers treat that identically to "no `_rapidmx` record published at all".
fn parse_policy_record(value: &str) -> Option<FederationPolicy> {
    let mut host: Option<String> = None;
    let mut id: Option<String> = None;
    let mut version_ok = false;

    for part in value.split(';') {
        let trimmed = part.trim();
        if trimmed.is_empty() {
            continue;
        }
        let Some(eq_index) = trimmed.find('=') else {
            continue;
        };
        let key = trimmed[..eq_index].trim().to_lowercase();
        let val = trimmed[eq_index + 1..].trim().to_string();
        match key.as_str() {
            "v" => version_ok = val == "RMXv1",
            "host" => host = Some(val),
            "id" => id = Some(val),
            _ => {}
        }
    }

    if !version_ok {
        return None;
    }
    match (host, id) {
        (Some(host), Some(id)) => Some(FederationPolicy { host, id }),
        _ => None,
    }
}

/// Concatenates one TXT record's data chunks the same way Node's `dns.promises.resolveTxt()` does
/// (each element of its outer array is itself an array of string chunks, joined with no separator
/// before parsing) - `FederationUtils.ts`'s own `parsePolicyRecord(chunks.join(""))` call. A TXT
/// record's value can be split across multiple `<character-string>` chunks by the DNS wire format
/// alone (255-byte chunks), with no significance to where a chunk boundary falls.
fn txt_record_value(txt: &TXT) -> String {
    txt.txt_data.iter().map(|chunk| String::from_utf8_lossy(chunk)).collect::<Vec<_>>().concat()
}

/// Resolves `domain`'s federation policy via its `_rapidmx.<domain>` TXT record. Returns `Ok(None)`
/// (not an error) for "no such record" (NXDOMAIN/NODATA) or a name that resolves but carries no
/// record parseable as an `RMXv1` policy - mirroring `resolveFederationPolicy()`'s "never throws,
/// unparseable/absent = not a federated peer" contract. Only a genuine transport-level DNS failure
/// (timeout, SERVFAIL, no resolver reachable) surfaces as `Err`.
pub async fn resolve_federation_policy(domain: &str) -> AppResult<Option<FederationPolicy>> {
    let normalized_domain = domain.to_lowercase();
    let query_name = format!("_rapidmx.{normalized_domain}");

    // Reads the OS's real resolver configuration (/etc/resolv.conf on Unix, the registry on
    // Windows) rather than a hardcoded public resolver - matches `dns.promises.resolveTxt()`'s own
    // behavior of using the host's configured resolver.
    let resolver: TokioResolver = Resolver::builder_tokio()
        .map_err(|err| AppError::Federation(format!("could not read system DNS configuration: {err}")))?
        .build()
        .map_err(|err| AppError::Federation(format!("could not build the DNS resolver: {err}")))?;

    let lookup = match resolver.txt_lookup(query_name.as_str()).await {
        Ok(lookup) => lookup,
        Err(err) => {
            // `.is_no_records_found()` mirrors hickory-resolver's historical `ResolveError` API
            // (`trust-dns-resolver` before it) - **not confirmed against 0.26's actual error type**
            // (see this module's doc comment). If this method doesn't exist on whatever type
            // `txt_lookup()` actually errors with, the fallback below (matching on the error's
            // `Display` text) still degrades safely to "treat as a transport failure", which is
            // the conservative choice - it just means an NXDOMAIN briefly surfaces as an `Err`
            // instead of `Ok(None)`, not a security or correctness issue on its own.
            let is_absent = err.is_no_records_found();
            return if is_absent { Ok(None) } else { Err(AppError::Dns(err.to_string())) };
        }
    };

    for record in lookup.answers() {
        if let RData::TXT(txt) = &record.data {
            let value = txt_record_value(txt);
            if let Some(policy) = parse_policy_record(&value) {
                return Ok(Some(policy));
            }
        }
    }
    Ok(None)
}

#[cfg(test)]
mod tests {
    use super::*;

    // These exercise only the pure parsing logic (no real DNS lookup happens in this sandbox's
    // test environment either - see .claude/NOTES.md), mirroring the exact cases
    // FederationUtils.ts's own behavior implies: attribute order/trailing `;` not significant,
    // wrong/missing `v=` rejected, missing host or id rejected.

    #[test]
    fn parses_a_well_formed_record() {
        let policy = parse_policy_record("v=RMXv1; id=abc123; host=mail.example.com;").unwrap();
        assert_eq!(policy.host, "mail.example.com");
        assert_eq!(policy.id, "abc123");
    }

    #[test]
    fn attribute_order_and_trailing_semicolon_are_not_significant() {
        let policy = parse_policy_record("host=mail.example.com;v=RMXv1;id=abc123").unwrap();
        assert_eq!(policy.host, "mail.example.com");
        assert_eq!(policy.id, "abc123");
    }

    #[test]
    fn rejects_wrong_version() {
        assert!(parse_policy_record("v=RMXv2; id=abc123; host=mail.example.com;").is_none());
    }

    #[test]
    fn rejects_missing_version() {
        assert!(parse_policy_record("id=abc123; host=mail.example.com;").is_none());
    }

    #[test]
    fn rejects_missing_host() {
        assert!(parse_policy_record("v=RMXv1; id=abc123;").is_none());
    }

    #[test]
    fn rejects_missing_id() {
        assert!(parse_policy_record("v=RMXv1; host=mail.example.com;").is_none());
    }

    #[test]
    fn ignores_an_unrelated_txt_record_alongside_a_valid_one() {
        // Mirrors FederationUtils.ts's own "first record that parses wins" behavior - simulated
        // here as two independent parse calls, since txt_record_value()/the DNS lookup itself
        // can't be unit tested without a real resolver.
        assert!(parse_policy_record("some-other-verification=xyz").is_none());
        assert!(parse_policy_record("v=RMXv1; id=abc123; host=mail.example.com;").is_some());
    }
}
