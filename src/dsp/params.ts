// The user-facing parameters of the instrument, as a flat list. `PARAMS` is
// what a plugin host would see; every value is a plain number. The two
// steppers' cells are parameters too, one per step. The factory presets
// live in presets.ts.

import { TABLE_NAMES } from './tables.ts';

export type Scale = 'lin' | 'log' | 'int' | 'enum' | 'bool';

export interface ParamDef {
  id: string;
  name: string;
  group: string;
  min: number;
  max: number;
  def: number;
  scale: Scale;
  unit?: string;
  labels?: string[];   // for enum
  tab?: string;        // cell of a drawn table (a stepper): which one ...
  idx?: number;        // ... and which cell
}

export const TABLES = TABLE_NAMES;
export const MORPHS = ['blend', 'spectral'];
export const WARPS = ['none', 'filter', 'bend', 'sync', 'formant', 'stretch', 'smear', 'skew', 'odd/even', 'shift'];
export const W_NONE = 0, W_FILTER = 1, W_BEND = 2, W_SYNC = 3, W_FORMANT = 4, W_STRETCH = 5, W_SMEAR = 6, W_SKEW = 7, W_ODDEVEN = 8, W_SHIFT = 9;
/** Which warps take a bipolar amount (the others read 0..1 of it). */
export const WARP_BIPOLAR = [false, false, true, false, true, true, false, true, true, true];
export const CURVES = ['linear', 'super'];
export const SUB_SHAPES = ['sine', 'tri'];
export const FILTERS = ['off', 'lp 12', 'lp 24', 'bp', 'hp', 'notch', 'vowel', 'comb +', 'comb −'];
export const F_OFF = 0, F_LP12 = 1, F_LP24 = 2, F_BP = 3, F_HP = 4, F_NOTCH = 5, F_VOWEL = 6, F_COMBP = 7, F_COMBN = 8;
export const ROUTES = ['serial', 'parallel'];
export const INSERTS = ['off', 'shift', 'ring', 'crush', 'fold', 'shape', 'parabolic', 'clip', 'comb'];
export const I_OFF = 0, I_SHIFT = 1, I_RING = 2, I_CRUSH = 3, I_FOLD = 4, I_SHAPE = 5, I_PARA = 6, I_CLIP = 7, I_COMB = 8;
export const LFO_SHAPES = ['sine', 'tri', 'saw', 'ramp', 'square', 's&h', 'drift'];
export const DIVS = ['4 bar', '2 bar', '1 bar', '1/2', '1/4', '1/8', '1/16', '1/32', '1/4 t', '1/8 t', '1/16 t', '1/4 .', '1/8 .'];
/** Length of each division in beats. */
export const DIV_BEATS = [16, 8, 4, 2, 1, 0.5, 0.25, 0.125, 2 / 3, 1 / 3, 1 / 6, 1.5, 0.75];
export const ENV_MODES = ['one-shot', 'loop'];
export const ARP_MODES = ['off', 'up', 'down', 'up/dn', 'random', 'played', 'chord'];
export const ARP_RATES = ['1/2', '1/4', '1/4 t', '1/8', '1/8 t', '1/16', '1/16 t', '1/32'];

/** Modulation sources, in the matrix's order. */
export const SOURCES = [
  '—', 'env 1 · amp', 'env 2', 'env 3', 'env 4', 'lfo 1', 'lfo 2', 'lfo 3', 'lfo 4', 'step 1', 'step 2',
  'macro 1', 'macro 2', 'macro 3', 'macro 4', 'macro 5', 'macro 6', 'macro 7', 'macro 8',
  'velocity', 'key', 'mod wheel', 'pressure', 'bend', 'random',
];
export const S_NONE = 0, S_ENV1 = 1, S_LFO1 = 5, S_STEP1 = 9, S_MACRO1 = 11, S_VEL = 19, S_KEY = 20, S_WHEEL = 21, S_PRESS = 22, S_BEND = 23, S_RANDOM = 24;
/** Sources that are the same for every voice: the only ones the global (fx) destinations hear. */
export const GLOBAL_SOURCE = SOURCES.map((_, i) => (i >= S_MACRO1 && i < S_MACRO1 + 8) || i === S_WHEEL || i === S_PRESS || i === S_BEND);

