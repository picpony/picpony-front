/**
 * Data-layer guards, with no live service: the route policy's bounded wait, the API line's
 * probe-based return and once-per-session notices, the SSR feed's backoff and its two unseeded
 * feeds, the browsing cookie's unmirrorable marker, a failed policy read keeping the public rules,
 * blocked-storage sign-in, and Escape inside a field.
 */
import assert from 'node:assert/strict';
import { after, beforeEach, test } from 'node:test';
import { blockFiltersEnvelope } from './netAuditFixtures.mjs';
import { requireTypeStripping } from './tsResolve.mjs';

requireTypeStripping('testDataLayer');

const originalFetch = globalThis.fetch;
const values = new Map();
const cookies = new Map();
const events = [];
const storage = {
  getItem: (key) => values.get(key) ?? null,
  setItem: (key, value) => values.set(key, String(value)),
  removeItem: (key) => values.delete(key),
};
globalThis.localStorage = storage;
/* No inline policy: the first test is the document that arrived without one. */
globalThis.window = {
  requestAnimationFrame: (callback) => setTimeout(callback, 0),
  addEventListener() {}, removeEventListener() {},
  dispatchEvent(event) { events.push(event.type); return true; },
  /* Resolved at call time, so mocked timers reach the route module's `window.setTimeout`. */
  setTimeout: (...args) => setTimeout(...args),
  clearTimeout: (...args) => clearTimeout(...args),
};
globalThis.document = {
  visibilityState: 'visible', hidden: false, activeElement: null,
  addEventListener() {}, removeEventListener() {},
  get cookie() { return [...cookies].map(([key, value]) => `${key}=${value}`).join('; '); },
  set cookie(value) {
    const pair = value.split(';', 1)[0];
    const split = pair.indexOf('=');
    cookies.set(pair.slice(0, split), pair.slice(split + 1));
  },
};
/* Just enough of the element hierarchy for `isEditableTarget`'s `instanceof` tests. */
class FakeElement { constructor(props = {}) { Object.assign(this, props); } }
class FakeInput extends FakeElement {}
class FakeTextArea extends FakeElement {}
class FakeSelect extends FakeElement {}
Object.assign(globalThis, {
  HTMLElement: FakeElement,
  HTMLInputElement: FakeInput,
  HTMLTextAreaElement: FakeTextArea,
  HTMLSelectElement: FakeSelect,
});
globalThis.fetch = async (url) => { throw new Error(`Unexpected network request: ${url}`); };

const route = await import('../lib/route.ts');
const hooks = await import('../lib/hooks.ts');
const catalogue = await import('../lib/resources.ts');
const { readHomeFeed, seedOnImageLine } = await import('../lib/feed.server.ts');
const { applyImageLine } = await import('../lib/api/client.ts');
const { readRoutePolicy } = await import('../lib/route.server.ts');
const { clearBlockFiltersMemo, clearPublicBlacklistMemo } = await import('../lib/blockFilters.server.ts');
const { COOKIE_KEYS, LS_KEYS, IMAGE_CDN_BASE, IMAGE_WORKER_BASE } = await import('../lib/constants.ts');
const { UNMIRRORABLE_FINGERPRINT } = await import('../lib/searchQuery.ts');

const flush = () => new Promise((resolve) => setImmediate(resolve));
const json = (data, init) => Response.json(data, init);

beforeEach(() => {
  values.clear();
  cookies.clear();
  events.length = 0;
  globalThis.localStorage = storage;
  globalThis.fetch = async (url) => { throw new Error(`Unexpected network request: ${url}`); };
  route.syncLinePrefs();
});
after(() => { globalThis.fetch = originalFetch; });

test('a request waits at most 2s for a policy the document did not carry', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'] });
  const asked = [];
  globalThis.fetch = (url) => {
    asked.push(new URL(String(url), 'https://app.invalid').searchParams.get('action'));
    return new Promise(() => {});
  };
  let settled = false;
  void route.ensureRoutePolicy().then(() => { settled = true; });
  await flush();
  assert.deepEqual(asked.sort(), ['get_block_tags', 'get_maintenance_status', 'get_public_blacklist']);
  t.mock.timers.tick(1_999);
  await flush();
  assert.equal(settled, false, 'the policy read is still allowed to land');
  t.mock.timers.tick(1);
  await flush();
  assert.equal(settled, true, 'past 2s the request goes out on the defaults');
  assert.equal(route.apiPolicy(), 'auto');
});

