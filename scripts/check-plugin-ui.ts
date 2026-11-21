// Headless-Chrome check of the page in plugin mode: serves dist/, fakes the
// JUCE bridge (window.__JUCE__.backend) that the plugin's WebView injects,
// and plays the C++ side: sends the session state, host automation, host
// notes and meters, and checks what the page sends back. Screenshot to
// out/screenshot-plugin.png. Needs `npm run build` first.
//
//   node scripts/check-plugin-ui.ts

import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { readFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, extname } from 'node:path';

const CHROME = process.env.CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const PORT = 4174, DEBUG = 9334;
const MIME: Record<string, string> = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml' };

const server = createServer((req, res) => {
  let p = join('dist', decodeURIComponent((req.url ?? '/').split('?')[0]));
  if (!existsSync(p) || p.endsWith('/')) p = 'dist/index.html';
  res.setHeader('content-type', MIME[extname(p)] ?? 'application/octet-stream');
  res.end(readFileSync(p));
}).listen(PORT);

const chrome = spawn(CHROME, [
  '--headless=new', `--remote-debugging-port=${DEBUG}`, '--window-size=1360,880', '--hide-scrollbars',
  '--no-first-run', '--no-default-browser-check', '--user-data-dir=/tmp/ft-prism-chrome-plugin', 'about:blank',
], { stdio: 'ignore' });

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// What JUCE injects, reduced to the two calls the page uses. Everything the
// page emits is recorded in window.__sent; window.__toPage(msg) is the C++ side.
const FAKE_JUCE = `
  window.__sent = [];
  const listeners = new Map();
  window.__JUCE__ = { backend: {
    emitEvent: (id, payload) => window.__sent.push({ id, payload: JSON.parse(JSON.stringify(payload)) }),
    addEventListener: (id, fn) => { (listeners.get(id) ?? listeners.set(id, []).get(id)).push(fn); },
  } };
  window.__toPage = (msg) => (listeners.get('prism') ?? []).forEach((fn) => fn(msg));
`;