/**
 * Modulation destinations. `range` is what an amount of ±100 % with the
 * source at full adds, in the destination's own units (semitones, table
 * positions, octaves, or a fraction of the knob's travel).
 */
export interface DestDef { name: string; range: number; global?: boolean }
const oscDests = (n: number): DestDef[] => [
  { name: `osc ${n} position`, range: 1 },
  { name: `osc ${n} warp`, range: 1 },
  { name: `osc ${n} level`, range: 1 },
  { name: `osc ${n} pitch`, range: 24 },
  { name: `osc ${n} detune`, range: 1 },
  { name: `osc ${n} pan`, range: 1 },
];
export const DESTS: DestDef[] = [
  { name: '—', range: 0 },
  { name: 'pitch', range: 24 },
  ...oscDests(1), ...oscDests(2), ...oscDests(3),
  { name: 'phase mod', range: 1 },
  { name: 'sub level', range: 1 },
  { name: 'noise level', range: 1 },
  { name: 'filter 1 cutoff', range: 8 },
  { name: 'filter 1 res', range: 1 },
  { name: 'filter 2 cutoff', range: 8 },
  { name: 'filter 2 res', range: 1 },
  { name: 'insert A', range: 1 },
  { name: 'insert B', range: 1 },
  { name: 'amp', range: 1 },
  { name: 'pan', range: 1 },
  { name: 'dimension mix', range: 1, global: true },
  { name: 'chorus mix', range: 1, global: true },
  { name: 'delay mix', range: 1, global: true },
  { name: 'reverb mix', range: 1, global: true },
  { name: 'squash depth', range: 1, global: true },
];
export const DEST_NAMES = DESTS.map((d) => d.name);
export const D_PITCH = 1;
/** Index of osc n's (0-based) first destination; then +0 position, +1 warp, +2 level, +3 pitch, +4 detune, +5 pan. */
export const D_OSC = (n: number) => 2 + n * 6;
export const D_PM = 20, D_SUB = 21, D_NOISE = 22, D_F1CUT = 23, D_F1RES = 24, D_F2CUT = 25, D_F2RES = 26;
export const D_INSA = 27, D_INSB = 28, D_AMP = 29, D_PAN = 30;
export const D_DIM = 31, D_CHORUS = 32, D_DELAY = 33, D_REVERB = 34, D_SQUASH = 35;
export const N_DESTS = DESTS.length;
export const MATRIX_SLOTS = 16;
export const STEPS = 16;

const P = (id: string, name: string, group: string, min: number, max: number, def: number, scale: Scale = 'lin', unit?: string, labels?: string[]): ParamDef =>
  ({ id, name, group, min, max, def, scale, unit, labels });

function osc(n: number, level: number, table: number): ParamDef[] {
  const g = `o${n}`;
  const out = [
    P(`${g}Level`, 'level', g, 0, 1, level),
    P(`${g}Table`, 'table', g, 0, TABLES.length - 1, table, 'enum', undefined, TABLES),
    P(`${g}Pos`, 'position', g, 0, 1, 0),
    P(`${g}Morph`, 'morph', g, 0, 1, 1, 'enum', undefined, MORPHS),
    P(`${g}Warp`, 'warp', g, 0, WARPS.length - 1, 0, 'enum', undefined, WARPS),
    P(`${g}Amt`, 'warp amt', g, -1, 1, 0),
    P(`${g}Oct`, 'octave', g, -3, 3, 0, 'int'),
    P(`${g}Semi`, 'semi', g, -12, 12, 0, 'int', 'st'),
    P(`${g}Fine`, 'fine', g, -100, 100, 0, 'lin', 'ct'),
    P(`${g}Pan`, 'pan', g, -1, 1, 0),
    P(`${g}Uni`, 'unison', g, 1, 16, 1, 'int'),
    P(`${g}Detune`, 'detune', g, 0, 1, 0.25),
    P(`${g}Curve`, 'curve', g, 0, 1, 0, 'enum', undefined, CURVES),
    P(`${g}Blend`, 'blend', g, 0, 1, 0.5),
    P(`${g}Width`, 'width', g, 0, 1, 0.7),
    P(`${g}Phase`, 'rand phase', g, 0, 1, 1),
    P(`${g}Route`, 'f1 ↔ f2', g, 0, 1, 0),
  ];
  if (n < 3) out.push(P(`${g}Pm`, 'pm ← osc 3', g, 0, 1, 0));
  return out;
}

