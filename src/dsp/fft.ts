// Radix-2 FFT for real signals, with preallocated buffers: one instance per
// size, no allocation after construction. Used to turn a spectrum (harmonic
// amplitudes and phases) into one cycle of a waveform, and back.
//
// A real sequence of length n is transformed as a complex one of length n/2
// (even samples real, odd samples imaginary) plus a split step, so each
// transform costs about half of a plain complex FFT of size n.

export class RealFFT {
  readonly n: number;
  private readonly h: number;              // n / 2, the complex size
  private readonly rev: Uint32Array;       // bit reversal for size h
  private readonly cos: Float64Array;      // twiddles for size h
  private readonly sin: Float64Array;
  private readonly cosN: Float64Array;     // twiddles for the split, size n
  private readonly sinN: Float64Array;
  private readonly zr: Float64Array;
  private readonly zi: Float64Array;

  constructor(n: number) {
    if (n < 4 || (n & (n - 1)) !== 0) throw new Error(`FFT size must be a power of two ≥ 4, got ${n}`);
    this.n = n;
    const h = n >> 1;
    this.h = h;
    this.rev = new Uint32Array(h);
    const bits = Math.log2(h);
    for (let i = 0; i < h; i++) {
      let r = 0;
      for (let b = 0; b < bits; b++) r |= ((i >> b) & 1) << (bits - 1 - b);
      this.rev[i] = r;
    }
    this.cos = new Float64Array(h >> 1 || 1);
    this.sin = new Float64Array(h >> 1 || 1);
    for (let i = 0; i < h >> 1; i++) {
      this.cos[i] = Math.cos((2 * Math.PI * i) / h);
      this.sin[i] = Math.sin((2 * Math.PI * i) / h);
    }
    this.cosN = new Float64Array(h + 1);
    this.sinN = new Float64Array(h + 1);
    for (let k = 0; k <= h; k++) {
      this.cosN[k] = Math.cos((2 * Math.PI * k) / n);
      this.sinN[k] = Math.sin((2 * Math.PI * k) / n);
    }
    this.zr = new Float64Array(h);
    this.zi = new Float64Array(h);
  }

  /** In-place complex FFT of size h on zr/zi; `sign` −1 forward, +1 inverse (unscaled). */
  private complex(sign: number): void {
    const h = this.h, zr = this.zr, zi = this.zi, rev = this.rev;
    for (let i = 0; i < h; i++) {
      const j = rev[i];
      if (j > i) {
        let t = zr[i]; zr[i] = zr[j]; zr[j] = t;
        t = zi[i]; zi[i] = zi[j]; zi[j] = t;
      }
    }
    const cos = this.cos, sin = this.sin;
    for (let size = 2; size <= h; size <<= 1) {
      const half = size >> 1, step = h / size;
      for (let k = 0; k < half; k++) {
        const wr = cos[k * step], wi = sign * sin[k * step];
        for (let a = k; a < h; a += size) {
          const b = a + half;
          const xr = zr[b], xi = zi[b];
          const tr = xr * wr - xi * wi;
          const ti = xr * wi + xi * wr;
          zr[b] = zr[a] - tr; zi[b] = zi[a] - ti;
          zr[a] += tr; zi[a] += ti;
        }
      }
    }
  }

  /**
   * Spectrum → one period. `re[k]`, `im[k]` for k = 0 … n/2 are the bins of
   * a real signal (k = 0 is DC, k = n/2 Nyquist); writes n samples to `out`
   * as the plain inverse DFT over all n bins (Hermitian mirror implied, no
   * 1/n), so for 0 < k < n/2 a bin contributes 2·re·cos(2πkt/n) −
   * 2·im·sin(2πkt/n). A harmonic a·sin(2πkt/n + φ) therefore goes in as
   * re = a·sin φ / 2, im = −a·cos φ / 2.
   */
  inverse(re: Float32Array | Float64Array, im: Float32Array | Float64Array, out: Float32Array): void {
    const h = this.h, zr = this.zr, zi = this.zi;
    const cosN = this.cosN, sinN = this.sinN;
    // undo the split: Z[k] = Fe[k] + i·Fo[k], with Fe, Fo from X[k], X[h−k]
    for (let k = 0; k < h; k++) {
      const ar = re[k], ai = im[k];
      const br = re[h - k], bi = -im[h - k];          // conj(X[h−k])
      const er = (ar + br) * 0.5, ei = (ai + bi) * 0.5;
      const dr = (ar - br) * 0.5, di = (ai - bi) * 0.5;
      // Fo = d · e^{+i2πk/n}
      const c = cosN[k], s = sinN[k];
      const or = dr * c - di * s, oi = dr * s + di * c;
      zr[k] = er - oi; zi[k] = ei + or;
    }
    this.complex(1);
    for (let t = 0; t < h; t++) { out[2 * t] = zr[t] * 2; out[2 * t + 1] = zi[t] * 2; }
  }

  /** One period → spectrum: re/im for k = 0 … n/2 (unscaled forward DFT). */
  forward(x: Float32Array, re: Float32Array | Float64Array, im: Float32Array | Float64Array): void {
    const h = this.h, zr = this.zr, zi = this.zi;
    for (let t = 0; t < h; t++) { zr[t] = x[2 * t]; zi[t] = x[2 * t + 1]; }
    this.complex(-1);
    const cosN = this.cosN, sinN = this.sinN;
    for (let k = 0; k <= h; k++) {
      const a = k % h, b = (h - k) % h;
      const fer = (zr[a] + zr[b]) * 0.5, fei = (zi[a] - zi[b]) * 0.5;
      const fdr = (zi[a] + zi[b]) * 0.5, fdi = -(zr[a] - zr[b]) * 0.5;   // Fo = (Z[k] − conj Z[h−k]) / 2i
      const c = cosN[k], s = -sinN[k];
      re[k] = fer + fdr * c - fdi * s;
      im[k] = fei + fdr * s + fdi * c;
    }
  }
}
