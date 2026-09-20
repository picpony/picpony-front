/** Deterministic Hero input handoff and interruption regressions; no browser or server. */
import assert from 'node:assert/strict';
import { getEventListeners } from 'node:events';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';
import { requireTypeStripping } from './tsResolve.mjs';

requireTypeStripping('testHeroContinuity');

const { buildFlightKeyframes, createHeroLeg, evaluateLeg } = await import('../lib/hero/flight.ts');
const { heroRectCenterDistance } = await import('../lib/hero/geometry.ts');
const { velocityAt } = await import('../lib/hero/progress.ts');
const { HERO_INPUT_TRANSFER_MAX_MS, HERO_ROUTE_TIMEOUT_MS } = await import('../lib/hero/constants.ts');

function load(file, dependencies, globals) {
  const source = ts.transpileModule(readFileSync(new URL(`../${file}`, import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
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

class TestWheelEvent extends Event {
  static DOM_DELTA_LINE = 1;
  static DOM_DELTA_PAGE = 2;

  constructor({ deltaX = 0, deltaY = 80, deltaMode = 0, ctrlKey = false } = {}) {
    super('wheel', { cancelable: true });
    Object.assign(this, { deltaX, deltaY, deltaMode, ctrlKey });
  }
}

class Scroller extends EventTarget {
  scrollLeft = 0;
  scrollTop = 0;
  clientWidth = 600;
  clientHeight = 800;
  scrollWidth = 2400;
  scrollHeight = 6000;
  isConnected = true;

  constructor(top = 0) {
    super();
    this.scrollTop = top;
  }

  removeEventListener(type, listener, options) {
    // Node 24 does not normalize the boolean capture shorthand like browser EventTarget.
    super.removeEventListener(type, listener, typeof options === 'boolean' ? { capture: options } : options);
  }

  scrollTo(top) {
    this.scrollTop = top;
    this.dispatchEvent(new Event('scroll'));
  }
}

function scrollHarness(t, top = 200) {
  let now = 1000;
  let nextFrame = 1;
  const frames = new Map();
  const scheduler = load('lib/hero/scheduler.ts', {}, {
    requestAnimationFrame(callback) {
      const id = nextFrame++;
      frames.set(id, callback);
      return id;
    },
    cancelAnimationFrame(id) { frames.delete(id); },
  }).heroFrameScheduler;
  const { HeroScrollContinuity } = load('lib/hero/scroll.ts', {
    './input': { noteHeroInteraction() {} },
    './scheduler': { heroFrameScheduler: scheduler },
  }, {
    WheelEvent: TestWheelEvent,
    performance: { now: () => now },
    getComputedStyle: () => ({ lineHeight: '24px' }),
  });
  const destination = new Scroller(top);
  const continuity = new HeroScrollContinuity(destination);
  t.after(() => { continuity.release(); scheduler.dispose(); });

  const frame = () => {
    now += 16;
    const pending = [...frames.values()];
    frames.clear();
    pending.forEach((callback) => callback(now));
  };
  const drain = () => {
    for (let count = 0; frames.size && count < 120; count += 1) frame();
    assert.equal(frames.size, 0, 'the residual must stop scheduling frames');
  };
  return { continuity, destination, scheduler, frames, frame, drain };
}

function assertNoScrollerListeners(element) {
  for (const type of ['scroll', 'wheel', 'pointerdown', 'touchstart']) {
    assert.equal(getEventListeners(element, type).length, 0, `${type} listener leaked`);
  }
}

for (const input of ['wheel', 'pointerdown', 'touchstart']) {
  test(`fresh ${input} stops the outgoing wheel residual before the destination scrolls`, async (t) => {
    const { continuity, destination, frames, frame, drain } = scrollHarness(t);
    const outgoing = new Scroller(900);
    continuity.addDeltaSource(outgoing);
    outgoing.dispatchEvent(new TestWheelEvent());
    frame();
    assert.ok(destination.scrollTop > 200 && destination.scrollTop < 280);
    assert.ok(frames.size > 0, 'the test must interrupt a live residual');

    const abort = new AbortController();
    const transferred = continuity.waitForNativeInput(abort.signal);
    const beforeInput = destination.scrollTop;
    destination.dispatchEvent(input === 'wheel' ? new TestWheelEvent() : new Event(input));
    assert.equal(continuity.hasNativeInput, true, 'input ownership changes synchronously');
    assert.equal(await transferred, true);
    assert.equal(getEventListeners(abort.signal, 'abort').length, 0);
    drain();
    assert.equal(destination.scrollTop, beforeInput, 'no queued write may precede native scrolling');

    destination.scrollTo(beforeInput + 60);
    const staleWheel = new TestWheelEvent();
    outgoing.dispatchEvent(staleWheel);
    outgoing.scrollTo(1100);
    drain();
    assert.equal(destination.scrollTop, beforeInput + 60, 'old momentum cannot overwrite new input');
    assert.equal(staleWheel.defaultPrevented, false, 'the old receiver no longer captures wheel input');
    assertNoScrollerListeners(outgoing);
  });
}

test('ctrl-wheel zoom does not claim native scrolling or cancel a live handoff', (t) => {
  const { continuity, destination, frame, drain } = scrollHarness(t);
  const outgoing = new Scroller();
  continuity.addDeltaSource(outgoing);
  outgoing.dispatchEvent(new TestWheelEvent());
  frame();
  const zoom = new TestWheelEvent({ ctrlKey: true });
  destination.dispatchEvent(zoom);
  assert.equal(continuity.hasNativeInput, false);
  assert.equal(zoom.defaultPrevented, false);
  drain();
  assert.equal(destination.scrollTop, 280, 'the existing wheel stream still reaches its destination');
});

test('route can claim input after Stage scrolls between addPeer and setInputTarget', async (t) => {
  const { continuity, destination: stage, drain } = scrollHarness(t);
  const route = new Scroller();
  continuity.addPeer(route);
  assert.equal(route.scrollTop, stage.scrollTop);

  // A final native Stage scroll can remove the pending route peer before reveal commits.
  stage.scrollTo(420);
  continuity.setInputTarget(route);
  assert.equal(route.scrollTop, 420, 'reattached route receives the last Stage position');
  assert.equal(continuity.hasNativeInput, false, 'the new receiver awaits its own input');
  const abort = new AbortController();
  const transferred = continuity.waitForNativeInput(abort.signal);
  route.dispatchEvent(new TestWheelEvent());
  assert.equal(continuity.hasNativeInput, true, 'the route input listener was reattached');
  assert.equal(await transferred, true);
  route.scrollTo(480);
  stage.scrollTo(900);
  drain();
  assert.equal(route.scrollTop, 480, 'Stage can no longer write into the active route');
  assertNoScrollerListeners(stage);
});

test('aborting one native-input waiter removes its listener without stranding the next', async (t) => {
  const { continuity, destination } = scrollHarness(t);
  const first = new AbortController();
  const canceled = continuity.waitForNativeInput(first.signal);
  assert.equal(getEventListeners(first.signal, 'abort').length, 1);
  first.abort();
  assert.equal(await canceled, false);
  assert.equal(getEventListeners(first.signal, 'abort').length, 0);
  assert.equal(await continuity.waitForNativeInput(first.signal), false);

  const second = new AbortController();
  const transferred = continuity.waitForNativeInput(second.signal);
  destination.dispatchEvent(new Event('pointerdown'));
  assert.equal(await transferred, true);
  assert.equal(getEventListeners(second.signal, 'abort').length, 0);
});

test('release resolves all waiters and leaves no residual work or input listeners', async (t) => {
  const { continuity, destination, scheduler, frame, drain } = scrollHarness(t);
  const outgoing = new Scroller();
  continuity.addDeltaSource(outgoing);
  outgoing.dispatchEvent(new TestWheelEvent());
  frame();
  const controllers = [new AbortController(), new AbortController()];
  const pending = controllers.map(({ signal }) => continuity.waitForNativeInput(signal));
  const settled = scheduler.settled();
  const finalTop = destination.scrollTop;
  continuity.release();
  continuity.release();
  assert.deepEqual(await Promise.all(pending), [false, false]);
  for (const { signal } of controllers) assert.equal(getEventListeners(signal, 'abort').length, 0);
  assertNoScrollerListeners(outgoing);
  assertNoScrollerListeners(destination);
  drain();
  await settled;
  assert.equal(destination.scrollTop, finalTop);
  assert.equal(await continuity.waitForNativeInput(new AbortController().signal), false);
});

/** HTML timers truncate fractional delays; rAF has a separate queue that a hidden tab can suspend. */
function transferClock() {
  let now = 1000.25;
  let sequence = 0;
  const timers = new Map();
  const frames = new Map();
  const reads = [];
  const flush = async () => {
    // Promise.race, adoption of the fallback quiet promise, and the controller continuation.
    for (let count = 0; count < 12; count += 1) await Promise.resolve();
  };
  const performance = {
    now() {
      const value = now;
      reads.push(value);
      now += 0.125; // Synchronous work between deadline creation and timer registration.
      return value;
    },
  };
  const setTimeout = (callback, delay = 0) => {
    const id = ++sequence;
    timers.set(id, { id, callback, delay, at: now + Math.max(0, Math.trunc(delay)) });
    return id;
  };
  const clearTimeout = (id) => timers.delete(id);
  const advanceTo = async (target, afterTimer) => {
    for (let count = 0; count < 1000; count += 1) {
      const next = [...timers.values()].filter(timer => timer.at <= target)
        .sort((a, b) => a.at - b.at || a.id - b.id)[0];
      if (!next) {
        now = Math.max(now, target);
        await flush();
        return;
      }
      now = Math.max(now, next.at);
      timers.delete(next.id);
      next.callback();
      afterTimer?.(next);
      await flush();
    }
    assert.fail('timer work failed to settle');
  };
  return {
    timers, frames, reads, performance, flush, setTimeout, clearTimeout, advanceTo,
    get now() { return now; },
    requestAnimationFrame(callback) { const id = ++sequence; frames.set(id, callback); return id; },
    cancelAnimationFrame(id) { frames.delete(id); },
    async frame(afterFrame) {
      now += 16;
      const pending = [...frames.values()];
      frames.clear();
      pending.forEach(callback => callback(now));
      afterFrame?.();
      await flush();
    },
  };
}

/** Load the real controller method, input waiters, scroll bridge and scheduler; no browser/server. */
function inputTransferHarness(t) {
  const clock = transferClock();
  const window = Object.assign(new EventTarget(), {
    setTimeout: clock.setTimeout, clearTimeout: clock.clearTimeout, innerWidth: 1440, innerHeight: 900,
  });
  const document = Object.assign(new EventTarget(), { visibilityState: 'visible' });
  const globals = { window, document, performance: clock.performance, AbortController,
    requestAnimationFrame: clock.requestAnimationFrame, cancelAnimationFrame: clock.cancelAnimationFrame,
    WheelEvent: TestWheelEvent, getComputedStyle: () => ({ lineHeight: '24px' }) };
  const scheduler = load('lib/hero/scheduler.ts', {}, globals).heroFrameScheduler;
  const input = load('lib/hero/input.ts', {}, globals);
  input.initializeHeroInput();
  const sessionHelpers = load('lib/hero/session.ts', {
    './scheduler': { heroFrameScheduler: scheduler },
  }, globals);
  const { HeroScrollContinuity } = load('lib/hero/scroll.ts', {
    './input': input, './scheduler': { heroFrameScheduler: scheduler },
  }, globals);
  const quietWaits = [];
  const dependencies = Object.fromEntries([
    './dom', './frameCache', './geometry', './gestures', './history', './motion',
    './plane', './flight', './pull',
  ].map(name => [name, {}]));
  Object.assign(dependencies, {
    './constants': { HERO_INPUT_TRANSFER_MAX_MS, HERO_ROUTE_TIMEOUT_MS, HERO_INPUT_TRANSFER_QUIET_MS: 320 },
    './input': { ...input, waitForHeroInteractionQuiet(signal, quietFor, budget) {
      const before = new Set(clock.timers.keys());
      const promise = input.waitForHeroInteractionQuiet(signal, quietFor, budget);
      quietWaits.push({ signal, budget,
        timerIds: [...clock.timers.keys()].filter(id => !before.has(id)) });
      return promise;
    } },
    './routes': { HeroRouteRegistry: class {} },
    './scheduler': { heroFrameScheduler: scheduler },
    './scroll': { HeroScrollContinuity },
    './session': sessionHelpers,
  });
  const { HeroController } = load('lib/hero/controller.ts', dependencies, globals);
  const controller = new HeroController();
  const destination = new Scroller();
  const continuity = new HeroScrollContinuity(destination);
  const session = { abort: new AbortController(), retired: false, reversing: false, scrollContinuity: continuity };
  controller.foreground = session;
  const beginInput = () => {
    const event = Object.assign(new Event('pointerdown'), { pointerType: 'touch', pointerId: 1 });
    window.dispatchEvent(event); // A held touch keeps the quiet wait pending beyond its budget.
  };
  const assertClean = () => {
    assert.equal(getEventListeners(session.abort.signal, 'abort').length, 0, 'session abort listener leaked');
    assert.equal(getEventListeners(controller.lifecycleAbort.signal, 'abort').length, 0,
      'lifecycle abort listener leaked');
    for (const wait of quietWaits) {
      assert.equal(getEventListeners(wait.signal, 'abort').length, 0, 'losing race waiter leaked');
      for (const id of wait.timerIds) assert.equal(clock.timers.has(id), false, 'quiet timer leaked');
    }
  };
  t.after(() => {
    session.abort.abort();
    controller.lifecycleAbort.abort();
    continuity.release();
    window.dispatchEvent(new Event('blur'));
    scheduler.dispose();
  });
  return { clock, controller, session, continuity, destination, input, window, quietWaits, beginInput, assertClean,
    wait: () => controller.waitForInputTransfer(session) };
}

test('quiet wait reports quiet, expired and aborted separately and cleans up each waiter', async (t) => {
  const h = inputTransferHarness(t);
  assert.equal(await h.input.waitForHeroInteractionQuiet(), 'quiet');
  const alreadyAborted = new AbortController();
  alreadyAborted.abort();
  assert.equal(await h.input.waitForHeroInteractionQuiet(alreadyAborted.signal), 'aborted');
  h.beginInput();
  assert.equal(await h.input.waitForHeroInteractionQuiet(undefined, 320, 0), 'expired');

  const aborted = new AbortController();
  const canceled = h.input.waitForHeroInteractionQuiet(aborted.signal, 320, 500.9);
  aborted.abort();
  assert.equal(await canceled, 'aborted');
  assert.equal(getEventListeners(aborted.signal, 'abort').length, 0);

  const quiet = new AbortController();
  const pending = h.input.waitForHeroInteractionQuiet(quiet.signal, 100, 500.9);
  h.window.dispatchEvent(Object.assign(new Event('pointerup'), { pointerType: 'touch', pointerId: 1 }));
  await h.clock.advanceTo(h.clock.now + 110);
  assert.equal(await pending, 'quiet');
  assert.equal(getEventListeners(quiet.signal, 'abort').length, 0);
  assert.equal(h.clock.timers.size, 0, 'quiet/abort must cancel their budget and polling timers');
});

test('controller completes a fractional budget even when its timer fires before the deadline', async (t) => {
  const h = inputTransferHarness(t);
  h.beginInput();
  h.clock.reads.length = 0;
  const pending = h.wait();
  const deadline = h.clock.reads[0] + HERO_INPUT_TRANSFER_MAX_MS;
  const wait = h.quietWaits[0];
  const expiry = wait.timerIds.map(id => h.clock.timers.get(id)).find(timer => timer.delay === wait.budget);
  assert.notEqual(wait.budget, Math.trunc(wait.budget), 'the regression needs a fractional budget');
  assert.ok(expiry.at < deadline, 'the browser timer truncates the delay before this deadline');
  await h.clock.advanceTo(expiry.at);
  assert.equal(await pending, true, 'expiry must not abandon an owned session');
  assert.ok(h.clock.now < deadline, 'the old second clock comparison would reject this handoff');
  assert.equal(h.controller.foreground, h.session);
  h.assertClean();
});

test('a released native receiver waits on the existing quiet budget without retrying or failing early', async (t) => {
  const h = inputTransferHarness(t);
  h.beginInput();
  let nativeWaits = 0, result;
  h.session.scrollContinuity = {
    hasNativeInput: false,
    waitForNativeInput: () => { nativeWaits += 1; return Promise.resolve(false); },
  };
  const pending = h.wait().then(value => { result = value; return value; });
  await h.clock.flush();
  assert.equal(result, undefined, 'receiver release is neither expiry nor successful transfer');
  assert.equal(nativeWaits, 1);
  assert.equal(h.quietWaits.length, 1, 'keep the original budget rather than creating a busy loop');
  const wait = h.quietWaits[0];
  const expiry = wait.timerIds.map(id => h.clock.timers.get(id)).find(timer => timer.delay === wait.budget);
  await h.clock.advanceTo(expiry.at);
  assert.equal(await pending, true);
  assert.equal(nativeWaits, 1);
  h.assertClean();
});

test('native input wins the race and removes the quiet budget after a confirmation frame', async (t) => {
  const h = inputTransferHarness(t);
  h.beginInput();
  const pending = h.wait();
  h.destination.dispatchEvent(new TestWheelEvent());
  await h.clock.flush();
  assert.equal(h.clock.frames.size, 1);
  assert.equal(h.quietWaits[0].timerIds.some(id => h.clock.timers.has(id)), false);
  await h.clock.frame();
  assert.equal(await pending, true);
  h.assertClean();
});

for (const owner of ['session', 'lifecycle']) {
  for (const winner of ['expired', 'native']) {
    test(`${owner} abort takes precedence over a same-task ${winner} result`, async (t) => {
      const h = inputTransferHarness(t);
      h.beginInput();
      const abort = owner === 'session' ? h.session.abort : h.controller.lifecycleAbort;
      const pending = h.wait();
      if (winner === 'native') {
        h.destination.dispatchEvent(new TestWheelEvent());
        abort.abort();
      } else {
        const wait = h.quietWaits[0];
        const expiry = wait.timerIds.map(id => h.clock.timers.get(id)).find(timer => timer.delay === wait.budget);
        await h.clock.advanceTo(expiry.at, timer => { if (timer.id === expiry.id) abort.abort(); });
      }
      assert.equal(await pending, false, 'an abort remains authoritative while owns() is still true');
      assert.equal(h.controller.foreground, h.session);
      h.assertClean();
    });
  }
}

test('abort releases a quiet fallback after the native receiver has already been released', async (t) => {
  const h = inputTransferHarness(t);
  h.beginInput();
  h.continuity.release();
  const pending = h.wait();
  await h.clock.flush();
  h.session.abort.abort();
  assert.equal(await pending, false);
  h.assertClean();
});

test('a suspended confirmation frame expires without abandoning a live handoff', async (t) => {
  const h = inputTransferHarness(t);
  const pending = h.wait();
  await h.clock.flush();
  assert.equal(h.clock.frames.size, 1);
  const expiry = [...h.clock.timers.values()].find(timer => timer.delay === HERO_ROUTE_TIMEOUT_MS);
  assert.ok(expiry, 'the frame confirmation is bounded independently of rAF');
  await h.clock.advanceTo(expiry.at); // Simulate a hidden tab: timers advance, rAF does not.
  assert.equal(await pending, true);
  assert.equal(h.controller.foreground, h.session);
  h.assertClean();
  assert.equal(h.clock.timers.size, 0);
  await h.clock.frame(); // The canceled scheduler owner must not finish a second time on resume.
});

test('abort after a confirmation frame finishes still cancels the handoff', async (t) => {
  const h = inputTransferHarness(t);
  const pending = h.wait();
  await h.clock.flush();
  await h.clock.frame(() => h.controller.lifecycleAbort.abort());
  assert.equal(await pending, false);
  h.assertClean();
});

function close(actual, expected, message) {
  assert.ok(Math.abs(actual - expected) < 1e-9, `${message}: ${actual} vs ${expected}`);
}

test('concentric zoom retains nonzero speed and carries it into an interrupted leg', () => {
  const from = { left: 200, top: 200, width: 200, height: 200 };
  const to = { left: 0, top: 0, width: 600, height: 600 };
  const options = { from, to, fromRadius: 20, toRadius: 16, direction: 'forward', duration: 250,
    startedAt: 1000, baseAspect: 1 };
  const leg = createHeroLeg(options);
  const caught = evaluateLeg(leg, 1050);
  const distance = Math.hypot(200, 200);
  close(heroRectCenterDistance(from, to), distance, 'half-size change contributes to travel');
  assert.ok(caught.speed > 0, 'a centered resize is still visibly moving');
  close(caught.speed, distance * velocityAt(leg.progress, 0.2) / 250, 'pose uses leg distance units');
  close(evaluateLeg(leg, 1000).speed, 0, 'a fresh flight leaves at rest');
  close(evaluateLeg(leg, 1250).speed, 0, 'a fresh flight arrives at rest');

  const continued = createHeroLeg({ ...options, from: caught.rect, fromRadius: caught.radius,
    duration: 150, startedAt: 1050, speed: caught.speed });
  close(evaluateLeg(continued, 1050).speed, caught.speed, 'rebuilding retains launch speed');
  assertRectClose(evaluateLeg(continued, 1050).rect, caught.rect, 'continued start');
  assertRectClose(evaluateLeg(continued, 1200).rect, to, 'continued landing');
});

test('launch speed uses the same units for translation, resizing, and combined travel', () => {
  const from = { left: 200, top: 200, width: 200, height: 200 };
  for (const to of [
    { left: 600, top: 450, width: 200, height: 200 },
    { left: 0, top: 0, width: 600, height: 600 },
    { left: 300, top: 100, width: 600, height: 400 },
  ]) {
    const leg = createHeroLeg({ from, to, fromRadius: 20, toRadius: 16, direction: 'forward',
      duration: 160, startedAt: 1000, baseAspect: to.width / to.height, speed: 0.5 });
    close(evaluateLeg(leg, 1000).speed, 0.5, `launch speed for ${JSON.stringify(to)}`);
  }
});

/** Read the emitted CSS, independently of the numeric geometry used to produce it. */
function waapiFlyerRect(flight, keyframes, offset) {
  const transform = (value) => {
    const match = /^translate3d\(([^,]+)px, ([^,]+)px, 0\) scale\(([^,]+), ([^)]+)\)$/.exec(value);
    assert.ok(match, `Unexpected flyer transform: ${value}`);
    return match.slice(1).map(Number);
  };
  const end = keyframes.findIndex((frame) => frame.offset >= offset);
  const right = end < 0 ? keyframes.length - 1 : end;
  const left = Math.max(0, right - 1);
  const a = keyframes[left];
  const b = keyframes[right];
  const fraction = left === right ? 0 : Math.max(0, Math.min(1, (offset - a.offset) / (b.offset - a.offset)));
  const start = transform(a.transform);
  const finish = transform(b.transform);
  const [x, y, scaleX, scaleY] = start.map((value, index) => value + (finish[index] - value) * fraction);
  return { left: x, top: y, width: flight.base.width * scaleX, height: flight.base.height * scaleY };
}

function assertRectClose(actual, expected, label) {
  for (const axis of ['left', 'top', 'width', 'height']) {
    assert.ok(Math.abs(actual[axis] - expected[axis]) < 1e-7,
      `${label} ${axis}: ${actual[axis]} vs ${expected[axis]}`);
  }
}

const interruptionFrom = { left: 1620, top: 650, width: 256, height: 197 };
const interruptionTo = { left: 632, top: 221, width: 944, height: 531 };
function interruptionFixture(duration, speed, direction = 'forward') {
  const from = direction === 'forward' ? interruptionFrom : interruptionTo;
  const to = direction === 'forward' ? interruptionTo : interruptionFrom;
  const leg = createHeroLeg({ from, to,
    fromRadius: 16, toRadius: 16, direction, duration, startedAt: 1000,
    baseAspect: interruptionTo.width / interruptionTo.height, speed });
  const flight = { base: interruptionTo, layer: {}, plane: { host: { width: 1920, height: 1080 } } };
  return { leg, flight, keyframes: buildFlightKeyframes(flight, leg).flyer };
}

test('settled spring legs stay at rest and do not lend residual velocity to a reverse', () => {
  for (const duration of [175, 250, 350]) {
    for (const speed of [0.734, -2]) {
      const { leg, flight } = interruptionFixture(duration, speed);
      assert.equal(leg.progress.kind, 'spring');
      const landedAt = leg.startedAt + duration;
      assert.ok(evaluateLeg(leg, landedAt - 0.01).speed > 0, 'the spring is moving just before landing');
      for (const at of [landedAt, landedAt + 0.001, landedAt + 1000]) {
        const pose = evaluateLeg(leg, at);
        assertRectClose(pose.rect, leg.to, `spring endpoint ${duration}ms/${speed} at ${at}`);
        assert.equal(pose.speed, 0, 'a filled endpoint is stationary even when the normalized spring has a tail');
        const reversed = createHeroLeg({
          from: pose.rect, to: leg.from, fromRadius: pose.radius, toRadius: leg.fromRadius,
          direction: 'back', duration, startedAt: at,
          baseAspect: flight.base.width / flight.base.height, speed: -pose.speed,
        });
        assert.equal(evaluateLeg(reversed, at).speed, 0, 'a late reverse must not manufacture a catch/overshoot');
      }
    }
  }
});

test('negative launch is caught at the presented box before analytic progress becomes positive', () => {
  const { leg, flight, keyframes } = interruptionFixture(250, -2);
  // This point used to differ by 2.66px: the first moving WAAPI segment has started while
  // the continuous negative spring progress still clamps the analytic corner arc to p=0.
  const elapsed = 8.975;
  const expected = waapiFlyerRect(flight, keyframes, elapsed / leg.duration);
  assert.ok(Math.abs(expected.left - interruptionFrom.left) > 1, 'the regression point is already moving');
  assertRectClose(evaluateLeg(leg, leg.startedAt + elapsed).rect, expected, 'negative launch');
  assert.ok(evaluateLeg(leg, leg.startedAt).speed < 0, 'the signed interruption model is preserved');
});

test('interruption boxes match emitted WAAPI tracks at 120Hz and 144Hz across speed tiers', () => {
  for (const direction of ['forward', 'back']) {
    for (const duration of [175, 250, 350]) {
      for (const speed of [undefined, -2, 0.734]) {
        const { leg, flight, keyframes } = interruptionFixture(duration, speed, direction);
        for (const hz of [120, 144]) {
          // Two frame phases include arbitrary between-keyframe timestamps, not just t=0.
          for (const phase of [0, 3.27]) {
            for (let elapsed = phase; elapsed < duration; elapsed += 1000 / hz) {
              const expected = waapiFlyerRect(flight, keyframes, elapsed / duration);
              assertRectClose(evaluateLeg(leg, leg.startedAt + elapsed).rect, expected,
                `${direction} ${hz}Hz ${duration}ms speed=${speed} t=${elapsed}`);
            }
          }
        }
        assertRectClose(evaluateLeg(leg, leg.startedAt - 30).rect, leg.from, 'before launch');
        assertRectClose(evaluateLeg(leg, leg.startedAt + duration + 30).rect, leg.to, 'after landing');
      }
    }
  }
  const { leg } = interruptionFixture(0, undefined);
  assertRectClose(evaluateLeg(leg, leg.startedAt).rect, interruptionTo, 'zero-duration landing');
  assert.equal(evaluateLeg(leg, leg.startedAt).speed, 0);
});
