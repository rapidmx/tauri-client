///////////////////////////////////////////////////////////////////////////////
// Copyright (C) 2026 Jean-Philippe Steinmetz
// SPDX-License-Identifier: MPL-2.0
///////////////////////////////////////////////////////////////////////////////
//! PKCE (RFC 7636) code_verifier/code_challenge generation, plus the unrelated random `state`
//! parameter (CSRF protection for the `/oauth/authorize` redirect - RFC 6749 §10.12) the sign-in
//! flow's step 1 also needs. Both are plain random-then-base64url-encode, kept in one small module
//! since neither has any other module-specific logic worth its own file.

use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use base64::Engine as _;
use rand::RngCore;
use sha2::{Digest, Sha256};

use crate::config::{OAUTH_STATE_BYTES, PKCE_VERIFIER_BYTES};

pub struct Pkce {
    /// Sent to `/oauth/token` (step 4) as `code_verifier` - never sent in step 1's redirect.
    pub verifier: String,
    /// Sent to `/oauth/authorize` (step 1) as `code_challenge`, alongside `code_challenge_method=S256`.
    pub challenge: String,
}

fn random_base64url(byte_len: usize) -> String {
    let mut bytes = vec![0u8; byte_len];
    rand::thread_rng().fill_bytes(&mut bytes);
    URL_SAFE_NO_PAD.encode(bytes)
}

/// Generates a fresh `(code_verifier, code_challenge)` pair. `code_challenge` is
/// `BASE64URL-ENCODE(SHA256(ASCII(code_verifier)))` per RFC 7636 §4.2 - computed over the
/// verifier's own ASCII/base64url string bytes, not the raw random bytes it was generated from.
pub fn generate() -> Pkce {
    let verifier = random_base64url(PKCE_VERIFIER_BYTES);
    let mut hasher = Sha256::new();
    hasher.update(verifier.as_bytes());
    let challenge = URL_SAFE_NO_PAD.encode(hasher.finalize());
    Pkce { verifier, challenge }
}

/// Generates a fresh random `state` value for the `/oauth/authorize` redirect.
pub fn generate_state() -> String {
    random_base64url(OAUTH_STATE_BYTES)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn generate_produces_a_verifier_and_matching_challenge() {
        let pkce = generate();
        // 64 raw bytes -> 86 base64url characters, no padding.
        assert_eq!(pkce.verifier.len(), 86);
        assert!(!pkce.verifier.contains('='));
        assert!(!pkce.challenge.contains('='));

        let mut hasher = Sha256::new();
        hasher.update(pkce.verifier.as_bytes());
        let expected_challenge = URL_SAFE_NO_PAD.encode(hasher.finalize());
        assert_eq!(pkce.challenge, expected_challenge);
    }

    #[test]
    fn generate_is_random_across_calls() {
        let a = generate();
        let b = generate();
        assert_ne!(a.verifier, b.verifier);
        assert_ne!(a.challenge, b.challenge);
    }

    #[test]
    fn generate_state_is_random_and_unpadded() {
        let a = generate_state();
        let b = generate_state();
        assert_ne!(a, b);
        assert!(!a.contains('='));
        // 32 raw bytes -> 43 base64url characters.
        assert_eq!(a.len(), 43);
    }
}