function env(n: number, a: number, d: number, s: number, r: number): ParamDef[] {
  const g = `e${n}`;
  return [
    P(`${g}Atk`, 'attack', g, 0.0005, 10, a, 'log', 's'),
    P(`${g}Dec`, 'decay', g, 0.005, 12, d, 'log', 's'),
    P(`${g}Sus`, 'sustain', g, 0, 1, s),
    P(`${g}Rel`, 'release', g, 0.005, 16, r, 'log', 's'),
    P(`${g}Curve`, 'curve', g, -1, 1, 0.4),
    P(`${g}Mode`, 'mode', g, 0, 1, 0, 'enum', undefined, ENV_MODES),
  ];
}

function lfo(n: number): ParamDef[] {
  const g = `l${n}`;
  return [
    P(`${g}Shape`, 'shape', g, 0, LFO_SHAPES.length - 1, 0, 'enum', undefined, LFO_SHAPES),
    P(`${g}Rate`, 'rate', g, 0.02, 40, 2, 'log', 'Hz'),
    P(`${g}Sync`, 'sync', g, 0, 1, 0, 'bool'),
    P(`${g}Div`, 'division', g, 0, DIVS.length - 1, 4, 'enum', undefined, DIVS),
    P(`${g}Retrig`, 'retrig', g, 0, 1, 1, 'bool'),
    P(`${g}Phase`, 'phase', g, 0, 1, 0),
    P(`${g}Fade`, 'fade in', g, 0, 8, 0, 'lin', 's'),
    P(`${g}Uni`, 'unipolar', g, 0, 1, 0, 'bool'),
  ];
}

function stepper(n: number, def: (i: number) => number): ParamDef[] {
  const g = `s${n}`;
  const out: ParamDef[] = [
    P(`${g}Len`, 'steps', g, 1, STEPS, STEPS, 'int'),
    P(`${g}Div`, 'division', g, 0, DIVS.length - 1, 6, 'enum', undefined, DIVS),
    P(`${g}Glide`, 'glide', g, 0, 1, 0),
    P(`${g}Retrig`, 'retrig', g, 0, 1, 1, 'bool'),
  ];
  for (let i = 0; i < STEPS; i++) {
    const d = P(`${g}v${i}`, `step ${i + 1}`, g, -8, 8, def(i), 'int');
    d.tab = g; d.idx = i;
    out.push(d);
  }
  return out;
}

function filter(n: number, type: number, cut: number): ParamDef[] {
  const g = `f${n}`;
  return [
    P(`${g}Type`, 'type', g, 0, FILTERS.length - 1, type, 'enum', undefined, FILTERS),
    P(`${g}Cut`, 'cutoff', g, 20, 20000, cut, 'log', 'Hz'),
    P(`${g}Res`, 'resonance', g, 0, 1, 0.15),
    P(`${g}Drive`, 'drive', g, 0, 1, 0),
    P(`${g}Key`, 'key track', g, 0, 1, 0),
    P(`${g}Env`, 'env 2', g, -1, 1, 0),
  ];
}

function insert(slot: string): ParamDef[] {
  const g = `i${slot}`;
  return [
    P(`${g}Type`, 'type', g, 0, INSERTS.length - 1, 0, 'enum', undefined, INSERTS),
    P(`${g}A`, 'amount', g, 0, 1, 0.5),
    P(`${g}B`, 'colour', g, -1, 1, 0),
    P(`${g}Mix`, 'mix', g, 0, 1, 1),
  ];
}

