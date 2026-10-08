/**
 * The admin inline editor (components/InlineEditorPanel.tsx), compiled by the real React Compiler
 * and driven through its commit effect without a browser or backend.
 *
 * R9-038: the pressed row stays where it was pressed when the editor above it goes in the same
 * commit. M1-030 / M1-032: the opening and closing are Web Animations on the compositor, a
 * development build's StrictMode remount adopts the running run instead of dropping it, and the
 * component compiles whole — the `'use no memo'` the GSAP version needed is gone.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import vm from 'node:vm';
import { transformSync } from '@babel/core';
import compiler from 'babel-plugin-react-compiler';
import ts from 'typescript';

const source = readFileSync(path.resolve(import.meta.dirname, '../components/InlineEditorPanel.tsx'), 'utf8');

/** Keyframes built inside the vm context carry its realm's prototypes; compare their data. */
const plain = (value) => JSON.parse(JSON.stringify(value));

const compiled = ts.transpileModule(transformSync(source, {
  filename: 'InlineEditorPanel.tsx', configFile: false, babelrc: false,
  parserOpts: { plugins: ['typescript', 'jsx'] }, plugins: [[compiler, { target: '19' }]],
}).code, {
  compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;

/** A Web Animation as far as the panel reads one: its keyframes, its timing, cancel and finish. */
function fakeAnimation(el, keyframes, timing, log) {
  let resolve;
  const finished = new Promise((done) => { resolve = done; });
  const animation = {
    el, keyframes, timing, finished, cancelled: false, playState: 'running',
    cancel() { animation.cancelled = true; animation.playState = 'idle'; log.push(['cancel', el.name]); },
    finish() { animation.playState = 'finished'; resolve(animation); },
  };
  return animation;
}

/**
 * One table: a row whose editor opens, the rows after it, and a scroller. `tier` is the motion
 * tier in force; `followers` the elements `followersOf` reports after the panel.
 */
function harness({ tier = 'standard', clampTo = null } = {}) {
  const log = [];
  const timers = [];
  /* `clampTo`: the page ends there once the panel takes no room — reading layout with it collapsed
     clamps the offset, as a browser does, and the clamp stays until somebody scrolls back. */
  const scroller = {
    top: 2000,
    get scrollTop() {
      if (clampTo !== null && panelCollapsed() && this.top > clampTo) this.top = clampTo;
      return this.top;
    },
    set scrollTop(value) { this.top = value; },
    getBoundingClientRect: () => ({ top: 100, bottom: 900 }),
  };
  class Element {
    constructor(name, top, height = 60) {
      this.name = name;
      this.top = top;
      this.height = height;
      this.isConnected = true;
      this.children = [];
      this.computed = { translate: 'none', opacity: '1', marginTop: '2px', transform: 'none' };
      this.animations = [];
      this.style = {};
      /* `.m3-row` and nothing else is what the panel asks of a class list (its row's corners). */
      this.classes = [];
      this.classList = { contains: (name) => this.classes.includes(name) };
    }
    get offsetHeight() { return this.height; }
    getBoundingClientRect() {
      /* A follower moves up by the panel's footprint while the panel is collapsed for a read — or
         by less, when the free space of a short page holds it (`pinned`). */
      const collapsed = this !== panel && panelCollapsed() && this.follows ? -(this.pinned ?? 589) : 0;
      const top = this.top - scroller.scrollTop + (this.drawnY ?? 0) + collapsed;
      return { top, bottom: top + this.height, height: this.height };
    }
    contains(other) { return other === this || this.children.includes(other); }
    animate(keyframes, timing) {
      const animation = fakeAnimation(this, keyframes, timing, log);
      this.animations.push(animation);
      return animation;
    }
  }
  const motion = { started: [], dropped: [], list: [], above: [] };
  Object.defineProperty(motion, 'followers', {
    get: () => motion.list,
    set: (list) => { motion.list = list; for (const el of list) el.follows = true; },
  });
  const effects = [];
  const jsx = (type, props) => ({ type, props });
  const dependencies = {
    react: { useEffect: () => {}, useLayoutEffect: (effect) => effects.push(effect), useRef: (current) => ({ current }) },
    'react/jsx-runtime': { jsx, jsxs: jsx },
    'react/compiler-runtime': { c: (size) => Array(size).fill(Symbol.for('react.memo_cache_sentinel')) },
    'react-dom': { flushSync: (fn) => { log.push(['flushSync']); fn(); } },
    '@/lib/appearance': { motionTier: () => tier, scaledMs: (ms) => ms },
    '@/lib/appScroller': { getAppScroller: () => scroller },
    '@/lib/scrollTo': { scrollAppToElement: () => assert.fail('a visible editor must not start a second scroll') },
    '@/lib/springTiming': { springTiming: (name) => ({ duration: name === 'fastEffects' ? 108 : 194, easing: `linear(${name})` }) },
    '@/components/admin/tableMotion': {
      followersOf: () => motion.followers,
      precedersOf: () => motion.above,
      drawnOffsetY: (el) => el.drawnY ?? 0,
      startMove: (el, keyframes, timing) => {
        const animation = fakeAnimation(el, keyframes, timing, log);
        motion.started.push(animation);
        return animation;
      },
      dropMove: (el, animation) => { motion.dropped.push([el, animation]); log.push(['drop', el.name]); },
    },
  };
  const exports = {};
  vm.runInNewContext(compiled, {
    exports,
    HTMLElement: Element,
    window: { innerHeight: 900 },
    document: { activeElement: null, querySelector: () => null },
    performance: { now: () => 0 },
    CSS: { escape: (value) => value },
    getComputedStyle: (el) => el.computed,
    queueMicrotask,
    setTimeout: (fn) => { timers.push(fn); return timers.length; },
    clearTimeout: (id) => { timers[id - 1] = null; },
    require: (id) => { assert.ok(id in dependencies, `unmocked dependency: ${id}`); return dependencies[id]; },
  });

  let panel = null;
  const panelCollapsed = () => panel?.style.height === '0px';
  panel = new Element('panel', 1941, 587);
  panel.id = 'user-editor-3';
  const surface = new Element('surface', 1941, 587);
  const content = new Element('content', 1961, 547);
  surface.children = [content];
  panel.children = [surface];

  /** One render and its commit: the refs attached, then the layout effect run (its cleanup returned). */
  const render = (props) => {
    effects.length = 0;
    const tree = exports.default({ id: panel.id, label: '编辑用户3', isClosing: false, onExitComplete() {}, children: null, ...props });
    tree.props.ref.current = panel;
    tree.props.children.props.ref.current = surface;
    return { tree, commit: () => effects.map((effect) => effect()).find(Boolean) };
  };
  const runTimers = () => {
    for (let i = 0; i < timers.length; i += 1) {
      const fn = timers[i];
      timers[i] = null;
      fn?.();
    }
  };
  return { exports, Element, scroller, panel, surface, content, motion, log, render, runTimers };
}

function switchEditor({ replaceRow = false, matchingId = true } = {}) {
  const h = harness({ tier: 'off' });
  const before = new h.Element('row', 2450);
  const row = replaceRow ? new h.Element('row-replacement', 1861) : before;
  h.panel.previousElementSibling = row;
  h.exports.captureInlineEditorLayout({
    closest: () => before,
    getAttribute: () => (matchingId ? h.panel.id : 'other-editor'),
  });
  // React removes the preceding editor and may replace the target row in the same commit.
  if (replaceRow) before.isConnected = false;
  row.top = 1861;
  h.render({}).commit();
  return row.getBoundingClientRect().top;
}

test('the component compiles whole: no opt-out, and the compiler kept it', () => {
  assert.doesNotMatch(source, /'use no memo'/, 'the WAAPI version needs no compiler opt-out');
  assert.match(compiled, /react\/compiler-runtime/, 'the React Compiler bailed out of InlineEditorPanel');
});

test('R9-038 commit holds the pressed row before paint, including a React replacement node', () => {
  assert.equal(switchEditor(), 450);
  assert.equal(switchEditor({ replaceRow: true }), 450);
  assert.equal(switchEditor({ replaceRow: true, matchingId: false }), -139, 'a refused earlier open cannot scroll a different editor');
});

test('M1-032 opening: a two-box translate clip, the content behind it, what follows on its spring', () => {
  const h = harness();
  h.panel.previousElementSibling = new h.Element('row', 1881);
  h.motion.followers = [new h.Element('next', 2530)];
  h.render({}).commit();

  const [clip] = h.panel.animations;
  assert.deepEqual(plain(clip.keyframes), [{ translate: '0 -587px' }, { translate: 'none' }]);
  assert.equal(clip.timing.easing, 'linear(defaultSpatial)');
  const [counter] = h.surface.animations;
  assert.deepEqual(plain(counter.keyframes), [{ translate: '0 587px' }, { translate: 'none' }], 'the surface stands still while the clip grows over it');
  const [rise, fadeIn] = h.content.animations;
  assert.equal(rise.timing.delay, 40, 'the content arrives behind the panel');
  assert.equal(rise.timing.fill, 'backwards');
  assert.deepEqual(plain(fadeIn.keyframes), [{ opacity: 0 }, { opacity: 1 }]);
  assert.equal(fadeIn.timing.easing, 'linear(defaultEffects)', 'opacity on the effects twin, which cannot overshoot');
  /* An open nothing pressed derives the push: everything after moved down by the footprint. */
  assert.equal(h.motion.started.length, 1);
  assert.deepEqual(plain(h.motion.started[0].keyframes), [{ transform: 'translateY(-589px)' }, { transform: 'none' }]);
  assert.equal(h.motion.started[0].timing.easing, 'linear(defaultSpatial)', 'what follows moves on the clip\'s own spring');
});

test('M1-032 a follower the press saw higher glides from there, counted against its layout box', () => {
  const h = harness();
  const row = new h.Element('row', 1881);
  const next = new h.Element('next', 1943);
  h.panel.previousElementSibling = row;
  h.motion.followers = [next];
  h.exports.captureInlineEditorLayout({ closest: () => row, getAttribute: () => h.panel.id });
  /* The commit inserts the panel: the row after it now lays out 589px lower, and is still drawn
     40px off by a move an earlier gesture left running. */
  next.top = 1943 + 589;
  next.drawnY = 40;
  h.render({}).commit();
  assert.equal(h.motion.started.length, 1);
  assert.deepEqual(plain(h.motion.started[0].keyframes), [{ transform: 'translateY(-589px)' }, { transform: 'none' }]);
});

test('M1-030 a StrictMode remount adopts the running opening instead of landing it', () => {
  const h = harness();
  h.panel.previousElementSibling = new h.Element('row', 1881);
  h.motion.followers = [new h.Element('next', 2530)];
  const { commit } = h.render({});
  const cleanup = commit();
  const created = h.log.length + h.panel.animations.length;
  /* React's development build: unmount every effect, then mount it again. */
  cleanup();
  const again = h.render({}).commit;
  again();
  h.runTimers();
  assert.equal(h.log.filter(([kind]) => kind === 'cancel' || kind === 'drop').length, 0, 'nothing was landed or cancelled');
  assert.equal(h.panel.animations.length + h.log.length, created, 'the second mount started nothing');
  assert.equal(h.motion.started.length, 1, 'the reflow is still running');

  /* A real unmount lands everything, its own moves only. */
  const last = h.render({}).commit();
  last();
  h.runTimers();
  assert.ok(h.panel.animations.every((animation) => animation.cancelled));
  assert.deepEqual(h.motion.dropped.map(([el, animation]) => [el.name, animation]), [['next', h.motion.started[0]]]);
});

test('M1-032 closing: from the drawn pose, on FastEffects held to the end; moves land before the panel goes', async () => {
  const h = harness();
  const next = new h.Element('next', 2530);
  const footer = new h.Element('footer', 3360);
  footer.pinned = 137;
  h.panel.previousElementSibling = new h.Element('row', 1881);
  h.motion.followers = [next, footer];
  const cleanup = h.render({}).commit();
  const opening = h.motion.started[0];
  assert.deepEqual(plain(h.motion.started[1].keyframes), [{ transform: 'translateY(-137px)' }, { transform: 'none' }],
    'an open nothing pressed starts each follower where the layout without the panel had it');

  /* Half-way through the opening, the user closes it. */
  h.panel.computed = { ...h.panel.computed, translate: '0px -200px' };
  h.surface.computed = { ...h.surface.computed, translate: '0px 200px' };
  h.content.computed = { ...h.content.computed, translate: '0px -3px', opacity: '0.4' };
  next.drawnY = -200;
  let exited = false;
  const { commit } = h.render({ isClosing: true, onExitComplete: () => { exited = true; h.log.push(['exit']); } });
  cleanup();
  commit();

  const clip = h.panel.animations.at(-1);
  assert.deepEqual(plain(clip.keyframes), [{ translate: '0px -200px', opacity: '1' }, { translate: '0 -587px', opacity: 1 }]);
  assert.equal(clip.timing.fill, 'forwards');
  assert.equal(clip.timing.easing, 'linear(fastEffects)');
  assert.deepEqual(plain(h.content.animations.at(-1).keyframes), [{ opacity: '0.4' }, { opacity: 0 }], 'the content leaves from where it is');
  assert.equal(h.content.animations.at(-2).timing.delay, undefined, 'a reversal has no lag');
  assert.ok(h.panel.animations.slice(0, -1).every((animation) => animation.cancelled), 'the opening was cancelled once read');
  const closing = h.motion.started.at(-2);
  assert.deepEqual(plain(closing.keyframes), [{ transform: 'translateY(-200px)' }, { transform: 'translateY(-589px)' }]);
  assert.equal(closing.timing.fill, 'forwards');
  assert.notEqual(closing, opening);
  assert.deepEqual(plain(h.motion.started.at(-1).keyframes), [{ transform: 'translateY(0px)' }, { transform: 'translateY(-137px)' }],
    'a follower the free space holds goes only as far as the layout will put it');
  assert.ok(!h.panel.style.height, 'the collapse for the read is undone');

  clip.finish();
  await clip.finished;
  await Promise.resolve();
  assert.ok(exited);
  const order = h.log.map(([kind]) => kind).filter((kind) => kind !== 'cancel');
  assert.deepEqual(order.slice(-4), ['drop', 'drop', 'flushSync', 'exit'], 'the moves land in the task that removes the panel');
});

test('a close turned back re-opens every part from its pose on the opening spring', () => {
  const h = harness();
  const next = new h.Element('next', 2530);
  h.panel.previousElementSibling = new h.Element('row', 1881);
  h.motion.followers = [next];
  const opened = h.render({}).commit();
  const closingRender = h.render({ isClosing: true });
  opened();
  const closed = closingRender.commit();
  h.panel.computed = { ...h.panel.computed, translate: '0px -300px' };
  next.drawnY = -300;
  const reopening = h.render({});
  closed();
  reopening.commit();
  const clip = h.panel.animations.at(-1);
  assert.deepEqual(plain(clip.keyframes), [{ translate: '0px -300px', opacity: '1' }, { translate: 'none', opacity: 1 }]);
  assert.equal(clip.timing.easing, 'linear(defaultSpatial)');
  assert.equal(clip.timing.fill, undefined);
  assert.deepEqual(plain(h.motion.started.at(-1).keyframes), [{ transform: 'translateY(-300px)' }, { transform: 'none' }]);
});

test('减弱 fades the panel and moves nothing; 关闭 runs nothing and removes the panel in a microtask', async () => {
  const reduced = harness({ tier: 'reduced' });
  reduced.panel.previousElementSibling = new reduced.Element('row', 1881);
  reduced.motion.followers = [new reduced.Element('next', 2530)];
  reduced.render({}).commit();
  assert.equal(reduced.panel.animations.length, 1);
  assert.deepEqual(plain(reduced.panel.animations[0].keyframes), [{ opacity: 0 }, { opacity: 1 }]);
  assert.equal(reduced.surface.animations.length + reduced.content.animations.length + reduced.motion.started.length, 0);

  const off = harness({ tier: 'off' });
  off.panel.previousElementSibling = new off.Element('row', 1881);
  const cleanup = off.render({}).commit();
  let exited = false;
  const closing = off.render({ isClosing: true, onExitComplete: () => { exited = true; } });
  cleanup();
  closing.commit();
  assert.equal(exited, false, 'not inside the commit');
  await Promise.resolve();
  assert.equal(exited, true);
  assert.equal(off.panel.animations.length + off.motion.started.length, 0);
});

test('a close at the end of the page carries what precedes the panel down by the clamp it will cause', () => {
  const h = harness({ clampTo: 1700 });
  const above = new h.Element('row-above', 1881);
  const next = new h.Element('next', 2530);
  h.panel.previousElementSibling = above;
  h.motion.followers = [next];
  h.motion.above = [above];
  const opened = h.render({}).commit();
  const closing = h.render({ isClosing: true });
  opened();
  closing.commit();
  assert.equal(h.scroller.scrollTop, 2000, 'the read put back the offset it clamped');
  const clip = h.panel.animations.at(-1);
  assert.deepEqual(plain(clip.keyframes).map((frame) => frame.translate), ['none', '0 -287px'], 'the clip closes onto the row above as that row comes down');
  const moves = Object.fromEntries(h.motion.started.slice(-2).map((animation) => [animation.el.name, plain(animation.keyframes)]));
  assert.deepEqual(moves.next, [{ transform: 'translateY(0px)' }, { transform: 'translateY(-289px)' }], 'the row after it rises by the footprint less the shift');
  assert.deepEqual(moves['row-above'], [{ transform: 'translateY(0px)' }, { transform: 'translateY(300px)' }], 'the row above comes down by the shift');
});

test('under the last row, the row\'s bottom corners move with the panel instead of snapping in its commits', async () => {
  const h = harness();
  const row = new h.Element('row', 1881);
  row.classes = ['m3-row'];
  /* After the opening commit the panel is the run's last: its corners are the run's end, the row's the seam. */
  row.computed = { ...row.computed, borderBottomLeftRadius: '4px' };
  h.panel.computed = { ...h.panel.computed, borderBottomLeftRadius: '16px' };
  h.panel.previousElementSibling = row;
  const cleanup = h.render({}).commit();
  const squaring = row.animations.at(-1);
  assert.deepEqual(plain(squaring.keyframes), [
    { borderBottomLeftRadius: '16px', borderBottomRightRadius: '16px' },
    { borderBottomLeftRadius: '4px', borderBottomRightRadius: '4px' },
  ], 'the corners leave the run\'s end as the panel starts to grow under them');
  assert.equal(squaring.timing.easing, 'linear(defaultSpatial)', 'on the clip\'s own spring');

  /* Closed half-way: the corners leave from where they are drawn, on the close's clock, held to the end. */
  row.computed = { ...row.computed, borderBottomLeftRadius: '9px' };
  let exited = false;
  const { commit } = h.render({ isClosing: true, onExitComplete: () => { exited = true; h.log.push(['exit']); } });
  cleanup();
  commit();
  assert.ok(squaring.cancelled, 'the opening\'s track was read, then let go');
  const rounding = row.animations.at(-1);
  assert.deepEqual(plain(rounding.keyframes), [
    { borderBottomLeftRadius: '9px', borderBottomRightRadius: '9px' },
    { borderBottomLeftRadius: '16px', borderBottomRightRadius: '16px' },
  ]);
  assert.equal(rounding.timing.easing, 'linear(fastEffects)');
  assert.equal(rounding.timing.fill, 'forwards', 'held at the run\'s end until the removal gives the row those corners');
  h.panel.animations.at(-1).finish();
  await h.panel.animations.at(-1).finished;
  await Promise.resolve();
  assert.ok(exited && rounding.cancelled);
  const tail = h.log.filter(([kind, name]) => kind === 'flushSync' || kind === 'exit' || (kind === 'cancel' && name === 'row')).map(([kind]) => kind);
  assert.deepEqual(tail.slice(-3), ['flushSync', 'exit', 'cancel'], 'let go only after the panel is gone, so no frame shows the seam');

  /* Under a middle row nothing changes corners, so nothing runs on the row. */
  const m = harness();
  const middle = new m.Element('middle', 1881);
  middle.classes = ['m3-row'];
  middle.computed = { ...middle.computed, borderBottomLeftRadius: '4px' };
  m.panel.computed = { ...m.panel.computed, borderBottomLeftRadius: '4px' };
  m.panel.previousElementSibling = middle;
  m.render({}).commit();
  assert.equal(middle.animations.length, 0);
});
