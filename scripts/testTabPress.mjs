/**
 * The press-to-switch contract of a tab row, under real input (`npm run test:tab-press`).
 *
 * A press primes its switch, a finger's lift starts it and the click selects the tab a frame later
 * (`Tabs`, `primeTabTransition`). Each step can be overtaken by the next input, and none may leave
 * the screen inconsistent: after every gesture below — a tap, a press that becomes a scroll, a
 * long press, two taps in quick succession, a tap back to the tab being left, a mouse click, a tap
 * on the tab already selected, the home pill's 图库 ⇄ 论坛 — once the motion has settled, every
 * panel shows exactly one pane, that pane is its row's selected tab, no motion flag, transform,
 * clip, widened box, mask or tab animation is left anywhere, the scroller is no longer the strip's
 * window, and the address names the tab (where the screen keeps it there).
 *
 * Runs `next start` (the last build) on a phone viewport, at the CPU slowdowns given (default
 * `1 4`), then with a mouse on a 1920 desktop, where the strip's window is the column and a faded
 * margin (`columnWindow`), checked mid-run: `node scripts/testTabPress.mjs [cpu…]`. Exits non-zero
 * on any failure.
 */

import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { createServer as createHttpServer } from 'node:http';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { stubFor } from './netAuditFixtures.mjs';

const ROOT = path.resolve(import.meta.dirname, '..');
const CPUS = process.argv.slice(2).map(Number).filter((n) => n > 0);
if (CPUS.length === 0) CPUS.push(1, 4);
const WIDTH = 390;
const HEIGHT = 844;
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
const profileDir = mkdtempSync(path.join(tmpdir(), 'picpony-tabpress-'));

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
  { cwd: ROOT, stdio: 'ignore', env: { ...process.env, PICPONY_UPSTREAM_ORIGIN: `http://127.0.0.1:${upstreamPort}` } },
);
const edge = [
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
].find((c) => existsSync(c));
const browser = spawn(
  edge,
  ['--headless=new', `--remote-debugging-port=${debugPort}`, `--user-data-dir=${profileDir}`, `--window-size=${WIDTH},${HEIGHT}`, '--no-first-run', 'about:blank'],
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
  (await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }))?.result?.value;

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
await send('Network.enable');
await send('Network.setBypassServiceWorker', { bypass: true });
await send('Fetch.enable', { patterns: [{ urlPattern: '*' }] });
await send('Emulation.setDeviceMetricsOverride', { width: WIDTH, height: HEIGHT, deviceScaleFactor: 2, mobile: true });
await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
await send('Page.addScriptToEvaluateOnNewDocument', { source: `try{localStorage.setItem('picpony_motion','standard')}catch(e){}` });

/* The state at rest, read in the page. */
const STATE = `(() => {
  const panels = [...document.querySelectorAll('[data-page-content] [data-tab-panel]')].map((panel) => {
    const panes = [...panel.querySelectorAll(':scope > [data-tab-pane]')];
    const concealed = (p) => p.hasAttribute('data-tab-pane-done') ||
      (!p.hasAttribute('data-tab-pane-active') && !p.hasAttribute('data-tab-pane-leaving') && !p.hasAttribute('data-tab-pane-entering'));
    const shown = panes.filter((p) => !concealed(p)).map((p) => p.dataset.tabPane);
    const flagged = panes.filter((p) => ['leaving', 'entering', 'done'].some((f) => p.hasAttribute('data-tab-pane-' + f))).map((p) => p.dataset.tabPane);
    const moved = panes.filter((p) => getComputedStyle(p).transform !== 'none' || p.style.clipPath).map((p) => p.dataset.tabPane);
    const edged = !!(panel.style.maskImage || panel.style.marginLeft || panel.style.paddingLeft);
    /* The row that drives this panel: the selected tab whose aria-controls names one of its panes. */
    const ids = new Set(panes.map((p) => p.id));
    const selected = [...document.querySelectorAll('[role="tab"][aria-selected="true"]')].find((t) => ids.has(t.getAttribute('aria-controls')));
    return { shown, flagged, moved, edged, selected: selected ? selected.dataset.tab : null, hidden: panel.closest('[data-tab-pane]') && !panel.closest('[data-tab-pane]').checkVisibility?.() };
  });
  return {
    panels,
    animations: document.getAnimations().filter((a) => a.id === 'tab-strip' || a.id === 'tab-lean').length,
    axis: document.querySelector('.app-scroller')?.getAttribute('data-axis-running') ?? null,
    url: location.pathname + location.search,
  };
})()`;

