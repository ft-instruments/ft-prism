// One voice: three spectral oscillators with unison, a sub and noise,
// insert A, two filters, insert B, the amp. Rendered in blocks of up to 64
// samples; modulation once per block. C++ port of src/dsp/voice.ts.
#pragma once

#include <limits>
#include "Oscillator.h"
#include "Mod.h"
#include "Filter.h"
#include "Inserts.h"

namespace prism {

constexpr int BLOCK = 64;

/** What the engine shares with every voice for a block. */
struct Ctx {
  double fs = 48000;
  double tempo = 120;
  double bendSemis = 0;
  float macros[8] {};
  double wheel = 0, pressure = 0, bend = 0;
  LfoState lfo[4];
  StepState steps[2];
  float cells[2][STEPS] {};
  int routed[MATRIX_SLOTS] {};
  int nRouted = 0;
};

namespace voice_detail {

constexpr double SZ[7] = { -0.11002313, -0.06288439, -0.01952356, 0, 0.01991221, 0.06216538, 0.10745242 };
inline double szaboDetune(double x) {
  return ((((((((((10028.7312891634 * x - 50818.8652045924) * x + 111363.4808729368) * x - 138150.6761080548) * x
    + 106649.6679158292) * x - 53046.9642751875) * x + 17019.9518580080) * x - 3425.0836591318) * x + 404.2703938388) * x
    - 24.1878824391) * x + 0.6717417634) * x + 0.0030115596;
}

constexpr double QUARTER_PI = PI / 4;
constexpr int ORDER[3] = { 2, 0, 1 };   // osc 3 first: it is the phase modulator of 1 and 2

struct OscKeys { int level, table, pos, morph, warp, amt, oct, semi, fine, pan, uni, detune, curve, blend, width, phase, route; };
#define PRISM_OSC_KEYS(n) { P::o##n##Level, P::o##n##Table, P::o##n##Pos, P::o##n##Morph, P::o##n##Warp, P::o##n##Amt, \
  P::o##n##Oct, P::o##n##Semi, P::o##n##Fine, P::o##n##Pan, P::o##n##Uni, P::o##n##Detune, P::o##n##Curve, P::o##n##Blend, \
  P::o##n##Width, P::o##n##Phase, P::o##n##Route }
constexpr OscKeys OK[3] = { PRISM_OSC_KEYS(1), PRISM_OSC_KEYS(2), PRISM_OSC_KEYS(3) };
#undef PRISM_OSC_KEYS

struct EnvKeys { int a, d, s, r, c, mode; };
#define PRISM_ENV_KEYS(n) { P::e##n##Atk, P::e##n##Dec, P::e##n##Sus, P::e##n##Rel, P::e##n##Curve, P::e##n##Mode }
constexpr EnvKeys EK[4] = { PRISM_ENV_KEYS(1), PRISM_ENV_KEYS(2), PRISM_ENV_KEYS(3), PRISM_ENV_KEYS(4) };
#undef PRISM_ENV_KEYS

struct LfoKeys { int shape, rate, sync, div, retrig, phase, fade, uni; };
#define PRISM_LFO_KEYS(n) { P::l##n##Shape, P::l##n##Rate, P::l##n##Sync, P::l##n##Div, P::l##n##Retrig, P::l##n##Phase, P::l##n##Fade, P::l##n##Uni }
constexpr LfoKeys LK[4] = { PRISM_LFO_KEYS(1), PRISM_LFO_KEYS(2), PRISM_LFO_KEYS(3), PRISM_LFO_KEYS(4) };
#undef PRISM_LFO_KEYS

struct StepKeys { int len, div, glide, retrig; };
constexpr StepKeys SK[2] = { { P::s1Len, P::s1Div, P::s1Glide, P::s1Retrig }, { P::s2Len, P::s2Div, P::s2Glide, P::s2Retrig } };

inline double divBeats(double v) {
  const int i = (int)v;
  return DIV_BEATS[i < 0 ? 0 : i >= NUM_DIVS ? NUM_DIVS - 1 : i];
}

inline double clampHz(double x) { return x < 20 ? 20 : x > 20000 ? 20000 : x; }

} // namespace voice_detail

struct OscSlot {
  SpectralOsc osc;
  double ratio[MAX_UNISON] {};
  float gl[MAX_UNISON] {}, gr[MAX_UNISON] {};
  double inc = -1;
  Shape shape;
  double livePos = 0;
  explicit OscSlot(OscScratch& sc) : osc(sc) {
    shape.table = &getTable(0); shape.tableId = 0; shape.pos = 0; shape.spectral = true;
    shape.warp = 0; shape.amt = 0; shape.hb = 1; shape.f0 = 100;
  }
};

class Voice {
public:
  int note = 60;
  double vel = 1;
  double age = 0;
  double pitch = 60, target = 60;
  bool sustained = false;     // the engine's set of voices held by the pedal
  Env env[4];
  float src[N_SOURCES] {};
  float mods[N_DESTS] {};

