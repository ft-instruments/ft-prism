// The master effects after the voices: dimension, chorus, delay (with the
// spiral shifter), eq, squash, warmth. C++ port of src/dsp/fx.ts.
#pragma once

#include <vector>
#include "Util.h"
#include "Inserts.h"

namespace prism {

class Dimension {
public:
  explicit Dimension(double sampleRate) : buf((size_t)std::ceil(sampleRate * 0.05), 0.f), fs(sampleRate) {}
  void clear() { std::fill(buf.begin(), buf.end(), 0.f); }
  void process(float* L, float* R, int n, double size, double mix) {
    if (mix <= 0) return;
    const int len = (int)buf.size();
    const double t1 = (0.006 + size * 0.012) * fs, t2 = (0.009 + size * 0.019) * fs;
    const double depth = 0.0006 * fs;
    const double inc = 0.25 / fs;
    const double g = mix * 0.75;
    for (int i = 0; i < n; i++) {
      buf[(size_t)w] = (float)((L[i] + (double)R[i]) * 0.5);
      const double m = std::sin(ph * 6.283185307) * depth;
      const double a = readDelay(buf.data(), len, w, t1 + m), b = readDelay(buf.data(), len, w, t2 - m);
      L[i] = (float)(L[i] + (a - b) * g); R[i] = (float)(R[i] + (b - a) * g);
      if (++w >= len) w = 0;
      ph += inc; if (ph >= 1) ph -= 1;
    }
  }
private:
  std::vector<float> buf;
  int w = 0;
  double ph = 0;
  double fs;
};

class Chorus {
public:
  explicit Chorus(double sampleRate)
    : bl((size_t)std::ceil(sampleRate * 0.04), 0.f), br((size_t)std::ceil(sampleRate * 0.04), 0.f), fs(sampleRate) {}
  void clear() { std::fill(bl.begin(), bl.end(), 0.f); std::fill(br.begin(), br.end(), 0.f); }
  void process(float* L, float* R, int n, double rate, double depth, double mix) {
    if (mix <= 0) return;
    const int len = (int)bl.size();
    const double base = 0.008 * fs, dep = depth * 0.005 * fs;
    const double inc = rate / fs;
    const double wet = mix * 0.6, dry = 1 - mix * 0.3;
    for (int i = 0; i < n; i++) {
      bl[(size_t)w] = L[i]; br[(size_t)w] = R[i];
      double yl = 0, yr = 0;
      for (int t = 0; t < 3; t++) {
        const double p = ph + t / 3.0;
        const double m = std::sin(p * 6.283185307) * dep;
        yl += readDelay(bl.data(), len, w, base + dep + m);
        yr += readDelay(br.data(), len, w, base + dep - m);
      }
      L[i] = (float)(L[i] * dry + yl * 0.4 * wet);
      R[i] = (float)(R[i] * dry + yr * 0.4 * wet);
      if (++w >= len) w = 0;
      ph += inc; if (ph >= 1) ph -= 1;
    }
  }
private:
  std::vector<float> bl, br;
  int w = 0;
  double ph = 0;
  double fs;
};

/** Stereo delay; `spiral` puts a frequency shifter in the feedback path. */
class Delay {
public:
  explicit Delay(double sampleRate)
    : bl((size_t)std::ceil(sampleRate * 2.6), 0.f), br((size_t)std::ceil(sampleRate * 2.6), 0.f), fs(sampleRate) {}
  void clear() {
    std::fill(bl.begin(), bl.end(), 0.f); std::fill(br.begin(), br.end(), 0.f);
    lpL = lpR = 0; hl.clear(); hr.clear();
  }
  void process(float* L, float* R, int n, double seconds, double fb, bool ping, double damp, double spiral, double mix) {
    if (mix <= 0) return;
    const int len = (int)bl.size();
    const double target = std::min((double)len - 4, std::max(1.0, seconds * fs));
    if (time < 0) time = target;
    const double a = 1 - std::exp(-2 * PI * (18000 * std::pow(0.04, damp)) / fs);
    const double hz = jsSign(spiral) * spiral * spiral * 60;
    const double inc = hz / fs;
    const bool shifting = spiral != 0;
    const double glide = 1 - std::exp(-1 / (0.08 * fs));
    for (int i = 0; i < n; i++) {
      time += (target - time) * glide;
      double yl = readDelay(bl.data(), len, w, time), yr = readDelay(br.data(), len, w, time);
      lpL += (yl - lpL) * a; lpR += (yr - lpR) * a;
      yl = lpL; yr = lpR;
      if (shifting) {
        const double c = std::cos(ph * 6.283185307), s = std::sin(ph * 6.283185307);
        hl.tick(yl); hr.tick(yr);
        yl = hl.i * c + hl.q * s;
        yr = hr.i * c + hr.q * s;
        ph += inc; ph -= std::floor(ph);
      }
      const double xl = L[i], xr = R[i];
      if (ping) {
        bl[(size_t)w] = (float)((xl + xr) * 0.5 + yr * fb);
        br[(size_t)w] = (float)(yl * fb);
      } else {
        bl[(size_t)w] = (float)(xl + yl * fb);
        br[(size_t)w] = (float)(xr + yr * fb);
      }
      L[i] = (float)(xl + yl * mix); R[i] = (float)(xr + yr * mix);
      if (++w >= len) w = 0;
    }
  }
private:
  std::vector<float> bl, br;
  int w = 0;
  double lpL = 0, lpR = 0;
  Hilbert hl, hr;
  double ph = 0;
  double time = -1;
  double fs;
};

/** Low and high shelves from one-pole splits. */
class Eq {
public:
  explicit Eq(double sampleRate)
    : aLo(1 - std::exp(-2 * PI * 220 / sampleRate)), aHi(1 - std::exp(-2 * PI * 3800 / sampleRate)) {}
  void clear() { l1 = l2 = h1 = h2 = 0; }
  void process(float* L, float* R, int n, double lowDb, double highDb) {
    if (lowDb == 0 && highDb == 0) return;
    const double gl = std::pow(10.0, lowDb / 20) - 1, gh = std::pow(10.0, highDb / 20) - 1;
    for (int i = 0; i < n; i++) {
      const double x = L[i], y = R[i];
      l1 += (x - l1) * aLo; l2 += (y - l2) * aLo;
      h1 += (x - h1) * aHi; h2 += (y - h2) * aHi;
      L[i] = (float)(x + gl * l1 + gh * (x - h1));
      R[i] = (float)(y + gl * l2 + gh * (y - h2));
    }
  }
private:
  double l1 = 0, l2 = 0, h1 = 0, h2 = 0;
  const double aLo, aHi;
};

/** Three-band upward + downward compression in the manner of OTT. */
class Squash {
public:
  float meter[3] {};