const failures = [];
function check(label, state, expect = {}) {
  const problems = [];
  if (!state) problems.push('no state');
  else {
    if (state.animations) problems.push(`${state.animations} tab animation(s) still running`);
    if (state.axis) problems.push(`the scroller is still the strip's window (${state.axis})`);
    for (const panel of state.panels) {
      if (panel.hidden) continue;
      if (panel.shown.length !== 1) problems.push(`panel shows ${JSON.stringify(panel.shown)}`);
      if (panel.flagged.length) problems.push(`motion flags left on ${panel.flagged.join(', ')}`);
      if (panel.moved.length) problems.push(`transform or clip left on ${panel.moved.join(', ')}`);
      if (panel.edged) problems.push("the window's widened box or mask left on the panel");
      if (panel.selected !== null && panel.shown[0] !== panel.selected) problems.push(`shows ${panel.shown[0]} under selected ${panel.selected}`);
    }
    if (expect.selected && !state.panels.some((p) => p.selected === expect.selected)) problems.push(`${expect.selected} is not selected`);
    if (expect.url && state.url !== expect.url) problems.push(`address ${state.url}, expected ${expect.url}`);
  }
  console.log(`${problems.length ? 'FAIL' : ' ok '}  ${label}${problems.length ? ` — ${problems.join('; ')}` : ''}`);
  if (problems.length) failures.push(`${label}: ${problems.join('; ')}`);
}

const boxOf = (selector, label) =>
  evaluate(`(() => {
    const tab = [...document.querySelectorAll(${JSON.stringify(selector)})].find((t) => t.textContent.includes(${JSON.stringify(label)}));
    if (!tab) return null;
    const r = tab.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  })()`);

/* Every gesture starts with the row on screen: a press that became a scroll moved the page. */
const toTop = async () => {
  await evaluate(`(() => { const s = document.querySelector('.app-scroller'); if (s && s.scrollTop > 0) s.scrollTop = 0; return true; })()`);
  await sleep(150);
};

async function touch(selector, label, { hold = 90, move = null } = {}) {
  const box = await boxOf(selector, label);
  if (!box) throw new Error(`no tab ${label}`);
  const down = send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: box.x, y: box.y }] });
  if (move) {
    await sleep(30);
    for (let i = 1; i <= 6; i += 1) {
      await send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: box.x + (move.x * i) / 6, y: box.y + (move.y * i) / 6 }] });
      await sleep(16);
    }
  } else {
    await sleep(hold);
  }
  await down;
  await send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
}

async function mouse(selector, label, { hold = 90 } = {}) {
  const box = await boxOf(selector, label);
  if (!box) throw new Error(`no tab ${label}`);
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: box.x, y: box.y });
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: box.x, y: box.y, button: 'left', clickCount: 1 });
  await sleep(hold);
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: box.x, y: box.y, button: 'left', clickCount: 1 });
}

const settle = async (ms = 1500) => {
  await sleep(ms);
  return evaluate(STATE);
};

const TAB = '[role="tab"]';
const PILL = 'nav[aria-label="首页导航"] [role="tab"]';
const VIEWS = '[role="tablist"][aria-label="图库视图"] [role="tab"]';

const scrollTop = () => evaluate(`document.querySelector('.app-scroller')?.scrollTop ?? 0`);

