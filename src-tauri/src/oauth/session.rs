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
//! `EXPIRY_MARGIN_SECONDS` from its expiry) or does the one refresh and caches its result, so
//! callers that were waiting get the fresh token instead of redeeming the old refresh token again.
//!
//! The expiry is a deadline on this device's clock: the time the token arrived plus its lifetime
//! (`exp - iat`). Comparing the server-signed `exp` with a device clock that runs behind would keep
//! serving a token the server already rejects. A caller whose request was answered 401 passes that
//! token back as `rejected`, which drops it from the cache when it is still the cached one (and
//! only then, so callers holding an already-replaced token don't each refresh again).

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
    /// On this device's clock (seconds since the epoch) - see this module's doc comment.
    expires_at: i64,
}

type Slot = Arc<AsyncMutex<Option<CachedSession>>>;

/// Managed Tauri state (`app.manage(SessionTokens::default())` in `lib.rs`): one lock and cached
/// session JWT per account id. Held in memory only, never persisted.
#[derive(Default)]
pub struct SessionTokens(Mutex<HashMap<String, Slot>>);

/// The claims of a JWT, read without verifying it - the token came straight from auth-server over
/// TLS, and this only decides when to fetch a new one.
fn jwt_claims(token: &str) -> Option<serde_json::Value> {
    let payload = token.split('.').nth(1)?;
    let bytes = URL_SAFE_NO_PAD.decode(payload.trim_end_matches('=')).ok()?;
    serde_json::from_slice(&bytes).ok()
}

/// The `exp` claim (seconds since the epoch, on the server's clock) of a JWT.
pub fn jwt_expiry(token: &str) -> Option<i64> {
    jwt_claims(token)?.get("exp")?.as_i64()
}

/// When a token received at `received_at` (this device's clock) should be treated as expired, on
/// this device's clock: `received_at + (exp - iat)`. Falls back to `exp` itself for a token without
/// a usable `iat`. `None` for a token without `exp`, which isn't cached.
pub fn local_expiry(token: &str, received_at: i64) -> Option<i64> {
    let claims = jwt_claims(token)?;
    let exp = claims.get("exp")?.as_i64()?;
    match claims.get("iat").and_then(serde_json::Value::as_i64) {
        Some(iat) if iat < exp => Some(received_at.saturating_add(exp - iat)),
        _ => Some(exp),
    }
}

impl SessionTokens {
    fn slot(&self, account_id: &str) -> Slot {
        let mut guard = self.0.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
        guard.entry(account_id.to_string()).or_default().clone()
    }

    /// Removes `account_id` under its lock: waits for a refresh in flight (which may store a
    /// rotated refresh token in the keychain) to finish, then runs `remove` - deleting the account
    /// record and its keychain entry - before anyone else can take the lock, and drops the cached
    /// token. A caller already waiting for the lock then refreshes for an account that no longer
    /// exists, which fails before storing anything (`oauth::refresh_session_token`).
    pub async fn remove<R>(&self, account_id: &str, remove: impl FnOnce() -> R) -> R {
        let slot = self.slot(account_id);
        let mut cached = slot.lock().await;
        *cached = None;
        let result = remove();
        // Dropped while the lock is still held, so no new caller shares this slot after it.
        let mut guard = self.0.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
        guard.remove(account_id);
        result
    }

