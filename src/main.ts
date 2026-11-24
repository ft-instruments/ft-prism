import { Synth } from './audio.ts';
import { PluginSynth, inPlugin, previewPluginLayout } from './plugin.ts';
import type { WorkletStats } from './worklet/processor.ts';
import { MidiInput } from './midi.ts';
import { KeyboardView, ComputerKeys, FIRST, LAST } from './keyboard.ts';
import { makeControl, Knob, type Control, type ModArc } from './ui/controls.ts';
import { Viz, LIVE_VIZ, hue } from './ui/viz.ts';
import { StepGrid, Scope } from './ui/displays.ts';
import { Refraction } from './ui/refraction.ts';
import {
  PARAMS, PARAM_BY_ID, defaults, fromNorm, toNorm, DESTS, SOURCES, MATRIX_SLOTS, STEPS, D_OSC, D_PM, D_SUB, D_NOISE,
  D_F1CUT, D_F1RES, D_F2CUT, D_F2RES, D_INSA, D_INSB, D_AMP, D_DIM, D_CHORUS, D_DELAY, D_REVERB, D_SQUASH,
  S_ENV1, S_LFO1, S_STEP1, S_MACRO1, type ParamValues, type Preset,
} from './dsp/params.ts';
import { PRESETS } from './dsp/presets.ts';

const $ = <T extends HTMLElement>(sel: string): T => document.querySelector(sel) as T;

// In the plugin's WebView the host owns audio and MIDI; the page is just the editor.
const plugin = inPlugin() ? new PluginSynth() : null;
const synth: Synth | PluginSynth = plugin ?? new Synth();
document.documentElement.classList.toggle('in-plugin', !!plugin);
// dev only: ?plugin shows the plugin's layout in a browser tab (real audio, resize the window to see it scale)
if (import.meta.env.DEV && !plugin && new URLSearchParams(location.search).has('plugin')) previewPluginLayout();
// in the plugin every page fits whole, so nothing folds: modules stay open whatever their level
const NO_FOLD = document.documentElement.classList.contains('in-plugin');
const values: ParamValues = defaults();
const controls = new Map<string, Control>();

// ---- audio start -----------------------------------------------------------

const startBtn = $<HTMLButtonElement>('#start');
const startLabel = $('#start-label');
let wokeAt = 0;
async function startAudio(): Promise<void> {
  if (synth.running) return;
  startBtn.disabled = true;
  startLabel.textContent = 'starting…';
  try {
    await synth.start();
    synth.loadPreset(values);
    startBtn.disabled = false;
    startBtn.classList.add('on');
    startBtn.title = 'on — click to turn the light off';
    startLabel.textContent = `on · ${synth.latencyMs.toFixed(0)} ms`;
    wokeAt = performance.now();
  } catch (err) {
    startBtn.disabled = false;
    startLabel.textContent = 'start';
    console.error(err);
    alert(`Could not start audio: ${(err as Error).message}`);
  }
}
async function sleepAudio(): Promise<void> {
  synth.panic();
  for (let n = FIRST; n <= LAST; n++) keyboard.setPressed(n, false);
  await synth.suspend();
  startBtn.classList.remove('on');
  startBtn.title = 'turn the light on';
  startLabel.textContent = 'off';
}
startBtn.addEventListener('click', () => {
  if (synth.running) { if (performance.now() - wokeAt > 400) void sleepAudio(); }
  else void startAudio();
});
window.addEventListener('pointerdown', () => void startAudio(), { once: true });
window.addEventListener('keydown', () => void startAudio(), { once: true });

const scope = new Scope($<HTMLCanvasElement>('#scope'));
const field = new Refraction($<HTMLCanvasElement>('#field'));

// ---- note routing ----------------------------------------------------------

const handler = {
  noteOn(note: number, velocity: number) {
    void startAudio();
    synth.noteOn(note, velocity);
    keyboard.setPressed(note, true);
    if (values.arpMode < 1) field.pulse(note, velocity);
  },
  noteOff(note: number) {
    synth.noteOff(note);
    keyboard.setPressed(note, false);
  },
  cc(cc: number, value: number) {
    synth.cc(cc, value);
    if (cc === 64) keyboard.setSustain(value >= 64);
  },
  bend(value: number) { synth.bend(value); },
};

const keyboard = new KeyboardView($<HTMLCanvasElement>('#keyboard'), handler);
// the arpeggiator's notes light the field too
synth.onNote = (n) => field.pulse(n.note, n.velocity);
const octaveLabel = $('#octave');
new ComputerKeys(handler, (o) => (octaveLabel.textContent = `C${o}`));

const master = $<HTMLInputElement>('#master');
const setMaster = (v: number) => { master.value = String(v); master.style.setProperty('--fill', `${v * 100}%`); };
master.addEventListener('input', () => {
  const v = Number(master.value);
  master.style.setProperty('--fill', `${v * 100}%`);
  onParam('volume', v);
  controls.get('volume')?.set(v);
});

$<HTMLButtonElement>('#panic').addEventListener('click', () => {
  synth.panic();
  for (let n = FIRST; n <= LAST; n++) keyboard.setPressed(n, false);
});

window.addEventListener('keydown', (e) => {
  if (e.code === 'Space' && !e.repeat && !(e.target instanceof HTMLInputElement) && !(e.target instanceof HTMLSelectElement)) {
    e.preventDefault(); handler.cc(64, 127);
  }
});
window.addEventListener('keyup', (e) => {
  if (e.code === 'Space') { e.preventDefault(); handler.cc(64, 0); }
});

// ---- modulation as light -----------------------------------------------------

/** Each source's colour: envelopes warm, LFOs yellow-green, steppers cyan, macros blue-violet, playing white-pink. */
function sourceColour(s: number, a = 0.95): string {
  if (s >= S_ENV1 && s < S_LFO1) return `hsla(${(s - S_ENV1) * 9}, 95%, 62%, ${a})`;
  if (s >= S_LFO1 && s < S_STEP1) return `hsla(${52 + (s - S_LFO1) * 22}, 95%, 58%, ${a})`;
  if (s >= S_STEP1 && s < S_MACRO1) return `hsla(${180 + (s - S_STEP1) * 14}, 95%, 60%, ${a})`;
  if (s >= S_MACRO1 && s < S_MACRO1 + 8) return `hsla(${215 + (s - S_MACRO1) * 9}, 95%, 66%, ${a})`;
  return `hsla(320, 80%, 78%, ${a})`;
}

/**
 * Where a destination shows on screen: the knob it moves, and how one unit
 * of matrix amount translates into that knob's normalised travel.
 */
