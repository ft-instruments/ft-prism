// The whole instrument: MIDI in, stereo audio out. C++ port of
// src/dsp/engine.ts. Construct with a sample rate (allocates), then feed
// noteOn / noteOff / controlChange / pitchBend and call process(L, R, n)
// with any n; nothing allocates after construction.
//
// Two additions over the TS, for running inside a host (as in Mycelia):
// setHostTempo() replaces the tempo knob with the host's, and
// setHostPosition() locks the free-running synced LFOs and the free
// steppers to the host's song position while it plays.
#pragma once

#include <memory>
#include <limits>
#include "Voice.h"
#include "Fx.h"
#include "Reverb.h"
#include "Arp.h"

namespace prism {

/** Told about notes the arp starts (for the UI). Called on the audio thread. */
struct NoteListener {
  virtual ~NoteListener() = default;
  virtual void engineNote(int note, double velocity) = 0;
};

class Engine {
public:
  static constexpr int MAX_VOICES = 16;
  /** MIDI channel pressure arrives as this controller number. */
  static constexpr int CC_PRESSURE = 128;

  ParamValues p {};
  NoteListener* listener = nullptr;
  double peakL = 0, peakR = 0;
  float scopeL[512] {}, scopeR[512] {};
  /** Live state for the display; the layout is PrismEngine.display's (engine.ts). */
  float display[24] {};

  explicit Engine(double sampleRate)
    : scratch(std::make_unique<OscScratch>()),
      dim(sampleRate), chorus(sampleRate), delay(sampleRate), reverb(sampleRate), eq(sampleRate), squash(sampleRate),
      dcL(sampleRate), dcR(sampleRate), warmth(sampleRate), arp(sampleRate), rng(0x51f15e), arpOut(*this), fs(sampleRate) {
    allTables();
    for (int i = 0; i < MAX_VOICES; i++) voices[i] = std::make_unique<Voice>(sampleRate, (uint32_t)(i + 1), *scratch);
    ctx.fs = sampleRate;
    for (auto& l : ctx.lfo) l.reset(0, rng);
    for (int i = 0; i < NUM_PARAMS; i++) { p[i] = PARAMS[i].def; sync(i, p[i]); }
    reroute();
  }

  int activeVoices() const {
    int c = 0;
    for (auto& v : voices) if (v->active()) c++;
    return c;
  }

  bool arpOn() const { return p[P::arpMode] >= 1; }

  // ---------------------------------------------------------------- params

  void setParam(int id, double value) {
    if (id < 0 || id >= NUM_PARAMS) return;
    const ParamDef& def = PARAMS[id];
    const double v = std::min(def.max, std::max(def.min, value));
    const double old = p[id];
    p[id] = v;
    sync(id, v);
    if (isRouting(id)) reroute();
    if (id == P::mono && v != old) allNotesOff();
    if (id == P::arpMode && v < 1 && old >= 1) arp.stop(arpOut);
  }

  /** Replace every parameter (preset load). Missing ids go to their default. */
  void loadPreset(const Preset& pr) {
    double v[NUM_PARAMS];
    for (int i = 0; i < NUM_PARAMS; i++) v[i] = PARAMS[i].def;
    for (int i = 0; i < pr.count; i++) v[pr.values[i].id] = pr.values[i].value;
    for (int i = 0; i < NUM_PARAMS; i++) setParam(i, v[i]);
  }

  // ------------------------------------------------------------- host sync

  /** The host's tempo, or <= 0 to use the tempo knob. */
  void setHostTempo(double bpm) { hostTempo = bpm; }

  /** While the host plays, the free clocks follow its position (in quarter notes). */
  void setHostPosition(bool playing, double ppq) {
    hostPlaying = playing;
    if (playing) beats = ppq;
  }

  // ------------------------------------------------------------------ MIDI

  void noteOn(int note, double velocity) {
    if (velocity <= 0) { noteOff(note); return; }
    const double vel = std::min(1.0, velocity / 127);
    if (arpOn()) arp.keyDown(note, vel, p[P::arpHold] >= 0.5 || sustain);
    else voiceOn(note, vel);
  }

  void noteOff(int note) {
    if (arpOn()) arp.keyUp(note, p[P::arpHold] >= 0.5 || sustain);
    else voiceOff(note);
  }

