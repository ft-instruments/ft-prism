// Radix-2 FFT for real signals. C++ port of src/dsp/fft.ts: buffers are
// allocated in the constructor, nothing allocates afterwards.
//
// A real sequence of length n is transformed as a complex one of length n/2
// (even samples real, odd samples imaginary) plus a split step.
#pragma once

#include <vector>
#include <cmath>
#include <cstdint>
#include "Util.h"

namespace prism {

class RealFFT {
public:
  const int n;

  explicit RealFFT(int size) : n(size), h(size >> 1) {
    rev.resize((size_t)h);
    const int bits = (int)std::lround(std::log2((double)h));
    for (int i = 0; i < h; i++) {
      uint32_t r = 0;
      for (int b = 0; b < bits; b++) r |= (uint32_t)((i >> b) & 1) << (bits - 1 - b);
      rev[(size_t)i] = r;
    }
    const int q = (h >> 1) ? (h >> 1) : 1;
    cs.assign((size_t)q, 0.0); sn.assign((size_t)q, 0.0);
    for (int i = 0; i < h >> 1; i++) {
      cs[(size_t)i] = std::cos((2 * PI * i) / h);
      sn[(size_t)i] = std::sin((2 * PI * i) / h);
    }
    cosN.resize((size_t)h + 1); sinN.resize((size_t)h + 1);
    for (int k = 0; k <= h; k++) {
      cosN[(size_t)k] = std::cos((2 * PI * k) / n);
      sinN[(size_t)k] = std::sin((2 * PI * k) / n);
    }
    zr.assign((size_t)h, 0.0); zi.assign((size_t)h, 0.0);
  }

  /** Spectrum (re/im for k = 0 … n/2) → one period of n samples, unscaled; see fft.ts. */
  void inverse(const double* re, const double* im, float* out) {
    for (int k = 0; k < h; k++) {
      const double ar = re[k], ai = im[k];
      const double br = re[h - k], bi = -im[h - k];
      const double er = (ar + br) * 0.5, ei = (ai + bi) * 0.5;
      const double dr = (ar - br) * 0.5, di = (ai - bi) * 0.5;
      const double c = cosN[(size_t)k], s = sinN[(size_t)k];
      const double or_ = dr * c - di * s, oi = dr * s + di * c;
      zr[(size_t)k] = er - oi; zi[(size_t)k] = ei + or_;
    }
    complex(1);
    for (int t = 0; t < h; t++) { out[2 * t] = (float)(zr[(size_t)t] * 2); out[2 * t + 1] = (float)(zi[(size_t)t] * 2); }
  }

  /** One period → spectrum: re/im for k = 0 … n/2 (unscaled forward DFT). */
  void forward(const float* x, double* re, double* im) {
    for (int t = 0; t < h; t++) { zr[(size_t)t] = x[2 * t]; zi[(size_t)t] = x[2 * t + 1]; }
    complex(-1);
    for (int k = 0; k <= h; k++) {
      const int a = k % h, b = (h - k) % h;
      const double fer = (zr[(size_t)a] + zr[(size_t)b]) * 0.5, fei = (zi[(size_t)a] - zi[(size_t)b]) * 0.5;
      const double fdr = (zi[(size_t)a] + zi[(size_t)b]) * 0.5, fdi = -(zr[(size_t)a] - zr[(size_t)b]) * 0.5;
      const double c = cosN[(size_t)k], s = -sinN[(size_t)k];
      re[k] = fer + fdr * c - fdi * s;
      im[k] = fei + fdr * s + fdi * c;
    }
  }

private:
  void complex(double sign) {
    double* r = zr.data();
    double* i_ = zi.data();
    for (int i = 0; i < h; i++) {
      const int j = (int)rev[(size_t)i];
      if (j > i) {
        double t = r[i]; r[i] = r[j]; r[j] = t;
        t = i_[i]; i_[i] = i_[j]; i_[j] = t;
      }
    }
    for (int size = 2; size <= h; size <<= 1) {
      const int half = size >> 1, step = h / size;
      for (int k = 0; k < half; k++) {
        const double wr = cs[(size_t)(k * step)], wi = sign * sn[(size_t)(k * step)];
        for (int a = k; a < h; a += size) {
          const int b = a + half;
          const double xr = r[b], xi = i_[b];
          const double tr = xr * wr - xi * wi;
          const double ti = xr * wi + xi * wr;
          r[b] = r[a] - tr; i_[b] = i_[a] - ti;
          r[a] += tr; i_[a] += ti;
        }
      }
    }
  }

  const int h;
  std::vector<uint32_t> rev;
  std::vector<double> cs, sn, cosN, sinN, zr, zi;
};

} // namespace prism
