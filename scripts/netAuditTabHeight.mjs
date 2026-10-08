/**
 * Where does a tab switch leave the page — and does the whole pane travel?
 *
 * The panel is a grid with both home panes in one cell, and the inactive one has to fall out of
 * layout at settle so the panel measures the *visible* pane. The reported bug was the offset: a
 * tab with no remembered scroll position used to keep the outgoing tab's, and the browser clamped
 * it to the shorter pane's maximum — leaving the gallery at 1500 for a 1708px-tall forum landed at
 * 1160, that forum's maximum, i.e. on its last row. `applyTabScroll`'s fallback is the fix.
 *
 * **The whole pane moves, and it leans.** First, before any of that, a 图库 ⇄ 论坛 run is sampled
 * every frame: every element with a box on screen in either pane — the 全部 / 本站讨论 row, the
 * banner, the heading, the rows, the pager — must travel with its pane, never more than the lean
 * behind it, and on the home route's leaning panel the upper blocks must lead the lower ones —
 * further along at some frame, and halfway across at least 5ms earlier. The GSAP lean moved only the
 * blocks it had marked, and the view row, inside a wrapper with no box of its own, stood still
 * while the gallery slid out from under it.
 *
 * **The offset holds under shared chrome.** Then, with the 全部 / 本站讨论 row a little under
 * the top of the screen, both of its switches are sampled every frame: the offset may not move on
 * any frame, nor once the switch has settled — the arriving pane starts at its own top and the
 * panel keeps a floor rather than let a shorter pane pull the page up under the reader.
 *
 * `node scripts/netAuditTabHeight.mjs` (runs `next start`, so it measures the last build)
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
/* Measure the code, not the service worker: it would answer `/_next/image` from its own thread,
   where `Fetch` never sees the request (see the same line in netAudit.mjs). */
await send('Network.enable');
await send('Network.setBypassServiceWorker', { bypass: true });
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

/* A concealed pane keeps its box and its layout (`content-visibility: hidden`, which also
   contains its size to nothing); `display: none` where the engine has no content-visibility. */