function destKnob(d: number): { id: string; scale: number }[] {
  for (let o = 0; o < 3; o++) {
    const b = D_OSC(o), g = `o${o + 1}`;
    if (d === b) return [{ id: `${g}Pos`, scale: 1 }];
    if (d === b + 1) return [{ id: `${g}Amt`, scale: 0.5 }];
    if (d === b + 2) return [{ id: `${g}Level`, scale: 1 }];
    if (d === b + 4) return [{ id: `${g}Detune`, scale: 1 }];
    if (d === b + 5) return [{ id: `${g}Pan`, scale: 0.5 }];
  }
  const oct = 8 / Math.log2(1000);
  switch (d) {
    case D_PM: return [{ id: 'o1Pm', scale: 1 }, { id: 'o2Pm', scale: 1 }];
    case D_SUB: return [{ id: 'subLevel', scale: 1 }];
    case D_NOISE: return [{ id: 'nzLevel', scale: 1 }];
    case D_F1CUT: return [{ id: 'f1Cut', scale: oct }];
    case D_F1RES: return [{ id: 'f1Res', scale: 1 }];
    case D_F2CUT: return [{ id: 'f2Cut', scale: oct }];
    case D_F2RES: return [{ id: 'f2Res', scale: 1 }];
    case D_INSA: return [{ id: 'iAA', scale: 1 }];
    case D_INSB: return [{ id: 'iBA', scale: 1 }];
    case D_AMP: return [{ id: 'ampLevel', scale: 1 }];
    case D_DIM: return [{ id: 'dimMix', scale: 1 }];
    case D_CHORUS: return [{ id: 'chMix', scale: 1 }];
    case D_DELAY: return [{ id: 'dlMix', scale: 1 }];
    case D_REVERB: return [{ id: 'rvMix', scale: 1 }];
    case D_SQUASH: return [{ id: 'sqDepth', scale: 1 }];
  }
  return [];
}

/** Redraw every knob's rays from the matrix. */
function refreshMods(): void {
  const per = new Map<string, ModArc[]>();
  for (let i = 1; i <= MATRIX_SLOTS; i++) {
    const s = values[`m${i}Src`] | 0, d = values[`m${i}Dst`] | 0, a = values[`m${i}Amt`];
    if (!s || !d || !a) continue;
    // a unipolar source reaches only one way; bipolar ones (LFOs, steppers, bend, random) both
    for (const { id, scale } of destKnob(d)) {
      const list = per.get(id) ?? [];
      list.push({ amount: a * scale, color: sourceColour(s) });
      per.set(id, list);
    }
  }
  for (const [id, c] of controls) if (c instanceof Knob) c.setMods(per.get(id) ?? []);
  for (const row of matrixRows) row.refresh();
}

// ---- modules ---------------------------------------------------------------

interface Group { title?: string; ids: string[]; hero?: boolean; cls?: string }
interface PanelSpec {
  title: string; sub?: string; cls: string; span: number; groups: Group[]; tab: string;
  /** level parameter: the module folds to one line when it is off */
  level?: string;
  viz?: string; tall?: boolean;
  extra?: (body: HTMLElement) => void;
}

const stepGrids: StepGrid[] = [];
const stepper = (n: number) => (body: HTMLElement) => {
  const init: number[] = [];
  for (let i = 0; i < STEPS; i++) init.push(values[`s${n}v${i}`]);
  const grid = new StepGrid(`${STEPS} steps · −8 … +8`, STEPS, -8, 8, init, (i, v) => onParam(`s${n}v${i}`, v));
  stepGrids[n - 1] = grid;
  body.append(grid.el);
  for (let i = 0; i < STEPS; i++) {
    const id = `s${n}v${i}`;
    controls.set(id, { el: grid.el, def: PARAM_BY_ID[id], set: (v) => grid.set(i, v) });
  }
};

const oscPanel = (n: number): PanelSpec => {
  const g = `o${n}`;
  return {
    tab: 'osc', title: `osc ${n}`, sub: 'spectral wavetable', cls: `osc o${n}`, span: 4, level: `${g}Level`, viz: `osc${n}`, tall: true,
    groups: [
      { hero: true, ids: [`${g}Level`, `${g}Pos`, `${g}Amt`] },
      { title: 'spectrum', cls: 'stack', ids: [`${g}Table`, `${g}Warp`, `${g}Morph`] },
      { title: 'pitch', ids: [`${g}Oct`, `${g}Semi`, `${g}Fine`, `${g}Pan`] },
      { title: 'unison', ids: [`${g}Uni`, `${g}Detune`, `${g}Blend`, `${g}Width`, `${g}Phase`, `${g}Curve`] },
      { title: 'routing', ids: n < 3 ? [`${g}Route`, `${g}Pm`] : [`${g}Route`] },
    ],
  };
};

const envPanel = (n: number, span: number, tab: string): PanelSpec => ({
  tab, title: n === 1 ? 'amp env' : `env ${n}`, sub: n === 1 ? 'envelope 1 · always on the amp' : 'envelope', cls: `env e${n}`, span, viz: `env${n}`,
  groups: [{ ids: [`e${n}Atk`, `e${n}Dec`, `e${n}Sus`, `e${n}Rel`, `e${n}Curve`, `e${n}Mode`] }],
});

const lfoPanel = (n: number): PanelSpec => ({
  tab: 'mod', title: `lfo ${n}`, sub: 'per voice or free', cls: `lfo l${n}`, span: 3, viz: `lfo${n}`,
  groups: [{ ids: [`l${n}Shape`, `l${n}Div`] }, { ids: [`l${n}Rate`, `l${n}Sync`, `l${n}Retrig`, `l${n}Uni`, `l${n}Phase`, `l${n}Fade`] }],
});