  void controlChange(int cc, int value) {
    switch (cc) {
      case 1: ctx.wheel = value / 127.0; break;
      case CC_PRESSURE: ctx.pressure = value / 127.0; break;
      case 64: {
        const bool on = value >= 64;
        if (on == sustain) break;
        sustain = on;
        if (!on) {
          for (auto& v : voices) {
            if (v->sustained && v->active() && !v->released()) v->noteOff();
            v->sustained = false;
          }
          if (arpOn() && p[P::arpHold] < 0.5) arp.release();
        }
        break;
      }
      case 120: case 123: allNotesOff(); break;
      default: break;
    }
  }

  /** -1..1 */
  void pitchBend(double v) { bendNorm = std::max(-1.0, std::min(1.0, v)); }

  void allNotesOff() {
    arp.stop(arpOut);
    for (auto& v : voices) if (v->active() && !v->released()) v->noteOff();
    for (auto& v : voices) v->sustained = false;
    nHeld = 0;
  }

  void panic() {
    allNotesOff();
    for (auto& v : voices) v->kill();
    warmth.clear(); dim.clear(); chorus.clear(); delay.clear(); reverb.clear(); eq.clear(); squash.clear();
  }

  // ---------------------------------------------------------------- audio

  void process(float* L, float* R, int n) {
    if (hostTempo > 0) p[P::tempo] = std::min(PARAMS[P::tempo].max, std::max(PARAMS[P::tempo].min, hostTempo));
    std::fill(L, L + n, 0.f); std::fill(R, R + n, 0.f);
    ctx.tempo = p[P::tempo];
    ctx.bend = bendNorm;
    ctx.bendSemis = bendNorm * p[P::bend];
    const int limit = std::max(1, std::min(MAX_VOICES, (int)p[P::voices]));
    for (int i = limit; i < MAX_VOICES; i++) { Voice& v = *voices[i]; if (v.active() && !v.released()) v.noteOff(); }
    const double beat0 = beats, dBeat = p[P::tempo] / (60 * fs);
    beats = beat0 + n * dBeat;
    for (int off = 0; off < n; off += BLOCK) {
      const int count = std::min(BLOCK, n - off);
      clocks(count / fs, beat0 + off * dBeat);
      if (arpOn()) arp.process(count, (int)p[P::arpMode], (int)p[P::arpRate], (int)p[P::arpOct], p[P::arpGate], p[P::arpSwing], p[P::tempo], arpOut);
      for (auto& v : voices) if (v->active()) v->render(L, R, off, count, p, ctx);
    }
    globalMatrix();
    auto c01 = [](double x) { return x < 0 ? 0.0 : x > 1 ? 1.0 : x; };
    warmth.process(L, R, n, p[P::warmth]);
    dim.process(L, R, n, p[P::dimSize], c01(p[P::dimMix] + gmods[D_DIM]));
    chorus.process(L, R, n, p[P::chRate], p[P::chDepth], c01(p[P::chMix] + gmods[D_CHORUS]));
    const double dlSeconds = p[P::dlSync] >= 0.5 ? (60 / p[P::tempo]) * voice_detail::divBeats(p[P::dlDiv]) : p[P::dlTime] / 1000;
    delay.process(L, R, n, dlSeconds, p[P::dlFb], p[P::dlPing] >= 0.5, p[P::dlDamp], p[P::dlShift], c01(p[P::dlMix] + gmods[D_DELAY]));
    reverb.process(L, R, n, p[P::rvSize], p[P::rvDecay], p[P::rvTone], p[P::rvShimmer], c01(p[P::rvMix] + gmods[D_REVERB]));
    eq.process(L, R, n, p[P::eqLow], p[P::eqHigh]);
    squash.process(L, R, n, c01(p[P::sqDepth] + gmods[D_SQUASH]), p[P::sqTime], p[P::sqUp], p[P::sqDown]);
    const double vol = p[P::volume] * p[P::volume] * 1.6;
    double pl = 0, pr = 0;
    int si = scopeIdx;
    for (int i = 0; i < n; i++) {
      const double l = softClip(dcL.tick(L[i] * vol));
      const double r = softClip(dcR.tick(R[i] * vol));
      L[i] = (float)l; R[i] = (float)r;
      const double al = l < 0 ? -l : l, ar = r < 0 ? -r : r;
      if (al > pl) pl = al;
      if (ar > pr) pr = ar;
      scopeL[si] = (float)l; scopeR[si] = (float)r; si = (si + 1) & 511;
    }
    scopeIdx = si;
    peakL = pl; peakR = pr;
    fillDisplay();
  }

private:
  /** What the arp plays into: straight to the voices. */
  struct ArpOut : NoteSink {
    Engine& e;
    explicit ArpOut(Engine& engine) : e(engine) {}
    void noteOn(int note, double velocity) override {
      e.voiceOn(note, velocity);
      if (e.listener) e.listener->engineNote(note, velocity);
    }
    void noteOff(int note) override { e.voiceOff(note); }
  };

