/**
 * Visitor and share tracking, with no browser and no live service: who is counted and when
 * (`lib/visitor.ts` — production only, never automated or headless, never signed in, never twice
 * in a minute, never while hidden or in flight), what a count says (the pathname alone, a private
 * segment replaced by its route's name), the anonymous id, and the two requests (`track_visitor`
 * in `lib/api/tracking.ts`, `track_share` in `lib/api/share.ts`) — their bodies, their headers,
 * and that neither can throw into its caller.
 */
import assert from 'node:assert/strict';
import { beforeEach, test } from 'node:test';
import { requireTypeStripping } from './tsResolve.mjs';

requireTypeStripping('testTracking');

const values = new Map();
globalThis.localStorage = {
  getItem: (key) => values.get(key) ?? null,
  setItem: (key, value) => values.set(key, String(value)),
  removeItem: (key) => values.delete(key),
};
globalThis.window = {
  requestAnimationFrame: (callback) => setTimeout(callback, 0),
  addEventListener() {}, removeEventListener() {},
  dispatchEvent() { return true; },
  setTimeout: (...args) => setTimeout(...args),
  clearTimeout: (...args) => clearTimeout(...args),
  location: { origin: 'https://app.invalid' },
};
globalThis.document = { visibilityState: 'visible', hidden: false, cookie: '', addEventListener() {}, removeEventListener() {} };

let calls;
let respond;
beforeEach(() => {
  values.clear();
  calls = [];
  respond = () => Response.json({ success: true });
  globalThis.fetch = async (url, init = {}) => {
    calls.push({ url: new URL(String(url), 'https://app.invalid'), init });
    return respond();
  };
});

const visitor = await import('../lib/visitor.ts');
const { trackVisitor } = await import('../lib/api/tracking.ts');
const { trackShare } = await import('../lib/api/share.ts');

const tick = () => new Promise((resolve) => setImmediate(resolve));
const EDGE = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/154.0.0.0 Safari/537.36 Edg/154.0.0.0';
/** What the repo's CDP probes present — measured on this machine's Edge. */
const HEADLESS_EDGE = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/154.0.0.0 Safari/537.36 Edg/154.0.0.0';

// --- who is counted -----------------------------------------------------------------------

test('only a production build in an ordinary browser counts visits', () => {
  assert.equal(visitor.trackingAllowed('production', { webdriver: false, userAgent: EDGE }), true);
  assert.equal(visitor.trackingAllowed('development', { webdriver: false, userAgent: EDGE }), false,
    'the dev server proxies to the real backend: the team must not count');
  assert.equal(visitor.trackingAllowed('test', { webdriver: false, userAgent: EDGE }), false);
  assert.equal(visitor.trackingAllowed(undefined, { webdriver: false, userAgent: EDGE }), false);
  assert.equal(visitor.trackingAllowed('production', { webdriver: true, userAgent: EDGE }), false, 'the Playwright suites');
  assert.equal(visitor.trackingAllowed('production', { webdriver: false, userAgent: HEADLESS_EDGE }), false,
    'the CDP probes run headless without the automation flag');
  assert.equal(visitor.trackingAllowed('production', undefined), false, 'no browser at all');
  assert.equal(visitor.trackingAllowed('production', {}), true, 'a browser that says nothing about itself is a browser');
});

// --- the anonymous id -----------------------------------------------------------------------

test('a stored id is kept when it has the original front end’s shape, and replaced otherwise', () => {
  assert.equal(visitor.isVisitorId('vmfz1k2x3-a1b2c3d4e5-f6g7h8i9j0'), true, 'the original’s own ids survive');
  assert.equal(visitor.isVisitorId('A_b-' + 'x'.repeat(12)), true);
  assert.equal(visitor.isVisitorId('short'), false);
  assert.equal(visitor.isVisitorId('x'.repeat(97)), false);
  assert.equal(visitor.isVisitorId('has space in it here'), false);
  assert.equal(visitor.isVisitorId('含有中文的访客编号很长很长很长'), false);
  assert.equal(visitor.isVisitorId(null), false);
  assert.equal(visitor.isVisitorId(12345678901234567), false);
});

test('a fresh id is v<time>-<random>-<random>, valid by the same rule, random from the platform', () => {
  const fixed = visitor.newVisitorId(1_790_000_000_000, (bytes) => bytes.fill(7));
  assert.equal(fixed, `v${(1_790_000_000_000).toString(36)}-77777777-77777777`);
  assert.equal(visitor.isVisitorId(fixed), true);
  const a = visitor.newVisitorId();
  const b = visitor.newVisitorId();
  assert.match(a, /^v[0-9a-z]+-[0-9a-z]{8}-[0-9a-z]{8}$/);
  assert.notEqual(a, b);
  assert.equal(visitor.isVisitorId(a), true);
});