const LAYOUT: PanelSpec[] = [
  // ---- osc: the light source
  oscPanel(1), oscPanel(2), oscPanel(3),
  { tab: 'osc', title: 'sub · noise', sub: 'underneath', cls: 'src', span: 4, viz: 'sub', groups: [
    { title: 'sub', ids: ['subLevel', 'subOct', 'subShape'] },
    { title: 'noise', ids: ['nzLevel', 'nzColour', 'nzRoute'] },
  ] },
  { tab: 'osc', title: 'voice', sub: 'playing', cls: 'voice', span: 4, groups: [
    { hero: true, ids: ['ampLevel', 'glide', 'drift'] },
    { ids: ['voices', 'mono', 'legato', 'bend', 'vel', 'tempo'] },
  ] },
  envPanel(1, 4, 'osc'),

  // ---- mod: what moves it
  envPanel(2, 4, 'mod'), envPanel(3, 4, 'mod'), envPanel(4, 4, 'mod'),
  lfoPanel(1), lfoPanel(2), lfoPanel(3), lfoPanel(4),
  { tab: 'mod', title: 'arp', sub: 'held keys in time', cls: 'arp', span: 4, viz: 'arp', groups: [{ ids: ['arpMode', 'arpRate'] }, { ids: ['arpOct', 'arpGate', 'arpSwing', 'arpHold'] }] },
  { tab: 'mod', title: 'step 1', sub: 'stepper · tempo', cls: 'step s1', span: 4, extra: stepper(1), groups: [{ ids: ['s1Len', 's1Div', 's1Glide', 's1Retrig'] }] },
  { tab: 'mod', title: 'step 2', sub: 'stepper · tempo', cls: 'step s2', span: 4, extra: stepper(2), groups: [{ ids: ['s2Len', 's2Div', 's2Glide', 's2Retrig'] }] },

  // ---- matrix: built separately below
  // ---- fx: refraction
  { tab: 'fx', title: 'insert A', sub: 'in the voice · before filter 1', cls: 'ins', span: 3, viz: 'insA', groups: [{ ids: ['iAType'] }, { ids: ['iAA', 'iAB', 'iAMix'] }] },
  { tab: 'fx', title: 'filter 1', sub: 'clean svf', cls: 'flt', span: 3, viz: 'f1', groups: [{ ids: ['f1Type'] }, { hero: true, ids: ['f1Cut', 'f1Res'] }, { ids: ['f1Drive', 'f1Key', 'f1Env'] }] },
  { tab: 'fx', title: 'filter 2', sub: 'serial or parallel', cls: 'flt', span: 3, viz: 'f2', groups: [{ ids: ['f2Type'] }, { hero: true, ids: ['f2Cut', 'f2Res'] }, { ids: ['f2Drive', 'f2Key', 'f2Env', 'fRoute'] }] },
  { tab: 'fx', title: 'insert B', sub: 'in the voice · after the filters', cls: 'ins', span: 3, viz: 'insB', groups: [{ ids: ['iBType'] }, { ids: ['iBA', 'iBB', 'iBMix'] }] },
  { tab: 'fx', title: 'width', sub: 'dimension · chorus', cls: 'mfx', span: 3, viz: 'dim', groups: [{ title: 'dimension', ids: ['dimMix', 'dimSize'] }, { title: 'chorus', ids: ['chMix', 'chRate', 'chDepth'] }] },
  { tab: 'fx', title: 'delay', sub: 'with the spiral shifter', cls: 'mfx', span: 3, viz: 'delay', groups: [{ hero: true, ids: ['dlMix', 'dlFb', 'dlShift'] }, { ids: ['dlDiv', 'dlSync', 'dlTime', 'dlPing', 'dlDamp'] }] },
  { tab: 'fx', title: 'reverb', sub: 'the ice hall', cls: 'mfx', span: 3, viz: 'reverb', groups: [{ hero: true, ids: ['rvMix', 'rvDecay'] }, { ids: ['rvSize', 'rvTone', 'rvShimmer'] }] },
  { tab: 'fx', title: 'squash', sub: 'three-band up + down · out', cls: 'out', span: 3, viz: 'squash', groups: [{ hero: true, ids: ['sqDepth', 'volume'] }, { ids: ['sqTime', 'sqUp', 'sqDown', 'warmth', 'eqLow', 'eqHigh'] }] },
];

// In the plugin the page is laid out at 1360x850, so the four dense tabs are split into seven that each
// fit one or two rows. In a browser tab the original four stay.
const IN_PLUGIN_LAYOUT = document.documentElement.classList.contains('in-plugin');
if (IN_PLUGIN_LAYOUT) {
  const to: Record<string, string> = {
    'amp env': 'mod', 'env 2': 'mod', 'env 3': 'mod', 'env 4': 'mod',
    'lfo 1': 'mod', 'lfo 2': 'mod', 'lfo 3': 'mod', 'lfo 4': 'mod',
    'arp': 'pat', 'step 1': 'pat', 'step 2': 'pat',
    'insert A': 'fx', 'filter 1': 'fx', 'filter 2': 'fx', 'insert B': 'fx',
  };
  for (const spec of LAYOUT) spec.tab = to[spec.title] ?? spec.tab;
}

const vizzes: Viz[] = [];
const redrawViz = () => { for (const v of vizzes) v.redraw(); };

function onParam(id: string, v: number): void {
  values[id] = v;
  synth.setParam(id, v);
  setCurrent(null);
  const def = PARAM_BY_ID[id];
  if (def.tab) stepGrids[def.tab === 's1' ? 0 : 1]?.set(def.idx!, v);
  if (id.endsWith('Level')) refreshLevels();
  if (id === 'volume') setMaster(v);
  refreshStates();
  if (/^m\d+(Src|Dst|Amt|Via)$/.test(id)) refreshMods();
  else if (id.endsWith('Len')) refreshSteps();
  redrawViz();
}

function refreshLevels(expandOn = false): void {
  for (const [id, { panel, meta }] of foldPanels) {
    const lvl = values[id];
    // an oscillator with its level at 0 can still sound if the matrix raises it
    const modulated = matrixReaches(id);
    const off = lvl <= 0 && !modulated;
    meta.textContent = off ? 'off' : modulated && lvl <= 0 ? 'mod' : `${Math.round(lvl * 100)}%`;
    panel.classList.toggle('off', off);
    if (expandOn && !NO_FOLD) panel.classList.toggle('collapsed', off);
  }
}
function matrixReaches(levelId: string): boolean {
  const o = Number(levelId[1]) - 1;
  if (!(o >= 0 && o < 3)) return false;
  for (let i = 1; i <= MATRIX_SLOTS; i++) if ((values[`m${i}Src`] | 0) && values[`m${i}Dst`] === D_OSC(o) + 2 && values[`m${i}Amt`] > 0) return true;
  return false;
}
function refreshSteps(): void {
  stepGrids[0]?.setLength(values.s1Len | 0);
  stepGrids[1]?.setLength(values.s2Len | 0);
}

const panelsEl = $('#panels');
const panelByTitle = new Map<string, HTMLElement>();
const foldPanels = new Map<string, { panel: HTMLElement; meta: HTMLElement }>();

