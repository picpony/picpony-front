/* Samples a ripple's computed opacity per frame across a press. */
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createServer } from 'node:http';
import { stubFor } from './netAuditFixtures.mjs';

const ROOT = process.cwd();
const PORT = 3954, UP = 3955, CDP = 9341;

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
const profile = mkdtempSync(path.join(tmpdir(), 'pp-ripple-'));
const browser = spawn(EDGE, ['--headless=new', '--disable-gpu', `--remote-debugging-port=${CDP}`,
  `--user-data-dir=${profile}`, '--window-size=1280,900', '--no-first-run', 'about:blank'], { stdio: 'ignore' });

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
  if (r.result?.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails).slice(0, 300));
  return r.result?.result?.value;
};
await send('Runtime.enable');
await send('Page.enable');

await send('Page.navigate', { url: `http://127.0.0.1:${PORT}/policy` });
await new Promise((r) => setTimeout(r, 2500));
await evalIn(`localStorage.setItem('picpony_motion','standard'); 1`);
await send('Page.navigate', { url: `http://127.0.0.1:${PORT}/policy` });
await new Promise((r) => setTimeout(r, 4000));

const out = await evalIn(`(async () => {
  const target = document.querySelector('[data-ripple]');
  if (!target) return 'no [data-ripple] on this screen';
  const r = target.getBoundingClientRect();
  const opts = { bubbles: true, cancelable: true, clientX: r.left + r.width / 2, clientY: r.top + r.height / 2, pointerId: 1, isPrimary: true, button: 0 };
  target.dispatchEvent(new PointerEvent('pointerdown', opts));
  const css = getComputedStyle(document.querySelector('.ripple') || target).opacity;
  const samples = [];
  const t0 = performance.now();
  await new Promise((done) => {
    const step = () => {
      const el = document.querySelector('.ripple');
      samples.push([Math.round(performance.now() - t0), el ? Number(getComputedStyle(el).opacity).toFixed(3) : 'gone']);
      if (performance.now() - t0 < 700) requestAnimationFrame(step); else done();
    };
    requestAnimationFrame(step);
  });
  target.dispatchEvent(new PointerEvent('pointerup', opts));
  return { cssOpacityAtStart: css, samples: samples.filter((s, i) => i % 2 === 0) };
})()`);

if (typeof out === 'string') { console.log(out); }
else {
  console.log('css opacity at spawn:', out.cssOpacityAtStart);
  console.log('ms:opacity  ' + out.samples.map(([t, o]) => t + ':' + o).join('  '));
  const nums = out.samples.map(([, o]) => (o === 'gone' ? null : Number(o))).filter((n) => n !== null);
  console.log('peak opacity:', Math.max(...nums));
}

ws.close(); browser.kill(); server.kill(); upstream.close();
setTimeout(() => { try { rmSync(profile, { recursive: true, force: true }); } catch {} process.exit(0); }, 500);
