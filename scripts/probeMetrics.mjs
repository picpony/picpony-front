/* Main-thread cost of a cold home load and a tab switch, from `Performance.getMetrics` deltas.
   If these numbers do not move, the React Compiler bailed and the risk was taken for nothing.
   Median of N runs, because a single run is noise. */
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createServer } from 'node:http';
import { stubFor } from './netAuditFixtures.mjs';

const ROOT = process.cwd();
const PORT = 3952, UP = 3953, CDP = 9339;
const RUNS = Number(process.argv[2] ?? 5);

const upstream = createServer((req, res) => {
  const asUpstream = req.url?.startsWith('/api/v1/json')
    ? `https://trixiebooru.org${req.url}`
    : `http://127.0.0.1:${UP}${req.url}`;
  const stub = stubFor(asUpstream);
  if (!stub) return void res.writeHead(404).end();
  res.writeHead(200, { 'content-type': stub.contentType, 'cache-control': 'no-store' });
  res.end(stub.binary ? Buffer.from(stub.body, 'base64') : stub.body);
});
await new Promise((r) => upstream.listen(UP, '127.0.0.1', r));

const NEXT_BIN = path.join(ROOT, 'node_modules', 'next', 'dist', 'bin', 'next');
const server = spawn(process.execPath, [NEXT_BIN, 'start', '-p', String(PORT)], {
  cwd: ROOT, stdio: 'ignore',
  env: { ...process.env,
    PICPONY_UPSTREAM_ORIGIN: `http://127.0.0.1:${UP}`,
    PICPONY_DERPI_ORIGIN: `http://127.0.0.1:${UP}/api/v1/json` },
});
const until = async (fn, ms = 40000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) { try { if (await fn()) return true; } catch {} await new Promise((r) => setTimeout(r, 200)); }
  return false;
};
if (!(await until(() => fetch(`http://127.0.0.1:${PORT}/`).then((r) => r.ok)))) throw new Error('no server');

const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const profile = mkdtempSync(path.join(tmpdir(), 'pp-metrics-'));
const browser = spawn(EDGE, ['--headless=new', '--disable-gpu', `--remote-debugging-port=${CDP}`,
  `--user-data-dir=${profile}`, '--window-size=1440,900', '--no-first-run', 'about:blank'], { stdio: 'ignore' });

let page;
if (!(await until(async () => {
  const list = await (await fetch(`http://127.0.0.1:${CDP}/json/list`)).json();
  page = list.find((t) => t.type === 'page');
  return Boolean(page);
}))) throw new Error('no cdp');

const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((r) => (ws.onopen = r));
let id = 0;
const pending = new Map();
ws.onmessage = (m) => {
  const msg = JSON.parse(m.data);
  if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); }
};
const send = (method, params = {}) =>
  new Promise((r) => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
const evalIn = async (expr) => {
  const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
  return r.result?.result?.value;
};
const metrics = async () => {
  const r = await send('Performance.getMetrics');
  return Object.fromEntries(r.result.metrics.map((m) => [m.name, m.value]));
};
await send('Runtime.enable');
await send('Page.enable');
await send('Performance.enable');

const KEYS = ['ScriptDuration', 'RecalcStyleDuration', 'LayoutDuration', 'TaskDuration', 'RecalcStyleCount', 'LayoutCount'];
const load = [], tab = [];

/* The service worker would make run 2 onwards a different measurement from run 1. */await send('Page.navigate', { url: `http://127.0.0.1:${PORT}/` });
await new Promise((r) => setTimeout(r, 3000));
await evalIn(`(async () => {
  const rs = await navigator.serviceWorker.getRegistrations();
  await Promise.all(rs.map((r) => r.unregister()));
  const keys = await caches.keys();
  await Promise.all(keys.map((k) => caches.delete(k)));
  localStorage.setItem('picpony_motion', 'standard');
  return 1;
})()`);

for (let run = 0; run < RUNS; run += 1) {
  await send('Page.navigate', { url: 'about:blank' });
  await new Promise((r) => setTimeout(r, 400));
  const before = await metrics();
  await send('Page.navigate', { url: `http://127.0.0.1:${PORT}/` });
  await new Promise((r) => setTimeout(r, 5000));
  const afterLoad = await metrics();
  load.push(Object.fromEntries(KEYS.map((k) => [k, afterLoad[k] - before[k]])));

  await evalIn(`(() => {
    const t = [...document.querySelectorAll('[role="tablist"] [data-tab]')].find((e) => e.dataset.tab === 'forum');
    if (t) t.click();
    return 1;
  })()`);
  await new Promise((r) => setTimeout(r, 2500));
  const afterTab = await metrics();
  tab.push(Object.fromEntries(KEYS.map((k) => [k, afterTab[k] - afterLoad[k]])));
}

const median = (xs) => { const s = [...xs].sort((a, b) => a - b); return s[Math.floor(s.length / 2)]; };
const report = (label, rows) => {
  console.log(`\n${label}  (median of ${RUNS})`);
  for (const k of KEYS) {
    const v = median(rows.map((r) => r[k]));
    console.log(`  ${k.padEnd(22)} ${k.endsWith('Count') ? v : v.toFixed(3) + 's'}`);
  }
};
report('cold load of /', load);
report('tab switch 图库 -> 论坛', tab);

ws.close(); browser.kill(); server.kill(); upstream.close();
setTimeout(() => { try { rmSync(profile, { recursive: true, force: true }); } catch {} process.exit(0); }, 600);
