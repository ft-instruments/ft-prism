// Small numeric helpers shared by the DSP. C++ port of src/dsp/util.ts.
//
// Porting convention for the whole engine (the same as Mycelia's): a TS
// number is a double, a Float32Array element is a float. JS does all
// arithmetic in double, so a float read from a buffer is promoted before it
// is used; stores round back to float exactly where the TS stores into a
// Float32Array. That keeps the two engines within rounding of each other
// (see scripts/null-test.ts).
#pragma once

#include <cmath>
#include <cstdint>
#include <cstring>
#include <algorithm>
#include "Params.gen.h"

namespace prism {

constexpr double PI = 3.141592653589793;
constexpr double TAU = PI * 2;

using ParamValues = double[NUM_PARAMS];

/** JS Math.round: the nearest integer, ties towards +infinity. */
inline double jsRound(double x) {
  const double r = std::floor(x);
  return x - r >= 0.5 ? r + 1 : r;
}

/** JS Math.sign. */
inline double jsSign(double x) { return x > 0 ? 1 : x < 0 ? -1 : x; }

/** Rational tanh approximation, good to ~1e-3 over |x| < 3 and clamped beyond. */
inline double tanhf_(double x) {
  if (x > 3) return 1;
  if (x < -3) return -1;
  const double x2 = x * x;
  return x * (27 + x2) / (27 + 9 * x2);
}

/** Soft clipper with unit slope at 0 and hard limit at ±1. */
inline double softClip(double x) {
  if (x > 1.5) return 1;
  if (x < -1.5) return -1;
  return x - (x * x * x) * 0.148148;
}

inline double clamp(double x, double lo, double hi) { return x < lo ? lo : x > hi ? hi : x; }

inline double midiToFreq(double note) { return 440 * std::pow(2.0, (note - 69) / 12); }

/** xorshift32; deterministic so offline renders are repeatable. */
class Rng {
public:
  explicit Rng(uint32_t seed = 0x9e3779b9u) : s(seed ? seed : 1) {}
  double next() {
    uint32_t x = s;
    x ^= x << 13; x ^= x >> 17; x ^= x << 5;
    s = x;
    return x / 4294967296.0;
  }
  /** -1..1 */
  double bi() { return next() * 2 - 1; }
private:
  uint32_t s;
};

/** Fractional-delay read with linear interpolation from a circular buffer. */
inline double readDelay(const float* buf, int len, int writeIdx, double delay) {
  double r = writeIdx - delay;
  while (r < 0) r += len;
  const int i0 = (int)r;
  const double frac = r - i0;
  int i1 = i0 + 1; if (i1 >= len) i1 -= len;
  const double a = buf[i0], b = buf[i1];
  return a + (b - a) * frac;
}

/** DC blocker (first-order high-pass at ~10 Hz). */
class DCBlock {
public:
  explicit DCBlock(double sampleRate, double hz = 10) : r(1 - (2 * PI * hz) / sampleRate) {}
  double tick(double x) {
    const double y = x - x1 + r * y1;
    x1 = x; y1 = y;
    return y;
  }
private:
  double x1 = 0, y1 = 0, r;
};

} // namespace prism
