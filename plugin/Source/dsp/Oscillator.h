// The spectral oscillator. C++ port of src/dsp/oscillator.ts (minus
// preview(), which only the UI uses).
//
// Whenever what it should sound like changes, it re-synthesises one cycle
// from the table's spectra (read at the position, warped, band-limited for
// the highest unison copy) with one inverse FFT, and crossfades to it over
// the next block. Stretch plays its partials additively instead.
//
// The TS keeps its scratch buffers at module level (the worklet is one
// thread). A plugin can run several instances on several threads, so here
// the scratch lives in an OscScratch that each engine owns and hands to its
// oscillators.
#pragma once

#include <memory>
#include "Tables.h"

namespace prism {

constexpr int MAX_UNISON = 16;
constexpr int OSC_MAX_N = 2048;
constexpr int MAX_PARTIALS = 64;

/** Sine lookup for the additive partials (shared, read-only). */
constexpr int SIN_N = 4096;
inline const float* sinTable() {
  static const std::vector<float> t = [] {
    std::vector<float> v(SIN_N + 1);
    for (int i = 0; i <= SIN_N; i++) v[(size_t)i] = (float)std::sin((TAU * i) / SIN_N);
    return v;
  }();
  return t.data();
}

/** One engine's working buffers for the oscillators. */
struct OscScratch {
  RealFFT f256 { 256 }, f512 { 512 }, f1024 { 1024 }, f2048 { 2048 };
  double XS[HARMONICS + 2] {}, XC[HARMONICS + 2] {};
  double A[HARMONICS + 2] {}, A2[HARMONICS + 2] {}, S2[HARMONICS + 2] {}, C2[HARMONICS + 2] {};
  double RE[OSC_MAX_N / 2 + 1] {}, IM[OSC_MAX_N / 2 + 1] {};
  float TD[OSC_MAX_N] {}, TD2[OSC_MAX_N] {};

  RealFFT& fft(int n) { return n <= 256 ? f256 : n <= 512 ? f512 : n <= 1024 ? f1024 : f2048; }
};

/** How many harmonics fit: on a ladder of quarter-octaves so small pitch moves don't rebuild. */
inline int bandLimit(double fs, double fMax) {
  const double h = std::min((double)HARMONICS, std::max(1.0, (0.46 * fs) / std::max(1.0, fMax)));
  const double step = std::floor(std::log2(h) * 4) / 4;
  return (int)std::max(1.0, std::min((double)HARMONICS, std::floor(std::pow(2.0, step))));
}

inline int nextPow2(int x) { int n = 1; while (n < x) n <<= 1; return n; }

/** What the oscillator should sound like this block. */
struct Shape {
  const Wavetable* table = nullptr;
  int tableId = 0;
  double pos = 0;
  bool spectral = true;
  int warp = 0;
  double amt = 0;
  int hb = 1;
  double f0 = 100;
};

class SpectralOsc {
public:
  double phase[MAX_UNISON] {};
  bool stretching = false;

  explicit SpectralOsc(OscScratch& scratch) : sc(scratch), bufA(OSC_MAX_N + 1, 0.f), bufB(OSC_MAX_N + 1, 0.f) {
    cur = bufA.data(); prev = bufB.data();
  }

  /** Start a note: copies' phases from 0 (punchy) to random (lush). */
  void reset(double rand, Rng& rng) {
    for (int c = 0; c < MAX_UNISON; c++) {
      const double r = c == 0 ? 0 : rng.next();
      phase[c] = rand * r;
      for (int j = 0; j < MAX_PARTIALS; j++) pPhase[c * MAX_PARTIALS + j] = rand * rng.next();
    }
    fading = false;
  }

