/** The desktop ponies' stage (`public/companions/ponies-frame.js`): the frame is the window's size
    so that no change of the content area resizes it, and the engine walks the stage the page sends
    instead. The frame script runs here as written, in a bare context, over a stand-in engine that
    measures its world the way Browser Ponies does — by `innerWidth` / `innerHeight`. */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import vm from 'node:vm';

const SOURCE = readFileSync(new URL('../public/companions/ponies-frame.js', import.meta.url), 'utf8');
const CHANNEL = 'test-channel';

/** One frame document: the script, a stand-in engine with one instance per spawned pony, and the
    page on the other side of `postMessage`. `viewport` is the frame's own size. */
function frameDocument(viewport = { width: 1440, height: 900 }) {
  const listeners = new Map();
  const told = [];
  const calls = [];
  const instances = new Map();
  const context = {
    console, Date, Math, Number, String, Array, Object, Map, Set, JSON, Error, MouseEvent: class {},
    HTMLElement: class {},
    Window: function Window() {},
    document: { documentElement: { style: { setProperty() {} } } },
    requestAnimationFrame: () => 1,
    cancelAnimationFrame() {},
    addEventListener: (type, listener) => listeners.set(type, [...(listeners.get(type) ?? []), listener]),
  };
  context.window = context;
  context.parent = { postMessage: (data) => told.push(data) };
  Object.defineProperty(context, 'innerWidth', { configurable: true, enumerable: true, get: () => viewport.width });
  Object.defineProperty(context, 'innerHeight', { configurable: true, enumerable: true, get: () => viewport.height });

  /** An instance with the engine's geometry: a top-left position and a size, off screen when any of
      it is outside `innerWidth` × `innerHeight` — read through the global, as the engine reads it. */
  const spawn = (name) => {
    const box = { x: 100, y: 100, width: 100, height: 80 };
    const instance = {
      name, box, img: { isConnected: true, getBoundingClientRect: () => ({ x: box.x, y: box.y, width: box.width, height: box.height }) },
      topLeftPosition: () => ({ x: box.x, y: box.y }),
      setTopLeftPosition: (at) => { calls.push(['moved', name, at.x, at.y]); box.x = at.x; box.y = at.y; },
      size: () => ({ width: box.width, height: box.height }),
      position: () => ({ x: box.x + box.width / 2, y: box.y + box.height / 2 }),
      isOffscreen: () => box.x < 0 || box.y < 0 || box.x + box.width > context.innerWidth || box.y + box.height > context.innerHeight,
      nextBehavior: () => calls.push(['next', name]),
    };
    instances.set(name, instance);
  };
  context.BrowserPonies = {
    loadConfig: (config) => { for (const name of Object.keys(config.spawn ?? {})) spawn(name); },
    ponies: () => Object.fromEntries([...instances].map(([name, instance]) => [name.toLowerCase(), { instances: [instance] }])),
    start: () => calls.push(['start']),
    pause: () => calls.push(['pause']),
    resume: () => calls.push(['resume']),
    removePony() {}, unspawnAll() {}, stop() {}, setFadeDuration() {}, setSpeed() {},
    Util: { onload: (callback) => callback(), getOverlay: () => ({ lastElementChild: null }) },
  };
  vm.runInNewContext(SOURCE, context);
  const send = (data) => {
    for (const listener of listeners.get('message') ?? []) listener({ source: context.parent, data: { source: 'picpony-companions', channel: CHANNEL, ...data } });
  };
  const measured = () => ({ width: context.innerWidth, height: context.innerHeight });
  return { send, measured, calls, told, instances, viewport };
}

const configs = (...names) => names.map((name) => ({ name, ini: 'Name,x', baseurl: 'https://picpony.top/assets/ponies/x/' }));

