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

console.log('Resource regressions passed: writes, refreshes, invalidation, races, account clear.');
