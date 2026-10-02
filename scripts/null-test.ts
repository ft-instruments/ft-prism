// Null test: the C++ engine (plugin/) against the TS engine (src/dsp/).
// Renders every preset with both, subtracts, and reports the worst
// difference per preset relative to the preset's own peak.
//
//   node scripts/null-test.ts            (builds the C++ renderer with clang++)
//
// The two engines use different libm implementations (V8 vs the platform's),
// so they agree to rounding rather than bit for bit; anything under about
// -80 dB is rounding, anything near 0 dB is a porting bug.
//
// Two presets sit where a last-bit difference decides something discrete,
// so they are held to -60 dB instead (each was checked: with the named
// feature off, the preset nulls to rounding; see KNOWN below).

import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, readdirSync } from 'node:fs';

const KNOWN: Record<string, string> = {
  // the crusher quantises: a sample on a step boundary rounds the other way
  'glitch-steps': 'insert B crush (with its mix at 0: -104 dB)',
  // Steps partials flip sign between frames (a phase jump of exactly pi), and
  // spectral morph's shortest-way phase blend is then a tie that the last bit
  // of atan2 decides (with blend morph, or another table: -140 dB)
  'hologram': 'spectral morph across the Steps table (with blend morph: -140 dB)',
};

const tsDir = 'out/ts', cppDir = 'out/cpp', bin = 'out/prism-render';
mkdirSync(tsDir, { recursive: true });
mkdirSync(cppDir, { recursive: true });

execFileSync('clang++', ['-std=c++17', '-O2', '-ffp-contract=off', '-o', bin, 'plugin/Tools/render.cpp'], { stdio: 'inherit' });
execFileSync(bin, [cppDir], { stdio: 'inherit' });
execFileSync('node', ['scripts/render.ts', 'raw', tsDir], { stdio: 'inherit' });

const read = (p: string) => { const b = readFileSync(p); return new Float32Array(b.buffer, b.byteOffset, b.byteLength / 4); };
const db = (x: number) => 20 * Math.log10(Math.max(1e-12, x));

let worst = -Infinity, worstKnown = -Infinity;
const rows: { name: string; diff: number; peak: number; at: number }[] = [];
for (const f of readdirSync(tsDir).filter((f) => f.endsWith('.f32')).sort()) {
  const a = read(`${tsDir}/${f}`), b = read(`${cppDir}/${f}`);
  if (a.length !== b.length) { rows.push({ name: f, diff: Infinity, peak: 0, at: -1 }); continue; }
  let peak = 0, diff = 0, at = -1;
  for (let i = 0; i < a.length; i++) {
    peak = Math.max(peak, Math.abs(a[i]));
    const d = Math.abs(a[i] - b[i]);
    if (d > diff) { diff = d; at = i; }
  }
  const rel = db(diff) - db(peak);
  const name = f.replace(/\.f32$/, '');
  if (KNOWN[name]) worstKnown = Math.max(worstKnown, rel); else worst = Math.max(worst, rel);
  rows.push({ name: f.replace(/\.f32$/, ''), diff: rel, peak: db(peak), at: at >= 0 ? (at >> 1) / 48000 : -1 });
}
rows.sort((x, y) => y.diff - x.diff);
for (const r of rows) {
  console.log(`${r.name.padEnd(22)} diff ${Number.isFinite(r.diff) ? r.diff.toFixed(1).padStart(7) + ' dB' : '  length mismatch'}  (peak ${r.peak.toFixed(1)} dBFS${r.at >= 0 ? `, worst at ${r.at.toFixed(3)} s` : ''})${KNOWN[r.name] ? `  known: ${KNOWN[r.name]}` : ''}`);
}
const known = Object.keys(KNOWN).length;
console.log(`\nworst: ${worst.toFixed(1)} dB relative to peak over ${rows.length - known} presets (limit -80); known exceptions ${worstKnown.toFixed(1)} dB (limit -60)`);
process.exitCode = worst < -80 && worstKnown < -60 ? 0 : 1;
