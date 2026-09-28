# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.2.0] - 2026-09-28

### Changed
- Initial commit
- Rewrite @rapidmx/react-shared imports to @rapidmx/web-client's new lib/ path, now that the merge has landed in the linked sibling checkout
- Document both changes in NOTES

### Fixed
- Fixed a test that relied on setLocalIndexTransport happening to be missing from web-client's build, to explicitly simulate that case instead now that the export genuinely exists

[Unreleased]: https://github.com/rapidmx/tauri-client/compare/v0.2.0...HEAD
[0.2.0]: https://github.com/rapidmx/tauri-client/releases/tag/v0.2.0
