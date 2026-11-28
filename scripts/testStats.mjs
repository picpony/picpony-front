/** Statistics plot swaps/range commits retain real data. Run: node --test scripts/testStats.mjs. */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';
import { formatChineseDay } from '../lib/statsDates.ts';

const root = path.resolve(import.meta.dirname, '..');

const metrics = {};
vm.runInNewContext(
  ts.transpileModule(readFileSync(path.join(root, 'app/stats/statsMetrics.ts'), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText,
  {
    exports: metrics,
    require: (name) => {
      assert.equal(name, '@/lib/statsDates');
      return { formatChineseDay };
    },
  },
);

const metricFixture = {
  granularity: 'day',
  totals: { users: 990, chinese_tags: 880, posts: 770, comments: 660, favorites: 550, badges: 440 },
  window: { visitors: 17, hits: 140 },
  series: [
    {
      date: '2025-12-29',
      total_users: 90,
      new_users: 7,
      total_chinese_tags: 49,
      new_chinese_tags: 0,
      total_posts: 30,
      new_posts: 3,
      total_comments: 45,
      new_comments: 5,
      total_favorites: 56,
      new_favorites: 6,
      total_badges: 7,
      new_badges: 0,
      visitors: 10,
      hits: 60,
    },
    {
      date: '2026-01-05',
      total_users: 102,
      new_users: 12,
      total_chinese_tags: 51,
      new_chinese_tags: 2,
      total_posts: 31,
      new_posts: 1,
      total_comments: 53,
      new_comments: 8,
      total_favorites: 60,
      new_favorites: 4,
      total_badges: 7,
      new_badges: 0,
      visitors: 12,
      hits: 80,
    },
  ],
};

function entries(section, view, data = metricFixture) {
  const definition = metrics.STATS_SECTIONS.find((item) => item.value === `stats-${section}`);
  const model = metrics.chartMetrics(definition, data, view);
  return [model.overviewLabel, Object.fromEntries(model.series.map(({ key, summary }) => [key, summary]))];
}

test('statistics growth overviews follow the selected buckets rather than the all-time totals', () => {
  assert.deepEqual(entries('users', 'total'), ['区间末累计', { total_users: 102 }]);
  assert.deepEqual(entries('users', 'added'), ['区间新增', { new_users: 19 }]);
  assert.deepEqual(entries('tags', 'total'), ['区间末累计', { total_chinese_tags: 51 }]);
  assert.deepEqual(entries('tags', 'added'), ['区间新增', { new_chinese_tags: 2 }]);
  assert.deepEqual(entries('users', 'total', { ...metricFixture, series: [] }), ['区间末累计', { total_users: null }]);
  assert.deepEqual(entries('users', 'added', { ...metricFixture, series: [] }), ['区间新增', { new_users: null }]);
});

test('traffic keeps server window counts and community metrics stay separate in both views', () => {
  for (const view of ['total', 'added']) {
    assert.deepEqual(entries('visits', view), ['区间合计', { visitors: 17, hits: 140 }]);
  }
  assert.deepEqual(entries('community', 'total'), [
    '区间末累计',
    {
      total_posts: 31,
      total_comments: 53,
      total_favorites: 60,
      total_badges: 7,
    },
  ]);
  assert.deepEqual(entries('community', 'added'), [
    '区间新增',
    {
      new_posts: 4,
      new_comments: 13,
      new_favorites: 10,
      new_badges: 0,
    },
  ]);
});

test('compact tick labels and full inspection labels distinguish days, weeks and months', () => {
  for (const [granularity, tick, detail] of [
    ['day', '1/5', '2026年1月5日'],
    ['week', '1/5', '2026年1月5日当周'],
    ['month', '2026/1', '2026年1月'],
  ]) {
    const [, last] = metrics.chartBuckets({ ...metricFixture, granularity });
    assert.equal(last.key, '2026-01-05');
    assert.equal(last.tick, tick);
    assert.equal(last.detail, detail);
  }
});

function fixture() {
  const slots = [];
  let cursor = 0;
  let dirty = false;
  const react = {
    useState(initial) {
      const index = cursor++;
      if (!(index in slots)) slots[index] = typeof initial === 'function' ? initial() : initial;
      return [
        slots[index],
        (next) => {
          slots[index] = typeof next === 'function' ? next(slots[index]) : next;
          dirty = true;
        },
      ];
    },
    useRef(initial) {
      const index = cursor++;
      return (slots[index] ??= { current: initial });
    },
    useLayoutEffect() {
      cursor++;
    },
  };
  const jsx = (type, props) => ({ type, props });
  const dependencies = {
    react,
    'react/jsx-runtime': { jsx, jsxs: jsx },
    '@/lib/appearance': { useMotionTier: () => 'standard', useMotionScale: () => 1 },
    '@/lib/motionTokens': { TRAVEL_PX: { small: 8 } },
    '@/lib/springTiming': {},
    '@/lib/utils': { cn: (...classes) => classes.filter(Boolean).join(' ') },
  };
  const exports = {};
  const source = ts.transpileModule(readFileSync(path.join(root, 'components/SwapContent.tsx'), 'utf8'), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      jsx: ts.JsxEmit.ReactJSX,
    },
  }).outputText;
  vm.runInNewContext(source, {
    exports,
    require: (name) => {
      assert.ok(name in dependencies, `Unexpected import: ${name}`);
      return dependencies[name];
    },
  });
  return (contentKey, children) => {
    let tree;
    for (let turns = 0; turns < 10; turns++) {
      dirty = false;
      cursor = 0;
      tree = exports.default({ contentKey, children });
      if (!dirty) return tree;
    }
    assert.fail('SwapContent did not settle its derived state');
  };
}

