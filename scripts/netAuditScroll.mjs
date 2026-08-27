/**
 * Does turning a page keep the scroll position?
 *
 * `net:audit` counts requests; this watches one number the counts cannot see. A paged list whose
 * rows unmount for the length of a round trip collapses the scroll container, and the browser then
 * clamps `scrollTop` to the new (tiny) maximum — so the page snaps to the very top and the pager's
 * own scroll-to-the-list is undone. It is a data-layer bug that only shows up as a scroll bug,
 * which is exactly the kind this file exists to catch.
 *
 * It samples the scroller's height and offset across a page turn and fails if the content ever
 * empties. `node scripts/netAuditScroll.mjs`.
 */

import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { createServer as createHttpServer } from 'node:http';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { stubFor } from './netAuditFixtures.mjs';

const ROOT = path.resolve(import.meta.dirname, '..');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const freePort = () =>
  new Promise((resolve, reject) => {
    const s = createServer();
    s.on('error', reject);
    s.listen(0, '127.0.0.1', () => {
      const { port } = s.address();
      s.close(() => resolve(port));
    });
  });

const appPort = await freePort();
const debugPort = await freePort();
const upstreamPort = await freePort();
const profileDir = mkdtempSync(path.join(tmpdir(), 'picpony-scroll-'));

const upstream = createHttpServer((req, res) => {
  const stub = stubFor(`http://127.0.0.1:${upstreamPort}${req.url}`);
  if (!stub) return res.writeHead(404).end();
  res.writeHead(200, { 'content-type': stub.contentType, 'cache-control': 'no-store' });
  res.end(stub.binary ? Buffer.from(stub.body, 'base64') : stub.body);
});
await new Promise((r) => upstream.listen(upstreamPort, '127.0.0.1', r));

const server = spawn(
  process.execPath,
  [path.join(ROOT, 'node_modules', 'next', 'dist', 'bin', 'next'), 'start', '-p', String(appPort)],
  {
    cwd: ROOT,
    stdio: 'ignore',
    env: { ...process.env, PICPONY_UPSTREAM_ORIGIN: `http://127.0.0.1:${upstreamPort}` },
  },
);
const edge = [
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
].find((c) => existsSync(c));
const browser = spawn(
  edge,
  [
    '--headless=new',
    '--disable-gpu',
    `--remote-debugging-port=${debugPort}`,
    `--user-data-dir=${profileDir}`,
    '--window-size=1440,900',
    '--no-first-run',
    'about:blank',
  ],
  { stdio: 'ignore' },
);

let socket;
let failed = false;
process.on('exit', () => {
  socket?.close();
  browser.kill();
  server.kill();
  upstream.close();
  try {
    rmSync(profileDir, { recursive: true, force: true });
  } catch {
    /* Windows holds the profile briefly. */
  }
});

const origin = `http://127.0.0.1:${appPort}`;
for (let i = 0; i < 150; i += 1) {
  try {
    if ((await fetch(`${origin}/policy`)).status < 500) break;
  } catch {
    /* not up */
  }
  await sleep(200);
}
let wsUrl = null;
for (let i = 0; i < 150 && !wsUrl; i += 1) {
  try {
    const list = await (await fetch(`http://127.0.0.1:${debugPort}/json/list`)).json();
    wsUrl = list.find((t) => t.type === 'page')?.webSocketDebuggerUrl ?? null;
  } catch {
    /* not up */
  }
  if (!wsUrl) await sleep(200);
}

socket = new WebSocket(wsUrl);
await new Promise((r) => socket.addEventListener('open', r, { once: true }));
let id = 1;
const pending = new Map();
socket.addEventListener('message', (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pending.has(m.id)) {
    if (m.error) console.error(`CDP ${pending.get(m.id).method}: ${m.error.message}`);
    pending.get(m.id).resolve(m.result);
    pending.delete(m.id);
  }
});
const send = (method, params = {}) =>
  new Promise((resolve) => {
    const n = id++;
    pending.set(n, { resolve, method });
    socket.send(JSON.stringify({ id: n, method, params }));
  });
const evaluate = async (expression) =>
  (await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }))?.result
    ?.value;

await send('Page.enable');
socket.addEventListener('message', async (e) => {
  const m = JSON.parse(e.data);
  if (m.method !== 'Fetch.requestPaused') return;
  const { requestId, request } = m.params;
  const stub = stubFor(request.url);
  if (!stub) return void send('Fetch.continueRequest', { requestId });
  await send('Fetch.fulfillRequest', {
    requestId,
    responseCode: 200,
    responseHeaders: [
      { name: 'content-type', value: stub.contentType },
      { name: 'cache-control', value: 'no-store' },
      { name: 'access-control-allow-origin', value: '*' },
    ],
    body: stub.binary ? stub.body : Buffer.from(stub.body, 'utf8').toString('base64'),
  });
});
await send('Fetch.enable', { patterns: [{ urlPattern: '*' }] });
await send('Emulation.setDeviceMetricsOverride', {
  width: 1440,
  height: 900,
  deviceScaleFactor: 1,
  mobile: false,
});
/* The motion tier is pinned because headless Edge reports `prefers-reduced-motion: reduce`, and the
   scroll animation this measures is gated on it. */
await send('Page.addScriptToEvaluateOnNewDocument', {
  source: `try{localStorage.setItem('picpony_motion','standard')}catch(e){}`,
});
await send('Page.navigate', { url: origin });
await sleep(5000);

const cardCount = `document.querySelectorAll('[data-image-hero-role="thumbnail"]').length`;
const scroller = `document.querySelector('.app-scroller')`;

const before = await evaluate(`(() => {
  const s = ${scroller};
  s.scrollTop = 1200;
  return { cards: ${cardCount}, height: s.scrollHeight, top: s.scrollTop };
})()`);
console.log(`before  cards ${before.cards}  scrollHeight ${before.height}  scrollTop ${before.top}`);

/* Sampled every frame across the turn. One empty frame is the whole bug: the grid unmounting for a
   single commit is enough for the browser to clamp the offset, and by the time anything settles the
   evidence is gone. */
await evaluate(`(() => {
  window.__samples = [];
  const s = ${scroller};
  const tick = () => {
    window.__samples.push({ cards: ${cardCount}, height: s.scrollHeight, top: s.scrollTop });
    if (window.__samples.length < 90) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
  const next = [...document.querySelectorAll('button')].find((b) => b.getAttribute('aria-label') === '下一页');
  next.click();
  return true;
})()`);
await sleep(2500);

const samples = await evaluate('window.__samples');
const minCards = Math.min(...samples.map((s) => s.cards));
const minHeight = Math.min(...samples.map((s) => s.height));
const after = samples[samples.length - 1];
console.log(
  `during  min cards ${minCards}  min scrollHeight ${minHeight}\n` +
    `after   cards ${after.cards}  scrollHeight ${after.height}  scrollTop ${after.top}`,
);

if (minCards === 0) {
  console.error('\nFAIL: the grid emptied during the page turn — the scroller will collapse');
  failed = true;
}
if (after.cards === 0) {
  console.error('\nFAIL: no cards after the turn');
  failed = true;
}
console.log(failed ? '' : '\nthe grid never emptied; the scroller kept its height');
process.exit(failed ? 1 : 0);
