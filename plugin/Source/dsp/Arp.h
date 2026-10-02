// Arpeggiator: held keys in, timed note-on/offs out. C++ port of
// src/dsp/arp.ts with fixed arrays in place of the TS arrays and set, so
// nothing allocates on the audio thread.
#pragma once

#include <cstdint>
#include "Util.h"

namespace prism {

struct NoteSink {
  virtual ~NoteSink() = default;
  virtual void noteOn(int note, double velocity) = 0;
  virtual void noteOff(int note) = 0;
};

class Arp {
public:
  explicit Arp(double sampleRate) : fs(sampleRate) {}

  void keyDown(int note, double vel, bool hold) {
    if (hold && downCount == 0) { nHeld = 0; nLatched = 0; }
    setDown(note, true);
    bool there = false;
    for (int i = 0; i < nHeld; i++) if (held[i].note == note) { there = true; break; }
    if (!there && nHeld < MAX_KEYS) held[nHeld++] = { note, vel };
    latch();
  }

  void keyUp(int note, bool hold) {
    setDown(note, false);
    if (!hold) { removeHeld(note); latch(); }
    else if (downCount == 0) { /* keep latched */ }
    else removeHeld(note);
  }

  /** Hold (pedal) released: drop everything except the keys still physically down. */
  void release() {
    int w = 0;
    for (int i = 0; i < nHeld; i++) if (isDown(held[i].note)) held[w++] = held[i];
    nHeld = w;
    latch();
  }

  void stop(NoteSink& out) {
    for (int i = 0; i < nSounding; i++) out.noteOff(sounding[i].note);
    nSounding = 0;
    nHeld = 0; nLatched = 0;
    for (auto& d : down) d = false;
    downCount = 0;
    countdown = 0; step = 0; wasOn = false;
  }

  bool active() const { return nLatched > 0; }

  void process(int n, int mode, int rateIdx, int octaves, double gate, double swing, double tempo, NoteSink& out) {
    for (int i = nSounding - 1; i >= 0; i--) {
      Sounding& s = sounding[i];
      s.off -= n;
      if (s.off <= 0) { const int note = s.note; out.noteOff(note); eraseSounding(i); }
    }
    const int len = sequence(mode, octaves);
    if (len == 0) { wasOn = false; countdown = 0; return; }
    if (!wasOn) { wasOn = true; step = 0; dir = 1; countdown = 0; }
    countdown -= n;
    if (countdown > 0) return;
    const double beat = rateIdx >= 0 && rateIdx < NUM_ARP_RATES ? ARP_BEATS[rateIdx] : 0.25;
    const double stepLen = beat * 60 / tempo * fs;
    const bool even = (step & 1) == 0;
    const double dur = stepLen * (even ? 1 + swing : 1 - swing);
    countdown += dur;
    if (countdown < 0) countdown = dur;
    const double gateLen = std::max(16.0, dur * gate);
    auto fire = [&](const Held& h) {
      for (int i = 0; i < nSounding; i++) {
        if (sounding[i].note != h.note) continue;
        out.noteOff(h.note); eraseSounding(i);
        break;
      }
      out.noteOn(h.note, h.vel);
      if (nSounding < MAX_SOUNDING) sounding[nSounding++] = { h.note, gateLen };
    };
    if (mode == 6) {
      for (int i = 0; i < len; i++) fire(seq[i]);
    } else {
      int i;
      if (mode == 4) i = (int)std::floor(rand() * len);
      else if (mode == 3) {
        if (len == 1) i = 0;
        else {
          const int cycle = 2 * len - 2;
          const int k = step % cycle;
          i = k < len ? k : cycle - k;
        }
      } else i = step % len;
      fire(seq[std::min(i, len - 1)]);
    }
    step++;
  }

private:
  static constexpr int MAX_KEYS = 128;
  static constexpr int MAX_SEQ = MAX_KEYS * 4;
  static constexpr int MAX_SOUNDING = MAX_SEQ;
  struct Held { int note; double vel; };
  struct Sounding { int note; double off; };

  bool isDown(int note) const { return note >= 0 && note < 128 && down[note]; }
  void setDown(int note, bool on) {
    if (note < 0 || note >= 128 || down[note] == on) return;
    down[note] = on;
    downCount += on ? 1 : -1;
  }
  void removeHeld(int note) {
    int w = 0;
    for (int i = 0; i < nHeld; i++) if (held[i].note != note) held[w++] = held[i];
    nHeld = w;
  }
  void latch() { for (int i = 0; i < nHeld; i++) latched[i] = held[i]; nLatched = nHeld; }
  void eraseSounding(int i) {
    for (int k = i; k < nSounding - 1; k++) sounding[k] = sounding[k + 1];
    nSounding--;
  }

  double rand() {
    uint32_t x = rng;
    x ^= x << 13; x ^= x >> 17; x ^= x << 5;
    rng = x;
    return x / 4294967296.0;
  }

  /** Fills seq; returns its length. */
  int sequence(int mode, int octaves) {
    if (nLatched == 0) return 0;
    Held notes[MAX_KEYS];
    for (int i = 0; i < nLatched; i++) notes[i] = latched[i];
    if (mode == 1 || mode == 2 || mode == 3) {
      // insertion sort: stable, like Array.prototype.sort
      for (int i = 1; i < nLatched; i++) {
        const Held h = notes[i];
        int j = i - 1;
        while (j >= 0 && notes[j].note > h.note) { notes[j + 1] = notes[j]; j--; }
        notes[j + 1] = h;
      }
    }
    int len = 0;
    for (int o = 0; o < octaves && len < MAX_SEQ; o++)
      for (int i = 0; i < nLatched && len < MAX_SEQ; i++) seq[len++] = { notes[i].note + 12 * o, notes[i].vel };
    if (mode == 2) for (int a = 0, b = len - 1; a < b; a++, b--) std::swap(seq[a], seq[b]);
    return len;
  }

  Held held[MAX_KEYS] {}, latched[MAX_KEYS] {};
  int nHeld = 0, nLatched = 0;
  bool down[128] {};
  int downCount = 0;
  Held seq[MAX_SEQ] {};
  Sounding sounding[MAX_SOUNDING] {};
  int nSounding = 0;
  int step = 0, dir = 1;
  double countdown = 0;
  uint32_t rng = 12345;
  bool wasOn = false;
  double fs;
};

} // namespace prism
