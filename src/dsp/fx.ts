// The master effects, after the voices are summed:
//
//   dimension → chorus → delay (with the spiral shifter in its loop)
//   → [reverb, in reverb.ts] → eq → squash
//
// Dimension is a Massive-style "dimension expander": two short delays of
// the mono sum, added to one side and subtracted from the other, so the
// image widens and the mono sum is untouched. Squash is the genre's
// finishing tool, three-band upward + downward compression in the manner
// of the OTT preset. Everything is in place on L/R and costs nothing at
// mix 0.

import { readDelay } from './util.ts';
import { Hilbert } from './inserts.ts';

export class Dimension {
  private buf: Float32Array;
  private w = 0;
  private ph = 0;
  private readonly fs: number;
  constructor(sampleRate: number) {
    this.fs = sampleRate;
    this.buf = new Float32Array(Math.ceil(sampleRate * 0.05));
  }
  clear(): void { this.buf.fill(0); }
  process(L: Float32Array, R: Float32Array, n: number, size: number, mix: number): void {
    if (mix <= 0) return;
    const fs = this.fs, buf = this.buf, len = buf.length;
    const t1 = (0.006 + size * 0.012) * fs, t2 = (0.009 + size * 0.019) * fs;
    const depth = 0.0006 * fs;
    let w = this.w, ph = this.ph;
    const inc = 0.25 / fs;
    const g = mix * 0.75;
    for (let i = 0; i < n; i++) {
      buf[w] = (L[i] + R[i]) * 0.5;
      const m = Math.sin(ph * 6.283185307) * depth;
      const a = readDelay(buf, w, t1 + m), b = readDelay(buf, w, t2 - m);
      L[i] += (a - b) * g; R[i] += (b - a) * g;
      if (++w >= len) w = 0;
      ph += inc; if (ph >= 1) ph -= 1;
    }
    this.w = w; this.ph = ph;
  }
}

export class Chorus {
  private bl: Float32Array; private br: Float32Array;
  private w = 0;
  private ph = 0;
  private readonly fs: number;
  constructor(sampleRate: number) {
    this.fs = sampleRate;
    this.bl = new Float32Array(Math.ceil(sampleRate * 0.04));
    this.br = new Float32Array(Math.ceil(sampleRate * 0.04));
  }
  clear(): void { this.bl.fill(0); this.br.fill(0); }
  process(L: Float32Array, R: Float32Array, n: number, rate: number, depth: number, mix: number): void {
    if (mix <= 0) return;
    const fs = this.fs, bl = this.bl, br = this.br, len = bl.length;
    const base = 0.008 * fs, dep = depth * 0.005 * fs;
    let w = this.w, ph = this.ph;
    const inc = rate / fs;
    const wet = mix * 0.6, dry = 1 - mix * 0.3;
    for (let i = 0; i < n; i++) {
      bl[w] = L[i]; br[w] = R[i];
      let yl = 0, yr = 0;
      for (let t = 0; t < 3; t++) {
        const p = ph + t / 3;
        const m = Math.sin(p * 6.283185307) * dep;
        yl += readDelay(bl, w, base + dep + m);
        yr += readDelay(br, w, base + dep - m);
      }
      L[i] = L[i] * dry + yl * 0.4 * wet;
      R[i] = R[i] * dry + yr * 0.4 * wet;
      if (++w >= len) w = 0;
      ph += inc; if (ph >= 1) ph -= 1;
    }
    this.w = w; this.ph = ph;
  }
}

/**
 * Stereo delay. `spiral` puts a frequency shifter in the feedback path, so
 * each repeat is shifted again: the echoes climb (or fall) out of tune, a
 * barber-pole of repeats.
 */
