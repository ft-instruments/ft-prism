// The picture in each module, drawn from the parameters with the same maths
// the DSP uses. The oscillators' picture is the instrument's signature: the
// wavetable as a stack of frames receding into the glass, the frame being
// played lit white, and under it the spectrum it splits into — harmonics
// coloured red → violet, as light through a prism. The drawing helper and
// the Viz canvas are the family's (same shape as Mycelia's and Vector's).

import {
  type ParamValues, DIV_BEATS, F_BP, F_COMBN, F_COMBP, F_HP, F_LP12, F_LP24, F_NOTCH, F_OFF, F_VOWEL,
  I_CLIP, I_COMB, I_CRUSH, I_FOLD, I_OFF, I_PARA, I_RING, I_SHAPE, I_SHIFT, W_FORMANT,
} from '../dsp/params.ts';
import { getTable } from '../dsp/tables.ts';
import { preview, type Shape } from '../dsp/oscillator.ts';
import { lfoShape, bend } from '../dsp/mod.ts';

/** Harmonic k of n as a spectral colour, red (low) → violet (high). */
export function hue(k: number, n: number, a = 1, light = 62): string {
  const h = (k / Math.max(1, n - 1)) * 275;
  return `hsla(${h.toFixed(0)}, 95%, ${light}%, ${a})`;
}

/** A canvas drawing helper with the module's accent and a glow. */
export class Pen {
  constructor(public ctx: CanvasRenderingContext2D, public w: number, public h: number, public rgb: string) {}
  c(a: number): string { return `rgba(${this.rgb}, ${a})`; }

  grid(cols: number, rows = 2): void {
    const { ctx, w, h } = this;
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.07)'; ctx.lineWidth = 1;
    ctx.setLineDash([1, 3]);
    ctx.beginPath();
    for (let i = 1; i < cols; i++) { const x = Math.round((i / cols) * w) + 0.5; ctx.moveTo(x, 0); ctx.lineTo(x, h); }
    for (let j = 1; j < rows; j++) { const y = Math.round((j / rows) * h) + 0.5; ctx.moveTo(0, y); ctx.lineTo(w, y); }
    ctx.stroke();
    ctx.setLineDash([]);
  }

  trace(pts: [number, number][], opts: { base?: number; alpha?: number; width?: number; fill?: boolean; color?: string } = {}): void {
    if (pts.length < 2) return;
    const { ctx } = this;
    const alpha = opts.alpha ?? 1;
    if (opts.fill !== false && opts.base !== undefined) {
      const grad = ctx.createLinearGradient(0, 0, 0, this.h);
      grad.addColorStop(0, this.c(0.26 * alpha));
      grad.addColorStop(1, this.c(0));
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.moveTo(pts[0][0], opts.base);
      for (const [x, y] of pts) ctx.lineTo(x, y);
      ctx.lineTo(pts[pts.length - 1][0], opts.base);
      ctx.closePath(); ctx.fill();
    }
    ctx.lineJoin = 'round'; ctx.lineCap = 'round';
    ctx.beginPath();
    pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
    const col = opts.color ?? this.c(alpha);
    ctx.shadowColor = opts.color ?? this.c(0.9 * alpha); ctx.shadowBlur = 8;
    ctx.strokeStyle = col; ctx.lineWidth = opts.width ?? 1.6;
    ctx.stroke();
    ctx.shadowBlur = 0;
  }

  dot(x: number, y: number, r = 3, a = 1): void {
    const { ctx } = this;
    ctx.shadowColor = this.c(1); ctx.shadowBlur = 10;
    ctx.fillStyle = `rgba(255, 255, 255, ${a})`;
    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
    ctx.shadowBlur = 0;
  }

  text(s: string, x: number, y: number, align: CanvasTextAlign = 'left', a = 0.55): void {
    const { ctx } = this;
    ctx.font = '500 9px "Geist Mono", ui-monospace, monospace';
    ctx.textAlign = align; ctx.fillStyle = `rgba(255, 255, 255, ${a})`;
    ctx.fillText(s.toUpperCase(), x, y);
  }

  /** f over x ∈ 0..1, values −1..1, centred. */
  fn(f: (x: number) => number, amp: number, opts: { alpha?: number; steps?: number; color?: string } = {}): void {
    const { w, h } = this, mid = h / 2, n = opts.steps ?? 160;
    const pts: [number, number][] = [];
    for (let i = 0; i <= n; i++) pts.push([(i / n) * w, mid - f(i / n) * amp]);
    this.trace(pts, { base: mid, alpha: opts.alpha, color: opts.color });
  }
}

