// One voice: three spectral oscillators with unison, a sub and noise, insert
// A, two filters (serial or parallel), insert B, the amp. Rendered in blocks
// of up to 64 samples; modulation is computed once per block and ramped.

import { SpectralOsc, MAX_UNISON, bandLimit, type Shape } from './oscillator.ts';
import { getTable } from './tables.ts';
import { Env, LfoState, StepState, lfoShape } from './mod.ts';
import { VoiceFilter } from './filter.ts';
import { Insert } from './inserts.ts';
import { midiToFreq, Rng } from './util.ts';
import {
  D_AMP, D_F1CUT, D_F1RES, D_F2CUT, D_F2RES, D_INSA, D_INSB, D_NOISE, D_OSC, D_PAN, D_PITCH, D_PM, D_SUB,
  DESTS, DIV_BEATS, N_DESTS, S_BEND, S_ENV1, S_KEY, S_LFO1, S_MACRO1, S_PRESS, S_RANDOM, S_STEP1, S_VEL, S_WHEEL, SOURCES,
  W_FORMANT, type ParamValues,
} from './params.ts';

export const BLOCK = 64;

/** What the engine shares with every voice for a block. */
export interface Ctx {
  fs: number;
  tempo: number;
  bendSemis: number;
  macros: Float32Array;        // 8
  wheel: number; pressure: number; bend: number;
  lfo: LfoState[];             // free-running LFOs (used when a voice's LFO doesn't retrigger)
  steps: StepState[];          // free-running steppers
  cells: Float32Array[];       // the two steppers' 16 cells
  /** matrix slots that are routed (source, destination and amount all set), as slot indices */
  routed: Int32Array;
  nRouted: number;
}

// Adam Szabo's measurements of the JP-8000 supersaw: the seven oscillators'
// relative offsets, the detune knob's curve, and the centre/side mix.
const SZ = [-0.11002313, -0.06288439, -0.01952356, 0, 0.01991221, 0.06216538, 0.10745242];
function szaboDetune(x: number): number {
  return ((((((((((10028.7312891634 * x - 50818.8652045924) * x + 111363.4808729368) * x - 138150.6761080548) * x
    + 106649.6679158292) * x - 53046.9642751875) * x + 17019.9518580080) * x - 3425.0836591318) * x + 404.2703938388) * x
    - 24.1878824391) * x + 0.6717417634) * x + 0.0030115596;
}

const QUARTER_PI = Math.PI / 4;
const ORDER = [2, 0, 1];      // osc 3 first: it is the phase modulator of 1 and 2

// parameter ids, built once so the audio loop never concatenates strings
const OK = [1, 2, 3].map((n) => ({
  level: `o${n}Level`, table: `o${n}Table`, pos: `o${n}Pos`, morph: `o${n}Morph`, warp: `o${n}Warp`, amt: `o${n}Amt`,
  oct: `o${n}Oct`, semi: `o${n}Semi`, fine: `o${n}Fine`, pan: `o${n}Pan`, uni: `o${n}Uni`, detune: `o${n}Detune`,
  curve: `o${n}Curve`, blend: `o${n}Blend`, width: `o${n}Width`, phase: `o${n}Phase`, route: `o${n}Route`,
}));
const EK = [1, 2, 3, 4].map((n) => ({ a: `e${n}Atk`, d: `e${n}Dec`, s: `e${n}Sus`, r: `e${n}Rel`, c: `e${n}Curve`, mode: `e${n}Mode` }));
const LK = [1, 2, 3, 4].map((n) => ({ shape: `l${n}Shape`, rate: `l${n}Rate`, sync: `l${n}Sync`, div: `l${n}Div`, retrig: `l${n}Retrig`, phase: `l${n}Phase`, fade: `l${n}Fade`, uni: `l${n}Uni` }));
const SK = [1, 2].map((n) => ({ len: `s${n}Len`, div: `s${n}Div`, glide: `s${n}Glide`, retrig: `s${n}Retrig` }));
export const MK = Array.from({ length: 16 }, (_, i) => ({ src: `m${i + 1}Src`, dst: `m${i + 1}Dst`, amt: `m${i + 1}Amt`, via: `m${i + 1}Via` }));

class OscSlot {
  osc = new SpectralOsc();
  ratio = new Float64Array(MAX_UNISON);
  gl = new Float32Array(MAX_UNISON);
  gr = new Float32Array(MAX_UNISON);
  inc = -1;            // last block's base increment
  shape: Shape;
  livePos = 0;
  constructor() {
    this.shape = { table: getTable(0), tableId: 0, pos: 0, spectral: true, warp: 0, amt: 0, hb: 1, f0: 100 };
  }
}

