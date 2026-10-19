/**
 * How long a tap on a tab takes to move anything — on a phone.
 *
 * Every other tab probe taps with `element.click()` from inside the page and samples what moves.
 * That skips the part a finger feels: the browser's own touch → pointer → click sequence, the main
 * thread's work between the press and the frame that starts the strip, and that frame. This taps
 * with real touch input (`Input.dispatchTouchEvent`, the finger down for `PROBE_HOLD` ms) under a
 * phone's viewport and a slower CPU, and reads, per tap:
 *
 * - the click's Event Timing entry: its input delay and its processing;
 * - when the strip's animations (`tab-strip`) were given a start time — the frame the compositor
 *   started moving the panes — counted from the finger lifting (`motion`) and from it landing
 *   (`press`);
 * - how far the strip had got 50, 100 and 150ms after the finger lifted, and when it settled.
 *
 * The strip's animations are found by wrapping `Element.prototype.animate`, not by asking
 * `document.getAnimations()` every frame: that brings style up to date to answer, and would put the
 * probe's own cost into the frames it measures.
 *
 * `node scripts/probeTabLatency.mjs [cpu=4] [dpr=2]` (runs `next start`, so it measures the last
 * build). Prints medians; asserts nothing. Environment:
 *
 * - `PROBE_DESKTOP=1` presses with a mouse on a 1440×900 desktop instead, `PROBE_DESKTOP=1920` on a
 *   1920×1080 one, where the strip's window is the column and a faded margin;
 * - `PROBE_ONLY=<text>` runs the taps whose name contains it;
 * - `PROBE_REPEAT=n` rounds of each screen's taps (default 5), `PROBE_HOLD=ms` (default 90);
 * - `PROBE_NOLEAN=1` takes `data-tab-lean` off every panel, to price the lean;
 * - `PROBE_DUMP=1` prints every event, the first frames and the long animation frames of each tap;
 * - `PROBE_TRACE=<text>` records a trace of those taps and prints the main thread's work, by event,
 *   from the finger landing to the strip's start; `PROBE_TRACE_OUT=<prefix>` also writes each trace
 *   to `<prefix>-<n>.json`;
 * - `PROBE_PROFILE=<text>` samples the JavaScript of those taps and prints the functions with the
 *   most self time from the finger landing to the strip's start.
 */

import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { createServer as createHttpServer } from 'node:http';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { stubFor } from './netAuditFixtures.mjs';

const ROOT = path.resolve(import.meta.dirname, '..');
const CPU = Number(process.argv[2] ?? 4) || 4;
const DPR = Number(process.argv[3] ?? 2) || 2;
/* `PROBE_DESKTOP=1`: a 1440×900 desktop and a mouse, pressed for the same time, instead;
   `PROBE_DESKTOP=1920`, a 1920×1080 one. */
const DESKTOP = ['1', '1920'].includes(process.env.PROBE_DESKTOP ?? '');
const WIDE = process.env.PROBE_DESKTOP === '1920';
const WIDTH = DESKTOP ? (WIDE ? 1920 : 1440) : 390;
const HEIGHT = DESKTOP ? (WIDE ? 1080 : 900) : 844;
const ONLY = process.env.PROBE_ONLY ?? '';
const REPEAT = Number(process.env.PROBE_REPEAT ?? 5) || 5;
const HOLD = Number(process.env.PROBE_HOLD ?? 90) || 90;
const DUMP = process.env.PROBE_DUMP === '1';
const TRACE = process.env.PROBE_TRACE ?? '';
const NO_LEAN = process.env.PROBE_NOLEAN === '1';
const PROFILE = process.env.PROBE_PROFILE ?? '';

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
const profileDir = mkdtempSync(path.join(tmpdir(), 'picpony-tablat-'));

