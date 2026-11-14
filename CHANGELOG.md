# Changelog

All notable changes to ft-prism. Format: [Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versions follow [SemVer](https://semver.org/).

## [0.1.1] - 2026-11-01

### Added
- AGPL-3.0 license, a Download section in the README and a GitHub Actions workflow that builds the plugin for macOS, Windows and Linux.

### Changed
- Fonts (Syne, Geist, Geist Mono; SIL OFL) are bundled in `src/fonts/` instead of loaded from Google Fonts: the UI and the plugin make no network connections.
- `plugin/CMakeLists.txt`: `PRISM_INSTALL` option (off in CI) and `NEEDS_WEBVIEW2` for Windows.
- Linux: the editor's WebView renders on the GPU (`plugin/patch-juce.cmake` flips JUCE's WebKit acceleration policy; the editor forces shared-memory frames so it also works on NVIDIA). JUCE 8.0.9 to 8.0.15.

### Fixed
- Linux: arrows, `⌘` and `▪` showed as tofu because the bundled Latin fonts do not cover them; a small `FT Symbols` fallback (subset of Noto Sans Symbols 1/2, SIL OFL) now ships with the UI.
- Linux: the editor showed `Â·`, `â€“`, `â†’` instead of `·`, `–`, `→` (the WebView misread the text encoding); the plugin now serves its pages as UTF-8 explicitly and the built UI is pure ASCII (non-ASCII characters are escaped), so no encoding guess can break it.
- Linux: φ π Σ θ ∈ ≤ ≥ ↦ also showed as tofu; a second `FT Symbols` face (subset of Noto Sans Math, SIL OFL) now covers them.

## [0.1.0] - 2026-10-04

First tracked release. The version file already said 0.1.0, so this tags the project as it stands today.

### Added
- A spectral synth where the spectrum (partials, amplitudes and phases) is the instrument.
- Compact preset browser and a second bank of 75 presets.

[Unreleased]: https://github.com/ft-instruments/ft-prism/compare/v0.1.1...HEAD
[0.1.1]: https://github.com/ft-instruments/ft-prism/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/ft-instruments/ft-prism/releases/tag/v0.1.0
