///////////////////////////////////////////////////////////////////////////////
// Copyright (C) 2026 Jean-Philippe Steinmetz
// SPDX-License-Identifier: MPL-2.0
///////////////////////////////////////////////////////////////////////////////
//! A single error type shared by every module in this crate, so a `#[tauri::command]` in
//! `commands.rs`/`search/commands.rs` never needs to hand-write its own `From` impls to bubble up
//! a federation/keychain/oauth/search failure. Tauri commands return errors to the frontend as
//! plain strings (see each command's own `Result<T, String>` return type and `AppError`'s
//! `Display` impl, used via `.map_err(|e| e.to_string())` at the command boundary) rather than a
//! structured `Serialize` error type - simpler, and this app has no need yet for the frontend to
//! branch on a specific error *kind* rather than just showing the message (see `src/App.tsx`'s
//! `describeError()`, which already treats every error as "a message to show").

use thiserror::Error;

#[derive(Debug, Error)]
pub enum AppError {
    #[error("network request failed: {0}")]
    Http(#[from] reqwest::Error),

    // Not `#[from] hickory_resolver::<SomeErrorType>` - this session could not confirm that
    // crate's exact error type name/shape against a real build (see federation/dns.rs's own doc
    // comment), so `federation::dns` converts via `.to_string()` at the point it's raised instead
    // of relying on a `From` impl this crate can't verify compiles.
    #[error("DNS resolution failed: {0}")]
    Dns(String),

    #[error("{0}")]
    Federation(String),

    #[error("invalid URL: {0}")]
    Url(#[from] url::ParseError),

    #[error("local storage error: {0}")]
    Io(#[from] std::io::Error),

    #[error("could not (de)serialize stored data: {0}")]
    Serde(#[from] serde_json::Error),

    #[error("local search index error: {0}")]
    Sqlite(#[from] rusqlite::Error),

    #[error("keychain error: {0}")]
    Keychain(String),

    #[error("OAuth sign-in failed: {0}")]
    OAuth(String),

    #[error("account not found: {0}")]
    AccountNotFound(String),

    #[error("{0}")]
    Other(String),
}

pub type AppResult<T> = Result<T, AppError>;

/// What every `#[tauri::command]` in this crate actually returns to the frontend - see this
/// module's own doc comment for why it's a plain string rather than a structured error.
pub type CommandResult<T> = Result<T, String>;

impl AppError {
    pub fn into_command_result<T>(self) -> CommandResult<T> {
        Err(self.to_string())
    }
}
