// Insert effects: they sit inside the voice, so they follow its pitch and
// its envelopes. Insert A is in front of filter 1, insert B after the
// filters. Each has a type, an amount, a bipolar colour and a mix.
//
// The frequency shifter is a Hilbert transformer — two chains of IIR
// allpasses whose outputs stay 90° apart across the audio band (Olli
// Niemitalo's coefficients) — followed by single-sideband modulation. It has
// no latency, so it can also live inside the delay's feedback loop.

import { tanhf } from './util.ts';
import { I_CLIP, I_COMB, I_CRUSH, I_FOLD, I_OFF, I_PARA, I_RING, I_SHAPE, I_SHIFT } from './params.ts';

const HA = [0.6923878, 0.9360654322959, 0.9882295226860, 0.9987488452737].map((a) => a * a);
const HB = [0.4021921162426, 0.8561710882420, 0.9722909545651, 0.9952884791278].map((a) => a * a);

/** Analytic signal of one channel: tick() leaves the in-phase part in `i`, quadrature in `q`. */
export class Hilbert {
  private xa = new Float64Array(8); private ya = new Float64Array(8);
  private xb = new Float64Array(8); private yb = new Float64Array(8);
  private delayed = 0;
  i = 0; q = 0;
  clear(): void { this.xa.fill(0); this.ya.fill(0); this.xb.fill(0); this.yb.fill(0); this.delayed = 0; this.i = this.q = 0; }
  tick(x: number): void {
    let a = x, b = x;
    const xa = this.xa, ya = this.ya, xb = this.xb, yb = this.yb;
    for (let s = 0; s < 4; s++) {
      const j = s * 2;
      const y = HA[s] * (a + ya[j + 1]) - xa[j + 1];
      xa[j + 1] = xa[j]; xa[j] = a; ya[j + 1] = ya[j]; ya[j] = y; a = y;
      const z = HB[s] * (b + yb[j + 1]) - xb[j + 1];
      xb[j + 1] = xb[j]; xb[j] = b; yb[j + 1] = yb[j]; yb[j] = z; b = z;
    }
    this.i = this.delayed; this.delayed = a;
    this.q = b;
  }
}

const COMB_MAX = 4096;

export class Insert {
  private hl = new Hilbert();
  private hr = new Hilbert();
  private osc = 0;              // shifter / ring phase, 0..1
  private holdL = 0; private holdR = 0; private holdN = 0;
  private bl = new Float32Array(COMB_MAX);
  private br = new Float32Array(COMB_MAX);
  private w = 0;
  private lastType = -1;
  private readonly fs: number;

  constructor(sampleRate: number) { this.fs = sampleRate; }

  clear(): void {
    this.hl.clear(); this.hr.clear(); this.osc = 0;
    this.holdL = this.holdR = 0; this.holdN = 0;
    this.bl.fill(0); this.br.fill(0);
  }