const upstream = createHttpServer((req, res) => {
  const stub = stubFor(`http://127.0.0.1:${upstreamPort}${req.url}`, req.method);
  if (!stub) return res.writeHead(404).end();
  res.writeHead(stub.status ?? 200, { 'content-type': stub.contentType, 'cache-control': 'no-store' });
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
    `--remote-debugging-port=${debugPort}`,
    `--user-data-dir=${profileDir}`,
    `--window-size=${WIDTH},${HEIGHT}`,
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
const traceEvents = [];
let traceDone = null;
socket.addEventListener('message', (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pending.has(m.id)) {
    if (m.error) console.error(`CDP ${pending.get(m.id).method}: ${m.error.message}`);
    pending.get(m.id).resolve(m.result);
    pending.delete(m.id);
  }
  if (m.method === 'Tracing.dataCollected') traceEvents.push(...m.params.value);
  if (m.method === 'Tracing.tracingComplete') traceDone?.();
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
  const stub = stubFor(request.url, request.method);
  if (!stub) return void send('Fetch.continueRequest', { requestId });
  await send('Fetch.fulfillRequest', {
    requestId,
    responseCode: stub.status ?? 200,
    responseHeaders: [
      { name: 'content-type', value: stub.contentType },
      { name: 'cache-control', value: 'no-store' },
      { name: 'access-control-allow-origin', value: '*' },
    ],
    body: stub.binary ? stub.body : Buffer.from(stub.body, 'utf8').toString('base64'),
  });
});
/* Measure the code, not the service worker (see the same line in netAudit.mjs). */
await send('Network.enable');
await send('Network.setBypassServiceWorker', { bypass: true });
await send('Fetch.enable', { patterns: [{ urlPattern: '*' }] });
await send('Emulation.setDeviceMetricsOverride', { width: WIDTH, height: HEIGHT, deviceScaleFactor: DESKTOP ? 1 : DPR, mobile: !DESKTOP });
if (!DESKTOP) await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
await send('Page.addScriptToEvaluateOnNewDocument', {
  source: `try{localStorage.setItem('picpony_motion','standard')}catch(e){}`,
});

/* In the page: every event entry, long frame and Web Animation from now on. */
const INSTALL = `(() => {
  const lat = (window.__lat = { events: [], loafs: [], frames: [], marks: [], anims: [] });
  const animate = Element.prototype.animate;
  Element.prototype.animate = function (...args) {
    const animation = animate.apply(this, args);
    lat.anims.push(animation);
    return animation;
  };
  new PerformanceObserver((list) => {
    for (const e of list.getEntries()) {
      lat.events.push({ name: e.name, start: e.startTime, ps: e.processingStart, pe: e.processingEnd, dur: e.duration });
    }
  }).observe({ type: 'event', durationThreshold: 16 });
  try {
    new PerformanceObserver((list) => {
      for (const e of list.getEntries()) {
        lat.loafs.push({
          start: e.startTime,
          dur: e.duration,
          blocking: e.blockingDuration,
          scripts: e.scripts.map((s) => ({
            invoker: s.invoker,
            dur: Math.round(s.duration),
            forced: Math.round(s.forcedStyleAndLayoutDuration),
            fn: s.sourceFunctionName,
          })),
        });
      }
    }).observe({ type: 'long-animation-frame' });
  } catch {}
  for (const type of ['pointerdown', 'pointerup', 'click']) {
    window.addEventListener(type, (event) => lat.marks.push({ type, at: performance.now(), ts: event.timeStamp }), true);
  }
  return true;
})()`;

/* One sample a frame: the strip's newest animation, read off the object itself. */
const SAMPLE = `(ms) => new Promise((done) => {
  const lat = window.__lat;
  const until = performance.now() + ms;
  let leanCounted = false;
  const step = (t) => {
    const strips = lat.anims.filter((a) => a.id === 'tab-strip');
    const a = strips[strips.length - 1];
    const live = a && a.playState !== 'idle';
    const timing = live && a.effect ? a.effect.getComputedTiming() : null;
    const frame = { t, start: live ? a.startTime : null, p: timing ? timing.progress : null, live: !!live };
    if (live && typeof a.startTime === 'number' && !leanCounted) {
      leanCounted = true;
      lat.lean = document.getAnimations().filter((x) => x.id === 'tab-lean').length;
    }
    lat.frames.push(frame);
    if (performance.now() < until) requestAnimationFrame(step);
    else done(true);
  };
  requestAnimationFrame(step);
})`;

async function tap(selector, label) {
  const box = await evaluate(`(() => {
    const tab = [...document.querySelectorAll(${JSON.stringify(selector)})].find((t) => t.textContent.includes(${JSON.stringify(label)}));
    if (!tab) return null;
    const r = tab.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  })()`);
  if (!box) return false;
  if (DESKTOP) {
    await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: box.x, y: box.y });
    const down = send('Input.dispatchMouseEvent', { type: 'mousePressed', x: box.x, y: box.y, button: 'left', clickCount: 1 });
    await sleep(HOLD);
    await down;
    await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: box.x, y: box.y, button: 'left', clickCount: 1 });
    return true;
  }
  /* The hold is wall-clock from sending the touch, not from its acknowledgement: a busy page
     acknowledges late, and a finger does not wait for it. */
  const down = send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: box.x, y: box.y }] });
  await sleep(HOLD);
  await down;
  await send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  return true;
}