export class Voice {
  note = 60;
  vel = 1;
  age = 0;                     // incremented on every note-on in the engine
  pitch = 60;                  // current (gliding) pitch
  target = 60;
  private rnd = 0;             // per-note random, −1..1
  private drift = new LfoState();    // slow wander of pitch and position, its own per voice
  private drift2 = new LfoState();
  private driftRate = 0.2;
  private gate = false;
  private o: OscSlot[] = [new OscSlot(), new OscSlot(), new OscSlot()];
  readonly env = [new Env(), new Env(), new Env(), new Env()];
  private lfo = [new LfoState(), new LfoState(), new LfoState(), new LfoState()];
  private step = [new StepState(), new StepState()];
  private f1: VoiceFilter; private f2: VoiceFilter;
  private insA: Insert; private insB: Insert;
  private subPh = 0;
  private nzL = 0; private nzR = 0;
  private gain = 0; private panL = 0.7071; private panR = 0.7071;
  private b1L = new Float32Array(BLOCK); private b1R = new Float32Array(BLOCK);
  private b2L = new Float32Array(BLOCK); private b2R = new Float32Array(BLOCK);
  private tL = new Float32Array(BLOCK); private tR = new Float32Array(BLOCK);
  private pm = new Float32Array(BLOCK);
  readonly src = new Float32Array(SOURCES.length);
  readonly mods = new Float32Array(N_DESTS);
  private rng: Rng;
  private readonly rand: () => number;
  private readonly fs: number;

  constructor(sampleRate: number, seed: number) {
    this.fs = sampleRate;
    this.rng = new Rng(seed * 7919 + 17);
    this.rand = () => this.rng.next();
    this.f1 = new VoiceFilter(sampleRate); this.f2 = new VoiceFilter(sampleRate);
    this.insA = new Insert(sampleRate); this.insB = new Insert(sampleRate);
    this.drift.reset(this.rng.next(), this.rand); this.drift2.reset(this.rng.next(), this.rand);
    this.driftRate = 0.13 + this.rng.next() * 0.17;
  }

  get active(): boolean { return this.env[0].active; }
  get released(): boolean { return !this.gate; }
  get level(): number { return this.env[0].value; }
  /** The stepper's current step (its own when it retriggers per note). */
  stepIndex(i: number): number { return this.step[i].index; }
  /** The newest voice's live table positions, for the display. */
  livePos(i: number): number { return this.o[i].livePos; }

  noteOn(note: number, vel: number, p: ParamValues, ctx: Ctx, glideFrom: number, legato: boolean): void {
    const wasActive = this.active;
    this.note = note; this.vel = vel; this.target = note;
    this.pitch = Number.isFinite(glideFrom) && p.glide > 0 ? glideFrom : note;
    if (legato && wasActive && this.gate) return;          // a held mono voice just slides
    this.gate = true;
    this.rnd = this.rand() * 2 - 1;
    if (!wasActive) {
      this.f1.clear(); this.f2.clear(); this.insA.clear(); this.insB.clear();
      this.gain = 0; this.subPh = 0;
      for (const s of this.o) s.inc = -1;
    }
    for (let i = 0; i < 4; i++) this.env[i].gate(true);
    for (let i = 0; i < 4; i++) if (p[LK[i].retrig] >= 0.5) this.lfo[i].reset(p[LK[i].phase], this.rand);
    for (let i = 0; i < 4; i++) this.lfo[i].age = 0;
    for (let i = 0; i < 2; i++) if (p[SK[i].retrig] >= 0.5) this.step[i].reset();
    for (let i = 0; i < 3; i++) this.o[i].osc.reset(p[OK[i].phase], this.rand);
    void ctx;
  }

  noteOff(): void {
    this.gate = false;
    for (const e of this.env) e.gate(false);
  }

  kill(): void {
    this.gate = false;
    for (const e of this.env) e.kill();
    this.gain = 0;
  }

  // ------------------------------------------------------------- modulation

