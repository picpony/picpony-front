/** The shell's pure contracts: masonry placement, the home pill's history model, the tab strip's motion, the maintenance read. */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';

function load(file, dependencies = {}, globals = {}) {
  const source = ts.transpileModule(readFileSync(new URL(`../${file}`, import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  const exports = {};
  vm.runInNewContext(source, {
    exports,
    require(name) {
      assert.ok(name in dependencies, `Unexpected dependency: ${name}`);
      return dependencies[name];
    },
    ...globals,
  }, { filename: file });
  return exports;
}

const flush = () => new Promise((resolve) => setImmediate(resolve));

// A picture opened without a hero flight still remembers its original list after visiting
// another route. The shell must not reinterpret the route just left as the picture's source.
test('plain detail origins follow history entries across a visit to another page', () => {
  const window = { location: { pathname: '/pic/7', search: '' }, history: { state: { tree: ['search', 'q=pony'] } },
    navigation: { currentEntry: { key: 'picture-a' } } };
  const memory = load('lib/detailBackground.ts', { '@/lib/historyLayers': { isHistoryLayerState: s => Boolean(s?.layer) } }, { window });
  memory.rememberDetailBackground('/pic/7', { pathname: '/search', search: 'q=pony&page=3' });
  window.location.pathname = '/admin';
  window.navigation.currentEntry.key = 'admin';
  memory.rememberDetailBackground('/pic/7', { pathname: '/admin', search: '' });
  assert.equal(memory.readDetailBackground('/pic/7'), null, 'a pending old render cannot name a new entry');
  window.location.pathname = '/pic/7';
  window.navigation.currentEntry.key = 'picture-a';
  window.history.state = { tree: ['search', 'q=pony'], replaced: true };
  assert.equal(memory.readDetailBackground('/pic/7').pathname, '/search');
  assert.equal(memory.readDetailBackground('/pic/7').search, 'q=pony&page=3');
  window.navigation.currentEntry.key = 'picture-b';
  window.history.state = { tree: ['favorites', '12'] };
  memory.rememberDetailBackground('/pic/7', { pathname: '/favorites/folder/12', search: 'page=2' });
  assert.equal(memory.readDetailBackground('/pic/7').pathname, '/favorites/folder/12');
  window.navigation.currentEntry.key = 'picture-a';
  assert.equal(memory.readDetailBackground('/pic/7').pathname, '/search');
});

test('without Navigation API, opaque restored state separates one picture opened from two queries', () => {
  const window = { location: { pathname: '/pic/7', search: '' }, history: { state: { tree: ['search', { q: 'first' }] } } };
  const memory = load('lib/detailBackground.ts', { '@/lib/historyLayers': { isHistoryLayerState: s => Boolean(s?.layer) } }, { window });
  memory.rememberDetailBackground('/pic/7', { pathname: '/search', search: 'q=first' });
  window.history.state = { tree: ['search', { q: 'second' }] };
  memory.rememberDetailBackground('/pic/7', { pathname: '/search', search: 'q=second' });
  assert.equal(memory.readDetailBackground('/pic/7').search, 'q=second');
  window.history.state = JSON.parse('{"tree":["search",{"q":"first"}]}');
  assert.equal(memory.readDetailBackground('/pic/7').search, 'q=first');
  window.history.state = { layer: true, tree: ['search', { q: 'first' }] };
  memory.rememberDetailBackground('/pic/7', { pathname: '/admin', search: '' });
  assert.equal(memory.readDetailBackground('/pic/7'), null, 'modal entries have no origin of their own');
  window.history.state = { tree: ['search', { q: 'first' }] };
  assert.equal(memory.readDetailBackground('/pic/7').search, 'q=first');
});

test('server rendering never reads or records another browser document’s detail origin', () => {
  const memory = load('lib/detailBackground.ts', { '@/lib/historyLayers': { isHistoryLayerState: () => false } });
  memory.rememberDetailBackground('/pic/7', { pathname: '/search', search: 'q=private' });
  assert.equal(memory.readDetailBackground('/pic/7'), null);
});

test('Next restored-tree refresh hints cannot change a no-Navigation-API detail origin', () => {
  const state = (query, restored = false) => ({ __NA: true, __PRIVATE_NEXTJS_INTERNALS_TREE: {
    tree: ['', {
      children: ['search', { children: [`__PAGE__?${JSON.stringify({ q: query })}`, {}, restored ? [`/search?q=${query}`, `?q=${query}`] : null, null, 4096] }, null, null, 4096],
      imageDetail: ['(__SLOT__)', { children: ['(.)pic', { children: [['id', '7', 'd', []], { children: ['__PAGE__', {}, null, null, 4096] }, null, null, 4096] }, null, null, 4096] }, null, null, 4096],
    }, null, null, restored ? 4116 : 4096], renderedSearch: '',
  } });
  const window = { location: { pathname: '/pic/7', search: '' }, history: { state: state('first') } };
  const memory = load('lib/detailBackground.ts', { '@/lib/historyLayers': { isHistoryLayerState: () => false } }, { window });
  memory.rememberDetailBackground('/pic/7', { pathname: '/search', search: 'q=first' });
  window.history.state = state('second');
  memory.rememberDetailBackground('/pic/7', { pathname: '/search', search: 'q=second' });
  window.history.state = state('first', true);
  assert.equal(memory.readDetailBackground('/pic/7').search, 'q=first');
  window.history.state = state('second', true);
  assert.equal(memory.readDetailBackground('/pic/7').search, 'q=second');
});

// --- lib/masonry.ts -----------------------------------------------------------------------

test('masonry places every card for all three column counts, shortest column first', () => {
  const { masonryLayout, MASONRY_COLUMN_COUNTS } = load('lib/masonry.ts', { '@/lib/utils': { clamp: (v, lo, hi) => Math.min(hi, Math.max(lo, v)) } }, { queueMicrotask });
  assert.deepEqual([...MASONRY_COLUMN_COUNTS], [2, 3, 4]);
  // Aspect ratios (height / width): 1, 2, 0.5, 1, 1.5
  const items = [
    { width: 100, height: 100 },
    { width: 100, height: 200 },
    { width: 200, height: 100 },
    { width: 50, height: 50 },
    { width: 100, height: 150 },
  ];
  const { grid, items: placed } = masonryLayout(items);
  assert.equal(placed.length, items.length);

  // Two columns: 0→c0, 1→c1, 2→c0 (1 < 2), 3→c0 (1.5 < 2), 4→c1 (2 < 2.5).
  assert.deepEqual(placed.map((p) => p['--mc2']), ['0', '1', '0', '0', '1']);
  assert.deepEqual(placed.map((p) => p['--ma2']), ['0', '0', '1', '1.5', '2']);
  assert.deepEqual(placed.map((p) => p['--mk2']), ['0', '0', '1', '2', '1']);
  assert.equal(
    grid['--mh2'],
    'max(calc(2.5 * var(--masonry-w) + 2 * var(--masonry-gap)), calc(3.5 * var(--masonry-w) + 1 * var(--masonry-gap)))',
  );

  // Four columns: the first four take one column each (ties go left), the fifth the shortest.
  assert.deepEqual(placed.map((p) => p['--mc4']), ['0', '1', '2', '3', '2']);
  assert.equal(placed[4]['--ma4'], '0.5');
  assert.equal(placed[4]['--mk4'], '1');

  // The server and the client must serialise the identical strings.
  assert.equal(JSON.stringify(masonryLayout(items)), JSON.stringify({ grid, items: placed }));
});

test('masonry treats a card without dimensions as square and an empty grid as zero height', () => {
  const { masonryLayout } = load('lib/masonry.ts', { '@/lib/utils': { clamp: (v, lo, hi) => Math.min(hi, Math.max(lo, v)) } }, { queueMicrotask });
  const { grid, items } = masonryLayout([{}, { width: 0, height: 0 }]);
  assert.deepEqual(items.map((p) => p['--mc2']), ['0', '1']);
  assert.equal(grid['--mh3'], 'max(calc(1 * var(--masonry-w) + 0 * var(--masonry-gap)), calc(1 * var(--masonry-w) + 0 * var(--masonry-gap)))');
  assert.equal(masonryLayout([]).grid['--mh2'], '0px');
  const one = masonryLayout([{ width: 100, height: 50 }]);
  assert.equal(one.grid['--mh4'], 'calc(0.5 * var(--masonry-w) + 0 * var(--masonry-gap))');
});

// --- lib/homeTabs.ts ----------------------------------------------------------------------

function fakeBrowser(entries, index) {
  const list = entries.map((url) => ({ url }));
  const calls = [];
  const listeners = new Map();
  const origin = 'http://app.test';
  const location = {
    origin,
    get pathname() { return new URL(list[index].url, origin).pathname; },
    get search() { return new URL(list[index].url, origin).search; },
  };
  const history = {
    get length() { return list.length; },
    pushState(_state, _title, url) {
      calls.push(['push', url]);
      list.splice(index + 1, Infinity, { url });
      index += 1;
    },
    replaceState(_state, _title, url) {
      calls.push(['replace', url]);
      list[index] = { url };
    },
    back() {
      calls.push(['back']);
      index -= 1;
      setImmediate(() => (listeners.get('popstate') ?? []).forEach((fn) => fn()));
    },
  };
  const window = {
    location,
    history,
    navigation: {
      get currentEntry() { return { url: new URL(list[index].url, origin).href, index }; },
      entries: () => list.map((entry, i) => ({ url: new URL(entry.url, origin).href, index: i })),
    },
    addEventListener(type, fn) { listeners.set(type, [...(listeners.get(type) ?? []), fn]); },
    removeEventListener(type, fn) { listeners.set(type, (listeners.get(type) ?? []).filter((f) => f !== fn)); },
    /* A frame and a task, each one turn of the event loop here — the write waits for both. */
    requestAnimationFrame: (fn) => setImmediate(fn),
    cancelAnimationFrame: (handle) => clearImmediate(handle),
    setTimeout: (fn) => setImmediate(fn),
    clearTimeout: (handle) => clearImmediate(handle),
  };
  const dispatch = (type) => (listeners.get(type) ?? []).forEach((fn) => fn());
  return { window, calls, dispatch, url: () => list[index].url, index: () => index };
}

/* Long enough for the settled overlay check, the frame and the task behind it. */
const settle = async () => {
  for (let i = 0; i < 6; i += 1) await flush();
};

function loadHomeTabs(browser) {
  return load('lib/homeTabs.ts', {
    '@/lib/historyLayers': { settleHistoryLayers: () => Promise.resolve() },
  }, { window: browser.window, URL, URLSearchParams });
}

test('the home pill pushes 论坛 once and goes back to 图库, never accumulating entries', async () => {
  const browser = fakeBrowser(['/settings', '/'], 1);
  const tabs = loadHomeTabs(browser);
  tabs.writeHomeTab('forum');
  await settle();
  assert.deepEqual(browser.calls, [['push', '/?tab=forum']]);
  tabs.writeHomeTab('gallery');
  await settle();
  assert.deepEqual(browser.calls.at(-1), ['back']);
  assert.equal(browser.url(), '/');
  tabs.writeHomeTab('forum');
  await settle();
  assert.deepEqual(browser.calls.at(-1), ['push', '/?tab=forum']);
  assert.equal(browser.window.history.length, 3, 'the forward entry is replaced, not stacked');
});

test('论坛 reached from another screen goes to 图库 by replacing, so Back still leaves', async () => {
  const browser = fakeBrowser(['/about', '/?tab=forum'], 1);
  const tabs = loadHomeTabs(browser);
  tabs.writeHomeTab('gallery');
  await settle();
  assert.deepEqual(browser.calls, [['replace', '/']]);
});

test('a burst of taps settles on the last one', async () => {
  const browser = fakeBrowser(['/'], 0);
  const tabs = loadHomeTabs(browser);
  tabs.writeHomeTab('forum');
  tabs.writeHomeTab('gallery');
  await settle();
  assert.deepEqual(browser.calls, [], 'the last request is the tab already shown');
});

test('the write waits for the first frame of the tap, not for its own task', async () => {
  const browser = fakeBrowser(['/'], 0);
  const tabs = loadHomeTabs(browser);
  tabs.writeHomeTab('forum');
  await Promise.resolve();
  await Promise.resolve();
  assert.deepEqual(browser.calls, [], 'nothing written inside the tap');
  await settle();
  assert.deepEqual(browser.calls, [['push', '/?tab=forum']]);
});

test('the next input writes a waiting URL at once, before its own handlers run', async () => {
  const browser = fakeBrowser(['/'], 0);
  const tabs = loadHomeTabs(browser);
  tabs.writeHomeTab('forum');
  await Promise.resolve();
  await Promise.resolve();
  browser.dispatch('pointerdown');
  assert.deepEqual(browser.calls, [['push', '/?tab=forum']], 'written synchronously by the pointerdown');
  await settle();
  assert.equal(browser.calls.length, 1, 'and only once');
});

test('a traversal before the frame cancels the waiting write', async () => {
  const browser = fakeBrowser(['/'], 0);
  const tabs = loadHomeTabs(browser);
  tabs.writeHomeTab('forum');
  await Promise.resolve();
  await Promise.resolve();
  browser.dispatch('popstate');
  await settle();
  assert.deepEqual(browser.calls, [], 'the entry it was meant for is gone');
  tabs.writeHomeTab('forum');
  await settle();
  assert.deepEqual(browser.calls, [['push', '/?tab=forum']], 'and the next request writes normally');
});

test('a cold entry at /?tab=forum gets the gallery put beneath it, once', async () => {
  const browser = fakeBrowser(['/?tab=forum&sort=score'], 0);
  const tabs = loadHomeTabs(browser);
  tabs.ensureHomeBackStack();
  await flush();
  assert.deepEqual(browser.calls, [['replace', '/?sort=score'], ['push', '/?tab=forum&sort=score']]);
  tabs.ensureHomeBackStack();
  await flush();
  assert.equal(browser.calls.length, 2, 'idempotent: the forum entry is no longer the first');

  const later = fakeBrowser(['/about', '/?tab=forum'], 1);
  loadHomeTabs(later).ensureHomeBackStack();
  await flush();
  assert.deepEqual(later.calls, [], 'an entry with the app behind it is left alone');
});

test('home tab URLs keep every other parameter', () => {
  const browser = fakeBrowser(['/'], 0);
  const tabs = loadHomeTabs(browser);
  assert.equal(tabs.homeTabHref('forum', '?sort=score'), '/?sort=score&tab=forum');
  assert.equal(tabs.homeTabHref('gallery', '?tab=forum&sort=score'), '/?sort=score');
  assert.equal(tabs.homeTabHref('gallery', ''), '/');
  assert.equal(tabs.homeTabOf('?tab=forum'), 'forum');
  assert.equal(tabs.homeTabOf('?tab=nonsense'), 'gallery');
});

// --- lib/tabStrip.ts ---------------------------------------------------------------------

function loadStrip() {
  const spring = load('lib/spring.ts');
  return load('lib/tabStrip.ts', {
    '@/lib/spring': spring,
    '@/lib/utils': { clamp01: (v) => Math.min(1, Math.max(0, v)) },
  });
}

const FRAME_MS = 1000 / 60;

/** Per-frame travel of a leg at 60 Hz, as fractions of the window, toward its own target. */
function framesOf(strip, leg, count) {
  const out = [];
  let previous = strip.stripPose(leg, 0).p;
  for (let k = 1; k <= count; k += 1) {
    const { p } = strip.stripPose(leg, k * FRAME_MS);
    out.push((p - previous) * Math.sign(leg.to - leg.from));
    previous = p;
  }
  return out;
}

test('the tab strip moves in the first frame after a tap and never lurches', () => {
  const strip = loadStrip();
  const full = strip.STRIP_DURATION_MS;
  const leg = strip.freshStripLeg(full);
  const first = framesOf(strip, leg, 6);
  /* `emphasized` over 500ms moved 0.9% of the window in its first frame and 23.6% in its sixth:
     nothing, then a lurch — the slow start the owner reported. */
  for (const travel of first) {
    assert.ok(travel >= 0.08 && travel <= 0.12, `first 100ms, per frame: ${first.map((v) => (v * 100).toFixed(1)).join(' ')}%`);
  }
  let t10 = null;
  let previous = 0;
  let largest = 0;
  for (let ms = 0; ms <= full; ms += 1) {
    const { p } = strip.stripPose(leg, ms);
    assert.ok(p >= previous - 1e-12 && p <= 1 + 1e-12, `monotone and never past its end, at ${ms}ms`);
    if (t10 === null && p >= 0.1) t10 = ms;
    previous = p;
  }
  for (const travel of framesOf(strip, leg, Math.ceil(full / FRAME_MS))) largest = Math.max(largest, travel);
  assert.ok(t10 !== null && t10 <= 20, `10% of the way by ${t10}ms`);
  assert.ok(largest <= 0.12, `no frame carries more than 12% of the way (${(largest * 100).toFixed(1)}%)`);
  assert.equal(strip.stripPose(leg, full).p, 1);
});

test('no launch the strip can take overshoots its side', () => {
  const strip = loadStrip();
  for (let launch = 0; launch <= strip.STRIP_MAX_LAUNCH + 1e-9; launch += 0.25) {
    const progress = strip.stripProgress(launch);
    let previous = 0;
    for (let i = 0; i <= 1000; i += 1) {
      const value = progress(i / 1000);
      assert.ok(value <= 1 + 1e-12 && value >= previous - 1e-12, `launch ${launch} at ${i / 1000}`);
      previous = value;
    }
  }
  assert.ok(strip.stripLaunchFor(1e9) <= strip.STRIP_MAX_LAUNCH);
  assert.equal(strip.stripLaunchFor(0), 0);
});

test('a second tap turns the strip from where it is, the other way at once', () => {
  const strip = loadStrip();
  const full = strip.STRIP_DURATION_MS;
  const leg = strip.freshStripLeg(full);
  const fresh = strip.STRIP_LAUNCH / full;
  for (const elapsed of [0, 10, 30, 60, 120, 200, 300, 399, 450]) {
    const before = strip.stripPose(leg, elapsed);
    const next = strip.turnStrip(leg, elapsed, full);
    assert.ok(Math.abs(next.from - before.p) < 1e-12, `continuous at ${elapsed}ms`);
    assert.equal(next.to, 0);
    for (let ms = 0; ms <= next.duration; ms += 2) {
      assert.ok(strip.stripPose(next, ms).p <= before.p + 1e-12, `never the old way, ${elapsed}ms in`);
    }
    if (before.p >= 0.3) {
      const start = strip.stripPose(next, 0).speed;
      assert.ok(start >= fresh * 0.99, `leaves at a fresh tap's speed or more, ${elapsed}ms in`);
      assert.ok(start >= before.speed * 0.95, `and no slower than it was going, ${elapsed}ms in`);
      /* `Animation.reverse` played a late tap back through the tail: 1–1.6% per frame. */
      assert.ok(framesOf(strip, next, 1)[0] >= 0.05, `moves in its first frame, ${elapsed}ms in`);
    }
  }
});

test('rapid alternation starts every leg moving', () => {
  const strip = loadStrip();
  const full = strip.STRIP_DURATION_MS;
  let leg = strip.freshStripLeg(full);
  for (const gap of [250, 250, 250, 120, 120, 60]) {
    leg = strip.turnStrip(leg, gap, full);
    const [first] = framesOf(strip, leg, 1);
    const remaining = Math.abs(leg.to - leg.from);
    assert.ok(first >= Math.min(0.05, remaining * 0.2), `first frame ${(first * 100).toFixed(1)}% of ${(remaining * 100).toFixed(0)}% to go`);
  }
});

test('a block leans by a small continuous function of its height, top first', () => {
  const strip = loadStrip();
  const view = { top: 64, height: 836 };
  assert.equal(strip.leanDelay(64, view.top, view.height), 0);
  assert.equal(strip.leanDelay(64 + 20, view.top, view.height), 0, 'the top band leads, with no delay');
  assert.equal(strip.leanDelay(64 + 2000, view.top, view.height), strip.LEAN_MAX_MS, 'capped below the fold');
  let previous = -1;
  for (let top = 0; top <= 1200; top += 8) {
    const delay = strip.leanDelay(top, view.top, view.height);
    assert.ok(delay >= previous, `never earlier lower down (${top}px)`);
    previous = delay;
  }
  /* Tops within a band — masonry cards that read as one row — share a beat. */
  assert.equal(strip.leanDelay(64 + 640, view.top, view.height), strip.leanDelay(64 + 660, view.top, view.height));
});

test('a leaning block lands exactly where the strip was, and the lean stays within its budget', () => {
  const strip = loadStrip();
  const full = strip.STRIP_DURATION_MS;
  const history = [{ leg: strip.freshStripLeg(full), start: 0 }];
  const delay = strip.LEAN_MAX_MS;
  const samples = strip.lagSamples(history, delay, 0, 0.5 / 1204);
  assert.equal(samples[0][0], 0);
  assert.equal(samples[0][1], 0, 'no lag before the strip moves');
  assert.equal(samples.at(-1)[0], full + delay, 'the block lands one delay after the strip');
  assert.ok(Math.abs(samples.at(-1)[1]) < 1e-12, 'and with no lag left');
  let peak = 0;
  for (const [, lag] of samples) {
    assert.ok(lag >= -1e-12, 'a block never runs ahead of the strip');
    peak = Math.max(peak, lag);
  }
  /* About a sixth of the window: a lean that reads without looking exaggerated (half the old 31%),
     and well inside the old budget of 0.32, past which the top finishes before the bottom starts. */
  assert.ok(peak > 0.12 && peak < 0.2, `peak lean ${(peak * 100).toFixed(1)}% of the window`);
  /* Straight lines between the samples stay within half a pixel of the lag itself. */
  for (let i = 1; i < samples.length; i += 1) {
    const [t0, v0] = samples[i - 1];
    const [t1, v1] = samples[i];
    const mid = (t0 + t1) / 2;
    const exact = strip.stripAt(history, mid) - strip.stripAt(history, mid - delay);
    assert.ok(Math.abs(exact - (v0 + v1) / 2) * 1204 < 0.75, `within tolerance at ${mid.toFixed(1)}ms`);
  }
});

test('a turn carries every leaning block on from where it is, top first', () => {
  const strip = loadStrip();
  const full = strip.STRIP_DURATION_MS;
  const fresh = strip.freshStripLeg(full);
  for (const at of [40, 100, 200, 330]) {
    const turned = strip.turnStrip(fresh, at, full);
    const history = [{ leg: fresh, start: 0 }, { leg: turned, start: at }];
    for (const delay of [8, 24, strip.LEAN_MAX_MS]) {
      const before = strip.stripAt([{ leg: fresh, start: 0 }], at - delay);
      const samples = strip.lagSamples(history, delay, at, 0.5 / 1204);
      /* The block's own position is the strip's, `delay` ago: continuous through the tap. */
      const after = strip.stripAt(history, at) - samples[0][1];
      assert.ok(Math.abs(after - before) < 1e-9, `no jump at the turn (${at}ms, ${delay}ms late)`);
      /* It runs on the old way for its own delay, then follows the new leg — it never starts over. */
      const heading = (t) => strip.stripAt(history, t - delay);
      assert.ok(heading(at + delay * 0.5) >= heading(at) - 1e-9, 'still leaving just after the tap');
      assert.ok(heading(at + delay + 60) < heading(at + delay), 'and on its way back once its delay has passed');
      assert.ok(Math.abs(samples.at(-1)[1]) < 1e-12, 'landing with no lag left');
    }
  }
});

// --- lib/maintenance.server.ts ------------------------------------------------------------

function loadMaintenance({ respond, env = {}, cookie } = {}) {
  const requests = [];
  const fetch = async (url, init) => {
    requests.push({ url, revalidate: init?.next?.revalidate, hasSignal: Boolean(init?.signal) });
    return respond();
  };
  const module = load('lib/maintenance.server.ts', {
    react: { cache: (fn) => fn },
    'next/headers': { cookies: async () => ({ get: (name) => (name === 'devMaintenancePreview' && cookie !== undefined ? { value: cookie } : undefined) }) },
    '@/lib/constants': { PICPONY_API_BASE: '/api.php', PICPONY_API_ORIGIN: 'https://picpony.top' },
    '@/lib/serverMemo': { cacheSeconds: (s) => s },
    '@/lib/upstream.server': { upstreamOrigin: () => 'https://picpony.top' },
  }, { fetch, AbortSignal, process: { env: { NODE_ENV: 'production', ...env } } });
  return { readMaintenance: module.readMaintenance, requests };
}

const json = (body, ok = true) => ({ ok, json: async () => body });

test('the maintenance read reports the switch and the trimmed message', async () => {
  const { readMaintenance, requests } = loadMaintenance({
    respond: () => json({ success: true, maintenance_mode: true, maintenance_message: '  正在维护……  ' }),
  });
  assert.deepEqual({ ...(await readMaintenance()) }, { active: true, message: '正在维护……' });
  assert.equal(requests[0].url, 'https://picpony.top/api.php?action=get_maintenance_status');
  assert.equal(requests[0].revalidate, 30);
  assert.ok(requests[0].hasSignal, 'bounded by a timeout');
});

test('the maintenance read fails open', async () => {
  const cases = [
    () => json({ success: true, maintenance_mode: false, maintenance_message: 'x' }),
    () => json({ success: false, maintenance_mode: true }),
    () => json({ success: true, maintenance_mode: 'true' }),
    () => json({}, false),
    () => { throw new Error('offline'); },
    () => ({ ok: true, json: async () => { throw new SyntaxError('html'); } }),
  ];
  for (const respond of cases) {
    const { readMaintenance } = loadMaintenance({ respond });
    assert.deepEqual({ ...(await readMaintenance()) }, { active: false, message: '' });
  }
  const long = loadMaintenance({ respond: () => json({ success: true, maintenance_mode: true, maintenance_message: '维'.repeat(900) }) });
  assert.equal((await long.readMaintenance()).message.length, 500);
});

test('the development preview cookie is honoured in development only', async () => {
  const dev = loadMaintenance({ env: { NODE_ENV: 'development' }, cookie: encodeURIComponent('预计 30 分钟'), respond: () => json({}) });
  assert.deepEqual({ ...(await dev.readMaintenance()) }, { active: true, message: '预计 30 分钟' });
  assert.equal(dev.requests.length, 0);
  const malformed = loadMaintenance({ env: { NODE_ENV: 'development' }, cookie: '%E4%', respond: () => json({}) });
  assert.equal((await malformed.readMaintenance()).message, '%E4%');
  const prod = loadMaintenance({ cookie: '1', respond: () => json({ success: true, maintenance_mode: false }) });
  assert.equal((await prod.readMaintenance()).active, false);
});