  Voice(double sampleRate, uint32_t seed, OscScratch& sc)
    : o { OscSlot(sc), OscSlot(sc), OscSlot(sc) },
      f1(sampleRate), f2(sampleRate), insA(sampleRate), insB(sampleRate),
      rng(seed * 7919 + 17), fs(sampleRate) {
    double ph = rng.next(); drift.reset(ph, rng);
    ph = rng.next(); drift2.reset(ph, rng);
    driftRate = 0.13 + rng.next() * 0.17;
  }

  bool active() const { return env[0].active(); }
  bool released() const { return !gate; }
  double level() const { return env[0].value; }
  int stepIndex(int i) const { return step[i].index(); }
  double livePos(int i) const { return o[i].livePos; }

  void noteOn(int n, double velocity, const ParamValues& p, double glideFrom, bool legato) {
    using namespace voice_detail;
    const bool wasActive = active();
    note = n; vel = velocity; target = n;
    pitch = std::isfinite(glideFrom) && p[P::glide] > 0 ? glideFrom : n;
    if (legato && wasActive && gate) return;
    gate = true;
    rnd = rng.next() * 2 - 1;
    if (!wasActive) {
      f1.clear(); f2.clear(); insA.clear(); insB.clear();
      gain = 0; subPh = 0;
      for (auto& s : o) s.inc = -1;
    }
    for (int i = 0; i < 4; i++) env[i].gate(true);
    for (int i = 0; i < 4; i++) if (p[LK[i].retrig] >= 0.5) lfo[i].reset(p[LK[i].phase], rng);
    for (int i = 0; i < 4; i++) lfo[i].age = 0;
    for (int i = 0; i < 2; i++) if (p[SK[i].retrig] >= 0.5) step[i].reset();
    for (int i = 0; i < 3; i++) o[i].osc.reset(p[OK[i].phase], rng);
  }

  void noteOff() {
    gate = false;
    for (auto& e : env) e.gate(false);
  }

  void kill() {
    gate = false;
    for (auto& e : env) e.kill();
    gain = 0;
  }

