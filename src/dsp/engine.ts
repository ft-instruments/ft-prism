// The whole instrument: MIDI in, stereo audio out.
//
//   keys → [arpeggiator] → voices (3 spectral oscs + sub + noise → insert A
//   → filters → insert B → amp) → warmth → dimension → chorus → delay → reverb → eq → squash → volume → DC → clip
//
// Shaped like a plugin processor: construct with a sample rate, feed
// noteOn/noteOff/controlChange/pitchBend, call process(L, R, n).

import { Voice, BLOCK, MK, type Ctx } from './voice.ts';
import { LfoState, StepState, lfoShape } from './mod.ts';
import { Dimension, Chorus, Delay, Eq, Squash, Warmth } from './fx.ts';
import { Arp } from './arp.ts';
import { Reverb } from './reverb.ts';
import { DCBlock, Rng, softClip } from './util.ts';
import {
  D_CHORUS, D_DELAY, D_DIM, D_REVERB, D_SQUASH, DESTS, DIV_BEATS, GLOBAL_SOURCE, MATRIX_SLOTS, N_DESTS, S_BEND,
  S_MACRO1, S_PRESS, S_WHEEL, SOURCES, STEPS, defaults, PARAM_BY_ID, type ParamId, type ParamValues,
} from './params.ts';

const MAX_VOICES = 16;
/** MIDI channel pressure arrives as this controller number (above the 0–127 range). */
export const CC_PRESSURE = 128;

const LFO_KEYS = [1, 2, 3, 4].map((n) => ({ shape: `l${n}Shape`, rate: `l${n}Rate`, sync: `l${n}Sync`, div: `l${n}Div`, uni: `l${n}Uni` }));
const STEP_KEYS = [1, 2].map((n) => ({ len: `s${n}Len`, div: `s${n}Div` }));

export class PrismEngine {
  readonly p: ParamValues = defaults();
  private voices: Voice[] = [];
  private ctx: Ctx;
  private dim: Dimension; private chorus: Chorus; private delay: Delay; private reverb: Reverb; private eq: Eq;
  readonly squash: Squash;
  private dcL: DCBlock; private dcR: DCBlock;
  private warmth: Warmth;
  private arp: Arp;
  /** Notes started by the arpeggiator, for the UI (optional). */
  onNote: ((note: number, velocity: number) => void) | null = null;
  private arpOut = {
    noteOn: (n: number, v: number) => { this.voiceOn(n, v); this.onNote?.(n, Math.round(v * 127)); },
    noteOff: (n: number) => this.voiceOff(n),
  };
  private rng = new Rng(0x51f15e);
  private bendNorm = 0;
  private sustain = false;
  private sustained = new Set<Voice>();
  private held: number[] = [];          // mono: keys down, in order
  private lastNote = NaN;
  private lastPitch = NaN;
  private ageCounter = 0;
  private newest: Voice | null = null;
  private gsrc = new Float32Array(SOURCES.length);
  private gmods = new Float32Array(N_DESTS);
  private readonly fs: number;

  peakL = 0; peakR = 0;
  readonly scopeL = new Float32Array(512);
  readonly scopeR = new Float32Array(512);
  private scopeIdx = 0;
  /**
   * Live state for the display: 0–2 the newest voice's table positions,
   * 3–6 its LFOs, 7–8 the steppers' steps, 9 voices sounding, 10–12 the
   * squash per band (dB), 13–16 its envelopes, 17–18 its steppers' values.
   */
  readonly display = new Float32Array(24);

  constructor(sampleRate: number) {
    this.fs = sampleRate;
    for (let i = 0; i < MAX_VOICES; i++) this.voices.push(new Voice(sampleRate, i + 1));
    this.ctx = {
      fs: sampleRate, tempo: 120, bendSemis: 0,
      macros: new Float32Array(8), wheel: 0, pressure: 0, bend: 0,
      lfo: [new LfoState(), new LfoState(), new LfoState(), new LfoState()],
      steps: [new StepState(), new StepState()],
      cells: [new Float32Array(STEPS), new Float32Array(STEPS)],
      routed: new Int32Array(MATRIX_SLOTS), nRouted: 0,
    };
    const rnd = () => this.rng.next();
    for (const l of this.ctx.lfo) l.reset(0, rnd);
    this.dim = new Dimension(sampleRate); this.chorus = new Chorus(sampleRate);
    this.delay = new Delay(sampleRate); this.reverb = new Reverb(sampleRate);
    this.eq = new Eq(sampleRate); this.squash = new Squash(sampleRate);
    this.dcL = new DCBlock(sampleRate); this.dcR = new DCBlock(sampleRate);
    this.warmth = new Warmth(sampleRate);
    this.arp = new Arp(sampleRate);
    for (const id in this.p) this.sync(id, this.p[id]);
    this.reroute();
  }

