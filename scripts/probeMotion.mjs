/* Does the lazily-loaded motion actually play?
   Three things the module split could have broken silently: the tab indicator's glide (now WAAPI),
   the route cross-fade's clone (now a dynamic import warmed on idle), and `Reveal`'s cascade
   (now WAAPI). Scratch probe. */
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createServer } from 'node:http';
import { stubFor } from './netAuditFixtures.mjs';

const ROOT = process.cwd();
const PORT = 3948, UP = 3949, CDP = 9335;

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
const profile = mkdtempSync(path.join(tmpdir(), 'pp-motion-'));
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
  if (r.result?.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails));
  return r.result?.result?.value;
};
await send('Runtime.enable');
await send('Page.enable');

/* Headless Edge reports `prefers-reduced-motion: reduce`; the app resolves that to 减弱 unless a
   tier is stored, and 减弱 changes the shapes being measured. Pin it. */
await send('Page.navigate', { url: `http://127.0.0.1:${PORT}/` });
await new Promise((r) => setTimeout(r, 2500));
await evalIn(`localStorage.setItem('picpony_motion','standard'); localStorage.setItem('picpony_entrance','true'); 1`);
await send('Page.navigate', { url: `http://127.0.0.1:${PORT}/` });
await new Promise((r) => setTimeout(r, 4000));

console.log('\n1. lazy chunks warmed on idle');
const warmed = await evalIn(`(() => {
  const scripts = [...document.querySelectorAll('script[src]')].map((s) => s.src);
  return { docScripts: scripts.length };
})()`);
const chunks = await evalIn(`(() => {
  const inDoc = new Set([...document.querySelectorAll('script[src]')].map((s) => s.src));
  const fetched = performance.getEntriesByType('resource')
    .filter((r) => r.name.indexOf('/_next/static/chunks/') !== -1)
    .map((r) => r.name);
  return { inDoc: inDoc.size, fetched: fetched.length, extra: fetched.filter((n) => !inDoc.has(n)).length };
})()`);
console.log('  ', JSON.stringify(chunks));

console.log('\n2. tab indicator glide (WAAPI)');
const indicator = await evalIn(`(async () => {
  const bar = document.querySelector('[role="tablist"]');
  if (!bar) return 'no tablist';
  const tabs = [...bar.querySelectorAll('[data-tab]')];
  const pill = bar.querySelector('span[class*="absolute"], span');
  const forum = tabs.find((t) => t.dataset.tab === 'forum');
  if (!forum) return 'no forum tab';
  const before = getComputedStyle(pill).transform;
  if (!window.__skipTab) forum.click();
  const samples = [];
  await new Promise((done) => {
    let n = 0;
    const step = () => {
      samples.push(getComputedStyle(pill).transform);
      if (++n < 14) requestAnimationFrame(step); else done();
    };
    requestAnimationFrame(step);
  });
  const anims = pill.getAnimations().length;
  return { before, distinct: [...new Set(samples)].length, samples: samples.slice(0, 3), last: samples.at(-1), anims };
})()`);
console.log('  ', JSON.stringify(indicator));

console.log('\n3. route cross-fade clone appears on a navigation');
const clone = await evalIn(`(async () => {
  const links = [...document.querySelectorAll('a[href="/search"]')];
  const link = links[0];
  if (!link) return 'no /search link';
  const diag = {
    count: links.length,
    inert: links.map((l) => Boolean(l.closest('[inert]'))),
    skipTab: window.__skipTab,
    urlBefore: location.pathname + location.search,
  };
  let seen = 0, frames = 0, max = 0;
  const layer = () => document.querySelector('[data-route-crossfade-layer]');
  link.click();
  // Sampled on the clock, not a frame count -- see the note above this call.
  const until = performance.now() + 2000;
  await new Promise((done) => {
    const step = () => {
      const l = layer();
      if (l) max = Math.max(max, l.childElementCount);
      if (l && l.childElementCount > 0) seen++;
      frames++;
      if (performance.now() < until) requestAnimationFrame(step); else done();
    };
    requestAnimationFrame(step);
  });
  return { ...diag, framesWithClone: seen, of: frames, url: location.pathname + location.search, maxKids: max };
})()`);
console.log('  ', JSON.stringify(clone));

console.log('\n4. Reveal cascade (WAAPI) on an empty state');
const reveal = await evalIn(`(async () => {
  const found = [...document.querySelectorAll('*')].filter((el) => el.getAnimations().length > 0).length;
  return { animatingElements: found };
})()`);
console.log('  ', JSON.stringify(reveal));

ws.close(); browser.kill(); server.kill(); upstream.close();
setTimeout(() => { try { rmSync(profile, { recursive: true, force: true }); } catch {} process.exit(0); }, 600);