test('the engine measures the frame itself until a stage is sent, and the stage from then on', () => {
  const frame = frameDocument();
  assert.deepEqual(frame.measured(), { width: 1440, height: 900 }, 'before init: the frame’s own viewport');
  frame.send({ type: 'init', configs: configs('a'), speed: 3, theme: {}, paused: false, stage: { width: 1128.6, height: 812.2 } });
  assert.deepEqual(frame.measured(), { width: 1128, height: 812 }, 'the stage, never past the box it was measured from');
  frame.viewport.width = 1200;
  assert.deepEqual(frame.measured(), { width: 1128, height: 812 }, 'a resize of the frame is not a change of stage');
  frame.send({ type: 'stage', width: 1416, height: 812 });
  assert.deepEqual(frame.measured(), { width: 1416, height: 812 });
});

test('a stage that is not a box is ignored', () => {
  const frame = frameDocument();
  frame.send({ type: 'init', configs: configs('a'), speed: 3, theme: {}, paused: false, stage: { width: 900, height: 700 } });
  for (const bad of [{ width: 0, height: 700 }, { width: -5, height: 700 }, { width: 'wide', height: 700 }, { width: 900 }]) {
    frame.send({ type: 'stage', ...bad });
    assert.deepEqual(frame.measured(), { width: 900, height: 700 }, JSON.stringify(bad));
  }
  const without = frameDocument();
  without.send({ type: 'init', configs: configs('a'), speed: 3, theme: {}, paused: false, stage: null });
  assert.deepEqual(without.measured(), { width: 1440, height: 900 }, 'no stage at init: the frame’s own size');
});

test('a smaller stage brings a pony past its edge back in, from the edge when it is out of sight', () => {
  const frame = frameDocument();
  frame.send({ type: 'init', configs: configs('inside', 'straddling', 'gone', 'below'), speed: 3, theme: {}, paused: false, stage: { width: 1416, height: 812 } });
  frame.instances.get('inside').box.x = 400;
  frame.instances.get('straddling').box.x = 1080; // 1080–1180 across a 1128 edge
  frame.instances.get('gone').box.x = 1300; // wholly past it
  frame.instances.get('below').box.y = 760; // past a bottom edge of 700
  frame.calls.length = 0;
  frame.send({ type: 'stage', width: 1128, height: 700 });
  assert.deepEqual(frame.calls, [
    ['next', 'straddling'],
    ['moved', 'gone', 1128, 100], ['next', 'gone'],
    ['moved', 'below', 100, 700], ['next', 'below'],
  ], 'only the ones outside move; one out of sight is put at the edge, unseen, before it walks in');
  frame.calls.length = 0;
  frame.send({ type: 'stage', width: 1416, height: 812 });
  assert.deepEqual(frame.calls, [], 'a larger stage leaves everyone where they are');
});

test('held, the walk-in waits for the release; a deferred start places everyone itself', () => {
  const frame = frameDocument();
  frame.send({ type: 'init', configs: configs('gone'), speed: 3, theme: {}, paused: false, stage: { width: 1416, height: 812 } });
  frame.instances.get('gone').box.x = 1300;
  frame.send({ type: 'pause' });
  frame.calls.length = 0;
  frame.send({ type: 'stage', width: 1128, height: 812 });
  assert.deepEqual(frame.measured(), { width: 1128, height: 812 }, 'the stage itself changes at once');
  assert.deepEqual(frame.calls, [], 'nothing walks while the page is covered');
  frame.send({ type: 'resume' });
  assert.deepEqual(frame.calls, [['resume'], ['moved', 'gone', 1128, 100], ['next', 'gone']]);

  const deferred = frameDocument();
  deferred.send({ type: 'init', configs: configs('gone'), speed: 3, theme: {}, paused: true, stage: { width: 1416, height: 812 } });
  deferred.instances.get('gone').box.x = 1300;
  deferred.send({ type: 'stage', width: 1128, height: 812 });
  deferred.calls.length = 0;
  deferred.send({ type: 'resume' });
  assert.deepEqual(deferred.calls, [['start']], 'the engine’s own start puts every pony on the stage');
});