const probe = `(() => {
  const panel = document.querySelector('[data-tab-panel]');
  const scroller = document.querySelector('.app-scroller');
  const panes = [...document.querySelectorAll('[data-tab-panel] > [data-tab-pane]')].map((p) => ({
    name: p.getAttribute('data-tab-pane'),
    display: getComputedStyle(p).display,
    concealed: getComputedStyle(p).display === 'none' || getComputedStyle(p).contentVisibility === 'hidden',
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
    console.log(
      `    ${p.name.padEnd(8)} ${(p.concealed ? 'hidden' : 'shown').padEnd(6)} h ${String(p.h).padStart(5)}  [${p.flags}]`,
    );
  }
};

/* sampler:begin — the whole-pane check, as one page-side function (the review harness runs the
   same string against the dev server). Every element with a box on screen in either pane is read
   every frame of the run, and three things must hold. **Nothing is left behind**: no element's
   displacement ever differs from its pane's by more than 45% of the window (the lean's own peak is
   16%; an element that stood still while its pane slid a window reaches 100%). **Everything
   moves**: each travels at least half as far as its pane. **The lean is there**, on a leaning
   panel, in space and in time: at some frame the elements in the upper third of the view are, on
   average, at least 3% of the window further along than those in the lower third; and the lower
   third is halfway across at least 5ms after the upper one (interpolated between frames — the
   delays run from 0 at the top of the view to 24ms at its bottom; measured 9–16ms at 1440 and
   390 on a loaded dev server, and exactly 0 without the lean). The arriving pane is
   collected on the first frame after the tap, once it has a
   box. */
const WHOLE_PANE_SAMPLER = `async (tabLabel) => {
  const scroller = document.querySelector('.app-scroller');
  const panel = document.querySelector('[data-tab-panel]');
  const panes = [...panel.querySelectorAll(':scope > [data-tab-pane]')];
  const view = scroller.getBoundingClientRect();
  const window_ = scroller.clientWidth + 96;
  const describe = (el) => {
    const bits = [el.tagName.toLowerCase() + (el.className && typeof el.className === 'string' ? '.' + el.className.split(' ').slice(0, 2).join('.') : '')];
    if (el.getAttribute('role')) bits.push('role=' + el.getAttribute('role'));
    if (el.getAttribute('aria-label')) bits.push(el.getAttribute('aria-label'));
    const text = (el.textContent || '').trim().slice(0, 24);
    if (text) bits.push(text);
    return bits.join(' ');
  };
  const onScreen = (pane) =>
    [...pane.querySelectorAll('*')]
      .map((el) => ({ el, rect: el.getBoundingClientRect() }))
      .filter(({ rect }) => rect.width > 0 && rect.height > 0 && rect.bottom > view.top && rect.top < view.bottom)
      .slice(0, 800)
      .map(({ el, rect }) => ({ el, top: rect.top }));
  const shown = panes.find((p) => p.hasAttribute('data-tab-pane-active'));
  const tracked = new Map([[shown, onScreen(shown)]]);
  const history = [];
  const read = () => {
    const frame = [];
    frame.t = performance.now();
    for (const [pane, els] of tracked) {
      frame.push({
        pane,
        x: new DOMMatrix(getComputedStyle(pane).transform).m41,
        /* An element React has since replaced (a placeholder giving way to its picture) has no
           position to compare: null, and skipped. */
        lefts: els.map(({ el }) => {
          if (!el.isConnected) return null;
          const r = el.getBoundingClientRect();
          return r.width > 0 || r.height > 0 ? r.left : null;
        }),
      });
    }
    history.push(frame);
  };
  const tab = [...document.querySelectorAll('[role="tab"]')].find((t) => t.textContent.includes(tabLabel));
  if (!tab) return { error: 'no tab ' + tabLabel };
  read();
  tab.click();
  let collected = false;
  await new Promise((done) => {
    const until = performance.now() + 1600;
    const step = () => {
      if (!collected) {
        const arriving = panes.find((p) => p !== shown && p.hasAttribute('data-tab-pane-entering'));
        if (arriving) {
          tracked.set(arriving, onScreen(arriving));
          collected = true;
        }
      }
      read();
      if (performance.now() < until) requestAnimationFrame(step);
      else done();
    };
    requestAnimationFrame(step);
  });
  const leans = panel.hasAttribute('data-tab-lean');
  const upper = view.top + view.height / 3;
  const lower = view.top + (2 * view.height) / 3;
  const report = [];
  for (const [pane, els] of tracked) {
    const frames = history
      .map((frame) => {
        const f = frame.find((entry) => entry.pane === pane);
        return f ? { ...f, t: frame.t } : null;
      })
      .filter(Boolean);
    const first = frames[0];
    /* The direction of travel is the pane's furthest excursion, not its last frame: a pane that
       left has had its transform let go by then. */
    let paneTravel = 0;
    let sign = 1;
    for (const f of frames) {
      const d = f.x - first.x;
      if (Math.abs(d) > paneTravel) {
        paneTravel = Math.abs(d);
        sign = Math.sign(d) || 1;
      }
    }
    const behind = new Map();
    const travel = els.map(() => 0);
    /* Frames in which the pane is well under way, and how many of them each element was there
       for: one that React replaced early is not judged on the frames it was gone. */
    let moving = 0;
    const present = els.map(() => 0);
    let lean = 0;
    /* When each element is halfway across: the first frame it has moved half the window,
       interpolated. Halfway, not the first 5%: the strip leaves fast, so 5% falls inside the
       first frame or two, where interpolating between frames reads as noise; with a 24ms lean,
       timing 5% gave the lower third anywhere from 5 to 28ms on one loaded machine. */
    const departed = els.map(() => null);
    const lastDisp = els.map(() => null);
    for (const f of frames) {
      const paneDisp = f.x - first.x;
      if (Math.abs(paneDisp) > 0.1 * window_) {
        moving += 1;
        f.lefts.forEach((left, i) => { if (left !== null) present[i] += 1; });
      }
      let up = 0, upN = 0, down = 0, downN = 0;
      f.lefts.forEach((left, i) => {
        if (left === null || first.lefts[i] === null) return;
        const disp = left - first.lefts[i];
        travel[i] = Math.max(travel[i], Math.abs(disp));
        const mark = 0.5 * window_;
        if (departed[i] === null && Math.abs(disp) >= mark) {
          const before = lastDisp[i];
          departed[i] = before && Math.abs(disp) > Math.abs(before.disp)
            ? before.t + ((f.t - before.t) * (mark - Math.abs(before.disp))) / (Math.abs(disp) - Math.abs(before.disp))
            : f.t;
        }
        lastDisp[i] = { t: f.t, disp };
        const gap = Math.abs(disp - paneDisp);
        if (gap > 0.45 * window_) behind.set(i, Math.max(behind.get(i) || 0, gap));
        if (els[i].top < upper) { up += disp * sign; upN += 1; }
        else if (els[i].top > lower) { down += disp * sign; downN += 1; }
      });
      if (upN && downN) lean = Math.max(lean, up / upN - down / downN);
    }
    const unmoved = [];
    travel.forEach((t, i) => { if (present[i] >= moving / 2 && t < 0.5 * paneTravel) unmoved.push(i); });
    const mean = (list) => (list.length ? list.reduce((a, b) => a + b, 0) / list.length : null);
    const leaveUp = mean(els.map((e, i) => (e.top < upper ? departed[i] : null)).filter((t) => t !== null));
    const leaveDown = mean(els.map((e, i) => (e.top > lower ? departed[i] : null)).filter((t) => t !== null));
    const viewRow = els.findIndex(({ el }) => el.matches('[role="tablist"][aria-label="图库视图"]'));
    report.push({
      pane: pane.getAttribute('data-tab-pane'),
      sampled: els.length,
      paneTravel: Math.round(paneTravel),
      behind: [...behind.keys()].slice(0, 6).map((i) => describe(els[i].el)),
      behindCount: behind.size,
      unmoved: unmoved.slice(0, 6).map((i) => describe(els[i].el)),
      unmovedCount: unmoved.length,
      lean: +(lean / window_).toFixed(3),
      stagger: leaveUp === null || leaveDown === null ? null : Math.round(leaveDown - leaveUp),
      viewRow: viewRow === -1 ? null : { travel: Math.round(travel[viewRow]), behind: behind.has(viewRow) },
    });
  }
  return { frames: history.length, leans, report };
}`;
/* sampler:end */

const wholePane = async (label) => {
  const result = await evaluate(`(${WHOLE_PANE_SAMPLER})(${JSON.stringify(label)})`);
  console.log(
    `whole pane, tap ${label}: ${result?.frames ?? 0} frames, panel ${result?.leans ? 'leans' : 'does not lean'}` +
      `${result?.error ? ` (${result.error})` : ''}`,
  );
  let bad = !result?.report;
  for (const r of result?.report ?? []) {
    console.log(
      `    ${r.pane.padEnd(8)} ${String(r.sampled).padStart(4)} elements, pane travelled ${r.paneTravel}px, ` +
        `left behind ${r.behindCount}, unmoved ${r.unmovedCount}, lean ${(r.lean * 100).toFixed(1)}% of the window, ` +
        `lower third leaves ${r.stagger ?? '?'}ms after the upper` +
        `${r.viewRow ? `, the 全部 / 本站讨论 row travelled ${r.viewRow.travel}px` : ''}`,
    );
    if (r.paneTravel < 4) {
      console.error(`\nFAIL: the ${r.pane} pane never moved during the switch`);
      bad = true;
    }
    if (r.behindCount > 0) {
      console.error(`\nFAIL: ${r.behindCount} element(s) of the ${r.pane} pane were left behind while it moved: ${r.behind.join(' | ')}`);
      bad = true;
    }
    if (r.unmovedCount > 0) {
      console.error(`\nFAIL: ${r.unmovedCount} element(s) of the ${r.pane} pane hardly moved: ${r.unmoved.join(' | ')}`);
      bad = true;
    }
    if (result.leans && r.lean < 0.03) {
      console.error(`\nFAIL: the ${r.pane} pane left without a lean (${(r.lean * 100).toFixed(1)}% of the window, 3% wanted)`);
      bad = true;
    }
    if (result.leans && !(r.stagger >= 5)) {
      console.error(`\nFAIL: the ${r.pane} pane's lower third did not leave after its upper third (${r.stagger ?? '?'}ms, 5 wanted)`);
      bad = true;
    }
  }
  if (label === '论坛' && !result?.report?.some((r) => r.viewRow)) {
    console.error('\nFAIL: the 全部 / 本站讨论 row was not among the sampled elements');
    bad = true;
  }
  return bad;
};

