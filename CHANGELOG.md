# Changelog

All notable changes to ft-prism. Format: [Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versions follow [SemVer](https://semver.org/).

## Unreleased

### Added
- AGPL-3.0 license, a Download section in the README and a GitHub Actions workflow that builds the plugin for macOS, Windows and Linux.

### Changed
- `plugin/CMakeLists.txt`: `PRISM_INSTALL` option (off in CI) and `NEEDS_WEBVIEW2` for Windows.

## [0.1.0] - 2026-10-04

First tracked release. The version file already said 0.1.0, so this tags the project as it stands today.

### Added
- A spectral synth where the spectrum (partials, amplitudes and phases) is the instrument.
- Compact preset browser and a second bank of 75 presets.

[Unreleased]: https://github.com/filipefthomaz-gd/ft-prism/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/filipefthomaz-gd/ft-prism/releases/tag/v0.1.0