const departing = (tree) => tree.props.children[0]?.props.children;
const arriving = (tree) => tree.props.children[1].props.children;

const range = {};
vm.runInNewContext(
  ts.transpileModule(readFileSync(path.join(root, 'components/slider/range.ts'), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText,
  {
    exports: range,
    require: (name) => {
      assert.equal(name, '@/lib/utils');
      return { clamp: (value, min, max) => Math.min(max, Math.max(min, value)) };
    },
  },
);
const plain = (value) => JSON.parse(JSON.stringify(value));

test('crossing a range handle preserves its stationary endpoint in both directions', () => {
  let next = range.moveRangeHandle({ start: 20, end: 40 }, 'start', 60);
  assert.deepEqual(plain(next), { value: { start: 40, end: 60 }, handle: 'end' });
  next = range.moveRangeHandle(next.value, next.handle, 80);
  assert.deepEqual(plain(next.value), { start: 40, end: 80 });
  next = range.moveRangeHandle(next.value, next.handle, 10);
  assert.deepEqual(plain(next), { value: { start: 10, end: 40 }, handle: 'start' });
  next = range.moveRangeHandle(next.value, next.handle, 5);
  assert.deepEqual(plain(next.value), { start: 5, end: 40 });
});

test('range normalization clamps, orders and snaps without inventing an unreachable step', () => {
  assert.deepEqual(plain(range.normalizeRange({ start: 20, end: -10 }, 0, 10, 3)), {
    start: 0,
    end: 9,
  });
  assert.deepEqual(plain(range.normalizeRange({ start: 0.64, end: 0.26 }, 0, 1, 0.1)), {
    start: 0.3,
    end: 0.6,
  });
  assert.deepEqual(plain(range.normalizeRange({ start: -1, end: 1 }, 0, 0, 1)), {
    start: 0,
    end: 0,
  });
});

test('a chart resize stays still and the next swap leaves from its measured geometry', () => {
  const render = fixture();
  const initial = { width: 720, data: [1, 2] };
  const measured = { width: 310, data: [1, 2] };
  const daily = { width: 310, data: [1, 1] };
  assert.equal(departing(render('total', initial)), undefined);
  const resized = render('total', measured);
  assert.equal(departing(resized), undefined, 'measurement must not create an entrance');
  assert.equal(arriving(resized), measured);
  const swapped = render('daily', daily);
  assert.equal(departing(swapped), measured, 'departure must not revert to the SSR viewBox');
  assert.equal(arriving(swapped), daily);
});

test('a background refresh becomes the snapshot for the next plot view', () => {
  const render = fixture();
  const old = { values: [1, 2] };
  const refreshed = { values: [2, 4] };
  render('total', old);
  assert.equal(departing(render('total', refreshed)), undefined);
  assert.equal(departing(render('daily', { values: [2, 2] })), refreshed);
});

test('a pending plot keeps real curves/axes and its loading overlay updates without a view swap', () => {
  const render = fixture();
  const curves = ['M48,180 L708,30'];
  const axes = ['0', '10', '20', '30', '40'];
  const old = { curves, axes, loading: false };
  const pending = { curves, axes, loading: true };
  const refreshed = { curves: ['M48,170 L708,20'], axes, loading: false };
  render('total', old);
  const held = render('total', pending);
  assert.equal(departing(held), undefined, 'loading alone must not manufacture a plot transition');
  assert.equal(arriving(held), pending, 'the visible plot must immediately receive its overlay');
  assert.equal(arriving(held).curves, curves, 'loading must retain the real data');
  assert.equal(arriving(held).axes, axes);
  const updated = render('total', refreshed);
  assert.equal(departing(updated), undefined, 'new values for the same view are a live update');
  assert.equal(arriving(updated), refreshed);
  assert.equal(departing(render('daily', { curves: ['M48,200 L708,80'], axes })), refreshed);
});

test('rapid view changes preserve the latest incoming plot and inert departure', () => {
  const render = fixture();
  const total = { view: 'total' };
  const daily = { view: 'daily' };
  const latestDaily = { view: 'daily', resized: true };
  render('total', total);
  render('daily', daily);
  const inFlight = render('daily', latestDaily);
  assert.equal(departing(inFlight), total, 'a live update must not replace the current departure');
  const reverse = render('total', total);
  assert.equal(departing(reverse), latestDaily);
  assert.equal(reverse.props.children[0].props.inert, true);
  assert.equal(reverse.props.children[0].props['aria-hidden'], 'true');
  assert.equal(arriving(reverse), total);
});

function hookRuntime() {
  const slots = [];
  let cursor = 0;
  let dirty = false;
  let effects = [];
  let hydrating = false;
  const react = {
    useState(initial) {
      const index = cursor++;
      if (!(index in slots)) slots[index] = typeof initial === 'function' ? initial() : initial;
      return [
        slots[index],
        (next) => {
          const value = typeof next === 'function' ? next(slots[index]) : next;
          if (!Object.is(value, slots[index])) dirty = true;
          slots[index] = value;
        },
      ];
    },
    useRef(initial) {
      return (slots[cursor++] ??= { current: initial });
    },
    useId() {
      return `stats-test-${cursor++}`;
    },
    useCallback(callback) {
      cursor++;
      return callback;
    },
    useSyncExternalStore(_subscribe, read, serverRead) {
      cursor++;
      return hydrating ? serverRead() : read();
    },
    useLayoutEffect(setup, deps) {
      const index = cursor++;
      const previous = slots[index];
      if (!previous || !deps || deps.some((value, i) => !Object.is(value, previous.deps?.[i]))) {
        const effect = { deps, setup, cleanup: null };
        slots[index] = effect;
        effects.push(() => {
          previous?.cleanup?.();
          effect.cleanup = setup();
        });
      }
    },
    // Tested components do not perform passive side effects in these source-only fixtures.
    useEffect() {
      cursor++;
    },
  };
  return {
    react,
    render(component, props, attach, hydrate = false) {
      hydrating = hydrate;
      let tree;
      for (let attempt = 0; attempt < 10; attempt++) {
        cursor = 0;
        dirty = false;
        tree = component(props);
        if (!dirty) break;
        assert.ok(attempt < 9, 'Derived component state did not settle');
      }
      attach(tree);
      const queued = effects;
      effects = [];
      for (const run of queued) run();
      return tree;
    },
    strictReplay() {
      for (const effect of slots.filter((slot) => typeof slot?.setup === 'function')) {
        effect.cleanup?.();
        effect.cleanup = effect.setup();
      }
    },
    unmount() {
      for (const effect of slots.filter((slot) => typeof slot?.setup === 'function')) effect.cleanup?.();
    },
  };
}

function seriesFixture({
  hydrate = false,
  entrance = 'standard',
  feedback = 'standard',
  allowEntrance = true,
  route = false,
  active = true,
  inert = false,
} = {}) {
  const hooks = hookRuntime();
  const modes = { entrance, feedback };
  const scales = { entrance: 1, feedback: 1 };
  const runs = [];
  const timings = [];
  const jsx = (type, props) => ({ type, props });
  const group = {
    ownerSVGElement: { parentElement: {} },
    closest: () => (inert ? {} : null),
    animate(frames, options) {
      const run = {
        frames: plain(frames),
        options: plain(options),
        cancelled: false,
        cancel() {
          this.cancelled = true;
        },
        finish() {
          this.onfinish?.();
        },
      };
      runs.push(run);
      return run;
    },
  };
  const dependencies = {
    react: hooks.react,
    'react/jsx-runtime': { jsx, jsxs: jsx },
    '@/components/EmptyState': {},
    '@/components/Skeleton': {},
    '@/components/SwapContent': {},
    '@/lib/utils': { cn: (...classes) => classes.filter(Boolean).join(' ') },
    '@/lib/format': { formatExactCount: String },
    '@/lib/appearance': {
      entranceMotion: () => allowEntrance,
      useMotionTier: (category) => modes[category],
      useMotionScale: (category) => (modes[category] === 'off' ? 0 : scales[category]),
      scaledMs: (ms, category) => ms * (modes[category] === 'off' ? 0 : scales[category]),
    },
    '@/lib/pageTransit': { routeTransitActive: () => route },
    '@/lib/motionTokens': { HANDOFF_MS: 50 },
    '@/lib/springTiming': {
      springTiming: (role, category) => {
        timings.push({ role, category });
        return { duration: 100 * scales[category], easing: 'linear' };
      },
    },
  };
  const exports = {};
  const source = ts.transpileModule(readFileSync(path.join(root, 'components/StatChart.tsx'), 'utf8'), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      jsx: ts.JsxEmit.ReactJSX,
    },
  }).outputText;
  // Test the private paint component without adding a production export or copying its logic.
  vm.runInNewContext(source + '\nexports.StatSeriesPaint = StatSeriesPaint;', {
    exports,
    require: (name) => {
      assert.ok(name in dependencies, `Unexpected chart dependency: ${name}`);
      return dependencies[name];
    },
  });
  const props = { dataKey: 'total:1,2', active, children: [] };
  const render = (updates = {}, hydration = false) => {
    Object.assign(props, updates);
    return hooks.render(
      exports.StatSeriesPaint,
      props,
      (tree) => {
        tree.props.ref.current = group;
      },
      hydration,
    );
  };
  render({}, hydrate);
  return {
    runs,
    timings,
    modes,
    scales,
    render,
    replay: () => hooks.strictReplay(),
    unmount: () => hooks.unmount(),
  };
}

