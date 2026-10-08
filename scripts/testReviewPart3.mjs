/**
 * Regression cases for review part 3 (gallery, detail, hero, the resource cache), with no live
 * service: each test names the finding it pins (`P3-Fn` in `part3-review.md`).
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { requireTypeStripping } from './tsResolve.mjs';

requireTypeStripping('testReviewPart3');

const values = new Map();
globalThis.localStorage = {
  getItem: (key) => (values.has(key) ? values.get(key) : null),
  setItem: (key, value) => values.set(key, String(value)),
  removeItem: (key) => values.delete(key),
};
const frames = [];
globalThis.window = {
  requestAnimationFrame: (callback) => { frames.push(callback); return frames.length; },
  cancelAnimationFrame() {},
  addEventListener() {}, removeEventListener() {},
  dispatchEvent() { return true; },
  setTimeout: (...args) => setTimeout(...args),
  clearTimeout: (...args) => clearTimeout(...args),
  matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }),
};
globalThis.document = {
  visibilityState: 'visible', hidden: false, activeElement: null, cookie: '',
  addEventListener() {}, removeEventListener() {},
};

/* `get_user` answers are held until a test releases them, one by one, in order. */
const heldUsers = [];
globalThis.fetch = async (url) => {
  const action = new URL(String(url), 'https://app.invalid').searchParams.get('action');
  if (action !== 'get_user') throw new Error(`Unexpected network request: ${url}`);
  return new Promise((resolve) => heldUsers.push(resolve));
};
const answerUser = (settings) =>
  heldUsers.shift()(new Response(JSON.stringify({ success: true, user: { id: 7, username: 'pony', settings } }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  }));

const { LS_KEYS } = await import('../lib/constants.ts');
const { defineResource } = await import('../lib/resource.ts');
const catalogue = await import('../lib/resources.ts');
const sequence = await import('../lib/imageSequence.ts');
const comments = await import('../lib/imageComments.ts');
const { readableSourceUrl, sourceLinksOf } = await import('../lib/imageSources.ts');

const flush = () => new Promise((resolve) => setImmediate(resolve));
const frame = async () => {
  await flush();
  while (frames.length) frames.shift()();
  await flush();
};
const until = async (predicate) => {
  for (let i = 0; i < 50 && !predicate(); i += 1) await flush();
  assert.ok(predicate(), 'timed out waiting');
};

test('P3-F1: the settings sync\'s account read settles on its own answer, whoever else reads or writes', async () => {
  const token = 'token-p3';
  values.set(LS_KEYS.userInfo, JSON.stringify({ token, id: 7, username: 'pony' }));
  const { settingsSyncBridge, sessionUser } = catalogue;

  /* Another forced read of the account while the sync's is out (the e-mail dialog does one). */
  let settled = null;
  const refresh = settingsSyncBridge.refreshSession(token).then(
    (value) => { settled = { value }; },
    (error) => { settled = { error }; },
  );
  await until(() => heldUsers.length === 1);
  const other = sessionUser.read({ token }, { force: true }).catch(() => {});
  await flush();
  assert.equal(settled, null, 'another read does not cancel the sync\'s');
  while (heldUsers.length) answerUser({ theme: 'a' });
  await refresh;
  await other;
  assert.equal(settled.error, undefined, 'it used to reject as aborted, and the sync stopped without writing');

  /* A write to the account while the sync's read is out (a checkout's coin balance). */
  settled = null;
  const second = settingsSyncBridge.refreshSession(token).then(() => { settled = 'done'; });
  await until(() => heldUsers.length === 1);
  sessionUser.write({ token }, { kind: 'ok', user: { id: 7, username: 'pony', coins: 3 } });
  await flush();
  assert.equal(settled, null, 'a write is not the read the sync is waiting for');
  answerUser({ theme: 'b' });
  await second;
  await frame();
  assert.equal(sessionUser.peek({ token }).data.user.settings.theme, 'b', 'the answer is installed for every reader');
  assert.equal(sessionUser.peek({ token }).isStale, false, 'and counts as a fresh read');
  values.delete(LS_KEYS.userInfo);
});

test('P3-F2: a queued guess promoted to a real read keeps the value on screen', async () => {
  /* Two hanging background reads fill the lane's background share, so the next guess queues. */
  const hang = [];
  const blocker = defineResource({
    name: 'p3-blocker', lane: 'derpi', key: ({ id }) => id,
    fetch: () => new Promise((resolve) => hang.push(resolve)),
  });
  blocker.prefetch({ id: 'a' });
  blocker.prefetch({ id: 'b' });

  let fail = false;
  const reads = [];
  const resource = defineResource({
    name: 'p3-promoted', lane: 'derpi', key: () => 'page',
    fetch: () => new Promise((resolve, reject) => reads.push(() => (fail ? reject(new Error('down')) : resolve(['fresh'])))),
  });
  resource.write({}, ['shown']);
  const unsubscribe = resource.subscribe({}, () => {});
  /* A refresh that fails keeps the value with an error … */
  fail = true;
  const failed = resource.read({}, { force: true }).catch(() => {});
  await until(() => reads.length === 1);
  reads.shift()();
  await failed;
  await frame();
  assert.deepEqual(resource.peek({}).data, ['shown']);
  /* … a guess retries it behind the busy lane, then the screen asks for real. */
  fail = false;
  let guess = null;
  void resource.read({}, { priority: 'background' }).then((value) => { guess = value; }, (error) => { guess = error; });
  const real = resource.read({});
  await frame();
  assert.deepEqual(resource.peek({}).data, ['shown'], 'the promoted read used to start with no data — a skeleton');
  await until(() => reads.length === 1);
  reads.shift()();
  assert.deepEqual(await real, ['fresh']);
  await flush();
  assert.deepEqual(guess, ['fresh'], 'the guess resolves with the answer, not with a cancellation');
  await frame();
  assert.deepEqual(resource.peek({}).data, ['fresh']);
  unsubscribe();
  for (const resolve of hang) resolve('x');
});

