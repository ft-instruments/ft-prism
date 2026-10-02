// The spectral oscillator. One per oscillator per voice.
//
// It never plays a stored waveform. Whenever what it should sound like
// changes (position, warp, warp amount, or the pitch moving far enough to
// change how many harmonics fit under Nyquist), it *re-synthesises* one
// cycle: reads the table's spectra at the position (blending frames as
// complex numbers, or — in spectral morph — amplitude and phase apart so
// partials glide instead of fading through each other), applies the warp to
// the spectrum, drops every harmonic the highest unison copy would alias,
// and runs one inverse FFT. The new cycle is crossfaded in over the next
// block. A static sound costs nothing; a moving one costs one small FFT
// per block. Because the band limit is applied per voice, per pitch, the
// oscillator does not alias at any note, without mip-maps.
//
// Warps that only make sense in time (bend, sync) take the cycle through
// the FFT a second time so they are band-limited too. Stretch moves the
// partials off the harmonic series, so no single cycle can hold it: it is
// played additively instead, partial by partial, from the same spectrum.

import { RealFFT } from './fft.ts';
import { FRAMES, HARMONICS, type Wavetable } from './tables.ts';
import { W_BEND, W_FILTER, W_FORMANT, W_NONE, W_ODDEVEN, W_SHIFT, W_SKEW, W_SMEAR, W_STRETCH, W_SYNC } from './params.ts';

export const MAX_UNISON = 16;
const MAX_N = 2048;
const MAX_PARTIALS = 64;
const TAU = Math.PI * 2;

// ---- shared scratch: the DSP runs on one thread, so every oscillator can use the same buffers
const FFTS = new Map<number, RealFFT>();
const fftOf = (n: number) => { let f = FFTS.get(n); if (!f) { f = new RealFFT(n); FFTS.set(n, f); } return f; };
for (const n of [256, 512, 1024, 2048]) fftOf(n);
// the spectrum being built, per harmonic (1-based), as a·sin φ and a·cos φ
const XS = new Float64Array(HARMONICS + 2);
const XC = new Float64Array(HARMONICS + 2);
const A = new Float64Array(HARMONICS + 2);      // amplitudes, for the warps that move them
const A2 = new Float64Array(HARMONICS + 2);
const S2 = new Float64Array(HARMONICS + 2);
const C2 = new Float64Array(HARMONICS + 2);
const RE = new Float64Array(MAX_N / 2 + 1);
const IM = new Float64Array(MAX_N / 2 + 1);
const TD = new Float32Array(MAX_N);
const TD2 = new Float32Array(MAX_N);

/** Sine lookup for the additive partials. */
const SIN_N = 4096;
const SIN = new Float32Array(SIN_N + 1);
for (let i = 0; i <= SIN_N; i++) SIN[i] = Math.sin((TAU * i) / SIN_N);

/** How many harmonics fit: Hb on a ladder of quarter-octaves so small pitch moves don't rebuild. */
export function bandLimit(fs: number, fMax: number): number {
  const h = Math.min(HARMONICS, Math.max(1, (0.46 * fs) / Math.max(1, fMax)));
  const step = Math.floor(Math.log2(h) * 4) / 4;
  return Math.max(1, Math.min(HARMONICS, Math.floor(Math.pow(2, step))));
}

const nextPow2 = (x: number) => { let n = 1; while (n < x) n <<= 1; return n; };

/** What the oscillator should sound like this block. */
export interface Shape {
  table: Wavetable;
  tableId: number;
  pos: number;           // 0..1
  spectral: boolean;     // morph mode
  warp: number;
  amt: number;           // -1..1
  hb: number;            // harmonics allowed
  f0: number;            // Hz, for the formant warp
}

export class SpectralOsc {
  private cur = new Float32Array(MAX_N + 1);
  private prev = new Float32Array(MAX_N + 1);
  private nCur = 256;
  private nPrev = 256;
  private fading = false;
  private built = false;
  // what the current cycle was built from
  private sTable = -1; private sPos = -1; private sSpectral = false; private sWarp = -1; private sAmt = 0; private sHb = 0; private sQ = 0;
  /** unison copies' phases, 0..1 */
  readonly phase = new Float64Array(MAX_UNISON);
  // stretch: additive partials
  private pAmp = new Float32Array(MAX_PARTIALS);
  private pAmpPrev = new Float32Array(MAX_PARTIALS);
  private pRatio = new Float32Array(MAX_PARTIALS);
  private pPhase = new Float64Array(MAX_UNISON * MAX_PARTIALS);
  private nPartials = 0;
  stretching = false;