  /** In place on L/R[0..n). `f0` is the voice's pitch in Hz (the ring and comb follow it). */
  process(L: Float32Array, R: Float32Array, n: number, type: number, a: number, b: number, mix: number, f0: number): void {
    if (type === I_OFF || mix <= 0) return;
    if (type !== this.lastType) { this.clear(); this.lastType = type; }
    a = Math.min(1, Math.max(0, a));
    const dry = 1 - mix;
    switch (type) {
      case I_SHIFT: {
        // amount 0..1 → −1..+1, squared for resolution near zero; colour blends fixed Hz → multiples of the pitch
        const s = a * 2 - 1;
        const fixed = Math.sign(s) * s * s * 1500;
        const tracked = s * 2 * f0;
        const hz = fixed * (1 - Math.abs(b)) + tracked * Math.abs(b);
        const inc = hz / this.fs;
        let ph = this.osc;
        for (let i = 0; i < n; i++) {
          const c = Math.cos(ph * 6.283185307), sn = Math.sin(ph * 6.283185307);
          this.hl.tick(L[i]); this.hr.tick(R[i]);
          const yl = this.hl.i * c + this.hl.q * sn;
          const yr = this.hr.i * c + this.hr.q * sn;
          L[i] = L[i] * dry + yl * mix; R[i] = R[i] * dry + yr * mix;
          ph += inc; ph -= Math.floor(ph);
        }
        this.osc = ph;
        break;
      }
      case I_RING: {
        // a sine at a ratio of the voice's pitch: 1/4 … 8, colour detunes it
        const ratio = Math.pow(2, a * 5 - 2) * Math.pow(2, b * 0.5);
        const inc = Math.min(0.49, (f0 * ratio) / this.fs);
        let ph = this.osc;
        for (let i = 0; i < n; i++) {
          const m = Math.sin(ph * 6.283185307);
          L[i] = L[i] * dry + L[i] * m * mix; R[i] = R[i] * dry + R[i] * m * mix;
          ph += inc; if (ph >= 1) ph -= 1;
        }
        this.osc = ph;
        break;
      }
      case I_CRUSH: {
        const hold = 1 + Math.round(a * a * 47);
        const bits = Math.round(16 - (b + 1) * 7);
        const q = Math.pow(2, bits - 1);
        for (let i = 0; i < n; i++) {
          if (--this.holdN <= 0) { this.holdN = hold; this.holdL = Math.round(L[i] * q) / q; this.holdR = Math.round(R[i] * q) / q; }
          L[i] = L[i] * dry + this.holdL * mix; R[i] = R[i] * dry + this.holdR * mix;
        }
        break;
      }
      case I_FOLD: {
        const g = 1 + a * 10, bias = b * 0.6;
        for (let i = 0; i < n; i++) {
          const yl = Math.sin(1.5707963 * g * (L[i] + bias)), yr = Math.sin(1.5707963 * g * (R[i] + bias));
          L[i] = L[i] * dry + yl * mix * 0.8; R[i] = R[i] * dry + yr * mix * 0.8;
        }
        break;
      }
      case I_SHAPE: {
        const g = 1 + a * 20, off = b * 0.4, c = tanhf(off), norm = 1 / tanhf(Math.min(3, g * 0.6));
        for (let i = 0; i < n; i++) {
          L[i] = L[i] * dry + (tanhf(L[i] * g + off) - c) * norm * 0.8 * mix;
          R[i] = R[i] * dry + (tanhf(R[i] * g + off) - c) * norm * 0.8 * mix;
        }
        break;
      }
      case I_PARA: {
        const g = 1 + a * 6, ev = b * 0.5;
        const sh = (x: number) => { let z = x * g; z = z > 1 ? 1 : z < -1 ? -1 : z; return z * (2 - Math.abs(z)) + ev * z * z; };
        for (let i = 0; i < n; i++) {
          L[i] = L[i] * dry + sh(L[i]) * 0.8 * mix; R[i] = R[i] * dry + sh(R[i]) * 0.8 * mix;
        }
        break;
      }
      case I_CLIP: {
        const g = 1 + a * 30, off = b * 0.5;
        for (let i = 0; i < n; i++) {
          let yl = L[i] * g + off, yr = R[i] * g + off;
          yl = yl > 1 ? 1 : yl < -1 ? -1 : yl; yr = yr > 1 ? 1 : yr < -1 ? -1 : yr;
          L[i] = L[i] * dry + (yl - off * 0.5) * 0.7 * mix; R[i] = R[i] * dry + (yr - off * 0.5) * 0.7 * mix;
        }
        break;
      }
      case I_COMB: {
        // tuned to the voice: ½ … 4 × its pitch; colour is the feedback, ±
        const hz = f0 * Math.pow(2, a * 3 - 1);
        const d = Math.min(COMB_MAX - 2, Math.max(2, this.fs / hz));
        const fb = b * 0.95;
        const bl = this.bl, br = this.br;
        let w = this.w;
        for (let i = 0; i < n; i++) {
          let r = w - d; if (r < 0) r += COMB_MAX;
          const i0 = r | 0, fr = r - i0, i1 = (i0 + 1) % COMB_MAX;
          const yl = bl[i0] + (bl[i1] - bl[i0]) * fr, yr = br[i0] + (br[i1] - br[i0]) * fr;
          const ol = L[i] + fb * yl, or = R[i] + fb * yr;
          bl[w] = tanhf(ol); br[w] = tanhf(or);
          L[i] = L[i] * dry + (ol * 0.6) * mix; R[i] = R[i] * dry + (or * 0.6) * mix;
          if (++w >= COMB_MAX) w = 0;
        }
        this.w = w;
        break;
      }
    }
  }
}