await evaluate(`document.querySelector('.app-scroller').scrollTop = 0`);
await sleep(400);
let paneFailed = await wholePane('论坛');
await sleep(2500);
paneFailed = (await wholePane('图库')) || paneFailed;
await sleep(2500);

/* view:begin — the offset under shared chrome, sampled every frame of a 全部 / 本站讨论 switch
   (the review harness runs the same string against the dev server). */
const VIEW_SCROLL_SAMPLER = `async (tabLabel) => {
  const scroller = document.querySelector('.app-scroller');
  const tab = [...document.querySelectorAll('[role="tablist"][aria-label="图库视图"] [role="tab"]')].find((t) => t.textContent.includes(tabLabel));
  if (!tab) return { error: 'no tab ' + tabLabel };
  const offsets = [scroller.scrollTop];
  tab.click();
  await new Promise((done) => {
    const until = performance.now() + 1600;
    const step = () => {
      offsets.push(scroller.scrollTop);
      if (performance.now() < until) requestAnimationFrame(step);
      else done();
    };
    requestAnimationFrame(step);
  });
  const panel = tab.closest('[data-tab-pane]').querySelector('[data-tab-panel]');
  return {
    before: offsets[0],
    min: Math.min(...offsets),
    max: Math.max(...offsets),
    after: scroller.scrollTop,
    frames: offsets.length,
    floor: panel ? panel.style.minHeight || '-' : '?',
  };
}`;
/* view:end */

