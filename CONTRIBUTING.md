# Contributing

Thank you for your interest in contributing! This repository is part of the
[RapidMX](https://rapidmx.io) project which is composed of multiple repositories stored
on [GitHub](https://github.com/rapidmx). The same contribution process applies across
all repositories.

## Reporting bugs and requesting features

Please use this repository's Issues tab — file bugs and feature requests against whichever
RapidMX repository they actually concern.

### Bug Reports

A good bug report includes:

- **Steps to Reproduce** the bug (a minimal code sample is ideal).
- What you **Expected** to happen, and what happened instead (**Actual**)
- The **Reproduction Rate** (e.g. 3/3 with a minimum 3 tries) (**Repo Rate**)
- The **Severity** of the bug (e.g. _BLOCKER_, _HIGH_, _MEDIUM_, _LOW_)
- The **Project Info** containing the version of this app, your OS/platform (desktop OS or
  Android/iOS version), and whether the issue happened in the frontend (webview), the Rust core
  (`src-tauri`), or during the OAuth sign-in handoff between the system browser and this app
- Include screenshots, crash logs, or `src-tauri`'s stderr output when possible

Make sure to be as detailed as possible.

#### Example

```
Steps to Reproduce:
1. Click "Add account" and enter an email address on a domain that publishes a _rapidmx TXT record
2. Complete sign-in in the system browser
3. Observe the app window after being redirected back

Repro Rate: 3/3

Expected:
The new account appears in the account list

Actual:
The window shows no change; nothing appears in the account list
// Insert src-tauri stderr output / any rapidmx://sign-in-error status message shown

Severity: BLOCKER

Project Info:
tauri-client: v0.1.0
OS: Windows 11
```

### Feature Requests

For feature requests, please provide a description of the use case and how it relates to you as a developer or as an end-user.

Good feature requests start with the phrase "As a [developer|end-user] I would like the ability to..."

#### Example

```
As an end-user I would like to switch between signed-in accounts instantly, without having to
sign in again each time.
```

## Development setup

This project uses [Yarn](https://yarnpkg.com) (via Corepack) and requires Node.js `>=24.0.0` for
the frontend (`src/`). Building or running `src-tauri/` also requires a working Rust toolchain and
the Tauri CLI prerequisites for your platform - see
[Tauri's own prerequisites guide](https://v2.tauri.app/start/prerequisites/).

```sh
git clone <this-repo>
cd <this-repo>
corepack enable
yarn install
```

## Making changes

1. Create a branch off `main` for your change.
2. Keep changes focused to a single bug or feature.
3. Add or update tests for any behavior you change. Check `vitest.config.ts` for this project's
   frontend coverage requirements; there is no equivalent automated Rust test runner in CI yet (see
   `.claude/NOTES.md`), so `src-tauri/`'s own `#[cfg(test)]` unit tests are run manually with
   `cargo test` until that changes.
4. Before opening a pull request, make sure everything passes:

   ```sh
   yarn install
   yarn lint
   yarn test
   yarn build
   ```

   and, if you have a Rust toolchain available and touched `src-tauri/`:

   ```sh
   cargo check
   cargo test
   cargo clippy
   ```

5. Write commit messages that explain _why_, not just _what_ — the diff already shows what
   changed. Keep the first line short and imperative (e.g. "Fix path traversal in export output"),
   with further detail in the body if needed.

## Pull requests

- Describe what the change does and why, and link any related issue.
- Keep the PR scoped to one concern — it's fine to open several small PRs rather than one large one.
- CI must pass (lint, tests, build) before a PR can be merged.
- Be responsive to review feedback; if a change needs discussion, that's normal and expected.

## Attribution

Contributions are recognized in this repository's `CONTRIBUTORS.md`. Feel free to add yourself
in the same commit as your first contribution.

By submitting a contribution, you agree it will be licensed under this repository's `LICENSE`.

## Questions

If anything here is unclear, open an issue — that's useful feedback on this guide too.