test('P3-F3: a step past an end skips pages that add nothing and stops at the real end', async () => {
  const pages = { 1: [1, 2, 3], 2: [], 3: [3], 4: [7, 8] };
  const asked = [];
  const source = sequence.createPagedSequence({
    key: 'p3', page: 1, current: { ids: pages[1], totalPages: 4 }, pageSize: Number.MAX_SAFE_INTEGER,
    fetchPage: async (page) => {
      asked.push(page);
      return { ids: pages[page], totalPages: 4 };
    },
  });
  sequence.openFromSequence(source);
  /* Page 2 came back empty (all withheld), page 3 only repeats a seam: neither is the end. */
  assert.equal(await sequence.stepImageSequence(3, 1), 7, 'it used to say 已是最后一张 after the empty page');
  assert.deepEqual(asked, [2, 3, 4]);
  assert.equal(await sequence.stepImageSequence(8, 1), null, 'the last page is still the end');
  assert.deepEqual(asked, [2, 3, 4], 'nothing is read past totalPages');

  /* A list that keeps answering empty pages is bounded. */
  let reads = 0;
  const endless = sequence.createPagedSequence({
    key: 'p3-endless', page: 1, current: { ids: [1], totalPages: 1000 }, pageSize: Number.MAX_SAFE_INTEGER,
    fetchPage: async () => {
      reads += 1;
      return { ids: [], totalPages: 1000 };
    },
  });
  sequence.openFromSequence(endless);
  assert.equal(await sequence.stepImageSequence(1, 1), null);
  assert.ok(reads <= 4, `at most four pages per step, read ${reads}`);
  sequence.clearImageSequence();
});

test('P3-F4: a reply names only PicPony comments and accounts', () => {
  assert.deepEqual(comments.replyReference(null), { userId: 0, commentId: null });
  assert.deepEqual(comments.replyReference({ id: 42, source: 'picpony', userId: 9 }), { userId: 9, commentId: 42 });
  assert.deepEqual(
    comments.replyReference({ id: 42, source: 'trixiebooru', userId: null }),
    { userId: 0, commentId: null },
    'a Derpibooru comment id used to be sent as reply_to_comment_id',
  );
  const composer = readFileSync(new URL('../components/CommentComposer.tsx', import.meta.url), 'utf8');
  assert.match(composer, /replyReference\(replyTo\)/);
  assert.doesNotMatch(composer, /commentId:\s*replyTo\?\.id/);
});

test('P3-F5: a source link shows its invisible characters escaped', () => {
  const spoof = 'https://evil.example/%E2%80%AEgpj.moc.elgoog';
  assert.equal(readableSourceUrl(spoof), spoof, 'U+202E used to be decoded into the text');
  assert.equal(readableSourceUrl('https://example.com/%E5%9B%BE%E7%89%87'), 'https://example.com/图片');
  assert.equal(readableSourceUrl('https://example.com/a%20b'), 'https://example.com/a b');
  assert.equal(readableSourceUrl('https://example.com/%E2%80%8Bx%00'), 'https://example.com/%E2%80%8Bx%00');
  assert.equal(readableSourceUrl('https://example.com/%E0%A4'), 'https://example.com/%E0%A4', 'a malformed escape stays as it is');
  assert.deepEqual(
    sourceLinksOf({ source_url: 'https://a.example', source_urls: ['javascript:alert(1)', ' https://a.example ', 'https://b.example'] }),
    ['https://a.example', 'https://b.example'],
  );
});

test('P3-F6: 加载更多 is offered by page count, not by rows', () => {
  const page = (n) => Array.from({ length: n }, (_, i) => ({ id: i }));
  assert.equal(comments.hasMoreDerpiComments([page(50)], 120), true);
  assert.equal(comments.hasMoreDerpiComments([page(50), page(50)], 120), true);
  assert.equal(comments.hasMoreDerpiComments([page(50), page(50), page(18)], 120), false);
  /* A page that dropped two unusable rows: 98 rows, but both pages are read. */
  assert.equal(comments.hasMoreDerpiComments([page(50), page(48)], 100), false, 'rows < total used to offer it for ever');
  assert.equal(comments.hasMoreDerpiComments([page(50), page(0)], 400), false, 'an empty page is the end');
  assert.equal(comments.hasMoreDerpiComments([page(10)], null), false);
});