  /** Start a note: copies' phases from 0 (punchy) to random (lush). */
  reset(rand: number, rng: () => number): void {
    for (let c = 0; c < MAX_UNISON; c++) {
      const r = c === 0 ? 0 : rng();
      this.phase[c] = rand * r;
      for (let j = 0; j < MAX_PARTIALS; j++) this.pPhase[c * MAX_PARTIALS + j] = rand * rng();
    }
    this.fading = false;
  }

  /** Rebuild the cycle if the shape moved; returns true if it did. */
  update(s: Shape): boolean {
    const stretch = s.warp === W_STRETCH;
    let q = 0;
    if (s.warp === W_FORMANT) q = s.f0 / (s.table.formantHz * Math.pow(2, s.amt * 2));
    if (this.built && s.tableId === this.sTable && s.warp === this.sWarp && s.spectral === this.sSpectral && s.hb === this.sHb
      && Math.abs(s.pos - this.sPos) < 1e-4 && Math.abs(s.amt - this.sAmt) < 1e-4
      && (s.warp !== W_FORMANT || Math.abs(q / this.sQ - 1) < 0.004)) return false;
    const first = !this.built;
    this.built = true;
    this.sTable = s.tableId; this.sPos = s.pos; this.sSpectral = s.spectral; this.sWarp = s.warp; this.sAmt = s.amt; this.sHb = s.hb; this.sQ = q;
    this.stretching = stretch;
    readFrame(s.table, s.pos, s.spectral, s.warp === W_SKEW ? s.amt : 0, s.hb);
    applyWarp(s.warp, s.amt, s.hb, q);
    taper(s.hb);
    if (stretch) {
      // the additive bank reads the first partials straight from the spectrum
      this.pAmpPrev.set(this.pAmp);
      const np = Math.min(MAX_PARTIALS, s.hb);
      const st = s.amt * 0.25;
      for (let j = 0; j < MAX_PARTIALS; j++) {
        const k = j + 1;
        this.pAmp[j] = j < np ? Math.hypot(XS[k], XC[k]) : 0;
        this.pRatio[j] = Math.pow(k, 1 + st);
      }
      this.nPartials = np;
      if (first) this.pAmpPrev.set(this.pAmp);
      this.fading = !first;
      return true;
    }
    // into the time domain
    const n = Math.min(MAX_N, Math.max(256, nextPow2(s.hb * 4)));
    const timeWarp = s.warp === W_BEND || s.warp === W_SYNC;
    const tmp = this.prev;
    this.prev = this.cur; this.nPrev = this.nCur;
    this.cur = tmp; this.nCur = n;
    if (timeWarp) {
      // big enough that the warp's new harmonics fold back above hb, not into it
      const nw = Math.min(MAX_N, Math.max(512, nextPow2(s.hb * 8)));
      synth(nw, s.hb, TD);
      warpTime(s.warp, s.amt, TD, TD2, nw);
      // band-limit again: forward, keep ≤ hb, back at the playback size
      fftOf(nw).forward(TD2, RE, IM);
      for (let k = 0; k <= nw / 2; k++) {
        if (k === 0 || k > s.hb) { RE[k] = 0; IM[k] = 0; continue; }
        RE[k] /= nw; IM[k] /= nw;
      }
      // the taper again, so the cut is smooth
      const t0 = Math.floor(s.hb * 0.75);
      for (let k = t0 + 1; k <= s.hb; k++) { const w = 0.5 + 0.5 * Math.cos(Math.PI * (k - t0) / (s.hb - t0 + 1)); RE[k] *= w; IM[k] *= w; }
      fftOf(n).inverse(RE, IM, this.cur);
    } else {
      synth(n, s.hb, this.cur);
    }
    this.cur[n] = this.cur[0];
    if (first) { this.prev.set(this.cur); this.nPrev = n; }
    this.fading = !first;
    return true;
  }

