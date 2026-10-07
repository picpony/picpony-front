/**
 * The route container transforms' life across a route change (`lib/routeContainerPlay.ts`) and the
 * folder transit's bookkeeping (`lib/folderTransit.ts`). The leg itself is a browser's to play —
 * `F7/FX/folders` holds its per-frame probes — so a run here is a stand-in that records what it was
 * asked to do; what is under test is who keeps it, who may take it over and when it is let go.
 */
import { requireTypeStripping } from './tsResolve.mjs';
import assert from 'node:assert/strict';
import { beforeEach, test } from 'node:test';

requireTypeStripping('testFolderTransit');

/* A frame clock the tests turn by hand; a frame's callbacks schedule into the next one. */
let frames = new Map();
let nextFrame = 1;
globalThis.requestAnimationFrame = (callback) => {
  const id = nextFrame;
  nextFrame += 1;
  frames.set(id, callback);
  return id;
};
globalThis.cancelAnimationFrame = (id) => {
  frames.delete(id);
};
function frame() {
  const due = [...frames.values()];
  frames = new Map();
  for (const callback of due) callback(performance.now());
}
const microtask = () => new Promise((resolve) => queueMicrotask(resolve));

/* `<html>` as far as the motion tier is concerned. */
const root = { dataset: { motion: 'standard' } };
globalThis.document = { documentElement: root };
globalThis.window = { innerHeight: 900 };

const route = await import('../lib/routeContainerPlay.ts');
const transit = await import('../lib/folderTransit.ts');
const { setHeroBusyCheck } = await import('../lib/appScroller.ts');

function standIn({ turns = true } = {}) {
  const calls = [];
  const handle = {
    done: false,
    finish() {
      calls.push('finish');
      handle.done = true;
    },
    suspend: () => calls.push('suspend'),
    resume: () => calls.push('resume'),
    fadeOut() {
      calls.push('fadeOut');
    },
    turn(target) {
      calls.push(['turn', target]);
      return turns;
    },
  };
  return { handle, calls };
}

const element = (connected = true) => ({ isConnected: connected });

beforeEach(() => {
  frames = new Map();
  root.dataset.motion = 'standard';
  setHeroBusyCheck(null);
  transit.clearFolderReturn();
});

test('a flight let go of while its element stays carries on: React’s development double invoke', async () => {
  const { handle, calls } = standIn();
  const target = element();
  const flight = route.trackFlight(handle, { key: 'folder:/a', leg: 'open', target });
  route.release(flight);
  assert.deepEqual(calls, ['suspend'], 'stops landing on a scroll at once, before a route change restores one');
  assert.equal(route.flightOn(target), flight, 'a second attach adopts it rather than starting another');
  await microtask();
  assert.deepEqual(calls, ['suspend', 'resume']);
  frame();
  frame();
  frame();
  assert.ok(!calls.includes('fadeOut'), 'it is not dismissed');
  assert.equal(route.claimable('folder:/a', 'back'), null, 'and nothing may take it over');
  route.untrackFlight(flight);
});

test('a flight whose page has gone waits two frames for the page coming in, then fades where it is', async () => {
  const { handle, calls } = standIn();
  const target = element();
  const flight = route.trackFlight(handle, { key: 'folder:/a', leg: 'open', target });
  target.isConnected = false;
  route.release(flight);
  await microtask();
  assert.ok(flight.orphaned);
  assert.equal(route.claimable('folder:/a', 'back'), flight, 'the list coming back may turn it');
  assert.equal(route.claimable('folder:/a', 'open'), null, 'nothing going the same way may');
  assert.equal(route.claimable('folder:/b', 'back'), null, 'nor another folder’s card');
  frame();
  assert.ok(!calls.includes('fadeOut'), 'still waiting after one frame');
  frame();
  assert.ok(calls.includes('fadeOut'), 'faded after two');
  assert.equal(route.claimable('folder:/a', 'back'), null, 'and forgotten');
});

test('the page coming in claims it, turns it onto its own element, and it stops waiting', async () => {
  const { handle, calls } = standIn();
  const page = element();
  const flight = route.trackFlight(handle, { key: 'folder:/a', leg: 'open', target: page });
  page.isConnected = false;
  route.release(flight);
  await microtask();
  frame();
  const card = element();
  const turn = { to: { box: { left: 0, top: 0, width: 10, height: 10 }, radii: [12, 12, 12, 12], colour: 'red' }, hidden: [] };
  assert.equal(route.turnFlight(flight, 'back', card, turn), true);
  assert.deepEqual(calls.at(-1), ['turn', turn]);
  assert.equal(flight.leg, 'back');
  assert.equal(route.flightOn(card), flight, 'it now lands on the card, and the card’s own attach adopts it');
  frame();
  frame();
  frame();
  assert.ok(!calls.includes('fadeOut'), 'claimed: no longer dismissed');
  route.untrackFlight(flight);
});