  static bool isRouting(int id) {
    for (int i = 0; i < MATRIX_SLOTS; i++) if (id == MATRIX_SRC[i] || id == MATRIX_DST[i] || id == MATRIX_AMT[i]) return true;
    return false;
  }

  void sync(int id, double v) {
    if (CELL_TAB[id] >= 0) ctx.cells[CELL_TAB[id]][CELL_IDX[id]] = (float)v;
    else if (MACRO_IDX[id] >= 0) ctx.macros[MACRO_IDX[id]] = (float)v;
  }

  void reroute() {
    int n = 0;
    for (int i = 0; i < MATRIX_SLOTS; i++)
      if ((int)p[MATRIX_SRC[i]] != 0 && (int)p[MATRIX_DST[i]] != 0 && p[MATRIX_AMT[i]] != 0) ctx.routed[n++] = i;
    ctx.nRouted = n;
  }

  // ------------------------------------------------------------ allocation

  void voiceOn(int note, double vel) {
    if (p[P::mono] >= 0.5) {
      Voice& v = *voices[0];
      removeHeld(note);
      if (nHeld < 128) held[nHeld++] = note;
      const bool sliding = v.active() && !v.released();
      v.noteOn(note, vel, p, sliding ? v.pitch : lastPitch, sliding && p[P::legato] >= 0.5);
      if (!sliding || p[P::legato] < 0.5) v.age = ++ageCounter;
      v.sustained = false;
      newest = &v;
    } else {
      Voice& v = allocate(note);
      v.noteOn(note, vel, p, lastPitch, false);
      v.age = ++ageCounter;
      v.sustained = false;
      newest = &v;
    }
    lastPitch = note;
  }

  void voiceOff(int note) {
    if (p[P::mono] >= 0.5) {
      removeHeld(note);
      Voice& v = *voices[0];
      if (!v.active() || v.released() || v.note != note) return;
      if (nHeld > 0) {
        const int back = held[nHeld - 1];
        v.noteOn(back, v.vel, p, v.pitch, true);
        lastPitch = back;
      } else if (sustain) v.sustained = true;
      else v.noteOff();
      return;
    }
    for (auto& vp : voices) {
      Voice& v = *vp;
      if (v.note != note || !v.active() || v.released()) continue;
      if (sustain) v.sustained = true; else v.noteOff();
    }
  }

  void removeHeld(int note) {
    for (int i = 0; i < nHeld; i++) {
      if (held[i] != note) continue;
      for (int k = i; k < nHeld - 1; k++) held[k] = held[k + 1];
      nHeld--;
      return;
    }
  }

  Voice& allocate(int note) {
    const int limit = std::max(1, std::min(MAX_VOICES, (int)p[P::voices]));
    for (int i = 0; i < limit; i++) { Voice& v = *voices[i]; if (v.active() && v.note == note && !v.released()) return v; }
    for (int i = 0; i < limit; i++) if (!voices[i]->active()) return *voices[i];
    Voice* best = nullptr; double bestScore = std::numeric_limits<double>::infinity();
    for (int i = 0; i < limit; i++) {
      Voice& v = *voices[i];
      const double score = v.released() ? v.level() : 10 + v.age;
      if (score < bestScore) { bestScore = score; best = &v; }
    }
    return best ? *best : *voices[0];
  }

  // ----------------------------------------------------------------- clocks