function slot(n: number): ParamDef[] {
  const g = `m${n}`;
  return [
    P(`${g}Src`, 'source', 'matrix', 0, SOURCES.length - 1, 0, 'enum', undefined, SOURCES),
    P(`${g}Dst`, 'destination', 'matrix', 0, DESTS.length - 1, 0, 'enum', undefined, DEST_NAMES),
    P(`${g}Amt`, 'amount', 'matrix', -1, 1, 0),
    P(`${g}Via`, 'via', 'matrix', 0, SOURCES.length - 1, 0, 'enum', undefined, SOURCES),
  ];
}

export const PARAMS: ParamDef[] = [
  // ---- voice
  P('voices', 'voices', 'voice', 1, 16, 8, 'int'),
  P('mono', 'mono', 'voice', 0, 1, 0, 'bool'),
  P('legato', 'legato', 'voice', 0, 1, 1, 'bool'),
  P('glide', 'glide', 'voice', 0, 2, 0, 'lin', 's'),
  P('bend', 'bend range', 'voice', 0, 24, 2, 'int', 'st'),
  P('vel', 'velocity', 'voice', 0, 1, 0.5),
  P('tempo', 'tempo', 'voice', 40, 240, 120, 'int', 'bpm'),
  P('ampLevel', 'level', 'voice', 0, 1.5, 0.45),
  P('drift', 'drift', 'voice', 0, 1, 0),
  // ---- arpeggiator
  P('arpMode', 'mode', 'arp', 0, ARP_MODES.length - 1, 0, 'enum', undefined, ARP_MODES),
  P('arpRate', 'rate', 'arp', 0, ARP_RATES.length - 1, 5, 'enum', undefined, ARP_RATES),
  P('arpOct', 'octaves', 'arp', 1, 4, 1, 'int'),
  P('arpGate', 'gate', 'arp', 0.05, 1, 0.5),
  P('arpSwing', 'swing', 'arp', 0, 0.6, 0),
  P('arpHold', 'hold', 'arp', 0, 1, 0, 'bool'),
  // ---- oscillators
  ...osc(1, 0.8, 0),
  ...osc(2, 0, 1),
  ...osc(3, 0, 0),
  P('subLevel', 'level', 'sub', 0, 1, 0),
  P('subOct', 'octave', 'sub', -2, -1, -1, 'int'),
  P('subShape', 'shape', 'sub', 0, 1, 0, 'enum', undefined, SUB_SHAPES),
  P('nzLevel', 'level', 'noise', 0, 1, 0),
  P('nzColour', 'colour', 'noise', -1, 1, 0),
  P('nzRoute', 'f1 ↔ f2', 'noise', 0, 1, 0),
  // ---- filters and inserts
  ...insert('A'),
  ...filter(1, F_LP24, 8000),
  ...filter(2, F_OFF, 2000),
  P('fRoute', 'routing', 'filters', 0, 1, 0, 'enum', undefined, ROUTES),
  ...insert('B'),
  // ---- modulators
  ...env(1, 0.003, 0.4, 0.8, 0.3),
  ...env(2, 0.003, 0.6, 0.3, 0.5),
  ...env(3, 0.5, 1.5, 0.5, 1),
  ...env(4, 0.01, 0.2, 0, 0.2),
  ...lfo(1), ...lfo(2), ...lfo(3), ...lfo(4),
  ...stepper(1, (i) => [8, 0, 4, 0, 6, 0, 2, 0, 8, 0, 4, 0, 6, 2, 4, 0][i]),
  ...stepper(2, (i) => Math.round(8 * Math.sin((i / STEPS) * Math.PI * 2))),
  ...[1, 2, 3, 4, 5, 6, 7, 8].map((i) => P(`macro${i}`, `macro ${i}`, 'macros', 0, 1, 0)),
  ...Array.from({ length: MATRIX_SLOTS }, (_, i) => slot(i + 1)).flat(),
  // ---- master
  P('dimSize', 'size', 'dim', 0, 1, 0.5),
  P('dimMix', 'mix', 'dim', 0, 1, 0),
  P('chRate', 'rate', 'chorus', 0.05, 5, 0.6, 'log', 'Hz'),
  P('chDepth', 'depth', 'chorus', 0, 1, 0.5),
  P('chMix', 'mix', 'chorus', 0, 1, 0),
  P('dlTime', 'time', 'delay', 10, 2000, 375, 'log', 'ms'),
  P('dlSync', 'sync', 'delay', 0, 1, 1, 'bool'),
  P('dlDiv', 'division', 'delay', 0, DIVS.length - 1, 12, 'enum', undefined, DIVS),
  P('dlFb', 'feedback', 'delay', 0, 0.95, 0.4),
  P('dlPing', 'ping-pong', 'delay', 0, 1, 1, 'bool'),
  P('dlDamp', 'damp', 'delay', 0, 1, 0.4),
  P('dlShift', 'spiral', 'delay', -1, 1, 0),
  P('dlMix', 'mix', 'delay', 0, 1, 0),
  P('rvSize', 'size', 'reverb', 0, 1, 0.6),
  P('rvDecay', 'decay', 'reverb', 0.3, 20, 3.5, 'log', 's'),
  P('rvTone', 'tone', 'reverb', 0, 1, 0.65),
  P('rvShimmer', 'shimmer', 'reverb', 0, 1, 0),
  P('rvMix', 'mix', 'reverb', 0, 1, 0.15),
  P('warmth', 'warmth', 'eq', 0, 1, 0),
  P('eqLow', 'low', 'eq', -12, 12, 0, 'lin', 'dB'),
  P('eqHigh', 'high', 'eq', -12, 12, 0, 'lin', 'dB'),
  P('sqDepth', 'depth', 'squash', 0, 1, 0),
  P('sqTime', 'time', 'squash', 0, 1, 0.5),
  P('sqUp', 'upward', 'squash', 0, 1, 0.7),
  P('sqDown', 'downward', 'squash', 0, 1, 0.7),
  P('volume', 'volume', 'master', 0, 1, 0.7),
];