const animatedProperties = (run) => [...new Set(run.frames.flatMap((frame) => Object.keys(frame)))].sort();

function rangeFixture() {
  const hooks = hookRuntime();
  const drafts = [];
  const commits = [];
  const jsx = (type, props) => ({ type, props });
  const limits = { current: null };
  const paintRef = { current: { getBoundingClientRect: () => ({ left: 0, width: 100 }) } };
  const dependencies = {
    react: hooks.react,
    'react/jsx-runtime': { jsx, jsxs: jsx },
    '@/lib/utils': {
      cn: (...classes) => classes.filter(Boolean).join(' '),
      clamp01: (v) => Math.min(1, Math.max(0, v)),
    },
    '@/components/slider/range': range,
    '@/components/slider/paint': {
      SLIDER_INPUT: '',
      SliderHandle: {},
      SliderPaint: {},
      SliderRail: {},
      SliderTrack: {},
    },
    '@/components/slider/useSliderPaint': {
      useSliderPaint: () => ({
        railRef: paintRef,
        positionRef: paintRef,
        endPositionRef: paintRef,
        activeRef: limits,
        inactiveRef: limits,
        inactiveStartRef: limits,
        queueJump() {},
        cancelJump() {},
        pose: {},
      }),
    },
  };
  const exports = {};
  const source = ts.transpileModule(readFileSync(path.join(root, 'components/RangeSlider.tsx'), 'utf8'), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      jsx: ts.JsxEmit.ReactJSX,
    },
  }).outputText;
  const document = { activeElement: null };
  vm.runInNewContext(source, {
    exports,
    document,
    queueMicrotask,
    require: (name) => {
      assert.ok(name in dependencies, `Unexpected range dependency: ${name}`);
      return dependencies[name];
    },
  });
  let tree;
  const props = {
    min: 0,
    max: 100,
    step: 1,
    value: { start: 20, end: 40 },
    startLabel: 'start',
    endLabel: 'end',
    onCommit: (value) => commits.push(plain(value)),
    onValueChange: (value) => {
      drafts.push(plain(value));
      props.value = plain(value);
      render();
    },
  };
  function inputs() {
    return tree.props.children[0].props.children.slice(0, 2);
  }
  function render() {
    tree = hooks.render(exports.default, props, (next) => {
      for (const input of next.props.children[0].props.children.slice(0, 2)) {
        const node = {
          focus() {
            document.activeElement = node;
          },
          matches: () => false,
        };
        input.props.ref.current = node;
      }
    });
    return tree;
  }
  render();
  return { drafts, commits, render, inputs, props };
}