function makePanel(spec: { title: string; sub?: string; cls: string; span: number; tab: string }): { panel: HTMLElement; head: HTMLElement; body: HTMLElement } {
  const panel = document.createElement('section');
  panel.className = `panel ${spec.cls}`;
  panel.style.gridColumn = `span ${spec.span}`;
  panel.dataset.tab = spec.tab;
  const head = document.createElement('div');
  head.className = 'head';
  const h = document.createElement('h2');
  h.textContent = spec.title;
  head.append(h);
  if (spec.sub) { const s = document.createElement('small'); s.textContent = spec.sub; head.append(s); }
  panel.append(head);
  const body = document.createElement('div');
  body.className = 'body';
  return { panel, head, body };
}

for (const spec of LAYOUT) {
  const { panel, head, body } = makePanel(spec);
  panelByTitle.set(spec.title, panel);
  if (spec.level) {
    const meta = document.createElement('span'); meta.className = 'meta';
    head.append(meta);
    head.classList.add('fold');
    head.addEventListener('click', () => { if (!NO_FOLD) panel.classList.toggle('collapsed'); });
    foldPanels.set(spec.level, { panel, meta });
  }
  if (spec.viz) {
    const v = new Viz(spec.viz, values, spec.tall ? 'tall' : '');
    vizzes.push(v);
    panel.append(v.el);
  }
  spec.extra?.(body);
  for (const g of spec.groups) {
    let host: HTMLElement = body;
    if (g.title || g.hero || g.cls) {
      const sg = document.createElement('div'); sg.className = `subgroup ${g.hero ? 'hero' : ''} ${g.cls ?? ''}`;
      if (g.title) { const t = document.createElement('div'); t.className = 'title'; t.textContent = g.title; sg.append(t); }
      const row = document.createElement('div'); row.className = 'row';
      sg.append(row); body.append(sg); host = row;
    }
    for (const id of g.ids) {
      const def = PARAM_BY_ID[id];
      if (!def) { console.warn('unknown param', id); continue; }
      const c = makeControl(def, values[id], (v) => onParam(id, v), { hero: g.hero, segLimit: 5, size: g.hero ? 64 : 40 });
      controls.set(id, c);
      host.append(c.el);
    }
  }
  panel.append(body);
  panelsEl.append(panel);
}

// ---- the matrix: sixteen rows of source → destination × amount (× via)

class MatrixRow {
  el: HTMLElement;
  private n: number;
  constructor(n: number) {
    this.n = n;
    const el = document.createElement('div');
    el.className = 'mrow';
    const idx = document.createElement('span'); idx.className = 'idx'; idx.textContent = String(n).padStart(2, '0');
    el.append(idx);
    for (const key of ['Src', 'Dst', 'Amt', 'Via']) {
      const id = `m${n}${key}`;
      const c = makeControl(PARAM_BY_ID[id], values[id], (v) => onParam(id, v), { segLimit: 0, size: 34 });
      c.el.classList.add(`m-${key.toLowerCase()}`);
      controls.set(id, c);
      el.append(c.el);
    }
    this.el = el;
  }
  refresh(): void {
    const s = values[`m${this.n}Src`] | 0, d = values[`m${this.n}Dst`] | 0, a = values[`m${this.n}Amt`];
    const on = s > 0 && d > 0 && a !== 0;
    this.el.classList.toggle('on', on);
    this.el.classList.toggle('global', d > 0 && !!DESTS[d].global);
    this.el.style.setProperty('--src', s ? sourceColour(s) : 'rgba(255,255,255,0.2)');
  }
}
const matrixRows: MatrixRow[] = [];
{
  const { panel, body } = makePanel({ title: 'matrix', sub: 'source → destination × amount · via scales it by a second source', cls: 'matrix wide', span: 12, tab: 'matrix' });
  const headRow = document.createElement('div'); headRow.className = 'mrow mhead';
  headRow.innerHTML = '<span class="idx">#</span><span>source</span><span>destination</span><span>amount</span><span>via</span>';
  const cols = document.createElement('div'); cols.className = 'mcols';
  const colA = document.createElement('div'), colB = document.createElement('div');
  colA.append(headRow.cloneNode(true)); colB.append(headRow);
  for (let i = 1; i <= MATRIX_SLOTS; i++) {
    const r = new MatrixRow(i);
    matrixRows.push(r);
    (i <= MATRIX_SLOTS / 2 ? colA : colB).append(r.el);
  }
  cols.append(colA, colB);
  body.append(cols);
  const legend = document.createElement('div'); legend.className = 'legend';
  const swatch = (name: string, s: number) => `<span><i style="background:${sourceColour(s)}"></i>${name}</span>`;
  legend.innerHTML = swatch('envelopes', S_ENV1 + 1) + swatch('lfos', S_LFO1 + 1) + swatch('steppers', S_STEP1) + swatch('macros', S_MACRO1 + 3) + swatch('playing', SOURCES.length - 1)
    + '<span class="note">rows aimed at the effects (marked ◆) hear only macros, the wheel, pressure and bend</span>';
  body.append(legend);
  panel.append(body);
  panelsEl.append(panel);
}

// ---- the macro strip: always on screen, named by the preset

const macroKnobs: Knob[] = [];
{
  const strip = $('#macros');
  const label = document.createElement('div'); label.className = 'mlabel'; label.innerHTML = '<b>macros</b><small>the playable face</small>';
  strip.append(label);
  for (let i = 1; i <= 8; i++) {
    const id = `macro${i}`;
    const k = new Knob(PARAM_BY_ID[id], values[id], (v) => onParam(id, v), 52, true);
    k.el.style.setProperty('--accent', sourceColour(S_MACRO1 + i - 1));
    controls.set(id, k);
    macroKnobs.push(k);
    strip.append(k.el);
  }
}
function nameMacros(p: Preset | undefined): void {
  macroKnobs.forEach((k, i) => {
    const name = p?.macros?.[i];
    const label = k.el.querySelector('.label')!;
    label.textContent = name ?? `macro ${i + 1}`;
    k.el.classList.toggle('unnamed', !name);
  });
}

// ---- views -----------------------------------------------------------------