/** The main thread's top-level work between two trace times (µs), self time by event name. */
function breakdown(events, fromUs, toUs) {
  const main = new Set(
    events.filter((e) => e.name === 'thread_name' && e.args?.name === 'CrRendererMain').map((e) => `${e.pid}:${e.tid}`),
  );
  const slices = events
    .filter((e) => main.has(`${e.pid}:${e.tid}`) && e.ph === 'X' && e.ts >= fromUs && e.ts < toUs)
    .sort((a, b) => a.ts - b.ts || (b.dur ?? 0) - (a.dur ?? 0));
  const self = new Map();
  const stack = [];
  for (const e of slices) {
    while (stack.length && stack.at(-1).ts + stack.at(-1).dur <= e.ts) stack.pop();
    const parent = stack.at(-1);
    if (parent) self.set(parent, (self.get(parent) ?? parent.dur) - e.dur);
    self.set(e, e.dur);
    stack.push(e);
  }
  const byName = new Map();
  for (const [e, us] of self) byName.set(e.name, (byName.get(e.name) ?? 0) + us);
  return [...byName].sort((a, b) => b[1] - a[1]).slice(0, 16);
}

const fmt = (v) => (v === null || v === undefined || Number.isNaN(v) ? '   -' : String(Math.round(v)).padStart(4));
const median = (list) => {
  const v = list.filter((x) => typeof x === 'number' && !Number.isNaN(x)).sort((a, b) => a - b);
  return v.length ? v[Math.floor((v.length - 1) / 2)] : null;
};
const results = [];
let traceFiles = 0;

/** Self time per function in a CPU profile, between two `performance.now()` times. */
function profileTop(profile, fromMs, toMs, timeOriginShiftUs) {
  const nodes = new Map(profile.nodes.map((n) => [n.id, n]));
  const self = new Map();
  let t = profile.startTime;
  for (let i = 0; i < profile.samples.length; i += 1) {
    t += profile.timeDeltas[i];
    const at = (t - timeOriginShiftUs) / 1000;
    if (at < fromMs || at > toMs) continue;
    const node = nodes.get(profile.samples[i]);
    const f = node.callFrame;
    const key = `${f.functionName || '(anonymous)'} ${f.url.split('/').pop()}:${f.lineNumber + 1}:${f.columnNumber + 1}`;
    const dt = (profile.timeDeltas[i + 1] ?? profile.timeDeltas[i]) / 1000;
    self.set(key, (self.get(key) ?? 0) + dt);
  }
  return [...self].sort((a, b) => b[1] - a[1]).slice(0, 25);
}

