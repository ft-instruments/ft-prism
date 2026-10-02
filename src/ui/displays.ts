// The live displays: the steppers' drawable grids (Vector's table grid,
// lit in spectral colour) and the scope in the header, which shows the
// output as a waveform with its spectrum's colour.

import { hue } from './viz.ts';

function setupCanvas(canvas: HTMLCanvasElement, ctx: CanvasRenderingContext2D): { W: number; H: number } {
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const r = { width: canvas.clientWidth, height: canvas.clientHeight };
  const w = Math.max(1, Math.round(r.width * dpr)), h = Math.max(1, Math.round(r.height * dpr));
  if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return { W: r.width, H: r.height };
}

/** A row of bipolar steps you draw with the mouse (right button zeroes). */
export class StepGrid {
  el: HTMLElement;
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private values: number[];
  private playhead = -1;
  private len: number;
  private painting = false;

  constructor(label: string, private cols: number, private min: number, private max: number, initial: number[],
    private onChange: (idx: number, value: number) => void) {
    this.values = initial.slice();
    this.len = cols;
    const el = document.createElement('div');
    el.className = 'grid';
    const l = document.createElement('div'); l.className = 'label'; l.textContent = label;
    const canvas = document.createElement('canvas');
    el.append(l, canvas);
    this.el = el; this.canvas = canvas;
    this.ctx = canvas.getContext('2d')!;
    new ResizeObserver(() => this.draw()).observe(canvas);
    canvas.addEventListener('pointerdown', (e) => { this.painting = true; canvas.setPointerCapture(e.pointerId); this.paint(e); e.preventDefault(); });
    canvas.addEventListener('pointermove', (e) => { if (this.painting) this.paint(e); });
    const end = () => { this.painting = false; };
    canvas.addEventListener('pointerup', end);
    canvas.addEventListener('pointercancel', end);
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  private paint(e: PointerEvent): void {
    const r = { width: this.canvas.clientWidth, height: this.canvas.clientHeight };
    const col = Math.max(0, Math.min(this.cols - 1, Math.floor(e.offsetX / r.width * this.cols)));
    const rows = this.max - this.min + 1;
    let v = this.max - Math.floor(e.offsetY / r.height * rows);
    if (e.buttons & 2) v = 0;
    v = Math.max(this.min, Math.min(this.max, v));
    if (this.values[col] === v) return;
    this.values[col] = v;
    this.onChange(col, v);
    this.draw();
  }

  set(idx: number, value: number): void { this.values[idx] = value; this.draw(); }
  setLength(n: number): void { if (n !== this.len) { this.len = n; this.draw(); } }
  setPlayhead(col: number): void { if (col !== this.playhead) { this.playhead = col; this.draw(); } }

  draw(): void {
    const { W, H } = setupCanvas(this.canvas, this.ctx);
    const ctx = this.ctx;
    ctx.clearRect(0, 0, W, H);
    const rows = this.max - this.min + 1;
    const cw = W / this.cols, ch = H / rows;
    const zero = (this.max + 1) * ch - ch / 2;
    ctx.fillStyle = 'rgba(255,255,255,0.05)';
    for (let c = 0; c < this.cols; c++) ctx.fillRect(c * cw + 1, 0, cw - 2, H);
    ctx.fillStyle = 'rgba(255,255,255,0.25)'; ctx.fillRect(0, zero - 0.5, W, 1);
    for (let c = 0; c < this.cols; c++) {
      const v = this.values[c];
      const off = c >= this.len;
      const lit = c === this.playhead;
      const y = zero - v * ch;
      const col = hue(c, this.cols, off ? 0.18 : lit ? 1 : 0.8, lit ? 75 : 60);
      ctx.fillStyle = col;
      ctx.shadowColor = col; ctx.shadowBlur = lit ? 12 : 4;
      if (v === 0) ctx.fillRect(c * cw + 2, zero - 1.5, cw - 4, 3);
      else ctx.fillRect(c * cw + 2, Math.min(zero, y), cw - 4, Math.abs(y - zero));
      ctx.shadowBlur = 0;
      if (lit) { ctx.fillStyle = 'rgba(255,255,255,0.1)'; ctx.fillRect(c * cw, 0, cw, H); }
    }
  }
}

/** The header scope: the last few milliseconds of output, the trace tinted by its brightness. */
export class Scope {
  private ctx: CanvasRenderingContext2D;
  constructor(private canvas: HTMLCanvasElement) { this.ctx = canvas.getContext('2d')!; }
  update(scope: Float32Array, peak: number): void {
    const { W, H } = setupCanvas(this.canvas, this.ctx);
    const ctx = this.ctx;
    ctx.clearRect(0, 0, W, H);
    // brightness: how much the signal changes sample to sample, relative to its size
    let diff = 0, mag = 1e-6;
    for (let i = 1; i < 512; i++) { diff += Math.abs(scope[i] - scope[i - 1]); mag += Math.abs(scope[i]); }
    const bright = Math.min(1, (diff / mag) * 4);
    const grad = ctx.createLinearGradient(0, 0, W, 0);
    for (let i = 0; i <= 6; i++) grad.addColorStop(i / 6, hue(i * bright * 0.9 + (1 - bright) * 0.4, 6, 0.95, 65));
    const gain = peak > 0.001 ? 0.42 / Math.max(0.1, peak) : 0;
    const mono = (i: number) => (scope[i & 511] + scope[512 + (i & 511)]) * 0.5;
    let start = 0;
    for (let i = 1; i < 256; i++) if (mono(i - 1) < 0 && mono(i) >= 0) { start = i; break; }
    ctx.beginPath();
    for (let i = 0; i < 256; i++) {
      const v = mono(start + i);
      const x = (i / 255) * W, y = H / 2 - v * gain * H;
      if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y);
    }
    ctx.strokeStyle = grad; ctx.lineWidth = 1.4;
    ctx.shadowColor = 'rgba(255,255,255,0.6)'; ctx.shadowBlur = 6;
    ctx.stroke();
    ctx.shadowBlur = 0;
  }
}
