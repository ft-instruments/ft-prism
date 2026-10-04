// The factory presets. They are grouped the way Mycelia's are (pads, keys,
// plucks & bells, leads, bass, synths, arps & sequences, textures), plus
// neon for the cyberpunk side. Each lists only what differs from the
// defaults, and every one names and wires its macros: they are the playable
// face of the sound.
//
// Loudness is matched by measurement, not by hand: `node scripts/render.ts
// levels` renders every preset's test phrase and writes levels.gen.ts, whose
// gain is applied to the amp level below.

import { DEST_NAMES, SOURCES, TABLES, WARPS, ARP_MODES, ARP_RATES, DIVS, PARAM_BY_ID, type ParamValues, type Preset } from './params.ts';
import { LEVELS } from './levels.gen.ts';

type V = Partial<ParamValues>;

const T = (name: string) => { const i = TABLES.indexOf(name); if (i < 0) throw new Error(`no table ${name}`); return i; };
const src = (name: string) => { const i = SOURCES.indexOf(name); if (i < 0) throw new Error(`no source ${name}`); return i; };
const dst = (name: string) => { const i = DEST_NAMES.indexOf(name); if (i < 0) throw new Error(`no destination ${name}`); return i; };
const div = (name: string) => { const i = DIVS.indexOf(name); if (i < 0) throw new Error(`no division ${name}`); return i; };

/** Matrix routes by name: [source, destination, amount, via?]. */
function routes(...rs: [string, string, number, string?][]): V {
  const v: V = {};
  rs.forEach(([s, d, a, via], i) => {
    v[`m${i + 1}Src`] = src(s); v[`m${i + 1}Dst`] = dst(d); v[`m${i + 1}Amt`] = a;
    if (via) v[`m${i + 1}Via`] = src(via);
  });
  return v;
}

/** A stepper's cells (−8..8). With a route of amount 1/3 to pitch, a cell is a semitone. */
const steps = (n: 1 | 2, cells: number[]): V => Object.fromEntries(cells.map((c, i) => [`s${n}v${i}`, c]));
const SEMI = 1 / 3;

interface OscOpts {
  level?: number; uni?: number; detune?: number; super?: boolean; blend?: number; width?: number; phase?: number;
  warp?: string; amt?: number; oct?: number; semi?: number; fine?: number; pan?: number; route?: number; pm?: number; blendMorph?: boolean;
}
/** An oscillator: its table (by name) at a position, and the rest. */
function o(n: 1 | 2 | 3, table: string, pos: number, x: OscOpts = {}): V {
  const g = `o${n}`;
  const v: V = { [`${g}Table`]: T(table), [`${g}Pos`]: pos, [`${g}Level`]: x.level ?? 0.8 };
  if (x.uni) v[`${g}Uni`] = x.uni;
  if (x.detune !== undefined) v[`${g}Detune`] = x.detune;
  if (x.super) v[`${g}Curve`] = 1;
  if (x.blend !== undefined) v[`${g}Blend`] = x.blend;
  if (x.width !== undefined) v[`${g}Width`] = x.width;
  if (x.phase !== undefined) v[`${g}Phase`] = x.phase;
  if (x.warp) { const w = WARPS.indexOf(x.warp); if (w < 0) throw new Error(`no warp ${x.warp}`); v[`${g}Warp`] = w; }
  if (x.amt !== undefined) v[`${g}Amt`] = x.amt;
  if (x.oct) v[`${g}Oct`] = x.oct;
  if (x.semi) v[`${g}Semi`] = x.semi;
  if (x.fine) v[`${g}Fine`] = x.fine;
  if (x.pan) v[`${g}Pan`] = x.pan;
  if (x.route !== undefined) v[`${g}Route`] = x.route;
  if (x.pm) v[`${g}Pm`] = x.pm;
  if (x.blendMorph) v[`${g}Morph`] = 0;
  return v;
}
/** An envelope. */
const e = (n: 1 | 2 | 3 | 4, a: number, d: number, s: number, r: number, curve?: number, loop?: boolean): V => {
  const v: V = { [`e${n}Atk`]: a, [`e${n}Dec`]: d, [`e${n}Sus`]: s, [`e${n}Rel`]: r };
  if (curve !== undefined) v[`e${n}Curve`] = curve;
  if (loop) v[`e${n}Mode`] = 1;
  return v;
};
const LFO_SHAPES = ['sine', 'tri', 'saw', 'ramp', 'square', 's&h', 'drift'];
/** An LFO: a rate in Hz, or a division name ('1/8') to sync it. */
function l(n: 1 | 2 | 3 | 4, shape: string, rate: number | string, x: { free?: boolean; fade?: number; uni?: boolean; phase?: number } = {}): V {
  const g = `l${n}`;
  const v: V = { [`${g}Shape`]: LFO_SHAPES.indexOf(shape) };
  if (typeof rate === 'string') { v[`${g}Sync`] = 1; v[`${g}Div`] = div(rate); } else v[`${g}Rate`] = rate;
  if (x.free) v[`${g}Retrig`] = 0;
  if (x.fade) v[`${g}Fade`] = x.fade;
  if (x.uni) v[`${g}Uni`] = 1;
  if (x.phase !== undefined) v[`${g}Phase`] = x.phase;
  return v;
}
const FILTERS = ['off', 'lp 12', 'lp 24', 'bp', 'hp', 'notch', 'vowel', 'comb +', 'comb −'];
/** A filter: type by name, cutoff, resonance, and drive / key / env 2. */
function f(n: 1 | 2, type: string, cut: number, res = 0.1, x: { drive?: number; key?: number; env?: number } = {}): V {
  const g = `f${n}`;
  const v: V = { [`${g}Type`]: FILTERS.indexOf(type), [`${g}Cut`]: cut, [`${g}Res`]: res };
  if (x.drive) v[`${g}Drive`] = x.drive;
  if (x.key !== undefined) v[`${g}Key`] = x.key;
  if (x.env) v[`${g}Env`] = x.env;
  return v;
}
const INSERTS = ['off', 'shift', 'ring', 'crush', 'fold', 'shape', 'parabolic', 'clip', 'comb'];
const ins = (slot: 'A' | 'B', type: string, a: number, b = 0, mix = 1): V => ({ [`i${slot}Type`]: INSERTS.indexOf(type), [`i${slot}A`]: a, [`i${slot}B`]: b, [`i${slot}Mix`]: mix });
const hall = (mix: number, decay = 4, size = 0.7, shimmer = 0): V => ({ rvMix: mix, rvDecay: decay, rvSize: size, rvShimmer: shimmer });
const echo = (d: string, fb: number, mix: number, x: { spiral?: number; damp?: number; mono?: boolean } = {}): V =>
  ({ dlSync: 1, dlDiv: div(d), dlFb: fb, dlMix: mix, ...(x.spiral ? { dlShift: x.spiral } : {}), ...(x.damp !== undefined ? { dlDamp: x.damp } : {}), ...(x.mono ? { dlPing: 0 } : {}) });
const chorus = (mix: number, rate = 0.6, depth = 0.5): V => ({ chMix: mix, chRate: rate, chDepth: depth });
function arp(mode: string, rate: string, oct = 1, gate = 0.5, swing = 0, tempo?: number): V {
  return { arpMode: ARP_MODES.indexOf(mode), arpRate: ARP_RATES.indexOf(rate), arpOct: oct, arpGate: gate, arpSwing: swing, ...(tempo ? { tempo } : {}) };
}
const mono = (glide = 0.05, legato = true): V => ({ mono: 1, legato: legato ? 1 : 0, glide });

// the macro sets most sounds share
const M_PAD = ['brightness', 'motion', 'air', 'space'];
const M_KEYS = ['tone', 'hardness', 'echo', 'space'];
const M_PLUCK = ['brightness', 'decay', 'echo', 'space'];
const M_LEAD = ['brightness', 'grit', 'echo', 'space'];
const M_BASS = ['cutoff', 'grit', 'sub', 'squash'];
const MP_PAD = (cut = 0.4): [string, string, number][] => [['macro 1', 'filter 1 cutoff', cut], ['macro 3', 'noise level', 0.2], ['macro 4', 'reverb mix', 0.4]];
const MP_ECHO_SPACE: [string, string, number][] = [['macro 3', 'delay mix', 0.4], ['macro 4', 'reverb mix', 0.4]];

