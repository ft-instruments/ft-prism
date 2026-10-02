// Offline render / sanity check. Runs the DSP core in Node (no browser),
// writes WAVs and prints level statistics.
//
//   node scripts/render.ts                   -> out/<preset>.wav for every preset (short phrase each)
//   node scripts/render.ts preset "Thomas"   -> out/preset.wav (one preset, a chord + phrase)
//   node scripts/render.ts note 60 100       -> out/note.wav (init patch, one note)
//   node scripts/render.ts bench [names…]    -> CPU timing: the worst case, then any presets named
//   node scripts/render.ts spectrum          -> harmonics and aliasing of a raw saw at four notes
//   node scripts/render.ts hash              -> the matrix invariant: unused slots change nothing
//   node scripts/render.ts levels            -> measure every preset's loudness, write src/dsp/levels.gen.ts
//   node scripts/render.ts raw [dir]         -> <dir>/<preset>.f32, raw float32 stereo

import { writeFileSync, mkdirSync } from 'node:fs';
import { PrismEngine } from '../src/dsp/engine.ts';
import { PRESETS, RAW_PRESETS } from '../src/dsp/presets.ts';
import { PARAM_BY_ID } from '../src/dsp/params.ts';

const FS = 48000;
const BLOCK = 128;

type Ev = { t: number; fn: () => void };

function render(e: PrismEngine, seconds: number, events: Ev[]): [Float32Array, Float32Array] {
  const total = Math.ceil(seconds * FS / BLOCK) * BLOCK;
  const L = new Float32Array(total), R = new Float32Array(total);
  events.sort((a, b) => a.t - b.t);
  let ev = 0;
  for (let off = 0; off < total; off += BLOCK) {
    const t = off / FS;
    while (ev < events.length && events[ev].t <= t) events[ev++].fn();
    e.process(L.subarray(off, off + BLOCK), R.subarray(off, off + BLOCK), BLOCK);
  }
  return [L, R];
}

function writeWav(path: string, L: Float32Array, R: Float32Array): void {
  const n = L.length;
  const buf = Buffer.alloc(44 + n * 4);
  buf.write('RIFF', 0); buf.writeUInt32LE(36 + n * 4, 4); buf.write('WAVE', 8);
  buf.write('fmt ', 12); buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(2, 22);
  buf.writeUInt32LE(FS, 24); buf.writeUInt32LE(FS * 4, 28); buf.writeUInt16LE(4, 32); buf.writeUInt16LE(16, 34);
  buf.write('data', 36); buf.writeUInt32LE(n * 4, 40);
  for (let i = 0; i < n; i++) {
    buf.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(L[i] * 32767))), 44 + i * 4);
    buf.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(R[i] * 32767))), 46 + i * 4);
  }
  mkdirSync('out', { recursive: true });
  writeFileSync(path, buf);
  console.log(`wrote ${path} (${(n / FS).toFixed(2)} s)`);
}

const db = (x: number) => (20 * Math.log10(Math.max(1e-9, x))).toFixed(1);

function stats(L: Float32Array, R: Float32Array, label = ''): boolean {
  let peak = 0, nan = 0, sq = 0;
  for (let i = 0; i < L.length; i++) {
    const a = Math.abs(L[i]), b = Math.abs(R[i]);
    if (!Number.isFinite(a) || !Number.isFinite(b)) nan++;
    if (a > peak) peak = a; if (b > peak) peak = b;
    sq += L[i] * L[i];
  }
  console.log(`${label} peak ${db(peak)} dBFS, rms ${db(Math.sqrt(sq / L.length))} dBFS${nan ? `  !!! ${nan} non-finite samples` : ''}`);
  return nan === 0;
}

function envelope(L: Float32Array, win = 0.25, maxRows = 40): void {
  const w = Math.floor(win * FS);
  const rows: string[] = [];
  for (let off = 0; off + w <= L.length && rows.length < maxRows; off += w) {
    let s = 0;
    for (let i = off; i < off + w; i++) s += L[i] * L[i];
    rows.push(`${(off / FS).toFixed(1)}s ${db(Math.sqrt(s / w)).padStart(6)}`);
  }
  console.log(rows.join(' | '));
}

/** A short phrase that shows a preset off: chord, then a few melody notes. */
function phrase(e: PrismEngine, seconds = 7): [Float32Array, Float32Array] {
  const ev: Ev[] = [];
  const play = (t: number, n: number, v: number, dur: number) => {
    ev.push({ t, fn: () => e.noteOn(n, v) });
    ev.push({ t: t + dur, fn: () => e.noteOff(n) });
  };
  play(0.1, 48, 90, 3.2); play(0.1, 55, 85, 3.2); play(0.12, 60, 88, 3.2); play(0.14, 63, 84, 3.2); play(0.16, 67, 92, 3.2);
  play(3.6, 72, 100, 0.5); play(4.0, 70, 90, 0.5); play(4.4, 67, 95, 0.9); play(5.2, 63, 80, 1.2);
  return render(e, seconds, ev);
}

