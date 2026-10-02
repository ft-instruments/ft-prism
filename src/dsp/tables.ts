// The wavetables, stored as spectra. Every table is FRAMES frames of
// HARMONICS harmonics, each an amplitude and a phase (for a·sin(2πkt + φ)).
// Nothing is sampled: each table is a *recipe*, a small formula over
// (frame, harmonic) or over (frame, time) that is evaluated once, the
// first time the table is asked for, and cached.
//
// Additive recipes give exact, alias-free spectra. Time-domain recipes
// (sync, fold, FM, steps) are drawn at 8192 points per cycle and taken
// through the FFT, which keeps the folded energy far above the 512
// harmonics we keep. Every frame is normalised to a peak of 1.

import { RealFFT } from './fft.ts';

export const FRAMES = 64;
export const HARMONICS = 512;

export interface Wavetable {
  name: string;
  /** amplitude of harmonic k (1-based) in frame f at [f * HARMONICS + k - 1] */
  amp: Float32Array;
  /** phase, same layout */
  phase: Float32Array;
  /** a·sin φ and a·cos φ, same layout: the complex form the oscillator reads */
  xs: Float32Array;
  xc: Float32Array;
  /** the fundamental the table's spectral envelope was drawn for (Hz) — the formant warp's reference */
  formantHz: number;
}

type Additive = (f: number, k: number) => number;              // f 0..1 across frames, k 1..H → signed amplitude
type TimeDomain = (f: number, t: number) => number;            // f 0..1, t 0..1 → sample

interface Recipe { name: string; formantHz?: number; add?: Additive; time?: TimeDomain; phase?: (f: number, k: number) => number }

const TAU = Math.PI * 2;
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const smooth = (x: number) => x * x * (3 - 2 * x);