const runs = [...CPUS.map((cpu) => ({ cpu, tier: 'standard' })), { cpu: CPUS[0], tier: 'reduced' }, { cpu: CPUS[0], tier: 'off' }];
let tierScript = null;
for (const { cpu, tier } of runs) {
  console.log(`\nCPU ${cpu}x slower, ${tier}`);
  await send('Emulation.setCPUThrottlingRate', { rate: cpu });
  if (tierScript) await send('Page.removeScriptToEvaluateOnNewDocument', { identifier: tierScript });
  tierScript = (
    await send('Page.addScriptToEvaluateOnNewDocument', {
      source: `try{localStorage.setItem('picpony_motion',${JSON.stringify(tier)})}catch(e){}`,
    })
  )?.identifier;

  await send('Page.navigate', { url: `${origin}/policy` });
  await sleep(8000);
  check('policy at rest', await evaluate(STATE), { selected: 'cookie' });

  await touch(TAB, '服务协议');
  check('a tap', await settle(), { selected: 'agreement', url: '/policy?tab=agreement' });

  await touch(TAB, '隐私政策', { move: { x: 0, y: -160 } });
  check('a press that becomes a scroll switches nothing', await settle(), { selected: 'agreement' });

  await toTop();
  await touch(TAB, '常见问题', { hold: 700 });
  const long = await settle();
  check('a long press leaves one consistent tab', long);

  await toTop();
  await touch(TAB, 'Cookie');
  await sleep(60);
  await touch(TAB, '服务协议');
  check('two taps in quick succession', await settle(), { selected: 'agreement', url: '/policy?tab=agreement' });

  await toTop();
  await touch(TAB, '隐私政策');
  await sleep(120);
  await touch(TAB, '服务协议');
  check('a tap back to the tab being left', await settle(), { selected: 'agreement', url: '/policy?tab=agreement' });

  await toTop();
  await mouse(TAB, '常见问题');
  check('a mouse click', await settle(), { selected: 'faq', url: '/policy?tab=faq' });

  await toTop();
  await mouse(TAB, 'Cookie', { hold: 5 });
  check('a mouse click quicker than a frame', await settle(), { selected: 'cookie', url: '/policy' });

  await toTop();
  await touch(TAB, 'Cookie');
  check('a tap on the tab already selected', await settle(), { selected: 'cookie', url: '/policy' });

  await send('Page.navigate', { url: `${origin}/` });
  await sleep(9000);
  check('home at rest', await evaluate(STATE), { selected: 'gallery' });

  await touch(PILL, '论坛');
  check('the pill to 论坛', await settle(), { selected: 'forum', url: '/?tab=forum' });

  await touch(PILL, '图库');
  check('the pill back to 图库', await settle(), { selected: 'gallery', url: '/' });

  await touch(PILL, '论坛');
  await sleep(80);
  await touch(PILL, '图库');
  check('the pill there and straight back', await settle(2000), { selected: 'gallery', url: '/' });

  await touch(VIEWS, '本站讨论');
  check('the gallery views to 本站讨论', await settle(2500), { selected: 'home-discussed' });

  await touch(VIEWS, '全部');
  check('the gallery views back to 全部', await settle(), { selected: 'home-feed' });

  /* The pill is fixed chrome, so it is pressed from anywhere down the gallery: the forum opens at
     its own top and the gallery comes back to where it was left. */
  await evaluate(`(() => { document.querySelector('.app-scroller').scrollTop = 1500; return true; })()`);
  await sleep(400);
  const left = await scrollTop();
  await touch(PILL, '论坛');
  check('the pill to 论坛 from down the gallery', await settle(), { selected: 'forum', url: '/?tab=forum' });
  const atForum = await scrollTop();
  if (atForum > 4) {
    console.log(`FAIL  the forum opened at ${atForum}, not its top`);
    failures.push(`forum offset ${atForum}`);
  }
  await touch(PILL, '图库');
  check('the pill back to 图库, down the gallery', await settle(), { selected: 'gallery', url: '/' });
  const back = await scrollTop();
  if (Math.abs(back - left) > 8) {
    console.log(`FAIL  the gallery came back at ${back}, not ${left}`);
    failures.push(`gallery offset ${back} against ${left}`);
  }
}

/* A wide desktop and a mouse: the window is the column and a faded margin, so the strip travels
   the window's width — not the scroller's — and the panel is masked for the run only. */