type Draw = (g: Pen, v: ParamValues, live: Float32Array | null) => void;

// ---- the oscillator: wavetable stack + spectrum

const CYCLE = new Float32Array(256);
const AMPS = new Float32Array(64);
const SHAPE: Shape = { table: getTable(0), tableId: 0, pos: 0, spectral: true, warp: 0, amt: 0, hb: 64, f0: 261.6 };

function oscShape(v: ParamValues, n: number, pos: number): Shape {
  const g = `o${n}`;
  const tid = v[`${g}Table`] | 0;
  SHAPE.tableId = tid; SHAPE.table = getTable(tid);
  SHAPE.pos = pos; SHAPE.spectral = v[`${g}Morph`] >= 0.5;
  SHAPE.warp = v[`${g}Warp`] | 0; SHAPE.amt = v[`${g}Amt`];
  SHAPE.hb = 64; SHAPE.f0 = SHAPE.warp === W_FORMANT ? 261.6 : 0;
  return SHAPE;
}

function drawOsc(n: number): Draw {
  return (g, v, live) => {
    const { ctx, w, h } = g;
    const pos = live ? live[n - 1] : v[`o${n}Pos`];
    const specH = Math.round(h * 0.3);
    const stackH = h - specH - 6;
    // the stack: 12 frames receding up and to the right
    const FR = 12, dx = w * 0.16 / FR, dy = stackH * 0.42 / FR;
    const cw = w - dx * FR - 10, amp = (stackH - dy * FR) * 0.42;
    for (let j = FR - 1; j >= 0; j--) {
      const fpos = j / (FR - 1);
      preview(oscShape(v, n, fpos), CYCLE, AMPS);
      let pk = 1e-6; for (let i = 0; i < CYCLE.length; i++) pk = Math.max(pk, Math.abs(CYCLE[i]));
      const ox = 4 + j * dx, oy = stackH - amp - 2 - j * dy;
      const pts: [number, number][] = [];
      for (let i = 0; i < CYCLE.length; i += 2) pts.push([ox + (i / CYCLE.length) * cw, oy - (CYCLE[i] / pk) * amp]);
      const near = 1 - Math.min(1, Math.abs(fpos - pos) * (FR - 1));
      ctx.globalAlpha = 0.16 + 0.3 * near;
      g.trace(pts, { alpha: 0.7, width: 1, fill: false, color: hue(j, FR, 0.9, 60) });
      ctx.globalAlpha = 1;
    }
    // the frame being played, lit white, placed at its depth
    preview(oscShape(v, n, pos), CYCLE, AMPS);
    let pk = 1e-6; for (let i = 0; i < CYCLE.length; i++) pk = Math.max(pk, Math.abs(CYCLE[i]));
    const jx = pos * (FR - 1);
    const ox = 4 + jx * dx, oy = stackH - amp - 2 - jx * dy;
    const pts: [number, number][] = [];
    for (let i = 0; i < CYCLE.length; i++) pts.push([ox + (i / CYCLE.length) * cw, oy - (CYCLE[i] / pk) * amp]);
    g.trace(pts, { width: 1.8, fill: false, color: 'rgba(255,255,255,0.95)' });
    // the spectrum it splits into
    let mx = 1e-6; for (let k = 0; k < AMPS.length; k++) mx = Math.max(mx, AMPS[k]);
    const bw = w / AMPS.length;
    const top = h - specH;
    ctx.fillStyle = 'rgba(255,255,255,0.04)'; ctx.fillRect(0, top, w, specH);
    for (let k = 0; k < AMPS.length; k++) {
      const db = 20 * Math.log10(AMPS[k] / mx + 1e-9);
      const bh = Math.max(0, (1 + db / 60)) * (specH - 2);
      if (bh <= 0) continue;
      ctx.fillStyle = hue(k, AMPS.length, 0.9);
      ctx.shadowColor = hue(k, AMPS.length, 0.8); ctx.shadowBlur = 6;
      ctx.fillRect(k * bw + 0.5, h - bh, Math.max(1, bw - 1), bh);
    }
    ctx.shadowBlur = 0;
    g.text(`${SHAPE.table.name} · ${(pos * 100).toFixed(0)}%`, w - 4, 11, 'right', 0.6);
  };
}

