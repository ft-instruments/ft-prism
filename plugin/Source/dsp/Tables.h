// The wavetables, stored as spectra. C++ port of src/dsp/tables.ts.
//
// Every table is FRAMES frames of HARMONICS harmonics (amplitude and phase,
// for a·sin(2πkt + φ)), built from a recipe. The TS builds a table the first
// time it is asked for; here all of them are built once, the first time an
// engine is made (they never change, so every plugin instance shares them),
// which keeps the audio thread free of allocation.
#pragma once

#include <vector>
#include <cmath>
#include <cstdint>
#include "FFT.h"

namespace prism {

constexpr int FRAMES = 64;
constexpr int HARMONICS = 512;
constexpr int NUM_TABLES = 14;

struct Wavetable {
  std::vector<float> amp, phase, xs, xc;   // [f * HARMONICS + k - 1]
  double formantHz = 261.6;
};

namespace tables_detail {

inline double lerp(double a, double b, double t) { return a + (b - a) * t; }
inline double smooth(double x) { return x * x * (3 - 2 * x); }

/** Deterministic hash → 0..1, bit for bit the TS one. */
inline double hash(int64_t a, int64_t b) {
  const int64_t sum = a * 374761393LL + b * 668265263LL;   // exact, as the TS double is
  uint32_t h = (uint32_t)(uint64_t)sum;
  h = (h ^ (h >> 13)) * 1274126177u;
  h ^= h >> 16;
  return h / 4294967296.0;
}

inline double shape(int i, int k) {
  switch (i) {
    case 0: return k == 1 ? 1 : 0;
    case 1: return (k % 2) ? (8 / (PI * PI)) / (double)(k * k) * (((k >> 1) % 2) ? -1 : 1) : 0;
    case 2: return 2 / (PI * k) * ((k % 2) ? 1 : -1);
    case 3: return (k % 2) ? 4 / (PI * k) : 0;
    default: return 2 / (PI * k) * std::sin(PI * k * 0.2) * 1.6;
  }
}

inline double peak(double k, double centre, double width) {
  const double x = (k - centre) / width;
  return std::exp(-(x * x));
}

constexpr double VOWELS[5][3] = { { 730, 1090, 2440 }, { 530, 1840, 2480 }, { 270, 2290, 3010 }, { 570, 840, 2410 }, { 300, 870, 2240 } };
constexpr double VOWEL_F0 = 130;

inline double vowelEnv(double f, double hz) {
  const double x = f * 4;
  const int i = (int)std::min(3.0, std::floor(x));
  const double t = smooth(x - i);
  static constexpr double W[3] = { 1, 0.6, 0.35 };
  double e = 0.04;
  for (int j = 0; j < 3; j++) {
    const double fc = lerp(VOWELS[i][j], VOWELS[i + 1][j], t);
    const double bw = 70 + fc * 0.06;
    const double d = (hz - fc) / bw;
    e += W[j] / (1 + d * d);
  }
  return e;
}

enum Recipe { BASIC, ANALOG, PWM, VOCAL, GLASS, ORGAN, SYNC, FOLD, FM, GROWL, FELT, CLOUD, SCAN, STEPS };

inline bool isTime(int r) { return r == SYNC || r == FOLD || r == FM || r == STEPS; }

/** Additive recipes: signed amplitude of harmonic k in frame f (0..1). */
inline double add(int r, double f, int k) {
  switch (r) {
    case BASIC: {
      const double x = f * 4;
      const int i = (int)std::min(3.0, std::floor(x));
      const double t = x - i;
      return lerp(shape(i, k), shape(i + 1, k), t);
    }
    case ANALOG: {
      const double c = std::pow(2.0, 0.3 + f * 8.7);
      return (1.0 / k) * (1 / std::sqrt(1 + std::pow(k / c, 8))) * (1 + 1.8 * peak(k, c, 0.12 * c + 0.8));
    }
    case PWM: {
      const double w = lerp(0.5, 0.03, f);
      return (2 / (PI * k)) * std::sin(PI * k * w) / std::max(0.35, w * 2);
    }
    case VOCAL: return (1 / std::pow((double)k, 0.7)) * vowelEnv(f, k * VOWEL_F0);
    case GLASS: {
      static constexpr int set[12] = { 1, 2, 3, 5, 7, 9, 12, 15, 19, 24, 30, 37 };
      int j = -1;
      for (int s = 0; s < 12; s++) if (set[s] == k) { j = s; break; }
      if (j < 0) return 0;
      const double w = 0.5 + 0.5 * std::cos(TAU * (f * 1.5 - j / 12.0));
      return (j == 0 ? 1 : 0.55 * w) / std::sqrt(1 + j * 0.6);
    }
    case ORGAN: {
      static constexpr int bars[7] = { 1, 2, 3, 4, 5, 6, 8 };
      static constexpr double regs[8][7] = {
        { 8, 0, 0, 0, 0, 0, 0 }, { 8, 8, 0, 0, 0, 0, 0 }, { 8, 8, 8, 0, 0, 0, 0 }, { 8, 6, 8, 4, 0, 3, 0 },
        { 8, 8, 8, 8, 6, 6, 6 }, { 6, 8, 4, 8, 3, 8, 8 }, { 4, 8, 0, 8, 0, 8, 8 }, { 8, 0, 8, 0, 8, 0, 8 },
      };
      int j = -1;
      for (int s = 0; s < 7; s++) if (bars[s] == k) { j = s; break; }
      if (j < 0) return 0;
      const double x = f * 7;
      const int i = (int)std::min(6.0, std::floor(x));
      const double t = smooth(x - i);
      return lerp(regs[i][j], regs[i + 1][j], t) / 8 / std::sqrt((double)k);
    }
    case GROWL: {
      const double c1 = lerp(2.5, 28, f), c2 = c1 * lerp(2.2, 1.45, f);
      return (1 / std::sqrt((double)k)) * (0.08 + peak(k, c1, 1 + c1 * 0.18) + 0.7 * peak(k, c2, 1 + c2 * 0.15));
    }
    case FELT: {
      const double bright = 1.5 + f * f * 22;
      return (1 / std::pow((double)k, 1.1)) * std::exp(-(k - 1) / bright) * (0.25 + 0.75 * std::abs(std::sin(PI * k / 7.3)));
    }
    case CLOUD: {
      const double x = f * 7;
      const int i = (int)std::floor(std::min(6.999, x));
      const double t = smooth(x - i);
      const double a = hash(i, k), b = hash(i + 1, k);
      const double l = lerp(a, b, t);
      return std::pow(l, 2) / std::pow((double)k, 0.85);
    }
    case SCAN: {
      const double c = 1 + f * 47;
      return 0.35 / (double)(k * k) + peak(k, c, 0.7);
    }
    default: return 0;
  }
}

inline double phaseOf(int r, double f, int k) {
  if (r == PWM) return PI / 2;
  if (r == CLOUD) return TAU * hash(k, 911 + (int64_t)std::floor(f * 3));
  return 0;
}

/** Time-domain recipes: the sample at t (0..1) of frame f (0..1). */
inline double timeSample(int r, double f, double t) {
  switch (r) {
    case SYNC: { const double rr = 1 + f * 7; return 2 * std::fmod(t * rr, 1.0) - 1; }
    case FOLD: return std::sin((1 + f * 7) * (PI / 2) * std::sin(TAU * t));
    case FM: return std::sin(TAU * t + f * 9 * std::sin(TAU * 2 * t));
    default: {
      const double levels = std::max(1.0, jsRound(std::pow(2.0, lerp(5, 0, f))));
      return jsRound(std::sin(TAU * t) * levels) / levels;
    }
  }
}

inline void spectrumToFrame(const double* re, const double* im, int T, float* amp, float* phase, int f) {
  for (int k = 1; k <= HARMONICS; k++) {
    const double s = 2 * re[k] / T, c = -2 * im[k] / T;
    amp[f * HARMONICS + k - 1] = (float)std::hypot(s, c);
    phase[f * HARMONICS + k - 1] = (float)std::atan2(s, c);
  }
}

/** Scale every frame to a peak of 1 (measured on a 2048-point cycle). */
inline void normalise(float* amp, const float* phase) {
  const int N = 2048;
  RealFFT fft(N);
  std::vector<double> re(N / 2 + 1), im(N / 2 + 1);
  std::vector<float> out(N);
  for (int f = 0; f < FRAMES; f++) {
    std::fill(re.begin(), re.end(), 0.0); std::fill(im.begin(), im.end(), 0.0);
    for (int k = 1; k <= HARMONICS; k++) {
      const double a = amp[f * HARMONICS + k - 1], p = phase[f * HARMONICS + k - 1];
      re[(size_t)k] = a * std::sin(p) / 2; im[(size_t)k] = -a * std::cos(p) / 2;
    }
    fft.inverse(re.data(), im.data(), out.data());
    double pk = 0;
    for (int i = 0; i < N; i++) { const double v = std::abs((double)out[(size_t)i]); if (v > pk) pk = v; }
    if (pk < 1e-9) continue;
    const double g = 1 / pk;
    for (int k = 0; k < HARMONICS; k++) amp[f * HARMONICS + k] = (float)(amp[f * HARMONICS + k] * g);
  }
}

inline Wavetable build(int r) {
  Wavetable t;
  const size_t size = (size_t)FRAMES * HARMONICS;
  t.amp.assign(size, 0.f); t.phase.assign(size, 0.f);
  if (isTime(r)) {
    const int T = 8192;
    RealFFT fft(T);
    std::vector<double> re(T / 2 + 1), im(T / 2 + 1);
    std::vector<float> buf(T);
    for (int f = 0; f < FRAMES; f++) {
      const double ff = (double)f / (FRAMES - 1);
      for (int s = 0; s < T; s++) buf[(size_t)s] = (float)timeSample(r, ff, (double)s / T);
      fft.forward(buf.data(), re.data(), im.data());
      spectrumToFrame(re.data(), im.data(), T, t.amp.data(), t.phase.data(), f);
    }
  } else {
    for (int f = 0; f < FRAMES; f++) {
      const double ff = (double)f / (FRAMES - 1);
      for (int k = 1; k <= HARMONICS; k++) {
        const double a = add(r, ff, k);
        const double p = phaseOf(r, ff, k);
        t.amp[(size_t)(f * HARMONICS + k - 1)] = (float)std::abs(a);
        t.phase[(size_t)(f * HARMONICS + k - 1)] = (float)(a < 0 ? p + PI : p);
      }
    }
  }
  normalise(t.amp.data(), t.phase.data());
  t.formantHz = r == VOCAL ? VOWEL_F0 : 261.6;
  t.xs.resize(size); t.xc.resize(size);
  for (size_t i = 0; i < size; i++) {
    t.xs[i] = (float)(t.amp[i] * std::sin((double)t.phase[i]));
    t.xc[i] = (float)(t.amp[i] * std::cos((double)t.phase[i]));
  }
  return t;
}

} // namespace tables_detail

/** Every table, built on first use (thread-safe) and shared. */
inline const std::vector<Wavetable>& allTables() {
  static const std::vector<Wavetable> t = [] {
    std::vector<Wavetable> v;
    v.reserve(NUM_TABLES);
    for (int r = 0; r < NUM_TABLES; r++) v.push_back(tables_detail::build(r));
    return v;
  }();
  return t;
}

inline const Wavetable& getTable(int i) {
  const int idx = std::max(0, std::min(NUM_TABLES - 1, i));
  return allTables()[(size_t)idx];
}

} // namespace prism