  void render(float* L, float* R, int off, int n, const ParamValues& p, const Ctx& ctx) {
    using namespace voice_detail;
    const double dt = n / fs;
    modulate(p, ctx, dt);
    const bool routed = ctx.nRouted > 0;
    auto m = [&](int d) { return routed ? mods[d] * DEST_RANGE[d] : 0.0; };

    const double glide = p[P::glide];
    if (glide > 0 && pitch != target) {
      pitch += (target - pitch) * (1 - std::exp(-dt / (glide * 0.35)));
      if (std::abs(target - pitch) < 1e-3) pitch = target;
    } else pitch = target;
    double driftPos = 0, driftCt = 0;
    if (p[P::drift] > 0) {
      drift.advance(driftRate * dt, dt, rng);
      drift2.advance(driftRate * 0.71 * dt, dt, rng);
      driftCt = lfoShape(6, drift.phase, drift.hold, drift.next) * p[P::drift] * 14;
      driftPos = lfoShape(6, drift2.phase, drift2.hold, drift2.next) * p[P::drift] * 0.06;
    }
    const double base = pitch + ctx.bendSemis + m(D_PITCH) + driftCt / 100;
    const double f0base = midiToFreq(base);

    std::fill(b1L, b1L + n, 0.f); std::fill(b1R, b1R + n, 0.f); std::fill(b2L, b2L + n, 0.f); std::fill(b2R, b2R + n, 0.f);
    const bool parallel = p[P::fRoute] >= 0.5;
    const double pm1 = std::max(0.0, std::min(1.0, p[P::o1Pm] + m(D_PM))), pm2 = std::max(0.0, std::min(1.0, p[P::o2Pm] + m(D_PM)));
    bool pmReady = false;

    for (int oi : ORDER) {
      const OscKeys& k = OK[oi];
      const int d0 = D_OSC(oi);
      OscSlot& s = o[oi];
      const double lvl = std::max(0.0, std::min(1.0, p[k.level] + m(d0 + 2)));
      const bool needPm = oi == 2 && (pm1 > 0 || pm2 > 0);
      if (lvl <= 0 && !needPm) { s.inc = -1; continue; }
      const double pt = base + p[k.oct] * 12 + p[k.semi] + p[k.fine] / 100 + m(d0 + 3);
      const double f0 = midiToFreq(pt);
      const double inc1 = f0 / fs, inc0 = s.inc < 0 ? inc1 : s.inc;
      s.inc = inc1;
      const int copies = std::max(1, std::min(MAX_UNISON, (int)p[k.uni]));
      const double detune = std::max(0.0, std::min(1.0, p[k.detune] + m(d0 + 4)));
      const double pan = std::max(-1.0, std::min(1.0, p[k.pan] + m(d0 + 5)));
      const double maxRatio = layoutUnison(s, copies, detune, p[k.curve], p[k.blend], p[k.width], pan, oi == 2 ? 1 : lvl);
      Shape& sh = s.shape;
      const int tid = (int)p[k.table];
      sh.tableId = tid; sh.table = &getTable(tid);
      sh.pos = std::max(0.0, std::min(1.0, p[k.pos] + m(d0) + driftPos));
      sh.spectral = p[k.morph] >= 0.5;
      sh.warp = (int)p[k.warp];
      sh.amt = std::max(-1.0, std::min(1.0, p[k.amt] + m(d0 + 1)));
      sh.hb = bandLimit(fs, f0 * maxRatio * std::max(1.0, inc0 / inc1));
      sh.f0 = sh.warp == W_FORMANT ? f0 : 0;
      s.livePos = sh.pos;
      s.osc.update(sh);
      std::fill(tL, tL + n, 0.f); std::fill(tR, tR + n, 0.f);
      const double usePm = oi == 0 ? pm1 : oi == 1 ? pm2 : 0;
      s.osc.render(tL, tR, 0, n, inc0, inc1, copies, s.ratio, s.gl, s.gr, pmReady && usePm > 0 ? pm : nullptr, usePm * 1.5);
      if (oi == 2) {
        if (needPm) { for (int i = 0; i < n; i++) pm[i] = (float)((tL[i] + (double)tR[i]) * 0.7071); pmReady = true; }
        if (lvl <= 0) continue;
        for (int i = 0; i < n; i++) { tL[i] = (float)(tL[i] * lvl); tR[i] = (float)(tR[i] * lvl); }
      }
      const double route = parallel ? std::max(0.0, std::min(1.0, p[k.route])) : 0;
      const double k1 = 1 - route, k2 = route;
      for (int i = 0; i < n; i++) {
        b1L[i] = (float)(b1L[i] + tL[i] * k1); b1R[i] = (float)(b1R[i] + tR[i] * k1);
        if (k2 > 0) { b2L[i] = (float)(b2L[i] + tL[i] * k2); b2R[i] = (float)(b2R[i] + tR[i] * k2); }
      }
    }

    // sub
    const double subLevel = std::max(0.0, std::min(1.0, p[P::subLevel] + m(D_SUB)));
    if (subLevel > 0) {
      const double inc = (f0base * std::pow(2.0, p[P::subOct])) / fs;
      const bool tri = p[P::subShape] >= 0.5;
      double ph = subPh;
      const double g = subLevel * 0.7071;
      for (int i = 0; i < n; i++) {
        const double v = tri ? (ph < 0.5 ? 4 * ph - 1 : 3 - 4 * ph) : std::sin(ph * 6.283185307);
        b1L[i] = (float)(b1L[i] + v * g); b1R[i] = (float)(b1R[i] + v * g);
        ph += inc; if (ph >= 1) ph -= 1;
      }
      subPh = ph;
    }

    // noise
    const double nzLevel = std::max(0.0, std::min(1.0, p[P::nzLevel] + m(D_NOISE)));
    if (nzLevel > 0) {
      const double c = p[P::nzColour];
      const double a = c < 0 ? std::exp(c * 4.5) : 0.5;
      const double route = parallel ? p[P::nzRoute] : 0;
      const double g = nzLevel * 0.5;
      double zl = nzL, zr = nzR;
      for (int i = 0; i < n; i++) {
        const double wl = rng.bi(), wr = rng.bi();
        zl += (wl - zl) * a; zr += (wr - zr) * a;
        double vl = c < 0 ? zl * (1 + -c * 2) : wl - zl * c * 1.6;
        double vr = c < 0 ? zr * (1 + -c * 2) : wr - zr * c * 1.6;
        vl *= g; vr *= g;
        b1L[i] = (float)(b1L[i] + vl * (1 - route)); b1R[i] = (float)(b1R[i] + vr * (1 - route));
        if (route > 0) { b2L[i] = (float)(b2L[i] + vl * route); b2R[i] = (float)(b2R[i] + vr * route); }
      }
      nzL = zl; nzR = zr;
    }

    // insert A → filters → insert B
    const double keyOct = (pitch - 60) / 12;
    const double e2 = src[S_ENV1 + 1];
    insA.process(b1L, b1R, n, (int)p[P::iAType], p[P::iAA] + m(D_INSA), p[P::iAB], p[P::iAMix], f0base);
    const double cut1 = clampHz(p[P::f1Cut] * std::pow(2.0, p[P::f1Key] * keyOct + p[P::f1Env] * e2 * 6 + m(D_F1CUT)));
    const double cut2 = clampHz(p[P::f2Cut] * std::pow(2.0, p[P::f2Key] * keyOct + p[P::f2Env] * e2 * 6 + m(D_F2CUT)));
    const double res1 = p[P::f1Res] + m(D_F1RES), res2 = p[P::f2Res] + m(D_F2RES);
    if (parallel) {
      f1.process(b1L, b1R, n, (int)p[P::f1Type], cut1, res1, p[P::f1Drive]);
      f2.process(b2L, b2R, n, (int)p[P::f2Type], cut2, res2, p[P::f2Drive]);
      for (int i = 0; i < n; i++) { b1L[i] = (float)(b1L[i] + (double)b2L[i]); b1R[i] = (float)(b1R[i] + (double)b2R[i]); }
    } else {
      f1.process(b1L, b1R, n, (int)p[P::f1Type], cut1, res1, p[P::f1Drive]);
      f2.process(b1L, b1R, n, (int)p[P::f2Type], cut2, res2, p[P::f2Drive]);
    }
    insB.process(b1L, b1R, n, (int)p[P::iBType], p[P::iBA] + m(D_INSB), p[P::iBB], p[P::iBMix], f0base);

    // amp
    const double velGain = 1 - p[P::vel] * (1 - vel);
    const double tgt = env[0].value * velGain * p[P::ampLevel] * std::max(0.0, 1 + m(D_AMP));
    const double pan = std::max(-1.0, std::min(1.0, m(D_PAN)));
    const double th = (pan + 1) * QUARTER_PI;
    const double pl1 = std::cos(th) * 1.4142135623730951, pr1 = std::sin(th) * 1.4142135623730951;
    const double g0 = gain, pl0 = panL, pr0 = panR;
    for (int i = 0; i < n; i++) {
      const double u = (double)(i + 1) / n;
      const double g = g0 + (tgt - g0) * u;
      L[off + i] = (float)(L[off + i] + b1L[i] * g * (pl0 + (pl1 - pl0) * u));
      R[off + i] = (float)(R[off + i] + b1R[i] * g * (pr0 + (pr1 - pr0) * u));
    }
    gain = tgt; panL = pl1; panR = pr1;
    if (!env[0].active()) gain = 0;
  }

private:
  void modulate(const ParamValues& p, const Ctx& ctx, double dt) {
    using namespace voice_detail;
    for (int i = 0; i < 4; i++) {
      const EnvKeys& k = EK[i];
      src[S_ENV1 + i] = (float)env[i].step(dt, p[k.a], p[k.d], p[k.s], p[k.r], p[k.c], p[k.mode] >= 0.5);
    }
    const double beat = ctx.tempo / 60;
    for (int i = 0; i < 4; i++) {
      const LfoKeys& k = LK[i];
      const double rate = p[k.sync] >= 0.5 ? beat / divBeats(p[k.div]) : p[k.rate];
      const bool own = p[k.retrig] >= 0.5;
      const LfoState& st = own ? lfo[i] : ctx.lfo[i];
      if (own) lfo[i].advance(rate * dt, dt, rng); else lfo[i].age += dt;
      double v = lfoShape((int)p[k.shape], st.phase, st.hold, st.next);
      if (p[k.uni] >= 0.5) v = (v + 1) * 0.5;
      const double fade = p[k.fade];
      if (fade > 0) v *= std::min(1.0, lfo[i].age / fade);
      src[S_LFO1 + i] = (float)v;
    }
    for (int i = 0; i < 2; i++) {
      const StepKeys& k = SK[i];
      const int len = std::max(1, (int)p[k.len]);
      const bool own = p[k.retrig] >= 0.5;
      if (own) step[i].advance(beat / divBeats(p[k.div]), dt, len);
      const StepState& st = own ? step[i] : ctx.steps[i];
      src[S_STEP1 + i] = (float)st.value(ctx.cells[i], len, p[k.glide]);
    }
    for (int i = 0; i < 8; i++) src[S_MACRO1 + i] = ctx.macros[i];
    src[S_VEL] = (float)vel;
    src[S_KEY] = (float)((note - 60) / 60.0);
    src[S_WHEEL] = (float)ctx.wheel;
    src[S_PRESS] = (float)ctx.pressure;
    src[S_BEND] = (float)ctx.bend;
    src[S_RANDOM] = (float)rnd;
    matrix(p, ctx);
  }