// ---- modulators

function drawEnv(n: number): Draw {
  return (g, v, live) => {
    const e = `e${n}`;
    const a = v[`${e}Atk`], d = v[`${e}Dec`], s = v[`${e}Sus`], r = v[`${e}Rel`], c = v[`${e}Curve`];
    const loop = v[`${e}Mode`] >= 0.5;
    const total = a + d + (loop ? 0 : Math.max(0.3, (a + d) * 0.5)) + r;
    const { w, h } = g, top = 8, bot = h - 6, H = bot - top;
    const X = (t: number) => (t / total) * (w - 8) + 4;
    const pts: [number, number][] = [];
    const N = 40;
    for (let i = 0; i <= N; i++) { const t = (i / N) * a; pts.push([X(t), bot - bend(i / N, c) * H]); }
    const sus = loop ? 0 : s;
    for (let i = 0; i <= N; i++) { const t = a + (i / N) * d; pts.push([X(t), bot - (sus + (1 - sus) * (1 - bend(i / N, c))) * H]); }
    const hold = loop ? 0 : Math.max(0.3, (a + d) * 0.5);
    pts.push([X(a + d + hold), bot - sus * H]);
    for (let i = 0; i <= N; i++) { const t = a + d + hold + (i / N) * r; pts.push([X(t), bot - sus * (1 - bend(i / N, c)) * H]); }
    g.grid(4, 2);
    g.trace(pts, { base: bot });
    if (live) { const val = live[12 + n]; if (val > 0.001) g.dot(w - 8, bot - val * H, 3); }
    if (loop) g.text('loop', 6, 11, 'left', 0.5);
  };
}

function drawLfo(n: number): Draw {
  return (g, v, live) => {
    const l = `l${n}`;
    const shape = v[`${l}Shape`] | 0, uni = v[`${l}Uni`] >= 0.5;
    // fixed random values so the random shapes have something to draw
    const R = [0.6, -0.3, 0.9, -0.8, 0.1, 0.5, -0.6, 0.2];
    g.grid(4, 2);
    g.fn((x) => {
      const cyc = x * 2, i = Math.floor(cyc), ph = cyc - i;
      const y = lfoShape(shape, ph, R[i % 8], R[(i + 1) % 8]);
      return uni ? y * 0.5 + 0.5 : y;
    }, g.h * 0.38);
    const rate = v[`${l}Sync`] >= 0.5 ? `${['4 bar', '2 bar', '1 bar', '1/2', '1/4', '1/8', '1/16', '1/32', '1/4 t', '1/8 t', '1/16 t', '1/4 .', '1/8 .'][v[`${l}Div`] | 0]}` : `${v[`${l}Rate`].toFixed(2)} hz`;
    g.text(rate, g.w - 4, 11, 'right', 0.5);
    if (live) g.dot(g.w - 8, g.h / 2 - live[2 + n] * g.h * 0.38, 3);
    void DIV_BEATS;
  };
}

// ---- filters and inserts

const VOWELS = [[730, 1090, 2440], [530, 1840, 2480], [270, 2290, 3010], [570, 840, 2410], [300, 870, 2240]];