  /**
   * Add `count` samples into L/R from `off`. Copy c plays at inc·ratio[c]
   * with gains gl[c], gr[c]; the base increment ramps from inc0 to inc1.
   * `pm` (mono, from osc 3) offsets the read phase by pmAmt cycles.
   */
  render(L: Float32Array, R: Float32Array, off: number, count: number, inc0: number, inc1: number, copies: number,
    ratio: Float64Array, gl: Float32Array, gr: Float32Array, pm: Float32Array | null, pmAmt: number): void {
    if (this.stretching) { this.renderPartials(L, R, off, count, inc0, inc1, copies, ratio, gl, gr); return; }
    const cur = this.cur, prev = this.prev, nc = this.nCur, np = this.nPrev;
    const fading = this.fading;
    const dInc = (inc1 - inc0) / count;
    const usePm = pm !== null && pmAmt > 0;
    for (let c = 0; c < copies; c++) {
      const r = ratio[c], gL = gl[c], gR = gr[c];
      let ph = this.phase[c];
      let inc = inc0 * r;
      const di = dInc * r;
      for (let i = 0; i < count; i++) {
        let p = ph;
        if (usePm) { p += pmAmt * pm![i]; p -= Math.floor(p); }
        let x = nc * p;
        let i0 = x | 0;
        let v = cur[i0] + (cur[i0 + 1] - cur[i0]) * (x - i0);
        if (fading) {
          x = np * p; i0 = x | 0;
          const u = prev[i0] + (prev[i0 + 1] - prev[i0]) * (x - i0);
          const w = (i + 1) / count;
          v = u + (v - u) * w;
        }
        L[off + i] += v * gL; R[off + i] += v * gR;
        ph += inc; if (ph >= 1) ph -= 1;
        inc += di;
      }
      this.phase[c] = ph;
    }
    this.fading = false;
  }

  private renderPartials(L: Float32Array, R: Float32Array, off: number, count: number, inc0: number, inc1: number, copies: number,
    ratio: Float64Array, gl: Float32Array, gr: Float32Array): void {
    const np = this.nPartials, amp = this.pAmp, prev = this.pAmpPrev, pr = this.pRatio, phs = this.pPhase;
    const fading = this.fading;
    const dInc = (inc1 - inc0) / count;
    for (let c = 0; c < copies; c++) {
      const r = ratio[c], gL = gl[c], gR = gr[c];
      for (let j = 0; j < np; j++) {
        const kr = pr[j] * r;
        if (inc1 * kr >= 0.47 || inc0 * kr >= 0.47) continue;   // above Nyquist at this pitch
        const a1 = amp[j], a0 = fading ? prev[j] : a1;
        if (a0 < 1e-5 && a1 < 1e-5) continue;
        const da = (a1 - a0) / count;
        let a = a0;
        let ph = phs[c * MAX_PARTIALS + j];
        let inc = inc0 * kr;
        const di = dInc * kr;
        for (let i = 0; i < count; i++) {
          const x = ph * SIN_N, i0 = x | 0;
          const v = (SIN[i0] + (SIN[i0 + 1] - SIN[i0]) * (x - i0)) * a;
          L[off + i] += v * gL; R[off + i] += v * gR;
          ph += inc; if (ph >= 1) ph -= 1;
          inc += di; a += da;
        }
        phs[c * MAX_PARTIALS + j] = ph;
      }
      // the base phase still runs, for anything that reads it (sync to sub)
      let ph = this.phase[c] + (inc0 + inc1) * 0.5 * r * count;
      ph -= Math.floor(ph);
      this.phase[c] = ph;
    }
    this.fading = false;
  }
}

// ---------------------------------------------------------------- spectrum

/** Fill XS/XC (1..hb) from the table at `pos`; skew offsets each harmonic's frame. */
function readFrame(t: Wavetable, pos: number, spectral: boolean, skew: number, hb: number): void {
  const amp = t.amp, phase = t.phase, xs = t.xs, xc = t.xc, H = HARMONICS;
  const fpos = Math.min(1, Math.max(0, pos)) * (FRAMES - 1);
  for (let k = 1; k <= hb; k++) {
    let f = fpos;
    if (skew !== 0) {
      f += skew * ((k - 1) / Math.max(1, hb - 1)) * (FRAMES - 1);
      f = f < 0 ? 0 : f > FRAMES - 1 ? FRAMES - 1 : f;
    }
    const i0 = Math.min(FRAMES - 2, f | 0), u = f - i0;
    const j0 = i0 * H + k - 1, j1 = j0 + H;
    if (spectral) {
      // amplitude and phase apart: partials glide
      const a0 = amp[j0], a1 = amp[j1];
      const p0 = phase[j0], p1 = phase[j1];
      const a = a0 + (a1 - a0) * u;
      if (p0 === p1) {
        // the same phase in both frames (most tables): no trigonometry needed
        const r = a0 > 1e-12 ? a / a0 : 0, r1 = a1 > 1e-12 ? a / a1 : 0;
        if (a0 > 1e-12) { XS[k] = xs[j0] * r; XC[k] = xc[j0] * r; }
        else { XS[k] = xs[j1] * r1; XC[k] = xc[j1] * r1; }
      } else {
        let dp = p1 - p0;
        dp -= TAU * Math.round(dp / TAU);
        const p = p0 + dp * u;
        XS[k] = a * Math.sin(p); XC[k] = a * Math.cos(p);
      }
    } else {
      // as complex numbers: the frames crossfade
      XS[k] = xs[j0] + (xs[j1] - xs[j0]) * u;
      XC[k] = xc[j0] + (xc[j1] - xc[j0]) * u;
    }
  }
  XS[0] = 0; XC[0] = 0;
  for (let k = hb + 1; k <= HARMONICS + 1; k++) { XS[k] = 0; XC[k] = 0; }
}