  /** Rebuild the cycle if the shape moved; returns true if it did. */
  bool update(const Shape& s) {
    const bool stretch = s.warp == W_STRETCH;
    double q = 0;
    if (s.warp == W_FORMANT) q = s.f0 / (s.table->formantHz * std::pow(2.0, s.amt * 2));
    if (built && s.tableId == sTable && s.warp == sWarp && s.spectral == sSpectral && s.hb == sHb
        && std::abs(s.pos - sPos) < 1e-4 && std::abs(s.amt - sAmt) < 1e-4
        && (s.warp != W_FORMANT || std::abs(q / sQ - 1) < 0.004)) return false;
    const bool first = !built;
    built = true;
    sTable = s.tableId; sPos = s.pos; sSpectral = s.spectral; sWarp = s.warp; sAmt = s.amt; sHb = s.hb; sQ = q;
    stretching = stretch;
    readFrame(*s.table, s.pos, s.spectral, s.warp == W_SKEW ? s.amt : 0, s.hb);
    applyWarp(s.warp, s.amt, s.hb, q);
    taper(s.hb);
    if (stretch) {
      std::copy(pAmp, pAmp + MAX_PARTIALS, pAmpPrev);
      const int np = std::min(MAX_PARTIALS, s.hb);
      const double st = s.amt * 0.25;
      for (int j = 0; j < MAX_PARTIALS; j++) {
        const int k = j + 1;
        pAmp[j] = j < np ? (float)std::hypot(sc.XS[k], sc.XC[k]) : 0.f;
        pRatio[j] = (float)std::pow((double)k, 1 + st);
      }
      nPartials = np;
      if (first) std::copy(pAmp, pAmp + MAX_PARTIALS, pAmpPrev);
      fading = !first;
      return true;
    }
    const int n = std::min(OSC_MAX_N, std::max(256, nextPow2(s.hb * 4)));
    const bool timeWarp = s.warp == W_BEND || s.warp == W_SYNC;
    float* tmp = prev;
    prev = cur; nPrev = nCur;
    cur = tmp; nCur = n;
    if (timeWarp) {
      const int nw = std::min(OSC_MAX_N, std::max(512, nextPow2(s.hb * 8)));
      synth(nw, s.hb, sc.TD);
      warpTime(s.warp, s.amt, sc.TD, sc.TD2, nw);
      sc.fft(nw).forward(sc.TD2, sc.RE, sc.IM);
      for (int k = 0; k <= nw / 2; k++) {
        if (k == 0 || k > s.hb) { sc.RE[k] = 0; sc.IM[k] = 0; continue; }
        sc.RE[k] /= nw; sc.IM[k] /= nw;
      }
      const int t0 = (int)std::floor(s.hb * 0.75);
      for (int k = t0 + 1; k <= s.hb; k++) {
        const double w = 0.5 + 0.5 * std::cos(PI * (k - t0) / (s.hb - t0 + 1));
        sc.RE[k] *= w; sc.IM[k] *= w;
      }
      sc.fft(n).inverse(sc.RE, sc.IM, cur);
    } else {
      synth(n, s.hb, cur);
    }
    cur[n] = cur[0];
    if (first) { std::copy(cur, cur + OSC_MAX_N + 1, prev); nPrev = n; }
    fading = !first;
    return true;
  }

  /** Add `count` samples into L/R from `off`; see oscillator.ts. */
  void render(float* L, float* R, int off, int count, double inc0, double inc1, int copies,
              const double* ratio, const float* gl, const float* gr, const float* pm, double pmAmt) {
    if (stretching) { renderPartials(L, R, off, count, inc0, inc1, copies, ratio, gl, gr); return; }
    const int nc = nCur, np = nPrev;
    const double dInc = (inc1 - inc0) / count;
    const bool usePm = pm != nullptr && pmAmt > 0;
    for (int c = 0; c < copies; c++) {
      const double r = ratio[c], gL = gl[c], gR = gr[c];
      double ph = phase[c];
      double inc = inc0 * r;
      const double di = dInc * r;
      for (int i = 0; i < count; i++) {
        double p = ph;
        if (usePm) { p += pmAmt * pm[i]; p -= std::floor(p); }
        double x = nc * p;
        int i0 = (int)x;
        double v = cur[i0] + ((double)cur[i0 + 1] - cur[i0]) * (x - i0);
        if (fading) {
          x = np * p; i0 = (int)x;
          const double u = prev[i0] + ((double)prev[i0 + 1] - prev[i0]) * (x - i0);
          const double w = (double)(i + 1) / count;
          v = u + (v - u) * w;
        }
        L[off + i] = (float)(L[off + i] + v * gL); R[off + i] = (float)(R[off + i] + v * gR);
        ph += inc; if (ph >= 1) ph -= 1;
        inc += di;
      }
      phase[c] = ph;
    }
    fading = false;
  }

private:
  void renderPartials(float* L, float* R, int off, int count, double inc0, double inc1, int copies,
                      const double* ratio, const float* gl, const float* gr) {
    const float* SIN = sinTable();
    const int np = nPartials;
    const double dInc = (inc1 - inc0) / count;
    for (int c = 0; c < copies; c++) {
      const double r = ratio[c], gL = gl[c], gR = gr[c];
      for (int j = 0; j < np; j++) {
        const double kr = pRatio[j] * r;
        if (inc1 * kr >= 0.47 || inc0 * kr >= 0.47) continue;
        const double a1 = pAmp[j], a0 = fading ? (double)pAmpPrev[j] : a1;
        if (a0 < 1e-5 && a1 < 1e-5) continue;
        const double da = (a1 - a0) / count;
        double a = a0;
        double ph = pPhase[c * MAX_PARTIALS + j];
        double inc = inc0 * kr;
        const double di = dInc * kr;
        for (int i = 0; i < count; i++) {
          const double x = ph * SIN_N;
          const int i0 = (int)x;
          const double v = (SIN[i0] + ((double)SIN[i0 + 1] - SIN[i0]) * (x - i0)) * a;
          L[off + i] = (float)(L[off + i] + v * gL); R[off + i] = (float)(R[off + i] + v * gR);
          ph += inc; if (ph >= 1) ph -= 1;
          inc += di; a += da;
        }
        pPhase[c * MAX_PARTIALS + j] = ph;
      }
      double ph = phase[c] + (inc0 + inc1) * 0.5 * r * count;
      ph -= std::floor(ph);
      phase[c] = ph;
    }
    fading = false;
  }

