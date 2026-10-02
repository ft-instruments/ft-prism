// The living background: a refraction field. Shards of glass drift and turn
// slowly in a dark room; one beam of white light always crosses it and
// splits into a faint spectrum at the first shard it meets. A note fires a
// new beam in from the left (higher notes enter higher); where it strikes
// glass it disperses into rays of colour, red → violet, that fan out and
// fade. Motes of light hang in the air and glitter with the output level.
// Mycelia's background is a network that carries light; Prism's breaks it
// into colour.

interface Shard { x: number; y: number; r: number; rot: number; spin: number; vx: number; vy: number; tint: number }
interface Ray { x: number; y: number; dx: number; dy: number; head: number; len: number; speed: number; hue: number; white: boolean; life: number; strength: number; split: boolean }
interface Mote { x: number; y: number; vx: number; vy: number; phase: number; hue: number; size: number }

const TAU = Math.PI * 2;
const RAYS_PER_SPLIT = 7;

export class Refraction {
  private ctx: CanvasRenderingContext2D;
  private shards: Shard[] = [];
  private rays: Ray[] = [];
  private motes: Mote[] = [];
  private W = 0; private H = 0;
  private level = 0;
  private levelTarget = 0;
  private last = 0;
  private running = true;
  private seed = 3;

  constructor(private canvas: HTMLCanvasElement) {
    this.ctx = canvas.getContext('2d')!;
    new ResizeObserver(() => this.resize()).observe(canvas);
    this.resize();
    document.addEventListener('visibilitychange', () => { this.running = !document.hidden; if (this.running) requestAnimationFrame((t) => this.frame(t)); });
    requestAnimationFrame((t) => this.frame(t));
  }

  private rnd(): number {
    let x = this.seed; x ^= x << 13; x ^= x >>> 17; x ^= x << 5; this.seed = x | 0;
    return (x >>> 0) / 4294967296;
  }

  private resize(): void {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const r = this.canvas.getBoundingClientRect();
    this.W = r.width; this.H = r.height;
    this.canvas.width = Math.round(r.width * dpr);
    this.canvas.height = Math.round(r.height * dpr);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.scatter();
  }

  /** Place the shards and motes for the current size. */
  private scatter(): void {
    this.seed = 11;
    const W = this.W, H = this.H;
    const count = Math.round(Math.max(8, Math.min(18, (W * H) / 90000)));
    this.shards = [];
    for (let i = 0; i < count; i++) {
      this.shards.push({
        x: (0.12 + 0.86 * this.rnd()) * W, y: this.rnd() * H, r: 26 + this.rnd() * 70,
        rot: this.rnd() * TAU, spin: (this.rnd() - 0.5) * 0.05, vx: (this.rnd() - 0.5) * 4, vy: (this.rnd() - 0.5) * 3,
        tint: this.rnd() * 275,
      });
    }
    // the shard the standing beam meets: left of centre, high
    this.shards[0].x = W * 0.36; this.shards[0].y = H * 0.24; this.shards[0].r = 64; this.shards[0].vx = 0; this.shards[0].vy = 0;
    this.motes = [];
    for (let i = 0; i < Math.round(count * 4); i++) {
      this.motes.push({
        x: this.rnd() * W, y: this.rnd() * H, vx: (this.rnd() - 0.5) * 8, vy: (this.rnd() - 0.5) * 5,
        phase: this.rnd() * TAU, hue: this.rnd() * 275, size: 0.8 + this.rnd() * 1.4,
      });
    }
    this.rays = [];
  }

  /** The three corners of a shard. */
  private corners(s: Shard): [number, number][] {
    const out: [number, number][] = [];
    for (let k = 0; k < 3; k++) {
      const a = s.rot + (k * TAU) / 3 + (k === 1 ? 0.35 : 0);    // a slightly irregular triangle
      out.push([s.x + Math.cos(a) * s.r, s.y + Math.sin(a) * s.r * 0.86]);
    }
    return out;
  }

  private inside(x: number, y: number, s: Shard): boolean {
    if (Math.abs(x - s.x) > s.r || Math.abs(y - s.y) > s.r) return false;
    const [a, b, c] = this.corners(s);
    const sign = (p: [number, number], q: [number, number]) => (x - q[0]) * (p[1] - q[1]) - (p[0] - q[0]) * (y - q[1]);
    const d1 = sign(a, b), d2 = sign(b, c), d3 = sign(c, a);
    const neg = d1 < 0 || d2 < 0 || d3 < 0, pos = d1 > 0 || d2 > 0 || d3 > 0;
    return !(neg && pos);
  }