console.log('\n1920x1080 desktop, a mouse, standard');
await send('Emulation.setCPUThrottlingRate', { rate: 1 });
await send('Emulation.setTouchEmulationEnabled', { enabled: false });
await send('Emulation.setDeviceMetricsOverride', { width: 1920, height: 1080, deviceScaleFactor: 1, mobile: false });
if (tierScript) await send('Page.removeScriptToEvaluateOnNewDocument', { identifier: tierScript });
await send('Page.addScriptToEvaluateOnNewDocument', { source: `try{localStorage.setItem('picpony_motion','standard')}catch(e){}` });

/* The run as it starts: the strip's travel, and the panel's window. */
const MID_RUN = `new Promise((resolve) => {
  const started = performance.now();
  const look = () => {
    const strip = document.getAnimations().filter((a) => a.id === 'tab-strip');
    if (strip.length < 2) return performance.now() - started > 2000 ? resolve(null) : requestAnimationFrame(look);
    const arriving = strip[1].effect.getKeyframes()[0].transform;
    const panel = strip[0].effect.target.parentElement;
    const scroller = document.querySelector('.app-scroller');
    resolve({
      travel: Math.abs(parseFloat(arriving.slice(arriving.indexOf('(') + 1))),
      reach: -parseFloat(panel.style.marginLeft || '0'),
      padding: parseFloat(panel.style.paddingLeft || '0'),
      mask: panel.style.maskImage,
      window: panel.getBoundingClientRect().width,
      inner: scroller.clientWidth,
    });
  };
  look();
})`;
const midRun = async (selector, label, name) => {
  const box = await boxOf(selector, label);
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: box.x, y: box.y });
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: box.x, y: box.y, button: 'left', clickCount: 1 });
  await sleep(90);
  const running = evaluate(MID_RUN);
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: box.x, y: box.y, button: 'left', clickCount: 1 });
  const run = await running;
  const problems = [];
  if (!run) problems.push('no run');
  else {
    if (!run.mask) problems.push('the panel is not masked');
    if (!(run.reach > 0) || run.padding !== run.reach) problems.push(`box widened by ${run.reach} with ${run.padding} padding`);
    if (Math.abs(run.travel - run.window) > 1) problems.push(`travels ${run.travel}, the window is ${run.window}`);
    if (!(run.window <= run.inner)) problems.push(`the window ${run.window} is not inside the scroller's ${run.inner}`);
  }
  const detail = run ? ` (travel ${Math.round(run.travel)} of ${run.inner}, reach ${run.reach})` : '';
  console.log(`${problems.length ? 'FAIL' : ' ok '}  ${name}, mid-run${detail}${problems.length ? ` — ${problems.join('; ')}` : ''}`);
  if (problems.length) failures.push(`${name}, mid-run: ${problems.join('; ')}`);
};

await send('Page.navigate', { url: `${origin}/policy` });
await sleep(8000);
check('wide: policy at rest', await evaluate(STATE), { selected: 'cookie' });
await midRun(TAB, '服务协议', 'wide: a click');
check('wide: a click', await settle(), { selected: 'agreement', url: '/policy?tab=agreement' });
await mouse(TAB, '隐私政策');
await sleep(120);
await mouse(TAB, '服务协议');
check('wide: a click back to the tab being left', await settle(), { selected: 'agreement', url: '/policy?tab=agreement' });

await send('Page.navigate', { url: `${origin}/` });
await sleep(9000);
check('wide: home at rest', await evaluate(STATE), { selected: 'gallery' });
await midRun(PILL, '论坛', 'wide: the pill to 论坛');
check('wide: the pill to 论坛', await settle(), { selected: 'forum', url: '/?tab=forum' });
await mouse(PILL, '图库');
check('wide: the pill back to 图库', await settle(), { selected: 'gallery', url: '/' });
await mouse(VIEWS, '本站讨论');
check('wide: the gallery views to 本站讨论', await settle(2500), { selected: 'home-discussed' });
await mouse(VIEWS, '全部');
check('wide: the gallery views back to 全部', await settle(), { selected: 'home-feed' });

if (failures.length) {
  console.error(`\n${failures.length} failure(s)`);
  process.exit(1);
}
console.log('\nevery gesture left one consistent tab');
process.exit(0);