/** Magnitude of the filter at f (Hz), from the analog prototypes the SVF follows. */
function filterMag(type: number, cut: number, res: number, f: number): number {
  const w = f / cut;
  const k = 2 - 1.96 * res;
  const lp2 = (kk: number, ww: number) => 1 / Math.hypot(1 - ww * ww, kk * ww);
  switch (type) {
    case F_LP12: return lp2(k, w);
    case F_LP24: return lp2(1.85 - res * 0.6, w) * lp2(1.414 - 1.39 * res, w) * (1 + res * 0.4);
    case F_BP: return (k * w) / Math.hypot(1 - w * w, k * w) * Math.sqrt(k / 2) * 1.4 / k;
    case F_HP: return (w * w) / Math.hypot(1 - w * w, k * w);
    case F_NOTCH: return Math.abs(1 - w * w) / Math.hypot(1 - w * w, k * w);
    case F_VOWEL: {
      const pos = Math.min(1, Math.max(0, Math.log(cut / 20) / Math.log(1000))) * 4;
      const vi = Math.min(3, Math.floor(pos)), u = pos - vi;
      const kk = 0.5 - res * 0.42;
      let s = 0;
      for (let j = 0; j < 3; j++) {
        const fc = VOWELS[vi][j] + (VOWELS[vi + 1][j] - VOWELS[vi][j]) * u, ww = f / fc;
        s += [1, 0.7, 0.45][j] * kk * 2.2 * (kk * ww) / Math.hypot(1 - ww * ww, kk * ww);
      }
      return s;
    }
    case F_COMBP: case F_COMBN: {
      const fb = (0.5 + res * 0.47) * (type === F_COMBN ? -1 : 1);
      const ph = 2 * Math.PI * f / cut;
      return (1 - Math.abs(fb) * 0.6) / Math.hypot(1 - fb * Math.cos(ph), fb * Math.sin(ph));
    }
    default: return 1;
  }
}

function drawFilter(n: number): Draw {
  return (g, v) => {
    const f = `f${n}`;
    const type = v[`${f}Type`] | 0;
    const { w, h } = g;
    g.grid(10, 4);
    if (type === F_OFF) { g.text('bypassed', w / 2, h / 2 + 3, 'center', 0.4); return; }
    const pts: [number, number][] = [];
    for (let i = 0; i <= 200; i++) {
      const hz = 20 * Math.pow(1000, i / 200);
      const db = 20 * Math.log10(filterMag(type, v[`${f}Cut`], v[`${f}Res`], hz) + 1e-9);
      pts.push([(i / 200) * w, h * 0.42 - (db / 30) * h * 0.5]);
    }
    for (const p of pts) p[1] = Math.max(1, Math.min(h - 1, p[1]));
    g.trace(pts, { base: h });
  };
}