test('auto leaves the backup line only once a probe proves direct works, and says each switch once', async (t) => {
  values.set(LS_KEYS.useHongKongRelay, 'false');
  values.set(LS_KEYS.useApiAccel, 'true');
  route.syncLinePrefs();
  const notices = [];
  route.setLineNotifier((message, tone) => notices.push(`${tone}:${message}`));
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'] });

  assert.equal(route.resolveApiLine(), 'direct');
  assert.equal(route.stepApiFailover(502), true);
  assert.equal(route.resolveApiLine(), 'api_accel');

  let directWorks = false;
  const probes = [];
  globalThis.fetch = async (url) => {
    probes.push(String(url));
    return new Response('{}', { status: directWorks ? 200 : 503 });
  };
  t.mock.timers.tick(10_000);
  await flush();
  assert.equal(probes.length, 1, 'the first check is ten seconds in');
  assert.match(probes[0], /\/search\/tags\?/);
  assert.equal(route.resolveApiLine(), 'api_accel', 'a failed check keeps the backup line — no blind return');
  t.mock.timers.tick(19_999);
  await flush();
  assert.equal(probes.length, 1, 'each failed check doubles the wait');
  t.mock.timers.tick(1);
  await flush();
  assert.equal(probes.length, 2);
  directWorks = true;
  t.mock.timers.tick(40_000);
  await flush();
  assert.equal(probes.length, 3);
  assert.equal(route.resolveApiLine(), 'direct', 'a proven direct line is taken back');

  assert.equal(route.stepApiFailover(502), true, 'direct failing again switches again…');
  assert.equal(route.resolveApiLine(), 'api_accel');
  assert.equal(route.stepApiFailover(503), true, '…and a busy backup line sends auto home');
  assert.equal(route.resolveApiLine(), 'direct');
  assert.equal(route.stepApiFailover(502), false, 'a busy backup line stays out for ten minutes');
  t.mock.timers.tick(600_000);
  assert.equal(route.stepApiFailover(502), true);
  assert.deepEqual(notices, [
    'warning:直连异常，已切换至备用 API',
    'success:直连已恢复',
    'warning:备用 API 压力过大，已切回直连',
  ], 'every notice at most once per session');
  route.setLineNotifier(() => {});
});

test('the SSR feed seeds nothing it must not share and backs off the upstream after a 429', async (t) => {
  clearBlockFiltersMemo();
  clearPublicBlacklistMemo();
  let now = 5_000_000;
  t.mock.method(Date, 'now', () => now);
  const reads = [];
  let answer = () => new Response('', { status: 429, headers: { 'retry-after': '30' } });
  globalThis.fetch = async (url) => {
    const parsed = new URL(String(url));
    const action = parsed.searchParams.get('action');
    if (action === 'get_block_tags') return json(blockFiltersEnvelope());
    if (action === 'get_public_blacklist') return json({ success: true, blacklist: [] });
    reads.push(parsed);
    return answer();
  };

  assert.equal(await readHomeFeed(UNMIRRORABLE_FINGERPRINT, 'created_at'), null,
    'a fingerprint the device could not mirror must not get the default feed');
  assert.equal(await readHomeFeed('safe|-|d|-|', 'random'), null, 'a shared memo cannot hold a random page');
  assert.equal(reads.length, 0, 'neither asks the upstream');

  assert.equal(await readHomeFeed('safe|-|d|-|', 'created_at'), null);
  assert.equal(reads.length, 1);
  now += 29_000;
  assert.equal(await readHomeFeed('safe|-|-|-|another', 'score'), null);
  assert.equal(reads.length, 1, 'Retry-After holds every fingerprint off the upstream — one server IP');
  now += 1_001;
  answer = () => json({ total: 1, images: [{ id: 7, representations: {}, view_url: '' }] });
  const seed = await readHomeFeed('safe|-|d|-|', 'created_at');
  assert.deepEqual(seed?.data.images.map((image) => image.id), [7]);
  assert.equal(reads.length, 2);
});

test('the SSR seed goes on the image line of the document exactly as the browser puts its own rows', () => {
  const thumb = 'https://derpicdn.net/img/2024/1/1/7/thumb.png';
  const row = {
    id: 7,
    view_url: 'https://derpicdn.net/img/view/2024/1/1/7.png',
    representations: { thumb, large: thumb.replace('thumb', 'large') },
  };
  const seed = { key: 'k', fp: 'f', sort: 'created_at', generatedAt: 1, data: { total: 1, images: [row] } };
  assert.equal(seedOnImageLine(null, 'direct'), null);
  assert.deepEqual(seedOnImageLine(seed, 'direct').data.images[0], row, 'direct is the raw row');
  const byDefault = seedOnImageLine(seed, null).data.images[0];
  assert.deepEqual(byDefault, applyImageLine(row), 'no line named means the line the browser resolves by default');
  assert.ok(byDefault.representations.thumb.startsWith(IMAGE_WORKER_BASE));
  assert.ok(seedOnImageLine(seed, 'cdn').data.images[0].view_url.startsWith(IMAGE_CDN_BASE));
  assert.equal(seed.data.images[0], row, 'the shared memo entry is never rewritten');
  assert.equal(row.representations.thumb, thumb);
});

