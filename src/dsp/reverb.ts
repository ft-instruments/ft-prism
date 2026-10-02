// The ice hall: Mycelia's 8-line feedback delay network (Householder
// mixing) with slowly modulated read positions (no metallic ringing,
// chorus-like bloom), per-line low-pass damping and high-pass, input
// diffusion and pre-delay — re-tuned brighter, with a longer pre-delay.
// Optional "shimmer": an octave-up granular pitch shifter in the feedback
// path, low-passed so it blooms rather than screams.

import { readDelay, tanhf } from './util.ts';

const N = 8;
const BASE = [1499, 1889, 2311, 2707, 3169, 3559, 4003, 4519];   // samples at 48 kHz
const MOD_RATE = [0.11, 0.17, 0.23, 0.31, 0.13, 0.19, 0.29, 0.37];
const AP_MS = [3.1, 5.3, 8.7, 13.9];
const AP_G = 0.62;
const MAX_SCALE = 1.45;
const MOD_DEPTH = 9;          // samples

class PitchUp {
  private buf: Float32Array;
  private idx = 0;
  private phase = 0;
  private readonly W: number;
  constructor(sampleRate: number) {
    this.W = Math.round(sampleRate * 0.045);
    this.buf = new Float32Array(this.W + 4);
  }
  clear(): void { this.buf.fill(0); }
  tick(x: number): number {
    const W = this.W;
    this.buf[this.idx] = x;
    const p = this.phase;
    let p2 = p + 0.5; if (p2 >= 1) p2 -= 1;
    const a = readDelay(this.buf, this.idx, W * (1 - p)) * Math.sin(Math.PI * p);
    const b = readDelay(this.buf, this.idx, W * (1 - p2)) * Math.sin(Math.PI * p2);
    this.phase += 1 / W; if (this.phase >= 1) this.phase -= 1;
    if (++this.idx >= this.buf.length) this.idx = 0;
    return a + b;
  }
}

export class Reverb {
  private lines: Float32Array[] = [];
  private idx = new Int32Array(N);
  private lengths = new Float64Array(N);
  private gains = new Float32Array(N);
  private lp = new Float32Array(N);
  private hp = new Float32Array(N);
  private modPhase = new Float32Array(N);
  private tmp = new Float32Array(N);
  private ap: Float32Array[] = [];
  private apIdx = new Int32Array(4);
  private pre: Float32Array;
  private preIdx = 0;
  private shimmer: PitchUp;
  private shimLp = 0;
  private readonly fs: number;
  private curSize = -1; private curDecay = -1;

  constructor(sampleRate: number) {
    this.fs = sampleRate;
    const ratio = sampleRate / 48000;
    for (let i = 0; i < N; i++) {
      this.lines.push(new Float32Array(Math.ceil(BASE[i] * ratio * MAX_SCALE + MOD_DEPTH * 2 + 8)));
      this.modPhase[i] = i / N;
    }
    for (let i = 0; i < 4; i++) this.ap.push(new Float32Array(Math.max(2, Math.round(AP_MS[i] * 1e-3 * sampleRate))));
    this.pre = new Float32Array(Math.round(0.024 * sampleRate));
    this.shimmer = new PitchUp(sampleRate);
    this.setSize(0.6, 3);
  }

  clear(): void {
    for (const l of this.lines) l.fill(0);
    for (const a of this.ap) a.fill(0);
    this.pre.fill(0); this.lp.fill(0); this.hp.fill(0);
    this.shimmer.clear(); this.shimLp = 0;
  }

  private setSize(size: number, decay: number): void {
    if (size === this.curSize && decay === this.curDecay) return;
    this.curSize = size; this.curDecay = decay;
    const scale = (0.45 + size) * this.fs / 48000;
    for (let i = 0; i < N; i++) {
      this.lengths[i] = BASE[i] * scale;
      this.gains[i] = Math.pow(10, (-3 * this.lengths[i]) / (decay * this.fs));
    }
  }

  private allpass(x: number, i: number): number {
    const buf = this.ap[i];
    let idx = this.apIdx[i];
    const d = buf[idx];
    const v = x - AP_G * d;
    buf[idx] = v;
    if (++idx >= buf.length) idx = 0;
    this.apIdx[i] = idx;
    return d + AP_G * v;
  }

  /** In place. `size` 0..1, `decay` seconds, `tone` 0..1, `shimmer` 0..1, `mix` 0..1. */
  process(L: Float32Array, R: Float32Array, n: number, size: number, decay: number, tone: number, shimmer: number, mix: number): void {
    if (mix <= 0) return;
    this.setSize(size, decay);
    const fs = this.fs;
    const lines = this.lines, idx = this.idx, lengths = this.lengths, gains = this.gains;
    const lp = this.lp, hp = this.hp, tmp = this.tmp, modPhase = this.modPhase;
    const lpA = 1 - Math.exp(-2 * Math.PI * (2000 + tone * 14000) / fs);
    const hpA = 1 - Math.exp(-2 * Math.PI * 70 / fs);
    const shimLpA = 1 - Math.exp(-2 * Math.PI * 3500 / fs);
    const twoOverN = 2 / N;
    const wet = mix * 0.6, dry = 1 - mix * 0.35;
    const pre = this.pre, preLen = pre.length;
    let preIdx = this.preIdx;
    const shimGain = shimmer * 0.45;
    let shimLp = this.shimLp;
    for (let i = 0; i < n; i++) {
      const xl = L[i], xr = R[i];
      // pre-delay + diffusion on the mono sum
      const inMono = (xl + xr) * 0.5;
      const preOut = pre[preIdx]; pre[preIdx] = inMono; if (++preIdx >= preLen) preIdx = 0;
      let x = this.allpass(this.allpass(this.allpass(this.allpass(preOut, 0), 1), 2), 3);
      // read the modulated taps
      let sum = 0, outL = 0, outR = 0;
      for (let j = 0; j < N; j++) {
        let ph = modPhase[j] + MOD_RATE[j] / fs; if (ph >= 1) ph -= 1; modPhase[j] = ph;
        const d = lengths[j] + Math.sin(6.283185307 * ph) * MOD_DEPTH;
        const v = readDelay(lines[j], idx[j], d);
        tmp[j] = v; sum += v;
        if (j & 1) outR += (j & 2) ? v : -v; else outL += (j & 2) ? v : -v;
      }
      // shimmer: octave-up of the tail, softened, fed back in
      if (shimGain > 0) {
        const sh = this.shimmer.tick((outL + outR) * 0.25);
        shimLp += (sh - shimLp) * shimLpA;
        x += tanhf(shimLp * shimGain);
      }
      // Householder feedback with damping
      const s = sum * twoOverN;
      for (let j = 0; j < N; j++) {
        let v = (tmp[j] - s) * gains[j] + ((j & 1) ? -x : x);
        lp[j] += (v - lp[j]) * lpA;
        hp[j] += (lp[j] - hp[j]) * hpA;
        v = lp[j] - hp[j];
        const line = lines[j];
        line[idx[j]] = v;
        if (++idx[j] >= line.length) idx[j] = 0;
      }
      L[i] = xl * dry + outL * wet;
      R[i] = xr * dry + outR * wet;
    }
    this.preIdx = preIdx; this.shimLp = shimLp;
  }
}