const viewHolds = async (label) => {
  const r = await evaluate(`(${VIEW_SCROLL_SAMPLER})(${JSON.stringify(label)})`);
  console.log(
    `view row, tap ${label}: scrollTop ${r?.before} -> ${r?.after} (range ${r?.min}..${r?.max} over ${r?.frames} frames), floor ${r?.floor}${r?.error ? ` (${r.error})` : ''}`,
  );
  if (!r || r.error || Math.abs(r.max - r.before) > 1 || Math.abs(r.min - r.before) > 1 || Math.abs(r.after - r.before) > 1) {
    console.error(`\nFAIL: the 全部 / 本站讨论 switch moved the page under the reader (${JSON.stringify(r)})`);
    return true;
  }
  return false;
};

/* The row a little under the top: the banner above it scrolled away, the reader's eye on it. */
await evaluate(`(() => {
  const scroller = document.querySelector('.app-scroller');
  const row = document.querySelector('[role="tablist"][aria-label="图库视图"]');
  scroller.scrollTop = Math.max(0, Math.round(row.getBoundingClientRect().top - scroller.getBoundingClientRect().top + scroller.scrollTop) - 140);
})()`);
await sleep(600);
paneFailed = (await viewHolds('本站讨论')) || paneFailed;
await sleep(2500);
paneFailed = (await viewHolds('全部')) || paneFailed;
await sleep(1500);

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

/* And back, which must restore the gallery's remembered offset — the fallback must not cost the
   memory that makes leaving a list and returning land on the same row. */
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
let failed = paneFailed;
if (gallery && !gallery.concealed) {
  console.error(`\nFAIL: the gallery pane is still shown (display ${gallery.display}) after the switch`);
  failed = true;
}
if (forum && Math.abs(after.panelH - forum.h) > 2) {
  console.error(
    `\nFAIL: the panel is ${after.panelH}px but the forum pane needs ${forum.h}px — ` +
      `something else is holding the height`,
  );
  failed = true;
}
/* The offset, which is the reported bug: a tab nobody has opened starts at its own top, so
   anything above a few pixels means the outgoing position carried over. */
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
console.log(failed ? '' : '\nthe whole pane moves, the view row holds the offset, and the panel measures the visible pane');
process.exit(failed ? 1 : 0);
