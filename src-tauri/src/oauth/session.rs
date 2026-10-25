///////////////////////////////////////////////////////////////////////////////
// Copyright (C) 2026 Jean-Philippe Steinmetz
// SPDX-License-Identifier: MPL-2.0
///////////////////////////////////////////////////////////////////////////////
//! The per-account session JWT cache behind the `get_session_token` command.
//!
//! auth-server rotates the refresh token on every redemption, and presenting one it has already
//! rotated away revokes the whole token family (rapidrest/auth `BaseOAuthTokenRoute`). So two
//! overlapping refreshes for one account - two requests through the same `ApiClient` at once - would
//! sign that account out. Every caller for an account therefore takes that account's async lock, and
//! whoever holds it either returns the cached session JWT (while it is more than
//! `EXPIRY_MARGIN_SECONDS` from its `exp`) or does the one refresh and caches its result, so callers
//! that were waiting get the fresh token instead of redeeming the old refresh token again.

use std::collections::HashMap;
use std::future::Future;
use std::sync::{Arc, Mutex};

use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use base64::Engine as _;
use tauri::async_runtime::Mutex as AsyncMutex;

use crate::error::AppResult;

/// A cached token is refreshed once it is this close to its `exp`, so a request never goes out with
/// one that expires on the way.
pub const EXPIRY_MARGIN_SECONDS: i64 = 60;

struct CachedSession {
    token: String,
    expires_at: i64,
}

type Slot = Arc<AsyncMutex<Option<CachedSession>>>;

/// Managed Tauri state (`app.manage(SessionTokens::default())` in `lib.rs`): one lock and cached
/// session JWT per account id. Held in memory only, never persisted.
#[derive(Default)]
pub struct SessionTokens(Mutex<HashMap<String, Slot>>);

/// The `exp` claim (seconds since the epoch) of a JWT, read without verifying it - the token came
/// straight from auth-server over TLS, and this only decides when to fetch a new one.
pub fn jwt_expiry(token: &str) -> Option<i64> {
    let payload = token.split('.').nth(1)?;
    let bytes = URL_SAFE_NO_PAD.decode(payload.trim_end_matches('=')).ok()?;
    let claims: serde_json::Value = serde_json::from_slice(&bytes).ok()?;
    claims.get("exp")?.as_i64()
}

impl SessionTokens {
    fn slot(&self, account_id: &str) -> Slot {
        let mut guard = self.0.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
        guard.entry(account_id.to_string()).or_default().clone()
    }

    /// Drops `account_id`'s cached token - on account removal.
    pub fn forget(&self, account_id: &str) {
        let mut guard = self.0.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
        guard.remove(account_id);
    }

    /// `account_id`'s cached session JWT when it is still good at `now` (seconds since the epoch),
    /// otherwise the result of `refresh`, run while holding the account's lock and cached when it
    /// carries an `exp`. A failed refresh caches nothing, so the next caller tries again.
    pub async fn get_or_refresh<F, Fut>(&self, account_id: &str, now: impl Fn() -> i64, refresh: F) -> AppResult<String>
    where
        F: FnOnce() -> Fut,
        Fut: Future<Output = AppResult<String>>,
    {
        let slot = self.slot(account_id);
        let mut cached = slot.lock().await;
        if let Some(session) = cached.as_ref() {
            if session.expires_at - EXPIRY_MARGIN_SECONDS > now() {
                return Ok(session.token.clone());
            }
        }
        *cached = None;
        let token = refresh().await?;
        if let Some(expires_at) = jwt_expiry(&token) {
            *cached = Some(CachedSession { token: token.clone(), expires_at });
        }
        Ok(token)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicUsize, Ordering};

    use crate::error::AppError;

    fn jwt(exp: i64) -> String {
        let payload = URL_SAFE_NO_PAD.encode(format!("{{\"sub\":\"u1\",\"exp\":{exp}}}"));
        format!("eyJhbGciOiJIUzI1NiJ9.{payload}.sig")
    }

    #[test]
    fn jwt_expiry_reads_the_exp_claim_and_rejects_anything_else() {
        assert_eq!(jwt_expiry(&jwt(1_900_000_000)), Some(1_900_000_000));
        assert_eq!(jwt_expiry("not-a-jwt"), None);
        assert_eq!(jwt_expiry("a.!!!.c"), None);
        let no_exp = format!("h.{}.s", URL_SAFE_NO_PAD.encode("{\"sub\":\"u1\"}"));
        assert_eq!(jwt_expiry(&no_exp), None);
    }