test('a failed policy read still inlines the public rules and leaves the rest to the browser', async () => {
  clearBlockFiltersMemo();
  clearPublicBlacklistMemo();
  globalThis.fetch = async (url) => {
    const action = new URL(String(url)).searchParams.get('action');
    if (action === 'get_block_tags') return json(blockFiltersEnvelope());
    if (action === 'get_public_blacklist') return json({ success: true, blacklist: [5, 3, 5] });
    return new Response('<html>down</html>', { status: 502 });
  };
  const inline = await readRoutePolicy();
  assert.equal(inline.api, '', 'an empty API policy asks the browser to load it');
  assert.deepEqual(inline.blacklist, [3, 5]);
  assert.ok(inline.blockFilters.safe.length > 0);
});

test('a fingerprint too long for a cookie is mirrored as the unmirrorable marker', () => {
  values.set(LS_KEYS.activeHiddenTags, JSON.stringify(Array.from({ length: 120 }, (_, i) => `很长的屏蔽标签${i}`)));
  catalogue.syncBrowsingCookie();
  assert.equal(cookies.get(COOKIE_KEYS.browsing), UNMIRRORABLE_FINGERPRINT);
  values.set(LS_KEYS.activeHiddenTags, JSON.stringify(['short']));
  catalogue.syncBrowsingCookie();
  const mirrored = decodeURIComponent(cookies.get(COOKIE_KEYS.browsing) ?? '');
  assert.notEqual(mirrored, UNMIRRORABLE_FINGERPRINT);
  assert.match(mirrored, /short/);
});

test('a sign-in the browser refuses to store says so, and a refused sign-out still signs out', () => {
  const refuse = () => { throw new DOMException('denied', 'SecurityError'); };
  globalThis.localStorage = { getItem: () => null, setItem: refuse, removeItem: refuse };
  assert.throws(() => hooks.writeUserInfo({ token: 't', username: 'pony' }),
    (error) => error.message === hooks.SESSION_STORAGE_BLOCKED && error.cause?.name === 'SecurityError');
  assert.deepEqual(events, [], 'nothing announces a session that was never stored');

  globalThis.localStorage = {
    getItem: (key) => (key === LS_KEYS.userInfo ? JSON.stringify({ token: 't', username: 'pony' }) : null),
    setItem: refuse,
    removeItem: refuse,
  };
  assert.equal(hooks.clearUserInfo('other'), false, 'another token cannot sign this session out');
  assert.equal(hooks.clearUserInfo('t'), true);
  assert.deepEqual(events, ['user_info_updated'], 'the app is told even though storage refused');
});

test('Escape belongs to a field while the user types in it or composes with an IME', () => {
  const key = (props = {}) => ({ key: 'Escape', defaultPrevented: false, isComposing: false, keyCode: 27, target: null, ...props });
  assert.equal(hooks.escapeMeansBack(key()), true);
  assert.equal(hooks.escapeMeansBack(key({ key: 'Enter' })), false);
  assert.equal(hooks.escapeMeansBack(key({ defaultPrevented: true })), false, 'a nearer handler had it');
  assert.equal(hooks.escapeMeansBack(key({ isComposing: true })), false, 'cancelling an IME candidate list');
  assert.equal(hooks.escapeMeansBack(key({ keyCode: 229 })), false, 'older engines report composition as 229');
  assert.equal(hooks.escapeMeansBack(key({ target: new FakeTextArea() })), false, 'a half-written message');
  assert.equal(hooks.escapeMeansBack(key({ target: new FakeInput({ type: 'search' }) })), false);
  assert.equal(hooks.escapeMeansBack(key({ target: new FakeElement({ isContentEditable: true }) })), false,
    'the forum editor');
  assert.equal(hooks.escapeMeansBack(key({ target: new FakeInput({ type: 'checkbox' }) })), true,
    'a checkbox takes no text');
  assert.equal(hooks.escapeMeansBack(key({ target: new FakeSelect() })), false);
  document.activeElement = new FakeInput({ type: 'text' });
  assert.equal(hooks.escapeMeansBack(key()), false, 'focus in a field counts even when the event is retargeted');
  document.activeElement = null;
});