// In the plugin the repeated modules (three oscillators, four LFOs, four envelopes, the filter chain, the effects)
// are a row of chips and the one you pick shown large, so the page stays two columns without a tab for each.
const mGroups: { el: HTMLElement; tab: string }[] = [];
const panelChip = new Map<HTMLElement, HTMLButtonElement>();
if (IN_PLUGIN_LAYOUT) {
  const make = (tab: string, titles: string[], labels: string[], cls: string) => {
    const panels = titles.map((t) => panelByTitle.get(t)!).filter(Boolean);
    if (panels.length === 0) return;
    const el = document.createElement('div'); el.className = `mgroup ${cls}`; el.dataset.tab = tab;
    const sel = document.createElement('div'); sel.className = 'msel';
    el.append(sel);
    panels[0].before(el);
    const chips: HTMLButtonElement[] = [];
    const pick = (n: number) => {
      panels.forEach((p, i) => p.classList.toggle('sel', i === n));
      chips.forEach((c, i) => c.classList.toggle('on', i === n));
      redrawViz();
    };
    panels.forEach((p, i) => {
      el.append(p);
      const c = document.createElement('button'); c.type = 'button'; c.className = 'mchip pick'; c.textContent = labels[i] ?? titles[i];
      c.style.setProperty('--accent', getComputedStyle(p).getPropertyValue('--accent') || '#fff');
      c.addEventListener('click', () => pick(i));
      chips.push(c); sel.append(c);
      panelChip.set(p, c);
    });
    pick(0);
    mGroups.push({ el, tab });
  };
  make('osc', ['osc 1', 'osc 2', 'osc 3'], ['osc 1', 'osc 2', 'osc 3'], 'g-osc');
  make('mod', ['lfo 1', 'lfo 2', 'lfo 3', 'lfo 4'], ['lfo 1', 'lfo 2', 'lfo 3', 'lfo 4'], 'g-lfo');
  make('mod', ['amp env', 'env 2', 'env 3', 'env 4'], ['amp', 'env 2', 'env 3', 'env 4'], 'g-env');
  make('fx', ['insert A', 'filter 1', 'filter 2', 'insert B'], ['ins A', 'filter 1', 'filter 2', 'ins B'], 'g-flt');
  make('fx', ['width', 'delay', 'reverb', 'squash'], ['width', 'delay', 'reverb', 'squash'], 'g-fx');
  make('pat', ['step 1', 'step 2'], ['step 1', 'step 2'], 'g-step');
}

// Whether a module does anything right now, so the page can say so: the chips light, and an idle module is dimmed
// and labelled. An LFO, envelope or stepper is idle until the matrix routes it somewhere.
const routed = (src: number): boolean => {
  for (let i = 1; i <= MATRIX_SLOTS; i++) if ((values[`m${i}Src`] | 0) === src && values[`m${i}Amt`] !== 0) return true;
  return false;
};
const IDLE: Record<string, () => boolean> = {
  'lfo 1': () => !routed(S_LFO1), 'lfo 2': () => !routed(S_LFO1 + 1), 'lfo 3': () => !routed(S_LFO1 + 2), 'lfo 4': () => !routed(S_LFO1 + 3),
  'env 2': () => !routed(S_ENV1 + 1), 'env 3': () => !routed(S_ENV1 + 2), 'env 4': () => !routed(S_ENV1 + 3),
  'step 1': () => !routed(S_STEP1), 'step 2': () => !routed(S_STEP1 + 1),
  'arp': () => values.arpMode < 0.5,
  'insert A': () => values.iAType < 0.5, 'insert B': () => values.iBType < 0.5,
  'filter 1': () => values.f1Type < 0.5, 'filter 2': () => values.f2Type < 0.5,
  'width': () => values.dimMix <= 0 && values.chMix <= 0, 'delay': () => values.dlMix <= 0,
  'reverb': () => values.rvMix <= 0, 'squash': () => values.sqDepth <= 0,
  'sub · noise': () => values.subLevel <= 0 && values.nzLevel <= 0,
};
const IDLE_WORD: Record<string, string> = {
  'lfo 1': 'unused', 'lfo 2': 'unused', 'lfo 3': 'unused', 'lfo 4': 'unused', 'env 2': 'unused', 'env 3': 'unused', 'env 4': 'unused',
  'step 1': 'unused', 'step 2': 'unused',
};
function refreshStates(): void {
  if (!IN_PLUGIN_LAYOUT) return;
  for (const [title, idle] of Object.entries(IDLE)) {
    const panel = panelByTitle.get(title);
    if (!panel) continue;
    const off = idle();
    panel.classList.toggle('off', off);
    panelChip.get(panel)?.classList.toggle('off', off);
    let tag = panel.querySelector<HTMLElement>(':scope > .head > .state');
    if (!tag) { tag = document.createElement('span'); tag.className = 'state'; panel.querySelector(':scope > .head')!.append(tag); }
    tag.textContent = off ? (IDLE_WORD[title] ?? 'off') : '';
  }
  // oscillators are already marked by refreshLevels; their chips follow
  for (const title of ['osc 1', 'osc 2', 'osc 3']) {
    const panel = panelByTitle.get(title);
    if (panel) panelChip.get(panel)?.classList.toggle('off', panel.classList.contains('off'));
  }
}

const TABS: { id: string; name: string; hint: string }[] = IN_PLUGIN_LAYOUT ? [
  { id: 'osc', name: 'light', hint: 'osc · sub · voice' },
  { id: 'mod', name: 'motion', hint: 'env · lfo' },
  { id: 'pat', name: 'pattern', hint: 'arp · steps' },
  { id: 'matrix', name: 'matrix', hint: '16 routes' },
  { id: 'fx', name: 'refraction', hint: 'filters · fx' },
] : [
  { id: 'osc', name: 'light', hint: 'three oscillators · sub · noise · voice' },
  { id: 'mod', name: 'motion', hint: 'envelopes · lfos · arp · steppers' },
  { id: 'matrix', name: 'matrix', hint: 'sixteen routes' },
  { id: 'fx', name: 'refraction', hint: 'inserts · filters · width · delay · reverb · squash' },
];
const tabsEl = $('#tabs');
const tabLight = tabsEl.querySelector<HTMLElement>('.tab-light')!;
const tabButtons = new Map<string, HTMLButtonElement>();
let shownTab = '';
function placeTabLight(): void {
  const b = tabButtons.get(shownTab);
  if (!b) return;
  tabLight.style.left = `${b.offsetLeft}px`;
  tabLight.style.width = `${b.offsetWidth}px`;
}
function showTab(id: string): void {
  if (id === shownTab) return;
  shownTab = id;
  for (const [t, b] of tabButtons) b.classList.toggle('on', t === id);
  tabsEl.dataset.on = id;
  placeTabLight();
  for (const g of mGroups) g.el.hidden = g.tab !== id;
  let i = 0;
  for (const el of panelsEl.querySelectorAll<HTMLElement>('.panel')) {
    const on = el.dataset.tab === id;
    el.hidden = !on;
    el.classList.remove('enter');
    if (on) { void el.offsetWidth; el.style.setProperty('--i', String(i++)); el.classList.add('enter'); }
  }
  redrawViz();
  for (const g of stepGrids) g?.draw();
  try { localStorage.setItem('prism.tab', id); } catch { /* ignore */ }
}
for (const t of TABS) {
  const b = document.createElement('button');
  b.type = 'button'; b.className = 'tab';
  b.innerHTML = `<span class="n">0${TABS.indexOf(t) + 1}</span><span class="nm">${t.name}</span><small>${t.hint}</small>`;
  b.addEventListener('click', () => showTab(t.id));
  tabsEl.append(b); tabButtons.set(t.id, b);
}
new ResizeObserver(placeTabLight).observe(tabsEl);

