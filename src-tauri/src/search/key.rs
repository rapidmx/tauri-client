///////////////////////////////////////////////////////////////////////////////
// Copyright (C) 2026 Jean-Philippe Steinmetz
// SPDX-License-Identifier: MPL-2.0
///////////////////////////////////////////////////////////////////////////////
//! Derives this account's local-index encryption key, mirroring `web-client`'s
//! `apps/shared/search/localIndexKey.ts` HKDF-from-master-key approach (same primitive - HKDF-SHA256
//! over the mailbox/account master key with a fixed, non-secret salt; see that file's own doc
//! comment for why a fixed salt is fine here: the master key is already 32 bytes of uniform random
//! key material, so a salt only matters for stretching low-entropy input, which this isn't).
//!
//! **Scoped by account id, not mailbox id** - see `schema.rs`'s doc comment for the one-db-per-
//! account granularity decision this follows from. The `info` string context (`"local-search-
//! index:{account_id}"`) intentionally still mirrors the *shape* of the web client's own
//! `"local-search-index:{mailboxUid}"`, just keyed by the coarser identifier.
//!
//! **Where does `master_key` come from?** Out of scope for this module and this session - it's
//! whatever the E2E encryption unlock flow (a whole separate subsystem this task's briefing does
//! not ask this session to build) hands this app once a mailbox's keys are unlocked. This function
//! is a pure derivation utility over whatever 32-byte key material it's given; wiring that
//! material in from the real unlock flow is future work.
//!
//! The derived key is a raw libsodium `crypto_aead::xchacha20poly1305` key (see `mod.rs`'s
//! `persist`/`open_or_rebuild`) - HKDF-SHA256 (via the pure-Rust `hkdf`/`sha2` crates, not
//! libsodium's own KDF) is kept as the derivation primitive specifically so this stays
//! byte-for-byte comparable to `localIndexKey.ts`'s derivation shape, even though the two now feed
//! two unrelated cipher families (XChaCha20-Poly1305 here, AES-256-GCM there).

use hkdf::Hkdf;
use libsodium_rs::crypto_aead::xchacha20poly1305::KEYBYTES;
use sha2::Sha256;

use crate::error::{AppError, AppResult};

/// Fixed, non-secret HKDF salt - see this module's own doc comment for why a fixed salt is
/// appropriate here. Deliberately a different literal than `localIndexKey.ts`'s own
/// `"rapidmx-local-search-index-v1"` - the two are unrelated key derivations (different KDF
/// output consumers entirely: a native libsodium XChaCha20-Poly1305 key vs. a browser AES-GCM page
/// key), and reusing the same salt string across them would only create a false impression that
/// they're meant to be interchangeable.
const FIXED_SALT: &[u8] = b"rapidmx-tauri-local-search-index-v1";

/// Raw key length libsodium's XChaCha20-Poly1305 expects - 256 bits, same length `KEYBYTES` names.
pub const LOCAL_INDEX_KEY_LEN: usize = KEYBYTES;

/// Derives this account's local-index encryption key from its already-unlocked master key. Every
/// call with the same `(master_key, account_id)` pair returns the identical key.
pub fn derive_local_index_key(master_key: &[u8], account_id: &str) -> AppResult<[u8; LOCAL_INDEX_KEY_LEN]> {
    let hk = Hkdf::<Sha256>::new(Some(FIXED_SALT), master_key);
    let info = format!("local-search-index:{account_id}");
    let mut okm = [0u8; LOCAL_INDEX_KEY_LEN];
    hk.expand(info.as_bytes(), &mut okm)
        .map_err(|err| AppError::Other(format!("HKDF expand failed deriving the local index key: {err}")))?;
    Ok(okm)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn derive_local_index_key_is_deterministic() {
        let master_key = [7u8; 32];
        let a = derive_local_index_key(&master_key, "account-1").unwrap();
        let b = derive_local_index_key(&master_key, "account-1").unwrap();
        assert_eq!(a, b);
    }

    #[test]
    fn derive_local_index_key_differs_by_account_id() {
        let master_key = [7u8; 32];
        let a = derive_local_index_key(&master_key, "account-1").unwrap();
        let b = derive_local_index_key(&master_key, "account-2").unwrap();
        assert_ne!(a, b);
    }

    #[test]
    fn derive_local_index_key_differs_by_master_key() {
        let a = derive_local_index_key(&[7u8; 32], "account-1").unwrap();
        let b = derive_local_index_key(&[9u8; 32], "account-1").unwrap();
        assert_ne!(a, b);
    }
}
