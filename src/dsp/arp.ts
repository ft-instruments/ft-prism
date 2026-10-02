// Arpeggiator. Sits between the keyboard and the voice allocator: held
// keys go in, timed note-on/offs come out. Runs on the internal tempo.

export const ARP_BEATS = [2, 1, 2 / 3, 0.5, 1 / 3, 0.25, 1 / 6, 0.125];   // matches ARP_RATES

export interface ArpOut {
  noteOn(note: number, velocity: number): void;
  noteOff(note: number): void;
}

interface Held { note: number; vel: number }

export class Arp {
  private held: Held[] = [];        // in the order pressed
  private latched: Held[] = [];
  private down = new Set<number>();  // keys physically pressed right now
  private step = 0;
  private dir = 1;
  private countdown = 0;            // samples until next step
  private sounding: { note: number; off: number }[] = [];   // off = samples remaining
  private rng = 12345;
  private wasOn = false;
  private readonly fs: number;

  constructor(sampleRate: number) { this.fs = sampleRate; }

  keyDown(note: number, vel: number, hold: boolean): void {
    if (hold && this.down.size === 0) { this.held = []; this.latched = []; }
    this.down.add(note);
    if (!this.held.some((h) => h.note === note)) this.held.push({ note, vel });
    this.latched = this.held.slice();
  }

  keyUp(note: number, hold: boolean): void {
    this.down.delete(note);
    if (!hold) {
      this.held = this.held.filter((h) => h.note !== note);
      this.latched = this.held.slice();
    } else if (this.down.size === 0) {
      // keep latched; held keeps the chord too until a new key starts one
    } else {
      this.held = this.held.filter((h) => h.note !== note);
    }
  }

  /** Hold (pedal) released: drop everything except the keys still physically down. */
  release(): void {
    this.held = this.held.filter((h) => this.down.has(h.note));
    this.latched = this.held.slice();
  }

  /** Called when the arp is switched off or panic: silence everything. */
  stop(out: ArpOut): void {
    for (const s of this.sounding) out.noteOff(s.note);
    this.sounding = [];
    this.held = []; this.latched = []; this.down.clear();
    this.countdown = 0; this.step = 0; this.wasOn = false;
  }

  get active(): boolean { return this.latched.length > 0; }

  private rand(): number {
    let x = this.rng; x ^= x << 13; x ^= x >>> 17; x ^= x << 5; this.rng = x | 0;
    return (x >>> 0) / 4294967296;
  }

  private sequence(mode: number, octaves: number): Held[] {
    const base = this.latched;
    if (base.length === 0) return [];
    let notes = base.slice();
    if (mode === 1 || mode === 2 || mode === 3) notes.sort((a, b) => a.note - b.note);
    const seq: Held[] = [];
    for (let o = 0; o < octaves; o++) for (const h of notes) seq.push({ note: h.note + 12 * o, vel: h.vel });
    if (mode === 2) seq.reverse();
    return seq;
  }

  /**
   * Advance `n` samples, emitting events at the start of the chunk.
   * mode 0 = off (the engine bypasses the arp then).
   */
  process(n: number, mode: number, rateIdx: number, octaves: number, gate: number, swing: number, tempo: number, out: ArpOut): void {
    // note-offs that are due
    for (let i = this.sounding.length - 1; i >= 0; i--) {
      const s = this.sounding[i];
      s.off -= n;
      if (s.off <= 0) { out.noteOff(s.note); this.sounding.splice(i, 1); }
    }
    const seq = this.sequence(mode, octaves);
    if (seq.length === 0) {
      this.wasOn = false;
      this.countdown = 0;
      return;
    }
    if (!this.wasOn) { this.wasOn = true; this.step = 0; this.dir = 1; this.countdown = 0; }
    this.countdown -= n;
    if (this.countdown > 0) return;
    // fire a step
    const beat = ARP_BEATS[rateIdx] ?? 0.25;
    const stepLen = beat * 60 / tempo * this.fs;
    const even = (this.step & 1) === 0;
    const dur = stepLen * (even ? 1 + swing : 1 - swing);
    this.countdown += dur;
    if (this.countdown < 0) this.countdown = dur;
    const gateLen = Math.max(16, dur * gate);
    const fire = (h: Held) => {
      // retrigger of a still-sounding note: release it first
      const existing = this.sounding.find((s) => s.note === h.note);
      if (existing) { out.noteOff(h.note); this.sounding.splice(this.sounding.indexOf(existing), 1); }
      out.noteOn(h.note, h.vel);
      this.sounding.push({ note: h.note, off: gateLen });
    };
    if (mode === 6) {
      for (const h of seq) fire(h);
    } else {
      let i: number;
      if (mode === 4) i = Math.floor(this.rand() * seq.length);
      else if (mode === 3) {
        const len = seq.length;
        if (len === 1) i = 0;
        else {
          const cycle = 2 * len - 2;
          const k = this.step % cycle;
          i = k < len ? k : cycle - k;
        }
      } else i = this.step % seq.length;
      fire(seq[Math.min(i, seq.length - 1)]);
    }
    this.step++;
  }
}