  // ---------------------------------------------------------- spectrum

  void readFrame(const Wavetable& t, double pos, bool spectral, double skew, int hb) {
    const float* amp = t.amp.data(); const float* ph = t.phase.data();
    const float* xs = t.xs.data(); const float* xc = t.xc.data();
    double* XS = sc.XS; double* XC = sc.XC;
    const int H = HARMONICS;
    const double fpos = std::min(1.0, std::max(0.0, pos)) * (FRAMES - 1);
    for (int k = 1; k <= hb; k++) {
      double f = fpos;
      if (skew != 0) {
        f += skew * ((double)(k - 1) / std::max(1, hb - 1)) * (FRAMES - 1);
        f = f < 0 ? 0 : f > FRAMES - 1 ? FRAMES - 1 : f;
      }
      const int i0 = std::min(FRAMES - 2, (int)f);
      const double u = f - i0;
      const int j0 = i0 * H + k - 1, j1 = j0 + H;
      if (spectral) {
        const double a0 = amp[j0], a1 = amp[j1];
        const double p0 = ph[j0], p1 = ph[j1];
        const double a = a0 + (a1 - a0) * u;
        if (p0 == p1) {
          const double r = a0 > 1e-12 ? a / a0 : 0, r1 = a1 > 1e-12 ? a / a1 : 0;
          if (a0 > 1e-12) { XS[k] = xs[j0] * r; XC[k] = xc[j0] * r; }
          else { XS[k] = xs[j1] * r1; XC[k] = xc[j1] * r1; }
        } else {
          double dp = p1 - p0;
          dp -= TAU * jsRound(dp / TAU);
          const double p = p0 + dp * u;
          XS[k] = a * std::sin(p); XC[k] = a * std::cos(p);
        }
      } else {
        XS[k] = xs[j0] + ((double)xs[j1] - xs[j0]) * u;
        XC[k] = xc[j0] + ((double)xc[j1] - xc[j0]) * u;
      }
    }
    XS[0] = 0; XC[0] = 0;
    for (int k = hb + 1; k <= HARMONICS + 1; k++) { XS[k] = 0; XC[k] = 0; }
  }

  void amplitudes(int n) {
    sc.A[0] = 0;
    for (int k = 1; k <= n; k++) sc.A[k] = std::hypot(sc.XS[k], sc.XC[k]);
    sc.A[n + 1] = 0;
  }

  void setFrom(int k, double a, int j) {
    const double aj = sc.A[j];
    if (aj > 1e-12) { sc.S2[k] = sc.XS[j] * (a / aj); sc.C2[k] = sc.XC[j] * (a / aj); }
    else { sc.S2[k] = 0; sc.C2[k] = -a; }
  }

  double ampAt(double x, int hb) const {
    const double* A = sc.A;
    if (x < 1) return x <= 0 ? 0 : A[1] * x;
    const int i = (int)x;
    if (i >= hb) return i == hb ? A[hb] * (1 - (x - i)) : 0;
    return A[i] + (A[i + 1] - A[i]) * (x - i);
  }

  void copyBack(int hb) { for (int k = 1; k <= hb; k++) { sc.XS[k] = sc.S2[k]; sc.XC[k] = sc.C2[k]; } }