/** Magnitude of one frequency over N samples from `a`, Hann-windowed. */
function mag(L: Float32Array, a: number, N: number, f: number): number {
  let re = 0, im = 0;
  for (let i = 0; i < N; i++) {
    const w = 0.5 - 0.5 * Math.cos(2 * Math.PI * i / N);
    const ph = 2 * Math.PI * f * i / FS;
    re += L[a + i] * w * Math.cos(ph); im -= L[a + i] * w * Math.sin(ph);
  }
  return Math.hypot(re, im) * 2 / N;
}

const mode = process.argv[2] ?? 'all';
const outDir = 'out';

if (mode === 'note') {
  const note = Number(process.argv[3] ?? 60), vel = Number(process.argv[4] ?? 100);
  const e = new PrismEngine(FS);
  const [L, R] = render(e, 4, [
    { t: 0.05, fn: () => e.noteOn(note, vel) },
    { t: 2.0, fn: () => e.noteOff(note) },
  ]);
  stats(L, R, `note ${note} vel ${vel}:`);
  envelope(L, 0.1);
  writeWav(`${outDir}/note.wav`, L, R);
} else if (mode === 'preset') {
  const name = process.argv[3] ?? PRESETS[0].name;
  const pr = PRESETS.find((p) => p.name.toLowerCase().includes(name.toLowerCase()));
  if (!pr) throw new Error(`no preset matching "${name}"`);
  const e = new PrismEngine(FS);
  e.loadPreset(pr.values);
  const [L, R] = phrase(e, 9);
  stats(L, R, `${pr.name}:`);
  envelope(L);
  writeWav(`${outDir}/preset.wav`, L, R);
} else if (mode === 'bench') {
  // 8 voices of each preset named, plus the worst case: 3 oscillators × 16 unison, all re-synthesising every block
  const worst: Partial<Record<string, number>> = {
    o1Level: 0.8, o2Level: 0.8, o3Level: 0.8, o1Uni: 16, o2Uni: 16, o3Uni: 16, o1Table: 1, o2Table: 3, o3Table: 9,
    o1Warp: 6, o2Warp: 4, o3Warp: 2, o1Amt: 0.4, o2Amt: 0.3, o3Amt: 0.5, f2Type: 6, iAType: 1, iBType: 4,
    m1Src: 5, m1Dst: 2, m1Amt: 0.5, m2Src: 6, m2Dst: 8, m2Amt: 0.5, m3Src: 7, m3Dst: 14, m3Amt: 0.5, m4Src: 5, m4Dst: 3, m4Amt: 0.4,
    l1Rate: 3, l2Rate: 5, l3Rate: 7, dimMix: 0.5, chMix: 0.5, dlMix: 0.3, rvMix: 0.3, sqDepth: 0.5,
  };
  const cases: [string, Partial<Record<string, number>>][] = [['worst case', worst], ...PRESETS.filter((p) => process.argv.slice(3).some((a) => p.name.toLowerCase().includes(a.toLowerCase()))).map((p) => [p.name, p.values] as [string, Partial<Record<string, number>>])];
  for (const [name, values] of cases) {
    const e = new PrismEngine(FS);
    e.loadPreset(values as Record<string, number>);
    const chord = [36, 48, 55, 60, 64, 67, 72, 76];
    for (const n of chord) e.noteOn(n, 100);
    const L = new Float32Array(BLOCK), R = new Float32Array(BLOCK);
    const blocks = Math.floor(5 * FS / BLOCK);
    const t0 = performance.now();
    for (let i = 0; i < blocks; i++) e.process(L, R, BLOCK);
    const ms = performance.now() - t0;
    console.log(`rendered 5 s with ${chord.length} voices of "${name}" in ${ms.toFixed(0)} ms  => ${(ms / 5000 * 100).toFixed(1)}% of real time`);
  }
} else if (mode === 'spectrum') {
  // a raw saw (Basic, position 0.5) at a high note: harmonics, and the worst alias between them
  for (const note of [60, 84, 96, 108]) {
    const f0 = 440 * Math.pow(2, (note - 69) / 12);
    const e = new PrismEngine(FS);
    e.setParams({ o1Pos: 0.5, f1Type: 0, rvMix: 0, vel: 0, e1Atk: 0.001, e1Sus: 1 });
    const [L] = render(e, 1.2, [{ t: 0, fn: () => e.noteOn(note, 100) }]);
    const N = 16384, a = FS / 2;
    const h1 = mag(L, a, N, f0);
    const rows: string[] = [];
    for (let k = 1; k <= 4; k++) rows.push(`h${k} ${db(mag(L, a, N, k * f0) / h1).padStart(6)}`);
    let worst = -200;
    for (let k = 0; k < 6; k++) for (let f = f0 * (k + 0.1); f < f0 * (k + 0.9) && f < FS / 2; f += f0 * 0.02) if (f > 20) worst = Math.max(worst, 20 * Math.log10(mag(L, a, N, f) / h1));
    console.log(`note ${note} (${f0.toFixed(0)} Hz): ${rows.join('  ')}   worst between harmonics: ${worst.toFixed(1)} dB`);
  }
} else if (mode === 'levels') {
  // loudness of each preset's test phrase, and the gain that brings it to TARGET
  const TARGET = -15;
  const out: string[] = [];
  for (const pr of RAW_PRESETS) {
    if (pr.tag === 'init') continue;
    const e = new PrismEngine(FS);
    e.loadPreset(pr.values);
    const [L, R] = phrase(e, 8);
    // short-term loudness: the loudest 400 ms window (100 ms hop), so plucks and pads compare fairly
    const W = Math.round(0.4 * FS), HOP = Math.round(0.1 * FS);
    let best = 1e-12;
    for (let a = 0; a + W <= L.length; a += HOP) {
      let s2 = 0;
      for (let i = a; i < a + W; i++) s2 += L[i] * L[i] + R[i] * R[i];
      best = Math.max(best, s2 / (2 * W));
    }
    const rms = 10 * Math.log10(best);
    const g = Math.pow(10, (TARGET - rms) / 20);
    const base = pr.values.ampLevel ?? PARAM_BY_ID.ampLevel.def;
    const capped = base * g > 1.5;
    console.log(`${pr.name.padEnd(22)} ${rms.toFixed(1).padStart(6)} dB  gain ${g.toFixed(2)}${capped ? '  (capped at level 1.5)' : ''}`);
    out.push(`  ${JSON.stringify(pr.name)}: ${g.toFixed(3)},`);
  }
  writeFileSync('src/dsp/levels.gen.ts', `// Generated by \`node scripts/render.ts levels\`: per-preset gain that brings every\n// factory preset to the same loudness on the test phrase. Do not edit by hand.\n\nexport const LEVELS: Record<string, number> = {\n${out.join('\n')}\n};\n`);
  console.log(`wrote src/dsp/levels.gen.ts (${out.length} presets, target ${TARGET} dB short-term)`);
} else if (mode === 'hash') {
  // the matrix invariant: all 16 slots pointed somewhere at amount 0 must render bit-identically to none
  let bad = 0;
  for (const pr of PRESETS) {
    const run = (extra: Record<string, number>) => {
      const e = new PrismEngine(FS);
      e.loadPreset({ ...pr.values, ...extra } as Record<string, number>);
      const [L, R] = phrase(e, 3);
      let h = 2166136261;
      const u = new Uint32Array(L.buffer), v = new Uint32Array(R.buffer);
      for (let i = 0; i < u.length; i++) { h = Math.imul(h ^ u[i], 16777619); h = Math.imul(h ^ v[i], 16777619); }
      return h >>> 0;
    };
    const used = Array.from({ length: 16 }, (_, i) => i).filter((i) => (pr.values[`m${i + 1}Amt`] ?? 0) !== 0);
    const extra: Record<string, number> = {};
    for (let i = 0; i < 16; i++) if (!used.includes(i)) { extra[`m${i + 1}Src`] = 1 + (i % 20); extra[`m${i + 1}Dst`] = 1 + (i % 30); extra[`m${i + 1}Amt`] = 0; }
    const a = run({}), b = run(extra);
    if (a !== b) bad++;
    console.log(`${pr.name.padEnd(20)} ${a.toString(16).padStart(8, '0')} ${b.toString(16).padStart(8, '0')} ${a === b ? 'same' : 'DIFFERENT'}`);
  }
  if (bad) { console.error(`${bad} preset(s) change when unused slots are pointed somewhere`); process.exit(1); }
} else if (mode === 'raw') {
  // the same phrases as the default mode, unquantised, to compare against the C++ engine
  const dir = process.argv[3] ?? `${outDir}/ts`;
  mkdirSync(dir, { recursive: true });
  for (const pr of PRESETS) {
    const e = new PrismEngine(FS);
    e.loadPreset(pr.values);
    const [L, R] = phrase(e, 8);
    const inter = new Float32Array(L.length * 2);
    for (let i = 0; i < L.length; i++) { inter[2 * i] = L[i]; inter[2 * i + 1] = R[i]; }
    writeFileSync(`${dir}/${pr.name.toLowerCase().replace(/\s+/g, '-')}.f32`, new Uint8Array(inter.buffer));
  }
  console.log(`wrote ${PRESETS.length} presets to ${dir}`);
} else {
  let ok = true;
  for (const pr of PRESETS) {
    const e = new PrismEngine(FS);
    e.loadPreset(pr.values);
    const [L, R] = phrase(e, 8);
    ok = stats(L, R, pr.name.padEnd(18)) && ok;
    writeWav(`${outDir}/${pr.name.toLowerCase().replace(/\s+/g, '-')}.wav`, L, R);
  }
  if (!ok) { console.error('non-finite output!'); process.exit(1); }
}