  /** With nothing routed it returns before touching anything (the matrix invariant). */
  void matrix(const ParamValues& p, const Ctx& ctx) {
    if (ctx.nRouted == 0) return;
    std::fill(mods, mods + N_DESTS, 0.f);
    for (int r = 0; r < ctx.nRouted; r++) {
      const int slot = ctx.routed[r];
      const int dst = (int)p[MATRIX_DST[slot]];
      if (DEST_GLOBAL[dst]) continue;
      const int via = (int)p[MATRIX_VIA[slot]];
      mods[dst] = (float)(mods[dst] + (double)src[(int)p[MATRIX_SRC[slot]]] * p[MATRIX_AMT[slot]] * (via ? (double)src[via] : 1.0));
    }
  }

  double layoutUnison(OscSlot& s, int copies, double detune, double curve, double blend, double width, double pan, double lvl) {
    using namespace voice_detail;
    double maxRatio = 1;
    if (copies == 1) {
      s.ratio[0] = 1;
      const double th = (pan + 1) * QUARTER_PI;
      s.gl[0] = (float)(std::cos(th) * lvl); s.gr[0] = (float)(std::sin(th) * lvl);
      return 1;
    }
    const bool sup = curve >= 0.5;
    const double centreG = sup ? -0.55366 * blend + 0.99785 : 1 - 0.5 * blend;
    const double sideG = sup ? -0.73764 * blend * blend + 1.2841 * blend + 0.044372 : blend;
    const double sz = sup ? szaboDetune(detune) : 0;
    double power = 0;
    const double mid = (copies - 1) / 2.0;
    for (int c = 0; c < copies; c++) {
      const double t = (c - mid) / mid;
      if (sup) {
        const double u = ((double)c / (copies - 1)) * 6;
        const int i0 = (int)std::min(5.0, std::floor(u));
        const double f = u - i0;
        s.ratio[c] = 1 + (SZ[i0] + (SZ[i0 + 1] - SZ[i0]) * f) * sz;
      } else {
        s.ratio[c] = std::pow(2.0, (t * detune * 50) / 1200);
      }
      if (s.ratio[c] > maxRatio) maxRatio = s.ratio[c];
      const bool centre = std::abs(c - mid) < 0.51;
      const double g = centre ? (copies % 2 ? centreG : centreG * 0.7071) : sideG;
      power += g * g;
      const double pp = std::max(-1.0, std::min(1.0, pan + width * t));
      const double th = (pp + 1) * QUARTER_PI;
      s.gl[c] = (float)(std::cos(th) * g); s.gr[c] = (float)(std::sin(th) * g);
    }
    const double norm = lvl / std::sqrt(std::max(1e-6, power));
    for (int c = 0; c < copies; c++) { s.gl[c] = (float)(s.gl[c] * norm); s.gr[c] = (float)(s.gr[c] * norm); }
    return maxRatio;
  }

  double rnd = 0;
  LfoState drift, drift2;
  double driftRate = 0.2;
  bool gate = false;
  OscSlot o[3];
  LfoState lfo[4];
  StepState step[2];
  VoiceFilter f1, f2;
  Insert insA, insB;
  double subPh = 0;
  double nzL = 0, nzR = 0;
  double gain = 0, panL = 0.7071, panR = 0.7071;
  float b1L[BLOCK] {}, b1R[BLOCK] {}, b2L[BLOCK] {}, b2R[BLOCK] {}, tL[BLOCK] {}, tR[BLOCK] {}, pm[BLOCK] {};
  Rng rng;
  double fs;
};

} // namespace prism