window.addEventListener('keydown', (e) => {
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  if (e.key === 'Escape') { closeBrowser(); return; }
  const t = e.target as HTMLElement | null;
  if (t && (t.tagName === 'INPUT' || t.tagName === 'SELECT' || t.tagName === 'TEXTAREA')) return;
  if (e.key === '`') { e.preventDefault(); openBrowser(); return; }
  const i = TABS.findIndex((_, n) => String(n + 1) === e.key);
  if (i >= 0) showTab(TABS[i].id);
});

// ---- presets ---------------------------------------------------------------

const CATEGORY_NAMES: Record<string, string> = {
  user: 'yours', pad: 'pads', keys: 'keys', pluck: 'plucks & bells', lead: 'leads', bass: 'bass', synth: 'synths',
  arp: 'arps', seq: 'sequences', drum: 'drums & perc', texture: 'textures', fx: 'fx', neon: 'neon', init: 'init',
};
const CATEGORY_ORDER = Object.keys(CATEGORY_NAMES);
const catRank = (tag: string) => { const i = CATEGORY_ORDER.indexOf(tag); return i < 0 ? CATEGORY_ORDER.length : i; };

const USER_KEY = 'prism.user-presets';
function parseUser(raw: unknown): Preset[] {
  if (!Array.isArray(raw)) return [];
  return (raw as { name: string; values: Partial<ParamValues>; macros?: string[] }[])
    .filter((p) => typeof p?.name === 'string' && p.values && typeof p.values === 'object')
    .map((p) => ({ name: p.name, tag: 'user', values: p.values, macros: Array.isArray(p.macros) ? p.macros : undefined }));
}
function readUser(): Preset[] {
  if (plugin) return [];   // they arrive with the plugin's state
  try { return parseUser(JSON.parse(localStorage.getItem(USER_KEY) ?? '[]')); } catch { return []; }
}
let userPresets = readUser();
function writeUser(): void {
  const stored = userPresets.map((p) => ({ name: p.name, values: p.values, macros: p.macros }));
  if (plugin) { plugin.saveUser(stored); return; }
  try { localStorage.setItem(USER_KEY, JSON.stringify(stored)); } catch { /* private mode */ }
}

const allPresets = (): Preset[] => [...userPresets, ...PRESETS];
const findPreset = (name: string | null) => (name ? allPresets().find((x) => x.name === name) : undefined);
let browseOrder: Preset[] = [];
const sortPresets = () => { browseOrder = allPresets().sort((a, b) => catRank(a.tag) - catRank(b.tag)); };
sortPresets();

const nameEl = $('#preset-name');
const tagEl = $('#preset-tag');
let current: string | null = null;
let lastLoaded: string | null = null;

function setCurrent(name: string | null): void {
  if (current === name) return;
  current = name;
  if (name) lastLoaded = name;
  const p = findPreset(name);
  nameEl.textContent = p ? p.name : (lastLoaded ?? 'custom');
  tagEl.textContent = p ? (CATEGORY_NAMES[p.tag] ?? p.tag) : 'edited';
  tagEl.dataset.tag = p ? p.tag : 'edited';
  for (const [n, card] of cards) card.classList.toggle('on', n === name);
  plugin?.setCurrent(name);
}

/** Show a whole sound; `fromHost` when it came from the plugin and must not be sent back. */
function applyValues(next: ParamValues, fromHost = false): void {
  for (const def of PARAMS) {
    values[def.id] = next[def.id];
    controls.get(def.id)?.set(next[def.id]);
  }
  if (!fromHost) synth.loadPreset(values);
  refreshLevels(true);
  refreshSteps();
  refreshMods();
  refreshStates();
  setMaster(values.volume);
  redrawViz();
}

function loadPreset(name: string): void {
  const p = findPreset(name);
  if (!p) return;
  applyValues({ ...defaults(), ...p.values } as ParamValues);
  nameMacros(p);
  current = null;
  setCurrent(name);
  nameEl.classList.remove('swap'); void nameEl.offsetWidth; nameEl.classList.add('swap');
  try { localStorage.setItem('prism.preset', name); } catch { /* private mode */ }
}

const stepPreset = (d: number) => {
  const i = browseOrder.findIndex((p) => p.name === (current ?? lastLoaded));
  loadPreset(browseOrder[(i + d + browseOrder.length) % browseOrder.length].name);
};
$('#prev').addEventListener('click', () => stepPreset(-1));
$('#next').addEventListener('click', () => stepPreset(1));

function patchDiff(): Partial<ParamValues> {
  const d = defaults();
  const diff: Partial<ParamValues> = {};
  for (const id in values) if (Math.abs(values[id] - d[id]) > 1e-9) diff[id] = Number(values[id].toFixed(4));
  return diff;
}

// ---- the browser -----------------------------------------------------------

const browserEl = $('#browser');
const listEl = $('#browser-list');
const sideEl = $('#browser-side');
const searchEl = $<HTMLInputElement>('#browser-search');
const cards = new Map<string, HTMLButtonElement>();
const heads = new Map<string, HTMLElement>();

