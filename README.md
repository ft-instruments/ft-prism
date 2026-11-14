# ft-prism

**PRISM** is a spectral synth, and the spectrum is the instrument. In the family,
`ft-mycelia` models circuits, `ft-vector` digital systems and `ft-siege`
physical bodies. Prism holds a sound as its partials (amplitudes and phases)
and lets you stretch, shift, smear, fold and refract them. The modulation
system is first-class, because a spectrum that doesn't move is a preset, not
an instrument. It is Massive-inspired (wavetable position as the main
gesture, readout modes, steppers, macros, inserts in the voice), built on a
core Massive never had.

```
npm install
npm run dev        # open the printed URL in Chrome/Edge (Web MIDI)
npm run build      # static site in dist/
npm run render     # offline render of every preset to out/*.wav, no browser needed
npm run check      # headless Chrome: boots the worklet, plays a chord, screenshots every view
```

You can play it from a MIDI keyboard (notes, velocity, pitch bend, mod wheel,
channel pressure, sustain CC64), the on-screen keys, or the computer keyboard
(`A`…`'` and `Z`…`/`; arrows change octave; Space is sustain).

- **Knobs:** drag vertically, hold `Shift` for fine control, double-click to reset.
- **Steppers:** draw in their grids; the right button zeroes a step.
- **Refract:** nudges the sounding oscillators' spectral controls and sometimes changes a warp.
- **Copy:** puts the patch JSON on the clipboard.

## Download