  get activeVoices(): number {
    let c = 0;
    for (const v of this.voices) if (v.active) c++;
    return c;
  }

  // ---------------------------------------------------------------- params

  setParam(id: ParamId, value: number): void {
    const def = PARAM_BY_ID[id];
    if (!def) return;
    const v = Math.min(def.max, Math.max(def.min, value));
    const old = this.p[id];
    this.p[id] = v;
    this.sync(id, v);
    if (id.charCodeAt(0) === 109 /* m */ && /^m\d+(Src|Dst|Amt)$/.test(id)) this.reroute();
    if (id === 'mono' && v !== old) this.allNotesOff();
    if (id === 'arpMode' && v < 1 && old >= 1) this.arp.stop(this.arpOut);
  }

  private sync(id: ParamId, v: number): void {
    const def = PARAM_BY_ID[id];
    if (def?.tab) this.ctx.cells[def.tab === 's1' ? 0 : 1][def.idx!] = v;
    else if (id.startsWith('macro')) this.ctx.macros[Number(id.slice(5)) - 1] = v;
  }

  /** The slots that do something: the matrix's list of work. */
  private reroute(): void {
    const p = this.p;
    let n = 0;
    for (let i = 0; i < MATRIX_SLOTS; i++) {
      const k = MK[i];
      if ((p[k.src] | 0) !== 0 && (p[k.dst] | 0) !== 0 && p[k.amt] !== 0) this.ctx.routed[n++] = i;
    }
    this.ctx.nRouted = n;
  }

  setParams(values: Partial<ParamValues>): void {
    for (const id in values) this.setParam(id, values[id]!);
  }

  /** Replace every parameter (preset load). Missing ids go to their default. */
  loadPreset(values: Partial<ParamValues>): void {
    const d = defaults();
    for (const id in d) this.setParam(id, values[id] ?? d[id]);
  }

  // ------------------------------------------------------------------ MIDI

  get arpOn(): boolean { return this.p.arpMode >= 1; }

  noteOn(note: number, velocity: number): void {
    if (velocity <= 0) { this.noteOff(note); return; }
    const vel = Math.min(1, velocity / 127);
    if (this.arpOn) this.arp.keyDown(note, vel, this.p.arpHold >= 0.5 || this.sustain);
    else this.voiceOn(note, vel);
  }

  noteOff(note: number): void {
    if (this.arpOn) this.arp.keyUp(note, this.p.arpHold >= 0.5 || this.sustain);
    else this.voiceOff(note);
  }

  private voiceOn(note: number, vel: number): void {
    const p = this.p;
    if (p.mono >= 0.5) {
      const v = this.voices[0];
      const idx = this.held.indexOf(note);
      if (idx >= 0) this.held.splice(idx, 1);
      this.held.push(note);
      const sliding = v.active && !v.released;
      v.noteOn(note, vel, p, this.ctx, sliding ? v.pitch : this.lastPitch, sliding && p.legato >= 0.5);
      if (!sliding || p.legato < 0.5) v.age = ++this.ageCounter;
      this.sustained.delete(v);
      this.newest = v;
    } else {
      const v = this.allocate(note);
      v.noteOn(note, vel, p, this.ctx, this.lastPitch, false);
      v.age = ++this.ageCounter;
      this.sustained.delete(v);
      this.newest = v;
    }
    this.lastNote = note;
    this.lastPitch = note;
  }

