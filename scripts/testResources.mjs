/** Regression checks for mutable resource answers, subscriptions and cancelled work. */
import assert from 'node:assert/strict';
import { requireTypeStripping } from './tsResolve.mjs';

requireTypeStripping('testResources');

const frames = [];
globalThis.window = { requestAnimationFrame: (callback) => frames.push(callback) };
globalThis.document = { visibilityState: 'visible', addEventListener() {} };
const { defineResource, clearAllResources } = await import('../lib/resource.ts');
const tick = async () => {
  await new Promise((resolve) => setImmediate(resolve));
  while (frames.length) frames.shift()();
};
const deferred = () => {
  let resolve;
  const promise = new Promise((settle) => { resolve = settle; });
  return { promise, resolve };
};

let calls = 0;
let answer = ['old'];
let pending;
const resource = defineResource({
  name: 'regression', key: ({ id }) => id,
  fetch: async () => {
    calls += 1;
    return pending ? pending.promise : answer;
  },
});
const args = { id: 'account-a' };
let publications = 0;
const unsubscribe = resource.subscribe(args, () => { publications += 1; });

// A mutation on a subscriber-only key must install an answer without starting a read.
resource.write(args, ['created']);
assert.equal(calls, 0);
assert.deepEqual(await resource.read(args), ['created']);
await tick();
assert.deepEqual(resource.peek(args).data, ['created']);
assert.equal(publications, 1);

// Subscribers and imperative callers must see the same answer after a refresh.
answer = ['refreshed'];
resource.expire(args);
resource.expire(args);
await tick();
assert.equal(calls, 1, 'overlapping refreshes are coalesced');
assert.deepEqual(await resource.read(args), ['refreshed']);
assert.deepEqual(resource.peek(args).data, ['refreshed']);

// An old background response may ignore AbortSignal; it still cannot undo a write.
pending = deferred();
resource.expire(args);
resource.write(args, (previous) => [...previous, 'mutation']);
pending.resolve(['stale response']);
pending = undefined;
await tick();
assert.deepEqual(await resource.read(args), ['refreshed', 'mutation']);
assert.deepEqual(resource.peek(args).data, ['refreshed', 'mutation']);

// Invalidating a mounted key re-reads it without abandoning the existing subscription.
answer = [];
const beforeInvalidation = calls;
const beforePublications = publications;
resource.invalidate(args);
await tick();
assert.equal(calls, beforeInvalidation + 1);
assert.ok(publications > beforePublications);
assert.deepEqual(resource.peek(args).data, []);
resource.write(args, ['still subscribed']);
await tick();
assert.deepEqual(resource.peek(args).data, ['still subscribed']);
assert.ok(publications > beforePublications + 1);

// Writing while the first fetch is pending settles its readers with the written value.
pending = deferred();
const firstRead = resource.read({ id: 'pending' });
resource.write({ id: 'pending' }, ['accepted mutation']);
assert.deepEqual(await firstRead, ['accepted mutation']);
pending.resolve(['obsolete initial fetch']);
pending = undefined;
await tick();
assert.deepEqual(resource.peek({ id: 'pending' }).data, ['accepted mutation']);

// Logout is a clear, not a revalidation: no old-token request or late publication survives.
pending = deferred();
resource.expire(args);
const beforeClear = calls;
clearAllResources();
pending.resolve(['previous account']);
pending = undefined;
await tick();
assert.equal(calls, beforeClear);
assert.equal(resource.peek(args).data, undefined);
assert.equal(resource.peek({ id: 'pending' }).data, undefined);
unsubscribe();

// Each upstream has its own slots: four hung Derpibooru reads cannot hold back a PicPony read.
{
  const started = [];
  const hang = (name) => defineResource({
    name, lane: name === 'forum' ? 'picpony' : 'derpi', key: ({ id }) => id,
    fetch: (_, signal) => new Promise((_, reject) => {
      started.push(name);
      signal.addEventListener('abort', () => reject(signal.reason), { once: true });
    }),
  });
  const pages = hang('pages');
  const forum = hang('forum');
  const reads = [1, 2, 3, 4, 5].map((id) => pages.read({ id: String(id) }));
  forum.read({ id: 'thread' }).catch(() => {});
  await tick();
  assert.equal(started.filter((name) => name === 'pages').length, 4, 'the Derpibooru lane caps at four');
  assert.ok(started.includes('forum'), 'the PicPony lane is not blocked by it');
  clearAllResources();
  await Promise.allSettled(reads);
}

// A superseded first read nobody watches gives its slot back; a watched one is kept.
{
  let aborted = 0;
  const release = defineResource({ name: 'release', key: ({ id }) => id,
    fetch: (_, signal) => new Promise((_, reject) => signal.addEventListener('abort', () => { aborted += 1; reject(signal.reason); }, { once: true })) });
  const pendingA = release.read({ id: 'a' });
  pendingA.catch(() => {});
  release.release('a');
  await tick();
  assert.equal(aborted, 1, 'an unanswered read with no reader is abandoned');
  const unsubscribeB = release.subscribe({ id: 'b' }, () => {});
  release.read({ id: 'b' }).catch(() => {});
  release.release('b');
  await tick();
  assert.equal(aborted, 1, 'a read somebody still watches is kept');
  unsubscribeB();
  clearAllResources();
}

// A failed background refresh leaves the answer stale, so the next read tries again.
{
  let attempt = 0;
  let fail = false;
  const stale = defineResource({ name: 'stale', key: () => 'k', ttl: 1,
    fetch: async () => { attempt += 1; if (fail) throw new Error('offline'); return attempt; } });
  const unsubscribe = stale.subscribe({}, () => {});
  await stale.read({});
  await tick();
  await new Promise((resolve) => setTimeout(resolve, 5));
  fail = true;
  stale.expire({});
  await tick();
  assert.equal(stale.peek({}).data, 1, 'the shown value survives a failed refresh');
  await stale.read({});
  await tick();
  assert.equal(attempt, 3, 'so the next read refreshes again instead of waiting out a TTL');
  unsubscribe();
  clearAllResources();
}

// Invalidating keeps the mounted answer; a write in the same tick wins without a request.
{
  let fetches = 0;
  const list = defineResource({ name: 'list', key: ({ page }) => String(page), fetch: async () => { fetches += 1; return ['server']; } });
  const unsubscribe = list.subscribe({ page: 1 }, () => {});
  list.write({ page: 1 }, ['old']);
  list.write({ page: 2 }, ['old page two']);
  await tick();
  list.invalidate();
  assert.deepEqual(list.peek({ page: 1 }).data, ['old'], 'the mounted page keeps its rows while re-read');
  list.write({ page: 1 }, []);
  await tick();
  assert.equal(fetches, 0, 'the write replaced the pending re-read before it was sent');
  assert.deepEqual(list.peek({ page: 1 }).data, []);
  assert.equal(list.peek({ page: 2 }).data, undefined, 'unmounted pages are dropped');
  list.invalidate();
  await tick();
  assert.equal(fetches, 1, 'without a write the mounted key is re-read once');
  assert.deepEqual(list.peek({ page: 1 }).data, ['server']);
  unsubscribe();
  clearAllResources();
}

console.log('Resource regressions passed: writes, refreshes, invalidation, races, account clear, lanes, release.');
