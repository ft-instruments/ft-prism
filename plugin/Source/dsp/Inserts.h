// Insert effects inside the voice (A before filter 1, B after the filters),
// and the Hilbert transformer the shifter and the delay's spiral share.
// C++ port of src/dsp/inserts.ts.
#pragma once

#include <vector>
#include "Util.h"

namespace prism {

/** Analytic signal of one channel: tick() leaves the in-phase part in `i`, quadrature in `q`. */
class Hilbert {
public:
  double i = 0, q = 0;

  void clear() {
    std::fill(xa, xa + 8, 0.0); std::fill(ya, ya + 8, 0.0); std::fill(xb, xb + 8, 0.0); std::fill(yb, yb + 8, 0.0);
    delayed = 0; i = q = 0;
  }

  void tick(double x) {
    static constexpr double HA0[4] = { 0.6923878, 0.9360654322959, 0.9882295226860, 0.9987488452737 };
    static constexpr double HB0[4] = { 0.4021921162426, 0.8561710882420, 0.9722909545651, 0.9952884791278 };
    double a = x, b = x;
    for (int s = 0; s < 4; s++) {
      const int j = s * 2;
      const double ha = HA0[s] * HA0[s], hb = HB0[s] * HB0[s];
      const double y = ha * (a + ya[j + 1]) - xa[j + 1];
      xa[j + 1] = xa[j]; xa[j] = a; ya[j + 1] = ya[j]; ya[j] = y; a = y;
      const double z = hb * (b + yb[j + 1]) - xb[j + 1];
      xb[j + 1] = xb[j]; xb[j] = b; yb[j + 1] = yb[j]; yb[j] = z; b = z;
    }
    i = delayed; delayed = a;
    q = b;
  }

private:
  double xa[8] {}, ya[8] {}, xb[8] {}, yb[8] {};
  double delayed = 0;
};

class Insert {
public:
  static constexpr int COMB_MAX = 4096;

  explicit Insert(double sampleRate) : bl(COMB_MAX, 0.f), br(COMB_MAX, 0.f), fs(sampleRate) {}

  void clear() {
    hl.clear(); hr.clear(); osc = 0;
    holdL = holdR = 0; holdN = 0;
    std::fill(bl.begin(), bl.end(), 0.f); std::fill(br.begin(), br.end(), 0.f);
  }

