/**
 * A screenshot of one route against the audit's fixtures.
 *
 * `net:audit` counts requests and says nothing about whether anything rendered — its first
 * version made every screen stop fetching and reported it as an improvement, and a floor only
 * proves a request left, not that the answer reached the screen.
 *
 * Shares the audit's server, fixtures and browser setup:
 * `node scripts/netAuditShot.mjs /user/1 out.png`.
 */

import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { createServer as createHttpServer } from 'node:http';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { stubFor } from './netAuditFixtures.mjs';

const ROOT = path.resolve(import.meta.dirname, '..');
const route = process.argv[2] ?? '/';
const outPath = path.resolve(process.argv[3] ?? path.join(tmpdir(), 'picpony-shot.png'));
const authed = process.argv.includes('--auth');

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
const profileDir = mkdtempSync(path.join(tmpdir(), 'picpony-shot-'));

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
    '--window-size=1440,1400',
    '--no-first-run',
    'about:blank',
  ],
  { stdio: 'ignore' },
);

let socket;
process.on('exit', () => {
  socket?.close();
  browser.kill();
  server.kill();
  upstream.close();
  try {
    rmSync(profileDir, { recursive: true, force: true });
  } catch {
    /* Windows holds the profile briefly; it is in the temp dir either way. */
  }
});

const origin = `http://127.0.0.1:${appPort}`;
for (let i = 0; i < 100; i += 1) {
  try {
    if ((await fetch(`${origin}/policy`)).status < 500) break;
  } catch {
    /* not up */
  }
  await sleep(200);
}
let wsUrl = null;
for (let i = 0; i < 100 && !wsUrl; i += 1) {
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
    /* Errors surfaced, not swallowed: resolving a failed command with `undefined` is how this
       script spent three runs reporting a navigation CDP had rejected outright. */
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

await send('Page.enable');
/* Browser requests stubbed the way `net:audit` stubs them. Without this the shot is taken
   against the live upstream (9s per request here) — a screenshot of whatever arrived in time. */
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
  height: 1400,
  deviceScaleFactor: 1,
  mobile: false,
});
/* One navigation, and preferences seeded via `Page.addScriptToEvaluateOnNewDocument`. The
   two-step form `net:audit` uses (load a throwaway page, write prefs, navigate) quietly fails
   here: the second `Page.navigate` returned no error and never committed, so the shot was of the
   warm-up page. One navigation cannot do that. */
await send('Page.addScriptToEvaluateOnNewDocument', {
  source: `try{localStorage.setItem('picpony_motion','standard');${
    authed
      ? `localStorage.setItem('user_info', ${JSON.stringify(
          JSON.stringify({ token: 'shot', id: 1, username: 'fixture', api_key: 'k', role: 'user' }),
        )});`
      : ''
  }}catch(e){}`,
});
const nav = await send('Page.navigate', { url: `${origin}${route}` });
if (nav?.errorText) console.error(`navigate failed: ${nav.errorText}`);
await sleep(5000);
/* Printed rather than assumed, for the reason above. */const where = await send('Runtime.evaluate', {
  expression: 'location.pathname + " | " + document.title',
  returnByValue: true,
});
const shot = await send('Page.captureScreenshot', { format: 'png' });
writeFileSync(outPath, Buffer.from(shot.data, 'base64'));
console.log(`${where.result?.value ?? '?'}\n${outPath}`);
process.exit(0);