  /** A note: a beam of white light comes in from the left at the note's height. */
  pulse(note: number, velocity: number): void {
    if (this.W === 0) return;
    const y = this.H * (0.92 - Math.max(0, Math.min(1, (note - 30) / 70)) * 0.84);
    const ang = (this.rnd() - 0.5) * 0.35;
    const s = 0.45 + (velocity / 127) * 0.6;
    this.rays.push({ x: -10, y, dx: Math.cos(ang), dy: Math.sin(ang), head: 0, len: 0, speed: 900 + this.rnd() * 300, hue: 0, white: true, life: 1, strength: s, split: false });
    if (this.rays.length > 220) this.rays.splice(0, this.rays.length - 220);
  }

  setLevel(peak: number): void { this.levelTarget = Math.min(1, peak * 1.5); }

  private frame(now: number): void {
    if (!this.running) return;
    const dt = Math.min(0.05, (now - this.last) / 1000 || 0.016);
    this.last = now;
    this.step(dt);
    this.draw(now / 1000);
    requestAnimationFrame((t) => this.frame(t));
  }

  private step(dt: number): void {
    this.level += (this.levelTarget - this.level) * (this.levelTarget > this.level ? 0.5 : 0.06);
    const W = this.W, H = this.H;
    for (const s of this.shards) {
      s.rot += s.spin * dt;
      s.x += s.vx * dt; s.y += s.vy * dt;
      if (s.x < -s.r) s.x = W + s.r; if (s.x > W + s.r) s.x = -s.r;
      if (s.y < -s.r) s.y = H + s.r; if (s.y > H + s.r) s.y = -s.r;
    }
    const born: Ray[] = [];
    for (const r of this.rays) {
      if (r.split) { r.life -= dt * 1.4; continue; }       // a beam that hit glass stays, fading
      const before = r.head;
      r.head += r.speed * dt;
      if (r.white) {
        // has the head entered glass? sample along the step so fast beams can't skip a shard
        for (let d = before; d <= r.head; d += 6) {
          const x = r.x + r.dx * d, y = r.y + r.dy * d;
          const hit = this.shards.find((s) => this.inside(x, y, s));
          if (hit) {
            r.head = d; r.split = true;
            const base = Math.atan2(r.dy, r.dx) + 0.12;
            for (let k = 0; k < RAYS_PER_SPLIT; k++) {
              const a = base + (k / (RAYS_PER_SPLIT - 1) - 0.5) * 0.42;
              born.push({ x, y, dx: Math.cos(a), dy: Math.sin(a), head: 0, len: 0, speed: r.speed * 0.6, hue: (k / (RAYS_PER_SPLIT - 1)) * 275, white: false, life: 1, strength: r.strength, split: false });
            }
            break;
          }
        }
      } else {
        r.life -= dt * 0.55;
      }
      const x = r.x + r.dx * r.head, y = r.y + r.dy * r.head;
      if (x > W + 40 || y < -40 || y > H + 40) { r.life -= dt * 2; }
    }
    this.rays.push(...born);
    this.rays = this.rays.filter((r) => r.life > 0);
    for (const m of this.motes) {
      m.phase += dt * (0.7 + this.level * 2);
      m.x += (m.vx + Math.sin(m.phase * 0.6) * 4) * dt;
      m.y += (m.vy + Math.cos(m.phase * 0.4) * 3) * dt;
      if (m.x < -5) m.x = W + 5; if (m.x > W + 5) m.x = -5;
      if (m.y < -5) m.y = H + 5; if (m.y > H + 5) m.y = -5;
    }
  }

  private beam(x0: number, y0: number, x1: number, y1: number, colour: (a: number) => string, width: number, alpha: number): void {
    const ctx = this.ctx;
    const g = ctx.createLinearGradient(x0, y0, x1, y1);
    g.addColorStop(0, colour(alpha * 0.15));
    g.addColorStop(1, colour(alpha));
    ctx.strokeStyle = g; ctx.lineWidth = width;
    ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke();
  }

