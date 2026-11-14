# Changelog

All notable changes to ft-prism. Format: [Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versions follow [SemVer](https://semver.org/).

## Unreleased

## [0.1.0] - 2026-11-14

First public release.

### Added
- PRISM, a spectral synth where the spectrum (partials, amplitudes and phases) is the instrument. Stretch, shift, smear, fold and refract it, with a first-class modulation system.
- VST3, AU and standalone builds under `plugin/`, built by GitHub Actions for macOS, Windows and Linux (JUCE 8, WebView editor).
- Compact preset browser and a second bank of 75 presets.
- Fonts (Syne, Geist, Geist Mono, a small symbol fallback; all SIL OFL) bundled in `src/fonts/`: the UI and the plugin make no network connections.
- AGPL-3.0 license and third-party notices.

[Unreleased]: https://github.com/ft-instruments/ft-prism/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/ft-instruments/ft-prism/releases/tag/v0.1.0