function drawInsert(slot: string): Draw {
  return (g, v) => {
    const i = `i${slot}`;
    const type = v[`${i}Type`] | 0, a = v[`${i}A`], b = v[`${i}B`], mix = v[`${i}Mix`];
    const { w, h } = g;
    g.grid(4, 2);
    if (type === I_OFF) { g.text('empty slot', w / 2, h / 2 + 3, 'center', 0.4); return; }
    const amp = h * 0.4;
    let f: ((x: number) => number) | null = null;
    switch (type) {
      case I_FOLD: { const gg = 1 + a * 10, bias = b * 0.6; f = (x) => Math.sin(1.5707963 * gg * (x + bias)) * 0.8; break; }
      case I_SHAPE: { const gg = 1 + a * 20, off = b * 0.4; f = (x) => (Math.tanh(x * gg + off) - Math.tanh(off)) / Math.tanh(Math.min(3, gg * 0.6)) * 0.8; break; }
      case I_PARA: { const gg = 1 + a * 6, ev = b * 0.5; f = (x) => { let z = x * gg; z = Math.max(-1, Math.min(1, z)); return (z * (2 - Math.abs(z)) + ev * z * z) * 0.8; }; break; }
      case I_CLIP: { const gg = 1 + a * 30, off = b * 0.5; f = (x) => (Math.max(-1, Math.min(1, x * gg + off)) - off * 0.5) * 0.7; break; }
      case I_CRUSH: { const bits = Math.round(16 - (b + 1) * 7), q = Math.pow(2, Math.min(bits, 6) - 1); f = (x) => Math.round(Math.sin(x * Math.PI) * q) / q; break; }
    }
    if (f) {
      // transfer curve: input −1..1 across, output up
      const pts: [number, number][] = [];
      for (let k = 0; k <= 120; k++) { const x = (k / 120) * 2 - 1; pts.push([(k / 120) * w, h / 2 - (x * (1 - mix) + f(x) * mix) * amp]); }
      g.trace(pts, { base: h / 2 });
    } else if (type === I_SHIFT || type === I_RING) {
      // a spectrum moving: the source line and where it lands
      const s = a * 2 - 1;
      const moved = type === I_SHIFT ? 0.5 + s * 0.35 : 0.5;
      g.ctx.fillStyle = 'rgba(255,255,255,0.25)';
      g.ctx.fillRect(w * 0.5 - 1, h * 0.25, 2, h * 0.65);
      if (type === I_SHIFT) {
        g.ctx.fillStyle = hue(s > 0 ? 220 : 20, 275, 0.95);
        g.ctx.fillRect(w * moved - 1.5, h * 0.18, 3, h * 0.72);
        const hz = Math.sign(s) * s * s * 1500;
        g.text(`${hz >= 0 ? '+' : '−'}${Math.abs(hz).toFixed(0)} hz${Math.abs(b) > 0.01 ? ' · tracked' : ''}`, w - 4, 11, 'right', 0.6);
      } else {
        const r = Math.pow(2, a * 5 - 2) * Math.pow(2, b * 0.5);
        const off = Math.min(0.45, 0.12 * Math.log2(1 + r));
        for (const x of [0.5 - off, 0.5 + off]) { g.ctx.fillStyle = hue(x * 275, 275, 0.95); g.ctx.fillRect(w * x - 1.5, h * 0.25, 3, h * 0.65); }
        g.text(`× ${r.toFixed(2)} pitch`, w - 4, 11, 'right', 0.6);
      }
    } else if (type === I_COMB) {
      const fb = b * 0.95, ratio = Math.pow(2, a * 3 - 1);
      const pts: [number, number][] = [];
      for (let k = 0; k <= 200; k++) {
        const ph = 2 * Math.PI * (k / 200) * 6 / ratio;
        const m = 1 / Math.hypot(1 - fb * Math.cos(ph), fb * Math.sin(ph));
        pts.push([(k / 200) * w, h - 4 - Math.min(1, m / 6) * (h - 10)]);
      }
      g.trace(pts, { base: h });
    }
  };
}

// ---- sources and master

const drawSub: Draw = (g, v) => {
  const tri = v.subShape >= 0.5;
  g.grid(4, 2);
  g.fn((x) => { const ph = (x * 2) % 1; return tri ? (ph < 0.5 ? 4 * ph - 1 : 3 - 4 * ph) : Math.sin(ph * Math.PI * 2); }, g.h * 0.36 * Math.max(0.15, v.subLevel));
  // noise as a scatter under it, coloured by its tilt
  const c = v.nzColour, lvl = v.nzLevel;
  if (lvl > 0) {
    const ctx = g.ctx;
    for (let i = 0; i < 160; i++) {
      const x = ((i * 97) % 160) / 160 * g.w, y = g.h / 2 + Math.sin(i * 12.9898) * 43758.5453 % 1 * g.h * 0.4 * lvl;
      ctx.fillStyle = hue(c < 0 ? 10 : 200 + c * 70, 275, 0.6);
      ctx.fillRect(x, y, 1.5, 1.5);
    }
  }
};