export type ParamId = string;
export type ParamValues = Record<ParamId, number>;

export const PARAM_BY_ID: Record<string, ParamDef> = Object.fromEntries(PARAMS.map((p) => [p.id, p]));

export function defaults(): ParamValues {
  const v: ParamValues = {};
  for (const p of PARAMS) v[p.id] = p.def;
  return v;
}

export function fromNorm(p: ParamDef, t: number): number {
  t = Math.min(1, Math.max(0, t));
  switch (p.scale) {
    case 'log': return p.min * Math.pow(p.max / p.min, t);
    case 'int': case 'enum': case 'bool': return Math.round(p.min + t * (p.max - p.min));
    default: return p.min + t * (p.max - p.min);
  }
}

export function toNorm(p: ParamDef, v: number): number {
  v = Math.min(p.max, Math.max(p.min, v));
  if (p.scale === 'log') return Math.log(v / p.min) / Math.log(p.max / p.min);
  return (v - p.min) / (p.max - p.min);
}

export function format(p: ParamDef, v: number): string {
  if (p.labels) return p.labels[Math.round(v)] ?? String(v);
  if (p.scale === 'bool') return v >= 0.5 ? 'on' : 'off';
  if (p.scale === 'int') return `${Math.round(v)}${p.unit ? ' ' + p.unit : ''}`;
  if (p.unit === 'Hz') return v >= 1000 ? `${(v / 1000).toFixed(2)} kHz` : v >= 100 ? `${v.toFixed(0)} Hz` : `${v.toFixed(2)} Hz`;
  if (p.unit === 's') return v >= 1 ? `${v.toFixed(2)} s` : `${(v * 1000).toFixed(0)} ms`;
  if (p.unit === 'ms') return v >= 1000 ? `${(v / 1000).toFixed(2)} s` : `${v.toFixed(0)} ms`;
  if (p.unit === 'ct') return `${v.toFixed(0)} ct`;
  if (p.unit === 'dB') return `${v >= 0 ? '+' : '−'}${Math.abs(v).toFixed(1)} dB`;
  // plain amounts read as percentages; bipolar ones keep their sign
  if (p.min < 0) return (v >= 0 ? '+' : '−') + `${Math.round(Math.abs(v) * 100)}%`;
  return `${Math.round(v * 100)}%`;
}

export interface Preset {
  name: string;
  tag: string;
  values: Partial<ParamValues>;
  /** what the eight macros do in this sound, shown on the macro strip */
  macros?: string[];
}