// --- what a count says ----------------------------------------------------------------------

test('a count names the pathname alone: never the query, never the hash', () => {
  assert.equal(visitor.visitorPath('/search?q=secret+words&from=alice'), '/search');
  assert.equal(visitor.visitorPath('/pic/123#comments'), '/pic/123');
  assert.equal(visitor.visitorPath('/'), '/');
  assert.equal(visitor.visitorPath(''), '/');
  assert.equal(visitor.visitorPath('?q=x'), '/');
  assert.equal(visitor.visitorPath('forum/5'), '/forum/5');
  assert.equal(visitor.visitorPath('/forum/5'), '/forum/5');
});

test('a segment that is somebody’s words or a share’s identity becomes its route’s name', () => {
  assert.equal(visitor.visitorPath('/subscriptions/oc%3Anyx'), '/subscriptions/[tag]');
  assert.equal(visitor.visitorPath('/subscriptions/rainbow%20dash/'), '/subscriptions/[tag]');
  assert.equal(visitor.visitorPath('/subscriptions'), '/subscriptions', 'the list itself is a route');
  assert.equal(visitor.visitorPath('/favorites/shared/alice/12'), '/favorites/shared/[username]/[folderId]');
  assert.equal(visitor.visitorPath('/favorites/privacy/7'), '/favorites/privacy/[ownerId]');
  assert.equal(visitor.visitorPath('/user/1'), '/user/1', 'a public profile id is not private');
});

test('a path is capped at the original’s 255 characters, by character rather than by UTF-16 unit', () => {
  const long = `/forum/${'帖'.repeat(400)}`;
  const capped = visitor.visitorPath(long);
  assert.equal(Array.from(capped).length, 255);
  const astral = `/${'😀'.repeat(300)}`;
  assert.equal(Array.from(visitor.visitorPath(astral)).length, 255, 'a surrogate pair is never split');
});

// --- when -----------------------------------------------------------------------------------

function harness(overrides = {}) {
  const state = { now: 1_000_000, hidden: false, signedIn: false, stored: null, stores: 0, sent: [], pending: null };
  const tracker = visitor.createVisitorTracker({
    now: () => state.now,
    isHidden: () => state.hidden,
    isSignedIn: () => state.signedIn,
    readId: () => state.stored,
    storeId: (id) => { state.stored = id; state.stores += 1; },
    pathname: () => '/search',
    send: (id, path) => {
      state.sent.push({ id, path });
      return state.pending ?? Promise.resolve();
    },
    ...overrides,
  });
  return { state, tracker };
}

test('the first visit mints and keeps an id; the next within a minute is not counted', async () => {
  const { state, tracker } = harness();
  assert.equal(await tracker.visit(), true);
  assert.equal(state.sent.length, 1);
  assert.equal(visitor.isVisitorId(state.sent[0].id), true);
  assert.equal(state.stored, state.sent[0].id, 'the id is stored for the next load');
  assert.equal(state.sent[0].path, '/search');
  state.now += visitor.VISIT_MIN_GAP_MS - 1;
  assert.equal(await tracker.visit(), false, 'a minute has not passed');
  state.now += 1;
  assert.equal(await tracker.visit(), true);
  assert.equal(state.sent[1].id, state.sent[0].id, 'the same visitor');
  assert.equal(state.stores, 1, 'minted once');
});

test('a hidden tab and a signed-in visitor are never counted, and get no id', async () => {
  const { state, tracker } = harness();
  state.hidden = true;
  assert.equal(await tracker.visit(), false);
  state.hidden = false;
  state.signedIn = true;
  assert.equal(await tracker.visit(), false, 'the original skipped whenever a session was stored');
  assert.equal(state.sent.length, 0);
  assert.equal(state.stores, 0, 'nothing was minted for a visit that was not counted');
});

test('one count in flight at a time, and the guard lifts when it settles', async () => {
  let release;
  const { state, tracker } = harness();
  state.pending = new Promise((resolve) => { release = resolve; });
  const first = tracker.visit();
  state.now += visitor.VISIT_MIN_GAP_MS;
  assert.equal(await tracker.visit(), false, 'still in flight');
  release();
  assert.equal(await first, true);
  state.pending = null;
  assert.equal(await tracker.visit(), true, 'settled, and a minute on');
});

test('an id that is not one is replaced, and a failed send still lifts the guard', async () => {
  const { state, tracker } = harness({
    send: async () => { throw new Error('boom'); },
  });
  state.stored = 'bad id';
  await assert.rejects(tracker.visit());
  assert.equal(visitor.isVisitorId(state.stored), true, 'replaced');
  state.now += visitor.VISIT_MIN_GAP_MS;
  await assert.rejects(tracker.visit(), 'not stuck in flight');
});