test('native keyboard/AT commits survive a synchronous controlled draft echo and still deduplicate', () => {
  const control = rangeFixture();
  const change = (handle, value) =>
    control.inputs()[handle].props.onChange({ currentTarget: { value: String(value) } });
  change(0, 21);
  assert.deepEqual(control.drafts, [{ start: 21, end: 40 }]);
  assert.deepEqual(control.commits, [{ start: 21, end: 40 }], 'a parent flush must not swallow the semantic commit');
  change(0, 21);
  control.inputs()[0].props.onBlur();
  assert.equal(control.drafts.length, 1);
  assert.equal(control.commits.length, 1);
  change(1, 41);
  assert.deepEqual(control.commits[1], { start: 21, end: 41 });
  change(0, 60);
  assert.deepEqual(control.commits[2], { start: 41, end: 60 });
  assert.deepEqual(control.drafts[2], { start: 41, end: 60 });
  assert.equal(control.inputs()[0].props.value, 41);
  assert.equal(control.inputs()[1].props.value, 60);
});

test('SSR hydration never re-hides painted stats, but a later data update uses feedback', () => {
  const chart = seriesFixture({ hydrate: true });
  assert.equal(chart.runs.length, 0);
  chart.render(); // useSyncExternalStore adopts its client snapshot after hydration.
  chart.replay();
  assert.equal(chart.runs.length, 0, 'hydration or Strict replay may not invent a first entrance');
  chart.render({ dataKey: 'total:2,4' });
  assert.equal(chart.runs.length, 1);
  assert.deepEqual(chart.timings, [{ role: 'defaultEffects', category: 'feedback' }]);
  assert.deepEqual(animatedProperties(chart.runs[0]), ['clipPath']);
  chart.unmount();
  assert.equal(chart.runs[0].cancelled, true);
});