function buildBrowser(): void {
  listEl.replaceChildren(); sideEl.replaceChildren(); cards.clear(); heads.clear();
  const counts = new Map<string, number>();
  for (const p of browseOrder) counts.set(p.tag, (counts.get(p.tag) ?? 0) + 1);
  if (!userPresets.length) {
    const h = document.createElement('div'); h.className = 'cat'; h.dataset.tag = 'user';
    h.innerHTML = '<span class="nm"></span>';
    h.querySelector('.nm')!.textContent = CATEGORY_NAMES.user;
    const empty = document.createElement('div'); empty.className = 'empty';
    empty.textContent = 'nothing saved yet — shape a sound, then “save current” (⌘S)';
    listEl.append(h, empty); heads.set('user', h);
    counts.set('user', 0);
  }
  for (const tag of [...new Set(['user', ...browseOrder.map((p) => p.tag)])]) {
    const s = document.createElement('button');
    s.type = 'button'; s.dataset.tag = tag;
    s.innerHTML = '<span class="nm"></span><span class="count"></span>';
    s.querySelector('.nm')!.textContent = CATEGORY_NAMES[tag] ?? tag;
    s.querySelector('.count')!.textContent = String(counts.get(tag) ?? 0);
    s.addEventListener('click', () => {
      if (searchEl.value) { searchEl.value = ''; filterBrowser(); }
      heads.get(tag)?.scrollIntoView({ block: 'start', behavior: 'smooth' });
    });
    sideEl.append(s);
  }
  let lastTag = '';
  for (const p of browseOrder) {
    if (p.tag !== lastTag) {
      lastTag = p.tag;
      const h = document.createElement('div');
      h.className = 'cat'; h.dataset.tag = p.tag;
      h.innerHTML = '<span class="nm"></span><span class="count"></span>';
      h.querySelector('.nm')!.textContent = CATEGORY_NAMES[p.tag] ?? p.tag;
      h.querySelector('.count')!.textContent = String(counts.get(p.tag) ?? 0);
      listEl.append(h); heads.set(p.tag, h);
    }
    const card = document.createElement('button');
    card.type = 'button'; card.className = 'card'; card.dataset.tag = p.tag;
    card.dataset.search = `${p.name} ${CATEGORY_NAMES[p.tag] ?? p.tag} ${(p.macros ?? []).join(' ')}`.toLowerCase();
    // one line per card; the macros show on hover (and are still searched)
    card.title = p.macros?.length ? `${p.name} — ${p.macros.join(' · ')}` : p.name;
    card.innerHTML = `<span class="nm"></span><span class="tg"></span>`;
    card.querySelector<HTMLElement>('.nm')!.textContent = p.name;
    card.querySelector<HTMLElement>('.tg')!.textContent = CATEGORY_NAMES[p.tag] ?? p.tag;
    card.addEventListener('click', () => { loadPreset(p.name); closeBrowser(); });
    if (p.tag === 'user') {
      const del = document.createElement('span');
      del.className = 'del'; del.title = 'delete'; del.textContent = '×';
      del.addEventListener('click', (e) => {
        e.stopPropagation();
        if (!del.classList.contains('armed')) { del.classList.add('armed'); del.textContent = 'delete?'; return; }
        userPresets = userPresets.filter((x) => x.name !== p.name);
        writeUser(); sortPresets(); buildBrowser(); filterBrowser();
        if (current === p.name) setCurrent(null);
      });
      del.addEventListener('mouseleave', () => { del.classList.remove('armed'); del.textContent = '×'; });
      card.append(del);
    }
    card.classList.toggle('on', p.name === current);
    listEl.append(card);
    cards.set(p.name, card);
  }
}
buildBrowser();

function filterBrowser(): void {
  const q = searchEl.value.trim().toLowerCase();
  listEl.classList.toggle('searching', q.length > 0);
  let shownInCat = 0;
  let cat: HTMLElement | null = null;
  for (const el of listEl.children as HTMLCollectionOf<HTMLElement>) {
    if (el.classList.contains('cat')) {
      if (cat) cat.hidden = shownInCat === 0 && !!q;
      cat = el; shownInCat = 0;
      continue;
    }
    const hit = !q || (el.dataset.search ?? '').includes(q);
    el.hidden = !hit;
    if (hit) shownInCat++;
  }
  if (cat) cat.hidden = shownInCat === 0 && !!q;
}

const saveBar = $<HTMLFormElement>('#savebar');
const saveName = $<HTMLInputElement>('#save-name');
const saveOk = $<HTMLButtonElement>('#save-ok');
const saveMsg = $('#save-msg');

function checkName(): 'new' | 'overwrite' | 'taken' | 'empty' {
  const n = saveName.value.trim();
  if (!n) return 'empty';
  if (PRESETS.some((p) => p.name.toLowerCase() === n.toLowerCase())) return 'taken';
  return userPresets.some((p) => p.name.toLowerCase() === n.toLowerCase()) ? 'overwrite' : 'new';
}
function refreshSave(): void {
  const s = checkName();
  saveOk.textContent = s === 'overwrite' ? 'overwrite' : 'save';
  saveOk.disabled = s === 'empty' || s === 'taken';
  saveMsg.textContent = s === 'taken' ? 'a factory preset has that name' : s === 'overwrite' ? 'replaces your sound with that name' : '';
}
function openSave(): void {
  if (browserEl.hidden) openBrowser();
  saveBar.hidden = false;
  const base = findPreset(lastLoaded);
  saveName.value = base?.tag === 'user' ? base.name : current ? '' : (lastLoaded ? `${lastLoaded} (mine)` : '');
  refreshSave();
  saveName.focus(); saveName.select();
}
function closeSave(): void { saveBar.hidden = true; }
saveName.addEventListener('input', refreshSave);
saveBar.addEventListener('submit', (e) => {
  e.preventDefault();
  const s = checkName();
  if (s === 'empty' || s === 'taken') return;
  const name = saveName.value.trim();
  const p: Preset = { name, tag: 'user', values: patchDiff(), macros: findPreset(lastLoaded)?.macros };
  const i = userPresets.findIndex((x) => x.name.toLowerCase() === name.toLowerCase());
  if (i >= 0) userPresets[i] = p; else userPresets.push(p);
  userPresets.sort((a, b) => a.name.localeCompare(b.name));
  writeUser(); sortPresets(); buildBrowser();
  closeSave(); closeBrowser();
  current = null; setCurrent(name);
  nameEl.classList.remove('swap'); void nameEl.offsetWidth; nameEl.classList.add('swap');
  try { localStorage.setItem('prism.preset', name); } catch { /* private mode */ }
});
$('#save-cancel').addEventListener('click', closeSave);
$('#browser-save').addEventListener('click', openSave);
$('#save').addEventListener('click', openSave);
window.addEventListener('keydown', (e) => {
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's') { e.preventDefault(); openSave(); }
});

function openBrowser(): void {
  browserEl.hidden = false;
  closeSave();
  searchEl.value = '';
  filterBrowser();
  searchEl.focus();
  cards.get(current ?? lastLoaded ?? '')?.scrollIntoView({ block: 'center' });
}
function closeBrowser(): void { browserEl.hidden = true; closeSave(); }

$('#browse').addEventListener('click', openBrowser);
$('#browser-close').addEventListener('click', closeBrowser);
browserEl.addEventListener('click', (e) => { if (e.target === browserEl) closeBrowser(); });
searchEl.addEventListener('input', filterBrowser);
searchEl.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    const first = [...listEl.querySelectorAll<HTMLButtonElement>('.card')].find((c) => !c.hidden);
    if (first) first.click();
  }
});