  private draw(time: number): void {
    const ctx = this.ctx, W = this.W, H = this.H;
    ctx.clearRect(0, 0, W, H);
    const lv = this.level;
    ctx.lineCap = 'round';
    ctx.globalCompositeOperation = 'lighter';

    // the standing beam and its faint spectrum
    const s0 = this.shards[0];
    if (s0) {
      const breathe = 0.5 + 0.5 * Math.sin(time * 0.5);
      this.beam(-20, s0.y + 18, s0.x - 8, s0.y, (a) => `rgba(255,255,255,${a})`, 2.2, 0.32 + lv * 0.4 + breathe * 0.06);
      for (let k = 0; k < RAYS_PER_SPLIT; k++) {
        const a = 0.25 + (k / (RAYS_PER_SPLIT - 1)) * 0.5;
        const hue = (k / (RAYS_PER_SPLIT - 1)) * 275;
        const len = Math.max(W, H) * 1.2;
        const g = ctx.createLinearGradient(s0.x, s0.y, s0.x + Math.cos(a) * len, s0.y + Math.sin(a) * len);
        const al = 0.05 + lv * 0.12 + breathe * 0.015;
        g.addColorStop(0, `hsla(${hue}, 95%, 62%, ${al * 2.2})`);
        g.addColorStop(0.5, `hsla(${hue}, 95%, 55%, ${al})`);
        g.addColorStop(1, `hsla(${hue}, 95%, 50%, 0)`);
        ctx.strokeStyle = g; ctx.lineWidth = 10 + k * 1.5;
        ctx.beginPath(); ctx.moveTo(s0.x, s0.y); ctx.lineTo(s0.x + Math.cos(a) * len, s0.y + Math.sin(a) * len); ctx.stroke();
      }
    }

    // beams fired by notes, and the colour they split into
    for (const r of this.rays) {
      const tail = Math.max(0, r.head - (r.white ? 520 : 380));
      const x0 = r.x + r.dx * tail, y0 = r.y + r.dy * tail;
      const x1 = r.x + r.dx * r.head, y1 = r.y + r.dy * r.head;
      const a = Math.max(0, r.life) * r.strength;
      if (r.white) this.beam(x0, y0, x1, y1, (al) => `rgba(255,255,255,${al})`, 1.8, a * 0.8);
      else this.beam(x0, y0, x1, y1, (al) => `hsla(${r.hue}, 100%, 62%, ${al})`, 2.4, a * 0.75);
      if (!r.split && a > 0.05) {
        const g = ctx.createRadialGradient(x1, y1, 0, x1, y1, 14);
        g.addColorStop(0, r.white ? `rgba(255,255,255,${a})` : `hsla(${r.hue}, 100%, 75%, ${a})`);
        g.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x1, y1, 14, 0, TAU); ctx.fill();
      }
    }
    ctx.globalCompositeOperation = 'source-over';

    // the glass
    for (const s of this.shards) {
      const c = this.corners(s);
      const g = ctx.createLinearGradient(c[0][0], c[0][1], c[2][0], c[2][1]);
      g.addColorStop(0, `hsla(${s.tint}, 60%, 70%, ${0.035 + lv * 0.03})`);
      g.addColorStop(1, `rgba(255,255,255,${0.012})`);
      ctx.fillStyle = g;
      ctx.strokeStyle = `rgba(255,255,255,${0.07 + lv * 0.08})`;
      ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(c[0][0], c[0][1]); ctx.lineTo(c[1][0], c[1][1]); ctx.lineTo(c[2][0], c[2][1]); ctx.closePath();
      ctx.fill(); ctx.stroke();
      // a glint on one edge
      const gl = 0.5 + 0.5 * Math.sin(time * 0.7 + s.tint);
      ctx.strokeStyle = `hsla(${s.tint}, 90%, 80%, ${0.06 + gl * 0.1 + lv * 0.15})`;
      ctx.beginPath(); ctx.moveTo(c[0][0], c[0][1]); ctx.lineTo(c[1][0], c[1][1]); ctx.stroke();
    }

    // motes
    for (const m of this.motes) {
      const tw = 0.3 + 0.7 * Math.max(0, Math.sin(m.phase * 1.9));
      const a = tw * (0.22 + lv * 0.55);
      const g = ctx.createRadialGradient(m.x, m.y, 0, m.x, m.y, m.size * 5);
      g.addColorStop(0, `hsla(${m.hue}, 90%, 85%, ${a})`);
      g.addColorStop(1, `hsla(${m.hue}, 90%, 60%, 0)`);
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(m.x, m.y, m.size * 5, 0, TAU); ctx.fill();
    }
  }
}
