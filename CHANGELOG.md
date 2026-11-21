# Changelog

All notable changes to ft-prism. Format: [Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versions follow [SemVer](https://semver.org/).

## Unreleased

## [0.1.1] - 2026-11-21

### Changed
- The plugin window is now a wide 16:10 layout (1360 × 850) that fits the screen, scales to the window and never scrolls. It was scaled to the window's width and scrolled before. A new window opens as large as fits, up to that size.
- The plugin has five tabs. Oscillators, LFOs, envelopes, inserts and effects are picked from chip bars, with two roughly square columns and large live graphs.
- Oscillators, LFOs, envelopes, filters and effects that are off or not routed dim and show an OFF or UNUSED tag, and the chips show whether each one is in use.
- The plugin header no longer overlaps: the stats and tempo readouts are fixed width, and the live activity graph no longer sits on top of the buttons.
- Knob readouts are fixed width, and the macro knobs are a little larger.

## [0.1.0] - 2026-11-14

First public release.

### Added
- PRISM, a spectral synth where the spectrum (partials, amplitudes and phases) is the instrument. Stretch, shift, smear, fold and refract it, with a first-class modulation system.
- VST3, AU and standalone builds under `plugin/`, built by GitHub Actions for macOS, Windows and Linux (JUCE 8, WebView editor).
- Compact preset browser and a second bank of 75 presets.
- Fonts (Syne, Geist, Geist Mono, a small symbol fallback; all SIL OFL) bundled in `src/fonts/`: the UI and the plugin make no network connections.
- AGPL-3.0 license and third-party notices.

[Unreleased]: https://github.com/ft-instruments/ft-prism/compare/v0.1.1...HEAD
[0.1.1]: https://github.com/ft-instruments/ft-prism/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/ft-instruments/ft-prism/releases/tag/v0.1.0
