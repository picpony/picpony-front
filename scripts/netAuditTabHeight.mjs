/**
 * Where does a tab switch leave the page?
 *
 * Two things, and the second is the one that bit. The panel is a grid with both home panes in one
 * cell — which is what lets both be on screen for the shared-axis slide — and the inactive one has
 * to fall out of layout at settle so the panel measures the *visible* pane. That part was already
 * right.
 *
 * What was wrong is the offset. A tab with no remembered scroll position used to keep the outgoing
 * tab's, and the browser then clamped it to the shorter pane's maximum: leaving the gallery at
 * 1500 for a 1708px-tall forum landed at 1160, which *is* that forum's maximum — so the forum
 * opened on its last row. `applyTabScroll`'s fallback is the fix and this is the check.
 *
 * `node scripts/netAuditTabHeight.mjs`
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
const profileDir = mkdtempSync(path.join(tmpdir(), 'picpony-tabh-'));

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
await send('Page.addScriptToEvaluateOnNewDocument', {
  source: `try{localStorage.setItem('picpony_motion','standard')}catch(e){}`,
});
await send('Page.navigate', { url: origin });
await sleep(6000);

const probe = `(() => {
  const panel = document.querySelector('[data-tab-panel]');
  const scroller = document.querySelector('.app-scroller');
  const panes = [...document.querySelectorAll('[data-tab-pane]')].map((p) => ({
    name: p.getAttribute('data-tab-pane'),
    display: getComputedStyle(p).display,
    h: Math.round(p.getBoundingClientRect().height),
    flags: ['active','leaving','entering','done'].filter((f) => p.hasAttribute('data-tab-pane-' + f)).join(',') || '-',
  }));
  return {
    panelH: Math.round(panel.getBoundingClientRect().height),
    panelInline: panel.style.height || '-',
    scrollH: scroller.scrollHeight,
    scrollTop: Math.round(scroller.scrollTop),
    clientH: scroller.clientHeight,
    panes,
  };
})()`;

const show = (label, s) => {
  console.log(
    `${label.padEnd(22)} panel ${String(s.panelH).padStart(5)}  inline ${s.panelInline.padEnd(6)}` +
      `  scrollHeight ${String(s.scrollH).padStart(5)}  scrollTop ${String(s.scrollTop).padStart(5)}` +
      `  max ${String(Math.max(0, s.scrollH - s.clientH)).padStart(5)}`,
  );
  for (const p of s.panes) {
    console.log(`    ${p.name.padEnd(8)} ${p.display.padEnd(6)} h ${String(p.h).padStart(5)}  [${p.flags}]`);
  }
};

await evaluate(`document.querySelector('.app-scroller').scrollTop = 1500`);
await sleep(300);
show('gallery @1500', await evaluate(probe));

await evaluate(
  `(() => {
     const tab = [...document.querySelectorAll('[role="tab"]')].find((t) => t.textContent.includes('论坛'));
     tab.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, isPrimary: true, button: 0 }));
     tab.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, isPrimary: true, button: 0 }));
     tab.click();
     return true;
   })()`,
);
await sleep(250);
show('mid-switch', await evaluate(probe));
await sleep(3000);
const after = await evaluate(probe);
show('settled (forum)', after);

/* And back, which must restore the gallery's own remembered offset — the fallback above must not
   have cost the memory that makes leaving a list and returning land on the same row. */
await evaluate(
  `(() => {
     const tab = [...document.querySelectorAll('[role="tab"]')].find((t) => t.textContent.includes('图库'));
     tab.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, isPrimary: true, button: 0 }));
     tab.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, isPrimary: true, button: 0 }));
     tab.click();
     return true;
   })()`,
);
await sleep(3000);
const back = await evaluate(probe);
show('back (gallery)', back);

const forum = after.panes.find((p) => p.name === 'forum');
const gallery = after.panes.find((p) => p.name === 'gallery');
let failed = false;
if (gallery && gallery.display !== 'none') {
  console.error(`\nFAIL: the gallery pane is still ${gallery.display} after the switch`);
  failed = true;
}
if (forum && Math.abs(after.panelH - forum.h) > 2) {
  console.error(
    `\nFAIL: the panel is ${after.panelH}px but the forum pane needs ${forum.h}px — ` +
      `something else is holding the height`,
  );
  failed = true;
}
/* The offset, which is the reported bug. A tab nobody has opened before starts at its own top, so
   anything above a few pixels means the outgoing tab's position carried over — and landing exactly
   on the destination's maximum is the specific shape it took. */
if (after.scrollTop > 4) {
  console.error(
    `
FAIL: the forum opened at scrollTop ${after.scrollTop} rather than its top` +
      `${after.scrollTop === Math.max(0, after.scrollH - after.clientH) ? ' — and that is its maximum, i.e. the last row' : ''}`,
  );
  failed = true;
}
if (Math.abs(back.scrollTop - 1500) > 8) {
  console.error(`
FAIL: returning to the gallery landed at ${back.scrollTop}, not the remembered 1500`);
  failed = true;
}
if (after.panelInline !== '-') {
  console.error(`\nFAIL: a residual inline height (${after.panelInline}) is pinning the panel`);
  failed = true;
}
console.log(failed ? '' : '\nthe panel measures the visible pane');
process.exit(failed ? 1 : 0);