test('cold stats entrance uses its own category, and resize/Strict replay do not lose unfinished paint', () => {
  const chart = seriesFixture({ entrance: 'reduced', feedback: 'off' });
  assert.deepEqual(animatedProperties(chart.runs[0]), ['opacity']);
  assert.deepEqual(chart.timings[0], { role: 'defaultEffects', category: 'entrance' });
  assert.equal(chart.runs[0].options.delay, 0);
  chart.render({ width: 310 });
  assert.equal(chart.runs.length, 1);
  assert.equal(chart.runs[0].cancelled, false, 'percentage clips/opacity do not cancel for a parent measurement');
  chart.replay();
  assert.equal(chart.runs[0].cancelled, true);
  assert.equal(chart.runs.length, 2, 'Strict replay must rebuild the unfinished entrance before paint');
  assert.equal(chart.runs[1].cancelled, false);
  chart.runs[1].finish();
  chart.replay();
  assert.equal(chart.runs.length, 2, 'a completed event must not replay');
  chart.render({ dataKey: 'daily:2,2' });
  assert.equal(chart.runs.length, 2, 'custom feedback off must not disable or reuse entrance motion');
  chart.unmount();
});

test('off, inactive, inert, route-owned and disabled entrances stay static but real updates retain feedback', () => {
  for (const options of [
    { entrance: 'off' },
    { active: false },
    { inert: true },
    { route: true },
    { allowEntrance: false },
  ]) {
    const chart = seriesFixture(options);
    assert.equal(chart.runs.length, 0, JSON.stringify(options));
    chart.render({ active: true });
    assert.equal(chart.runs.length, 0, 'activation may not replay a consumed entrance');
    if (!options.inert) {
      chart.render({ dataKey: 'daily:1,1' });
      assert.equal(chart.runs.length, 1, 'real data/view updates belong to feedback even with entrances off');
      assert.deepEqual(chart.timings[0], { role: 'defaultEffects', category: 'feedback' });
    }
    chart.unmount();
  }
});

