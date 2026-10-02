// The voice filters: a clean state-variable filter (Zavalishin's
// topology-preserving form, stable however fast the cutoff moves), a
// four-pole low-pass from two of them, a vowel filter from three band-passes
// on formant frequencies, and a feedback comb tuned by the cutoff. Stereo,
// because the unison spread is. Coefficients are set once per block and
// ramped per sample. Prism's filters are deliberately clean: Mycelia owns
// the saturating ladder.

import { tanhf } from './util.ts';
import { F_BP, F_COMBN, F_COMBP, F_HP, F_LP12, F_LP24, F_NOTCH, F_OFF, F_VOWEL } from './params.ts';

const VOWELS = [[730, 1090, 2440], [530, 1840, 2480], [270, 2290, 3010], [570, 840, 2410], [300, 870, 2240]];
const VOWEL_GAIN = [1, 0.7, 0.45];
const COMB_MAX = 4096;

/** One SVF stage, two channels. */
class Svf {
  private s1L = 0; private s2L = 0; private s1R = 0; private s2R = 0;
  clear(): void { this.s1L = this.s2L = this.s1R = this.s2R = 0; }
  /**
   * Process in place with g ramping g0 → g1 and damping k. mode 0 lp, 1 bp,
   * 2 hp, 3 notch; `gain` scales the output, `add` adds into out instead of
   * replacing (used by the vowel's parallel bands).
   */
  run(inL: Float32Array, inR: Float32Array, outL: Float32Array, outR: Float32Array, n: number, g0: number, g1: number, k: number, mode: number, gain = 1, add = false): void {
    let s1L = this.s1L, s2L = this.s2L, s1R = this.s1R, s2R = this.s2R;
    const dg = (g1 - g0) / n;
    let g = g0;
    for (let i = 0; i < n; i++) {
      g += dg;
      const a1 = 1 / (1 + g * (g + k)), a2 = g * a1, a3 = g * a2;
      // left
      let v0 = inL[i];
      let v3 = v0 - s2L;
      let v1 = a1 * s1L + a2 * v3;
      let v2 = s2L + a2 * s1L + a3 * v3;
      s1L = 2 * v1 - s1L; s2L = 2 * v2 - s2L;
      let y = mode === 0 ? v2 : mode === 1 ? v1 : mode === 2 ? v0 - k * v1 - v2 : v0 - k * v1;
      if (add) outL[i] += y * gain; else outL[i] = y * gain;
      // right
      v0 = inR[i];
      v3 = v0 - s2R;
      v1 = a1 * s1R + a2 * v3;
      v2 = s2R + a2 * s1R + a3 * v3;
      s1R = 2 * v1 - s1R; s2R = 2 * v2 - s2R;
      y = mode === 0 ? v2 : mode === 1 ? v1 : mode === 2 ? v0 - k * v1 - v2 : v0 - k * v1;
      if (add) outR[i] += y * gain; else outR[i] = y * gain;
    }
    // flush denormals / blow-ups
    if (!(Math.abs(s1L) < 1e6)) s1L = 0; if (!(Math.abs(s2L) < 1e6)) s2L = 0;
    if (!(Math.abs(s1R) < 1e6)) s1R = 0; if (!(Math.abs(s2R) < 1e6)) s2R = 0;
    this.s1L = s1L; this.s2L = s2L; this.s1R = s1R; this.s2R = s2R;
  }
}

export class VoiceFilter {
  private a = new Svf();
  private b = new Svf();
  private c = new Svf();
  private g = [-1, -1, -1];        // last block's g per stage, for the ramp
  private combL = new Float32Array(COMB_MAX);
  private combR = new Float32Array(COMB_MAX);
  private combIdx = 0;
  private combD = -1;
  private tL = new Float32Array(64);
  private tR = new Float32Array(64);
  private lastType = -1;
  private readonly fs: number;

  constructor(sampleRate: number) { this.fs = sampleRate; }

  clear(): void {
    this.a.clear(); this.b.clear(); this.c.clear();
    this.combL.fill(0); this.combR.fill(0);
    this.g[0] = this.g[1] = this.g[2] = -1; this.combD = -1;
  }