test('the interval is the original’s ten minutes', () => {
  assert.equal(visitor.VISIT_INTERVAL_MS, 10 * 60 * 1000);
  assert.equal(visitor.VISIT_MIN_GAP_MS, 60 * 1000);
});

// --- the requests -----------------------------------------------------------------------------

test('track_visitor: a keepalive JSON POST of {visitor_id, path}, with no token', async () => {
  await trackVisitor('vabc-12345678-12345678', '/search');
  assert.equal(calls.length, 1);
  const [{ url, init }] = calls;
  assert.equal(url.pathname, '/api.php');
  assert.equal(url.searchParams.get('action'), 'track_visitor');
  assert.equal(init.method, 'POST');
  assert.equal(init.keepalive, true, 'a count sent as the tab goes away still leaves');
  assert.equal(init.cache, 'no-store');
  assert.deepEqual(JSON.parse(init.body), { visitor_id: 'vabc-12345678-12345678', path: '/search' });
  const headers = new Headers(init.headers);
  assert.equal(headers.get('content-type'), 'application/json');
  assert.equal(headers.get('authorization'), null, 'a visit is anonymous');
  assert.ok(init.signal, 'bounded: the original aborted at ten seconds');
});

test('track_visitor never rejects — a dead line, a 500 and a refusal all resolve', async () => {
  globalThis.fetch = async () => { throw new TypeError('Failed to fetch'); };
  assert.equal(await trackVisitor('vabc-12345678-12345678', '/'), undefined);
  globalThis.fetch = async () => new Response('oops', { status: 500 });
  assert.equal(await trackVisitor('vabc-12345678-12345678', '/'), undefined);
  globalThis.fetch = async () => Response.json({ success: false, error: 'no' });
  assert.equal(await trackVisitor('vabc-12345678-12345678', '/'), undefined);
});

test('track_share: only signed in, a bodiless POST with the token, and never throws', async () => {
  trackShare(null);
  trackShare(undefined);
  trackShare('');
  await tick();
  assert.equal(calls.length, 0, 'a visitor’s share is not counted: the share tasks are an account’s');
  trackShare('tok');
  await tick();
  assert.equal(calls.length, 1);
  const [{ url, init }] = calls;
  assert.equal(url.searchParams.get('action'), 'track_share');
  assert.equal(init.method, 'POST');
  assert.equal(init.body, undefined);
  assert.equal(new Headers(init.headers).get('authorization'), 'Bearer tok');
  let unhandled = null;
  const onUnhandled = (reason) => { unhandled = reason; };
  process.on('unhandledRejection', onUnhandled);
  globalThis.fetch = async () => { throw new TypeError('Failed to fetch'); };
  trackShare('tok');
  await tick();
  await tick();
  process.off('unhandledRejection', onUnhandled);
  assert.equal(unhandled, null, 'a failed count costs a count, never the share');
});

test('an acknowledged share expires only its current account’s task progress', async () => {
  const { tasks } = await import('../lib/resources.ts');
  const token = 'share-task-current';
  const other = 'share-task-other';
  const seed = { level: 1, experience: 0, coins: 0, equippedBadges: [], progress: { novice: null, daily: null, weekly: null } };
  const signIn = (value) => values.set('user_info', JSON.stringify({ id: 1, token: value }));
  const fresh = () => {
    tasks.invalidate({ token });
    tasks.invalidate({ token: other });
    tasks.seed({ token }, seed, Date.now());
    tasks.seed({ token: other }, seed, Date.now());
  };
  const settleShare = async () => {
    for (let i = 0; i < 10; i += 1) await tick();
  };

  fresh();
  signIn(token);
  trackShare(token);
  for (let i = 0; i < 50 && !tasks.peek({ token }).isStale; i += 1) await tick();
  assert.equal(tasks.peek({ token }).isStale, true, 'Back must re-read a task completed by the share');
  assert.equal(tasks.peek({ token: other }).isStale, false);
  assert.equal(calls.length, 1, 'expiring an unmounted task screen sends no speculative read');

  fresh();
  respond = () => Response.json({ success: false, error: '分享未计入' });
  trackShare(token);
  await settleShare();
  assert.equal(tasks.peek({ token }).isStale, false, 'a refused count does not change task progress');

  fresh();
  respond = () => {
    signIn(other);
    return Response.json({ success: true });
  };
  trackShare(token);
  await settleShare();
  assert.equal(tasks.peek({ token }).isStale, false, 'a stale response cannot refresh an old session');
  assert.equal(tasks.peek({ token: other }).isStale, false);
  tasks.invalidate({ token });
  tasks.invalidate({ token: other });
});