/** A ← |X| over 1..n. */
function amplitudes(n: number): void {
  A[0] = 0;
  for (let k = 1; k <= n; k++) A[k] = Math.hypot(XS[k], XC[k]);
  A[n + 1] = 0;
}

/** Harmonic k takes amplitude `a` with the phase of harmonic j. */
function setFrom(k: number, a: number, j: number): void {
  const aj = A[j];
  if (aj > 1e-12) { S2[k] = XS[j] * (a / aj); C2[k] = XC[j] * (a / aj); }
  else { S2[k] = 0; C2[k] = -a; }
}

/** Amplitude at a fractional harmonic number (linear between harmonics). */
function ampAt(x: number, hb: number): number {
  if (x < 1) return x <= 0 ? 0 : A[1] * x;
  const i = x | 0;
  if (i >= hb) return i === hb ? A[hb] * (1 - (x - i)) : 0;
  return A[i] + (A[i + 1] - A[i]) * (x - i);
}

/** The spectral warps, in place on XS/XC (1..hb). */
function applyWarp(warp: number, amt: number, hb: number, q: number): void {
  switch (warp) {
    case W_NONE: case W_SKEW: case W_STRETCH: case W_BEND: case W_SYNC: return;
    case W_FILTER: {
      // a smooth brick-wall inside the oscillator (Massive's Spectrum mode)
      const a = Math.max(0, amt);
      if (a <= 0) return;
      const c = Math.pow(2, (1 - a) * 9);
      for (let k = 1; k <= hb; k++) { const g = 1 / Math.sqrt(1 + Math.pow(k / c, 12)); XS[k] *= g; XC[k] *= g; }
      return;
    }
    case W_FORMANT: {
      // hold the spectral envelope in Hz while the harmonics move under it
      amplitudes(HARMONICS);
      for (let k = 1; k <= hb; k++) {
        const x = k * q;
        setFrom(k, ampAt(x, HARMONICS), Math.max(1, Math.min(HARMONICS, Math.round(x))));
      }
      for (let k = 1; k <= hb; k++) { XS[k] = S2[k]; XC[k] = C2[k]; }
      return;
    }
    case W_SHIFT: {
      // move the whole spectrum up or down the harmonic series
      amplitudes(hb);
      const d = amt * 24;
      for (let k = 1; k <= hb; k++) {
        const x = k - d;
        setFrom(k, ampAt(x, hb), Math.max(1, Math.min(hb, Math.round(x))));
      }
      for (let k = 1; k <= hb; k++) { XS[k] = S2[k]; XC[k] = C2[k]; }
      return;
    }
    case W_SMEAR: {
      // blur the amplitudes across neighbours; the tone dissolves into breath
      const r = Math.round(Math.abs(amt) * 16);
      if (r < 1) return;
      amplitudes(hb);
      let acc = 0;
      A2[0] = 0;
      for (let k = 1; k <= hb; k++) { acc += A[k]; A2[k] = acc; }
      for (let k = 1; k <= hb; k++) {
        const lo = Math.max(1, k - r), hi = Math.min(hb, k + r);
        setFrom(k, (A2[hi] - A2[lo - 1]) / (hi - lo + 1) * (1 + r * 0.08), k);
      }
      for (let k = 1; k <= hb; k++) { XS[k] = S2[k]; XC[k] = C2[k]; }
      return;
    }
    case W_ODDEVEN: {
      if (amt > 0) for (let k = 2; k <= hb; k += 2) { XS[k] *= 1 - amt; XC[k] *= 1 - amt; }
      else if (amt < 0) for (let k = 3; k <= hb; k += 2) { XS[k] *= 1 + amt; XC[k] *= 1 + amt; }
      return;
    }
  }
}

