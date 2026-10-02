// The modulators: envelopes, LFOs and steppers, at block rate. C++ port of
// src/dsp/mod.ts.
#pragma once

#include "Util.h"

namespace prism {

/** Power bend of a 0..1 ramp: c > 0 rises fast and settles slowly, c < 0 the opposite. */
inline double bendCurve(double u, double c) {
  return c >= 0 ? 1 - std::pow(1 - u, 1 + 4 * c) : std::pow(u, 1 - 4 * c);
}

class Env {
public:
  enum : int { IDLE, ATTACK, DECAY, SUSTAIN, RELEASE };
  double value = 0;
  int stage = IDLE;

  bool active() const { return stage != IDLE; }

  void gate(bool on) {
    if (on) { stage = ATTACK; t = 0; from = value; }
    else if (stage != IDLE) { stage = RELEASE; t = 0; from = value; }
  }

  void kill() { stage = IDLE; value = 0; }

  double step(double dt, double a, double d, double s, double r, double curve, bool loop) {
    t += dt;
    switch (stage) {
      case ATTACK: {
        const double u = t / a;
        if (u >= 1) { value = 1; stage = DECAY; t = 0; from = 1; }
        else value = from + (1 - from) * bendCurve(u, curve);
        break;
      }
      case DECAY: {
        const double target = loop ? 0 : s;
        const double u = t / d;
        if (u >= 1) {
          value = target;
          if (loop) { stage = ATTACK; t = 0; from = value; }
          else stage = SUSTAIN;
        } else value = target + (from - target) * (1 - bendCurve(u, curve));
        break;
      }
      case SUSTAIN: value = s; break;
      case RELEASE: {
        const double u = t / r;
        if (u >= 1) { value = 0; stage = IDLE; }
        else value = from * (1 - bendCurve(u, curve));
        break;
      }
      default: value = 0;
    }
    return value;
  }

private:
  double t = 0, from = 0;
};

/** Waveforms by phase 0..1, bipolar. `hold` and `next` carry the random shapes. */
inline double lfoShape(int shape, double ph, double hold, double next) {
  switch (shape) {
    case 0: return std::sin(ph * PI * 2);
    case 1: return ph < 0.25 ? ph * 4 : ph < 0.75 ? 2 - ph * 4 : ph * 4 - 4;
    case 2: return 1 - 2 * ph;
    case 3: return 2 * ph - 1;
    case 4: return ph < 0.5 ? 1 : -1;
    case 5: return hold;
    default: { const double u = ph * ph * (3 - 2 * ph); return hold + (next - hold) * u; }
  }
}

/** One LFO's running state (per voice when it retriggers, in the engine when it runs free). */
class LfoState {
public:
  double phase = 0, hold = 0, next = 0, age = 0;

  void reset(double ph, Rng& rnd) {
    phase = ph; age = 0;
    hold = rnd.next() * 2 - 1; next = rnd.next() * 2 - 1;
  }

  void advance(double inc, double dt, Rng& rnd) {
    age += dt;
    phase += inc;
    while (phase >= 1) {
      phase -= 1;
      hold = next; next = rnd.next() * 2 - 1;
    }
  }

  /** Plugin only: put the phase where the host's beat says it is (a wrap rolls the random shapes). */
  void lockTo(double ph, double dt, Rng& rnd) {
    age += dt;
    if (ph < phase - 0.5) { hold = next; next = rnd.next() * 2 - 1; }
    phase = ph;
  }
};

/** A stepper's position: which step, how far into it. */
class StepState {
public:
  double pos = 0;
  void reset() { pos = 0; }
  void advance(double stepsPerSecond, double dt, int len) {
    pos += stepsPerSecond * dt;
    if (pos >= len) pos -= len * std::floor(pos / len);
  }
  double value(const float* cells, int len, double glide) const {
    const int i = (int)std::floor(pos) % len;
    const double cur = cells[i] / 8.0;
    if (glide <= 0) return cur;
    const double frac = pos - std::floor(pos);
    const double start = 1 - glide;
    if (frac <= start) return cur;
    const double u = (frac - start) / glide;
    const double nxt = cells[(i + 1) % len] / 8.0;
    return cur + (nxt - cur) * u * u * (3 - 2 * u);
  }
  int index() const { return (int)std::floor(pos); }
};

} // namespace prism