// "refract": nudge the spectral controls of the oscillators that sound, and now and then change a warp
$('#spore').addEventListener('click', () => {
  const next = { ...values };
  const live = [1, 2, 3].filter((n) => values[`o${n}Level`] > 0);
  const pool = PARAMS.filter((p) => (p.scale === 'lin' || p.scale === 'log')
    && (live.some((n) => p.id.startsWith(`o${n}`)) || /^(f1Cut|f1Res|f2Cut|dlShift|iAA|iBA|chMix|dimMix)$/.test(p.id)));
  for (let i = 0; i < 6; i++) {
    const def = pool[Math.floor(Math.random() * pool.length)];
    const t = toNorm(def, next[def.id]) + (Math.random() - 0.5) * 0.3;
    next[def.id] = fromNorm(def, t);
  }
  if (live.length && Math.random() < 0.35) {
    const n = live[Math.floor(Math.random() * live.length)];
    next[`o${n}Warp`] = Math.floor(Math.random() * 10);
  }
  applyValues(next);
  setCurrent(null);
});

$('#copy').addEventListener('click', async () => {
  const diff = patchDiff();
  try { await navigator.clipboard.writeText(JSON.stringify(diff)); } catch { console.log(JSON.stringify(diff)); }
  const b = $('#copy');
  b.classList.add('done');
  setTimeout(() => b.classList.remove('done'), 1200);
});

let startTab = 'osc';
try { startTab = localStorage.getItem('prism.tab') ?? startTab; } catch { /* ignore */ }
refreshLevels();
refreshStates();
showTab(TABS.some((t) => t.id === startTab) ? startTab : 'osc');

if (!plugin) {
  let initial = PRESETS[0].name;
  try { initial = localStorage.getItem('prism.preset') ?? initial; } catch { /* ignore */ }
  loadPreset(findPreset(initial) ? initial : PRESETS[0].name);
}

// ---- MIDI ------------------------------------------------------------------

const midiLed = $('#midi-led');
const midiSel = $<HTMLSelectElement>('#midi-port');
const midi = new MidiInput(handler);
let ledTimer = 0;
midi.onActivity = () => {
  midiLed.classList.add('on');
  clearTimeout(ledTimer);
  ledTimer = window.setTimeout(() => midiLed.classList.remove('on'), 120);
};
midi.onPortsChanged = (ports) => {
  const cur = midiSel.value || 'all';
  midiSel.innerHTML = '<option value="all">all MIDI inputs</option>';
  for (const p of ports) {
    const o = document.createElement('option');
    o.value = p.id; o.textContent = p.name;
    midiSel.append(o);
  }
  midiSel.value = ports.some((p) => p.id === cur) ? cur : 'all';
};
midiSel.addEventListener('change', () => midi.select(midiSel.value as string | 'all'));
if (!plugin) {
  midi.init().then((ok) => {
    if (!ok) midiSel.innerHTML = `<option>${MidiInput.supported ? 'MIDI denied' : 'no Web MIDI'}</option>`;
  });
}

// ---- live: the newest voice's positions, envelopes, LFOs, steps ---------------

// in the plugin the readout keeps one width however many digits the numbers have (padded, in a fixed box: style.css),
// and the host's tempo has its own fixed box beside the stop button; a browser tab shows the plain text
const fixedStats = document.documentElement.classList.contains('in-plugin');
const pad = (n: number, w: number): string => (fixedStats ? String(n).padStart(w, '\u00a0') : String(n));
const stats = $('#stats');
const tempo = document.createElement('span');
tempo.id = 'tempo'; tempo.className = 'muted';
if (fixedStats) { $('#panic').before(tempo); stats.textContent = `${pad(0, 2)} voices · ${pad(0, 3)}% dsp`; }
let lastPeak = 0;
let wasPlaying = false;
const liveVizzes = vizzes.filter((v) => LIVE_VIZ.has(v.kind));
synth.onStats = (s: WorkletStats & { tempo?: number }) => {
  tempo.textContent = s.tempo ? `${pad(Math.round(s.tempo), 3)} bpm` : '';
  const host = s.tempo && !fixedStats ? ` · ${Math.round(s.tempo)} bpm` : '';
  stats.textContent = `${pad(s.voices, 2)} voices · ${pad(Math.round(s.load * 100), 3)}% dsp${host}`;
  const peak = Math.max(s.peakL, s.peakR);
  lastPeak = peak;
  scope.update(s.scope, peak);
  field.setLevel(peak);
  const d = s.display;
  const playing = s.voices > 0;
  for (const v of liveVizzes) { v.live = d; if (playing || wasPlaying) v.redraw(); }
  for (let i = 0; i < 3; i++) {
    const k = controls.get(`o${i + 1}Pos`);
    if (k instanceof Knob) k.setLive(playing && Math.abs(d[i] - values[`o${i + 1}Pos`]) > 0.002 ? d[i] : NaN);
  }
  stepGrids[0]?.setPlayhead(playing || values.s1Retrig < 0.5 ? (d[7] | 0) : -1);
  stepGrids[1]?.setPlayhead(playing || values.s2Retrig < 0.5 ? (d[8] | 0) : -1);
  document.documentElement.style.setProperty('--glow', String(Math.min(1, peak * 1.6)));
  wasPlaying = playing;
};
// expose for the headless check
(window as unknown as { __prism: unknown }).__prism = { synth, values, peak: () => lastPeak, loadPreset, handler };

// ---- inside the plugin -------------------------------------------------------

if (plugin) {
  // the session's sound (on open, and whenever the host loads a state or a program)
  plugin.onState = (st) => {
    userPresets = st.user.map((p) => ({ name: p.name, tag: 'user', values: p.values, macros: Array.isArray(p.macros) ? p.macros : undefined }));
    sortPresets(); buildBrowser();
    applyValues({ ...defaults(), ...st.values } as ParamValues, true);
    lastLoaded = st.last || null;
    nameMacros(findPreset(st.preset || st.last));
    current = '\u0000';   // force the header to redraw
    setCurrent(st.preset || null);
  };
  // automation and the host's own editor
  plugin.onParams = (changed) => {
    for (const id in changed) {
      const v = changed[id]!;
      values[id] = v;
      controls.get(id)?.set(v);
      if (id === 'volume') setMaster(v);
    }
    refreshLevels();
    refreshSteps();
    refreshMods();
    refreshStates();
    redrawViz();
  };
  // the host's MIDI lights the keys and the field, like a keyboard on the page would
  plugin.onHostNotes = (notes) => {
    for (const [note, velocity, kind] of notes) {
      keyboard.setPressed(note, kind === 0);
      if (kind === 0 && values.arpMode < 1) field.pulse(note, velocity);
    }
  };
  plugin.ready();
}
void hue;