  private modulate(p: ParamValues, ctx: Ctx, dt: number): void {
    const src = this.src;
    for (let i = 0; i < 4; i++) {
      const k = EK[i];
      src[S_ENV1 + i] = this.env[i].step(dt, p[k.a], p[k.d], p[k.s], p[k.r], p[k.c], p[k.mode] >= 0.5);
    }
    const beat = ctx.tempo / 60;
    for (let i = 0; i < 4; i++) {
      const k = LK[i];
      const rate = p[k.sync] >= 0.5 ? beat / DIV_BEATS[p[k.div] | 0] : p[k.rate];
      const own = p[k.retrig] >= 0.5;
      const st = own ? this.lfo[i] : ctx.lfo[i];
      if (own) this.lfo[i].advance(rate * dt, dt, this.rand); else this.lfo[i].age += dt;
      let v = lfoShape(p[k.shape] | 0, st.phase, st.hold, st.next);
      if (p[k.uni] >= 0.5) v = (v + 1) * 0.5;
      const fade = p[k.fade];
      if (fade > 0) v *= Math.min(1, this.lfo[i].age / fade);
      src[S_LFO1 + i] = v;
    }
    for (let i = 0; i < 2; i++) {
      const k = SK[i];
      const len = Math.max(1, p[k.len] | 0);
      const own = p[k.retrig] >= 0.5;
      const st = own ? this.step[i] : ctx.steps[i];
      if (own) st.advance(beat / DIV_BEATS[p[k.div] | 0], dt, len);
      src[S_STEP1 + i] = st.value(ctx.cells[i], len, p[k.glide]);
    }
    for (let i = 0; i < 8; i++) src[S_MACRO1 + i] = ctx.macros[i];
    src[S_VEL] = this.vel;
    src[S_KEY] = (this.note - 60) / 60;
    src[S_WHEEL] = ctx.wheel;
    src[S_PRESS] = ctx.pressure;
    src[S_BEND] = ctx.bend;
    src[S_RANDOM] = this.rnd;
    this.matrix(p, ctx);
  }

  /**
   * The modulation matrix. With nothing routed it returns before touching
   * anything, so a patch that uses no slots renders exactly as if the
   * matrix did not exist.
   */
  private matrix(p: ParamValues, ctx: Ctx): void {
    const mods = this.mods;
    if (ctx.nRouted === 0) return;
    mods.fill(0);
    const src = this.src;
    for (let r = 0; r < ctx.nRouted; r++) {
      const k = MK[ctx.routed[r]];
      const dst = p[k.dst] | 0;
      if (DESTS[dst].global) continue;
      const via = p[k.via] | 0;
      mods[dst] += src[p[k.src] | 0] * p[k.amt] * (via ? src[via] : 1);
    }
  }

  // ------------------------------------------------------------------ audio

  private layoutUnison(s: OscSlot, copies: number, detune: number, curve: number, blend: number, width: number, pan: number, level: number): number {
    const { ratio, gl, gr } = s;
    let maxRatio = 1;
    if (copies === 1) {
      ratio[0] = 1;
      const th = (pan + 1) * QUARTER_PI;
      gl[0] = Math.cos(th) * level; gr[0] = Math.sin(th) * level;
      return 1;
    }
    const sup = curve >= 0.5;
    const centreG = sup ? -0.55366 * blend + 0.99785 : 1 - 0.5 * blend;
    const sideG = sup ? -0.73764 * blend * blend + 1.2841 * blend + 0.044372 : blend;
    const sz = sup ? szaboDetune(detune) : 0;
    let power = 0;
    const mid = (copies - 1) / 2;
    for (let c = 0; c < copies; c++) {
      const t = (c - mid) / mid;                      // −1..1
      if (sup) {
        const u = (c / (copies - 1)) * 6, i0 = Math.min(5, Math.floor(u)), f = u - i0;
        ratio[c] = 1 + (SZ[i0] + (SZ[i0 + 1] - SZ[i0]) * f) * sz;
      } else {
        ratio[c] = Math.pow(2, (t * detune * 50) / 1200);
      }
      if (ratio[c] > maxRatio) maxRatio = ratio[c];
      const centre = Math.abs(c - mid) < 0.51;
      const g = centre ? (copies % 2 ? centreG : centreG * 0.7071) : sideG;
      power += g * g;
      const pp = Math.max(-1, Math.min(1, pan + width * t));
      const th = (pp + 1) * QUARTER_PI;
      gl[c] = Math.cos(th) * g; gr[c] = Math.sin(th) * g;
    }
    const norm = level / Math.sqrt(Math.max(1e-6, power));
    for (let c = 0; c < copies; c++) { gl[c] *= norm; gr[c] *= norm; }
    return maxRatio;
  }