export class Delay {
  private bl: Float32Array; private br: Float32Array;
  private w = 0;
  private lpL = 0; private lpR = 0;
  private hl = new Hilbert(); private hr = new Hilbert();
  private ph = 0;
  private time = -1;
  private readonly fs: number;
  constructor(sampleRate: number) {
    this.fs = sampleRate;
    this.bl = new Float32Array(Math.ceil(sampleRate * 2.6));
    this.br = new Float32Array(Math.ceil(sampleRate * 2.6));
  }
  clear(): void { this.bl.fill(0); this.br.fill(0); this.lpL = this.lpR = 0; this.hl.clear(); this.hr.clear(); }
  process(L: Float32Array, R: Float32Array, n: number, seconds: number, fb: number, ping: boolean, damp: number, spiral: number, mix: number): void {
    if (mix <= 0) return;
    const fs = this.fs, bl = this.bl, br = this.br, len = bl.length;
    const target = Math.min(len - 4, Math.max(1, seconds * fs));
    if (this.time < 0) this.time = target;
    const a = 1 - Math.exp(-2 * Math.PI * (18000 * Math.pow(0.04, damp)) / fs);
    const hz = Math.sign(spiral) * spiral * spiral * 60;
    const inc = hz / fs;
    const shifting = spiral !== 0;
    let w = this.w, lpL = this.lpL, lpR = this.lpR, ph = this.ph, time = this.time;
    const glide = 1 - Math.exp(-1 / (0.08 * fs));
    for (let i = 0; i < n; i++) {
      time += (target - time) * glide;
      let yl = readDelay(bl, w, time), yr = readDelay(br, w, time);
      lpL += (yl - lpL) * a; lpR += (yr - lpR) * a;
      yl = lpL; yr = lpR;
      if (shifting) {
        const c = Math.cos(ph * 6.283185307), s = Math.sin(ph * 6.283185307);
        this.hl.tick(yl); this.hr.tick(yr);
        yl = this.hl.i * c + this.hl.q * s;
        yr = this.hr.i * c + this.hr.q * s;
        ph += inc; ph -= Math.floor(ph);
      }
      const xl = L[i], xr = R[i];
      if (ping) {
        bl[w] = (xl + xr) * 0.5 + yr * fb;
        br[w] = yl * fb;
      } else {
        bl[w] = xl + yl * fb;
        br[w] = xr + yr * fb;
      }
      L[i] = xl + yl * mix; R[i] = xr + yr * mix;
      if (++w >= len) w = 0;
    }
    this.w = w; this.lpL = lpL; this.lpR = lpR; this.ph = ph; this.time = time;
  }
}

/** Low and high shelves from one-pole splits. */
export class Eq {
  private l1 = 0; private l2 = 0; private h1 = 0; private h2 = 0;
  private readonly aLo: number; private readonly aHi: number;
  constructor(sampleRate: number) {
    this.aLo = 1 - Math.exp(-2 * Math.PI * 220 / sampleRate);
    this.aHi = 1 - Math.exp(-2 * Math.PI * 3800 / sampleRate);
  }
  clear(): void { this.l1 = this.l2 = this.h1 = this.h2 = 0; }
  process(L: Float32Array, R: Float32Array, n: number, lowDb: number, highDb: number): void {
    if (lowDb === 0 && highDb === 0) return;
    const gl = Math.pow(10, lowDb / 20) - 1, gh = Math.pow(10, highDb / 20) - 1;
    const aL = this.aLo, aH = this.aHi;
    let l1 = this.l1, l2 = this.l2, h1 = this.h1, h2 = this.h2;
    for (let i = 0; i < n; i++) {
      const x = L[i], y = R[i];
      l1 += (x - l1) * aL; l2 += (y - l2) * aL;
      h1 += (x - h1) * aH; h2 += (y - h2) * aH;
      L[i] = x + gl * l1 + gh * (x - h1);
      R[i] = y + gl * l2 + gh * (y - h2);
    }
    this.l1 = l1; this.l2 = l2; this.h1 = h1; this.h2 = h2;
  }
}

/**
 * Three bands (split at 120 Hz and 2.5 kHz so that they sum back to the
 * input exactly), each compressed downward above −22 dB and pulled upward
 * below −36 dB, stereo-linked, then blended with the dry signal by depth.
 */