/** Fade the top quarter of the allowed harmonics, so a band-limit change never clicks. */
function taper(hb: number): void {
  if (hb < 8) return;
  const t0 = Math.floor(hb * 0.75);
  for (let k = t0 + 1; k <= hb; k++) { const w = 0.5 + 0.5 * Math.cos(Math.PI * (k - t0) / (hb - t0 + 1)); XS[k] *= w; XC[k] *= w; }
}

/** XS/XC → one cycle of n samples in `out` (n + 1 long: the guard sample is the caller's). */
function synth(n: number, hb: number, out: Float32Array): void {
  const h = n / 2;
  RE.fill(0, 0, h + 1); IM.fill(0, 0, h + 1);
  const top = Math.min(hb, h - 1);
  for (let k = 1; k <= top; k++) { RE[k] = XS[k] * 0.5; IM[k] = -XC[k] * 0.5; }
  fftOf(n).inverse(RE, IM, out);
}

const BEND_STEP = 8;

/** Bend and sync: read the cycle (n samples) along a warped phase. */
function warpTime(warp: number, amt: number, src: Float32Array, dst: Float32Array, n: number): void {
  if (warp === W_BEND) {
    // p ↦ p^e, evaluated every BEND_STEP samples and interpolated between
    const e = Math.pow(2, amt * 2.5);
    let prev = 0;
    for (let i = 0; i < n; i += BEND_STEP) {
      const next = Math.pow((i + BEND_STEP) / n, e) * n;
      for (let j = 0; j < BEND_STEP; j++) {
        const p = prev + (next - prev) * (j / BEND_STEP);
        const i0 = p | 0, u = p - i0;
        const a = src[i0 % n];
        dst[i + j] = a + (src[(i0 + 1) % n] - a) * u;
      }
      prev = next;
    }
  } else {
    const r = 1 + Math.abs(amt) * 7;
    for (let i = 0; i < n; i++) {
      let p = (i / n) * r; p -= Math.floor(p); p *= n;
      const i0 = p | 0, u = p - i0;
      dst[i] = src[i0] + (src[(i0 + 1) % n] - src[i0]) * u;
    }
  }
}

/**
 * For the display: what an oscillator with this shape plays — one cycle
 * (resampled into `cycle`) and the first harmonics' amplitudes (into
 * `amps`) — through the same read, warp and band-limit as the audio.
 */
export function preview(s: Shape, cycle: Float32Array, amps: Float32Array): void {
  const hb = Math.max(1, Math.min(HARMONICS, s.hb));
  let q = 0;
  if (s.warp === W_FORMANT) q = s.f0 / (s.table.formantHz * Math.pow(2, s.amt * 2));
  readFrame(s.table, s.pos, s.spectral, s.warp === W_SKEW ? s.amt : 0, hb);
  applyWarp(s.warp, s.amt, hb, q);
  taper(hb);
  for (let k = 0; k < amps.length; k++) amps[k] = k + 1 <= hb ? Math.hypot(XS[k + 1], XC[k + 1]) : 0;
  if (s.warp === W_STRETCH) {
    // inharmonic: draw it as the sum of its first partials, over one fundamental period
    const st = s.amt * 0.25;
    for (let i = 0; i < cycle.length; i++) {
      let v = 0;
      for (let k = 1; k <= Math.min(64, hb); k++) v += Math.hypot(XS[k], XC[k]) * Math.sin(2 * Math.PI * Math.pow(k, 1 + st) * i / cycle.length);
      cycle[i] = v;
    }
    return;
  }
  const n = 1024;
  if (s.warp === W_BEND || s.warp === W_SYNC) {
    synth(n, Math.min(hb, 255), TD);
    warpTime(s.warp, s.amt, TD, TD2, n);
    for (let i = 0; i < cycle.length; i++) cycle[i] = TD2[Math.floor(i / cycle.length * n)];
    return;
  }
  synth(n, Math.min(hb, 255), TD);
  for (let i = 0; i < cycle.length; i++) cycle[i] = TD[Math.floor(i / cycle.length * n)];
}