  void clocks(double dt, double beat) {
    using voice_detail::LK; using voice_detail::SK; using voice_detail::divBeats;
    const double bps = ctx.tempo / 60;
    for (int i = 0; i < 4; i++) {
      const bool synced = p[LK[i].sync] >= 0.5;
      if (hostPlaying && synced) {
        const double c = beat / divBeats(p[LK[i].div]);
        ctx.lfo[i].lockTo(c - std::floor(c), dt, rng);
        continue;
      }
      const double rate = synced ? bps / divBeats(p[LK[i].div]) : p[LK[i].rate];
      ctx.lfo[i].advance(rate * dt, dt, rng);
    }
    for (int i = 0; i < 2; i++) {
      const int len = std::max(1, (int)p[SK[i].len]);
      if (hostPlaying) {
        const double s = beat / divBeats(p[SK[i].div]);
        ctx.steps[i].pos = s - len * std::floor(s / len);
        continue;
      }
      ctx.steps[i].advance(bps / divBeats(p[SK[i].div]), dt, len);
    }
  }

  void globalMatrix() {
    std::fill(gmods, gmods + N_DESTS, 0.f);
    if (ctx.nRouted == 0) return;
    for (int i = 0; i < 8; i++) gsrc[S_MACRO1 + i] = ctx.macros[i];
    gsrc[S_WHEEL] = (float)ctx.wheel; gsrc[S_PRESS] = (float)ctx.pressure; gsrc[S_BEND] = (float)ctx.bend;
    for (int r = 0; r < ctx.nRouted; r++) {
      const int slot = ctx.routed[r];
      const int dst = (int)p[MATRIX_DST[slot]];
      if (!DEST_GLOBAL[dst]) continue;
      const int src = (int)p[MATRIX_SRC[slot]], via = (int)p[MATRIX_VIA[slot]];
      if (!GLOBAL_SOURCE[src] || (via && !GLOBAL_SOURCE[via])) continue;
      gmods[dst] = (float)(gmods[dst] + (double)gsrc[src] * p[MATRIX_AMT[slot]] * (via ? (double)gsrc[via] : 1.0));
    }
  }

  void fillDisplay() {
    using voice_detail::LK;
    float* d = display;
    const Voice* v = newest && newest->active() ? newest : nullptr;
    static constexpr int POS[3] = { P::o1Pos, P::o2Pos, P::o3Pos };
    for (int i = 0; i < 3; i++) d[i] = (float)(v ? v->livePos(i) : p[POS[i]]);
    for (int i = 0; i < 4; i++) {
      if (v) d[3 + i] = v->src[5 + i];
      else {
        const LfoState& st = ctx.lfo[i];
        double x = lfoShape((int)p[LK[i].shape], st.phase, st.hold, st.next);
        if (p[LK[i].uni] >= 0.5) x = (x + 1) * 0.5;
        d[3 + i] = (float)x;
      }
    }
    d[7] = (float)(v && p[P::s1Retrig] >= 0.5 ? v->stepIndex(0) : ctx.steps[0].index());
    d[8] = (float)(v && p[P::s2Retrig] >= 0.5 ? v->stepIndex(1) : ctx.steps[1].index());
    d[9] = (float)activeVoices();
    d[10] = squash.meter[0]; d[11] = squash.meter[1]; d[12] = squash.meter[2];
    for (int i = 0; i < 4; i++) d[13 + i] = (float)(v ? v->env[i].value : 0);
    d[17] = v ? v->src[9] : 0.f; d[18] = v ? v->src[10] : 0.f;
  }

  std::unique_ptr<OscScratch> scratch;
  std::unique_ptr<Voice> voices[MAX_VOICES];
  Ctx ctx;
  Dimension dim; Chorus chorus; Delay delay; Reverb reverb; Eq eq;
  Squash squash;
  DCBlock dcL, dcR;
  Warmth warmth;
  Arp arp;
  Rng rng;
  ArpOut arpOut;
  double bendNorm = 0;
  bool sustain = false;
  int held[128] {};
  int nHeld = 0;
  double lastPitch = std::numeric_limits<double>::quiet_NaN();
  double ageCounter = 0;
  Voice* newest = nullptr;
  float gsrc[N_SOURCES] {}, gmods[N_DESTS] {};
  double beats = 0, hostTempo = 0;
  bool hostPlaying = false;
  int scopeIdx = 0;
  double fs;
};

} // namespace prism