  explicit Squash(double sampleRate)
    : aLo(1 - std::exp(-2 * PI * 120 / sampleRate)), aHi(1 - std::exp(-2 * PI * 2500 / sampleRate)), fs(sampleRate) {}

  void clear() {
    std::fill(lo1, lo1 + 2, 0.0); std::fill(lo2, lo2 + 2, 0.0); std::fill(hi1, hi1 + 2, 0.0); std::fill(hi2, hi2 + 2, 0.0);
    std::fill(env, env + 3, 0.0); std::fill(meter, meter + 3, 0.f);
  }

  void process(float* L, float* R, int n, double depth, double time, double up, double down) {
    if (depth <= 0) { std::fill(meter, meter + 3, 0.f); return; }
    const double atk = 1 - std::exp(-1 / ((0.001 + time * 0.03) * fs));
    const double rel = 1 - std::exp(-1 / ((0.03 + time * 0.4) * fs));
    const double rDown = 1 + down * 9, rUp = 1 + up * 3;
    constexpr double TD = -22, TU = -36, MAXUP = 18, FLOOR = -72;
    double m0 = 0, m1 = 0, m2 = 0;
    double band[3], bandR[3];
    for (int i = 0; i < n; i++) {
      const double xl = L[i], xr = R[i];
      lo1[0] += (xl - lo1[0]) * aLo; lo1[1] += (xr - lo1[1]) * aLo;
      lo2[0] += (lo1[0] - lo2[0]) * aLo; lo2[1] += (lo1[1] - lo2[1]) * aLo;
      const double lowL = lo2[0], lowR = lo2[1];
      const double restL = xl - lowL, restR = xr - lowR;
      hi1[0] += (restL - hi1[0]) * aHi; hi1[1] += (restR - hi1[1]) * aHi;
      hi2[0] += (hi1[0] - hi2[0]) * aHi; hi2[1] += (hi1[1] - hi2[1]) * aHi;
      const double midL = hi2[0], midR = hi2[1];
      band[0] = lowL; band[1] = midL; band[2] = restL - midL;
      bandR[0] = lowR; bandR[1] = midR; bandR[2] = restR - midR;
      double yl = 0, yr = 0;
      for (int b = 0; b < 3; b++) {
        const double lvl = std::max(std::abs(band[b]), std::abs(bandR[b]));
        const double e = env[b];
        env[b] = e + (lvl - e) * (lvl > e ? atk : rel);
        const double db = 20 * std::log10(env[b] + 1e-9);
        double g = 0;
        if (db > TD) g = -(db - TD) * (1 - 1 / rDown);
        else if (db < TU && db > FLOOR) g = std::min(MAXUP, (TU - db) * (1 - 1 / rUp)) * std::min(1.0, (db - FLOOR) / 12);
        const double lin = std::pow(10.0, g / 20);
        yl += band[b] * lin; yr += bandR[b] * lin;
        if (b == 0) m0 = g; else if (b == 1) m1 = g; else m2 = g;
      }
      L[i] = (float)(xl + (yl - xl) * depth);
      R[i] = (float)(xr + (yr - xr) * depth);
    }
    meter[0] = (float)m0; meter[1] = (float)m1; meter[2] = (float)m2;
  }

private:
  double lo1[2] {}, lo2[2] {}, hi1[2] {}, hi2[2] {}, env[3] {};
  const double aLo, aHi;
  double fs;
};

/** Warmth: soft saturation and a top that darkens as it is pushed. */
class Warmth {
public:
  explicit Warmth(double sampleRate) : fs(sampleRate) {}
  void clear() { zl = zr = 0; }
  void process(float* L, float* R, int n, double amount) {
    if (amount <= 0) return;
    const double drive = 1 + amount * 2.5, norm = 1 / std::tanh(drive * 0.8) * 0.8;
    const double a = 1 - std::exp(-2 * PI * (18000 - amount * 11000) / fs);
    for (int i = 0; i < n; i++) {
      const double l = std::tanh(L[i] * drive) * norm, r = std::tanh(R[i] * drive) * norm;
      zl += (l - zl) * a; zr += (r - zr) * a;
      L[i] = (float)(L[i] + (zl - L[i]) * amount); R[i] = (float)(R[i] + (zr - R[i]) * amount);
    }
  }
private:
  double zl = 0, zr = 0;
  double fs;
};

} // namespace prism