test('a claim in the same commit, before the release’s microtask, holds', async () => {
  const { handle, calls } = standIn();
  const page = element();
  const flight = route.trackFlight(handle, { key: 'forum:7', leg: 'open', target: page });
  page.isConnected = false;
  route.release(flight);
  const row = element();
  assert.equal(route.claimable('forum:7', 'back'), flight, 'an element removed in this commit is gone already');
  route.turnFlight(flight, 'back', row, { to: { box: { left: 0, top: 0, width: 1, height: 1 }, radii: [0, 0, 0, 0], colour: '' }, hidden: [] });
  await microtask();
  assert.ok(!flight.orphaned, 'its new element is there, so it is not an orphan');
  assert.equal(calls.at(-1), 'resume');
  frame();
  frame();
  assert.ok(!calls.includes('fadeOut'));
  route.untrackFlight(flight);
});

test('a flight that cannot be turned fades where it is', async () => {
  const { handle, calls } = standIn({ turns: false });
  const page = element();
  const flight = route.trackFlight(handle, { key: 'folder:/a', leg: 'open', target: page });
  page.isConnected = false;
  route.release(flight);
  await microtask();
  const card = element();
  assert.equal(route.turnFlight(flight, 'back', card, { to: { box: { left: 0, top: 0, width: 1, height: 1 }, radii: [0, 0, 0, 0], colour: '' }, hidden: [] }), false);
  assert.ok(calls.includes('fadeOut'));
  assert.equal(route.claimable('folder:/a', 'back'), null);
  assert.equal(route.flightOn(card), null);
});

test('letting go twice orphans once, and a finished flight is let go of quietly', async () => {
  const { handle, calls } = standIn();
  const page = element();
  const flight = route.trackFlight(handle, { key: 'folder:/a', leg: 'open', target: page });
  page.isConnected = false;
  route.release(flight);
  route.release(flight);
  await microtask();
  frame();
  frame();
  assert.equal(calls.filter((call) => call === 'fadeOut').length, 1);

  const second = standIn();
  const other = route.trackFlight(second.handle, { key: 'folder:/b', leg: 'back', target: element() });
  second.handle.finish();
  route.untrackFlight(other);
  route.release(other);
  await microtask();
  assert.deepEqual(second.calls, ['finish'], 'nothing is asked of a run that is over');
});

test('a folder page left on screen is remembered for its card, under the standard tier only', () => {
  const page = { getBoundingClientRect: () => ({ top: 100, bottom: 900 }) };
  transit.rememberFolderReturn('/favorites/folder/3', page);
  assert.equal(transit.readFolderReturn()?.key, '/favorites/folder/3');
  transit.clearFolderReturn();
  assert.equal(transit.readFolderReturn(), null);

  for (const tier of ['reduced', 'off']) {
    root.dataset.motion = tier;
    transit.rememberFolderReturn('/favorites/folder/3', page);
    assert.equal(transit.readFolderReturn(), null, `${tier}: the route's own fade is the whole transition`);
  }
  root.dataset.motion = 'standard';

  transit.rememberFolderReturn('/favorites/folder/3', { getBoundingClientRect: () => ({ top: -900, bottom: 0 }) });
  assert.equal(transit.readFolderReturn(), null, 'a page scrolled off screen has nothing to carry back');
});

test('a remembered page goes stale with its navigation, and stands down while a flight owns the screen', () => {
  const page = { getBoundingClientRect: () => ({ top: 100, bottom: 900 }) };
  const realNow = performance.now.bind(performance);
  let now = realNow();
  performance.now = () => now;
  try {
    transit.rememberFolderReturn('/favorites/shared/a/2', page);
    now += 2900;
    assert.equal(transit.readFolderReturn()?.key, '/favorites/shared/a/2');
    setHeroBusyCheck(() => true);
    assert.equal(transit.readFolderReturn(), null, 'a picture flying owns those pixels');
    setHeroBusyCheck(null);
    now += 200;
    assert.equal(transit.readFolderReturn(), null, 'three seconds: a Back much later replays nothing');
  } finally {
    performance.now = realNow;
  }
});
