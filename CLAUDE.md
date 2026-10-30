# ft-prism

PRISM: a spectral synth where the spectrum (partials, amplitudes and phases) is the instrument.

- Type: FT-Instrument
- Kind: web
- Status: active
- Version: package.json + `project(... VERSION x.y.z)` in plugin/CMakeLists.txt
- Build: `npm run build`   Test: `npm run typecheck`, `npm run check` (headless browser check)   Run: `npm run dev`
- Ships to: browser (Vite dev server); VST3/AU via `plugin/`