  render(L: Float32Array, R: Float32Array, off: number, n: number, p: ParamValues, ctx: Ctx): void {
    const fs = this.fs, dt = n / fs;
    this.modulate(p, ctx, dt);
    const mods = this.mods;
    const routed = ctx.nRouted > 0;
    const m = (d: number) => (routed ? mods[d] * DESTS[d].range : 0);

    // pitch: glide, bend, modulation
    const glide = p.glide;
    if (glide > 0 && this.pitch !== this.target) {
      this.pitch += (this.target - this.pitch) * (1 - Math.exp(-dt / (glide * 0.35)));
      if (Math.abs(this.target - this.pitch) < 1e-3) this.pitch = this.target;
    } else this.pitch = this.target;
    // drift: each voice wanders a little in pitch and in table position, like a living thing
    let driftPos = 0, driftCt = 0;
    if (p.drift > 0) {
      this.drift.advance(this.driftRate * dt, dt, this.rand);
      this.drift2.advance(this.driftRate * 0.71 * dt, dt, this.rand);
      driftCt = lfoShape(6, this.drift.phase, this.drift.hold, this.drift.next) * p.drift * 14;
      driftPos = lfoShape(6, this.drift2.phase, this.drift2.hold, this.drift2.next) * p.drift * 0.06;
    }
    const base = this.pitch + ctx.bendSemis + m(D_PITCH) + driftCt / 100;
    const f0base = midiToFreq(base);

    const b1L = this.b1L, b1R = this.b1R, b2L = this.b2L, b2R = this.b2R, tL = this.tL, tR = this.tR, pm = this.pm;
    b1L.fill(0, 0, n); b1R.fill(0, 0, n); b2L.fill(0, 0, n); b2R.fill(0, 0, n);
    const parallel = p.fRoute >= 0.5;
    const pm1 = Math.max(0, Math.min(1, p.o1Pm + m(D_PM))), pm2 = Math.max(0, Math.min(1, p.o2Pm + m(D_PM)));
    let pmReady = false;

    for (const oi of ORDER) {
      const k = OK[oi];
      const d0 = D_OSC(oi);
      const s = this.o[oi];
      const level = Math.max(0, Math.min(1, p[k.level] + m(d0 + 2)));
      const needPm = oi === 2 && (pm1 > 0 || pm2 > 0);
      if (level <= 0 && !needPm) { s.inc = -1; continue; }
      const pitch = base + p[k.oct] * 12 + p[k.semi] + p[k.fine] / 100 + m(d0 + 3);
      const f0 = midiToFreq(pitch);
      const inc1 = f0 / fs, inc0 = s.inc < 0 ? inc1 : s.inc;
      s.inc = inc1;
      const copies = Math.max(1, Math.min(MAX_UNISON, p[k.uni] | 0));
      const detune = Math.max(0, Math.min(1, p[k.detune] + m(d0 + 4)));
      const pan = Math.max(-1, Math.min(1, p[k.pan] + m(d0 + 5)));
      // osc 3 renders at unit level when it is (also) the phase modulator; its level is applied after
      const maxRatio = this.layoutUnison(s, copies, detune, p[k.curve], p[k.blend], p[k.width], pan, oi === 2 ? 1 : level);
      const sh = s.shape;
      const tid = p[k.table] | 0;
      sh.tableId = tid; sh.table = getTable(tid);
      sh.pos = Math.max(0, Math.min(1, p[k.pos] + m(d0) + driftPos));
      sh.spectral = p[k.morph] >= 0.5;
      sh.warp = p[k.warp] | 0;
      sh.amt = Math.max(-1, Math.min(1, p[k.amt] + m(d0 + 1)));
      sh.hb = bandLimit(fs, f0 * maxRatio * Math.max(1, inc0 / inc1));
      sh.f0 = sh.warp === W_FORMANT ? f0 : 0;
      s.livePos = sh.pos;
      s.osc.update(sh);
      tL.fill(0, 0, n); tR.fill(0, 0, n);
      const usePm = oi === 0 ? pm1 : oi === 1 ? pm2 : 0;
      s.osc.render(tL, tR, 0, n, inc0, inc1, copies, s.ratio, s.gl, s.gr, pmReady && usePm > 0 ? pm : null, usePm * 1.5);
      if (oi === 2) {
        if (needPm) { for (let i = 0; i < n; i++) pm[i] = (tL[i] + tR[i]) * 0.7071; pmReady = true; }
        if (level <= 0) continue;
        for (let i = 0; i < n; i++) { tL[i] *= level; tR[i] *= level; }
      }
      const route = parallel ? Math.max(0, Math.min(1, p[k.route])) : 0;
      const k1 = 1 - route, k2 = route;
      for (let i = 0; i < n; i++) {
        b1L[i] += tL[i] * k1; b1R[i] += tR[i] * k1;
        if (k2 > 0) { b2L[i] += tL[i] * k2; b2R[i] += tR[i] * k2; }
      }
    }

    // sub: a plain sine or triangle an octave or two down, centred, into filter 1
    const subLevel = Math.max(0, Math.min(1, p.subLevel + m(D_SUB)));
    if (subLevel > 0) {
      const inc = (f0base * Math.pow(2, p.subOct)) / fs;
      const tri = p.subShape >= 0.5;
      let ph = this.subPh;
      const g = subLevel * 0.7071;
      for (let i = 0; i < n; i++) {
        const v = tri ? (ph < 0.5 ? 4 * ph - 1 : 3 - 4 * ph) : Math.sin(ph * 6.283185307);
        b1L[i] += v * g; b1R[i] += v * g;
        ph += inc; if (ph >= 1) ph -= 1;
      }
      this.subPh = ph;
    }

    // noise: white, darkened or brightened by a one-pole tilt; independent per side
    const nzLevel = Math.max(0, Math.min(1, p.nzLevel + m(D_NOISE)));
    if (nzLevel > 0) {
      const c = p.nzColour;
      const a = c < 0 ? Math.exp(c * 4.5) : 0.5;
      const route = parallel ? p.nzRoute : 0;
      const g = nzLevel * 0.5;
      let zl = this.nzL, zr = this.nzR;
      for (let i = 0; i < n; i++) {
        const wl = this.rng.bi(), wr = this.rng.bi();
        zl += (wl - zl) * a; zr += (wr - zr) * a;
        let vl = c < 0 ? zl * (1 + -c * 2) : wl - zl * c * 1.6;
        let vr = c < 0 ? zr * (1 + -c * 2) : wr - zr * c * 1.6;
        vl *= g; vr *= g;
        b1L[i] += vl * (1 - route); b1R[i] += vr * (1 - route);
        if (route > 0) { b2L[i] += vl * route; b2R[i] += vr * route; }
      }
      this.nzL = zl; this.nzR = zr;
    }

    // insert A → filters → insert B
    const keyOct = (this.pitch - 60) / 12;
    const e2 = this.src[S_ENV1 + 1];
    this.insA.process(b1L, b1R, n, p.iAType | 0, p.iAA + m(D_INSA), p.iAB, p.iAMix, f0base);
    const cut1 = clampHz(p.f1Cut * Math.pow(2, p.f1Key * keyOct + p.f1Env * e2 * 6 + m(D_F1CUT)));
    const cut2 = clampHz(p.f2Cut * Math.pow(2, p.f2Key * keyOct + p.f2Env * e2 * 6 + m(D_F2CUT)));
    const res1 = p.f1Res + m(D_F1RES), res2 = p.f2Res + m(D_F2RES);
    if (parallel) {
      this.f1.process(b1L, b1R, n, p.f1Type | 0, cut1, res1, p.f1Drive);
      this.f2.process(b2L, b2R, n, p.f2Type | 0, cut2, res2, p.f2Drive);
      for (let i = 0; i < n; i++) { b1L[i] += b2L[i]; b1R[i] += b2R[i]; }
    } else {
      this.f1.process(b1L, b1R, n, p.f1Type | 0, cut1, res1, p.f1Drive);
      this.f2.process(b1L, b1R, n, p.f2Type | 0, cut2, res2, p.f2Drive);
    }
    this.insB.process(b1L, b1R, n, p.iBType | 0, p.iBA + m(D_INSB), p.iBB, p.iBMix, f0base);

    // amp: envelope 1 × velocity × level, ramped across the block
    const velGain = 1 - p.vel * (1 - this.vel);
    const target = this.env[0].value * velGain * p.ampLevel * Math.max(0, 1 + m(D_AMP));
    const pan = Math.max(-1, Math.min(1, m(D_PAN)));
    const th = (pan + 1) * QUARTER_PI;
    const pl1 = Math.cos(th) * Math.SQRT2, pr1 = Math.sin(th) * Math.SQRT2;
    const g0 = this.gain, pl0 = this.panL, pr0 = this.panR;
    for (let i = 0; i < n; i++) {
      const u = (i + 1) / n;
      const g = g0 + (target - g0) * u;
      L[off + i] += b1L[i] * g * (pl0 + (pl1 - pl0) * u);
      R[off + i] += b1R[i] * g * (pr0 + (pr1 - pr0) * u);
    }
    this.gain = target; this.panL = pl1; this.panR = pr1;
    if (!this.env[0].active) this.gain = 0;
  }
}

function clampHz(x: number): number { return x < 20 ? 20 : x > 20000 ? 20000 : x; }