    /// `account_id`'s cached session JWT when it is still good at `now` (seconds since the epoch, on
    /// this device's clock) and isn't `rejected`, otherwise the result of `refresh`, run while
    /// holding the account's lock and cached (with `local_expiry`) when it carries an `exp`. A failed
    /// refresh caches nothing, so the next caller tries again.
    pub async fn get_or_refresh<F, Fut>(&self, account_id: &str, rejected: Option<&str>, now: impl Fn() -> i64, refresh: F) -> AppResult<String>
    where
        F: FnOnce() -> Fut,
        Fut: Future<Output = AppResult<String>>,
    {
        let slot = self.slot(account_id);
        let mut cached = slot.lock().await;
        if let Some(session) = cached.as_ref() {
            if rejected != Some(session.token.as_str()) && session.expires_at - EXPIRY_MARGIN_SECONDS > now() {
                return Ok(session.token.clone());
            }
        }
        *cached = None;
        let token = refresh().await?;
        if let Some(expires_at) = local_expiry(&token, now()) {
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

    fn jwt_issued(iat: i64, exp: i64) -> String {
        let payload = URL_SAFE_NO_PAD.encode(format!("{{\"sub\":\"u1\",\"iat\":{iat},\"exp\":{exp}}}"));
        format!("eyJhbGciOiJIUzI1NiJ9.{payload}.sig")
    }

    #[test]
    fn local_expiry_measures_the_tokens_lifetime_on_this_devices_clock() {
        assert_eq!(local_expiry(&jwt_issued(1_900_000_000, 1_900_003_600), 1_000), Some(4_600));
        // No usable `iat`: the server's `exp`, as before.
        assert_eq!(local_expiry(&jwt(1_900_000_000), 1_000), Some(1_900_000_000));
        assert_eq!(local_expiry(&jwt_issued(1_900_003_600, 1_900_003_600), 1_000), Some(1_900_003_600));
        assert_eq!(local_expiry("not-a-jwt", 1_000), None);
        let no_exp = format!("h.{}.s", URL_SAFE_NO_PAD.encode("{\"iat\":5}"));
        assert_eq!(local_expiry(&no_exp, 1_000), None);
    }

    #[test]
    fn a_device_clock_behind_the_server_still_refreshes_when_the_tokens_lifetime_is_up() {
        let tokens = SessionTokens::default();
        let refreshes = AtomicUsize::new(0);
        // The server is two hours ahead of this device: `exp` lies far past the device's `now`.
        let server_now = 1_000 + 7_200;
        let refresh = || {
            let n = refreshes.fetch_add(1, Ordering::SeqCst) as i64;
            async move { Ok::<_, AppError>(jwt_issued(server_now + n, server_now + n + 3_600)) }
        };
        tauri::async_runtime::block_on(async {
            let first = tokens.get_or_refresh("a1", None, || 1_000, refresh).await.unwrap();
            let cached = tokens.get_or_refresh("a1", None, || 1_000 + 3_600 - EXPIRY_MARGIN_SECONDS - 1, refresh).await.unwrap();
            assert_eq!(first, cached);
            assert_eq!(refreshes.load(Ordering::SeqCst), 1);
            // An hour on the device's clock later, though still before `exp` by the device's clock.
            let renewed = tokens.get_or_refresh("a1", None, || 1_000 + 3_600 - EXPIRY_MARGIN_SECONDS, refresh).await.unwrap();
            assert_ne!(renewed, first);
            assert_eq!(refreshes.load(Ordering::SeqCst), 2);
        });
    }

    #[test]
    fn a_rejected_token_is_refreshed_once_and_a_stale_rejection_reuses_the_new_token() {
        let tokens = SessionTokens::default();
        let refreshes = AtomicUsize::new(0);
        let refresh = || {
            let n = refreshes.fetch_add(1, Ordering::SeqCst) as i64;
            async move { Ok::<_, AppError>(jwt(10_000 + n)) }
        };
        tauri::async_runtime::block_on(async {
            let first = tokens.get_or_refresh("a1", None, || 1_000, refresh).await.unwrap();
            let replaced = tokens.get_or_refresh("a1", Some(&first), || 1_000, refresh).await.unwrap();
            assert_ne!(replaced, first);
            assert_eq!(refreshes.load(Ordering::SeqCst), 2);
            // Other requests answered 401 with the old token: they get the replacement, no new refresh.
            for _ in 0..3 {
                assert_eq!(tokens.get_or_refresh("a1", Some(&first), || 1_000, refresh).await.unwrap(), replaced);
            }
            assert_eq!(refreshes.load(Ordering::SeqCst), 2);
        });
    }

    #[test]
    fn removal_waits_for_a_refresh_in_flight_and_runs_before_anyone_waiting_after_it() {
        let tokens = Arc::new(SessionTokens::default());
        let events = Arc::new(Mutex::new(Vec::<&'static str>::new()));
        tauri::async_runtime::block_on(async {
            let in_flight = {
                let (tokens, events) = (tokens.clone(), events.clone());
                tauri::async_runtime::spawn(async move {
                    tokens
                        .get_or_refresh("a1", None, || 1_000, || async move {
                            slow_refresh().await;
                            // Where `refresh_session_token` stores the rotated refresh token.
                            events.lock().unwrap().push("stored rotated token");
                            Ok(jwt(10_000))
                        })
                        .await
                })
            };
            // Let the refresh take the lock first.
            while events.lock().unwrap().is_empty() && !tokens_locked(&tokens, "a1") {
                yield_once().await;
            }
            let events_for_remove = events.clone();
            tokens.remove("a1", move || events_for_remove.lock().unwrap().push("deleted account")).await;
            in_flight.await.unwrap().unwrap();

            assert_eq!(*events.lock().unwrap(), vec!["stored rotated token", "deleted account"]);
            // The token cached by that refresh went with the account.
            let refreshed = Arc::new(AtomicUsize::new(0));
            let counter = refreshed.clone();
            tokens
                .get_or_refresh("a1", None, || 1_000, || async move {
                    counter.fetch_add(1, Ordering::SeqCst);
                    Err::<String, _>(AppError::AccountNotFound("a1".to_string()))
                })
                .await
                .unwrap_err();
            assert_eq!(refreshed.load(Ordering::SeqCst), 1);
        });
    }

    /// Whether `account_id`'s session lock is currently held.
    fn tokens_locked(tokens: &SessionTokens, account_id: &str) -> bool {
        tokens.slot(account_id).try_lock().is_err()
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
            let first = tokens.get_or_refresh("a1", None, || 1_000, || refresh(2_000)).await.unwrap();
            let again = tokens.get_or_refresh("a1", None, || 1_500, || refresh(3_000)).await.unwrap();
            assert_eq!(first, again);
            assert_eq!(refreshes.load(Ordering::SeqCst), 1);

            // Within the margin of `exp`: refreshed.
            let renewed = tokens.get_or_refresh("a1", None, || 2_000 - EXPIRY_MARGIN_SECONDS, || refresh(4_000)).await.unwrap();
            assert_eq!(renewed, jwt(4_000));
            assert_eq!(refreshes.load(Ordering::SeqCst), 2);

            // Another account has its own token.
            tokens.get_or_refresh("a2", None, || 1_000, || refresh(5_000)).await.unwrap();
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
                        .get_or_refresh("a1", None, || 1_000, || async move {
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
    fn caches_nothing_for_a_failed_refresh_or_a_token_without_exp_and_drops_it_on_removal() {
        let tokens = SessionTokens::default();
        let refreshes = AtomicUsize::new(0);
        tauri::async_runtime::block_on(async {
            let failed = tokens
                .get_or_refresh("a1", None, || 1_000, || async { Err::<String, _>(AppError::OAuth("invalid_grant".to_string())) })
                .await;
            assert!(failed.is_err());

            for _ in 0..2 {
                tokens
                    .get_or_refresh("a1", None, || 1_000, || {
                        refreshes.fetch_add(1, Ordering::SeqCst);
                        async { Ok::<_, AppError>("opaque".to_string()) }
                    })
                    .await
                    .unwrap();
            }
            assert_eq!(refreshes.load(Ordering::SeqCst), 2);

            tokens.get_or_refresh("a1", None, || 1_000, || async { Ok::<_, AppError>(jwt(9_000)) }).await.unwrap();
            tokens.remove("a1", || ()).await;
            let after = tokens.get_or_refresh("a1", None, || 1_000, || async { Ok::<_, AppError>(jwt(9_500)) }).await.unwrap();
            assert_eq!(after, jwt(9_500));
        });
    }
}
