// The ice hall: an 8-line feedback delay network with modulated reads,
// damping, input diffusion, pre-delay and an optional octave-up shimmer in
// the loop. C++ port of src/dsp/reverb.ts.
#pragma once

#include <vector>
#include "Util.h"

namespace prism {

class PitchUp {
public:
  explicit PitchUp(double sampleRate) : W((int)jsRound(sampleRate * 0.045)), buf((size_t)W + 4, 0.f) {}
  void clear() { std::fill(buf.begin(), buf.end(), 0.f); }
  double tick(double x) {
    const int len = (int)buf.size();
    buf[(size_t)idx] = (float)x;
    const double p = phase;
    double p2 = p + 0.5; if (p2 >= 1) p2 -= 1;
    const double a = readDelay(buf.data(), len, idx, W * (1 - p)) * std::sin(PI * p);
    const double b = readDelay(buf.data(), len, idx, W * (1 - p2)) * std::sin(PI * p2);
    phase += 1.0 / W; if (phase >= 1) phase -= 1;
    if (++idx >= len) idx = 0;
    return a + b;
  }
private:
  int W;
  std::vector<float> buf;
  int idx = 0;
  double phase = 0;
};

class Reverb {
public:
  static constexpr int N = 8;

  explicit Reverb(double sampleRate) : shimmer(sampleRate), fs(sampleRate) {
    const double ratio = sampleRate / 48000;
    for (int i = 0; i < N; i++) {
      lines[i].assign((size_t)std::ceil(BASE[i] * ratio * MAX_SCALE + MOD_DEPTH * 2 + 8), 0.f);
      modPhase[i] = (float)((double)i / N);
    }
    for (int i = 0; i < 4; i++) ap[i].assign((size_t)std::max(2.0, jsRound(AP_MS[i] * 1e-3 * sampleRate)), 0.f);
    pre.assign((size_t)jsRound(0.024 * sampleRate), 0.f);
    setSize(0.6, 3);
  }

  void clear() {
    for (auto& l : lines) std::fill(l.begin(), l.end(), 0.f);
    for (auto& a : ap) std::fill(a.begin(), a.end(), 0.f);
    std::fill(pre.begin(), pre.end(), 0.f);
    std::fill(lp, lp + N, 0.f); std::fill(hp, hp + N, 0.f);
    shimmer.clear(); shimLp = 0;
  }

  void process(float* L, float* R, int n, double size, double decay, double tone, double shim, double mix) {
    if (mix <= 0) return;
    setSize(size, decay);
    const double lpA = 1 - std::exp(-2 * PI * (2000 + tone * 14000) / fs);
    const double hpA = 1 - std::exp(-2 * PI * 70 / fs);
    const double shimLpA = 1 - std::exp(-2 * PI * 3500 / fs);
    const double twoOverN = 2.0 / N;
    const double wet = mix * 0.6, dry = 1 - mix * 0.35;
    const int preLen = (int)pre.size();
    const double shimGain = shim * 0.45;
    for (int i = 0; i < n; i++) {
      const double xl = L[i], xr = R[i];
      const double inMono = (xl + xr) * 0.5;
      const double preOut = pre[(size_t)preIdx]; pre[(size_t)preIdx] = (float)inMono; if (++preIdx >= preLen) preIdx = 0;
      double x = allpass(allpass(allpass(allpass(preOut, 0), 1), 2), 3);
      double sum = 0, outL = 0, outR = 0;
      for (int j = 0; j < N; j++) {
        double ph = modPhase[j] + MOD_RATE[j] / fs; if (ph >= 1) ph -= 1; modPhase[j] = (float)ph;
        const double d = lengths[j] + std::sin(6.283185307 * ph) * MOD_DEPTH;
        const double v = readDelay(lines[j].data(), (int)lines[j].size(), idx[j], d);
        tmp[j] = (float)v; sum += v;
        if (j & 1) outR += (j & 2) ? v : -v; else outL += (j & 2) ? v : -v;
      }
      if (shimGain > 0) {
        const double sh = shimmer.tick((outL + outR) * 0.25);
        shimLp += (sh - shimLp) * shimLpA;
        x += tanhf_(shimLp * shimGain);
      }
      const double s = sum * twoOverN;
      for (int j = 0; j < N; j++) {
        double v = (tmp[j] - s) * gains[j] + ((j & 1) ? -x : x);
        lp[j] = (float)(lp[j] + (v - lp[j]) * lpA);
        hp[j] = (float)(hp[j] + ((double)lp[j] - hp[j]) * hpA);
        v = (double)lp[j] - hp[j];
        auto& line = lines[j];
        line[(size_t)idx[j]] = (float)v;
        if (++idx[j] >= (int)line.size()) idx[j] = 0;
      }
      L[i] = (float)(xl * dry + outL * wet);
      R[i] = (float)(xr * dry + outR * wet);
    }
  }

private:
  static constexpr double BASE[N] = { 1499, 1889, 2311, 2707, 3169, 3559, 4003, 4519 };
  static constexpr double MOD_RATE[N] = { 0.11, 0.17, 0.23, 0.31, 0.13, 0.19, 0.29, 0.37 };
  static constexpr double AP_MS[4] = { 3.1, 5.3, 8.7, 13.9 };
  static constexpr double AP_G = 0.62;
  static constexpr double MAX_SCALE = 1.45;
  static constexpr double MOD_DEPTH = 9;

  void setSize(double size, double decay) {
    if (size == curSize && decay == curDecay) return;
    curSize = size; curDecay = decay;
    const double scale = (0.45 + size) * fs / 48000;
    for (int i = 0; i < N; i++) {
      lengths[i] = BASE[i] * scale;
      gains[i] = (float)std::pow(10.0, (-3 * lengths[i]) / (decay * fs));
    }
  }

  double allpass(double x, int i) {
    auto& buf = ap[i];
    int id = apIdx[i];
    const double d = buf[(size_t)id];
    const double v = x - AP_G * d;
    buf[(size_t)id] = (float)v;
    if (++id >= (int)buf.size()) id = 0;
    apIdx[i] = id;
    return d + AP_G * v;
  }

  std::vector<float> lines[N];
  int idx[N] {};
  double lengths[N] {};
  float gains[N] {}, lp[N] {}, hp[N] {}, modPhase[N] {}, tmp[N] {};
  std::vector<float> ap[4];
  int apIdx[4] {};
  std::vector<float> pre;
  int preIdx = 0;
  PitchUp shimmer;
  double shimLp = 0;
  double fs;
  double curSize = -1, curDecay = -1;
};

} // namespace prism