Builds of the VST3, the AU (macOS only) and the standalone app for macOS,
Windows and Linux are attached to each
[release](https://github.com/ft-instruments/ft-prism/releases).

| | Standalone | VST3 | AU |
|---|---|---|---|
| macOS (Apple silicon + Intel) | yes | yes | yes |
| Windows | yes | yes | no |
| Linux | yes | yes | no |

Unzip and copy the plugin to your plugin folder (macOS
`~/Library/Audio/Plug-Ins/{VST3,Components}`, Windows
`C:\Program Files\Common Files\VST3`, Linux `~/.vst3`). The builds are not
signed or notarized: on macOS right-click the app and choose Open the first
time (or run `xattr -dr com.apple.quarantine` on the files); on Windows
SmartScreen asks once. The Windows editor needs the WebView2 runtime
(included in Windows 11); on Linux it needs WebKitGTK.

## Privacy

PRISM makes no network connections: no telemetry, no update check, no
analytics, no accounts. The fonts are bundled ([`src/fonts/`](src/fonts/)),
the plugin serves its UI from memory (`PluginEditor.cpp`, a JUCE resource
provider), and JUCE is built without its networking code
(`JUCE_USE_CURL=0`). Your saved presets are plain files on your disk. To
check it yourself, search the source for `fetch(`, `XMLHttpRequest`,
`WebSocket` and `http` (the only hits are the SVG namespace string and the
local test scripts in `scripts/`, which talk to `127.0.0.1`), or watch the
app with Little Snitch or `nettop`.

## Signal path

```
keys → arpeggiator (optional) → voices:
osc 1 ─┐  three spectral oscillators (up to 16 unison copies each), osc 3 can phase-modulate 1 and 2
osc 2 ─┤
osc 3 ─┤
sub   ─┤
noise ─┘  → insert A → filter 1 ─┬─ filter 2 (serial, or parallel with per-osc routing)
                                 → insert B → amp (env 1) → voices summed
   → warmth → dimension → chorus → delay (spiral shifter in its loop) → ice hall → eq → squash → volume → out
```

All the DSP lives in [`src/dsp/`](src/dsp/) and has no browser dependencies.

### 1. The spectral oscillator: `oscillator.ts`, `tables.ts`, `fft.ts`

**Tables are spectra.** Each table has 64 frames of 512 harmonics, and every
harmonic has an amplitude and a phase. Nothing is sampled: each of the 14
tables is a *recipe* evaluated on first use. Some recipes are additive
formulas (Basic, Analog, PWM, Vocal, Glass, Organ, Growl, Felt, Cloud,
Scan). Others are drawn at 8192 points per cycle and taken through the FFT
(Sync, Fold, FM, Steps). Every frame is normalised to a peak of 1.

**The oscillator never plays a stored waveform.** Whenever position, warp,
amount or the band limit changes, it *re-synthesises* one cycle:

1. It reads the spectrum at the position. *Blend* morph interpolates frames
   as complex numbers, so it crossfades. *Spectral* morph interpolates
   amplitude and phase separately, so partials glide.
2. It applies the warp.
3. It drops every harmonic that the highest unison copy would alias.
4. It runs one inverse FFT, sized to the harmonics that are left (256 to
   2048 points).

The new cycle is crossfaded in over the next 64-sample block. A static
sound costs nothing, and a moving one costs a small FFT per block. Because
the band limit is per voice and per pitch, there is no aliasing at any note
and no need for mip-maps. `render spectrum` measures a saw's harmonics at
−6.5 / −9.8 / −12.5 dB with nothing above −74 dB between them, from C4 to
C8.

| warp | what it does to the spectrum |
|---|---|
| filter | a smooth brick-wall inside the oscillator (Massive's Spectrum mode) |
| bend ± | reads the cycle along p ↦ p^e; band-limited by a second FFT pass |
| sync | hard sync, slave ratio 1…8; band-limited the same way |
| formant ± | holds the table's spectral envelope in Hz while the harmonics move under it, so there's no chipmunk effect; the amount shifts it on purpose (±2 octaves) |
| stretch ± | moves partial k to k^(1+s): bells, glass, felt-key stiffness; played additively (up to 64 partials) because it is no longer periodic |
| smear | blurs amplitudes across neighbours, so the tone dissolves into breath |
| skew ± | each harmonic reads from a different frame (Vital's spectral time skew) |
| odd/even ± | removes the even (+) or odd (−) harmonics |
| shift ± | moves the whole spectrum ±24 harmonics up or down the series |

**Unison** runs up to 16 copies per oscillator, with two detune curves:

- **Linear:** ±50 cents.
- **Super:** Adam Szabo's measured JP-8000 curve, his seven relative offsets
  interpolated over n copies, and his centre/side mix law.

There are also blend, stereo width and random start phase. At 0 the copies
start together, which sounds punchy; at 1 they start at random phases, which
sounds lush.

### 2. Modulation: `mod.ts`, `voice.ts`

- **Envelopes:** four ADSRs, each with a curve and a loop mode. Env 1 is
  always on the amp.
- **LFOs:** four of them, with sine/tri/saw/ramp/square/S&H/drift shapes.
  Each runs free or tempo-synced, retriggers per voice or runs free, and has
  phase, a fade-in and a unipolar option.
- **Steppers:** two of them, with 16 drawable bipolar steps, a length,
  per-step glide and a tempo division. They retrigger per note or run free.
- **Macros:** eight, always on screen. Each preset names its macros.
- **Playing sources:** velocity, key, mod wheel, pressure, bend and a
  per-note random.
- **Arpeggiator:** Mycelia's arp, with up, down, up/dn, random, played and
  chord modes, 1/2 to 1/32 including triplets, 1–4 octaves, gate, swing and
  hold.
- **Drift:** each voice wanders a little in pitch (up to ±14 cents) and in
  table position, on its own slow random curve, so stacks breathe instead
  of sitting perfectly still.
- **The matrix:** 16 slots, each with a source, a destination, a bipolar
  amount and an optional **via** source that scales it. There are 35
  destinations. The ones on the oscillators (position, warp, level, pitch,
  detune, pan) are the main gesture. The five on the master effects
  (dimension, chorus, delay, reverb, squash) hear only the sources every
  voice shares: macros, wheel, pressure and bend.
- **Family invariant:** every amount defaults to 0, and `Voice.matrix()`
  returns before touching anything when nothing is routed. `render hash`
  points every unused slot of every preset somewhere at amount 0 and proves
  the render is bit-identical.

### 3. Refraction: `inserts.ts`, `filter.ts`, `fx.ts`, `reverb.ts`

- **Inserts (in the voice):**
  - **Frequency shifter:** a Hilbert transformer (two IIR allpass chains,
    Niemitalo's coefficients) then single-sideband modulation. +100 Hz
    measures +100 Hz with the other sideband 50 dB down. Its colour knob
    blends from fixed Hz to multiples of the pitch.
  - **The rest:** ring mod at a ratio of the pitch, crush (sample hold +
    bits), sine wavefolder, tanh shaper, Massive-style parabolic shaper,
    hard clip, and a pitch-tracked comb.
- **Filters:** two clean topology-preserving SVFs (lp 12, lp 24, bp, hp,
  notch), plus a **vowel** filter (three formant band-passes; the cutoff
  walks a-e-i-o-u) and ± **combs**. Each has drive, key track and env 2.
  They run serial, or parallel with per-oscillator routing. Mycelia owns the
  saturating ladder; Prism's filters are deliberately clean.
- **Master:**
  - **Dimension:** a Massive-style expander that widens the image and leaves
    the mono sum untouched.
  - **Chorus:** three taps.
  - **Delay:** ping-pong and damping, plus **spiral**, which puts a
    frequency shifter in the feedback loop so every repeat climbs or falls
    out of tune.
  - **Ice hall:** Mycelia's FDN hall, re-tuned brighter, with shimmer.
  - **Warmth:** a gentle tape-like stage straight after the voices: soft
    saturation, and a top that darkens as it is pushed.
  - **EQ:** low and high shelves.
  - **Squash:** an OTT-style compressor in three bands that sum back to the
    input exactly. It pushes down above −22 dB and pulls up below −36 dB.

## Presets

There are 172 presets, grouped the way Mycelia's are. The names are Prism's
own (light, glass, ice, sky).

| category | presets |
|---|---|
| pads | Halo · Polar Night · Iridescence · Opal Choir · Daybreak · Ice Cathedral · Diffraction · Nimbus · Long Exposure · Prism Strings · Parhelion · Ether · Lumen Bed · Starlit Fifths · Frostline · Spectral Bloom · Warm Analog · Glass Swell · Comb Haze · Vowel Drift · Dusk Organ |
| keys | Hushed Keys · Velvet Prism · Crystal Tines · Lightbox Organ · Quartz Keys · Upright Mist · Music Box · Halation Keys · Wurli Ray · Lens Clav · Electric Felt · FM Piano · Harpsichord Prism · Vowel Organ · Celeste Glass · Toy Keys |
| plucks & bells | Shard Pluck · Ring Bells · Dewlight · Kalimba Prism · Ice Harp · Starfield · Chime Tree · Bell Tower · Synth Harp · Spark Pluck · Glass Marimba · Steel Pan · Comb String · Koto Shift · Pizzicato Light · Fold Marimba · Supersaw Pluck |
| leads | Ember Lead · Saw Light · Sine Whistle · Square Song · Formant Lead · Sync Beam · Hollow Flute · Overdrive Prism · Solar Lead · Glass Lead · Theremin Ray · Chip Lead · Talking Lead · Scream Sync · Glide Saw |
| bass | Growl · Reese · Neuro · Wobble · Sub Pressure · Round Sub · Pluck Bass · Acid Prism · Fold Bass · FM Bass · Deep Field · Octave Bounce · Talk Bass · 808 Boom · Rubber FM · Comb Bass · Hoover Bass |
| synths | Supersaw · Trance Gate · Brass Light · Stab Chord · Pulse Poly · Spectral Hoover · Pumping Saws · Polysync Stack · Juno Chords · Brass Section · Gated Strings · Sidechain Pad · Shimmer Stack |
| arps | Crystal Arp · Pulse Runner · Felt Steps · Chord Pulse · Daylight Run · Glass Ostinato · Night Drive · Swing Lights · Twinkle Field · Cascade Down · Triplet Bells · Pumped Stabs · Swing Felt · Latch Garden · Octave Climb |
| sequences | Light Sequence · Bubble Line · Sequencer Dream · Step Pluck · Berlin Steps · Polymeter Prism · Acid Steps · Talking Steps · Euclid Bells · Gated Chords · Spectral Sequence · Transposer · Fold Sequence |
| drums & perc | Spectral Kick · Punch Kick · Snare Crack · Clap Burst · Closed Hat · Open Hat · Ride Metal · Rimshot · Cowbell 808 · Tom Prism · Conga Glass · Seed Shaker · Pattern Kit · Breakbeat Kit · Hand Drums |
| textures | Wind Glass · Ice Field · Photon Rain · Deep Space · Static Choir · Glacier · Ionosphere · Tidal Light · Spectral Swarm · Frozen Comb · Drone Field |
| fx | Spectral Riser · Downlifter · Laser Shot · Sonar · Siren · Glitch Burst · Impact Boom |
| neon | Spiral Rain · Broken Spectrum · Shepard Ascent · Android Vowel · Hologram · Data Ghost · Laser Grid · Blade Lights · Cyber Choir · Glitch Steps · Synthetic Heart |

- **Macros:** every preset wires and names its macros.
- **Sequences:** the stepper sequences send a stepper to pitch at amount
  1/3, so each cell is one semitone. Most of them, and the stepper drums
  (Pattern Kit), also send a unipolar ramp LFO, synced to the sixteenth and
  restarted by the note, negatively to amp: every step is struck again and
  dies away, so a held note plays the pattern from the moment you press it.
- **Drums:** play them as single hits, or hold notes on the ones with the arp
  on (Seed Shaker, Breakbeat Kit, Hand Drums). Pattern Kit plays a whole beat
  from one held note.
- **Shepard Ascent** is a real endless riser: three octaves climb on a ramp
  while the bottom fades in and the top fades out, and the level holds
  within 0.6 dB across the wrap.
- **Your own sounds** save in the browser (⌘S) and keep the macro names of
  the sound they came from.

**Loudness is matched by measurement.** `npm run render levels` renders
every preset's test phrase and finds its loudest 400 ms window, which treats
plucks and pads fairly. It writes `src/dsp/levels.gen.ts`, and that gain
scales each preset's amp level, so stepping through the bank doesn't jump
in volume. Re-run it after changing a preset.

## UI

The look is light through a prism. Behind the glass modules is a living
**refraction field** ([`ui/refraction.ts`](src/ui/refraction.ts)): shards of
glass drift and turn slowly in a dark room, and one white beam always
crosses it and splits into a faint spectrum at the first shard it meets.
Every note fires a new beam in from the left (higher notes enter higher, the
arp's notes too). Where it strikes glass it disperses into rays of colour,
red → violet, that fan out and fade, and motes of light glitter with the
output level. Mycelia's background is a network that carries light; Prism's
breaks it into colour.

Each oscillator draws its table as a stack of frames receding into the
glass. The frame being played is lit white (it follows modulation live), and
under it the spectrum splits into harmonics coloured red → violet.
**Modulation is drawn as light:** every route puts an arc of its source's
colour on the knob it moves (envelopes warm, LFOs yellow-green, steppers
cyan, macros blue-violet, playing pink-white).

There are four views: **light** (oscillators, sub/noise, voice, amp env),
**motion** (envelopes, LFOs, arp, steppers), **matrix** and **refraction**
(inserts, filters, width, delay, reverb, squash). The macro strip, master
volume and preset browser are always in reach.

## Checks

- `npm run render`: all 172 presets with no NaNs. Peaks fall between −0.3 and
  −9 dBFS on the test phrase.
- `npm run render levels`: re-measures loudness and rewrites the gains.
- `npm run render hash`: the matrix invariant, all presets identical.
- `npm run render spectrum`: harmonic levels and aliasing.
- `npm run render bench`: CPU per preset. Real presets with 8 voices run at
  2–9% of real time in Node. The deliberately silly worst case (3 oscillators
  × 16 unison, all morphing and warping, all FX) runs at about 30%.
- **Onset:** under 10 ms to −20 dB of peak on every key, pluck, lead,
  bass, synth and arp; only the pads and textures with deliberate swells are
  slower.
- `npm run check`: headless Chrome boots the worklet, plays a chord,
  screenshots each view, and exercises the browser, search, save/delete and
  power.

## The plugin (VST3 / AU)

`plugin/` builds PRISM as a **VST3** (macOS and Linux), an **AU** (macOS,
for Logic) and a standalone app, with JUCE 8 (fetched by CMake), exactly as
Mycelia's does.

```
plugin/build.sh      # web UI + params header + plugins, installed for this user
```

It installs to `~/Library/Audio/Plug-Ins/{VST3,Components}` on macOS and
`~/.vst3` on Linux. On macOS check the AU with `auval -v aumu Prsm Ftft`.
On Linux it needs the same packages as Mycelia's (see its README).

- **DSP**: `plugin/Source/dsp/` is a line-for-line C++ port of `src/dsp/`.
  Buffers the TS keeps in `Float32Array`s are `float`, everything else is
  `double`. `node scripts/null-test.ts` renders every preset with both
  engines and subtracts: 32 of 97 are bit-identical and 95 differ by at most
  −135 dB (last-bit differences in `pow` / `sin`). Two sit on a numerically
  sensitive spot and are held to −60 dB instead: **Glitch Steps** (the
  crusher rounds a sample on a step boundary the other way; −104 dB with
  its mix at 0) and **Hologram** (Steps partials flip sign between frames, a
  phase jump of exactly π, so spectral morph's shortest-way blend is a tie
  that the last bit of `atan2` decides; −140 dB with blend morph). The
  wavetables are built once per process and shared by every instance; the
  oscillators' FFT scratch belongs to each engine (the TS keeps it at module
  level); the arp uses fixed arrays. Nothing allocates on the audio thread.
  About 3% of real time for 8 voices of Halo.
- **Parameters**: `Params.gen.h` is generated from `params.ts` and
  `presets.ts` (`node scripts/gen-plugin.ts`, run by `build.sh`), so the host
  sees the same 289 parameters with the same curves and value text. Everything
  is automatable. The factory bank is the host's program list.
- **UI**: the web UI itself (`dist/`, embedded in the binary) in a WebView;
  `src/plugin.ts` stands in for the AudioWorklet and talks to
  `PluginEditor.cpp` over JUCE's event bridge, including the live display
  (positions, LFOs, steps, squash). Your saved presets, with their macro
  names, are a file shared by every instance
  (`~/Library/Application Support/FT/Prism/` or `~/.config/FT/Prism/`).
  The page is scaled to the window's width and scrolls when the window is
  shorter than the tab. `node scripts/check-plugin-ui.ts` checks the page in
  plugin mode against a fake bridge.
- **Clock**: the host's tempo replaces the tempo knob, and while the host
  plays, its song position drives the free-running synced LFOs and the free
  steppers, so they lock to the bar.

After changing anything in `src/dsp/`, port it to `plugin/Source/dsp/` and
run the null test.

## Known limitations / next steps

- **No `.wav` wavetable import yet.** `tableFromCycles()` in `tables.ts` is
  ready for it; it still needs the drop zone, a user table slot and a way to
  keep the table with a preset.
- **No drag-to-assign.** Modulation is shown on the knobs but assigned in
  the matrix view.
- **Fewer matrix slots than proposed.** It has 16 slots, not the 32 the
  proposal suggested, which so far is more than any preset uses.
- **The plugin page scrolls.** The light tab lays out 1525 px tall, so
  inside the plugin the page is scaled to the window's *width* and scrolls
  vertically (Mycelia's scales to fit both ways; its tabs are shorter). The
  keyboard is at the bottom of the scroll.
- In the plugin, the arp follows the host's tempo but not its grid (a step
  starts when you play, not on the beat), as in Mycelia.
- **Two presets null only to −73 / −83 dB** against the C++ engine (see the
  plugin section): Glitch Steps and Hologram.

## License

Copyright (C) 2026 Filipe F. Thomaz.

PRISM is free software under the [GNU AGPL v3](LICENSE). The plugin is built
on [JUCE](https://juce.com), which is itself AGPLv3 (or commercial), so the
whole thing is distributed under the AGPL (the bundled fonts keep their own
[SIL OFL](src/fonts/); see [THIRD-PARTY.md](THIRD-PARTY.md)): you can use it for anything,
including music you sell, and change it and share it, as long as a modified
version you distribute comes with its source under the same license.