/** Presets as written; the loudness pass multiplies their amp level. */
const RAW: Preset[] = [
  // ======================================================================== pads
  {
    name: 'Halo', tag: 'pad', macros: M_PAD,
    values: {
      ...o(1, 'Analog', 0.32, { uni: 7, detune: 0.18, width: 0.95, level: 0.75 }), ...o(2, 'Vocal', 0.45, { uni: 4, detune: 0.14, level: 0.4 }),
      ...e(1, 1.3, 2, 0.85, 3.2, 0.2), ...f(1, 'lp 12', 3400, 0.1, { key: 0.3 }), drift: 0.5, nzColour: 0.4,
      ...l(1, 'drift', 0.14, { free: true }), ...l(2, 'tri', 0.08, { free: true }),
      ...chorus(0.35), dimMix: 0.25, ...hall(0.42, 7, 0.85),
      ...routes(['lfo 1', 'osc 1 position', 0.2], ['lfo 2', 'osc 2 position', 0.35], ...MP_PAD(), ['macro 2', 'osc 1 position', 0.45]),
    },
  },
  {
    name: 'Polar Night', tag: 'pad', macros: ['darkness', 'drift', 'air', 'space'],
    values: {
      ...o(1, 'Analog', 0.18, { uni: 5, detune: 0.14, level: 0.8 }), ...o(2, 'Cloud', 0.4, { oct: -1, level: 0.35, warp: 'smear', amt: 0.3 }),
      ...e(1, 2.2, 3, 0.9, 5, 0.1), ...f(1, 'lp 12', 1300, 0.12, { key: 0.2 }), drift: 0.6, warmth: 0.35, nzColour: -0.3,
      ...l(1, 'drift', 0.07, { free: true }),
      ...hall(0.5, 10, 0.95), ...chorus(0.25),
      ...routes(['lfo 1', 'osc 2 position', 0.4], ['macro 1', 'filter 1 cutoff', -0.4], ['macro 2', 'osc 1 position', 0.4], ['macro 3', 'noise level', 0.25], ['macro 4', 'reverb mix', 0.4]),
    },
  },
  {
    name: 'Iridescence', tag: 'pad', macros: ['shimmer', 'brightness', 'space', 'motion'],
    values: {
      ...o(1, 'FM', 0.3, { warp: 'skew', amt: 0.3, uni: 6, detune: 0.2, width: 1, level: 0.75 }), ...o(2, 'Glass', 0.2, { oct: 1, warp: 'skew', amt: -0.4, level: 0.35 }),
      ...e(1, 0.9, 1, 0.9, 2.5), ...f(1, 'lp 12', 5500, 0.1, { key: 0.3 }), drift: 0.3,
      ...l(1, 'drift', 0.2, { free: true }), ...l(2, 'sine', 0.07, { free: true }),
      ...chorus(0.45), dimMix: 0.4, ...hall(0.45, 6, 0.8),
      ...routes(['lfo 1', 'osc 1 warp', 0.4], ['lfo 2', 'osc 2 position', 0.5], ['macro 1', 'osc 1 warp', 0.6], ['macro 2', 'filter 1 cutoff', 0.4], ['macro 3', 'reverb mix', 0.4], ['macro 4', 'osc 2 position', 0.5]),
    },
  },
  {
    name: 'Opal Choir', tag: 'pad', macros: ['vowel', 'formant', 'air', 'space'],
    values: {
      ...o(1, 'Vocal', 0.2, { uni: 6, detune: 0.16, width: 0.9, warp: 'formant', amt: 0.1, level: 0.8 }), ...o(2, 'Basic', 0.3, { level: 0.25, oct: -1 }),
      ...e(1, 0.8, 1.5, 0.9, 2.8, 0.2), ...f(1, 'lp 12', 4200, 0.1), drift: 0.4, nzColour: 0.5,
      ...l(1, 'tri', 0.06, { free: true }), ...l(2, 'sine', 4.8, { fade: 1.2 }),
      ...chorus(0.4), ...hall(0.45, 6.5, 0.85),
      ...routes(['lfo 1', 'osc 1 position', 0.5], ['lfo 2', 'pitch', 0.004], ['macro 1', 'osc 1 position', 0.6], ['macro 2', 'osc 1 warp', 0.5], ['macro 3', 'noise level', 0.2], ['macro 4', 'reverb mix', 0.4]),
    },
  },
  {
    name: 'Daybreak', tag: 'pad', macros: ['sunrise', 'detune', 'air', 'space'],
    values: {
      ...o(1, 'Basic', 0.5, { uni: 7, super: true, detune: 0.25, blend: 0.5, width: 1, level: 0.8 }), ...o(2, 'Basic', 0.25, { oct: -1, level: 0.3 }),
      ...e(1, 0.6, 2, 0.9, 3), ...e(2, 3.5, 3, 0.8, 3, 0.1), ...f(1, 'lp 12', 700, 0.15, { env: 0.55, key: 0.3 }), drift: 0.35,
      ...chorus(0.3), ...hall(0.4, 6, 0.8), ...echo('1/4 .', 0.35, 0.12),
      ...routes(['macro 1', 'filter 1 cutoff', 0.5], ['macro 2', 'osc 1 detune', 0.4], ['macro 3', 'noise level', 0.2], ['macro 4', 'reverb mix', 0.4]),
    },
  },
  {
    name: 'Ice Cathedral', tag: 'pad', macros: ['brightness', 'glass', 'shimmer', 'space'],
    values: {
      ...o(1, 'Organ', 0.45, { uni: 3, detune: 0.1, level: 0.7 }), ...o(2, 'Glass', 0.4, { oct: 1, warp: 'stretch', amt: 0.1, level: 0.3 }),
      ...e(1, 1.5, 2, 0.9, 4), ...f(1, 'lp 12', 5000, 0.08), drift: 0.3,
      ...l(1, 'sine', 0.1, { free: true }),
      ...hall(0.55, 12, 1, 0.35), ...chorus(0.2),
      ...routes(['lfo 1', 'osc 1 position', 0.15], ['macro 1', 'filter 1 cutoff', 0.4], ['macro 2', 'osc 2 level', 0.4], ['macro 4', 'reverb mix', 0.35]),
    },
  },
  {
    name: 'Diffraction', tag: 'pad', macros: ['brightness', 'scan', 'air', 'space'],
    values: {
      ...o(1, 'Scan', 0.1, { uni: 4, detune: 0.12, width: 0.8, level: 0.75 }), ...o(2, 'Basic', 0.25, { level: 0.35 }),
      ...e(1, 1, 1.5, 0.9, 3), ...f(1, 'lp 12', 6000, 0.1), drift: 0.3,
      ...l(1, 'tri', 0.05, { free: true, uni: true }),
      ...chorus(0.3), ...hall(0.45, 7, 0.85), ...echo('1/4 .', 0.4, 0.15),
      ...routes(['lfo 1', 'osc 1 position', 0.8], ...MP_PAD(), ['macro 2', 'osc 1 position', 0.4]),
    },
  },
  {
    name: 'Nimbus', tag: 'pad', macros: M_PAD,
    values: {
      ...o(1, 'Basic', 0.2, { uni: 8, detune: 0.3, width: 1, level: 0.8 }), ...o(2, 'Felt', 0.3, { oct: 1, level: 0.2 }),
      ...e(1, 1.8, 2, 0.9, 4, 0.1), ...f(1, 'lp 12', 1900, 0.05), drift: 0.5,
      ...l(1, 'drift', 0.1, { free: true }),
      ...chorus(0.4, 0.3), dimMix: 0.3, ...hall(0.5, 8, 0.9),
      ...routes(['lfo 1', 'filter 1 cutoff', 0.12], ...MP_PAD(), ['macro 2', 'osc 1 position', 0.4]),
    },
  },
  {
    name: 'Long Exposure', tag: 'pad', macros: ['shift', 'brightness', 'air', 'space'],
    values: {
      ...o(1, 'Analog', 0.5, { warp: 'shift', amt: 0, uni: 5, detune: 0.15, level: 0.75 }), ...o(2, 'Analog', 0.3, { oct: -1, level: 0.35 }),
      ...e(1, 3, 3, 0.9, 5, 0.1), ...f(1, 'lp 12', 3000, 0.12), drift: 0.4,
      ...l(1, 'sine', 0.03, { free: true }),
      ...hall(0.5, 9, 0.9, 0.15), ...chorus(0.3),
      ...routes(['lfo 1', 'osc 1 warp', 0.2], ['macro 1', 'osc 1 warp', 0.3], ['macro 2', 'filter 1 cutoff', 0.4], ['macro 3', 'noise level', 0.2], ['macro 4', 'reverb mix', 0.4]),
    },
  },
  {
    name: 'Prism Strings', tag: 'pad', macros: ['brightness', 'ensemble', 'swell', 'space'],
    values: {
      ...o(1, 'Basic', 0.5, { uni: 5, detune: 0.2, width: 0.9, level: 0.75 }), ...o(2, 'Basic', 0.62, { oct: 1, level: 0.25, uni: 3 }),
      ...e(1, 0.45, 1, 0.9, 1.6), ...f(1, 'lp 12', 3800, 0.08, { key: 0.5 }), drift: 0.35,
      ...chorus(0.55, 0.5, 0.7), ...hall(0.38, 5, 0.75),
      ...l(1, 'sine', 5.5, { fade: 1 }),
      ...routes(['lfo 1', 'pitch', 0.003], ['macro 1', 'filter 1 cutoff', 0.4], ['macro 2', 'chorus mix', 0.4], ['velocity', 'filter 1 cutoff', 0.2], ['macro 4', 'reverb mix', 0.4], ['macro 3', 'amp', 0.3]),
    },
  },
  {
    name: 'Parhelion', tag: 'pad', macros: ['halo', 'brightness', 'air', 'space'],
    values: {
      ...o(1, 'Glass', 0.35, { uni: 4, detune: 0.12, level: 0.6 }), ...o(2, 'Vocal', 0.6, { uni: 4, detune: 0.15, level: 0.5 }),
      ...ins('B', 'ring', 0.6, 0, 0.18),
      ...e(1, 1.2, 1, 0.9, 3.5), ...f(1, 'lp 12', 5200, 0.1), drift: 0.4,
      ...l(1, 'drift', 0.12, { free: true }),
      ...chorus(0.35), ...hall(0.48, 8, 0.9, 0.2),
      ...routes(['lfo 1', 'osc 2 position', 0.3], ['macro 1', 'insert B', 0.25], ['macro 2', 'filter 1 cutoff', 0.4], ['macro 3', 'noise level', 0.2], ['macro 4', 'reverb mix', 0.35]),
    },
  },
  {
    name: 'Ether', tag: 'pad', macros: ['breath', 'brightness', 'motion', 'space'],
    values: {
      ...o(1, 'Cloud', 0.5, { warp: 'smear', amt: 0.4, uni: 3, level: 0.6 }), nzLevel: 0.35, nzColour: 0.3,
      ...e(1, 1.5, 2, 0.9, 4), ...f(1, 'bp', 1800, 0.45, { key: 0.6 }), drift: 0.6,
      ...l(1, 'drift', 0.18, { free: true }), ...l(2, 'sine', 0.05, { free: true }),
      ...hall(0.5, 8, 0.9), ...chorus(0.3),
      ...routes(['lfo 1', 'filter 1 cutoff', 0.15], ['lfo 2', 'osc 1 position', 0.4], ['macro 1', 'noise level', 0.3], ['macro 2', 'filter 1 cutoff', 0.4], ['macro 3', 'osc 1 position', 0.4], ['macro 4', 'reverb mix', 0.4]),
    },
  },
  {
    name: 'Lumen Bed', tag: 'pad', macros: ['pulse width', 'brightness', 'swell', 'space'],
    values: {
      ...o(1, 'PWM', 0.3, { uni: 4, detune: 0.14, level: 0.8 }), ...o(2, 'PWM', 0.6, { oct: -1, level: 0.35 }),
      ...e(1, 0.9, 1.5, 0.9, 2.8), ...f(1, 'lp 24', 2600, 0.15, { key: 0.3 }), drift: 0.45, warmth: 0.25,
      ...l(1, 'tri', 0.35, { free: true }),
      ...chorus(0.4), ...hall(0.4, 6, 0.8),
      ...routes(['lfo 1', 'osc 1 position', 0.35], ['lfo 1', 'osc 2 position', -0.3], ['macro 1', 'osc 1 position', 0.5], ['macro 2', 'filter 1 cutoff', 0.4], ['macro 3', 'amp', 0.2], ['macro 4', 'reverb mix', 0.4]),
    },
  },
  {
    name: 'Starlit Fifths', tag: 'pad', macros: M_PAD,
    values: {
      ...o(1, 'Analog', 0.4, { uni: 4, detune: 0.15, level: 0.65 }), ...o(2, 'Analog', 0.4, { semi: 7, uni: 4, detune: 0.15, level: 0.5 }), ...o(3, 'Glass', 0.3, { oct: 1, level: 0.2 }),
      ...e(1, 1.2, 2, 0.85, 3.5), ...f(1, 'lp 12', 3000, 0.1, { key: 0.3 }), drift: 0.5,
      ...l(1, 'drift', 0.1, { free: true }),
      ...chorus(0.35), ...hall(0.5, 8, 0.9, 0.15),
      ...routes(['lfo 1', 'osc 1 position', 0.2], ...MP_PAD(), ['macro 2', 'osc 2 position', 0.4]),
    },
  },
  {
    name: 'Frostline', tag: 'pad', macros: ['frost', 'brightness', 'air', 'space'],
    values: {
      ...o(1, 'Felt', 0.6, { uni: 5, detune: 0.18, level: 0.7, warp: 'stretch', amt: 0.08 }), ...o(2, 'Glass', 0.5, { oct: 1, level: 0.25 }),
      ...e(1, 0.7, 2, 0.8, 3), ...f(1, 'lp 12', 4500, 0.1), drift: 0.3, nzColour: 0.7,
      ...l(1, 'sine', 0.09, { free: true }),
      ...chorus(0.3), ...hall(0.45, 7, 0.85, 0.25),
      ...routes(['lfo 1', 'osc 1 position', 0.25], ['macro 1', 'osc 1 warp', 0.4], ['macro 2', 'filter 1 cutoff', 0.4], ['macro 3', 'noise level', 0.15], ['macro 4', 'reverb mix', 0.4]),
    },
  },

  // ======================================================================== keys
  {
    name: 'Hushed Keys', tag: 'keys', macros: M_KEYS,
    values: {
      ...o(1, 'Felt', 0.15, { warp: 'stretch', amt: 0.06, level: 0.9 }), ...o(2, 'Felt', 0.05, { oct: 1, level: 0.12 }),
      nzColour: -0.6, ...e(1, 0.003, 4, 0, 0.5, 0.75), ...e(2, 0.001, 1.2, 0.1, 0.5), ...e(4, 0.001, 0.05, 0, 0.05),
      ...f(1, 'lp 12', 2200, 0.05, { key: 0.7, env: 0.35 }), vel: 0.75, drift: 0.15,
      ...chorus(0.15), ...hall(0.32, 3.5), ...echo('1/4', 0.3, 0),
      ...routes(['velocity', 'osc 1 position', 0.6], ['env 4', 'noise level', 0.12], ['macro 1', 'filter 1 cutoff', 0.4], ['macro 2', 'osc 1 position', 0.5], ...MP_ECHO_SPACE),
    },
  },
  {
    name: 'Velvet Prism', tag: 'keys', macros: M_KEYS,
    values: {
      ...o(1, 'Felt', 0.3, { level: 0.8 }), ...o(2, 'Basic', 0, { level: 0.35 }),
      ...e(1, 0.004, 3, 0.15, 0.6, 0.6), ...e(2, 0.001, 0.8, 0.1, 0.4), ...f(1, 'lp 12', 2600, 0.08, { key: 0.6, env: 0.3 }), vel: 0.7,
      drift: 0.25, warmth: 0.3, ...chorus(0.35, 0.4), ...hall(0.3, 3), ...echo('1/4 .', 0.3, 0),
      ...routes(['velocity', 'osc 1 position', 0.4], ['macro 1', 'filter 1 cutoff', 0.4], ['macro 2', 'osc 1 position', 0.5], ...MP_ECHO_SPACE),
    },
  },
  {
    name: 'Crystal Tines', tag: 'keys', macros: ['bark', 'tremolo', 'echo', 'space'],
    values: {
      ...o(1, 'FM', 0.12, { level: 0.75 }), ...o(2, 'Basic', 0, { level: 0.45 }),
      ...e(1, 0.002, 3.2, 0.2, 0.5, 0.6), ...e(2, 0.001, 0.5, 0, 0.3), ...f(1, 'lp 12', 6000, 0.05, { key: 0.4 }), vel: 0.7,
      ...l(1, 'sine', 4.6, { free: true }), drift: 0.15,
      ...chorus(0.3, 0.5), ...hall(0.25, 2.8),
      ...routes(['env 2', 'osc 1 position', 0.3], ['velocity', 'osc 1 position', 0.25], ['lfo 1', 'amp', 0.3, 'macro 2'], ['macro 1', 'osc 1 position', 0.4], ...MP_ECHO_SPACE),
    },
  },
  {
    name: 'Lightbox Organ', tag: 'keys', macros: ['drawbars', 'rotor', 'grit', 'space'],
    values: {
      ...o(1, 'Organ', 0.55, { level: 0.75, uni: 2, detune: 0.05 }),
      ...e(1, 0.005, 0.2, 1, 0.08), ...f(1, 'lp 12', 7000, 0.05),
      ...l(1, 'sine', 5.8, { free: true }), ...l(2, 'sine', 0.8, { free: true }),
      ...chorus(0.4, 5, 0.25), ...hall(0.2, 2), ...ins('B', 'parabolic', 0.1, 0, 0.6),
      ...routes(['lfo 1', 'pan', 0.25, 'macro 2'], ['lfo 2', 'pan', 0.2], ['macro 1', 'osc 1 position', 0.45], ['macro 3', 'insert B', 0.4], ['macro 4', 'reverb mix', 0.4]),
    },
  },
  {
    name: 'Quartz Keys', tag: 'keys', macros: M_KEYS,
    values: {
      ...o(1, 'Glass', 0.25, { warp: 'stretch', amt: 0.1, level: 0.65 }), ...o(2, 'Felt', 0.35, { level: 0.6 }),
      ...e(1, 0.003, 3.5, 0, 0.7, 0.7), ...e(2, 0.001, 0.9, 0, 0.4), ...f(1, 'lp 12', 3400, 0.05, { key: 0.6, env: 0.3 }), vel: 0.6,
      drift: 0.2, ...chorus(0.2), ...hall(0.35, 4), ...echo('1/8 .', 0.35, 0.1),
      ...routes(['velocity', 'osc 2 position', 0.5], ['macro 1', 'filter 1 cutoff', 0.4], ['macro 2', 'osc 1 warp', 0.4], ...MP_ECHO_SPACE),
    },
  },
  {
    name: 'Upright Mist', tag: 'keys', macros: M_KEYS,
    values: {
      ...o(1, 'Felt', 0.35, { level: 0.85, warp: 'stretch', amt: 0.04 }), ...o(2, 'Felt', 0.2, { oct: -1, level: 0.25 }),
      nzColour: -0.7, ...e(1, 0.003, 5, 0, 0.45, 0.75), ...e(2, 0.001, 1.5, 0.1, 0.4), ...e(4, 0.001, 0.07, 0, 0.05),
      ...f(1, 'lp 12', 1800, 0.05, { key: 0.8, env: 0.4 }), vel: 0.8, warmth: 0.35, drift: 0.2,
      ...hall(0.28, 2.8, 0.55),
      ...routes(['velocity', 'osc 1 position', 0.5], ['env 4', 'noise level', 0.18], ['macro 1', 'filter 1 cutoff', 0.4], ['macro 2', 'osc 1 position', 0.4], ...MP_ECHO_SPACE),
    },
  },
  {
    name: 'Music Box', tag: 'keys', macros: ['brightness', 'wobble', 'echo', 'space'],
    values: {
      ...o(1, 'Glass', 0.8, { oct: 1, warp: 'stretch', amt: 0.18, level: 0.7 }), ...o(2, 'FM', 0.2, { oct: 2, level: 0.15 }),
      ...e(1, 0.001, 2.2, 0, 1.2, 0.7), ...f(1, 'lp 12', 8000, 0.05), vel: 0.5,
      ...l(1, 'sine', 3, { free: true }),
      ...hall(0.4, 4), ...echo('1/8 .', 0.4, 0.15),
      ...routes(['lfo 1', 'pitch', 0.002, 'macro 2'], ['macro 1', 'filter 1 cutoff', 0.3], ...MP_ECHO_SPACE),
    },
  },
  {
    name: 'Halation Keys', tag: 'keys', macros: M_KEYS,
    values: {
      ...o(1, 'Analog', 0.45, { uni: 3, detune: 0.12, level: 0.8 }), ...o(2, 'Basic', 0.25, { oct: 1, level: 0.25 }),
      ...e(1, 0.004, 1.6, 0.35, 0.5), ...e(2, 0.002, 0.7, 0.2, 0.4), ...f(1, 'lp 24', 1800, 0.15, { key: 0.5, env: 0.4 }), vel: 0.6,
      drift: 0.3, ...chorus(0.45), ...hall(0.3, 3.5), ...echo('1/4 .', 0.3, 0.1),
      ...routes(['velocity', 'filter 1 cutoff', 0.3], ['macro 1', 'filter 1 cutoff', 0.4], ['macro 2', 'osc 1 position', 0.4], ...MP_ECHO_SPACE),
    },
  },
  {
    name: 'Wurli Ray', tag: 'keys', macros: ['bark', 'tremolo', 'echo', 'space'],
    values: {
      ...o(1, 'PWM', 0.15, { level: 0.75 }), ...o(2, 'Basic', 0.25, { level: 0.4 }),
      ...ins('B', 'shape', 0.25, 0.2, 0.6),
      ...e(1, 0.003, 2.4, 0.25, 0.4, 0.6), ...e(2, 0.001, 0.4, 0, 0.3), ...f(1, 'lp 12', 3200, 0.1, { key: 0.5, env: 0.3 }), vel: 0.75,
      ...l(1, 'sine', 5.2, { free: true }), drift: 0.15,
      ...chorus(0.2), ...hall(0.22, 2.5),
      ...routes(['velocity', 'insert B', 0.4], ['lfo 1', 'amp', 0.35, 'macro 2'], ['macro 1', 'insert B', 0.5], ...MP_ECHO_SPACE),
    },
  },
  {
    name: 'Lens Clav', tag: 'keys', macros: ['brightness', 'snap', 'echo', 'space'],
    values: {
      ...o(1, 'Sync', 0.25, { level: 0.75 }), ...o(2, 'PWM', 0.75, { level: 0.35 }),
      ...e(1, 0.001, 0.6, 0.3, 0.15), ...e(2, 0.001, 0.25, 0, 0.1), ...f(1, 'lp 24', 1400, 0.3, { key: 0.6, env: 0.45 }), vel: 0.8,
      ...hall(0.15, 1.8), ...echo('1/8', 0.25, 0),
      ...routes(['env 2', 'osc 1 position', 0.4], ['macro 1', 'filter 1 cutoff', 0.4], ['macro 2', 'filter 1 res', 0.3], ...MP_ECHO_SPACE),
    },
  },

  // ============================================================== plucks & bells
  {
    name: 'Shard Pluck', tag: 'pluck', macros: ['brightness', 'shimmer', 'echo', 'space'],
    values: {
      ...o(1, 'Glass', 0.2, { warp: 'stretch', amt: 0.12, level: 0.85 }), ...o(2, 'Basic', 0, { oct: 1, level: 0.22 }),
      ...e(1, 0.002, 1.6, 0, 0.9, 0.6), ...e(2, 0.001, 0.45, 0, 0.4), ...f(1, 'lp 12', 3800, 0.1, { key: 0.5, env: 0.35 }),
      ...echo('1/8 .', 0.45, 0.26, { damp: 0.5 }), ...hall(0.3, 4.5, 0.7),
      ...routes(['env 2', 'osc 1 position', 0.35], ['velocity', 'filter 1 cutoff', 0.25], ['macro 1', 'filter 1 cutoff', 0.4], ['macro 2', 'osc 1 warp', 0.6], ...MP_ECHO_SPACE),
    },
  },
  {
    name: 'Ring Bells', tag: 'pluck', macros: ['ratio', 'metal', 'space', 'echo'],
    values: {
      ...o(1, 'Basic', 0, { level: 0.8 }), ...o(2, 'FM', 0.4, { oct: 1, level: 0.5 }),
      ...ins('B', 'ring', 0.62, 0, 0.7), ...e(1, 0.002, 2.2, 0, 1.5, 0.6), ...e(2, 0.001, 0.7, 0, 0.5),
      ...f(1, 'lp 12', 7000, 0.1, { key: 0.3 }), ...hall(0.4, 5, 0.7, 0.2), ...echo('1/4 .', 0.4, 0),
      ...routes(['env 2', 'osc 2 position', 0.4], ['macro 1', 'insert B', 0.3], ['macro 2', 'osc 2 position', 0.5], ['macro 3', 'reverb mix', 0.4], ['macro 4', 'delay mix', 0.4]),
    },
  },
  {
    name: 'Dewlight', tag: 'pluck', macros: M_PLUCK,
    values: {
      ...o(1, 'Basic', 0.28, { level: 0.8 }), ...o(2, 'Glass', 0.3, { oct: 1, level: 0.3 }),
      ...e(1, 0.001, 0.5, 0, 0.35, 0.6), ...e(2, 0.001, 0.25, 0, 0.2), ...f(1, 'lp 12', 2500, 0.15, { key: 0.5, env: 0.5 }),
      ...echo('1/8 .', 0.45, 0.3), ...hall(0.3, 3.5),
      ...routes(['macro 1', 'filter 1 cutoff', 0.4], ['macro 2', 'amp', 0.2], ...MP_ECHO_SPACE),
    },
  },
  {
    name: 'Kalimba Prism', tag: 'pluck', macros: ['brightness', 'wood', 'echo', 'space'],
    values: {
      ...o(1, 'FM', 0.08, { level: 0.75 }), ...o(2, 'Basic', 0, { oct: 2, level: 0.2 }),
      ...ins('B', 'comb', 0.55, 0.3, 0.25),
      ...e(1, 0.001, 0.9, 0, 0.6, 0.7), ...e(2, 0.001, 0.12, 0, 0.1), ...f(1, 'lp 12', 4000, 0.05, { key: 0.5 }), vel: 0.7,
      ...hall(0.3, 3), ...echo('1/8', 0.3, 0.15),
      ...routes(['env 2', 'osc 1 position', 0.3], ['macro 1', 'filter 1 cutoff', 0.4], ['macro 2', 'insert B', 0.4], ...MP_ECHO_SPACE),
    },
  },
  {
    name: 'Ice Harp', tag: 'pluck', macros: M_PLUCK,
    values: {
      ...o(1, 'Felt', 0.85, { level: 0.75 }), ...o(2, 'Glass', 0.15, { level: 0.35, warp: 'stretch', amt: 0.05 }),
      ...e(1, 0.002, 2.5, 0, 1.2, 0.7), ...e(2, 0.001, 0.6, 0, 0.4), ...f(1, 'lp 12', 5000, 0.05, { key: 0.4, env: 0.25 }),
      ...echo('1/4', 0.35, 0.2), ...hall(0.4, 5.5, 0.8, 0.15),
      ...routes(['velocity', 'osc 1 position', 0.15], ['macro 1', 'filter 1 cutoff', 0.4], ['macro 2', 'amp', 0.15], ...MP_ECHO_SPACE),
    },
  },
  {
    name: 'Starfield', tag: 'pluck', macros: ['scatter', 'brightness', 'echo', 'space'],
    values: {
      ...o(1, 'Scan', 0.6, { level: 0.8 }), ...o(2, 'Basic', 0.25, { level: 0.3 }),
      ...e(1, 0.002, 0.8, 0, 0.8), ...f(1, 'lp 12', 6000, 0.1, { key: 0.4 }),
      ...l(1, 's&h', '1/16', { free: true }),
      ...hall(0.45, 6, 0.85, 0.2), ...echo('1/8 .', 0.5, 0.3), macro1: 0.6,
      ...routes(['lfo 1', 'osc 1 position', 0.35, 'macro 1'], ['macro 2', 'filter 1 cutoff', 0.4], ...MP_ECHO_SPACE),
    },
  },
  {
    name: 'Chime Tree', tag: 'pluck', macros: ['stretch', 'brightness', 'shimmer', 'echo'],
    values: {
      ...o(1, 'Glass', 0.7, { oct: 1, warp: 'stretch', amt: 0.25, level: 0.75 }),
      ...e(1, 0.001, 4, 0, 3, 0.75), ...f(1, 'lp 12', 9000, 0.05), vel: 0.6,
      ...hall(0.5, 8, 0.9, 0.35), ...echo('1/4 .', 0.3, 0.1),
      ...routes(['random', 'osc 1 warp', 0.15], ['macro 1', 'osc 1 warp', 0.5], ['macro 2', 'filter 1 cutoff', 0.3], ['macro 3', 'reverb mix', 0.3], ['macro 4', 'delay mix', 0.4]),
    },
  },
  {
    name: 'Bell Tower', tag: 'pluck', macros: ['metal', 'ring', 'space', 'echo'],
    values: {
      ...o(1, 'FM', 0.6, { level: 0.75 }), ...o(2, 'Glass', 0.9, { oct: -1, warp: 'stretch', amt: 0.3, level: 0.4 }),
      ...ins('B', 'ring', 0.48, 0.1, 0.25),
      ...e(1, 0.001, 6, 0, 4, 0.8), ...e(2, 0.001, 1.5, 0, 1), ...f(1, 'lp 12', 6000, 0.05), vel: 0.6,
      ...hall(0.5, 9, 0.95),
      ...routes(['env 2', 'osc 1 position', -0.3], ['macro 1', 'osc 1 position', 0.3], ['macro 2', 'insert B', 0.4], ['macro 3', 'reverb mix', 0.4], ['macro 4', 'delay mix', 0.4]),
    },
  },
  {
    name: 'Synth Harp', tag: 'pluck', macros: M_PLUCK,
    values: {
      ...o(1, 'Analog', 0.7, { uni: 3, detune: 0.1, level: 0.8 }),
      ...e(1, 0.001, 0.9, 0, 0.6, 0.6), ...e(2, 0.001, 0.3, 0, 0.3), ...f(1, 'lp 24', 900, 0.2, { key: 0.6, env: 0.55 }),
      ...chorus(0.3), ...echo('1/8 .', 0.4, 0.22), ...hall(0.3, 4),
      ...routes(['velocity', 'filter 1 cutoff', 0.3], ['macro 1', 'filter 1 cutoff', 0.4], ['macro 2', 'amp', 0.2], ...MP_ECHO_SPACE),
    },
  },
  {
    name: 'Spark Pluck', tag: 'pluck', macros: ['spark', 'brightness', 'echo', 'space'],
    values: {
      ...o(1, 'Sync', 0.1, { level: 0.8, uni: 2, detune: 0.08 }),
      ...e(1, 0.001, 0.7, 0, 0.5), ...e(4, 0.001, 0.25, 0, 0.2), ...f(1, 'lp 12', 6000, 0.1, { key: 0.4 }),
      ...echo('1/8 .', 0.45, 0.25), ...hall(0.3, 4),
      ...routes(['env 4', 'osc 1 position', 0.6], ['macro 1', 'osc 1 position', 0.4], ['macro 2', 'filter 1 cutoff', 0.3], ...MP_ECHO_SPACE),
    },
  },
  {
    name: 'Glass Marimba', tag: 'pluck', macros: ['mallet', 'brightness', 'echo', 'space'],
    values: {
      ...o(1, 'Basic', 0, { level: 0.75 }), ...o(2, 'Glass', 0.05, { oct: 2, level: 0.1 }),
      ...e(1, 0.001, 0.7, 0, 0.5, 0.75), ...e(4, 0.001, 0.08, 0, 0.05),
      ...f(1, 'lp 12', 5000, 0.05), vel: 0.7,
      ...hall(0.28, 3), ...echo('1/8', 0.25, 0.1),
      ...routes(['env 4', 'osc 2 level', 0.5], ['velocity', 'osc 2 level', 0.3], ['macro 1', 'osc 2 level', 0.4], ['macro 2', 'filter 1 cutoff', 0.3], ...MP_ECHO_SPACE),
    },
  },

  // ======================================================================= leads
  {
    name: 'Ember Lead', tag: 'lead', macros: ['grit', 'vowel', 'brightness', 'space'],
    values: {
      ...mono(0.07), ...o(1, 'Basic', 0.5, { uni: 3, detune: 0.15, width: 0.5, level: 0.8 }), ...o(2, 'Vocal', 0.1, { warp: 'formant', amt: 0.15, level: 0.45 }),
      ...ins('B', 'fold', 0.22, 0, 0.45), ...f(1, 'lp 24', 2600, 0.22, { key: 0.4, env: 0.25 }),
      ...e(1, 0.006, 0.5, 0.85, 0.25), ...e(2, 0.003, 0.4, 0.3, 0.3), ...l(1, 'sine', 5.6, { fade: 0.7 }),
      ...echo('1/4 .', 0.35, 0.2), ...hall(0.22), sqDepth: 0.25,
      ...routes(['lfo 1', 'pitch', 0.006], ['lfo 1', 'pitch', 0.014, 'mod wheel'], ['macro 1', 'insert B', 0.5], ['macro 2', 'osc 2 position', 0.85], ['macro 3', 'filter 1 cutoff', 0.35], ['macro 4', 'reverb mix', 0.4]),
    },
  },
  {
    name: 'Saw Light', tag: 'lead', macros: M_LEAD,
    values: {
      ...mono(0.06), ...o(1, 'Basic', 0.5, { uni: 3, detune: 0.12, level: 0.8 }), ...o(2, 'Basic', 0.5, { oct: 1, level: 0.2 }),
      ...f(1, 'lp 24', 3400, 0.2, { key: 0.4, env: 0.2 }), ...e(1, 0.004, 0.4, 0.9, 0.2), ...e(2, 0.002, 0.3, 0.4, 0.3),
      ...l(1, 'sine', 5.4, { fade: 0.6 }), ...echo('1/8 .', 0.4, 0.22), ...hall(0.2), drift: 0.15, ...ins('B', 'shape', 0, 0, 0.6),
      ...routes(['lfo 1', 'pitch', 0.012, 'mod wheel'], ['macro 1', 'filter 1 cutoff', 0.4], ['macro 2', 'insert B', 0.5], ...MP_ECHO_SPACE),
    },
  },
  {
    name: 'Sine Whistle', tag: 'lead', macros: ['breath', 'fold', 'echo', 'space'],
    values: {
      ...mono(0.09), ...o(1, 'Basic', 0, { level: 0.85 }), ...ins('B', 'fold', 0.08, 0, 0.6), f1Type: 0,
      nzColour: 0.5, ...e(1, 0.02, 0.4, 0.9, 0.3), ...l(1, 'sine', 5.2, { fade: 0.5 }), ...l(2, 'drift', 3),
      ...echo('1/4 .', 0.4, 0.25), ...hall(0.3, 4),
      ...routes(['lfo 1', 'pitch', 0.008], ['lfo 2', 'noise level', 0.03], ['macro 1', 'noise level', 0.15], ['macro 2', 'insert B', 0.4], ...MP_ECHO_SPACE),
    },
  },
  {
    name: 'Square Song', tag: 'lead', macros: ['width', 'brightness', 'echo', 'space'],
    values: {
      ...mono(0.04), ...o(1, 'PWM', 0.05, { level: 0.75 }), ...o(2, 'PWM', 0.5, { oct: -1, level: 0.25 }),
      ...f(1, 'lp 12', 5000, 0.1, { key: 0.3 }), ...e(1, 0.002, 0.3, 0.8, 0.12),
      ...l(1, 'tri', 5.5, { fade: 0.4 }), ...echo('1/8 .', 0.4, 0.25), ...hall(0.18),
      ...routes(['lfo 1', 'pitch', 0.007], ['macro 1', 'osc 1 position', 0.6], ['macro 2', 'filter 1 cutoff', 0.4], ...MP_ECHO_SPACE),
    },
  },
  {
    name: 'Formant Lead', tag: 'lead', macros: ['vowel', 'formant', 'echo', 'space'],
    values: {
      ...mono(0.08), ...o(1, 'Vocal', 0.3, { warp: 'formant', amt: 0.1, uni: 2, detune: 0.08, level: 0.85 }), ...o(2, 'Basic', 0.5, { level: 0.3 }),
      ...f(1, 'lp 24', 4500, 0.15), ...e(1, 0.01, 0.4, 0.9, 0.25), ...l(1, 'sine', 5.3, { fade: 0.6 }), ...l(2, 'tri', 0.25, { free: true }),
      ...echo('1/4 .', 0.35, 0.2), ...hall(0.25), drift: 0.2,
      ...routes(['lfo 1', 'pitch', 0.007], ['lfo 2', 'osc 1 position', 0.2], ['macro 1', 'osc 1 position', 0.6], ['macro 2', 'osc 1 warp', 0.5], ...MP_ECHO_SPACE),
    },
  },
  {
    name: 'Sync Beam', tag: 'lead', macros: ['sync', 'brightness', 'echo', 'space'],
    values: {
      ...mono(0.05), ...o(1, 'Sync', 0.2, { uni: 2, detune: 0.1, level: 0.8 }), ...o(2, 'Basic', 0.5, { oct: -1, level: 0.3 }),
      ...f(1, 'lp 24', 6000, 0.15), ...e(1, 0.003, 0.4, 0.9, 0.2), ...e(2, 0.003, 0.8, 0.2, 0.3),
      ...l(1, 'sine', 5.5, { fade: 0.5 }), ...echo('1/8 .', 0.4, 0.22), ...hall(0.2), sqDepth: 0.2,
      ...routes(['env 2', 'osc 1 position', 0.6], ['lfo 1', 'pitch', 0.012, 'mod wheel'], ['macro 1', 'osc 1 position', 0.5], ['macro 2', 'filter 1 cutoff', 0.4], ...MP_ECHO_SPACE),
    },
  },
  {
    name: 'Hollow Flute', tag: 'lead', macros: ['breath', 'brightness', 'echo', 'space'],
    values: {
      ...mono(0.06), ...o(1, 'Basic', 0.2, { level: 0.8 }), ...o(2, 'Organ', 0.1, { oct: 1, level: 0.15 }),
      nzColour: 0.2, ...f(1, 'lp 12', 3000, 0.1, { key: 0.6 }), ...e(1, 0.04, 0.5, 0.9, 0.3), ...e(4, 0.02, 0.2, 0.1, 0.2),
      ...l(1, 'sine', 4.9, { fade: 0.8 }), ...echo('1/4', 0.3, 0.15), ...hall(0.3, 3.5),
      ...routes(['env 4', 'noise level', 0.25], ['lfo 1', 'pitch', 0.006], ['macro 1', 'noise level', 0.2], ['macro 2', 'filter 1 cutoff', 0.4], ...MP_ECHO_SPACE),
    },
  },
  {
    name: 'Overdrive Prism', tag: 'lead', macros: ['drive', 'brightness', 'echo', 'space'],
    values: {
      ...mono(0.05), ...o(1, 'Analog', 0.8, { uni: 3, detune: 0.18, level: 0.8 }), ...o(2, 'Basic', 0.75, { semi: 7, level: 0.25 }),
      ...ins('B', 'clip', 0.35, 0.15, 0.7), ...f(1, 'lp 24', 3800, 0.25, { key: 0.3, drive: 0.3 }), ...e(1, 0.003, 0.4, 0.9, 0.2),
      ...l(1, 'sine', 5.8, { fade: 0.5 }), ...echo('1/8 .', 0.35, 0.18), ...hall(0.18), sqDepth: 0.35,
      ...routes(['lfo 1', 'pitch', 0.012, 'mod wheel'], ['macro 1', 'insert B', 0.5], ['macro 2', 'filter 1 cutoff', 0.4], ...MP_ECHO_SPACE),
    },
  },
  {
    name: 'Solar Lead', tag: 'lead', macros: ['detune', 'brightness', 'echo', 'space'],
    values: {
      ...mono(0.07), ...o(1, 'Basic', 0.5, { uni: 7, super: true, detune: 0.35, blend: 0.55, width: 0.8, level: 0.85 }),
      ...f(1, 'lp 24', 5000, 0.15, { key: 0.3 }), ...e(1, 0.004, 0.4, 0.9, 0.3), ...l(1, 'sine', 5.6, { fade: 0.6 }),
      ...echo('1/8 .', 0.45, 0.25), ...hall(0.3, 4), sqDepth: 0.2,
      ...routes(['lfo 1', 'pitch', 0.01, 'mod wheel'], ['macro 1', 'osc 1 detune', 0.4], ['macro 2', 'filter 1 cutoff', 0.4], ...MP_ECHO_SPACE),
    },
  },
  {
    name: 'Glass Lead', tag: 'lead', macros: ['brightness', 'stretch', 'echo', 'space'],
    values: {
      ...mono(0.05), ...o(1, 'Glass', 0.45, { level: 0.75, warp: 'stretch', amt: 0.05 }), ...o(2, 'Basic', 0.3, { level: 0.4 }),
      ...f(1, 'lp 12', 6500, 0.1), ...e(1, 0.003, 0.6, 0.75, 0.35), ...l(1, 'sine', 5.4, { fade: 0.5 }),
      ...echo('1/4 .', 0.45, 0.28), ...hall(0.35, 5, 0.8, 0.15),
      ...routes(['lfo 1', 'pitch', 0.007], ['macro 1', 'filter 1 cutoff', 0.4], ['macro 2', 'osc 1 warp', 0.5], ...MP_ECHO_SPACE),
    },
  },

  // ======================================================================== bass
  {
    name: 'Growl', tag: 'bass', macros: ['growl', 'fold', 'cutoff', 'squash'],
    values: {
      ...mono(0.05), ...o(1, 'Growl', 0.3, { uni: 2, detune: 0.08, width: 0.3, level: 0.85 }), subLevel: 0.5,
      ...ins('A', 'comb', 0.35, 0.6, 0.55), ...ins('B', 'fold', 0.3, 0, 0.55),
      ...f(1, 'lp 24', 2600, 0.25, { key: 0.3 }), ...e(1, 0.003, 0.3, 0.9, 0.12),
      s1Div: div('1/16'), s1Glide: 0.4, ...steps(1, [0, 4, 8, 2, -4, 6, 0, 8, -2, 4, 8, -6, 2, 6, -2, 8]),
      sqDepth: 0.5, rvMix: 0.06,
      ...routes(['step 1', 'osc 1 position', 0.45], ['macro 1', 'osc 1 position', 0.5], ['macro 2', 'insert B', 0.6], ['macro 3', 'filter 1 cutoff', 0.4], ['macro 4', 'squash depth', 0.5]),
    },
  },
  {
    name: 'Reese', tag: 'bass', macros: ['cutoff', 'width', 'dirt', 'sub'],
    values: {
      ...mono(0.06), ...o(1, 'Basic', 0.5, { uni: 2, detune: 0.32, width: 0.35, level: 0.75 }), ...o(2, 'Basic', 0.5, { fine: 16, uni: 2, detune: 0.28, width: 0.35, level: 0.7 }),
      subLevel: 0.55, ...ins('B', 'shape', 0.25, 0, 0.5), ...f(1, 'lp 24', 850, 0.25, { env: 0.12, key: 0.2 }), ...e(1, 0.004, 0.3, 1, 0.15),
      ...l(1, 'sine', 0.12, { free: true }), sqDepth: 0.35, rvMix: 0.05,
      ...routes(['lfo 1', 'osc 1 detune', 0.25], ['macro 1', 'filter 1 cutoff', 0.45], ['macro 2', 'osc 1 detune', 0.4], ['macro 3', 'insert B', 0.6], ['macro 4', 'sub level', 0.4]),
    },
  },
  {
    name: 'Neuro', tag: 'bass', macros: ['vowel', 'formant', 'grit', 'squash'],
    values: {
      ...mono(0.03), ...o(1, 'Vocal', 0.05, { warp: 'formant', amt: -0.2, uni: 2, detune: 0.06, level: 0.85 }), ...o(2, 'Basic', 0.5, { oct: -1, level: 0.35 }),
      subLevel: 0.4, ...ins('B', 'clip', 0.2, 0, 0.5), ...f(1, 'lp 24', 4200, 0.2, { key: 0.3 }), ...e(1, 0.002, 0.3, 0.95, 0.1),
      s1Div: div('1/16'), s1Glide: 0.25, ...steps(1, [0, 8, 3, 6, 0, 2, 8, 5, 1, 7, 0, 4, 8, 2, 6, 3]),
      s2Div: div('1/8'), s2Glide: 0.5, s2Len: 8, ...steps(2, [-8, 0, 8, 2, -4, 6, -8, 4]),
      sqDepth: 0.75, sqUp: 0.8, sqDown: 0.8,
      ...routes(['step 1', 'osc 1 position', 0.85], ['step 2', 'osc 1 warp', 0.35], ['macro 1', 'osc 1 position', 0.6], ['macro 2', 'osc 1 warp', 0.6], ['macro 3', 'insert B', 0.6], ['macro 4', 'squash depth', 0.25]),
    },
  },
  {
    name: 'Wobble', tag: 'bass', macros: ['wobble', 'cutoff', 'resonance', 'squash'],
    values: {
      ...mono(0.04), ...o(1, 'Analog', 0.25, { uni: 3, detune: 0.12, width: 0.4, level: 0.8 }), ...o(2, 'Sync', 0.3, { level: 0.45 }),
      subLevel: 0.6, ...f(1, 'lp 24', 650, 0.45, { key: 0.2 }), ...e(1, 0.003, 0.3, 1, 0.12),
      ...l(1, 'sine', '1/8', { phase: 0.75 }), sqDepth: 0.4, macro1: 0.8,
      ...routes(['lfo 1', 'osc 1 position', 0.6, 'macro 1'], ['lfo 1', 'filter 1 cutoff', 0.38, 'macro 1'], ['lfo 1', 'osc 2 position', 0.5, 'macro 1'], ['macro 2', 'filter 1 cutoff', 0.4], ['macro 3', 'filter 1 res', 0.45], ['macro 4', 'squash depth', 0.5]),
    },
  },
  {
    name: 'Sub Pressure', tag: 'bass', macros: ['grit', 'mid', 'mid tone', 'squash'],
    values: {
      ...mono(0.04), ...o(1, 'Basic', 0, { oct: -1, level: 0.9 }), ...o(2, 'Fold', 0.35, { level: 0.45, route: 1 }),
      fRoute: 1, f1Type: 0, ...f(2, 'hp', 220, 0.15), ...ins('B', 'shape', 0.3, 0, 0.5),
      ...e(1, 0.003, 0.3, 1, 0.12), ...e(4, 0.001, 0.18, 0, 0.1), sqDepth: 0.3,
      ...routes(['env 4', 'osc 2 position', 0.3], ['macro 1', 'osc 2 position', 0.55], ['macro 2', 'osc 2 level', 0.5], ['macro 3', 'filter 2 cutoff', 0.35], ['macro 4', 'squash depth', 0.5]),
    },
  },
  {
    name: 'Round Sub', tag: 'bass', macros: ['tone', 'triangle', 'sub', 'squash'],
    values: {
      ...mono(0.03), ...o(1, 'Basic', 0.15, { level: 0.85 }), subLevel: 0.6,
      ...f(1, 'lp 12', 900, 0.1, { key: 0.4 }), ...e(1, 0.003, 0.4, 0.9, 0.15), warmth: 0.3,
      ...routes(['macro 1', 'filter 1 cutoff', 0.4], ['macro 2', 'osc 1 position', 0.3], ['macro 3', 'sub level', 0.3], ['macro 4', 'squash depth', 0.5]),
    },
  },
  {
    name: 'Pluck Bass', tag: 'bass', macros: M_BASS,
    values: {
      ...mono(0.02, false), ...o(1, 'Analog', 0.65, { uni: 2, detune: 0.1, level: 0.85 }), subLevel: 0.4,
      ...f(1, 'lp 24', 300, 0.25, { key: 0.4, env: 0.55 }), ...e(1, 0.002, 0.5, 0.4, 0.15), ...e(2, 0.001, 0.22, 0, 0.15), vel: 0.7,
      ...ins('B', 'shape', 0.2, 0, 0.4), sqDepth: 0.25,
      ...routes(['velocity', 'filter 1 cutoff', 0.25], ['macro 1', 'filter 1 cutoff', 0.4], ['macro 2', 'insert B', 0.5], ['macro 3', 'sub level', 0.4], ['macro 4', 'squash depth', 0.5]),
    },
  },
  {
    name: 'Acid Prism', tag: 'bass', macros: ['cutoff', 'resonance', 'accent', 'squash'],
    values: {
      ...mono(0.06), ...o(1, 'Basic', 0.5, { level: 0.85 }),
      ...f(1, 'lp 24', 380, 0.72, { env: 0.55, drive: 0.3 }), ...e(1, 0.002, 0.3, 0.8, 0.1), ...e(2, 0.001, 0.25, 0, 0.1), vel: 0.6,
      ...ins('B', 'parabolic', 0.25, 0, 0.5), ...echo('1/8 .', 0.35, 0.12), sqDepth: 0.3,
      ...routes(['velocity', 'filter 1 cutoff', 0.3], ['macro 1', 'filter 1 cutoff', 0.45], ['macro 2', 'filter 1 res', 0.25], ['macro 3', 'insert B', 0.5], ['macro 4', 'squash depth', 0.5]),
    },
  },
  {
    name: 'Fold Bass', tag: 'bass', macros: ['fold', 'cutoff', 'sub', 'squash'],
    values: {
      ...mono(0.04), ...o(1, 'Fold', 0.15, { level: 0.85 }), subLevel: 0.4,
      ...f(1, 'lp 24', 2400, 0.15, { key: 0.3 }), ...e(1, 0.003, 0.35, 0.9, 0.12), ...e(4, 0.002, 0.4, 0.2, 0.2), sqDepth: 0.35,
      ...routes(['env 4', 'osc 1 position', 0.5], ['macro 1', 'osc 1 position', 0.6], ['macro 2', 'filter 1 cutoff', 0.4], ['macro 3', 'sub level', 0.4], ['macro 4', 'squash depth', 0.5]),
    },
  },
  {
    name: 'FM Bass', tag: 'bass', macros: ['bark', 'cutoff', 'sub', 'squash'],
    values: {
      ...mono(0.03), ...o(1, 'FM', 0.3, { level: 0.85 }), subLevel: 0.45,
      ...f(1, 'lp 24', 3000, 0.1, { key: 0.3 }), ...e(1, 0.002, 0.4, 0.8, 0.12), ...e(2, 0.001, 0.3, 0.1, 0.2), sqDepth: 0.3,
      ...routes(['env 2', 'osc 1 position', 0.4], ['velocity', 'osc 1 position', 0.2], ['macro 1', 'osc 1 position', 0.5], ['macro 2', 'filter 1 cutoff', 0.4], ['macro 3', 'sub level', 0.4], ['macro 4', 'squash depth', 0.5]),
    },
  },
  {
    name: 'Deep Field', tag: 'bass', macros: ['cutoff', 'beating', 'sub', 'squash'],
    values: {
      ...mono(0.08), ...o(1, 'Analog', 0.9, { level: 0.8 }), ...o(2, 'Analog', 0.9, { fine: -9, level: 0.7 }), subLevel: 0.5,
      ...f(1, 'lp 24', 420, 0.3, { key: 0.3, env: 0.2 }), ...e(1, 0.005, 0.5, 1, 0.2), ...e(2, 0.003, 0.6, 0.3, 0.3), drift: 0.4, warmth: 0.4,
      ...routes(['macro 1', 'filter 1 cutoff', 0.45], ['macro 2', 'osc 2 pitch', 0.01], ['macro 3', 'sub level', 0.4], ['macro 4', 'squash depth', 0.5]),
    },
  },

  // ====================================================================== synths
  {
    name: 'Supersaw', tag: 'synth', macros: ['detune', 'darkness', 'space', 'echo'],
    values: {
      ...o(1, 'Basic', 0.5, { uni: 7, super: true, detune: 0.5, blend: 0.55, width: 1, level: 0.85 }),
      ...f(1, 'hp', 70, 0, { key: 1 }), ...f(2, 'lp 12', 11000), ...e(1, 0.005, 0.3, 0.9, 0.45),
      ...chorus(0.2), ...hall(0.25), ...echo('1/8 .', 0.35, 0.16),
      ...routes(['macro 1', 'osc 1 detune', 0.45], ['macro 2', 'filter 2 cutoff', -0.4], ['macro 3', 'reverb mix', 0.45], ['macro 4', 'delay mix', 0.4]),
    },
  },
  {
    name: 'Trance Gate', tag: 'synth', macros: ['gate', 'detune', 'brightness', 'squash'],
    values: {
      ...o(1, 'Basic', 0.5, { uni: 7, super: true, detune: 0.45, blend: 0.6, width: 1, level: 0.8 }), ...o(2, 'Basic', 0.5, { oct: 1, uni: 5, detune: 0.3, level: 0.32 }),
      ...f(1, 'lp 24', 7500, 0.12, { key: 0.3 }), ...f(2, 'hp', 110), ...e(1, 0.004, 0.3, 1, 0.35),
      s1Div: div('1/16'), s1Glide: 0.12, s1Retrig: 0, ...steps(1, [0, 0, -8, 0, 0, -8, 0, 0, 0, -8, 0, 0, -8, 0, -8, 0]),
      ...echo('1/8 .', 0.35, 0.18), ...hall(0.28), sqDepth: 0.4, ...chorus(0.15), macro1: 1,
      ...routes(['step 1', 'amp', 1, 'macro 1'], ['macro 2', 'osc 1 detune', 0.45], ['macro 3', 'filter 1 cutoff', 0.45], ['macro 4', 'squash depth', 0.5]),
    },
  },
  {
    name: 'Brass Light', tag: 'synth', macros: ['brightness', 'bite', 'grit', 'space'],
    values: {
      ...o(1, 'Analog', 0.85, { uni: 3, detune: 0.14, level: 0.8 }), ...o(2, 'PWM', 0.2, { level: 0.35 }),
      ...f(1, 'lp 24', 700, 0.15, { key: 0.4, env: 0.45 }), ...e(1, 0.03, 0.6, 0.85, 0.35), ...e(2, 0.08, 0.7, 0.45, 0.4), vel: 0.6, drift: 0.25,
      ...chorus(0.25), ...hall(0.3, 3.5), ...ins('B', 'parabolic', 0, 0, 0.5),
      ...routes(['velocity', 'filter 1 cutoff', 0.25], ['macro 1', 'filter 1 cutoff', 0.4], ['macro 2', 'filter 1 res', 0.2], ['macro 3', 'insert B', 0.4], ['macro 4', 'reverb mix', 0.4]),
    },
  },
  {
    name: 'Stab Chord', tag: 'synth', macros: ['brightness', 'body', 'echo', 'space'],
    values: {
      ...o(1, 'Basic', 0.5, { uni: 7, super: true, detune: 0.35, level: 0.85 }),
      ...f(1, 'lp 24', 1400, 0.2, { key: 0.3, env: 0.45 }), ...e(1, 0.002, 0.45, 0, 0.3), ...e(2, 0.001, 0.25, 0, 0.2),
      ...echo('1/8 .', 0.4, 0.25), ...hall(0.3), sqDepth: 0.25,
      ...routes(['macro 1', 'filter 1 cutoff', 0.4], ['macro 2', 'amp', 0.15], ...MP_ECHO_SPACE),
    },
  },
  {
    name: 'Pulse Poly', tag: 'synth', macros: ['width', 'brightness', 'echo', 'space'],
    values: {
      ...o(1, 'PWM', 0.2, { uni: 4, detune: 0.12, level: 0.8 }),
      ...f(1, 'lp 24', 2200, 0.2, { key: 0.4, env: 0.3 }), ...e(1, 0.004, 0.6, 0.6, 0.35), ...e(2, 0.002, 0.4, 0.2, 0.3),
      ...l(1, 'tri', 0.5, { free: true }), ...chorus(0.35), ...hall(0.25), ...echo('1/4 .', 0.3, 0.12), drift: 0.25,
      ...routes(['lfo 1', 'osc 1 position', 0.3], ['macro 1', 'osc 1 position', 0.5], ['macro 2', 'filter 1 cutoff', 0.4], ...MP_ECHO_SPACE),
    },
  },
  {
    name: 'Spectral Hoover', tag: 'synth', macros: ['detune', 'dive', 'grit', 'space'],
    values: {
      ...mono(0.12), ...o(1, 'Analog', 0.9, { uni: 8, super: true, detune: 0.7, blend: 0.7, width: 1, level: 0.85 }), ...o(2, 'PWM', 0.5, { oct: -1, uni: 3, level: 0.4 }),
      ...f(1, 'lp 24', 4500, 0.15), ...e(1, 0.02, 0.4, 0.9, 0.4), ...e(4, 0.001, 0.25, 0, 0.1), ...chorus(0.3), ...hall(0.25), sqDepth: 0.3,
      ...ins('B', 'clip', 0, 0, 0.6),
      ...routes(['env 4', 'pitch', -0.12], ['macro 1', 'osc 1 detune', 0.3], ['macro 2', 'pitch', -0.1], ['macro 3', 'insert B', 0.5], ['macro 4', 'reverb mix', 0.4]),
    },
  },
  {
    name: 'Pumping Saws', tag: 'synth', macros: ['pump', 'brightness', 'detune', 'space'],
    values: {
      ...o(1, 'Basic', 0.5, { uni: 6, detune: 0.3, width: 1, level: 0.8 }), ...o(2, 'Basic', 0.5, { oct: -1, level: 0.3 }),
      ...f(1, 'lp 24', 5000, 0.12), ...e(1, 0.005, 0.3, 1, 0.4),
      ...l(1, 'ramp', '1/4', { free: true, uni: true }), ...hall(0.25), ...chorus(0.2), sqDepth: 0.3, macro1: 0.85,
      ...routes(['lfo 1', 'amp', 0.9, 'macro 1'], ['macro 1', 'amp', -0.9], ['macro 2', 'filter 1 cutoff', 0.4], ['macro 3', 'osc 1 detune', 0.4], ['macro 4', 'reverb mix', 0.4]),
    },
  },
  {
    name: 'Polysync Stack', tag: 'synth', macros: ['sync', 'brightness', 'echo', 'space'],
    values: {
      ...o(1, 'Sync', 0.35, { uni: 4, detune: 0.15, width: 0.9, level: 0.75 }), ...o(2, 'Basic', 0.5, { uni: 3, detune: 0.1, level: 0.4 }),
      ...f(1, 'lp 24', 4000, 0.15, { key: 0.3 }), ...e(1, 0.004, 0.6, 0.7, 0.4), ...e(2, 0.002, 0.6, 0.2, 0.3),
      ...chorus(0.3), ...hall(0.3), ...echo('1/8 .', 0.35, 0.15),
      ...routes(['env 2', 'osc 1 position', 0.4], ['macro 1', 'osc 1 position', 0.5], ['macro 2', 'filter 1 cutoff', 0.4], ...MP_ECHO_SPACE),
    },
  },

  // ============================================================ arps & sequences
  {
    name: 'Crystal Arp', tag: 'arp', macros: M_PLUCK,
    values: {
      ...arp('up/dn', '1/16', 2, 0.45, 0, 120), ...o(1, 'Glass', 0.3, { level: 0.8, warp: 'stretch', amt: 0.06 }), ...o(2, 'Basic', 0.25, { oct: 1, level: 0.2 }),
      ...e(1, 0.001, 0.5, 0, 0.4, 0.6), ...e(2, 0.001, 0.2, 0, 0.2), ...f(1, 'lp 12', 4000, 0.1, { key: 0.4, env: 0.3 }),
      ...echo('1/8 .', 0.45, 0.28), ...hall(0.35, 5),
      ...routes(['macro 1', 'filter 1 cutoff', 0.4], ['macro 2', 'amp', 0.2], ...MP_ECHO_SPACE),
    },
  },
  {
    name: 'Pulse Runner', tag: 'arp', macros: ['width', 'brightness', 'echo', 'space'],
    values: {
      ...arp('up', '1/8', 2, 0.5, 0, 124), ...o(1, 'PWM', 0.15, { level: 0.8 }),
      ...e(1, 0.001, 0.25, 0.3, 0.15), ...f(1, 'lp 24', 2400, 0.2, { key: 0.4, env: 0.3 }), ...e(2, 0.001, 0.2, 0, 0.1),
      ...echo('1/8 .', 0.45, 0.3), ...hall(0.2),
      ...routes(['macro 1', 'osc 1 position', 0.6], ['macro 2', 'filter 1 cutoff', 0.4], ...MP_ECHO_SPACE),
    },
  },
  {
    name: 'Felt Steps', tag: 'arp', macros: M_KEYS,
    values: {
      ...arp('played', '1/8 t', 1, 0.7, 0, 92), ...o(1, 'Felt', 0.2, { level: 0.85, warp: 'stretch', amt: 0.05 }),
      ...e(1, 0.003, 2.5, 0, 0.6, 0.7), ...e(2, 0.001, 1, 0.1, 0.4), ...f(1, 'lp 12', 2400, 0.05, { key: 0.6, env: 0.3 }), drift: 0.15,
      ...hall(0.35, 4), ...echo('1/4', 0.3, 0.12),
      ...routes(['velocity', 'osc 1 position', 0.4], ['macro 1', 'filter 1 cutoff', 0.4], ['macro 2', 'osc 1 position', 0.4], ...MP_ECHO_SPACE),
    },
  },
  {
    name: 'Chord Pulse', tag: 'arp', macros: ['brightness', 'body', 'echo', 'space'],
    values: {
      ...arp('chord', '1/8', 1, 0.3, 0.1, 118), ...o(1, 'Analog', 0.55, { uni: 4, detune: 0.18, level: 0.8 }),
      ...e(1, 0.002, 0.3, 0.2, 0.2), ...e(2, 0.001, 0.2, 0, 0.1), ...f(1, 'lp 24', 1500, 0.2, { key: 0.3, env: 0.4 }),
      ...chorus(0.3), ...echo('1/8 .', 0.4, 0.25), ...hall(0.3), sqDepth: 0.2,
      ...routes(['macro 1', 'filter 1 cutoff', 0.4], ['macro 2', 'amp', 0.2], ...MP_ECHO_SPACE),
    },
  },
  {
    name: 'Daylight Run', tag: 'arp', macros: ['detune', 'brightness', 'echo', 'space'],
    values: {
      ...arp('up', '1/16', 3, 0.4, 0, 130), ...o(1, 'Basic', 0.5, { uni: 5, super: true, detune: 0.3, level: 0.8 }),
      ...e(1, 0.001, 0.3, 0.2, 0.2), ...f(1, 'lp 24', 3000, 0.15, { key: 0.4, env: 0.3 }), ...e(2, 0.001, 0.2, 0, 0.1),
      ...echo('1/8 .', 0.4, 0.22), ...hall(0.3), sqDepth: 0.25,
      ...routes(['macro 1', 'osc 1 detune', 0.4], ['macro 2', 'filter 1 cutoff', 0.4], ...MP_ECHO_SPACE),
    },
  },
  {
    name: 'Light Sequence', tag: 'seq', macros: ['brightness', 'tone', 'echo', 'space'],
    values: {
      ...o(1, 'Glass', 0.4, { level: 0.75 }), ...o(2, 'Basic', 0.5, { level: 0.25, uni: 2, detune: 0.1 }),
      ...e(1, 0.002, 0.6, 0.7, 0.5), ...f(1, 'lp 12', 4000, 0.1, { key: 0.4 }),
      s1Div: div('1/8'), s1Len: 8, ...steps(1, [0, 7, 3, 7, 5, 7, 8, 7]), tempo: 104,
      ...echo('1/8 .', 0.45, 0.28), ...hall(0.35, 5),
      ...routes(['step 1', 'pitch', SEMI], ['macro 1', 'filter 1 cutoff', 0.4], ['macro 2', 'osc 1 position', 0.4], ...MP_ECHO_SPACE),
    },
  },
  {
    name: 'Bubble Line', tag: 'seq', macros: ['bubble', 'resonance', 'echo', 'space'],
    values: {
      ...arp('up/dn', '1/16', 2, 0.5, 0.15, 112), ...o(1, 'Basic', 0.5, { level: 0.8 }),
      ...f(1, 'lp 24', 900, 0.5, { key: 0.4 }), ...e(1, 0.001, 0.25, 0.4, 0.15),
      s1Div: div('1/16'), s1Glide: 0.3, s1Retrig: 0, ...steps(1, [8, -4, 2, 6, -6, 4, 0, 8, -8, 2, 6, -2, 4, -4, 8, 0]),
      ...echo('1/8 .', 0.4, 0.25), ...hall(0.25), macro1: 0.7,
      ...routes(['step 1', 'filter 1 cutoff', 0.3, 'macro 1'], ['macro 2', 'filter 1 res', 0.3], ...MP_ECHO_SPACE),
    },
  },
  {
    name: 'Glass Ostinato', tag: 'arp', macros: M_PLUCK,
    values: {
      ...arp('up', '1/8', 1, 0.6, 0, 96), ...o(1, 'Glass', 0.55, { level: 0.75 }), ...o(2, 'Felt', 0.5, { level: 0.4 }),
      ...e(1, 0.002, 1.1, 0, 0.8, 0.6), ...f(1, 'lp 12', 5000, 0.05, { key: 0.4 }),
      ...echo('1/4 .', 0.45, 0.3), ...hall(0.4, 6, 0.8, 0.15), drift: 0.15,
      ...routes(['macro 1', 'filter 1 cutoff', 0.4], ['macro 2', 'amp', 0.2], ...MP_ECHO_SPACE),
    },
  },
  {
    name: 'Night Drive', tag: 'arp', macros: ['cutoff', 'grit', 'echo', 'squash'],
    values: {
      ...arp('up', '1/16', 1, 0.6, 0, 100), ...o(1, 'Basic', 0.5, { level: 0.8, uni: 2, detune: 0.1 }), subLevel: 0.4,
      ...f(1, 'lp 24', 500, 0.25, { key: 0.3, env: 0.5 }), ...e(1, 0.001, 0.25, 0.5, 0.1), ...e(2, 0.001, 0.15, 0, 0.1),
      ...ins('B', 'shape', 0.2, 0, 0.4), ...echo('1/8 .', 0.3, 0.12), sqDepth: 0.4, rvMix: 0.1,
      ...routes(['macro 1', 'filter 1 cutoff', 0.45], ['macro 2', 'insert B', 0.5], ['macro 3', 'delay mix', 0.4], ['macro 4', 'squash depth', 0.4]),
    },
  },
  {
    name: 'Swing Lights', tag: 'arp', macros: M_PLUCK,
    values: {
      ...arp('random', '1/16', 2, 0.4, 0.3, 108), ...o(1, 'FM', 0.15, { level: 0.75 }), ...o(2, 'Glass', 0.2, { oct: 1, level: 0.3 }),
      ...e(1, 0.001, 0.4, 0, 0.3, 0.6), ...f(1, 'lp 12', 5000, 0.05, { key: 0.4 }),
      ...echo('1/8 .', 0.4, 0.25), ...hall(0.35, 5),
      ...routes(['random', 'pan', 0.6], ['macro 1', 'filter 1 cutoff', 0.4], ['macro 2', 'amp', 0.2], ...MP_ECHO_SPACE),
    },
  },
  {
    name: 'Sequencer Dream', tag: 'seq', macros: ['brightness', 'tone', 'echo', 'space'],
    values: {
      ...o(1, 'Analog', 0.6, { uni: 3, detune: 0.12, level: 0.75 }),
      ...e(1, 0.002, 0.25, 0.3, 0.2), ...e(2, 0.001, 0.2, 0, 0.1), ...f(1, 'lp 24', 1400, 0.3, { key: 0.4, env: 0.4 }),
      s1Div: div('1/16'), s1Retrig: 0, ...steps(1, [0, 0, 7, 0, 3, 0, 8, 7, 0, 0, 5, 0, 3, 0, 7, 8]), tempo: 116,
      ...l(1, 'tri', 0.08, { free: true }),
      ...echo('1/8 .', 0.4, 0.25), ...hall(0.3), drift: 0.2,
      ...routes(['step 1', 'pitch', SEMI], ['lfo 1', 'filter 1 cutoff', 0.15], ['macro 1', 'filter 1 cutoff', 0.4], ['macro 2', 'osc 1 position', 0.3], ...MP_ECHO_SPACE),
    },
  },
  {
    name: 'Twinkle Field', tag: 'arp', macros: M_PLUCK,
    values: {
      ...arp('random', '1/8', 3, 0.3, 0.15, 90), ...o(1, 'Glass', 0.8, { oct: 1, warp: 'stretch', amt: 0.15, level: 0.7 }),
      ...e(1, 0.001, 1.5, 0, 1.5, 0.7), ...f(1, 'lp 12', 7000, 0.05),
      ...echo('1/4 .', 0.5, 0.3), ...hall(0.5, 8, 0.9, 0.3),
      ...routes(['random', 'pan', 0.7], ['macro 1', 'filter 1 cutoff', 0.3], ['macro 2', 'amp', 0.2], ...MP_ECHO_SPACE),
    },
  },

  // ==================================================================== textures
  {
    name: 'Wind Glass', tag: 'texture', macros: ['gust', 'brightness', 'glass', 'space'],
    values: {
      ...o(1, 'Glass', 0.4, { level: 0.25 }), nzLevel: 0.6, nzColour: 0.4,
      ...f(1, 'vowel', 300, 0.55), ...e(1, 1.5, 1, 1, 3), drift: 0.5,
      ...l(1, 'drift', 0.12, { free: true }), ...l(2, 'drift', 0.4, { free: true }),
      ...hall(0.5, 8, 0.9),
      ...routes(['lfo 1', 'filter 1 cutoff', 0.35], ['lfo 2', 'noise level', 0.2], ['macro 1', 'noise level', 0.3], ['macro 2', 'filter 1 cutoff', 0.4], ['macro 3', 'osc 1 level', 0.4], ['macro 4', 'reverb mix', 0.4]),
    },
  },
  {
    name: 'Ice Field', tag: 'texture', macros: ['smear', 'brightness', 'glass', 'space'],
    values: {
      ...o(1, 'Cloud', 0.3, { warp: 'smear', amt: 0.5, uni: 4, detune: 0.2, width: 1, level: 0.75 }), ...o(2, 'Glass', 0.6, { oct: 1, level: 0.2, warp: 'stretch', amt: 0.2 }),
      ...e(1, 2, 2, 1, 5), ...f(1, 'lp 12', 5000, 0.1), drift: 0.6,
      ...l(1, 'drift', 0.08, { free: true }),
      ...hall(0.55, 12, 1, 0.4), ...chorus(0.3),
      ...routes(['lfo 1', 'osc 1 position', 0.4], ['macro 1', 'osc 1 warp', 0.4], ['macro 2', 'filter 1 cutoff', 0.4], ['macro 3', 'osc 2 level', 0.4], ['macro 4', 'reverb mix', 0.35]),
    },
  },
  {
    name: 'Photon Rain', tag: 'texture', macros: ['rain', 'brightness', 'spiral', 'space'],
    values: {
      ...o(1, 'Scan', 0.5, { level: 0.6 }),
      ...e(1, 0.4, 1, 1, 3), ...f(1, 'lp 12', 8000, 0.1), drift: 0.3,
      ...l(1, 's&h', '1/32', { free: true }), ...l(2, 's&h', '1/16', { free: true }),
      ...echo('1/8 .', 0.6, 0.4, { spiral: 0.4 }), ...hall(0.5, 7), macro1: 0.7,
      ...routes(['lfo 1', 'osc 1 position', 0.5, 'macro 1'], ['lfo 2', 'pan', 0.6], ['macro 2', 'filter 1 cutoff', 0.4], ['macro 3', 'delay mix', 0.3], ['macro 4', 'reverb mix', 0.4]),
    },
  },
  {
    name: 'Deep Space', tag: 'texture', macros: ['depth', 'brightness', 'motion', 'space'],
    values: {
      ...o(1, 'Cloud', 0.6, { oct: -2, uni: 3, detune: 0.15, level: 0.8 }), ...o(2, 'Analog', 0.2, { oct: -1, level: 0.35 }),
      ...e(1, 3, 3, 1, 8), ...f(1, 'lp 12', 1200, 0.2), drift: 0.7, warmth: 0.3,
      ...l(1, 'drift', 0.04, { free: true }), ...l(2, 'sine', 0.02, { free: true }),
      ...hall(0.6, 16, 1, 0.2),
      ...routes(['lfo 1', 'osc 1 position', 0.4], ['lfo 2', 'filter 1 cutoff', 0.2], ['macro 1', 'sub level', 0.5], ['macro 2', 'filter 1 cutoff', 0.4], ['macro 3', 'osc 1 position', 0.4], ['macro 4', 'reverb mix', 0.3]),
    },
  },
  {
    name: 'Static Choir', tag: 'texture', macros: ['static', 'vowel', 'width', 'space'],
    values: {
      ...o(1, 'Vocal', 0.5, { uni: 5, detune: 0.2, level: 0.7 }), ...ins('A', 'crush', 0.3, 0.1, 0.35),
      ...e(1, 1.2, 1, 1, 3), ...f(1, 'lp 12', 4000, 0.1), drift: 0.6,
      ...l(1, 'drift', 0.1, { free: true }),
      ...hall(0.5, 8, 0.9), ...chorus(0.3),
      ...routes(['lfo 1', 'osc 1 position', 0.4], ['macro 1', 'insert A', 0.5], ['macro 2', 'osc 1 position', 0.5], ['macro 3', 'osc 1 detune', 0.4], ['macro 4', 'reverb mix', 0.4]),
    },
  },
  {
    name: 'Glacier', tag: 'texture', macros: ['tone', 'stretch', 'motion', 'space'],
    values: {
      ...o(1, 'Glass', 0.3, { warp: 'stretch', amt: -0.3, uni: 3, detune: 0.1, level: 0.75 }),
      ...ins('A', 'comb', 0.4, 0.5, 0.4),
      ...e(1, 2.5, 2, 1, 6), ...f(1, 'lp 12', 3000, 0.1), drift: 0.5,
      ...l(1, 'sine', 0.05, { free: true }),
      ...hall(0.55, 12, 1, 0.25),
      ...routes(['lfo 1', 'insert A', 0.2], ['macro 1', 'filter 1 cutoff', 0.4], ['macro 2', 'osc 1 warp', 0.5], ['macro 3', 'osc 1 position', 0.5], ['macro 4', 'reverb mix', 0.35]),
    },
  },
  {
    name: 'Ionosphere', tag: 'texture', macros: ['shift', 'brightness', 'echo', 'space'],
    values: {
      ...o(1, 'Analog', 0.5, { uni: 4, detune: 0.2, level: 0.7 }), ...ins('B', 'shift', 0.5, 0, 0.6),
      ...e(1, 1.5, 1, 1, 4), ...f(1, 'lp 12', 3500, 0.1), drift: 0.4,
      ...l(1, 'sine', 0.04, { free: true }),
      ...hall(0.55, 10, 0.95, 0.2), ...echo('1/4 .', 0.5, 0.2, { spiral: 0.2 }),
      ...routes(['lfo 1', 'insert B', 0.08], ['macro 1', 'insert B', 0.2], ['macro 2', 'filter 1 cutoff', 0.4], ['macro 3', 'delay mix', 0.3], ['macro 4', 'reverb mix', 0.35]),
    },
  },
  {
    name: 'Tidal Light', tag: 'texture', macros: ['swell', 'brightness', 'motion', 'space'],
    values: {
      ...o(1, 'Analog', 0.4, { uni: 6, detune: 0.2, width: 1, level: 0.75 }), ...o(2, 'Glass', 0.5, { oct: 1, level: 0.2 }), nzColour: 0.3,
      ...e(1, 1, 1, 1, 4), ...f(1, 'lp 12', 1200, 0.2), drift: 0.5,
      ...l(1, 'sine', 0.12, { free: true, uni: true }),
      ...hall(0.5, 9, 0.9), ...chorus(0.3),
      ...routes(['lfo 1', 'filter 1 cutoff', 0.45], ['lfo 1', 'noise level', 0.15], ['lfo 1', 'amp', 0.3], ['macro 1', 'amp', 0.2], ['macro 2', 'filter 1 cutoff', 0.4], ['macro 3', 'osc 1 position', 0.4], ['macro 4', 'reverb mix', 0.35]),
    },
  },

  // ======================================================================== neon
  {
    name: 'Spiral Rain', tag: 'neon', macros: ['echo', 'brightness', 'space', 'rain'],
    values: {
      ...o(1, 'Glass', 0.5, { level: 0.8 }), ...o(2, 'Basic', 0.25, { level: 0.35 }),
      ...e(1, 0.002, 0.6, 0.2, 1.2, 0.5), ...f(1, 'lp 12', 6500, 0.1, { key: 0.4 }),
      ...l(1, 's&h', '1/16', { free: true }),
      ...echo('1/8 .', 0.65, 0.42, { spiral: 0.55, damp: 0.35 }), ...hall(0.35, 6), macro4: 0.5,
      ...routes(['lfo 1', 'osc 1 position', 0.4, 'macro 4'], ['macro 1', 'delay mix', 0.4], ['macro 2', 'filter 1 cutoff', 0.4], ['macro 3', 'reverb mix', 0.4]),
    },
  },
  {
    name: 'Broken Spectrum', tag: 'neon', macros: ['shift', 'smear', 'scan', 'space'],
    values: {
      ...mono(0.05), ...o(1, 'Scan', 0.4, { warp: 'smear', amt: 0.3, level: 0.75 }), ...o(2, 'Basic', 0.5, { uni: 3, detune: 0.15, level: 0.55 }),
      ...ins('B', 'shift', 0.6, 0.6, 0.45), ...f(1, 'lp 24', 4800, 0.3, { key: 0.3 }), ...e(1, 0.004, 0.4, 0.85, 0.25),
      ...l(1, 's&h', '1/16', { free: true }), ...echo('1/16', 0.4, 0.2), sqDepth: 0.3, rvMix: 0.2,
      ...routes(['lfo 1', 'osc 1 position', 0.4], ['macro 1', 'insert B', 0.35], ['macro 2', 'osc 1 warp', 0.6], ['macro 3', 'osc 1 position', 0.5], ['macro 4', 'reverb mix', 0.4]),
    },
  },
  {
    // three octaves of one tone rising together; the bottom one fades in and the top one
    // out as the ramp climbs, so when the ramp wraps back down nothing audible jumps
    name: 'Shepard Ascent', tag: 'neon', macros: ['brightness', 'space', 'echo', 'glass'],
    values: {
      ...o(1, 'Glass', 0.3, { oct: -1, level: 0 }), ...o(2, 'Glass', 0.3, { level: 0.6 }), ...o(3, 'Glass', 0.3, { oct: 1, level: 0.55 }),
      ...e(1, 1.5, 1, 1, 3), ...f(1, 'lp 12', 6000),
      ...l(1, 'ramp', '2 bar', { uni: true }), ...hall(0.5, 9, 0.9, 0.15), ...echo('1/4 .', 0.5, 0),
      ...routes(['lfo 1', 'pitch', 0.5], ['lfo 1', 'osc 1 level', 0.55], ['lfo 1', 'osc 3 level', -0.55], ['macro 1', 'filter 1 cutoff', 0.4], ['macro 2', 'reverb mix', 0.4], ['macro 3', 'delay mix', 0.4], ['macro 4', 'osc 2 position', 0.6]),
    },
  },
  {
    name: 'Android Vowel', tag: 'neon', macros: ['vowel', 'resonance', 'robot', 'space'],
    values: {
      ...mono(0.09), ...o(1, 'Basic', 0.5, { uni: 3, detune: 0.1, level: 0.8 }), ...o(2, 'PWM', 0.3, { level: 0.5 }),
      ...f(1, 'vowel', 120, 0.6), ...ins('A', 'crush', 0.25, 0.2, 0), ...e(1, 0.01, 0.4, 0.9, 0.3),
      ...l(1, 'tri', 0.3, { free: true }), ...l(2, 'sine', 5.2, { fade: 0.5 }), rvMix: 0.2, ...echo('1/4 .', 0.4, 0.15),
      ...routes(['mod wheel', 'filter 1 cutoff', 0.65], ['lfo 1', 'filter 1 cutoff', 0.08], ['lfo 2', 'pitch', 0.006], ['macro 1', 'filter 1 cutoff', 0.6], ['macro 2', 'filter 1 res', 0.35], ['macro 3', 'insert A', 0.6], ['macro 4', 'reverb mix', 0.4]),
    },
  },
  {
    name: 'Hologram', tag: 'neon', macros: ['glitch', 'brightness', 'space', 'motion'],
    values: {
      ...o(1, 'Steps', 0.3, { uni: 4, detune: 0.15, width: 1, level: 0.7 }), ...o(2, 'FM', 0.5, { oct: 1, warp: 'skew', amt: 0.3, level: 0.3 }),
      ...e(1, 0.5, 1, 0.9, 2), ...f(1, 'lp 12', 6000, 0.1), drift: 0.3,
      ...l(1, 's&h', '1/8', { free: true }), ...l(2, 'sine', 0.1, { free: true }),
      ...chorus(0.4), dimMix: 0.4, ...hall(0.4, 6), macro1: 0.5,
      ...routes(['lfo 1', 'osc 1 position', 0.3, 'macro 1'], ['lfo 2', 'osc 2 warp', 0.4], ['macro 2', 'filter 1 cutoff', 0.4], ['macro 3', 'reverb mix', 0.4], ['macro 4', 'osc 2 position', 0.4]),
    },
  },
  {
    name: 'Data Ghost', tag: 'neon', macros: ['corrupt', 'brightness', 'echo', 'space'],
    values: {
      ...o(1, 'FM', 0.35, { level: 0.75 }), ...ins('B', 'crush', 0.35, 0.3, 0.5),
      ...e(1, 0.002, 0.8, 0.3, 0.6), ...f(1, 'lp 12', 6000, 0.1),
      s1Div: div('1/16'), s1Retrig: 0, ...steps(1, [0, 0, 0, 7, 0, -5, 0, 8, 0, 0, 3, 0, -8, 0, 5, 0]),
      ...l(1, 's&h', '1/16', { free: true }), ...echo('1/16', 0.5, 0.25), ...hall(0.3), macro1: 0.4,
      ...routes(['step 1', 'pitch', SEMI, 'macro 1'], ['lfo 1', 'osc 1 position', 0.3], ['macro 1', 'insert B', 0.4], ['macro 2', 'filter 1 cutoff', 0.4], ...MP_ECHO_SPACE),
    },
  },
  {
    name: 'Laser Grid', tag: 'neon', macros: ['zap', 'shift', 'echo', 'space'],
    values: {
      ...mono(0.03), ...o(1, 'Sync', 0.5, { uni: 2, detune: 0.1, level: 0.8 }),
      ...ins('B', 'shift', 0.58, 0, 0.35), ...e(1, 0.002, 0.3, 0.8, 0.2), ...e(4, 0.001, 0.15, 0, 0.1), ...f(1, 'lp 24', 7000, 0.2),
      ...echo('1/16', 0.45, 0.25), rvMix: 0.15, sqDepth: 0.3,
      ...routes(['env 4', 'pitch', 0.5], ['env 4', 'osc 1 position', 0.4], ['macro 1', 'osc 1 position', 0.4], ['macro 2', 'insert B', 0.3], ...MP_ECHO_SPACE),
    },
  },
  {
    name: 'Blade Lights', tag: 'neon', macros: ['shift', 'brightness', 'detune', 'space'],
    values: {
      ...o(1, 'Basic', 0.5, { uni: 7, super: true, detune: 0.4, width: 1, level: 0.8 }), ...ins('B', 'shift', 0.53, 0, 0.4),
      ...e(1, 0.6, 1, 0.9, 3), ...f(1, 'lp 24', 2600, 0.2), drift: 0.3,
      ...l(1, 'sine', 0.06, { free: true }),
      ...chorus(0.3), ...hall(0.5, 8, 0.9), ...echo('1/4 .', 0.5, 0.2, { spiral: 0.3 }),
      ...routes(['lfo 1', 'filter 1 cutoff', 0.2], ['macro 1', 'insert B', 0.2], ['macro 2', 'filter 1 cutoff', 0.4], ['macro 3', 'osc 1 detune', 0.4], ['macro 4', 'reverb mix', 0.35]),
    },
  },
  {
    name: 'Cyber Choir', tag: 'neon', macros: ['ring', 'vowel', 'formant', 'space'],
    values: {
      ...o(1, 'Vocal', 0.3, { uni: 5, detune: 0.15, width: 1, warp: 'formant', amt: -0.1, level: 0.75 }),
      ...ins('B', 'ring', 0.4, 0.2, 0.3), ...e(1, 0.6, 1, 0.9, 2.5), ...f(1, 'lp 12', 5000, 0.1), drift: 0.3,
      ...l(1, 'tri', '1 bar', { free: true }),
      ...hall(0.45, 7, 0.85), ...chorus(0.3), ...echo('1/4 .', 0.4, 0.15),
      ...routes(['lfo 1', 'osc 1 position', 0.4], ['macro 1', 'insert B', 0.4], ['macro 2', 'osc 1 position', 0.4], ['macro 3', 'osc 1 warp', 0.4], ['macro 4', 'reverb mix', 0.4]),
    },
  },
  {
    name: 'Glitch Steps', tag: 'neon', macros: ['glitch', 'crush', 'echo', 'space'],
    values: {
      ...o(1, 'Steps', 0.2, { level: 0.75 }), ...o(2, 'Sync', 0.4, { level: 0.4 }), ...ins('B', 'crush', 0.2, 0, 0.4),
      ...e(1, 0.002, 0.6, 0.5, 0.3), ...f(1, 'lp 24', 5000, 0.2),
      s1Div: div('1/16'), s1Retrig: 0, ...steps(1, [8, -8, 4, 0, -6, 8, 2, -2, 6, -8, 0, 8, -4, 4, -8, 6]),
      ...arp('up', '1/16', 2, 0.35, 0, 132),
      ...echo('1/16', 0.4, 0.2), rvMix: 0.15, sqDepth: 0.3, macro1: 0.6,
      ...routes(['step 1', 'osc 1 position', 0.5, 'macro 1'], ['step 1', 'osc 2 position', -0.4, 'macro 1'], ['macro 2', 'insert B', 0.5], ...MP_ECHO_SPACE),
    },
  },
  {
    name: 'Synthetic Heart', tag: 'neon', macros: ['pulse', 'cutoff', 'grit', 'squash'],
    values: {
      ...mono(0.04), ...o(1, 'PWM', 0.4, { level: 0.8 }), subLevel: 0.6,
      ...f(1, 'lp 24', 600, 0.35, { env: 0.3 }), ...e(1, 0.002, 0.2, 0.7, 0.15), ...e(2, 0.001, 0.2, 0, 0.1),
      ...l(1, 'ramp', '1/8', { free: true, uni: true }), ...ins('B', 'parabolic', 0.2, 0, 0.5), sqDepth: 0.45, macro1: 0.7,
      ...routes(['lfo 1', 'amp', 0.8, 'macro 1'], ['macro 1', 'amp', -0.8], ['macro 2', 'filter 1 cutoff', 0.4], ['macro 3', 'insert B', 0.5], ['macro 4', 'squash depth', 0.4]),
    },
  },

  // ================================================================ second bank
  // After the first bank rather than among it, so the host's program numbers
  // for the sounds above stay put; the browser sorts by category anyway.
  //
  // Many of the rhythmic sounds below use one trick: a unipolar ramp LFO,
  // retriggered and synced to the sixteenth, routed negatively to amp (and
  // the filter). Every step then starts loud and dies away, so a held note is
  // re-struck on the grid, and the steppers (also restarted by the note)
  // choose the pitch, the timbre, or whether that step sounds at all.

  // ======================================================================== pads
  {
    name: 'Spectral Bloom', tag: 'pad', macros: ['bloom', 'brightness', 'air', 'space'],
    values: {
      ...o(1, 'Analog', 0.1, { uni: 6, detune: 0.2, width: 1, level: 0.75 }), ...o(2, 'Cloud', 0.3, { oct: -1, warp: 'smear', amt: 0.3, level: 0.3 }),
      ...e(1, 1.5, 2, 0.9, 4, 0.1), ...e(3, 4, 4, 0.6, 4), ...f(1, 'lp 12', 2500, 0.1, { key: 0.3 }), drift: 0.4,
      ...chorus(0.35), ...hall(0.5, 8, 0.9, 0.2),
      ...routes(['env 3', 'osc 1 position', 0.6], ['macro 1', 'osc 1 position', 0.3], ['macro 2', 'filter 1 cutoff', 0.4], ['macro 3', 'noise level', 0.2], ['macro 4', 'reverb mix', 0.4]),
    },
  },
  {
    name: 'Warm Analog', tag: 'pad', macros: M_PAD,
    values: {
      ...o(1, 'Analog', 0.6, { uni: 4, detune: 0.15, level: 0.75 }), ...o(2, 'Analog', 0.4, { oct: -1, fine: -8, level: 0.4 }),
      ...e(1, 0.8, 2, 0.9, 2.5), ...f(1, 'lp 24', 1400, 0.2, { key: 0.4 }), drift: 0.5, warmth: 0.4,
      ...l(1, 'tri', 0.3, { free: true }),
      ...chorus(0.5), ...hall(0.4, 6, 0.8),
      ...routes(['lfo 1', 'filter 1 cutoff', 0.1], ...MP_PAD(), ['macro 2', 'osc 1 position', 0.3]),
    },
  },
  {
    name: 'Glass Swell', tag: 'pad', macros: ['glass', 'brightness', 'air', 'space'],
    values: {
      ...o(1, 'Glass', 0.2, { warp: 'stretch', amt: 0.1, uni: 4, detune: 0.12, level: 0.65 }), ...o(2, 'Basic', 0.3, { level: 0.35 }),
      ...e(1, 2, 2, 1, 5), ...e(3, 5, 3, 0.8, 4), ...f(1, 'lp 12', 4500, 0.1), drift: 0.3,
      ...hall(0.55, 10, 1, 0.3),
      ...routes(['env 3', 'osc 1 position', 0.5], ['macro 1', 'osc 1 warp', 0.4], ['macro 2', 'filter 1 cutoff', 0.4], ['macro 3', 'noise level', 0.2], ['macro 4', 'reverb mix', 0.4]),
    },
  },
  {
    name: 'Comb Haze', tag: 'pad', macros: ['comb', 'brightness', 'air', 'space'],
    values: {
      ...o(1, 'Analog', 0.5, { uni: 5, detune: 0.2, level: 0.7 }), ...ins('A', 'comb', 0.45, 0.4, 0.5),
      ...e(1, 1.2, 2, 0.9, 3.5), ...f(1, 'lp 12', 3000, 0.1), drift: 0.4,
      ...l(1, 'drift', 0.1, { free: true }),
      ...chorus(0.3), ...hall(0.5, 8, 0.9),
      ...routes(['lfo 1', 'insert A', 0.25], ['macro 1', 'insert A', 0.4], ['macro 2', 'filter 1 cutoff', 0.4], ['macro 3', 'noise level', 0.2], ['macro 4', 'reverb mix', 0.4]),
    },
  },
  {
    name: 'Vowel Drift', tag: 'pad', macros: ['vowel', 'formant', 'air', 'space'],
    values: {
      ...o(1, 'Vocal', 0.5, { warp: 'formant', amt: 0, uni: 4, detune: 0.15, width: 1, level: 0.75 }), ...o(2, 'Vocal', 0.2, { oct: -1, level: 0.3 }),
      ...e(1, 1, 2, 0.9, 3), ...f(1, 'lp 12', 5000, 0.1), drift: 0.4, nzColour: 0.4,
      ...l(1, 'drift', 0.08, { free: true }), ...l(2, 'tri', 0.05, { free: true }),
      ...chorus(0.35), ...hall(0.45, 7, 0.85),
      ...routes(['lfo 1', 'osc 1 position', 0.5], ['lfo 2', 'osc 2 position', 0.4], ['macro 1', 'osc 1 position', 0.5], ['macro 2', 'osc 1 warp', 0.5], ['macro 3', 'noise level', 0.2], ['macro 4', 'reverb mix', 0.4]),
    },
  },
  {
    name: 'Dusk Organ', tag: 'pad', macros: ['drawbars', 'brightness', 'swell', 'space'],
    values: {
      ...o(1, 'Organ', 0.3, { uni: 4, detune: 0.12, level: 0.75 }), ...o(2, 'Organ', 0.7, { oct: -1, level: 0.3 }),
      ...e(1, 0.7, 1, 1, 2.5), ...f(1, 'lp 12', 3500, 0.1),
      ...l(1, 'sine', 0.2, { free: true }),
      ...chorus(0.45), ...hall(0.45, 6, 0.85),
      ...routes(['lfo 1', 'osc 1 position', 0.1], ['macro 1', 'osc 1 position', 0.5], ['macro 2', 'filter 1 cutoff', 0.4], ['macro 3', 'amp', 0.2], ['macro 4', 'reverb mix', 0.4]),
    },
  },

  // ======================================================================== keys
  {
    name: 'Electric Felt', tag: 'keys', macros: ['tone', 'tremolo', 'echo', 'space'],
    values: {
      ...o(1, 'Felt', 0.4, { level: 0.85 }), ...o(2, 'Basic', 0.1, { oct: 1, level: 0.15 }),
      ...e(1, 0.003, 3, 0.15, 0.5, 0.6), ...e(2, 0.001, 0.8, 0.1, 0.4), ...f(1, 'lp 12', 2400, 0.05, { key: 0.6, env: 0.35 }), vel: 0.75,
      ...l(1, 'sine', 4.8, { free: true }), drift: 0.15,
      ...chorus(0.3), ...hall(0.25, 2.5),
      ...routes(['velocity', 'osc 1 position', 0.4], ['lfo 1', 'amp', 0.35, 'macro 2'], ['macro 1', 'filter 1 cutoff', 0.4], ...MP_ECHO_SPACE),
    },
  },
  {
    name: 'FM Piano', tag: 'keys', macros: M_KEYS,
    values: {
      ...o(1, 'FM', 0.25, { level: 0.8 }), ...o(2, 'Felt', 0.3, { level: 0.4 }),
      ...e(1, 0.002, 3, 0.1, 0.5, 0.7), ...e(2, 0.001, 1.2, 0, 0.4), ...f(1, 'lp 12', 5000, 0.05, { key: 0.5 }), vel: 0.7,
      ...chorus(0.2), ...hall(0.3, 3),
      ...routes(['env 2', 'osc 1 position', 0.35], ['velocity', 'osc 1 position', 0.3], ['macro 1', 'filter 1 cutoff', 0.4], ['macro 2', 'osc 1 position', 0.4], ...MP_ECHO_SPACE),
    },
  },
  {
    name: 'Harpsichord Prism', tag: 'keys', macros: ['brightness', 'quill', 'echo', 'space'],
    values: {
      ...o(1, 'Sync', 0.45, { level: 0.75 }), ...o(2, 'PWM', 0.8, { oct: 1, level: 0.3 }),
      ...e(1, 0.001, 1.2, 0, 0.3, 0.6), ...e(2, 0.001, 0.4, 0, 0.2), ...f(1, 'lp 12', 6000, 0.1, { key: 0.4 }), ...f(2, 'hp', 200),
      ...hall(0.3, 3),
      ...routes(['env 2', 'osc 1 position', 0.3], ['macro 1', 'filter 1 cutoff', 0.4], ['macro 2', 'osc 1 position', 0.3], ...MP_ECHO_SPACE),
    },
  },
  {
    name: 'Vowel Organ', tag: 'keys', macros: ['drawbars', 'vowel', 'rotor', 'space'],
    values: {
      ...o(1, 'Organ', 0.2, { level: 0.75 }), ...f(1, 'vowel', 600, 0.4),
      ...e(1, 0.005, 0.2, 1, 0.08),
      ...l(1, 'sine', 5.8, { free: true }), ...l(2, 'tri', 0.2, { free: true }), macro3: 0.6,
      ...chorus(0.4, 5, 0.25), ...hall(0.2, 2),
      ...routes(['lfo 2', 'filter 1 cutoff', 0.1], ['lfo 1', 'pan', 0.25, 'macro 3'], ['macro 1', 'osc 1 position', 0.45], ['macro 2', 'filter 1 cutoff', 0.5], ['macro 4', 'reverb mix', 0.4]),
    },
  },
  {
    name: 'Celeste Glass', tag: 'keys', macros: M_KEYS,
    values: {
      ...o(1, 'Glass', 0.1, { oct: 1, level: 0.7 }), ...o(2, 'Basic', 0, { oct: 2, level: 0.15 }),
      ...e(1, 0.001, 1.6, 0, 1.2, 0.7), ...f(1, 'lp 12', 7000, 0.05), vel: 0.6,
      ...hall(0.4, 4.5, 0.8, 0.2), ...echo('1/4 .', 0.35, 0.12),
      ...routes(['velocity', 'osc 1 position', 0.3], ['macro 1', 'filter 1 cutoff', 0.3], ['macro 2', 'osc 1 position', 0.4], ...MP_ECHO_SPACE),
    },
  },
  {
    name: 'Toy Keys', tag: 'keys', macros: ['brightness', 'wobble', 'echo', 'space'],
    values: {
      ...o(1, 'Steps', 0.5, { oct: 1, level: 0.7 }),
      ...e(1, 0.001, 0.8, 0, 0.5), ...f(1, 'lp 12', 6000, 0.05), vel: 0.5,
      ...l(1, 'sine', 6, { free: true }), macro2: 0.4,
      ...hall(0.25, 2),
      ...routes(['lfo 1', 'pitch', 0.003, 'macro 2'], ['macro 1', 'filter 1 cutoff', 0.3], ...MP_ECHO_SPACE),
    },
  },

  // ============================================================== plucks & bells
  {
    name: 'Steel Pan', tag: 'pluck', macros: ['metal', 'brightness', 'echo', 'space'],
    values: {
      ...o(1, 'FM', 0.35, { warp: 'stretch', amt: 0.06, level: 0.8 }),
      ...e(1, 0.001, 1.2, 0, 0.8, 0.7), ...e(2, 0.001, 0.3, 0, 0.2), ...f(1, 'lp 12', 6000, 0.05), vel: 0.6,
      ...hall(0.3, 3), ...echo('1/8 .', 0.3, 0.12),
      ...routes(['env 2', 'osc 1 position', 0.3], ['macro 1', 'osc 1 warp', 0.3], ['macro 2', 'filter 1 cutoff', 0.3], ...MP_ECHO_SPACE),
    },
  },
  {
    name: 'Comb String', tag: 'pluck', macros: ['brightness', 'body', 'echo', 'space'],
    values: {
      // a saw and a burst of noise into a comb: close to a plucked string
      ...o(1, 'Basic', 0.5, { level: 0.7 }), nzLevel: 0.3, nzColour: 0.3, ...ins('A', 'comb', 0.7, 0.5, 0.8),
      ...e(1, 0.001, 1.5, 0, 1, 0.6), ...e(2, 0.001, 0.15, 0, 0.1), ...f(1, 'lp 12', 3000, 0.1, { key: 0.5, env: 0.5 }),
      ...hall(0.3, 3.5),
      ...routes(['macro 1', 'filter 1 cutoff', 0.4], ['macro 2', 'insert A', 0.3], ...MP_ECHO_SPACE),
    },
  },
  {
    name: 'Koto Shift', tag: 'pluck', macros: M_PLUCK,
    values: {
      ...o(1, 'Analog', 0.75, { level: 0.8 }), ...o(2, 'Glass', 0.3, { level: 0.25 }), ...ins('B', 'shift', 0.52, 0, 0.3),
      ...e(1, 0.001, 1, 0, 0.7, 0.6), ...e(2, 0.001, 0.3, 0, 0.2), ...f(1, 'lp 12', 4000, 0.15, { key: 0.5, env: 0.4 }),
      ...l(1, 'sine', 5, { fade: 0.6 }),
      ...hall(0.35, 4), ...echo('1/4', 0.3, 0.15),
      ...routes(['lfo 1', 'pitch', 0.006], ['macro 1', 'filter 1 cutoff', 0.4], ['macro 2', 'amp', 0.2], ...MP_ECHO_SPACE),
    },
  },
  {
    name: 'Pizzicato Light', tag: 'pluck', macros: M_PLUCK,
    values: {
      ...o(1, 'Basic', 0.5, { uni: 4, detune: 0.15, level: 0.8 }),
      ...e(1, 0.002, 0.3, 0, 0.25), ...e(2, 0.001, 0.2, 0, 0.15), ...f(1, 'lp 12', 1500, 0.1, { key: 0.5, env: 0.5 }),
      ...chorus(0.45), ...hall(0.35, 3),
      ...routes(['velocity', 'filter 1 cutoff', 0.25], ['macro 1', 'filter 1 cutoff', 0.4], ['macro 2', 'amp', 0.2], ...MP_ECHO_SPACE),
    },
  },
  {
    name: 'Fold Marimba', tag: 'pluck', macros: ['fold', 'brightness', 'echo', 'space'],
    values: {
      ...o(1, 'Fold', 0.1, { level: 0.8 }),
      ...e(1, 0.001, 0.6, 0, 0.4, 0.75), ...e(4, 0.001, 0.06, 0, 0.05), ...f(1, 'lp 12', 5000, 0.05), vel: 0.7,
      ...hall(0.3, 3),
      ...routes(['env 4', 'osc 1 position', 0.4], ['velocity', 'osc 1 position', 0.25], ['macro 1', 'osc 1 position', 0.3], ['macro 2', 'filter 1 cutoff', 0.3], ...MP_ECHO_SPACE),
    },
  },
  {
    name: 'Supersaw Pluck', tag: 'pluck', macros: ['detune', 'brightness', 'echo', 'space'],
    values: {
      ...o(1, 'Basic', 0.5, { uni: 7, super: true, detune: 0.4, width: 1, level: 0.85 }),
      ...e(1, 0.001, 0.5, 0, 0.4), ...e(2, 0.001, 0.25, 0, 0.2), ...f(1, 'lp 24', 900, 0.15, { key: 0.4, env: 0.6 }),
      ...echo('1/8 .', 0.4, 0.25), ...hall(0.35, 4), sqDepth: 0.3,
      ...routes(['macro 1', 'osc 1 detune', 0.4], ['macro 2', 'filter 1 cutoff', 0.4], ...MP_ECHO_SPACE),
    },
  },

  // ======================================================================= leads
  {
    name: 'Theremin Ray', tag: 'lead', macros: ['vibrato', 'tone', 'echo', 'space'],
    values: {
      ...mono(0.3), ...o(1, 'Basic', 0, { level: 0.85 }), ...f(1, 'off', 8000),
      ...e(1, 0.12, 0.5, 1, 0.6), ...l(1, 'sine', 6, { fade: 1 }), macro1: 0.4,
      ...hall(0.4, 5), ...echo('1/4 .', 0.35, 0.15),
      ...routes(['lfo 1', 'pitch', 0.015], ['lfo 1', 'pitch', 0.02, 'macro 1'], ['macro 2', 'osc 1 position', 0.15], ...MP_ECHO_SPACE),
    },
  },
  {
    name: 'Chip Lead', tag: 'lead', macros: ['crunch', 'vibrato', 'echo', 'space'],
    values: {
      ...mono(0.02), ...o(1, 'Steps', 0.8, { level: 0.75 }), ...o(2, 'PWM', 0.7, { level: 0.3 }), ...f(1, 'off', 8000),
      ...e(1, 0.001, 0.3, 0.8, 0.08), ...l(1, 'square', 7, { fade: 0.4 }), macro2: 0.6,
      ...echo('1/8', 0.3, 0.15), rvMix: 0.1,
      ...routes(['lfo 1', 'pitch', 0.006, 'macro 2'], ['macro 1', 'osc 1 position', 0.3], ...MP_ECHO_SPACE),
    },
  },
  {
    name: 'Talking Lead', tag: 'lead', macros: ['vowel', 'talk', 'echo', 'space'],
    values: {
      // a tempo-synced triangle walks the vowel: it says something on the eighths
      ...mono(0.06), ...o(1, 'Vocal', 0.3, { uni: 2, detune: 0.08, level: 0.85 }), ...o(2, 'Basic', 0.5, { oct: -1, level: 0.3 }),
      ...f(1, 'lp 24', 5000, 0.15), ...e(1, 0.005, 0.4, 0.9, 0.25),
      ...l(1, 'tri', '1/8'), ...l(2, 'sine', 5.4, { fade: 0.5 }), macro2: 0.6,
      ...echo('1/8 .', 0.35, 0.18), ...hall(0.2),
      ...routes(['lfo 1', 'osc 1 position', 0.35, 'macro 2'], ['lfo 2', 'pitch', 0.006], ['macro 1', 'osc 1 position', 0.5], ...MP_ECHO_SPACE),
    },
  },
  {
    name: 'Scream Sync', tag: 'lead', macros: ['sync', 'drive', 'echo', 'space'],
    values: {
      ...mono(0.04), ...o(1, 'Sync', 0.3, { uni: 3, detune: 0.12, level: 0.85 }), ...ins('B', 'clip', 0.4, 0.1, 0.7),
      ...f(1, 'lp 24', 5500, 0.2), ...e(1, 0.002, 0.4, 0.9, 0.2), ...e(2, 0.002, 0.6, 0.1, 0.3),
      ...l(1, 'sine', 5.6, { fade: 0.5 }), sqDepth: 0.3,
      ...echo('1/8 .', 0.35, 0.18), ...hall(0.2),
      ...routes(['env 2', 'osc 1 position', 0.5], ['lfo 1', 'pitch', 0.012, 'mod wheel'], ['macro 1', 'osc 1 position', 0.4], ['macro 2', 'insert B', 0.5], ...MP_ECHO_SPACE),
    },
  },
  {
    name: 'Glide Saw', tag: 'lead', macros: M_LEAD,
    values: {
      ...mono(0.28), bend: 12, ...o(1, 'Analog', 0.9, { uni: 3, detune: 0.15, level: 0.85 }), ...o(2, 'Basic', 0.5, { oct: -1, level: 0.35 }),
      ...f(1, 'lp 24', 3000, 0.2, { key: 0.4 }), ...e(1, 0.01, 0.5, 0.9, 0.4), ...l(1, 'sine', 5.2, { fade: 0.8 }),
      ...ins('B', 'shape', 0, 0, 0.6), ...echo('1/4 .', 0.4, 0.2), ...hall(0.25),
      ...routes(['lfo 1', 'pitch', 0.008], ['macro 1', 'filter 1 cutoff', 0.4], ['macro 2', 'insert B', 0.5], ...MP_ECHO_SPACE),
    },
  },

  // ======================================================================== bass
  {
    name: 'Octave Bounce', tag: 'bass', macros: ['cutoff', 'bounce', 'sub', 'squash'],
    values: {
      // a two-step stepper on the eighths: hold one note and it jumps note, octave, note
      ...mono(0.01), ...o(1, 'Analog', 0.7, { uni: 2, detune: 0.08, level: 0.85 }), subLevel: 0.4,
      ...f(1, 'lp 24', 700, 0.3, { key: 0.3, env: 0.35 }), ...e(1, 0.002, 0.3, 0.9, 0.1), ...e(2, 0.001, 0.15, 0.2, 0.1),
      s1Div: div('1/8'), s1Len: 2, ...steps(1, [0, 8]), macro2: 1, sqDepth: 0.3, tempo: 124,
      ...routes(['step 1', 'pitch', 0.5, 'macro 2'], ['macro 1', 'filter 1 cutoff', 0.45], ['macro 3', 'sub level', 0.4], ['macro 4', 'squash depth', 0.5]),
    },
  },
  {
    name: 'Talk Bass', tag: 'bass', macros: ['talk', 'vowel', 'grit', 'squash'],
    values: {
      ...mono(0.05), ...o(1, 'Growl', 0.2, { uni: 2, detune: 0.06, level: 0.85 }), subLevel: 0.45,
      ...f(1, 'lp 24', 3000, 0.2), ...e(1, 0.003, 0.3, 0.95, 0.12), ...ins('B', 'fold', 0.2, 0, 0.5),
      ...l(1, 'sine', '1/8 .'), macro1: 0.7, sqDepth: 0.4, tempo: 140,
      ...routes(['lfo 1', 'osc 1 position', 0.35, 'macro 1'], ['macro 2', 'osc 1 position', 0.5], ['macro 3', 'insert B', 0.6], ['macro 4', 'squash depth', 0.5]),
    },
  },
  {
    name: '808 Boom', tag: 'bass', macros: ['punch', 'drive', 'tone', 'squash'],
    values: {
      // a sine that drops into its note and rings out: play it as a bassline
      ...mono(0.12, false), ...o(1, 'Basic', 0, { level: 0.9, phase: 0 }), ...f(1, 'off', 8000),
      ...e(1, 0.001, 1.6, 0, 0.6, 0.6), ...e(4, 0.001, 0.08, 0, 0.05), ...ins('B', 'clip', 0.2, 0, 0.6), macro1: 0.5,
      ...routes(['env 4', 'pitch', 0.25], ['env 4', 'pitch', 0.25, 'macro 1'], ['macro 2', 'insert B', 0.6], ['macro 3', 'osc 1 position', 0.15], ['macro 4', 'squash depth', 0.5]),
    },
  },
  {
    name: 'Rubber FM', tag: 'bass', macros: M_BASS,
    values: {
      ...mono(0.03, false), ...o(1, 'FM', 0.15, { level: 0.85 }), subLevel: 0.4,
      ...f(1, 'lp 24', 900, 0.3, { key: 0.3, env: 0.45 }), ...e(1, 0.002, 0.4, 0.5, 0.1), ...e(2, 0.001, 0.18, 0, 0.1),
      ...ins('B', 'shape', 0.15, 0, 0.4), sqDepth: 0.3,
      ...routes(['env 2', 'osc 1 position', 0.3], ['macro 1', 'filter 1 cutoff', 0.4], ['macro 2', 'insert B', 0.5], ['macro 3', 'sub level', 0.4], ['macro 4', 'squash depth', 0.5]),
    },
  },
  {
    name: 'Comb Bass', tag: 'bass', macros: ['comb', 'cutoff', 'sub', 'squash'],
    values: {
      ...mono(0.04), ...o(1, 'Analog', 0.8, { level: 0.8 }), subLevel: 0.5, ...ins('A', 'comb', 0.5, 0.2, 0.5),
      ...f(1, 'lp 24', 1200, 0.2, { key: 0.3, env: 0.3 }), ...e(1, 0.003, 0.3, 0.9, 0.12), ...e(2, 0.001, 0.25, 0.1, 0.1), sqDepth: 0.35,
      ...routes(['env 2', 'insert A', 0.2], ['macro 1', 'insert A', 0.4], ['macro 2', 'filter 1 cutoff', 0.4], ['macro 3', 'sub level', 0.4], ['macro 4', 'squash depth', 0.5]),
    },
  },
  {
    name: 'Hoover Bass', tag: 'bass', macros: ['detune', 'dive', 'grit', 'squash'],
    values: {
      ...mono(0.1), ...o(1, 'Analog', 0.9, { uni: 6, super: true, detune: 0.6, blend: 0.6, level: 0.85 }), ...o(2, 'PWM', 0.5, { oct: -1, level: 0.4 }),
      ...f(1, 'lp 24', 3000, 0.15), ...e(1, 0.01, 0.4, 0.95, 0.2), ...e(4, 0.001, 0.3, 0, 0.1),
      ...ins('B', 'clip', 0.1, 0, 0.5), sqDepth: 0.35, ...chorus(0.2),
      ...routes(['env 4', 'pitch', -0.08], ['macro 1', 'osc 1 detune', 0.3], ['macro 2', 'pitch', -0.1], ['macro 3', 'insert B', 0.5], ['macro 4', 'squash depth', 0.5]),
    },
  },

  // ====================================================================== synths
  {
    name: 'Juno Chords', tag: 'synth', macros: ['brightness', 'chorus', 'echo', 'space'],
    values: {
      ...o(1, 'Analog', 0.55, { uni: 2, detune: 0.08, level: 0.8 }), ...o(2, 'PWM', 0.4, { level: 0.35 }), subLevel: 0.2,
      ...f(1, 'lp 24', 1600, 0.2, { key: 0.4, env: 0.35 }), ...e(1, 0.005, 0.8, 0.6, 0.5), ...e(2, 0.002, 0.6, 0.2, 0.4), drift: 0.3,
      ...chorus(0.6, 0.5, 0.6), ...hall(0.3, 3),
      ...routes(['macro 1', 'filter 1 cutoff', 0.4], ['macro 2', 'chorus mix', 0.4], ...MP_ECHO_SPACE),
    },
  },
  {
    name: 'Brass Section', tag: 'synth', macros: ['brightness', 'swell', 'grit', 'space'],
    values: {
      ...o(1, 'Analog', 0.9, { uni: 4, detune: 0.16, level: 0.8 }), ...o(2, 'Basic', 0.5, { fine: -8, level: 0.4 }),
      ...f(1, 'lp 24', 600, 0.15, { key: 0.4, env: 0.55 }), ...e(1, 0.05, 0.6, 0.85, 0.4), ...e(2, 0.1, 0.8, 0.4, 0.4), vel: 0.6,
      ...l(1, 'sine', 5.5, { fade: 0.8 }), ...ins('B', 'parabolic', 0, 0, 0.5),
      ...chorus(0.25), ...hall(0.3, 3.5),
      ...routes(['lfo 1', 'pitch', 0.004], ['velocity', 'filter 1 cutoff', 0.25], ['macro 1', 'filter 1 cutoff', 0.4], ['macro 2', 'amp', 0.2], ['macro 3', 'insert B', 0.4], ['macro 4', 'reverb mix', 0.4]),
    },
  },
  {
    name: 'Gated Strings', tag: 'synth', macros: ['gate', 'brightness', 'ensemble', 'space'],
    values: {
      // the stepper starts with the chord, so the gate pattern lands where you play
      ...o(1, 'Basic', 0.5, { uni: 5, detune: 0.2, width: 0.9, level: 0.75 }), ...o(2, 'Basic', 0.62, { oct: 1, uni: 3, level: 0.25 }),
      ...f(1, 'lp 12', 3500, 0.08, { key: 0.5 }), ...e(1, 0.02, 1, 1, 0.4),
      s1Div: div('1/16'), s1Glide: 0.1, ...steps(1, [0, -8, 0, 0, -8, 0, -8, 0, 0, -8, 0, 0, -8, 0, 0, -8]), macro1: 1, tempo: 120,
      ...chorus(0.5, 0.5, 0.7), ...hall(0.35, 4),
      ...routes(['step 1', 'amp', 1, 'macro 1'], ['macro 2', 'filter 1 cutoff', 0.4], ['macro 3', 'chorus mix', 0.4], ['macro 4', 'reverb mix', 0.4]),
    },
  },
  {
    name: 'Sidechain Pad', tag: 'synth', macros: ['pump', 'brightness', 'air', 'space'],
    values: {
      ...o(1, 'Analog', 0.45, { uni: 6, detune: 0.22, width: 1, level: 0.75 }), ...o(2, 'Glass', 0.3, { oct: 1, level: 0.2 }),
      ...f(1, 'lp 12', 3000, 0.1), ...e(1, 0.3, 1, 1, 1.5),
      ...l(1, 'ramp', '1/4', { free: true, uni: true }), macro1: 0.8, tempo: 124,
      ...chorus(0.3), ...hall(0.4, 5),
      ...routes(['lfo 1', 'amp', 0.9, 'macro 1'], ['macro 1', 'amp', -0.9], ['macro 2', 'filter 1 cutoff', 0.4], ['macro 3', 'noise level', 0.2], ['macro 4', 'reverb mix', 0.4]),
    },
  },
  {
    name: 'Shimmer Stack', tag: 'synth', macros: ['detune', 'brightness', 'space', 'echo'],
    values: {
      ...o(1, 'Basic', 0.5, { uni: 8, super: true, detune: 0.35, width: 1, level: 0.75 }), ...o(2, 'Glass', 0.4, { oct: 1, level: 0.25 }),
      ...f(1, 'lp 24', 6000, 0.1), ...e(1, 0.01, 0.5, 0.9, 0.8),
      ...hall(0.45, 6, 0.85, 0.35), ...echo('1/4 .', 0.35, 0.15),
      ...routes(['macro 1', 'osc 1 detune', 0.4], ['macro 2', 'filter 1 cutoff', 0.4], ['macro 3', 'reverb mix', 0.3], ['macro 4', 'delay mix', 0.4]),
    },
  },

  // ======================================================================== arps
  {
    name: 'Cascade Down', tag: 'arp', macros: M_PLUCK,
    values: {
      ...arp('down', '1/32', 4, 0.6, 0, 112), ...o(1, 'Glass', 0.45, { level: 0.8 }), ...o(2, 'Basic', 0.3, { oct: 1, level: 0.2 }),
      ...e(1, 0.001, 0.15, 0, 0.15), ...f(1, 'lp 12', 5000, 0.1, { key: 0.4 }),
      ...echo('1/8', 0.4, 0.22), ...hall(0.4, 5, 0.85, 0.2),
      ...routes(['macro 1', 'filter 1 cutoff', 0.4], ['macro 2', 'amp', 0.2], ...MP_ECHO_SPACE),
    },
  },
  {
    name: 'Triplet Bells', tag: 'arp', macros: M_PLUCK,
    values: {
      ...arp('up', '1/16 t', 3, 0.4, 0, 100), ...o(1, 'FM', 0.5, { level: 0.7 }), ...o(2, 'Glass', 0.2, { oct: 1, level: 0.3 }),
      ...e(1, 0.001, 0.6, 0, 0.5, 0.7), ...f(1, 'lp 12', 6000, 0.05),
      ...echo('1/8 t', 0.4, 0.22), ...hall(0.4, 5),
      ...routes(['random', 'pan', 0.5], ['macro 1', 'filter 1 cutoff', 0.4], ['macro 2', 'amp', 0.2], ...MP_ECHO_SPACE),
    },
  },
  {
    name: 'Pumped Stabs', tag: 'arp', macros: ['brightness', 'pump', 'echo', 'space'],
    values: {
      ...arp('chord', '1/8', 1, 0.35, 0, 126), ...o(1, 'Basic', 0.5, { uni: 6, super: true, detune: 0.3, level: 0.85 }),
      ...f(1, 'lp 24', 1300, 0.2, { key: 0.3, env: 0.45 }), ...e(1, 0.002, 0.3, 0, 0.25), ...e(2, 0.001, 0.18, 0, 0.1),
      ...l(1, 'ramp', '1/4', { free: true, uni: true }), macro2: 0.7, sqDepth: 0.3,
      ...echo('1/8 .', 0.35, 0.2), ...hall(0.3),
      ...routes(['lfo 1', 'amp', 0.8, 'macro 2'], ['macro 2', 'amp', -0.8], ['macro 1', 'filter 1 cutoff', 0.4], ...MP_ECHO_SPACE),
    },
  },
  {
    name: 'Swing Felt', tag: 'arp', macros: M_KEYS,
    values: {
      ...arp('up/dn', '1/16', 2, 0.55, 0.32, 96), ...o(1, 'Felt', 0.3, { level: 0.85 }),
      ...e(1, 0.002, 0.8, 0, 0.5, 0.7), ...e(2, 0.001, 0.4, 0, 0.3), ...f(1, 'lp 12', 2600, 0.05, { key: 0.6, env: 0.3 }), vel: 0.6,
      ...hall(0.3, 3.5), ...echo('1/4', 0.3, 0.12),
      ...routes(['velocity', 'osc 1 position', 0.3], ['macro 1', 'filter 1 cutoff', 0.4], ['macro 2', 'osc 1 position', 0.4], ...MP_ECHO_SPACE),
    },
  },
  {
    name: 'Latch Garden', tag: 'arp', macros: ['brightness', 'scan', 'echo', 'space'],
    values: {
      // hold is on: play a chord and let go; a four-bar sweep scans the table under it
      ...arp('up/dn', '1/8', 2, 0.7, 0, 90), arpHold: 1, ...o(1, 'Scan', 0.3, { uni: 3, detune: 0.1, level: 0.75 }),
      ...e(1, 0.004, 0.7, 0.1, 0.8), ...f(1, 'lp 12', 4000, 0.1),
      ...l(1, 'tri', '4 bar', { free: true, uni: true }),
      ...hall(0.45, 7, 0.9, 0.2), ...echo('1/4 .', 0.4, 0.2),
      ...routes(['lfo 1', 'osc 1 position', 0.5], ['macro 1', 'filter 1 cutoff', 0.4], ['macro 2', 'osc 1 position', 0.3], ...MP_ECHO_SPACE),
      e1Sus: 0.3, volume: 1,
    },
  },
  {
    name: 'Octave Climb', tag: 'arp', macros: ['detune', 'brightness', 'echo', 'space'],
    values: {
      ...arp('up', '1/16', 4, 0.45, 0, 128), ...o(1, 'PWM', 0.3, { uni: 3, detune: 0.12, level: 0.8 }),
      ...e(1, 0.001, 0.2, 0, 0.15), ...e(2, 0.001, 0.12, 0, 0.1), ...f(1, 'lp 24', 2000, 0.25, { key: 0.5, env: 0.35 }),
      ...echo('1/8 .', 0.4, 0.2), ...hall(0.3),
      ...routes(['macro 1', 'osc 1 detune', 0.4], ['macro 2', 'filter 1 cutoff', 0.4], ...MP_ECHO_SPACE),
    },
  },

  // =================================================================== sequences
  {
    name: 'Step Pluck', tag: 'seq', macros: ['brightness', 'shorter', 'echo', 'space'],
    values: {
      // hold a chord: the ramp re-strikes it every sixteenth and stepper 1 plays the melody
      ...o(1, 'Analog', 0.6, { uni: 2, detune: 0.08, level: 0.8 }), ...o(2, 'Glass', 0.3, { oct: 1, level: 0.2 }),
      ...e(1, 0.003, 0.3, 1, 0.4), ...f(1, 'lp 24', 2500, 0.2, { key: 0.4 }),
      ...l(1, 'ramp', '1/16', { uni: true }),
      s1Div: div('1/16'), ...steps(1, [0, 0, 7, 0, 3, 0, 5, 7, 0, 0, 8, 7, 5, 3, 2, 3]), tempo: 118,
      ...echo('1/8 .', 0.35, 0.2), ...hall(0.3),
      ...routes(['lfo 1', 'amp', -0.7], ['lfo 1', 'amp', -0.6, 'macro 2'], ['lfo 1', 'filter 1 cutoff', -0.35], ['step 1', 'pitch', SEMI], ['macro 1', 'filter 1 cutoff', 0.4], ...MP_ECHO_SPACE),
    },
  },
  {
    name: 'Berlin Steps', tag: 'seq', macros: ['cutoff', 'resonance', 'echo', 'space'],
    values: {
      // octave jumps from stepper 1, accents from stepper 2, a four-bar sweep over the top
      ...o(1, 'Analog', 0.5, { level: 0.8 }), ...o(2, 'PWM', 0.6, { oct: -1, level: 0.35 }), subLevel: 0.2,
      ...f(1, 'lp 24', 600, 0.45, { key: 0.4 }), ...e(1, 0.003, 0.3, 1, 0.2),
      ...l(1, 'ramp', '1/16', { uni: true }), ...l(2, 'tri', '4 bar', { free: true, uni: true }),
      s1Div: div('1/16'), ...steps(1, [0, 0, 8, 0, 0, 8, 0, 3, 0, 0, 8, 0, 7, 0, 3, 5]),
      s2Div: div('1/16'), ...steps(2, [8, 0, 2, 0, 6, 0, 2, 0, 8, 0, 4, 0, 6, 0, 2, 4]), tempo: 120,
      ...echo('1/8 .', 0.45, 0.25), ...hall(0.25),
      ...routes(['step 1', 'pitch', SEMI], ['step 2', 'filter 1 cutoff', 0.2], ['lfo 1', 'filter 1 cutoff', -0.5], ['lfo 1', 'amp', -0.6], ['lfo 2', 'filter 1 cutoff', 0.3],
        ['macro 1', 'filter 1 cutoff', 0.4], ['macro 2', 'filter 1 res', 0.3], ...MP_ECHO_SPACE),
    },
  },
  {
    name: 'Polymeter Prism', tag: 'seq', macros: ['brightness', 'scan', 'echo', 'space'],
    values: {
      // seven pitches against five timbres: the phrase takes 35 steps to come round
      ...o(1, 'Scan', 0.3, { level: 0.75 }), ...o(2, 'Basic', 0.3, { level: 0.3 }),
      ...e(1, 0.003, 0.3, 1, 0.4), ...f(1, 'lp 12', 5000, 0.1),
      ...l(1, 'ramp', '1/16', { uni: true }),
      s1Div: div('1/16'), s1Len: 7, ...steps(1, [0, 3, 7, 3, 8, 7, 5]),
      s2Div: div('1/16'), s2Len: 5, ...steps(2, [-8, 0, 8, -4, 4]), tempo: 112,
      ...echo('1/8 .', 0.4, 0.25), ...hall(0.35, 4),
      ...routes(['lfo 1', 'amp', -1], ['step 1', 'pitch', SEMI], ['step 2', 'osc 1 position', 0.3], ['macro 1', 'filter 1 cutoff', 0.4], ['macro 2', 'osc 1 position', 0.3], ...MP_ECHO_SPACE),
    },
  },
  {
    name: 'Acid Steps', tag: 'seq', macros: ['cutoff', 'resonance', 'accent', 'squash'],
    values: {
      // a 303 line from one held note: gliding steps, accents on stepper 2
      ...mono(0.02), ...o(1, 'Basic', 0.5, { level: 0.85 }),
      ...f(1, 'lp 24', 400, 0.7, { drive: 0.3 }), ...e(1, 0.002, 0.3, 1, 0.1), ...ins('B', 'parabolic', 0.25, 0, 0.5),
      ...l(1, 'ramp', '1/16', { uni: true }),
      s1Div: div('1/16'), s1Glide: 0.35, ...steps(1, [0, 0, 8, 0, -5, 0, 3, 8, 0, -2, 0, 3, -5, 0, 8, 7]),
      s2Div: div('1/16'), ...steps(2, [8, 0, 0, 4, 8, 0, 0, 0, 8, 0, 4, 0, 0, 8, 0, 4]), macro3: 0.7, tempo: 126,
      ...echo('1/8 .', 0.35, 0.15), sqDepth: 0.3,
      ...routes(['step 1', 'pitch', SEMI], ['step 2', 'filter 1 cutoff', 0.35, 'macro 3'], ['lfo 1', 'filter 1 cutoff', -0.45], ['macro 1', 'filter 1 cutoff', 0.45], ['macro 2', 'filter 1 res', 0.25], ['macro 4', 'squash depth', 0.5]),
    },
  },
  {
    name: 'Talking Steps', tag: 'seq', macros: ['vowel', 'talk', 'echo', 'space'],
    values: {
      ...o(1, 'Vocal', 0.3, { uni: 3, detune: 0.1, level: 0.8 }), ...o(2, 'Basic', 0.5, { oct: -1, level: 0.3 }),
      ...f(1, 'lp 24', 5000, 0.1), ...e(1, 0.003, 0.3, 1, 0.3),
      ...l(1, 'ramp', '1/8', { uni: true }),
      s1Div: div('1/8'), s1Len: 8, s1Glide: 0.5, ...steps(1, [-8, 4, -2, 8, 0, -6, 6, 2]), macro2: 0.8, tempo: 104,
      ...echo('1/4 .', 0.35, 0.2), ...hall(0.3),
      ...routes(['step 1', 'osc 1 position', 0.5, 'macro 2'], ['lfo 1', 'amp', -0.6], ['macro 1', 'osc 1 position', 0.4], ...MP_ECHO_SPACE),
    },
  },
  {
    name: 'Euclid Bells', tag: 'seq', macros: ['brightness', 'stretch', 'echo', 'space'],
    values: {
      // five hits spread over sixteen steps, and a five-note melody that slides against them
      ...o(1, 'Glass', 0.5, { warp: 'stretch', amt: 0.08, level: 0.75 }), ...o(2, 'FM', 0.3, { oct: 1, level: 0.2 }),
      ...e(1, 0.003, 0.5, 1, 1.5), ...f(1, 'lp 12', 7000, 0.05),
      ...l(1, 'ramp', '1/16', { uni: true }),
      s1Div: div('1/16'), ...steps(1, [0, -8, -8, 0, -8, -8, 0, -8, -8, -8, 0, -8, -8, 0, -8, -8]),
      s2Div: div('1/16'), s2Len: 5, ...steps(2, [0, 7, 3, 8, 5]), tempo: 108,
      ...hall(0.45, 6, 0.85, 0.25), ...echo('1/8 .', 0.45, 0.3),
      ...routes(['step 1', 'amp', 1], ['lfo 1', 'amp', -1], ['step 2', 'pitch', SEMI], ['random', 'pan', 0.5], ['macro 1', 'filter 1 cutoff', 0.3], ['macro 2', 'osc 1 warp', 0.4], ...MP_ECHO_SPACE),
    },
  },
  {
    name: 'Gated Chords', tag: 'seq', macros: ['gate', 'brightness', 'echo', 'space'],
    values: {
      ...o(1, 'Analog', 0.5, { uni: 4, detune: 0.16, level: 0.8 }), ...o(2, 'PWM', 0.3, { oct: 1, level: 0.2 }),
      ...f(1, 'lp 24', 2000, 0.2, { key: 0.3 }), ...e(1, 0.005, 0.5, 1, 0.3),
      ...l(1, 'ramp', '1/16', { uni: true }),
      s1Div: div('1/16'), ...steps(1, [0, -8, -8, 0, -8, -8, 0, -8, 0, -8, -8, 0, -8, 0, -8, -8]), macro1: 1, tempo: 122,
      ...chorus(0.3), ...echo('1/8 .', 0.35, 0.18), ...hall(0.3),
      ...routes(['step 1', 'amp', 1, 'macro 1'], ['lfo 1', 'amp', -0.5], ['lfo 1', 'filter 1 cutoff', -0.3], ['macro 2', 'filter 1 cutoff', 0.4], ...MP_ECHO_SPACE),
    },
  },
  {
    name: 'Spectral Sequence', tag: 'seq', macros: ['warp', 'brightness', 'echo', 'space'],
    values: {
      // stepper 1 throws the formant about every sixteenth, stepper 2 plays the notes
      ...o(1, 'Analog', 0.4, { warp: 'formant', amt: 0, uni: 2, detune: 0.06, level: 0.8 }),
      ...f(1, 'lp 24', 4000, 0.2), ...e(1, 0.003, 0.3, 1, 0.3),
      ...l(1, 'ramp', '1/16', { uni: true }),
      s1Div: div('1/16'), ...steps(1, [-8, 4, 0, 8, -4, 6, -2, 8, -8, 2, 6, -6, 4, 0, 8, -4]),
      s2Div: div('1/8'), s2Len: 8, ...steps(2, [0, 0, 3, 0, 7, 5, 3, 0]), macro1: 0.8, tempo: 116,
      ...echo('1/8 .', 0.4, 0.22), ...hall(0.3),
      ...routes(['step 1', 'osc 1 warp', 0.6, 'macro 1'], ['step 2', 'pitch', SEMI], ['lfo 1', 'amp', -0.7], ['macro 2', 'filter 1 cutoff', 0.4], ...MP_ECHO_SPACE),
    },
  },
  {
    name: 'Transposer', tag: 'seq', macros: ['brightness', 'tone', 'echo', 'space'],
    values: {
      // the arp runs the chord; stepper 2, free-running a bar per step, moves it about
      ...arp('up', '1/16', 2, 0.5, 0, 120), ...o(1, 'Basic', 0.55, { uni: 3, detune: 0.1, level: 0.8 }),
      ...e(1, 0.001, 0.25, 0, 0.2), ...e(2, 0.001, 0.15, 0, 0.1), ...f(1, 'lp 24', 1800, 0.2, { key: 0.4, env: 0.35 }),
      s2Div: div('1 bar'), s2Len: 4, s2Retrig: 0, ...steps(2, [0, 5, -4, 3]),
      ...echo('1/8 .', 0.4, 0.22), ...hall(0.3),
      ...routes(['step 2', 'pitch', SEMI], ['macro 1', 'filter 1 cutoff', 0.4], ['macro 2', 'osc 1 position', 0.3], ...MP_ECHO_SPACE),
    },
  },
  {
    name: 'Fold Sequence', tag: 'seq', macros: ['fold', 'cutoff', 'echo', 'squash'],
    values: {
      ...mono(0.03), ...o(1, 'Fold', 0.2, { level: 0.85 }), subLevel: 0.35,
      ...f(1, 'lp 24', 3000, 0.2), ...e(1, 0.002, 0.3, 1, 0.1),
      ...l(1, 'ramp', '1/16', { uni: true }),
      s1Div: div('1/16'), ...steps(1, [8, 0, 4, 0, 8, 2, 0, 6, 8, 0, 4, 0, 2, 6, 0, 8]),
      s2Div: div('1/16'), s2Len: 8, ...steps(2, [0, 0, 0, 7, 0, 0, 5, 3]), macro1: 0.8, sqDepth: 0.35, tempo: 128,
      ...echo('1/8 .', 0.3, 0.12),
      ...routes(['step 1', 'osc 1 position', 0.5, 'macro 1'], ['step 2', 'pitch', SEMI], ['lfo 1', 'amp', -0.6], ['macro 2', 'filter 1 cutoff', 0.4], ['macro 3', 'delay mix', 0.4], ['macro 4', 'squash depth', 0.5]),
    },
  },

  // ================================================================ drums & perc
  {
    name: 'Spectral Kick', tag: 'drum', macros: ['punch', 'click', 'tone', 'squash'],
    values: {
      ...o(1, 'Basic', 0, { level: 0.95, phase: 0 }), ...f(1, 'off', 8000), nzColour: 0.5,
      ...e(1, 0.001, 0.45, 0, 0.2, 0.6), ...e(4, 0.001, 0.07, 0, 0.05), ...ins('B', 'clip', 0.2, 0, 0.6), macro1: 0.5, macro2: 0.5, rvMix: 0.03,
      ...routes(['env 4', 'pitch', 0.5], ['env 4', 'pitch', 0.3, 'macro 1'], ['env 4', 'noise level', 0.15, 'macro 2'], ['macro 3', 'osc 1 position', 0.15], ['macro 4', 'squash depth', 0.5]),
    },
  },
  {
    name: 'Punch Kick', tag: 'drum', macros: ['drive', 'fold', 'tone', 'squash'],
    values: {
      ...o(1, 'Fold', 0, { level: 0.9, phase: 0 }), ...f(1, 'lp 24', 3000, 0.1),
      ...e(1, 0.001, 0.35, 0, 0.15, 0.6), ...e(4, 0.001, 0.05, 0, 0.04), ...ins('B', 'clip', 0.35, 0, 0.7), macro2: 0.5, sqDepth: 0.3, rvMix: 0.03,
      ...routes(['env 4', 'pitch', 0.8], ['env 4', 'osc 1 position', 0.4, 'macro 2'], ['macro 1', 'insert B', 0.5], ['macro 3', 'filter 1 cutoff', 0.4], ['macro 4', 'squash depth', 0.5]),
    },
  },
  {
    name: 'Snare Crack', tag: 'drum', macros: ['snap', 'tone', 'body', 'space'],
    values: {
      ...o(1, 'Basic', 0.1, { level: 0.5, phase: 0 }), nzLevel: 1, nzColour: 0.3,
      ...f(1, 'lp 24', 9000, 0.1), ...f(2, 'hp', 180), vel: 0.6,
      ...e(1, 0.001, 0.25, 0, 0.15, 0.6), ...e(4, 0.001, 0.04, 0, 0.03), ...hall(0.2, 1.2, 0.4),
      ...routes(['env 4', 'pitch', 0.3], ['macro 1', 'noise level', 0.2], ['macro 2', 'filter 1 cutoff', 0.4], ['macro 3', 'osc 1 level', 0.4], ['macro 4', 'reverb mix', 0.4]),
      volume: 1,
    },
  },
  {
    name: 'Clap Burst', tag: 'drum', macros: ['flutter', 'tone', 'room'],
    values: {
      // noise chopped by a fast square: the handful of hands in one clap
      o1Level: 0, nzLevel: 1, nzColour: 0.2, ...f(1, 'bp', 1300, 0.3), vel: 0.6,
      ...e(1, 0.001, 0.25, 0, 0.2, 0.5), ...l(1, 'square', 28), macro1: 1, ...hall(0.3, 1.4, 0.45),
      ...routes(['lfo 1', 'amp', -0.9, 'macro 1'], ['macro 2', 'filter 1 cutoff', 0.4], ['macro 3', 'reverb mix', 0.3]),
      f1Cut: 1500, e1Dec: 0.3, ...ins('B', 'clip', 0.4, 0, 1), volume: 1,
    },
  },
  {
    name: 'Closed Hat', tag: 'drum', macros: ['tone', 'metal', 'room'],
    values: {
      ...o(1, 'FM', 0.9, { oct: 3, level: 0 }), nzLevel: 1, nzColour: 0.8, ...f(1, 'hp', 7000, 0.2), vel: 0.6,
      ...e(1, 0.001, 0.05, 0, 0.04, 0.7), ...hall(0.08, 0.8, 0.3),
      ...routes(['macro 1', 'filter 1 cutoff', 0.4], ['macro 2', 'osc 1 level', 0.4], ['macro 3', 'reverb mix', 0.3]),
      f1Cut: 5000, e1Dec: 0.07, ...ins('B', 'clip', 0.5, 0, 1), volume: 1,
    },
  },
  {
    name: 'Open Hat', tag: 'drum', macros: ['tone', 'metal', 'room'],
    values: {
      ...o(1, 'FM', 0.9, { oct: 3, level: 0 }), nzLevel: 1, nzColour: 0.8, ...f(1, 'hp', 6000, 0.2), vel: 0.6,
      ...e(1, 0.001, 0.45, 0, 0.3, 0.6), ...hall(0.1, 1, 0.3),
      ...routes(['macro 1', 'filter 1 cutoff', 0.4], ['macro 2', 'osc 1 level', 0.4], ['macro 3', 'reverb mix', 0.3]),
      f1Cut: 5000, ...ins('B', 'clip', 0.4, 0, 1), volume: 1,
    },
  },
  {
    name: 'Ride Metal', tag: 'drum', macros: ['metal', 'tone', 'room'],
    values: {
      ...o(1, 'FM', 0.8, { oct: 2, level: 0.4 }), ...o(2, 'FM', 0.6, { oct: 2, semi: 6, fine: 30, level: 0.4 }), ...ins('B', 'ring', 0.7, 0, 0.5),
      nzLevel: 0.3, nzColour: 0.7, ...f(1, 'hp', 3000, 0.15),
      ...e(1, 0.001, 1.2, 0, 0.8, 0.75), ...hall(0.15, 1.5, 0.5),
      ...routes(['macro 1', 'insert B', 0.4], ['macro 2', 'filter 1 cutoff', 0.4], ['macro 3', 'reverb mix', 0.3]),
      volume: 1,
    },
  },
  {
    name: 'Rimshot', tag: 'drum', macros: ['click', 'tone', 'room'],
    values: {
      ...o(1, 'Glass', 0.2, { oct: 1, level: 1, phase: 0 }), nzLevel: 0.5, ...f(1, 'bp', 2200, 0.5),
      ...e(1, 0.001, 0.09, 0, 0.05, 0.7), ...hall(0.2, 1, 0.4),
      ...routes(['macro 1', 'noise level', 0.3], ['macro 2', 'filter 1 cutoff', 0.4], ['macro 3', 'reverb mix', 0.3]),
      ...ins('B', 'clip', 0.4, 0, 1), volume: 1,
    },
  },
  {
    name: 'Cowbell 808', tag: 'drum', macros: ['tone', 'ring', 'room'],
    values: {
      // two square waves a slightly flat fifth apart, through a band-pass
      ...o(1, 'PWM', 0, { oct: 1, level: 0.6, phase: 0 }), ...o(2, 'PWM', 0, { oct: 1, semi: 7, fine: -20, level: 0.6, phase: 0 }),
      ...f(1, 'bp', 1100, 0.4), ...e(1, 0.001, 0.3, 0, 0.2, 0.7), ...hall(0.1, 1, 0.4),
      ...routes(['macro 1', 'filter 1 cutoff', 0.4], ['macro 2', 'filter 1 res', 0.3], ['macro 3', 'reverb mix', 0.3]),
    },
  },
  {
    name: 'Tom Prism', tag: 'drum', macros: ['drop', 'tone', 'room'],
    values: {
      ...o(1, 'Basic', 0.05, { level: 0.9, phase: 0 }), nzLevel: 0.1, ...f(1, 'lp 24', 4000, 0.1),
      ...e(1, 0.001, 0.4, 0, 0.25, 0.6), ...e(4, 0.001, 0.1, 0, 0.05), macro1: 0.5, ...hall(0.2, 1.5, 0.5),
      ...routes(['env 4', 'pitch', 0.25], ['env 4', 'pitch', 0.2, 'macro 1'], ['macro 2', 'filter 1 cutoff', 0.4], ['macro 3', 'reverb mix', 0.3]),
    },
  },
  {
    name: 'Conga Glass', tag: 'drum', macros: ['slap', 'tone', 'room'],
    values: {
      ...o(1, 'Basic', 0, { level: 0.85, phase: 0 }), ...o(2, 'Glass', 0.3, { oct: 1, level: 0.15 }), ...f(1, 'lp 24', 3000, 0.1, { key: 0.5 }),
      ...e(1, 0.001, 0.25, 0, 0.2, 0.7), ...e(4, 0.001, 0.03, 0, 0.03), macro1: 0.5, ...hall(0.2, 1.2, 0.5),
      ...routes(['env 4', 'pitch', 0.08], ['env 4', 'noise level', 0.3, 'macro 1'], ['macro 2', 'filter 1 cutoff', 0.4], ['macro 3', 'reverb mix', 0.3]),
    },
  },
  {
    name: 'Seed Shaker', tag: 'drum', macros: ['tone', 'accent', 'room'],
    values: {
      // hold any key: the random arp shakes it, the per-note random accents it
      ...arp('random', '1/16', 2, 0.3, 0.15, 100), o1Level: 0, nzLevel: 1, nzColour: 0.6, ...f(1, 'hp', 4500, 0.1),
      ...e(1, 0.012, 0.07, 0, 0.05), macro2: 0.8, ...hall(0.12, 1, 0.4),
      ...routes(['random', 'amp', 0.4, 'macro 2'], ['random', 'pan', 0.4], ['macro 1', 'filter 1 cutoff', 0.4], ['macro 3', 'reverb mix', 0.3]),
      f1Cut: 3500, e1Dec: 0.09, volume: 1,
    },
  },
  {
    name: 'Pattern Kit', tag: 'drum', macros: ['tone', 'snare', 'drive', 'room'],
    values: {
      // hold one note and a programmed beat plays. Each sixteenth is re-struck by the
      // ramp, which also drops the pitch (a kick); stepper 1 rests steps, stepper 2
      // swaps the thump for noise (8 a snare, 4 a hat)
      ...o(1, 'Basic', 0, { oct: -1, level: 0.95, phase: 0 }), nzColour: 0.4, ...f(1, 'lp 24', 9000, 0.1),
      ...e(1, 0.001, 0.1, 1, 0.08), ...l(1, 'ramp', '1/16', { uni: true }), ...ins('B', 'clip', 0.15, 0, 0.6),
      s1Div: div('1/16'), ...steps(1, [0, -8, 0, -8, 0, -8, 0, 0, 0, -8, 0, -8, 0, -8, 0, 0]),
      s2Div: div('1/16'), ...steps(2, [0, 0, 4, 0, 8, 0, 4, 0, 0, 0, 4, 0, 8, 0, 4, 4]),
      tempo: 100, sqDepth: 0.3, ...hall(0.12, 1, 0.4),
      ...routes(['lfo 1', 'amp', -1], ['lfo 1', 'amp', -0.6], ['lfo 1', 'pitch', -0.5], ['step 1', 'amp', 1], ['step 2', 'noise level', 1],
        ['step 2', 'osc 1 level', -1], ['step 2', 'osc 1 level', -1],
        ['macro 1', 'filter 1 cutoff', 0.4], ['macro 2', 'noise level', 0.2], ['macro 3', 'insert B', 0.5], ['macro 4', 'reverb mix', 0.3]),
    },
  },
  {
    name: 'Breakbeat Kit', tag: 'drum', macros: ['tone', 'tune', 'drive', 'room'],
    values: {
      // a kit across the keyboard, played by the random arp: low notes thump, high notes
      // are noise. Hold a low C, a middle C and a high C and it improvises a beat
      ...arp('random', '1/16', 1, 0.3, 0.12, 100), ...o(1, 'Basic', 0, { level: 0.9, phase: 0 }), nzColour: 0.4,
      ...f(1, 'lp 24', 2500, 0.2, { key: 0.6 }), ...e(1, 0.001, 0.18, 0, 0.12), ...e(4, 0.001, 0.05, 0, 0.04), ...ins('B', 'clip', 0.1, 0, 0.6),
      ...hall(0.12, 1, 0.4),
      ...routes(['key', 'noise level', 1], ['key', 'noise level', 1], ['key', 'osc 1 level', -1], ['key', 'osc 1 level', -1],
        ['env 4', 'pitch', 0.4], ['random', 'amp', 0.3], ['key', 'filter 1 cutoff', 0.3],
        ['macro 1', 'filter 1 cutoff', 0.4], ['macro 2', 'pitch', 0.1], ['macro 3', 'insert B', 0.5], ['macro 4', 'reverb mix', 0.3]),
    },
  },
  {
    name: 'Hand Drums', tag: 'drum', macros: ['slap', 'tone', 'room'],
    values: {
      // the arp plays them in the order your fingers go down, swung
      ...arp('played', '1/16', 1, 0.4, 0.25, 92), ...o(1, 'Basic', 0, { level: 0.85, phase: 0 }), nzLevel: 0.2,
      ...f(1, 'bp', 600, 0.6, { key: 1 }), ...e(1, 0.001, 0.22, 0, 0.15), ...e(4, 0.001, 0.03, 0, 0.03), macro1: 0.5,
      ...hall(0.2, 1.2, 0.5),
      ...routes(['env 4', 'pitch', 0.1], ['random', 'amp', 0.35], ['random', 'pan', 0.4], ['env 4', 'noise level', 0.3, 'macro 1'], ['macro 2', 'filter 1 cutoff', 0.3], ['macro 3', 'reverb mix', 0.3]),
      volume: 1,
    },
  },

  // ========================================================================== fx
  {
    name: 'Spectral Riser', tag: 'fx', macros: ['rise', 'brightness', 'echo', 'space'],
    values: {
      // hold it for eight seconds: env 3 opens the filter, smears the table up and lifts the pitch
      ...o(1, 'Cloud', 0.2, { warp: 'smear', amt: 0.5, uni: 8, detune: 0.4, width: 1, level: 0.5 }), nzLevel: 0.5, nzColour: 0.3,
      ...f(1, 'lp 24', 300, 0.3), ...e(1, 6, 1, 1, 3), ...e(3, 8, 2, 1, 3),
      ...hall(0.6, 10, 1, 0.4), ...echo('1/8 .', 0.4, 0.2),
      ...routes(['env 3', 'filter 1 cutoff', 0.6], ['env 3', 'pitch', 0.5], ['env 3', 'osc 1 position', 0.6], ['env 3', 'noise level', 0.3],
        ['macro 1', 'pitch', 0.2], ['macro 2', 'filter 1 cutoff', 0.3], ...MP_ECHO_SPACE),
    },
  },
  {
    name: 'Downlifter', tag: 'fx', macros: ['fall', 'brightness', 'echo', 'space'],
    values: {
      ...o(1, 'Analog', 0.5, { uni: 6, detune: 0.35, width: 1, level: 0.6 }), nzLevel: 0.3,
      ...f(1, 'lp 24', 1500, 0.2), ...e(1, 0.01, 6, 0, 3), ...e(3, 0.001, 5, 0, 3),
      ...hall(0.55, 9, 0.95),
      ...routes(['env 3', 'pitch', 0.5], ['env 3', 'filter 1 cutoff', 0.4], ['macro 1', 'pitch', -0.2], ['macro 2', 'filter 1 cutoff', 0.3], ...MP_ECHO_SPACE),
    },
  },
  {
    name: 'Laser Shot', tag: 'fx', macros: ['zap', 'tone', 'echo', 'space'],
    values: {
      ...o(1, 'Sync', 0.6, { level: 0.8 }), ...f(1, 'off', 8000),
      ...e(1, 0.001, 0.25, 0, 0.15), ...e(4, 0.001, 0.15, 0, 0.1),
      ...echo('1/16', 0.5, 0.3), ...hall(0.2),
      ...routes(['env 4', 'pitch', 1], ['env 4', 'osc 1 position', 0.4], ['macro 1', 'pitch', 0.3], ['macro 2', 'osc 1 position', 0.3], ...MP_ECHO_SPACE),
      volume: 1,
    },
  },
  {
    name: 'Sonar', tag: 'fx', macros: ['ping', 'tone', 'echo', 'space'],
    values: {
      ...o(1, 'Basic', 0, { oct: 1, level: 0.8 }), ...f(1, 'bp', 1000, 0.6, { key: 1 }),
      ...e(1, 0.001, 0.5, 0, 0.4, 0.7), ...echo('1/4 .', 0.7, 0.5, { damp: 0.6 }), ...hall(0.5, 8, 0.9),
      ...routes(['macro 1', 'amp', 0.2], ['macro 2', 'filter 1 cutoff', 0.3], ...MP_ECHO_SPACE),
    },
  },
  {
    name: 'Siren', tag: 'fx', macros: ['wail', 'brightness', 'echo', 'space'],
    values: {
      ...o(1, 'PWM', 0.2, { level: 0.75 }), ...f(1, 'lp 12', 4000, 0.1),
      ...e(1, 0.05, 0.5, 1, 0.6), ...l(1, 'tri', 0.7, { free: true }), macro1: 0.8,
      ...hall(0.35, 4), ...echo('1/4 .', 0.4, 0.2),
      ...routes(['lfo 1', 'pitch', 0.25, 'macro 1'], ['macro 2', 'filter 1 cutoff', 0.4], ...MP_ECHO_SPACE),
    },
  },
  {
    name: 'Glitch Burst', tag: 'fx', macros: ['glitch', 'fold', 'echo', 'space'],
    values: {
      ...o(1, 'Steps', 0.5, { level: 0.7, blendMorph: true }), ...o(2, 'FM', 0.5, { level: 0.4 }), ...ins('B', 'fold', 0.4, 0.3, 0.6),
      ...e(1, 0.002, 0.8, 0.6, 0.4), ...l(1, 's&h', 18), ...l(2, 's&h', '1/32', { free: true }), macro1: 0.6,
      ...echo('1/16', 0.5, 0.25), rvMix: 0.15,
      ...routes(['lfo 1', 'pitch', 0.3, 'macro 1'], ['lfo 2', 'osc 1 position', 0.6], ['lfo 2', 'pan', 0.5], ['macro 2', 'insert B', 0.4], ...MP_ECHO_SPACE),
    },
  },
  {
    name: 'Impact Boom', tag: 'fx', macros: ['drive', 'room'],
    values: {
      ...o(1, 'Basic', 0, { oct: -1, level: 0.9, phase: 0 }), nzLevel: 0.6, nzColour: -0.4, ...f(1, 'lp 24', 1200, 0.1),
      ...e(1, 0.001, 2.5, 0, 2, 0.7), ...e(4, 0.001, 0.4, 0, 0.3), ...ins('B', 'clip', 0.2, 0, 0.6), ...hall(0.5, 6, 0.9),
      ...routes(['env 4', 'pitch', 0.4], ['env 4', 'filter 1 cutoff', 0.4], ['macro 1', 'insert B', 0.5], ['macro 2', 'reverb mix', 0.4]),
    },
  },

  // ==================================================================== textures
  {
    name: 'Spectral Swarm', tag: 'texture', macros: ['swarm', 'brightness', 'detune', 'space'],
    values: {
      ...o(1, 'Basic', 0.5, { uni: 16, detune: 0.6, width: 1, level: 0.6 }), ...o(2, 'Cloud', 0.5, { oct: 1, uni: 8, detune: 0.5, level: 0.3 }),
      ...f(1, 'lp 12', 3000, 0.15), ...e(1, 1.5, 2, 1, 3),
      ...l(1, 's&h', 14, { free: true }), ...l(2, 'drift', 0.2, { free: true }), macro1: 0.6,
      ...chorus(0.4), ...hall(0.5, 6),
      ...routes(['lfo 1', 'pitch', 0.01, 'macro 1'], ['lfo 2', 'filter 1 cutoff', 0.25], ['lfo 2', 'osc 2 position', 0.4], ['macro 2', 'filter 1 cutoff', 0.4], ['macro 3', 'osc 1 detune', 0.3], ['macro 4', 'reverb mix', 0.4]),
    },
  },
  {
    name: 'Frozen Comb', tag: 'texture', macros: ['freeze', 'brightness', 'comb', 'echo'],
    values: {
      // play a short chord: the hall at twenty seconds and the shimmer hold it like ice
      ...o(1, 'Glass', 0.4, { uni: 3, detune: 0.1, level: 0.7 }), ...ins('A', 'comb', 0.6, 0.6, 0.5), ...f(1, 'lp 12', 5000, 0.1),
      ...e(1, 0.02, 3, 0.4, 10), ...hall(0.7, 20, 1, 0.6), ...echo('1/2', 0.6, 0.3),
      ...routes(['macro 1', 'reverb mix', 0.25], ['macro 2', 'filter 1 cutoff', 0.4], ['macro 3', 'insert A', 0.4], ['macro 4', 'delay mix', 0.3]),
    },
  },
  {
    name: 'Drone Field', tag: 'texture', macros: ['depth', 'brightness', 'motion', 'space'],
    values: {
      ...o(1, 'Analog', 0.5, { oct: -1, uni: 5, detune: 0.15, level: 0.75 }), ...o(2, 'Analog', 0.5, { oct: -1, semi: 7, level: 0.45 }), subLevel: 0.5,
      ...f(1, 'lp 24', 500, 0.35, { drive: 0.3 }), ...e(1, 4, 2, 1, 8), drift: 0.7, warmth: 0.4,
      ...l(1, 'drift', 0.04, { free: true }), ...l(2, 'drift', 0.15, { free: true }),
      ...hall(0.55, 14, 1),
      ...routes(['lfo 1', 'filter 1 cutoff', 0.25], ['lfo 2', 'osc 1 position', 0.3], ['macro 1', 'sub level', 0.4], ['macro 2', 'filter 1 cutoff', 0.4], ['macro 3', 'osc 2 position', 0.4], ['macro 4', 'reverb mix', 0.3]),
    },
  },

  // ======================================================================== init
  { name: 'Init', tag: 'init', values: {} },
];

/** The loudness pass: each preset's amp level times its measured gain, so they all sit together. */
export const PRESETS: Preset[] = RAW.map((p) => {
  const g = LEVELS[p.name];
  if (g === undefined || p.tag === 'init') return p;
  const base = p.values.ampLevel ?? PARAM_BY_ID.ampLevel.def;
  return { ...p, values: { ...p.values, ampLevel: Math.round(Math.min(1.5, base * g) * 1000) / 1000 } };
});

/** The presets before the loudness pass, for `render levels`. */
export const RAW_PRESETS = RAW;