  void applyWarp(int warp, double amt, int hb, double q) {
    double* XS = sc.XS; double* XC = sc.XC;
    switch (warp) {
      case W_FILTER: {
        const double a = std::max(0.0, amt);
        if (a <= 0) return;
        const double c = std::pow(2.0, (1 - a) * 9);
        for (int k = 1; k <= hb; k++) { const double g = 1 / std::sqrt(1 + std::pow(k / c, 12)); XS[k] *= g; XC[k] *= g; }
        return;
      }
      case W_FORMANT: {
        amplitudes(HARMONICS);
        for (int k = 1; k <= hb; k++) {
          const double x = k * q;
          setFrom(k, ampAt(x, HARMONICS), (int)std::max(1.0, std::min((double)HARMONICS, jsRound(x))));
        }
        copyBack(hb);
        return;
      }
      case W_SHIFT: {
        amplitudes(hb);
        const double d = amt * 24;
        for (int k = 1; k <= hb; k++) {
          const double x = k - d;
          setFrom(k, ampAt(x, hb), (int)std::max(1.0, std::min((double)hb, jsRound(x))));
        }
        copyBack(hb);
        return;
      }
      case W_SMEAR: {
        const int r = (int)jsRound(std::abs(amt) * 16);
        if (r < 1) return;
        amplitudes(hb);
        double acc = 0;
        sc.A2[0] = 0;
        for (int k = 1; k <= hb; k++) { acc += sc.A[k]; sc.A2[k] = acc; }
        for (int k = 1; k <= hb; k++) {
          const int lo = std::max(1, k - r), hi = std::min(hb, k + r);
          setFrom(k, (sc.A2[hi] - sc.A2[lo - 1]) / (hi - lo + 1) * (1 + r * 0.08), k);
        }
        copyBack(hb);
        return;
      }
      case W_ODDEVEN: {
        if (amt > 0) for (int k = 2; k <= hb; k += 2) { XS[k] *= 1 - amt; XC[k] *= 1 - amt; }
        else if (amt < 0) for (int k = 3; k <= hb; k += 2) { XS[k] *= 1 + amt; XC[k] *= 1 + amt; }
        return;
      }
      default: return;   // none, skew, stretch, bend, sync
    }
  }

  void taper(int hb) {
    if (hb < 8) return;
    const int t0 = (int)std::floor(hb * 0.75);
    for (int k = t0 + 1; k <= hb; k++) {
      const double w = 0.5 + 0.5 * std::cos(PI * (k - t0) / (hb - t0 + 1));
      sc.XS[k] *= w; sc.XC[k] *= w;
    }
  }

  void synth(int n, int hb, float* out) {
    const int h = n / 2;
    std::fill(sc.RE, sc.RE + h + 1, 0.0); std::fill(sc.IM, sc.IM + h + 1, 0.0);
    const int top = std::min(hb, h - 1);
    for (int k = 1; k <= top; k++) { sc.RE[k] = sc.XS[k] * 0.5; sc.IM[k] = -sc.XC[k] * 0.5; }
    sc.fft(n).inverse(sc.RE, sc.IM, out);
  }

  static constexpr int BEND_STEP = 8;

  static void warpTime(int warp, double amt, const float* src, float* dst, int n) {
    if (warp == W_BEND) {
      const double e = std::pow(2.0, amt * 2.5);
      double prv = 0;
      for (int i = 0; i < n; i += BEND_STEP) {
        const double next = std::pow((double)(i + BEND_STEP) / n, e) * n;
        for (int j = 0; j < BEND_STEP; j++) {
          const double p = prv + (next - prv) * ((double)j / BEND_STEP);
          const int i0 = (int)p;
          const double u = p - i0;
          const double a = src[i0 % n];
          dst[i + j] = (float)(a + (src[(i0 + 1) % n] - a) * u);
        }
        prv = next;
      }
    } else {
      const double r = 1 + std::abs(amt) * 7;
      for (int i = 0; i < n; i++) {
        double p = ((double)i / n) * r; p -= std::floor(p); p *= n;
        const int i0 = (int)p;
        const double u = p - i0;
        dst[i] = (float)(src[i0] + ((double)src[(i0 + 1) % n] - src[i0]) * u);
      }
    }
  }

  OscScratch& sc;
  std::vector<float> bufA, bufB;
  float* cur;
  float* prev;
  int nCur = 256, nPrev = 256;
  bool fading = false, built = false;
  int sTable = -1, sWarp = -1, sHb = 0;
  double sPos = -1, sAmt = 0, sQ = 0;
  bool sSpectral = false;
  float pAmp[MAX_PARTIALS] {}, pAmpPrev[MAX_PARTIALS] {}, pRatio[MAX_PARTIALS] {};
  double pPhase[MAX_UNISON * MAX_PARTIALS] {};
  int nPartials = 0;
};

} // namespace prism