/** Deterministic hash → 0..1, so the noise tables are the same everywhere. */
function hash(a: number, b: number): number {
  let h = (a * 374761393 + b * 668265263) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

// ---- the basic shapes, additively (signed amplitude, phase 0 = sine)
const SHAPES: Additive[] = [
  (_f, k) => (k === 1 ? 1 : 0),                                                   // sine
  (_f, k) => (k % 2 ? (8 / (Math.PI * Math.PI)) / (k * k) * ((k >> 1) % 2 ? -1 : 1) : 0),   // triangle
  (_f, k) => 2 / (Math.PI * k) * (k % 2 ? 1 : -1),                                 // saw
  (_f, k) => (k % 2 ? 4 / (Math.PI * k) : 0),                                      // square
  (_f, k) => 2 / (Math.PI * k) * Math.sin(Math.PI * k * 0.2) * 1.6,               // 20 % pulse
];

/** A resonant peak over harmonic number: a bump of the given width. */
const peak = (k: number, centre: number, width: number) => Math.exp(-(((k - centre) / width) ** 2));

// Vowel formants (F1, F2, F3, Hz) for a, e, i, o, u.
const VOWELS = [
  [730, 1090, 2440], [530, 1840, 2480], [270, 2290, 3010], [570, 840, 2410], [300, 870, 2240],
];
const VOWEL_F0 = 130;

function vowelEnv(f: number, hz: number): number {
  const x = f * (VOWELS.length - 1);
  const i = Math.min(VOWELS.length - 2, Math.floor(x)), t = smooth(x - i);
  let e = 0.04;
  for (let j = 0; j < 3; j++) {
    const fc = lerp(VOWELS[i][j], VOWELS[i + 1][j], t);
    const bw = 70 + fc * 0.06;
    e += [1, 0.6, 0.35][j] / (1 + ((hz - fc) / bw) ** 2);
  }
  return e;
}

const RECIPES: Recipe[] = [
  {
    name: 'Basic',   // sine → triangle → saw → square → pulse
    add: (f, k) => {
      const x = f * (SHAPES.length - 1);
      const i = Math.min(SHAPES.length - 2, Math.floor(x)), t = x - i;
      return lerp(SHAPES[i](f, k), SHAPES[i + 1](f, k), t);
    },
  },
  {
    name: 'Analog',  // a saw through a resonant low-pass opening across the table
    add: (f, k) => {
      const c = Math.pow(2, 0.3 + f * 8.7);
      return (1 / k) * (1 / Math.sqrt(1 + (k / c) ** 8)) * (1 + 1.8 * peak(k, c, 0.12 * c + 0.8));
    },
  },
  {
    name: 'PWM',     // pulse width 50 % → 3 %
    add: (f, k) => { const w = lerp(0.5, 0.03, f); return (2 / (Math.PI * k)) * Math.sin(Math.PI * k * w) / Math.max(0.35, w * 2); },
    phase: () => Math.PI / 2,
  },
  {
    name: 'Vocal',   // a glottal source through a vowel: a, e, i, o, u
    formantHz: VOWEL_F0,
    add: (f, k) => (1 / Math.pow(k, 0.7)) * vowelEnv(f, k * VOWEL_F0),
  },
  {
    name: 'Glass',   // sparse, bell-like partials whose weights rotate across the table
    add: (f, k) => {
      const set = [1, 2, 3, 5, 7, 9, 12, 15, 19, 24, 30, 37];
      const j = set.indexOf(k);
      if (j < 0) return 0;
      const w = 0.5 + 0.5 * Math.cos(TAU * (f * 1.5 - j / set.length));
      return (j === 0 ? 1 : 0.55 * w) / Math.sqrt(1 + j * 0.6);
    },
  },
  {
    name: 'Organ',   // drawbar registrations, one after another
    add: (f, k) => {
      const bars = [1, 2, 3, 4, 5, 6, 8];
      const regs = [
        [8, 0, 0, 0, 0, 0, 0], [8, 8, 0, 0, 0, 0, 0], [8, 8, 8, 0, 0, 0, 0], [8, 6, 8, 4, 0, 3, 0],
        [8, 8, 8, 8, 6, 6, 6], [6, 8, 4, 8, 3, 8, 8], [4, 8, 0, 8, 0, 8, 8], [8, 0, 8, 0, 8, 0, 8],
      ];
      const j = bars.indexOf(k);
      if (j < 0) return 0;
      const x = f * (regs.length - 1), i = Math.min(regs.length - 2, Math.floor(x)), t = smooth(x - i);
      return lerp(regs[i][j], regs[i + 1][j], t) / 8 / Math.sqrt(k);
    },
  },
  {
    name: 'Sync',    // a saw hard-synced to the fundamental, slave ratio 1 → 8
    time: (f, t) => { const r = 1 + f * 7; return 2 * ((t * r) % 1) - 1; },
  },
  {
    name: 'Fold',    // a sine folded harder and harder
    time: (f, t) => Math.sin((1 + f * 7) * (Math.PI / 2) * Math.sin(TAU * t)),
  },
  {
    name: 'FM',      // two operators, ratio 2, index 0 → 9
    time: (f, t) => Math.sin(TAU * t + f * 9 * Math.sin(TAU * 2 * t)),
  },
  {
    name: 'Growl',   // a bright saw with two resonances sweeping up together: the talking bass
    add: (f, k) => {
      const c1 = lerp(2.5, 28, f), c2 = c1 * lerp(2.2, 1.45, f);
      return (1 / Math.sqrt(k)) * (0.08 + peak(k, c1, 1 + c1 * 0.18) + 0.7 * peak(k, c2, 1 + c2 * 0.15));
    },
  },
  {
    name: 'Felt',    // soft keys: steep roll-off, a strike-position comb, brightness growing across the table
    add: (f, k) => {
      const bright = 1.5 + f * f * 22;
      return (1 / Math.pow(k, 1.1)) * Math.exp(-(k - 1) / bright) * (0.25 + 0.75 * Math.abs(Math.sin(Math.PI * k / 7.3)));
    },
  },
  {
    name: 'Cloud',   // seeded random spectra, drifting from one to the next
    add: (f, k) => {
      const x = f * 7, i = Math.floor(Math.min(6.999, x)), t = smooth(x - i);
      const a = hash(i, k), b = hash(i + 1, k);
      return lerp(a, b, t) ** 2 / Math.pow(k, 0.85);
    },
    phase: (f, k) => TAU * hash(k, 911 + Math.floor(f * 3)),
  },
  {
    name: 'Scan',    // one bright partial scanning up the series over a soft bed
    add: (f, k) => {
      const c = 1 + f * 47;
      return 0.35 / (k * k) + peak(k, c, 0.7);
    },
  },
  {
    name: 'Steps',   // a sine quantised to fewer and fewer levels
    time: (f, t) => {
      const levels = Math.max(1, Math.round(Math.pow(2, lerp(5, 0, f))));
      return Math.round(Math.sin(TAU * t) * levels) / levels;
    },
  },
];

export const TABLE_NAMES = RECIPES.map((r) => r.name);

const cache: (Wavetable | undefined)[] = [];

/** The table with this index, built on first use. */
export function getTable(i: number): Wavetable {
  const idx = Math.max(0, Math.min(RECIPES.length - 1, i | 0));
  return cache[idx] ??= build(RECIPES[idx]);
}

/** A table from frames of one cycle each (an imported .wav): any cycle length, any frame count. */
export function tableFromCycles(name: string, cycles: Float32Array[]): Wavetable {
  const T = 8192, fft = new RealFFT(T);
  const re = new Float64Array(T / 2 + 1), im = new Float64Array(T / 2 + 1);
  const buf = new Float32Array(T);
  const amp = new Float32Array(FRAMES * HARMONICS), phase = new Float32Array(FRAMES * HARMONICS);
  for (let f = 0; f < FRAMES; f++) {
    const src = cycles[Math.round(f / (FRAMES - 1) * (cycles.length - 1))];
    for (let t = 0; t < T; t++) {
      const x = t / T * src.length, i0 = Math.floor(x), fr = x - i0;
      buf[t] = src[i0 % src.length] * (1 - fr) + src[(i0 + 1) % src.length] * fr;
    }
    fft.forward(buf, re, im);
    spectrumToFrame(re, im, T, amp, phase, f);
  }
  normalise(amp, phase);
  return complete({ name, amp, phase, formantHz: 261.6 });
}

function spectrumToFrame(re: Float64Array, im: Float64Array, T: number, amp: Float32Array, phase: Float32Array, f: number): void {
  for (let k = 1; k <= HARMONICS; k++) {
    // x = Σ (2/T)(re cos − im sin) = Σ a sin(θ + φ) with a sin φ = 2re/T, a cos φ = −2im/T
    const s = 2 * re[k] / T, c = -2 * im[k] / T;
    amp[f * HARMONICS + k - 1] = Math.hypot(s, c);
    phase[f * HARMONICS + k - 1] = Math.atan2(s, c);
  }
}

function build(r: Recipe): Wavetable {
  const amp = new Float32Array(FRAMES * HARMONICS), phase = new Float32Array(FRAMES * HARMONICS);
  if (r.time) {
    const T = 8192, fft = new RealFFT(T);
    const re = new Float64Array(T / 2 + 1), im = new Float64Array(T / 2 + 1);
    const buf = new Float32Array(T);
    for (let f = 0; f < FRAMES; f++) {
      const ff = f / (FRAMES - 1);
      for (let t = 0; t < T; t++) buf[t] = r.time(ff, t / T);
      fft.forward(buf, re, im);
      spectrumToFrame(re, im, T, amp, phase, f);
    }
  } else if (r.add) {
    for (let f = 0; f < FRAMES; f++) {
      const ff = f / (FRAMES - 1);
      for (let k = 1; k <= HARMONICS; k++) {
        const a = r.add(ff, k);
        const p = r.phase ? r.phase(ff, k) : 0;
        amp[f * HARMONICS + k - 1] = Math.abs(a);
        phase[f * HARMONICS + k - 1] = a < 0 ? p + Math.PI : p;
      }
    }
  }
  normalise(amp, phase);
  return complete({ name: r.name, amp, phase, formantHz: r.formantHz ?? 261.6 });
}

function complete(t: Omit<Wavetable, 'xs' | 'xc'>): Wavetable {
  const xs = new Float32Array(t.amp.length), xc = new Float32Array(t.amp.length);
  for (let i = 0; i < t.amp.length; i++) { xs[i] = t.amp[i] * Math.sin(t.phase[i]); xc[i] = t.amp[i] * Math.cos(t.phase[i]); }
  return { ...t, xs, xc };
}

/** Scale every frame to a peak of 1 (measured on a 2048-point cycle). */
function normalise(amp: Float32Array, phase: Float32Array): void {
  const N = 2048, fft = new RealFFT(N);
  const re = new Float64Array(N / 2 + 1), im = new Float64Array(N / 2 + 1);
  const out = new Float32Array(N);
  for (let f = 0; f < FRAMES; f++) {
    re.fill(0); im.fill(0);
    for (let k = 1; k <= HARMONICS; k++) {
      const a = amp[f * HARMONICS + k - 1], p = phase[f * HARMONICS + k - 1];
      re[k] = a * Math.sin(p) / 2; im[k] = -a * Math.cos(p) / 2;
    }
    fft.inverse(re, im, out);
    let pk = 0;
    for (let i = 0; i < N; i++) { const v = Math.abs(out[i]); if (v > pk) pk = v; }
    if (pk < 1e-9) continue;
    const g = 1 / pk;
    for (let k = 0; k < HARMONICS; k++) amp[f * HARMONICS + k] *= g;
  }
}
