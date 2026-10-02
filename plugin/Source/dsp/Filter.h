// The voice filters: a clean state-variable filter (Zavalishin's TPT form),
// a four-pole low-pass from two of them, a vowel filter from three
// band-passes, and a feedback comb. Stereo. C++ port of src/dsp/filter.ts.
#pragma once

#include <vector>
#include "Util.h"

namespace prism {

/** One SVF stage, two channels. */
class Svf {
public:
  void clear() { s1L = s2L = s1R = s2R = 0; }

  void run(const float* inL, const float* inR, float* outL, float* outR, int n, double g0, double g1, double k, int mode,
           double gain = 1, bool add = false) {
    double sL1 = s1L, sL2 = s2L, sR1 = s1R, sR2 = s2R;
    const double dg = (g1 - g0) / n;
    double g = g0;
    for (int i = 0; i < n; i++) {
      g += dg;
      const double a1 = 1 / (1 + g * (g + k)), a2 = g * a1, a3 = g * a2;
      double v0 = inL[i];
      double v3 = v0 - sL2;
      double v1 = a1 * sL1 + a2 * v3;
      double v2 = sL2 + a2 * sL1 + a3 * v3;
      sL1 = 2 * v1 - sL1; sL2 = 2 * v2 - sL2;
      double y = mode == 0 ? v2 : mode == 1 ? v1 : mode == 2 ? v0 - k * v1 - v2 : v0 - k * v1;
      if (add) outL[i] = (float)(outL[i] + y * gain); else outL[i] = (float)(y * gain);
      v0 = inR[i];
      v3 = v0 - sR2;
      v1 = a1 * sR1 + a2 * v3;
      v2 = sR2 + a2 * sR1 + a3 * v3;
      sR1 = 2 * v1 - sR1; sR2 = 2 * v2 - sR2;
      y = mode == 0 ? v2 : mode == 1 ? v1 : mode == 2 ? v0 - k * v1 - v2 : v0 - k * v1;
      if (add) outR[i] = (float)(outR[i] + y * gain); else outR[i] = (float)(y * gain);
    }
    if (!(std::abs(sL1) < 1e6)) sL1 = 0;
    if (!(std::abs(sL2) < 1e6)) sL2 = 0;
    if (!(std::abs(sR1) < 1e6)) sR1 = 0;
    if (!(std::abs(sR2) < 1e6)) sR2 = 0;
    s1L = sL1; s2L = sL2; s1R = sR1; s2R = sR2;
  }

private:
  double s1L = 0, s2L = 0, s1R = 0, s2R = 0;
};

class VoiceFilter {
public:
  static constexpr int COMB_MAX = 4096;

  explicit VoiceFilter(double sampleRate) : combL(COMB_MAX, 0.f), combR(COMB_MAX, 0.f), fs(sampleRate) {}

  void clear() {
    a.clear(); b.clear(); c.clear();
    std::fill(combL.begin(), combL.end(), 0.f); std::fill(combR.begin(), combR.end(), 0.f);
    g[0] = g[1] = g[2] = -1; combD = -1;
  }

  /** In place on L/R[0..n). `cut` Hz, `res` 0..1, `drive` 0..1. */
  void process(float* L, float* R, int n, int type, double cut, double res, double drive) {
    if (type == F_OFF) return;
    if (type != lastType) { clear(); lastType = type; }
    if (drive > 0) {
      const double pre = 1 + drive * 6, post = 1 / (1 + drive * 1.5);
      for (int i = 0; i < n; i++) { L[i] = (float)(tanhf_(L[i] * pre) * post); R[i] = (float)(tanhf_(R[i] * pre) * post); }
    }
    res = std::min(1.0, std::max(0.0, res));
    switch (type) {
      case F_LP12: case F_BP: case F_HP: case F_NOTCH: {
        const double g1 = gOf(cut), g0 = g[0] < 0 ? g1 : g[0];
        g[0] = g1;
        const double k = 2 - 1.96 * res;
        const int mode = type == F_LP12 ? 0 : type == F_BP ? 1 : type == F_HP ? 2 : 3;
        a.run(L, R, L, R, n, g0, g1, k, mode, type == F_BP ? std::sqrt(k / 2) * 1.4 : 1);
        break;
      }
      case F_LP24: {
        const double g1 = gOf(cut), g0 = g[0] < 0 ? g1 : g[0];
        g[0] = g1;
        a.run(L, R, L, R, n, g0, g1, 1.85 - res * 0.6, 0);
        b.run(L, R, L, R, n, g0, g1, 1.414 - 1.39 * res, 0, 1 + res * 0.4);
        break;
      }
      case F_VOWEL: {
        static constexpr double VOWELS[5][3] = { { 730, 1090, 2440 }, { 530, 1840, 2480 }, { 270, 2290, 3010 }, { 570, 840, 2410 }, { 300, 870, 2240 } };
        static constexpr double VOWEL_GAIN[3] = { 1, 0.7, 0.45 };
        const double pos = std::min(1.0, std::max(0.0, std::log(cut / 20) / std::log(1000.0))) * 4;
        const int vi = (int)std::min(3.0, std::floor(pos));
        const double u = pos - vi;
        const double k = 0.5 - res * 0.42;
        std::copy(L, L + n, tL); std::copy(R, R + n, tR);
        std::fill(L, L + n, 0.f); std::fill(R, R + n, 0.f);
        Svf* stages[3] = { &a, &b, &c };
        for (int j = 0; j < 3; j++) {
          const double f = VOWELS[vi][j] + (VOWELS[vi + 1][j] - VOWELS[vi][j]) * u;
          const double g1 = gOf(f), g0 = g[j] < 0 ? g1 : g[j];
          g[j] = g1;
          stages[j]->run(tL, tR, L, R, n, g0, g1, k, 1, VOWEL_GAIN[j] * k * 2.2, true);
        }
        break;
      }
      case F_COMBP: case F_COMBN: {
        const double target = std::min((double)COMB_MAX - 2, std::max(2.0, fs / std::max(20.0, cut)));
        const double d0 = combD < 0 ? target : combD;
        combD = target;
        const double fb = (0.5 + res * 0.47) * (type == F_COMBN ? -1 : 1);
        float* bl = combL.data(); float* br = combR.data();
        int w = combIdx;
        const double norm = 1 - std::abs(fb) * 0.6;
        for (int i = 0; i < n; i++) {
          const double d = d0 + (target - d0) * ((double)i / n);
          double r = w - d; if (r < 0) r += COMB_MAX;
          const int i0 = (int)r, i1 = (i0 + 1) % COMB_MAX;
          const double fr = r - i0;
          const double yl = bl[i0] + ((double)bl[i1] - bl[i0]) * fr;
          const double yr = br[i0] + ((double)br[i1] - br[i0]) * fr;
          const double ol = L[i] + fb * yl, or_ = R[i] + fb * yr;
          bl[w] = (float)tanhf_(ol); br[w] = (float)tanhf_(or_);
          L[i] = (float)(ol * norm); R[i] = (float)(or_ * norm);
          if (++w >= COMB_MAX) w = 0;
        }
        combIdx = w;
        break;
      }
      default: break;
    }
  }

private:
  double gOf(double hz) const {
    const double f = std::min(hz, fs * 0.45);
    return std::tan(PI * f / fs);
  }

  Svf a, b, c;
  double g[3] = { -1, -1, -1 };
  std::vector<float> combL, combR;
  int combIdx = 0;
  double combD = -1;
  float tL[64] {}, tR[64] {};
  int lastType = -1;
  double fs;
};

} // namespace prism