let failures = 0;
const check = (ok: boolean, what: string) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}`); if (!ok) failures++; };

async function main(): Promise<void> {
  let targets: { webSocketDebuggerUrl: string; type: string }[] = [];
  for (let i = 0; i < 50 && targets.length === 0; i++) {
    await sleep(200);
    try { targets = (await (await fetch(`http://127.0.0.1:${DEBUG}/json`)).json()).filter((t: { type: string }) => t.type === 'page'); } catch { /* not up yet */ }
  }
  if (targets.length === 0) throw new Error('chrome did not start');
  const ws = new WebSocket(targets[0].webSocketDebuggerUrl);
  await new Promise((r) => (ws.onopen = r));
  let id = 0;
  const pending = new Map<number, (v: unknown) => void>();
  const logs: string[] = [];
  ws.onmessage = (e) => {
    const m = JSON.parse(String(e.data));
    if (m.id && pending.has(m.id)) { pending.get(m.id)!(m.result ?? m.error); pending.delete(m.id); }
    else if (m.method === 'Runtime.consoleAPICalled') logs.push(`[${m.params.type}] ${m.params.args.map((a: { value?: unknown; description?: string }) => a.value ?? a.description).join(' ')}`);
    else if (m.method === 'Runtime.exceptionThrown') logs.push(`[exception] ${m.params.exceptionDetails.text} ${m.params.exceptionDetails.exception?.description ?? ''}`);
  };
  const send = (method: string, params: Record<string, unknown> = {}) => new Promise<unknown>((r) => { pending.set(++id, r); ws.send(JSON.stringify({ id, method, params })); });
  const evaluate = async (expression: string) => {
    const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }) as { result?: { value?: unknown }; exceptionDetails?: { text: string } };
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.text);
    return r.result?.value;
  };
  type Sent = { id: string; payload: { type: string; [k: string]: unknown } };
  const takeSent = async () => (await evaluate('window.__sent.splice(0)')) as Sent[];

  await send('Runtime.enable');
  await send('Page.enable');
  await send('Page.addScriptToEvaluateOnNewDocument', { source: FAKE_JUCE });
  await send('Page.navigate', { url: `http://127.0.0.1:${PORT}/` });
  await sleep(2000);

  // 1. the page asks for the state and loads nothing by itself
  let sent = await takeSent();
  check(sent.length === 1 && sent[0].payload.type === 'ready', `on open the page only asks for the state (sent: ${sent.map((s) => s.payload.type).join(', ')})`);
  check(await evaluate("document.documentElement.classList.contains('in-plugin')") === true, 'plugin mode is on');
  check(await evaluate("getComputedStyle(document.querySelector('.power-wrap')).display") === 'none', 'the power switch is hidden');

  // 2. the session state arrives: the sound, the preset name, your presets
  await evaluate(`window.__toPage({ type: 'state', values: { f1Cut: 555, f1Res: 0.4, rvMix: 0.7 }, preset: 'Polar Night', last: 'Polar Night',
    user: [{ name: 'Mine', values: { f1Cut: 300 }, macros: ['a', 'b', 'c', 'd'] }, { bogus: true }] })`);
  await sleep(200);
  sent = await takeSent();
  check(sent.every((s) => s.payload.type === 'current'), `the state is not echoed back as parameters (sent: ${sent.map((s) => s.payload.type).join(', ') || 'nothing'})`);
  check(await evaluate('window.__prism.values.f1Cut') === 555, 'the state sets the values');
  check(await evaluate("document.querySelector('#preset-name').textContent") === 'Polar Night', 'the header shows the session preset');
  check(await evaluate("document.querySelectorAll('#browser-list .card[data-tag=user]').length") === 1, 'your presets from the file are in the browser (the malformed one is dropped)');
  check(await evaluate("document.querySelector('#macros .knob .label').textContent") === 'darkness', 'the macro strip is named by the session preset');

  // 3. host automation moves a knob without being sent back
  await evaluate("window.__toPage({ type: 'params', values: { f1Cut: 1234, volume: 0.5 } })");
  await sleep(100);
  sent = await takeSent();
  check(sent.length === 0, 'automation is not echoed back');
  check(await evaluate('window.__prism.values.f1Cut') === 1234, 'automation updates the values');
  check(await evaluate("document.querySelector('#master').value") === '0.5', 'automation of the volume moves the master slider');

  // 4. loading a preset on the page sends the whole sound, then its name
  await evaluate("window.__prism.loadPreset('Iridescence')");
  sent = await takeSent();
  const preset = sent.find((s) => s.payload.type === 'preset');
  const current = sent.filter((s) => s.payload.type === 'current').pop();
  check(!!preset && (preset.payload.values as Record<string, number>).f1Cut === 5500, 'loading a preset sends its values');
  check(current?.payload.name === 'Iridescence', 'and its name, to keep with the session');

  // 5. a knob moved on the page becomes a parameter change and marks the sound edited
  // (the wheel: synthetic pointer drags can't take pointer capture)
  await evaluate("document.querySelector('.knob').dispatchEvent(new WheelEvent('wheel', { deltaY: -100, bubbles: true, cancelable: true }))");
  sent = await takeSent();
  check(sent.some((s) => s.payload.type === 'param'), `turning a knob sends a parameter (sent: ${sent.map((s) => s.payload.type).join(', ') || 'nothing'})`);
  check(sent.some((s) => s.payload.type === 'current' && s.payload.name === ''), 'and marks the sound edited');

  // 6. the on-screen keyboard plays through the plugin
  await evaluate("window.__prism.synth.noteOn(60, 100); window.__prism.synth.noteOff(60)");
  sent = await takeSent();
  check(sent.map((s) => s.payload.type).join(',') === 'noteOn,noteOff', 'notes from the page go to the plugin');

  // 7. host notes light the keys; meters, scope and the host tempo show up
  await evaluate(`window.__toPage({ type: 'notes', list: [[64, 100, 0], [67, 90, 2]] });
    window.__toPage({ type: 'stats', voices: 3, load: 0.042, peakL: 0.5, peakR: 0.4, tempo: 122, scope: Array.from({ length: 1024 }, (_, i) => Math.sin(i / 20) * 0.5), display: Array.from({ length: 24 }, () => 0.3) })`);
  await sleep(100);
  check(String(await evaluate("document.querySelector('#tempo')?.textContent")).includes('122 bpm'), 'the host tempo shows in the status line, beside the stop button');

  // 8. saving a sound goes to the plugin's file
  await evaluate('document.querySelector("#save").click()');
  await sleep(200);
  await evaluate('const n = document.querySelector("#save-name"); n.value = "Check Sound"; n.dispatchEvent(new Event("input")); document.querySelector("#savebar").requestSubmit()');
  sent = await takeSent();
  const save = sent.find((s) => s.payload.type === 'saveUser');
  check(!!save && (save.payload.presets as { name: string }[]).map((p) => p.name).join(',') === 'Check Sound,Mine', 'saving writes your presets through the plugin');

  // 9. the host swaps the whole state (its preset menu, a session load)
  await evaluate("window.__toPage({ type: 'state', values: { f1Cut: 4000 }, preset: '', last: 'Iridescence', user: [] })");
  await sleep(100);
  check(await evaluate("document.querySelector('#preset-tag').textContent") === 'edited', 'an edited session shows as edited');
  check(await evaluate("document.querySelector('#preset-name').textContent") === 'Iridescence', 'under the name it came from');

  await evaluate("document.querySelector('#browser-close').click()");
  await sleep(300);
  mkdirSync('out', { recursive: true });
  const shot = await send('Page.captureScreenshot', { format: 'png' }) as { data: string };
  writeFileSync('out/screenshot-plugin.png', Buffer.from(shot.data, 'base64'));
  console.log('wrote out/screenshot-plugin.png');

  // 10. a laptop-sized window: every tab is shown whole, scaled to fit, and the keyboard is in view
  await send('Emulation.setDeviceMetricsOverride', { width: 1296, height: 740, deviceScaleFactor: 1, mobile: false });
  const tabs = await evaluate("document.querySelectorAll('#tabs .tab').length") as number;
  for (let t = tabs - 1; t >= 0; t--) {
    await evaluate(`document.querySelectorAll('#tabs .tab')[${t}].click(); scrollTo(0, 0)`);
    await sleep(500);
    const [right, bottom, w, h] = await evaluate(`(() => { const r = document.querySelector('#app').getBoundingClientRect();
      return [r.right, r.bottom, innerWidth, innerHeight]; })()`) as number[];
    check(right <= w + 1 && bottom <= h + 1, `at 1296x740 tab ${t + 1} fits the window (${Math.round(right)}x${Math.round(bottom)} in ${w}x${h})`);
  }
  const kb = await evaluate("(() => { const r = document.querySelector('#keyboard').getBoundingClientRect(); return [r.top, r.bottom, innerHeight]; })()") as number[];
  check(kb[0] >= 0 && kb[1] <= kb[2] + 1, `the keyboard is in view (${Math.round(kb[0])}–${Math.round(kb[1])} of ${kb[2]})`);
  const small = await send('Page.captureScreenshot', { format: 'png' }) as { data: string };
  writeFileSync('out/screenshot-plugin-small.png', Buffer.from(small.data, 'base64'));
  console.log('wrote out/screenshot-plugin-small.png');

  const errors = logs.filter((l) => l.startsWith('[error]') || l.startsWith('[exception]'));
  for (const l of errors) console.log('  console', l);
  check(errors.length === 0, 'no console errors');
  if (failures) process.exitCode = 1;
  ws.close();
}

main().catch((e) => { console.error(e); process.exitCode = 1; }).finally(() => { chrome.kill(); server.close(); });
