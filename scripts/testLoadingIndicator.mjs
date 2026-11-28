/**
 * Material 3 Expressive loading indicator geometry, spring physics, shared-clock lifecycle,
 * concealed-pane/inert/hidden wakeup, and SSR/ARIA/utility-conflict contracts.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { test } from 'node:test';
import vm from 'node:vm';
import { transformSync } from '@babel/core';
import compiler from 'babel-plugin-react-compiler';
import ts from 'typescript';
import { requireTypeStripping } from './tsResolve.mjs';

requireTypeStripping('testLoadingIndicator');

const ROOT = path.resolve(import.meta.dirname, '..');
const require = createRequire(import.meta.url);
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');

const indicator = await import('../lib/loadingIndicator.ts');

test('all seven M3E indicator shapes build valid closed cubic rings inside the 100×100 viewBox', () => {
  const shapes = indicator.inspectLoadingShapes();
  assert.equal(shapes.length, indicator.LOADING_SHAPE_COUNT);
  assert.equal(shapes.length, 7);

  const segmentFloats = shapes[0].length;
  assert.equal(segmentFloats % 6, 0, 'each cubic segment carries 6 floats');
  assert.ok(segmentFloats >= 24 * 6, 'sufficient segments for smooth curved lobes');

  for (let s = 0; s < shapes.length; s += 1) {
    const ring = shapes[s];
    assert.equal(ring.length, segmentFloats, `shape ${s} matches segment topology`);
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    for (let i = 0; i < ring.length; i += 2) {
      const x = ring[i];
      const y = ring[i + 1];
      assert.ok(Number.isFinite(x) && Number.isFinite(y), `shape ${s} coordinate ${i} is finite`);
      assert.ok(x >= 0 && x <= 100 && y >= 0 && y <= 100, `shape ${s} stays within 0..100 viewBox`);
      if (i % 6 === 4) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
    const cx = (minX + maxX) / 2;
    const cy = (minY + maxY) / 2;
    assert.ok(Math.abs(cx - 50) < 2 && Math.abs(cy - 50) < 2, `shape ${s} is centred near (50, 50)`);
  }
});

test('standard morph spring overshoots organically while reduced stays critically damped', () => {
  assert.equal(indicator.loadingSpringProgress(0, false), 0);
  assert.equal(indicator.loadingSpringProgress(0, true), 0);

  let standardPeak = 0;
  let reducedPeak = 0;
  for (let ms = 10; ms <= indicator.MORPH_INTERVAL_MS; ms += 10) {
    standardPeak = Math.max(standardPeak, indicator.loadingSpringProgress(ms, false));
    reducedPeak = Math.max(reducedPeak, indicator.loadingSpringProgress(ms, true));
  }
  assert.ok(
    standardPeak > 1.05 && standardPeak < 1.15,
    `standard overshoot matches ζ=0.6 (${standardPeak.toFixed(4)})`,
  );
  assert.ok(reducedPeak <= 1.0001, `reduced motion must never overshoot (${reducedPeak.toFixed(4)})`);

  const standardEnd = indicator.loadingSpringProgress(indicator.MORPH_INTERVAL_MS, false);
  const reducedEnd = indicator.loadingSpringProgress(indicator.MORPH_INTERVAL_MS, true);
  assert.ok(Math.abs(standardEnd - 1) < 0.01, `standard settles at 650 ms (${standardEnd.toFixed(4)})`);
  assert.ok(Math.abs(reducedEnd - 1) < 0.01, `reduced settles at 650 ms (${reducedEnd.toFixed(4)})`);
});

test('sampled frames stay within the 0..100 viewBox through spring overshoot across all seven transitions', () => {
  assert.match(
    indicator.INITIAL_LOADING_PATH,
    /^M[\d.-]+ [\d.-]+(?:C[\d.-]+ [\d.-]+ [\d.-]+ [\d.-]+ [\d.-]+ [\d.-]+)+Z$/,
  );
  for (let step = 0; step < indicator.LOADING_SHAPE_COUNT; step += 1) {
    for (let offset = 0; offset <= indicator.MORPH_INTERVAL_MS; offset += 65) {
      const frame = indicator.sampleLoadingFrame(step * indicator.MORPH_INTERVAL_MS + offset, false);
      assert.match(frame.path, /^M[\d.-]+ [\d.-]+(?:C[\d.-]+ [\d.-]+ [\d.-]+ [\d.-]+ [\d.-]+ [\d.-]+)+Z$/);
      assert.ok(frame.rotationDeg >= 0 && frame.rotationDeg < 360);
      const nums = frame.path.match(/-?\d+(?:\.\d+)?/g).map(Number);
      for (const n of nums) {
        assert.ok(n >= 0 && n <= 100, `step ${step}+${offset}ms coord ${n} stayed inside 0..100`);
      }
    }
  }
  // Consecutive steps advance rotation by ~140° (50° continuous + 90° spring).
  const t0 = indicator.sampleLoadingFrame(0, true);
  const t1 = indicator.sampleLoadingFrame(indicator.MORPH_INTERVAL_MS, true);
  assert.ok(Math.abs(t1.rotationDeg - t0.rotationDeg - 140) < 0.5);
});

test('shared clock suspends and wakes cleanly across concealed panes, inert/hidden toggles, background tabs, custom feedback=off, and idle resets', () => {
  const prevWindow = globalThis.window;
  const prevDocument = globalThis.document;
  const prevElement = globalThis.Element;
  const prevMutationObserver = globalThis.MutationObserver;
  const prevRaf = globalThis.requestAnimationFrame;
  const prevCancelRaf = globalThis.cancelAnimationFrame;
  const prevPerformance = globalThis.performance;

  class FakeElement {
    constructor(attrs = {}, parent = null) {
      this.attrs = new Map(Object.entries(attrs));
      this.parentElement = parent;
      this.isConnected = true;
      this.dataset = {};
    }
    hasAttribute(name) {
      return this.attrs.has(name);
    }
    setAttribute(name, value) {
      this.attrs.set(name, String(value));
    }
    removeAttribute(name) {
      this.attrs.delete(name);
    }
    getAttribute(name) {
      return this.attrs.get(name) ?? null;
    }
    closest(selector) {
      const checks = selector.split(',').map((part) => part.trim());
      for (let node = this; node; node = node.parentElement) {
        for (const sel of checks) {
          const attr = sel.match(/^\[([^\]]+)\]$/)?.[1];
          if (attr && node.hasAttribute(attr)) return node;
        }
      }
      return null;
    }
  }

  const observers = [];
  class FakeMutationObserver {
    constructor(cb) {
      this.cb = cb;
      this.targets = [];
      observers.push(this);
    }
    observe(target) {
      this.targets.push(target);
    }
    disconnect() {
      this.targets = [];
    }
    trigger(target) {
      if (this.targets.includes(target)) this.cb([], this);
    }
  }

  let now = 1000;
  let nextRafId = 1;
  const rafCallbacks = new Map();
  const docRoot = new FakeElement();
  const appRoot = new FakeElement({ 'data-app-root': '' }, docRoot);
  const listeners = new Map();

  globalThis.Element = FakeElement;
  globalThis.MutationObserver = FakeMutationObserver;
  globalThis.window = {};
  globalThis.document = {
    hidden: false,
    documentElement: docRoot,
    addEventListener(type, fn) {
      listeners.set(type, fn);
    },
    removeEventListener(type) {
      listeners.delete(type);
    },
  };
  globalThis.performance = { now: () => now };
  globalThis.requestAnimationFrame = (cb) => {
    const id = nextRafId++;
    rafCallbacks.set(id, cb);
    return id;
  };
  globalThis.cancelAnimationFrame = (id) => {
    rafCallbacks.delete(id);
  };

  try {
    // 1. Indicator inside a concealed tab pane must not spin rAF at all.
    const pane = new FakeElement({ 'data-tab-pane': 'gallery' }, appRoot);
    const pathEl = new FakeElement({}, pane);
    const groupEl = new FakeElement({}, pane);
    const unsub1 = indicator.subscribeLoadingIndicator({ path: pathEl, group: groupEl });
    assert.deepEqual(indicator.getLoadingIndicatorStats(), {
      subscribers: 1,
      active: 0,
      running: false,
    });
    assert.equal(rafCallbacks.size, 0, 'concealed pane starts no rAF loop');

    // 2. Activating the tab pane wakes the clock immediately and paints a synced frame.
    pane.setAttribute('data-tab-pane-active', '');
    for (const obs of observers) obs.trigger(pane);
    assert.deepEqual(indicator.getLoadingIndicatorStats(), {
      subscribers: 1,
      active: 1,
      running: true,
    });
    assert.equal(rafCallbacks.size, 1);

    // Advance 325 ms and run one frame: phase moves off 0°.
    now = 1325;
    const [[id1, cb1]] = [...rafCallbacks.entries()];
    rafCallbacks.delete(id1);
    cb1(now);
    const midTransform = groupEl.getAttribute('transform');
    assert.ok(midTransform && midTransform !== 'rotate(0.0 50 50)', `animated rotation advanced (${midTransform})`);

    // 3. Same-commit handoff (< 120 ms gap) preserves phase seamlessly.
    unsub1();
    now = 1340;
    const pathEl2 = new FakeElement({}, appRoot);
    const groupEl2 = new FakeElement({}, appRoot);
    const unsub2 = indicator.subscribeLoadingIndicator({ path: pathEl2, group: groupEl2 });
    const handoffTransform = groupEl2.getAttribute('transform');
    assert.ok(handoffTransform && handoffTransform !== 'rotate(0.0 50 50)', `handoff kept phase (${handoffTransform})`);

    // 4. Opening an overlay sets `inert` on [data-app-root]: rAF stops; closing clears `inert`
    // even after > 120 ms and resumes from the paused morph phase without snapping back to 0°.
    const transformBeforeInert = groupEl2.getAttribute('transform');
    appRoot.setAttribute('inert', '');
    for (const obs of observers) obs.trigger(appRoot);
    assert.deepEqual(indicator.getLoadingIndicatorStats(), {
      subscribers: 1,
      active: 0,
      running: false,
    });
    assert.equal(rafCallbacks.size, 0, 'inert ancestor pauses rAF immediately');

    now = 3390; // > CLOCK_RESET_IDLE_MS (120 ms) while overlay was open
    appRoot.removeAttribute('inert');
    for (const obs of observers) obs.trigger(appRoot);
    assert.deepEqual(indicator.getLoadingIndicatorStats(), {
      subscribers: 1,
      active: 1,
      running: true,
    });
    assert.equal(rafCallbacks.size, 1, 'removing inert wakes rAF immediately');
    assert.equal(
      groupEl2.getAttribute('transform'),
      transformBeforeInert,
      'resuming a paused live indicator continues smoothly from its paused phase instead of snapping to 0°',
    );

    // Same for `[hidden]` toggling on an ancestor.
    appRoot.setAttribute('hidden', '');
    for (const obs of observers) obs.trigger(appRoot);
    assert.equal(indicator.getLoadingIndicatorStats().running, false);
    now = 3430;
    appRoot.removeAttribute('hidden');
    for (const obs of observers) obs.trigger(appRoot);
    assert.equal(indicator.getLoadingIndicatorStats().running, true);

    // 5. Custom motion tier with data-motion-feedback="off" resets to static SoftBurst and stops rAF.
    docRoot.dataset.motion = 'custom';
    docRoot.dataset.motionFeedback = 'off';
    for (const obs of observers) obs.trigger(docRoot);
    assert.equal(indicator.getLoadingIndicatorStats().running, false);
    assert.equal(pathEl2.getAttribute('d'), indicator.INITIAL_LOADING_PATH);
    assert.equal(groupEl2.getAttribute('transform'), null);

    // Restoring standard tier resumes rAF.
    docRoot.dataset.motion = 'standard';
    delete docRoot.dataset.motionFeedback;
    for (const obs of observers) obs.trigger(docRoot);
    assert.equal(indicator.getLoadingIndicatorStats().running, true);

    // 6. Dormant concealed-pane subscriber must NOT keep rAF running or block idle clock reset.
    const hiddenPane = new FakeElement({ 'data-tab-pane': 'inactive' }, appRoot);
    const dormantPath = new FakeElement({}, hiddenPane);
    const dormantGroup = new FakeElement({}, hiddenPane);
    const unsubDormant = indicator.subscribeLoadingIndicator({
      path: dormantPath,
      group: dormantGroup,
    });
    unsub2(); // Last active subscriber leaves while dormant subscriber stays mounted
    assert.deepEqual(indicator.getLoadingIndicatorStats(), {
      subscribers: 1,
      active: 0,
      running: false,
    });
    assert.equal(rafCallbacks.size, 0, 'dropping last active subscriber stops rAF even with dormant sibling');

    // After > 120 ms idle (with dormant subscriber still mounted), a fresh active indicator starts cleanly at 0°.
    now = 5000;
    const pathEl3 = new FakeElement({}, appRoot);
    const groupEl3 = new FakeElement({}, appRoot);
    const unsub3 = indicator.subscribeLoadingIndicator({ path: pathEl3, group: groupEl3 });
    assert.equal(groupEl3.getAttribute('transform'), 'rotate(0.0 50 50)');
    unsub3();
    unsubDormant();

    // 7. Subscribing while document.hidden === true must not stamp originTime prematurely.
    globalThis.document.hidden = true;
    now = 8000;
    const bgPath = new FakeElement({}, appRoot);
    const bgGroup = new FakeElement({}, appRoot);
    const unsubBg = indicator.subscribeLoadingIndicator({ path: bgPath, group: bgGroup });
    assert.equal(indicator.getLoadingIndicatorStats().running, false);
    assert.equal(bgGroup.getAttribute('transform'), null, 'hidden document skips initial paint');
    now = 12000;
    globalThis.document.hidden = false;
    listeners.get('visibilitychange')?.();
    assert.equal(indicator.getLoadingIndicatorStats().running, true);
    assert.equal(bgGroup.getAttribute('transform'), 'rotate(0.0 50 50)', 'returning to tab starts freshly at 0°');
    unsubBg();

    // 8. Pooled scroll-root IntersectionObserver pauses off-screen targets via `data-m3e-offscreen`
    // and wakes them immediately on scroll-in without React re-renders.
    const prevIO = globalThis.IntersectionObserver;
    const ioInstances = [];
    class FakeIO {
      constructor(cb, opts) {
        this.cb = cb;
        this.opts = opts;
        this.targets = new Set();
        this.disconnected = false;
        ioInstances.push(this);
      }
      observe(el) {
        this.targets.add(el);
      }
      unobserve(el) {
        this.targets.delete(el);
      }
      disconnect() {
        this.disconnected = true;
        this.targets.clear();
      }
      emit(entries) {
        this.cb(entries, this);
      }
    }
    globalThis.IntersectionObserver = FakeIO;
    try {
      const scroller = new FakeElement({ 'data-image-hero-gallery-scroll': '' }, appRoot);
      const hostA = new FakeElement({}, scroller);
      const pathA = new FakeElement({}, hostA);
      const groupA = new FakeElement({}, hostA);
      const hostB = new FakeElement({}, scroller);
      const pathB = new FakeElement({}, hostB);
      const groupB = new FakeElement({}, hostB);

      const unsubA = indicator.subscribeLoadingIndicator({
        path: pathA,
        group: groupA,
        observe: hostA,
      });
      const unsubB = indicator.subscribeLoadingIndicator({
        path: pathB,
        group: groupB,
        observe: hostB,
      });
      assert.equal(ioInstances.length, 1, 'siblings under one scroll root share a single observer');
      assert.equal(ioInstances[0].opts.root, scroller);
      assert.equal(hostA.hasAttribute('data-m3e-offscreen'), true);
      assert.equal(indicator.getLoadingIndicatorStats().running, false, 'off-screen cards do not spin rAF');

      // Scroll brings hostA into view: wakes immediately and clears data-m3e-offscreen.
      now = 15000;
      ioInstances[0].emit([{ target: hostA, isIntersecting: true }]);
      assert.equal(hostA.hasAttribute('data-m3e-offscreen'), false);
      assert.equal(hostB.hasAttribute('data-m3e-offscreen'), true);
      assert.deepEqual(indicator.getLoadingIndicatorStats(), {
        subscribers: 2,
        active: 1,
        running: true,
      });
      assert.ok(groupA.getAttribute('transform')?.startsWith('rotate('));

      // Advance active clock so hostA moves off 0°, then mount an observed handoff sibling:
      // it must pre-paint the live morph phase on frame 0 before IntersectionObserver fires.
      now = 15325;
      for (const [id, cb] of [...rafCallbacks.entries()]) {
        rafCallbacks.delete(id);
        cb(now);
      }
      const liveTransform = groupA.getAttribute('transform');
      assert.ok(liveTransform && liveTransform !== 'rotate(0.0 50 50)');
      const hostC = new FakeElement({}, scroller);
      const pathC = new FakeElement({}, hostC);
      const groupC = new FakeElement({}, hostC);
      const unsubC = indicator.subscribeLoadingIndicator({
        path: pathC,
        group: groupC,
        observe: hostC,
      });
      assert.equal(
        groupC.getAttribute('transform'),
        liveTransform,
        'observed handoff pre-paints live phase on frame 0',
      );
      assert.equal(hostC.hasAttribute('data-m3e-offscreen'), true, 'still waits for IO before marking inView');
      unsubC();

      // Scrolling hostA back out pauses rAF and restores data-m3e-offscreen.
      ioInstances[0].emit([{ target: hostA, isIntersecting: false }]);
      assert.equal(hostA.hasAttribute('data-m3e-offscreen'), true);
      assert.deepEqual(indicator.getLoadingIndicatorStats(), {
        subscribers: 2,
        active: 0,
        running: false,
      });

      unsubA();
      assert.equal(hostA.hasAttribute('data-m3e-offscreen'), false, 'unsubscribe cleans up offscreen attribute');
      assert.equal(ioInstances[0].disconnected, false);
      unsubB();
      assert.equal(ioInstances[0].disconnected, true, 'last unsubscribe disconnects pooled observer');
    } finally {
      globalThis.IntersectionObserver = prevIO;
    }
  } finally {
    globalThis.window = prevWindow;
    globalThis.document = prevDocument;
    globalThis.Element = prevElement;
    globalThis.MutationObserver = prevMutationObserver;
    globalThis.requestAnimationFrame = prevRaf;
    globalThis.cancelAnimationFrame = prevCancelRaf;
    globalThis.performance = prevPerformance;
  }
});

function loadComponent(file, imports) {
  const source = readFileSync(path.join(ROOT, file), 'utf8');
  const compiled = transformSync(source, {
    filename: path.basename(file),
    configFile: false,
    babelrc: false,
    parserOpts: { plugins: ['typescript', 'jsx'] },
    plugins: [[compiler, { target: '19' }]],
  }).code;
  const code = ts.transpileModule(compiled, {
    compilerOptions: {
      jsx: ts.JsxEmit.ReactJSX,
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText;
  const mod = { exports: {} };
  const resolve = (specifier) => {
    if (specifier in imports) return imports[specifier];
    if (specifier === 'react' || specifier.startsWith('react/') || specifier.startsWith('react-compiler-runtime')) {
      return require(specifier);
    }
    throw new Error(`${file} imports ${specifier}, which this test does not provide`);
  };
  vm.runInThisContext(`(function (exports, require, module) {${code}\n})`, { filename: file })(
    mod.exports,
    resolve,
    mod,
  );
  return mod.exports;
}

test('LoadingIndicator, MediaLoadingPlaceholder and PageLoadingIndicator honour SSR, ARIA, delay, min-h and 2D sizing contracts', () => {
  const mod = loadComponent('components/LoadingIndicator.tsx', {
    '@/lib/loadingIndicator': indicator,
    '@/lib/utils': { cn: (...parts) => parts.filter(Boolean).join(' ') },
  });
  const LoadingIndicator = mod.default;
  const { MediaLoadingPlaceholder, PageLoadingIndicator } = mod;

  const containedHtml = renderToStaticMarkup(
    React.createElement(LoadingIndicator, { variant: 'contained', label: '正在加载' }),
  );
  assert.match(containedHtml, /role="progressbar"/);
  assert.match(containedHtml, /aria-label="正在加载"/);
  assert.match(containedHtml, /bg-primary-container/);
  assert.match(containedHtml, /size-12/);

  // Explicit w-/h- override must not emit competing default size-10.
  const customSizeHtml = renderToStaticMarkup(
    React.createElement(LoadingIndicator, { className: 'w-6 h-6', decorative: true }),
  );
  assert.doesNotMatch(customSizeHtml, /\bsize-10\b/);

  // Responsive MediaLoadingPlaceholder delegates display/size to 2D @container CSS without conflicting utilities.
  const mediaHtml = renderToStaticMarkup(React.createElement(MediaLoadingPlaceholder));
  assert.match(mediaHtml, /data-loading-placeholder=""/);
  assert.match(mediaHtml, /media-loading-placeholder/);
  assert.match(mediaHtml, /aria-hidden="true"/);
  assert.match(mediaHtml, /data-indicator-responsive="default"/);
  const indicatorClass = mediaHtml.match(/class="([^"]*m3e-loading-indicator[^"]*)"/)?.[1] ?? '';
  assert.ok(indicatorClass.includes('media-loading-responsive'), 'uses 2D container-query responsive sizing');
  assert.ok(!/(?:^|\s)inline-flex(?:\s|$)/.test(indicatorClass), 'no competing unconditional inline-flex');
  assert.ok(!/(?:^|\s)size-10(?:\s|$)/.test(indicatorClass), 'no competing unconditional size-10');

  // Explicit-size MediaLoadingPlaceholder omits `media-loading-placeholder` (`container-type: size`).
  const fixedMediaHtml = renderToStaticMarkup(
    React.createElement(MediaLoadingPlaceholder, { variant: 'contained', size: 'md' }),
  );
  assert.doesNotMatch(fixedMediaHtml, /media-loading-placeholder/);
  assert.match(fixedMediaHtml, /\bsize-12\b/);

  // Quiet MediaLoadingPlaceholder renders only the neutral plate (no SVG glyph or size containment).
  const quietHtml = renderToStaticMarkup(React.createElement(MediaLoadingPlaceholder, { quiet: true }));
  assert.match(quietHtml, /data-loading-placeholder=""/);
  assert.doesNotMatch(quietHtml, /media-loading-placeholder/);
  assert.doesNotMatch(quietHtml, /<svg/);

  // Default MediaLoadingPlaceholder paints immediately at full opacity (no scroll-in blank delay).
  assert.match(mediaHtml, /opacity-100/);
  assert.doesNotMatch(mediaHtml, /m3e-loading-paused/);

  // Settled MediaLoadingPlaceholder with instantHide drops the glyph immediately without waiting for a fade.
  const settledHtml = renderToStaticMarkup(
    React.createElement(MediaLoadingPlaceholder, { settled: true, instantHide: true }),
  );
  assert.match(settledHtml, /transition-none/);
  assert.match(settledHtml, /opacity-0/);
  assert.match(settledHtml, /m3e-loading-paused/);

  // Settled MediaLoadingPlaceholder without instantHide uses split dismissal class and scales down gently.
  const smoothSettledHtml = renderToStaticMarkup(React.createElement(MediaLoadingPlaceholder, { settled: true }));
  assert.match(smoothSettledHtml, /m3e-loading-dismiss/);
  assert.match(smoothSettledHtml, /scale-90/);
  assert.match(smoothSettledHtml, /opacity-0/);

  // Immediate PageLoadingIndicator renders its visible loading remark, defaults `page` to `lg` (64dp), and holds footer on SSR.
  const pageHtml = renderToStaticMarkup(
    React.createElement(PageLoadingIndicator, {
      size: 'page',
      holdFooter: true,
      label: '正在加载页面…',
    }),
  );
  assert.match(pageHtml, /role="status"/);
  assert.match(pageHtml, /data-page-loading=""/);
  assert.match(pageHtml, /min-h-\[50dvh\]/);
  assert.match(pageHtml, /size-16/);
  assert.match(pageHtml, /<p[^>]*text-body-m[^>]*>正在加载页面…<\/p>/);

  // `showLabel: false` keeps accessible speech in `sr-only` for ultra-narrow rails.
  const compactRailHtml = renderToStaticMarkup(
    React.createElement(PageLoadingIndicator, {
      size: 'inline',
      showLabel: false,
      label: '正在加载联系人…',
    }),
  );
  assert.match(compactRailHtml, /class="sr-only">正在加载联系人…<\/span>/);

  // Caller `min-h-*` overrides default `min-h-[32dvh]` cleanly (no Tailwind v4 arbitrary-utility conflict).
  const overrideMinH = renderToStaticMarkup(
    React.createElement(PageLoadingIndicator, { size: 'pane', className: 'min-h-80' }),
  );
  assert.match(overrideMinH, /\bmin-h-80\b/);
  assert.doesNotMatch(overrideMinH, /min-h-\[32dvh\]/);

  // Delayed PageLoadingIndicator holds layout box, remark line height and footer while withholding premature live-region speech and glyph flash.
  const delayedPageHtml = renderToStaticMarkup(
    React.createElement(PageLoadingIndicator, {
      size: 'pane',
      holdFooter: true,
      delay: 160,
      label: '正在加载设置…',
    }),
  );
  assert.match(delayedPageHtml, /role="status"/);
  assert.match(delayedPageHtml, /data-page-loading=""/);
  assert.doesNotMatch(delayedPageHtml, /正在加载设置…/);
  assert.match(delayedPageHtml, /m3e-loading-reveal/);
  assert.match(delayedPageHtml, /scale-90/);
  assert.match(delayedPageHtml, /opacity-0/);
  assert.match(delayedPageHtml, /m3e-loading-paused/);
  assert.match(delayedPageHtml, /<p aria-hidden="true"[^>]*opacity-0/);

  // Skeleton emits zero-lag negative phase custom property (`--skeleton-delay`) and `skeleton-overlay` for overlay sweeps.
  const skeletonMod = loadComponent('components/Skeleton.tsx', {
    '@/lib/utils': { cn: (...parts) => parts.filter(Boolean).join(' ') },
  });
  const Skeleton = skeletonMod.default;
  const staggeredSkeletonHtml = renderToStaticMarkup(
    React.createElement(Skeleton, { delay: 1720, className: 'h-4 w-24' }),
  );
  assert.match(staggeredSkeletonHtml, /--skeleton-delay:120ms/);
  assert.match(staggeredSkeletonHtml, /bg-surface-container-high/);

  const overlaySkeletonHtml = renderToStaticMarkup(
    React.createElement(Skeleton, { variant: 'overlay', className: 'absolute inset-0' }),
  );
  assert.match(overlaySkeletonHtml, /skeleton-overlay/);
  assert.doesNotMatch(overlaySkeletonHtml, /bg-surface-container-high/);

  // ImageGridSkeleton renders one centred large indicator with a visible remark (no guessed masonry tiles),
  // and keeps only slot #0's known cover alongside the indicator when `seedCover` is provided.
  const gridSkeletonMod = loadComponent('components/ImageGridSkeleton.tsx', {
    '@/lib/utils': { cn: (...parts) => parts.filter(Boolean).join(' ') },
    '@/lib/masonry': {
      clampedCardAspect: () => 0.75,
      MASONRY_CARD_SIZES: '200px',
      MASONRY_MAX_RATIO: 2.2,
      masonryLayout: (items) => ({ grid: {}, items: items.map(() => ({})) }),
      noteSkeletonReplaced: () => {},
    },
    '@/components/FadeInImage': {
      default: ({ src }) => React.createElement('img', { src, alt: '' }),
    },
    '@/components/LoadingIndicator': mod,
  });
  const ImageGridSkeleton = gridSkeletonMod.default;
  const gridHtml = renderToStaticMarkup(React.createElement(ImageGridSkeleton, { count: 50 }));
  assert.match(gridHtml, /data-grid-loading=""/);
  assert.match(gridHtml, /data-page-loading=""/);
  assert.match(gridHtml, /size-16/);
  assert.match(gridHtml, /正在加载图片…/);
  assert.doesNotMatch(gridHtml, /data-grid-placeholder/);
  assert.doesNotMatch(gridHtml, /\bskeleton\b/);

  const seededGridHtml = renderToStaticMarkup(
    React.createElement(ImageGridSkeleton, {
      count: 50,
      seedCover: {
        id: 42,
        src: 'https://example.invalid/42.png',
        width: 1600,
        height: 1200,
        animated: false,
      },
    }),
  );
  assert.match(seededGridHtml, /data-folder-seed-cover="42"/);
  assert.match(seededGridHtml, /正在加载图片…/);
  assert.doesNotMatch(seededGridHtml, /data-grid-placeholder/);
});