function swapEffectsFixture({ tier = 'standard', active = true } = {}) {
  const hooks = hookRuntime();
  const runs = [];
  const animate = (frames, options) => {
    let resolve;
    let reject;
    const finished = new Promise((yes, no) => {
      resolve = yes;
      reject = no;
    });
    const run = {
      frames,
      options,
      finished,
      settled: false,
      cancelled: false,
      finish() {
        this.settled = true;
        resolve();
      },
      cancel() {
        if (!this.settled) this.cancelled = true;
        reject(new Error('cancelled'));
      },
    };
    runs.push(run);
    return run;
  };
  const jsx = (type, props) => ({ type, props });
  const dependencies = {
    react: hooks.react,
    'react/jsx-runtime': { jsx, jsxs: jsx },
    '@/lib/utils': { cn: (...classes) => classes.filter(Boolean).join(' ') },
    '@/lib/appearance': {
      useMotionTier: () => tier,
      useMotionScale: () => (tier === 'off' ? 0 : 1),
      scaledMs: (ms) => ms,
    },
    '@/lib/motionTokens': { TRAVEL_PX: { small: 8 }, HANDOFF_MS: 50 },
    '@/lib/springTiming': {
      springTiming: () => ({ duration: 50 }),
      surfaceArrival: () => ({ effects: { duration: 100 }, spatial: { duration: 200 } }),
    },
  };
  const exports = {};
  const source = ts.transpileModule(readFileSync(path.join(root, 'components/SwapContent.tsx'), 'utf8'), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      jsx: ts.JsxEmit.ReactJSX,
    },
  }).outputText;
  vm.runInNewContext(source, {
    exports,
    queueMicrotask,
    require: (name) => {
      assert.ok(name in dependencies, `Unexpected swap dependency: ${name}`);
      return dependencies[name];
    },
  });
  const props = { contentKey: 'total', children: { key: 'total' }, active };
  const render = (updates = {}) => {
    Object.assign(props, updates);
    return hooks.render(exports.default, props, (tree) => {
      for (const child of tree.props.children.filter(Boolean)) child.props.ref.current = { animate };
    });
  };
  render();
  return { render, runs, unmount: () => hooks.unmount() };
}

const microtasks = async () => {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
};

test('a plot swap waits for both incoming tracks before clearing its inert departure', async () => {
  const swap = swapEffectsFixture();
  assert.ok(departing(swap.render({ contentKey: 'daily', children: { key: 'daily' } })));
  assert.equal(swap.runs.length, 3);
  swap.runs[2].finish(); // Short exit ends first; incoming spatial tail still belongs to this run.
  await microtasks();
  assert.ok(departing(swap.render()), 'the exit alone must not clear the snapshot/cancel incoming tracks');
  assert.equal(swap.runs[0].cancelled, false);
  assert.equal(swap.runs[1].cancelled, false);
  swap.runs[0].finish();
  await microtasks();
  assert.ok(departing(swap.render()));
  swap.runs[1].finish();
  await microtasks();
  assert.equal(departing(swap.render()), undefined);
  assert.equal(swap.runs[1].cancelled, false, 'the complete spatial spring must resolve normally');
  swap.unmount();
});

test('rapid/off/hidden plot swaps cancel obsolete tracks and never animate concealed peers', async () => {
  const swap = swapEffectsFixture();
  swap.render({ contentKey: 'daily', children: { key: 'daily' } });
  swap.render({ contentKey: 'total', children: { key: 'total' } });
  assert.equal(swap.runs.length, 6);
  assert.ok(swap.runs.slice(0, 3).every((run) => run.cancelled));
  assert.ok(swap.runs.slice(3).every((run) => !run.cancelled));
  swap.render({ active: false });
  await microtasks();
  assert.ok(swap.runs.every((run) => run.cancelled));
  assert.equal(departing(swap.render()), undefined);
  swap.unmount();
  for (const options of [{ tier: 'off' }, { active: false }]) {
    const still = swapEffectsFixture(options);
    still.render({ contentKey: 'daily', children: { key: 'daily' } });
    await microtasks();
    assert.equal(still.runs.length, 0);
    assert.equal(departing(still.render()), undefined);
    still.unmount();
  }
});