  private voiceOff(note: number): void {
    if (this.p.mono >= 0.5) {
      const idx = this.held.indexOf(note);
      if (idx >= 0) this.held.splice(idx, 1);
      const v = this.voices[0];
      if (!v.active || v.released || v.note !== note) return;
      if (this.held.length > 0) {
        // fall back to the last key still held, legato
        const back = this.held[this.held.length - 1];
        v.noteOn(back, v.vel, this.p, this.ctx, v.pitch, true);
        this.lastPitch = back;
      } else if (this.sustain) this.sustained.add(v);
      else v.noteOff();
      return;
    }
    for (const v of this.voices) {
      if (v.note !== note || !v.active || v.released) continue;
      if (this.sustain) this.sustained.add(v); else v.noteOff();
    }
  }

  controlChange(cc: number, value: number): void {
    switch (cc) {
      case 1: this.ctx.wheel = value / 127; break;
      case CC_PRESSURE: this.ctx.pressure = value / 127; break;
      case 64: {
        const on = value >= 64;
        if (on === this.sustain) break;
        this.sustain = on;
        if (!on) {
          for (const v of this.sustained) if (v.active && !v.released) v.noteOff();
          this.sustained.clear();
          if (this.arpOn && this.p.arpHold < 0.5) this.arp.release();
        }
        break;
      }
      case 120: case 123: this.allNotesOff(); break;
      default: break;
    }
  }

  /** -1..1 */
  pitchBend(v: number): void { this.bendNorm = Math.max(-1, Math.min(1, v)); }

  allNotesOff(): void {
    this.arp.stop(this.arpOut);
    for (const v of this.voices) if (v.active && !v.released) v.noteOff();
    this.sustained.clear();
    this.held = [];
  }

  panic(): void {
    this.allNotesOff();
    for (const v of this.voices) v.kill();
    this.warmth.clear(); this.dim.clear(); this.chorus.clear(); this.delay.clear(); this.reverb.clear(); this.eq.clear(); this.squash.clear();
  }

  private allocate(note: number): Voice {
    const limit = Math.max(1, Math.min(MAX_VOICES, this.p.voices | 0));
    for (let i = 0; i < limit; i++) { const v = this.voices[i]; if (v.active && v.note === note && !v.released) return v; }
    for (let i = 0; i < limit; i++) if (!this.voices[i].active) return this.voices[i];
    // steal: the quietest released voice, else the oldest held one
    let best: Voice | null = null, bestScore = Infinity;
    for (let i = 0; i < limit; i++) {
      const v = this.voices[i];
      const score = v.released ? v.level : 10 + v.age;
      if (score < bestScore) { bestScore = score; best = v; }
    }
    return best ?? this.voices[0];
  }

  // ---------------------------------------------------------------- audio

  /** The free-running LFOs and steppers, for voices that don't retrigger theirs. */
  private clocks(dt: number): void {
    const p = this.p, beat = this.ctx.tempo / 60;
    const rnd = () => this.rng.next();
    for (let i = 0; i < 4; i++) {
      const k = LFO_KEYS[i];
      const rate = p[k.sync] >= 0.5 ? beat / DIV_BEATS[p[k.div] | 0] : p[k.rate];
      this.ctx.lfo[i].advance(rate * dt, dt, rnd);
    }
    for (let i = 0; i < 2; i++) {
      const k = STEP_KEYS[i];
      this.ctx.steps[i].advance(beat / DIV_BEATS[p[k.div] | 0], dt, Math.max(1, p[k.len] | 0));
    }
  }

  /** Matrix slots aimed at the master effects hear only the sources every voice shares. */
  private globalMatrix(): void {
    const g = this.gmods;
    g.fill(0);
    const ctx = this.ctx, p = this.p;
    if (ctx.nRouted === 0) return;
    const s = this.gsrc;
    for (let i = 0; i < 8; i++) s[S_MACRO1 + i] = ctx.macros[i];
    s[S_WHEEL] = ctx.wheel; s[S_PRESS] = ctx.pressure; s[S_BEND] = ctx.bend;
    for (let r = 0; r < ctx.nRouted; r++) {
      const k = MK[ctx.routed[r]];
      const dst = p[k.dst] | 0;
      if (!DESTS[dst].global) continue;
      const src = p[k.src] | 0, via = p[k.via] | 0;
      if (!GLOBAL_SOURCE[src] || (via && !GLOBAL_SOURCE[via])) continue;
      g[dst] += s[src] * p[k.amt] * (via ? s[via] : 1);
    }
  }