export class Squash {
  private lo1 = new Float64Array(2); private lo2 = new Float64Array(2);
  private hi1 = new Float64Array(2); private hi2 = new Float64Array(2);
  private env = new Float64Array(3);
  private readonly aLo: number; private readonly aHi: number;
  private readonly fs: number;
  /** Gain reduction (dB, negative) / boost (positive) per band, for the display. */
  readonly meter = new Float32Array(3);
  private band = new Float64Array(3);
  private bandR = new Float64Array(3);
  constructor(sampleRate: number) {
    this.fs = sampleRate;
    this.aLo = 1 - Math.exp(-2 * Math.PI * 120 / sampleRate);
    this.aHi = 1 - Math.exp(-2 * Math.PI * 2500 / sampleRate);
  }
  clear(): void { this.lo1.fill(0); this.lo2.fill(0); this.hi1.fill(0); this.hi2.fill(0); this.env.fill(0); this.meter.fill(0); }
  process(L: Float32Array, R: Float32Array, n: number, depth: number, time: number, up: number, down: number): void {
    if (depth <= 0) { this.meter.fill(0); return; }
    const fs = this.fs;
    const atk = 1 - Math.exp(-1 / ((0.001 + time * 0.03) * fs));
    const rel = 1 - Math.exp(-1 / ((0.03 + time * 0.4) * fs));
    const rDown = 1 + down * 9, rUp = 1 + up * 3;
    const TD = -22, TU = -36, MAXUP = 18, FLOOR = -72;
    const aLo = this.aLo, aHi = this.aHi;
    const lo1 = this.lo1, lo2 = this.lo2, hi1 = this.hi1, hi2 = this.hi2, env = this.env;
    let m0 = 0, m1 = 0, m2 = 0;
    const band = this.band, bandR = this.bandR;
    for (let i = 0; i < n; i++) {
      // split, exactly complementary
      const xl = L[i], xr = R[i];
      lo1[0] += (xl - lo1[0]) * aLo; lo1[1] += (xr - lo1[1]) * aLo;
      lo2[0] += (lo1[0] - lo2[0]) * aLo; lo2[1] += (lo1[1] - lo2[1]) * aLo;
      const lowL = lo2[0], lowR = lo2[1];
      const restL = xl - lowL, restR = xr - lowR;
      hi1[0] += (restL - hi1[0]) * aHi; hi1[1] += (restR - hi1[1]) * aHi;
      hi2[0] += (hi1[0] - hi2[0]) * aHi; hi2[1] += (hi1[1] - hi2[1]) * aHi;
      const midL = hi2[0], midR = hi2[1];
      band[0] = lowL; band[1] = midL; band[2] = restL - midL;
      bandR[0] = lowR; bandR[1] = midR; bandR[2] = restR - midR;
      let yl = 0, yr = 0;
      for (let b = 0; b < 3; b++) {
        const lvl = Math.max(Math.abs(band[b]), Math.abs(bandR[b]));
        const e = env[b];
        env[b] = e + (lvl - e) * (lvl > e ? atk : rel);
        const db = 20 * Math.log10(env[b] + 1e-9);
        let g = 0;
        if (db > TD) g = -(db - TD) * (1 - 1 / rDown);
        else if (db < TU && db > FLOOR) g = Math.min(MAXUP, (TU - db) * (1 - 1 / rUp)) * Math.min(1, (db - FLOOR) / 12);
        const lin = Math.pow(10, g / 20);
        yl += band[b] * lin; yr += bandR[b] * lin;
        if (b === 0) m0 = g; else if (b === 1) m1 = g; else m2 = g;
      }
      L[i] = xl + (yl - xl) * depth;
      R[i] = xr + (yr - xr) * depth;
    }
    this.meter[0] = m0; this.meter[1] = m1; this.meter[2] = m2;
  }
}

/**
 * Warmth: a gentle tape-like stage after the voices — soft saturation that
 * rounds the peaks and thickens the low mids, and a top that darkens as it
 * is pushed. Off at 0.
 */
export class Warmth {
  private zl = 0; private zr = 0;
  private readonly fs: number;
  constructor(sampleRate: number) { this.fs = sampleRate; }
  clear(): void { this.zl = this.zr = 0; }
  process(L: Float32Array, R: Float32Array, n: number, amount: number): void {
    if (amount <= 0) return;
    const drive = 1 + amount * 2.5, norm = 1 / Math.tanh(drive * 0.8) * 0.8;
    const a = 1 - Math.exp(-2 * Math.PI * (18000 - amount * 11000) / this.fs);
    let zl = this.zl, zr = this.zr;
    for (let i = 0; i < n; i++) {
      const l = Math.tanh(L[i] * drive) * norm, r = Math.tanh(R[i] * drive) * norm;
      zl += (l - zl) * a; zr += (r - zr) * a;
      L[i] = L[i] + (zl - L[i]) * amount; R[i] = R[i] + (zr - R[i]) * amount;
    }
    this.zl = zl; this.zr = zr;
  }
}