test('rapid series updates cancel obsolete effects; tab/pref changes settle without same-data replay', () => {
  const chart = seriesFixture({ allowEntrance: false });
  chart.render({ dataKey: 'daily:1,1' });
  chart.render({ dataKey: 'total:2,4' });
  assert.equal(chart.runs.length, 2);
  assert.equal(chart.runs[0].cancelled, true);
  assert.equal(chart.runs[1].cancelled, false);
  chart.render({ active: false });
  assert.equal(chart.runs[1].cancelled, true);
  chart.render({ active: true });
  assert.equal(chart.runs.length, 2);
  chart.modes.feedback = 'reduced';
  chart.render();
  assert.equal(chart.runs.length, 2, 'tier changes finish existing data rather than inventing an entrance');
  chart.render({ dataKey: 'daily:2,2' });
  assert.deepEqual(animatedProperties(chart.runs[2]), ['opacity']);
  chart.modes.entrance = 'off';
  chart.scales.entrance = 1.4;
  chart.render();
  assert.equal(chart.runs[2].cancelled, false, 'unrelated entrance preferences cannot cancel active feedback');
  assert.equal(chart.runs.length, 3);
  chart.scales.feedback = 1.4;
  chart.render();
  assert.equal(chart.runs[2].cancelled, true);
  assert.equal(chart.runs.length, 3, 'speed changes must not restart old feedback');
  chart.render({ dataKey: 'daily:3,3' });
  assert.equal(chart.runs[3].options.duration, 140);
  assert.equal(chart.runs[3].options.delay, 70);
  chart.unmount();
});

test('TabPanes following keeps the enclosing strip window while retaining a surface-backed follower', () => {
  const hooks = hookRuntime();
  const jsx = (type, props) => ({ type, props });
  const exports = {};
  const source = ts.transpileModule(readFileSync(path.join(root, 'components/TabPanes.tsx'), 'utf8'), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      jsx: ts.JsxEmit.ReactJSX,
    },
  }).outputText;
  vm.runInNewContext(source, {
    exports,
    require: (name) => {
      if (name === 'react') {
        return {
          ...hooks.react,
          createContext: (value) => ({ Provider: 'Provider', value }),
          useContext: (context) => context.value,
        };
      }
      if (name === 'react/jsx-runtime') return { jsx, jsxs: jsx, Fragment: 'Fragment' };
      if (name === '@/lib/motionLazy') return { TabPanesMotion: 'TabPanesMotion' };
      if (name === '@/lib/utils') return { cn: (...classes) => classes.filter(Boolean).join(' ') };
      assert.fail(`Unexpected TabPanes dependency: ${name}`);
    },
  });
  const tree = exports.TabPanes({
    value: 'stats-users',
    following: { type: 'RangeCard' },
    children: [],
  });
  assert.equal(tree.type, 'div');
  assert.equal(
    tree.props['data-tab-window'],
    undefined,
    'following must not impose a column-tight data-tab-window clip',
  );
  assert.equal(tree.props.className, 'isolate');
  const [panes, follower] = tree.props.children;
  assert.equal(panes.type, 'Fragment');
  assert.equal(panes.props.children[0].props['data-tab-panel'], true);
  assert.equal(follower.props['data-tab-follower'], '');
  assert.ok(follower.props.className.split(/\s+/).includes('bg-surface'), follower.props.className);

  const tabScroll = {};
  const scrollSource = ts.transpileModule(readFileSync(path.join(root, 'lib/tabScroll.ts'), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  vm.runInNewContext(scrollSource, {
    exports: tabScroll,
    require: (name) => {
      assert.equal(name, '@/lib/appScroller');
      return { getAppScroller: () => null };
    },
  });
  const scroller = { scrollTop: 0, getBoundingClientRect: () => ({ top: 0 }) };
  const panel = (hasWindow, hasFollower) => ({
    closest: (selector) => (hasWindow && selector === '[data-tab-window]' ? {} : null),
    nextElementSibling: hasFollower ? { hasAttribute: (attr) => attr === 'data-tab-follower' } : null,
    getBoundingClientRect: () => ({ top: 24 }),
  });
  assert.equal(tabScroll.tabMayRestore(panel(false, false), scroller), true);
  assert.equal(tabScroll.tabMayRestore(panel(true, false), scroller), false);
  assert.equal(tabScroll.tabMayRestore(panel(false, true), scroller), false);
});