  /** In place on L/R[0..n). `f0` is the voice's pitch in Hz. */
  void process(float* L, float* R, int n, int type, double a, double b, double mix, double f0) {
    if (type == I_OFF || mix <= 0) return;
    if (type != lastType) { clear(); lastType = type; }
    a = std::min(1.0, std::max(0.0, a));
    const double dry = 1 - mix;
    switch (type) {
      case I_SHIFT: {
        const double s = a * 2 - 1;
        const double fixed = jsSign(s) * s * s * 1500;
        const double tracked = s * 2 * f0;
        const double hz = fixed * (1 - std::abs(b)) + tracked * std::abs(b);
        const double inc = hz / fs;
        double ph = osc;
        for (int i = 0; i < n; i++) {
          const double c = std::cos(ph * 6.283185307), sn = std::sin(ph * 6.283185307);
          hl.tick(L[i]); hr.tick(R[i]);
          const double yl = hl.i * c + hl.q * sn;
          const double yr = hr.i * c + hr.q * sn;
          L[i] = (float)(L[i] * dry + yl * mix); R[i] = (float)(R[i] * dry + yr * mix);
          ph += inc; ph -= std::floor(ph);
        }
        osc = ph;
        break;
      }
      case I_RING: {
        const double ratio = std::pow(2.0, a * 5 - 2) * std::pow(2.0, b * 0.5);
        const double inc = std::min(0.49, (f0 * ratio) / fs);
        double ph = osc;
        for (int i = 0; i < n; i++) {
          const double m = std::sin(ph * 6.283185307);
          L[i] = (float)(L[i] * dry + L[i] * m * mix); R[i] = (float)(R[i] * dry + R[i] * m * mix);
          ph += inc; if (ph >= 1) ph -= 1;
        }
        osc = ph;
        break;
      }
      case I_CRUSH: {
        const double hold = 1 + jsRound(a * a * 47);
        const double bits = jsRound(16 - (b + 1) * 7);
        const double q = std::pow(2.0, bits - 1);
        for (int i = 0; i < n; i++) {
          if (--holdN <= 0) { holdN = hold; holdL = jsRound(L[i] * q) / q; holdR = jsRound(R[i] * q) / q; }
          L[i] = (float)(L[i] * dry + holdL * mix); R[i] = (float)(R[i] * dry + holdR * mix);
        }
        break;
      }
      case I_FOLD: {
        const double g = 1 + a * 10, bias = b * 0.6;
        for (int i = 0; i < n; i++) {
          const double yl = std::sin(1.5707963 * g * (L[i] + bias)), yr = std::sin(1.5707963 * g * (R[i] + bias));
          L[i] = (float)(L[i] * dry + yl * mix * 0.8); R[i] = (float)(R[i] * dry + yr * mix * 0.8);
        }
        break;
      }
      case I_SHAPE: {
        const double g = 1 + a * 20, off = b * 0.4, c = tanhf_(off), norm = 1 / tanhf_(std::min(3.0, g * 0.6));
        for (int i = 0; i < n; i++) {
          L[i] = (float)(L[i] * dry + (tanhf_(L[i] * g + off) - c) * norm * 0.8 * mix);
          R[i] = (float)(R[i] * dry + (tanhf_(R[i] * g + off) - c) * norm * 0.8 * mix);
        }
        break;
      }
      case I_PARA: {
        const double g = 1 + a * 6, ev = b * 0.5;
        auto sh = [g, ev](double x) { double z = x * g; z = z > 1 ? 1 : z < -1 ? -1 : z; return z * (2 - std::abs(z)) + ev * z * z; };
        for (int i = 0; i < n; i++) {
          L[i] = (float)(L[i] * dry + sh(L[i]) * 0.8 * mix); R[i] = (float)(R[i] * dry + sh(R[i]) * 0.8 * mix);
        }
        break;
      }
      case I_CLIP: {
        const double g = 1 + a * 30, off = b * 0.5;
        for (int i = 0; i < n; i++) {
          double yl = L[i] * g + off, yr = R[i] * g + off;
          yl = yl > 1 ? 1 : yl < -1 ? -1 : yl; yr = yr > 1 ? 1 : yr < -1 ? -1 : yr;
          L[i] = (float)(L[i] * dry + (yl - off * 0.5) * 0.7 * mix); R[i] = (float)(R[i] * dry + (yr - off * 0.5) * 0.7 * mix);
        }
        break;
      }
      case I_COMB: {
        const double hz = f0 * std::pow(2.0, a * 3 - 1);
        const double d = std::min((double)COMB_MAX - 2, std::max(2.0, fs / hz));
        const double fb = b * 0.95;
        float* l = bl.data(); float* r_ = br.data();
        int w = wIdx;
        for (int i = 0; i < n; i++) {
          double r = w - d; if (r < 0) r += COMB_MAX;
          const int i0 = (int)r, i1 = (i0 + 1) % COMB_MAX;
          const double fr = r - i0;
          const double yl = l[i0] + ((double)l[i1] - l[i0]) * fr, yr = r_[i0] + ((double)r_[i1] - r_[i0]) * fr;
          const double ol = L[i] + fb * yl, or_ = R[i] + fb * yr;
          l[w] = (float)tanhf_(ol); r_[w] = (float)tanhf_(or_);
          L[i] = (float)(L[i] * dry + (ol * 0.6) * mix); R[i] = (float)(R[i] * dry + (or_ * 0.6) * mix);
          if (++w >= COMB_MAX) w = 0;
        }
        wIdx = w;
        break;
      }
      default: break;
    }
  }

private:
  Hilbert hl, hr;
  double osc = 0;
  double holdL = 0, holdR = 0, holdN = 0;
  std::vector<float> bl, br;
  int wIdx = 0;
  int lastType = -1;
  double fs;
};

} // namespace prism