  private gOf(hz: number): number {
    const f = Math.min(hz, this.fs * 0.45);
    return Math.tan(Math.PI * f / this.fs);
  }

  /** In place on L/R[0..n). `cut` Hz, `res` 0..1, `drive` 0..1. */
  process(L: Float32Array, R: Float32Array, n: number, type: number, cut: number, res: number, drive: number): void {
    if (type === F_OFF) return;
    if (type !== this.lastType) { this.clear(); this.lastType = type; }
    if (drive > 0) {
      const pre = 1 + drive * 6, post = 1 / (1 + drive * 1.5);
      for (let i = 0; i < n; i++) { L[i] = tanhf(L[i] * pre) * post; R[i] = tanhf(R[i] * pre) * post; }
    }
    res = Math.min(1, Math.max(0, res));
    switch (type) {
      case F_LP12: case F_BP: case F_HP: case F_NOTCH: {
        const g1 = this.gOf(cut), g0 = this.g[0] < 0 ? g1 : this.g[0];
        this.g[0] = g1;
        const k = 2 - 1.96 * res;
        const mode = type === F_LP12 ? 0 : type === F_BP ? 1 : type === F_HP ? 2 : 3;
        this.a.run(L, R, L, R, n, g0, g1, k, mode, type === F_BP ? Math.sqrt(k / 2) * 1.4 : 1);
        break;
      }
      case F_LP24: {
        const g1 = this.gOf(cut), g0 = this.g[0] < 0 ? g1 : this.g[0];
        this.g[0] = g1;
        this.a.run(L, R, L, R, n, g0, g1, 1.85 - res * 0.6, 0);
        this.b.run(L, R, L, R, n, g0, g1, 1.414 - 1.39 * res, 0, 1 + res * 0.4);
        break;
      }
      case F_VOWEL: {
        // the cutoff knob walks a → e → i → o → u
        const pos = Math.min(1, Math.max(0, Math.log(cut / 20) / Math.log(1000))) * (VOWELS.length - 1);
        const vi = Math.min(VOWELS.length - 2, Math.floor(pos)), u = pos - vi;
        const k = 0.5 - res * 0.42;
        const tL = this.tL, tR = this.tR;
        tL.set(L.subarray(0, n)); tR.set(R.subarray(0, n));
        L.fill(0, 0, n); R.fill(0, 0, n);
        const stages = [this.a, this.b, this.c];
        for (let j = 0; j < 3; j++) {
          const f = VOWELS[vi][j] + (VOWELS[vi + 1][j] - VOWELS[vi][j]) * u;
          const g1 = this.gOf(f), g0 = this.g[j] < 0 ? g1 : this.g[j];
          this.g[j] = g1;
          stages[j].run(tL, tR, L, R, n, g0, g1, k, 1, VOWEL_GAIN[j] * k * 2.2, true);
        }
        break;
      }
      case F_COMBP: case F_COMBN: {
        const target = Math.min(COMB_MAX - 2, Math.max(2, this.fs / Math.max(20, cut)));
        const d0 = this.combD < 0 ? target : this.combD;
        this.combD = target;
        const fb = (0.5 + res * 0.47) * (type === F_COMBN ? -1 : 1);
        const bl = this.combL, br = this.combR;
        let w = this.combIdx;
        const norm = 1 - Math.abs(fb) * 0.6;
        for (let i = 0; i < n; i++) {
          const d = d0 + (target - d0) * (i / n);
          let r = w - d; if (r < 0) r += COMB_MAX;
          const i0 = r | 0, fr = r - i0, i1 = (i0 + 1) % COMB_MAX;
          const yl = bl[i0] + (bl[i1] - bl[i0]) * fr;
          const yr = br[i0] + (br[i1] - br[i0]) * fr;
          const ol = L[i] + fb * yl, or = R[i] + fb * yr;
          bl[w] = tanhf(ol); br[w] = tanhf(or);
          L[i] = ol * norm; R[i] = or * norm;
          if (++w >= COMB_MAX) w = 0;
        }
        this.combIdx = w;
        break;
      }
    }
  }
}
