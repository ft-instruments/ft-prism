// The modulators: envelopes, LFOs and steppers. All run at block rate (one
// value per 64-sample block, ramped by whoever reads them), which is plenty
// for modulation and keeps a voice cheap.

/** Power bend of a 0..1 ramp: c > 0 rises fast and settles slowly (exponential-like), c < 0 the opposite. */
export function bend(u: number, c: number): number {
  return c >= 0 ? 1 - Math.pow(1 - u, 1 + 4 * c) : Math.pow(u, 1 - 4 * c);
}

const IDLE = 0, ATTACK = 1, DECAY = 2, SUSTAIN = 3, RELEASE = 4;

export class Env {
  value = 0;
  stage = IDLE;
  private t = 0;           // time in the current stage, s
  private from = 0;        // level the stage started at

  get active(): boolean { return this.stage !== IDLE; }
  get released(): boolean { return this.stage === RELEASE || this.stage === IDLE; }

  gate(on: boolean): void {
    if (on) { this.stage = ATTACK; this.t = 0; this.from = this.value; }
    else if (this.stage !== IDLE) { this.stage = RELEASE; this.t = 0; this.from = this.value; }
  }

  kill(): void { this.stage = IDLE; this.value = 0; }

  /** Advance by dt seconds and return the new value. */
  step(dt: number, a: number, d: number, s: number, r: number, curve: number, loop: boolean): number {
    this.t += dt;
    switch (this.stage) {
      case ATTACK: {
        const u = this.t / a;
        if (u >= 1) { this.value = 1; this.stage = DECAY; this.t = 0; this.from = 1; }
        else this.value = this.from + (1 - this.from) * bend(u, curve);
        break;
      }
      case DECAY: {
        const target = loop ? 0 : s;
        const u = this.t / d;
        if (u >= 1) {
          this.value = target;
          if (loop) { this.stage = ATTACK; this.t = 0; this.from = this.value; }
          else this.stage = SUSTAIN;
        } else this.value = target + (this.from - target) * (1 - bend(u, curve));
        break;
      }
      case SUSTAIN: this.value = s; break;
      case RELEASE: {
        const u = this.t / r;
        if (u >= 1) { this.value = 0; this.stage = IDLE; }
        else this.value = this.from * (1 - bend(u, curve));
        break;
      }
      default: this.value = 0;
    }
    return this.value;
  }
}

/** Waveforms by phase 0..1, bipolar. `hold` and `next` carry the random shapes. */
export function lfoShape(shape: number, ph: number, hold: number, next: number): number {
  switch (shape) {
    case 0: return Math.sin(ph * Math.PI * 2);
    case 1: return ph < 0.25 ? ph * 4 : ph < 0.75 ? 2 - ph * 4 : ph * 4 - 4;
    case 2: return 1 - 2 * ph;                      // saw: falls
    case 3: return 2 * ph - 1;                      // ramp: rises
    case 4: return ph < 0.5 ? 1 : -1;
    case 5: return hold;                            // sample & hold
    default: { const u = ph * ph * (3 - 2 * ph); return hold + (next - hold) * u; }   // drift: smooth random
  }
}

/** One LFO's running state (per voice when it retriggers, in the engine when it runs free). */
export class LfoState {
  phase = 0;
  hold = 0;
  next = 0;
  age = 0;          // seconds since the note, for the fade-in

  reset(phase: number, rnd: () => number): void {
    this.phase = phase; this.age = 0;
    this.hold = rnd() * 2 - 1; this.next = rnd() * 2 - 1;
  }

  advance(inc: number, dt: number, rnd: () => number): void {
    this.age += dt;
    this.phase += inc;
    while (this.phase >= 1) {
      this.phase -= 1;
      this.hold = this.next; this.next = rnd() * 2 - 1;
    }
  }
}

/** A stepper's position: which step, how far into it. */
export class StepState {
  pos = 0;          // in steps, fractional
  reset(): void { this.pos = 0; }
  advance(stepsPerSecond: number, dt: number, len: number): void {
    this.pos += stepsPerSecond * dt;
    if (this.pos >= len) this.pos -= len * Math.floor(this.pos / len);
  }
  /** The value (−1..1) with glide into the next step over the last `glide` of each step. */
  value(cells: Float32Array, len: number, glide: number): number {
    const i = Math.floor(this.pos) % len;
    const cur = cells[i] / 8;
    if (glide <= 0) return cur;
    const frac = this.pos - Math.floor(this.pos);
    const start = 1 - glide;
    if (frac <= start) return cur;
    const u = (frac - start) / glide;
    const nxt = cells[(i + 1) % len] / 8;
    return cur + (nxt - cur) * u * u * (3 - 2 * u);
  }
  get index(): number { return Math.floor(this.pos); }
}