    #[test]
    fn reuses_a_cached_token_until_it_nears_expiry() {
        let tokens = SessionTokens::default();
        let refreshes = AtomicUsize::new(0);
        let refresh = |exp: i64| {
            refreshes.fetch_add(1, Ordering::SeqCst);
            async move { Ok::<_, AppError>(jwt(exp)) }
        };
        tauri::async_runtime::block_on(async {
            let first = tokens.get_or_refresh("a1", || 1_000, || refresh(2_000)).await.unwrap();
            let again = tokens.get_or_refresh("a1", || 1_500, || refresh(3_000)).await.unwrap();
            assert_eq!(first, again);
            assert_eq!(refreshes.load(Ordering::SeqCst), 1);

            // Within the margin of `exp`: refreshed.
            let renewed = tokens.get_or_refresh("a1", || 2_000 - EXPIRY_MARGIN_SECONDS, || refresh(4_000)).await.unwrap();
            assert_eq!(renewed, jwt(4_000));
            assert_eq!(refreshes.load(Ordering::SeqCst), 2);

            // Another account has its own token.
            tokens.get_or_refresh("a2", || 1_000, || refresh(5_000)).await.unwrap();
            assert_eq!(refreshes.load(Ordering::SeqCst), 3);
        });
    }

    #[test]
    fn concurrent_callers_for_one_account_share_a_single_refresh() {
        let tokens = Arc::new(SessionTokens::default());
        let refreshes = Arc::new(AtomicUsize::new(0));
        tauri::async_runtime::block_on(async {
            let mut handles = Vec::new();
            for _ in 0..8 {
                let tokens = tokens.clone();
                let refreshes = refreshes.clone();
                handles.push(tauri::async_runtime::spawn(async move {
                    tokens
                        .get_or_refresh("a1", || 1_000, || async move {
                            refreshes.fetch_add(1, Ordering::SeqCst);
                            // Long enough for every other caller to be waiting on the lock.
                            slow_refresh().await;
                            Ok(jwt(10_000))
                        })
                        .await
                        .unwrap()
                }));
            }
            for handle in handles {
                assert_eq!(handle.await.unwrap(), jwt(10_000));
            }
        });
        assert_eq!(refreshes.load(Ordering::SeqCst), 1);
    }

    /// Stands in for the two auth-server round trips: sleeps a little and yields to the executor a few times.
    async fn slow_refresh() {
        for _ in 0..10 {
            std::thread::sleep(std::time::Duration::from_millis(2));
            yield_once().await;
        }
    }

    /// Yields once to the executor.
    async fn yield_once() {
        let mut yielded = false;
        std::future::poll_fn(|cx| {
            if yielded {
                std::task::Poll::Ready(())
            } else {
                yielded = true;
                cx.waker().wake_by_ref();
                std::task::Poll::Pending
            }
        })
        .await
    }

    #[test]
    fn caches_nothing_for_a_failed_refresh_or_a_token_without_exp_and_forgets_on_removal() {
        let tokens = SessionTokens::default();
        let refreshes = AtomicUsize::new(0);
        tauri::async_runtime::block_on(async {
            let failed = tokens
                .get_or_refresh("a1", || 1_000, || async { Err::<String, _>(AppError::OAuth("invalid_grant".to_string())) })
                .await;
            assert!(failed.is_err());

            for _ in 0..2 {
                tokens
                    .get_or_refresh("a1", || 1_000, || {
                        refreshes.fetch_add(1, Ordering::SeqCst);
                        async { Ok::<_, AppError>("opaque".to_string()) }
                    })
                    .await
                    .unwrap();
            }
            assert_eq!(refreshes.load(Ordering::SeqCst), 2);

            tokens.get_or_refresh("a1", || 1_000, || async { Ok::<_, AppError>(jwt(9_000)) }).await.unwrap();
            tokens.forget("a1");
            let after = tokens.get_or_refresh("a1", || 1_000, || async { Ok::<_, AppError>(jwt(9_500)) }).await.unwrap();
            assert_eq!(after, jwt(9_500));
        });
    }
}