const drawDelay: Draw = (g, v) => {
  const { ctx, w, h } = g;
  const sec = v.dlSync >= 0.5 ? (60 / v.tempo) * DIV_BEATS[v.dlDiv | 0] : v.dlTime / 1000;
  g.grid(8, 2);
  let a = 1;
  const spiral = v.dlShift;
  const span = Math.max(1, sec * 6);           // show about six repeats
  for (let i = 1; i < 12 && a > 0.03; i++) {
    const x = (i * sec / span) * w;
    if (x > w) break;
    if (i > 1) a *= v.dlFb;
    const left = v.dlPing >= 0.5 ? i % 2 === 1 : true;
    ctx.fillStyle = hue(Math.max(0, Math.min(274, 137 + spiral * i * 18)), 275, Math.min(1, a + 0.15));
    const bh = a * (h * 0.4);
    ctx.fillRect(x - 1.5, left ? h / 2 - bh : h / 2, 3, bh);
  }
  ctx.fillStyle = 'rgba(255,255,255,0.9)'; ctx.fillRect(1, h / 2 - h * 0.4, 3, h * 0.8);
  g.text(`${(sec * 1000).toFixed(0)} ms${spiral ? ` · spiral ${spiral > 0 ? '↑' : '↓'}` : ''}`, w - 4, 11, 'right', 0.5);
};

const drawReverb: Draw = (g, v) => {
  const { w, h } = g;
  g.grid(8, 2);
  const pts: [number, number][] = [];
  const total = Math.max(2, v.rvDecay * 1.4);
  for (let i = 0; i <= 120; i++) {
    const t = (i / 120) * total;
    const e = Math.pow(10, -3 * t / v.rvDecay) * (1 - Math.exp(-t * 40));
    pts.push([(i / 120) * w, h - 4 - e * (h - 12) * (0.4 + 0.6 * v.rvMix)]);
  }
  g.trace(pts, { base: h });
  g.text(`${v.rvDecay.toFixed(1)} s${v.rvShimmer > 0 ? ' · shimmer' : ''}`, w - 4, 11, 'right', 0.5);
};

const drawSquash: Draw = (g, v, live) => {
  const { ctx, w, h } = g;
  g.grid(3, 4);
  const names = ['low', 'mid', 'high'];
  for (let b = 0; b < 3; b++) {
    const x = (b + 0.5) * w / 3;
    const db = live ? live[10 + b] : 0;
    const bh = Math.min(1, Math.abs(db) / 18) * (h / 2 - 8);
    ctx.fillStyle = db >= 0 ? hue(200, 275, 0.9) : hue(10, 275, 0.9);
    ctx.shadowColor = ctx.fillStyle; ctx.shadowBlur = 8;
    ctx.fillRect(x - 10, db >= 0 ? h / 2 - bh : h / 2, 20, Math.max(1, bh));
    ctx.shadowBlur = 0;
    g.text(names[b], x, h - 4, 'center', 0.45);
  }
  ctx.fillStyle = 'rgba(255,255,255,0.25)'; ctx.fillRect(0, h / 2, w, 1);
  g.text(v.sqDepth > 0 ? `depth ${(v.sqDepth * 100).toFixed(0)}%` : 'off', w - 4, 11, 'right', 0.5);
};

const drawDim: Draw = (g, v) => {
  const { ctx, w, h } = g;
  g.grid(4, 2);
  // the image: a dot that widens into a bar
  const wid = 0.12 + v.dimMix * 0.4 + v.chMix * 0.3;
  const grad = ctx.createLinearGradient(w * (0.5 - wid), 0, w * (0.5 + wid), 0);
  for (let i = 0; i <= 6; i++) grad.addColorStop(i / 6, hue(i, 7, 0.75));
  ctx.fillStyle = grad;
  ctx.shadowColor = 'rgba(255,255,255,0.4)'; ctx.shadowBlur = 10;
  ctx.fillRect(w * (0.5 - wid), h * 0.42, w * wid * 2, h * 0.16);
  ctx.shadowBlur = 0;
  g.text('L', 6, h / 2 + 3, 'left', 0.4); g.text('R', w - 6, h / 2 + 3, 'right', 0.4);
};