  process(L: Float32Array, R: Float32Array, n: number): void {
    const p = this.p, ctx = this.ctx;
    L.fill(0, 0, n); R.fill(0, 0, n);
    ctx.tempo = p.tempo;
    ctx.bend = this.bendNorm;
    ctx.bendSemis = this.bendNorm * p.bend;
    const limit = Math.max(1, Math.min(MAX_VOICES, p.voices | 0));
    for (let i = limit; i < MAX_VOICES; i++) { const v = this.voices[i]; if (v.active && !v.released) v.noteOff(); }
    for (let off = 0; off < n; off += BLOCK) {
      const count = Math.min(BLOCK, n - off);
      this.clocks(count / this.fs);
      if (this.arpOn) this.arp.process(count, p.arpMode | 0, p.arpRate | 0, p.arpOct | 0, p.arpGate, p.arpSwing, p.tempo, this.arpOut);
      for (const v of this.voices) if (v.active) v.render(L, R, off, count, p, ctx);
    }
    const trim = 1;
    for (let i = 0; i < n; i++) { L[i] *= trim; R[i] *= trim; }
    // the master chain
    this.globalMatrix();
    const g = this.gmods;
    const c01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x);
    this.warmth.process(L, R, n, p.warmth);
    this.dim.process(L, R, n, p.dimSize, c01(p.dimMix + g[D_DIM]));
    this.chorus.process(L, R, n, p.chRate, p.chDepth, c01(p.chMix + g[D_CHORUS]));
    const dlSeconds = p.dlSync >= 0.5 ? (60 / p.tempo) * DIV_BEATS[p.dlDiv | 0] : p.dlTime / 1000;
    this.delay.process(L, R, n, dlSeconds, p.dlFb, p.dlPing >= 0.5, p.dlDamp, p.dlShift, c01(p.dlMix + g[D_DELAY]));
    this.reverb.process(L, R, n, p.rvSize, p.rvDecay, p.rvTone, p.rvShimmer, c01(p.rvMix + g[D_REVERB]));
    this.eq.process(L, R, n, p.eqLow, p.eqHigh);
    this.squash.process(L, R, n, c01(p.sqDepth + g[D_SQUASH]), p.sqTime, p.sqUp, p.sqDown);
    // volume, DC, safety clip, meters, scope
    const vol = p.volume * p.volume * 1.6;
    let pl = 0, pr = 0;
    const sL = this.scopeL, sR = this.scopeR; let si = this.scopeIdx;
    for (let i = 0; i < n; i++) {
      const l = softClip(this.dcL.tick(L[i] * vol));
      const r = softClip(this.dcR.tick(R[i] * vol));
      L[i] = l; R[i] = r;
      const al = l < 0 ? -l : l, ar = r < 0 ? -r : r;
      if (al > pl) pl = al; if (ar > pr) pr = ar;
      sL[si] = l; sR[si] = r; si = (si + 1) & 511;
    }
    this.scopeIdx = si;
    this.peakL = pl; this.peakR = pr;
    this.fillDisplay();
  }

  private fillDisplay(): void {
    const d = this.display, v = this.newest && this.newest.active ? this.newest : null;
    const p = this.p;
    for (let i = 0; i < 3; i++) d[i] = v ? v.livePos(i) : p[`o${i + 1}Pos`];
    for (let i = 0; i < 4; i++) {
      if (v) d[3 + i] = v.src[5 + i];
      else {
        const st = this.ctx.lfo[i], k = LFO_KEYS[i];
        let x = lfoShape(p[k.shape] | 0, st.phase, st.hold, st.next);
        if (p[k.uni] >= 0.5) x = (x + 1) * 0.5;
        d[3 + i] = x;
      }
    }
    d[7] = v && p.s1Retrig >= 0.5 ? v.stepIndex(0) : this.ctx.steps[0].index;
    d[8] = v && p.s2Retrig >= 0.5 ? v.stepIndex(1) : this.ctx.steps[1].index;
    d[9] = this.activeVoices;
    d[10] = this.squash.meter[0]; d[11] = this.squash.meter[1]; d[12] = this.squash.meter[2];
    for (let i = 0; i < 4; i++) d[13 + i] = v ? v.env[i].value : 0;
    d[17] = v ? v.src[9] : 0; d[18] = v ? v.src[10] : 0;
  }
}
