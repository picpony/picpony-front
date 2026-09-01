/* Does the service worker do what it claims? Registers `sw.js` by hand (the app's own
   registration opts out under `navigator.webdriver`, which is exactly what CDP sets), then checks
   four things: static chunks served from the worker on a reload, `/api.php` and `/relay` never
   cached, an offline hard-navigation landing on `/offline`, and the cache key set. Scratch probe. */
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createServer } from 'node:http';
import { stubFor } from './netAuditFixtures.mjs';

const ROOT = process.cwd();
const PORT = 3950, UP = 3951, CDP = 9337;

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
const profile = mkdtempSync(path.join(tmpdir(), 'pp-sw-'));
const browser = spawn(EDGE, ['--headless=new', '--disable-gpu', `--remote-debugging-port=${CDP}`,
  `--user-data-dir=${profile}`, '--no-first-run', 'about:blank'], { stdio: 'ignore' });

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
  if (r.result?.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails).slice(0, 400));
  return r.result?.result?.value;
};
await send('Runtime.enable');
await send('Page.enable');
await send('Network.enable');

await send('Page.navigate', { url: `http://127.0.0.1:${PORT}/policy` });
await new Promise((r) => setTimeout(r, 3500));

console.log('\n1. register + activate');
/* The app registers it itself: `navigator.webdriver` is false in a plain headless Edge driven
   over CDP, so `ServiceWorker.tsx`'s opt-out does not fire and what is tested is what ships. A
   second `register()` here would install a rival worker and the counts below would measure the
   probe. */
const reg = await evalIn(`(async () => {
  const r = await navigator.serviceWorker.ready;
  return { scope: r.scope, active: Boolean(r.active), waiting: Boolean(r.waiting) };
})()`);
console.log('  ', JSON.stringify(reg));

/* No `clients.claim()` by design, so this page is uncontrolled. Reload to get a controlled one. */
await send('Page.navigate', { url: `http://127.0.0.1:${PORT}/policy` });
await new Promise((r) => setTimeout(r, 3500));
await send('Page.navigate', { url: `http://127.0.0.1:${PORT}/policy` });
await new Promise((r) => setTimeout(r, 4000));

console.log('\n2. controlled');
const served = await evalIn(`(() => ({
  controlled: Boolean(navigator.serviceWorker.controller),
  chunks: performance.getEntriesByType('resource').filter((r) => r.name.indexOf('/_next/static/') !== -1).length,
}))()`);
console.log('  ', JSON.stringify(served));

console.log('\n3. what is in the caches (nothing sensitive may appear)');
const cached = await evalIn(`(async () => {
  const names = await caches.keys();
  const out = {};
  for (const n of names) {
    const keys = await (await caches.open(n)).keys();
    out[n] = keys.map((r) => new URL(r.url).pathname);
  }
  const all = Object.values(out).flat();
  return {
    names,
    counts: Object.fromEntries(Object.entries(out).map(([k, v]) => [k, v.length])),
    hasApiPhp: all.some((p) => p.indexOf('/api.php') === 0),
    hasRelay: all.some((p) => p === '/relay'),
    hasSearchApi: all.some((p) => p.indexOf('/search-api/') === 0),
    hasDocument: all.some((p) => p === '/policy' || p === '/'),
    hasOffline: all.some((p) => p === '/offline.html'),
  };
})()`);
console.log('  ', JSON.stringify(cached));

/* **The server is stopped rather than the network emulated.** `Network.emulateNetworkConditions`
   is scoped to the page target and does not reach the service worker's own thread, so the
   worker's `fetch()` kept succeeding and the first version of this probe reported the app
   rendering normally "offline". Killing the origin is the only thing that fails a fetch made
   from inside the worker. */
console.log('\n4. origin gone: chunks still load, navigation lands on the offline file');
server.kill();
await new Promise((r) => setTimeout(r, 1500));
await send('Page.navigate', { url: `http://127.0.0.1:${PORT}/tasks` });
await new Promise((r) => setTimeout(r, 4000));
const offline = await evalIn(`(() => ({
  url: location.pathname,
  heading: (document.querySelector('h1')?.textContent || '').trim(),
  scripts: document.querySelectorAll('script[src]').length,
}))()`);
console.log('  ', JSON.stringify(offline));

ws.close(); browser.kill(); upstream.close();
setTimeout(() => { try { rmSync(profile, { recursive: true, force: true }); } catch {} process.exit(0); }, 600);