async function measure(name, selector, label) {
  const profiling = PROFILE && name.includes(PROFILE);
  if (profiling) {
    await send('Profiler.enable');
    await send('Profiler.setSamplingInterval', { interval: 100 });
    await send('Profiler.start');
  }
  const tracing = TRACE && name.includes(TRACE);
  if (tracing) {
    traceEvents.length = 0;
    await send('Tracing.start', {
      categories: 'devtools.timeline,disabled-by-default-devtools.timeline,blink,cc,input',
      transferMode: 'ReportEvents',
    });
    await sleep(300);
  }
  await evaluate(`(() => { const l = window.__lat; for (const k of ['events', 'loafs', 'frames', 'marks', 'anims']) l[k].length = 0; l.lean = 0; return true; })()`);
  const sampling = evaluate(`(${SAMPLE})(1300)`);
  await sleep(30);
  const ok = await tap(selector, label);
  await sampling;
  if (tracing) {
    const done = new Promise((r) => (traceDone = r));
    await send('Tracing.end');
    await done;
  }
  /* The profile's clock is the monotonic one in µs; `performance.timeOrigin` aligns it. */
  const clock = profiling ? await evaluate(`({ now: performance.now(), origin: performance.timeOrigin })`) : null;
  const profile = profiling ? (await send('Profiler.stop'))?.profile : null;
  const lat = await evaluate(`window.__lat`);
  if (!ok || !lat) return console.log(`${name.padEnd(26)} no tab "${label}"`);
  const down = lat.marks.find((m) => m.type === 'pointerdown');
  const up = lat.marks.find((m) => m.type === 'pointerup');
  const click = lat.events.find((e) => e.name === 'click');
  const lift = up ? up.ts : click?.start;
  const started = lat.frames.find((f) => typeof f.start === 'number');
  const at = (ms) => {
    const f = [...lat.frames].reverse().find((frame) => frame.t <= lift + ms);
    return f && f.p !== null ? Math.round(f.p * 100) : f && started && f.t > started.start ? 100 : 0;
  };
  const settled = started ? lat.frames.find((f) => f.t > started.start && !f.live) : null;
  const metrics = {
    delay: click ? click.ps - click.start : null,
    work: click ? click.pe - click.ps : null,
    motion: started ? started.start - lift : null,
    press: started && down ? started.start - down.ts : null,
    p50: at(50),
    p100: at(100),
    p150: at(150),
    done: settled ? settled.t - lift : null,
    lean: lat.lean,
  };
  results.push({ name, ...metrics });
  console.log(
    `${name.padEnd(26)} click delay ${fmt(metrics.delay)} work ${fmt(metrics.work)}  motion ${fmt(metrics.motion)} (press ${fmt(metrics.press)})` +
      `  p@50 ${fmt(metrics.p50)}%  p@100 ${fmt(metrics.p100)}%  p@150 ${fmt(metrics.p150)}%  done ${fmt(metrics.done)}  lean ${metrics.lean}`,
  );
  if (DUMP) {
    for (const m of lat.marks) console.log(`      ${m.type} timeStamp ${fmt(m.ts - lift)}, handled ${fmt(m.at - lift)}`);
    for (const e of lat.events.filter((e) => !/^(pointer|mouse)(over|out|enter|leave)$/.test(e.name))) {
      console.log(`      event ${e.name.padEnd(18)} processing ${fmt(e.ps - lift)} .. ${fmt(e.pe - lift)}`);
    }
    const frames = lat.frames.filter((f) => f.t > lift - 120).slice(0, 14);
    console.log(`      frames ${frames.map((f) => `${Math.round(f.t - lift)}${f.p === null ? '' : `:${Math.round(f.p * 100)}%`}`).join(' ')}`);
    for (const l of lat.loafs.filter((l) => l.start + l.dur > (down?.ts ?? lift) - 5 && l.start < lift + 400)) {
      const scripts = l.scripts
        .filter((s) => s.dur >= 3)
        .map((s) => `${s.invoker}${s.fn ? `(${s.fn})` : ''} ${s.dur}ms${s.forced ? ` [forced ${s.forced}]` : ''}`)
        .join('; ');
      console.log(`      long frame ${fmt(l.start - lift)} ${Math.round(l.dur)}ms (blocking ${Math.round(l.blocking)}) ${scripts}`);
    }
  }
  if (profile && down) {
    /* Align on the profile's end, taken just after the read of `performance.now()` above. */
    const shift = profile.endTime - clock.now * 1000;
    const until = started ? started.start : lift + 300;
    console.log(`      JavaScript from the press to the strip's start (${Math.round(until - down.ts)}ms), self time:`);
    for (const [key, ms] of profileTop(profile, down.ts, until, shift)) {
      if (ms >= 0.8) console.log(`        ${ms.toFixed(1).padStart(6)}ms  ${key}`);
    }
  }
  if (tracing && process.env.PROBE_TRACE_OUT) {
    /* The raw trace, with the clocks needed to align it, for a closer look than the summary. */
    const { writeFileSync } = await import('node:fs');
    traceFiles += 1;
    writeFileSync(
      `${process.env.PROBE_TRACE_OUT}-${traceFiles}.json`,
      JSON.stringify({ traceEvents, lift, clickProcessingStart: click?.ps ?? null, stripStart: started?.start ?? null }),
    );
  }
  if (tracing && click && started && down) {
    /* Trace time is µs on the monotonic clock; align it on the click's own dispatch. */
    const dispatch = traceEvents.find((e) => e.name === 'EventDispatch' && e.args?.data?.type === 'click');
    if (dispatch) {
      const offset = dispatch.ts - click.ps * 1000;
      const from = down.ts * 1000 + offset;
      const to = started.start * 1000 + offset;
      console.log(`      main thread from the press to the strip's start (${Math.round((to - from) / 1000)}ms):`);
      for (const [key, us] of breakdown(traceEvents, from, to)) {
        if (us >= 1000) console.log(`        ${(us / 1000).toFixed(1).padStart(6)}ms  ${key}`);
      }
    }
  }
}