const drawArp: Draw = (g, v) => {
  const { ctx, w, h } = g;
  const mode = v.arpMode | 0, oct = Math.max(1, v.arpOct | 0), gate = v.arpGate, swing = v.arpSwing;
  g.grid(8, 4);
  if (mode === 0) { g.text('off — the keys play the voices', w / 2, h / 2 + 3, 'center', 0.4); return; }
  // a held C-E-G, stepped the way the mode walks it
  const chord = [0, 4, 7];
  const seq: number[] = [];
  for (let o = 0; o < oct; o++) for (const c of chord) seq.push(c + o * 12);
  if (mode === 2) seq.reverse();
  const N = 16, span = Math.max(12, oct * 12);
  let r = 7;
  for (let i = 0; i < N; i++) {
    let notes: number[];
    if (mode === 6) notes = seq;
    else if (mode === 4) { r = (r * 1103515245 + 12345) & 0x7fffffff; notes = [seq[r % seq.length]]; }
    else if (mode === 3 && seq.length > 1) { const cyc = 2 * seq.length - 2, k = i % cyc; notes = [seq[k < seq.length ? k : cyc - k]]; }
    else notes = [seq[i % seq.length]];
    const x0 = (i / N) * w + (i % 2 ? -swing : swing) * (w / N) * 0.5;
    const len = (w / N) * gate * (i % 2 ? 1 - swing : 1 + swing);
    for (const n of notes) {
      const y = h - 6 - (n / span) * (h - 14);
      ctx.fillStyle = hue(n, span + 1, 0.9);
      ctx.shadowColor = ctx.fillStyle; ctx.shadowBlur = 6;
      ctx.fillRect(x0 + 1, y - 2, Math.max(2, len - 2), 4);
    }
  }
  ctx.shadowBlur = 0;
  g.text(`${v.tempo | 0} bpm`, w - 4, 11, 'right', 0.5);
};

const VIZ: Record<string, Draw> = {
  arp: drawArp,
  osc1: drawOsc(1), osc2: drawOsc(2), osc3: drawOsc(3),
  env1: drawEnv(1), env2: drawEnv(2), env3: drawEnv(3), env4: drawEnv(4),
  lfo1: drawLfo(1), lfo2: drawLfo(2), lfo3: drawLfo(3), lfo4: drawLfo(4),
  f1: drawFilter(1), f2: drawFilter(2), insA: drawInsert('A'), insB: drawInsert('B'),
  sub: drawSub, delay: drawDelay, reverb: drawReverb, squash: drawSquash, dim: drawDim,
};

/** Which pictures move with the sound (they redraw on every stats message while notes play). */
export const LIVE_VIZ = new Set(['osc1', 'osc2', 'osc3', 'env1', 'env2', 'env3', 'env4', 'lfo1', 'lfo2', 'lfo3', 'lfo4', 'squash']);

export class Viz {
  readonly el: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private queued = false;
  live: Float32Array | null = null;

  constructor(readonly kind: string, private values: ParamValues, cls = '') {
    const el = document.createElement('canvas');
    el.className = `viz ${cls}`;
    this.el = el;
    this.ctx = el.getContext('2d')!;
    new ResizeObserver(() => this.redraw()).observe(el);
  }

  /** Coalesced to one draw per frame, however many knobs moved. */
  redraw(): void {
    if (this.queued) return;
    this.queued = true;
    requestAnimationFrame(() => { this.queued = false; this.draw(); });
  }

  private draw(): void {
    const r = { width: this.el.clientWidth, height: this.el.clientHeight };
    if (r.width === 0) return;                         // hidden tab: drawn when shown
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const W = Math.round(r.width * dpr), H = Math.round(r.height * dpr);
    if (this.el.width !== W || this.el.height !== H) { this.el.width = W; this.el.height = H; }
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.ctx.clearRect(0, 0, r.width, r.height);
    const rgb = getComputedStyle(this.el).color.match(/\d+(\.\d+)?/g)?.slice(0, 3).join(', ') ?? '255, 255, 255';
    VIZ[this.kind]?.(new Pen(this.ctx, r.width, r.height, rgb), this.values, this.live);
  }
}