console.log(
  `${DESKTOP ? 'desktop' : 'phone'} ${WIDTH}x${HEIGHT} @${DESKTOP ? 1 : DPR}x, CPU ${CPU}x slower, ${DESKTOP ? 'button' : 'finger'} down ${HOLD}ms` +
    `${NO_LEAN ? ', no lean' : ''} — ms from the release`,
);
await send('Emulation.setCPUThrottlingRate', { rate: CPU });

const PILL = 'nav[aria-label="首页导航"] [role="tab"]';
const VIEWS = '[role="tablist"][aria-label="图库视图"] [role="tab"]';
const scenarios = [
  {
    route: '/',
    taps: [
      ['home pill 图库 → 论坛', PILL, '论坛'],
      ['home pill 论坛 → 图库', PILL, '图库'],
      ['gallery 全部 → 本站讨论', VIEWS, '本站讨论'],
      ['gallery 本站讨论 → 全部', VIEWS, '全部'],
    ],
  },
  {
    route: '/policy',
    taps: [
      ['policy → 服务协议', '[role="tab"]', '服务协议'],
      ['policy → 隐私政策', '[role="tab"]', '隐私政策'],
      ['policy → Cookie', '[role="tab"]', 'Cookie'],
    ],
  },
  {
    route: '/settings',
    taps: [
      ['settings → 个性化', '[role="tab"]', '个性化'],
      ['settings → 偏好', '[role="tab"]', '偏好'],
    ],
  },
  {
    route: '/messages',
    taps: [
      ['messages → 系统', '[role="tab"]', '系统'],
      ['messages → 公告', '[role="tab"]', '公告'],
    ],
  },
];

for (const { route, taps } of scenarios) {
  if (ONLY && !taps.some(([name]) => name.includes(ONLY))) continue;
  await send('Page.navigate', { url: `${origin}${route}` });
  await sleep(9000);
  await evaluate(INSTALL);
  if (NO_LEAN) await evaluate(`document.querySelectorAll('[data-tab-lean]').forEach((el) => el.removeAttribute('data-tab-lean'))`);
  for (let round = 0; round < REPEAT; round += 1) {
    for (const [name, selector, label] of taps) {
      if (ONLY && !name.includes(ONLY)) continue;
      await measure(name, selector, label);
      await sleep(1200);
    }
  }
}

console.log(`\nmedians over ${REPEAT} rounds:`);
for (const name of [...new Set(results.map((r) => r.name))]) {
  const rows = results.filter((r) => r.name === name);
  const m = (key) => fmt(median(rows.map((r) => r[key])));
  console.log(
    `${name.padEnd(26)} click delay ${m('delay')} work ${m('work')}  motion ${m('motion')} (press ${m('press')})` +
      `  p@50 ${m('p50')}%  p@100 ${m('p100')}%  p@150 ${m('p150')}%  done ${m('done')}`,
  );
}
process.exit(0);
