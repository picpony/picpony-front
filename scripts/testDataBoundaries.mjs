/** Data/proxy regressions with isolated upstream responses; never contacts a live service. */
import assert from 'node:assert/strict';
import { test, beforeEach, after } from 'node:test';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import { registerHooks } from 'node:module';
import { blockFiltersEnvelope } from './netAuditFixtures.mjs';
import { requireTypeStripping } from './tsResolve.mjs';

requireTypeStripping('testDataBoundaries');
registerHooks({ resolve(specifier, context, next) {
  if (specifier === 'next/cache') return {
    url: 'data:text/javascript,export function revalidateTag(){throw new Error("Next cache mutation requires an explicit test stub")}',
    shortCircuit: true,
  };
  return next(specifier, context);
} });

const originalFetch = globalThis.fetch;
const frames = [];
let frameId = 0;
const values = new Map();
const cookies = new Map();
const events = [];
const storage = {
  getItem: (key) => values.get(key) ?? null,
  setItem: (key, value) => values.set(key, String(value)),
  removeItem: (key) => values.delete(key),
};
globalThis.window = {
  requestAnimationFrame: (callback) => { frames.push(callback); return ++frameId; },
  addEventListener() {}, removeEventListener() {}, setTimeout, clearTimeout,
  dispatchEvent(event) { events.push(event.type); return true; },
  __picponyRoutePolicy: { api: 'direct', image: 'direct' },
};
globalThis.document = {
  visibilityState: 'visible', addEventListener() {}, removeEventListener() {},
  get cookie() { return [...cookies].map(([key, value]) => `${key}=${value}`).join('; '); },
  set cookie(value) {
    const pair = value.split(';', 1)[0];
    const split = pair.indexOf('=');
    cookies.set(pair.slice(0, split), pair.slice(split + 1));
  },
};
globalThis.localStorage = storage;

const query = await import('../lib/searchQuery.ts');
const client = await import('../lib/api/client.ts');
const route = await import('../lib/route.ts');
const picpony = await import('../lib/api/picpony.ts');
const derpi = await import('../lib/api/derpi.ts');
const admin = await import('../lib/api/admin.ts');
const catalogue = await import('../lib/resources.ts');
const { defineResource, clearAllResources, expireAllResources } = await import('../lib/resource.ts');
const { COOKIE_KEYS, LS_KEYS, IMAGE_WORKER_BASE } = await import('../lib/constants.ts');
const relay = await import('../app/relay/route.ts');
const php = await import('../app/api.php/[[...path]]/route.ts');
const { createServerMemo } = await import('../lib/serverMemo.ts');
const { readHomeFeed } = await import('../lib/feed.server.ts');
const { readUserProfile } = await import('../lib/profile.server.ts');
const { readTeamMembers } = await import('../lib/team.server.ts');
const { inlineRoutePolicyScript } = await import('../lib/route.server.ts');
const { readBlockFilters, clearBlockFiltersMemo, BLOCK_FILTERS_CACHE_TAG } = await import('../lib/blockFilters.server.ts');
const blockFilters = await import('../lib/blockFilters.ts');
await route.ensureRoutePolicy();

const tick = async () => {
  await new Promise((resolve) => setImmediate(resolve));
  while (frames.length) frames.shift()();
};
const deferred = () => {
  let resolve;
  const promise = new Promise((settle) => { resolve = settle; });
  return { promise, resolve };
};
const json = (data, init) => Response.json(data, init);
function request(url, init) {
  const value = new Request(url, init);
  Object.defineProperty(value, 'nextUrl', { value: new URL(url) });
  return value;
}
const context = (path) => ({ params: Promise.resolve({ path }) });

beforeEach(() => {
  clearAllResources();
  values.clear();
  cookies.clear();
  events.length = 0;
  blockFilters.installBlockFilters(blockFilters.DEFAULT_BLOCK_FILTERS);
  globalThis.localStorage = storage;
  globalThis.fetch = async (url) => { throw new Error(`Unexpected network request: ${url}`); };
  route.syncLinePrefs();
});
after(() => { globalThis.fetch = originalFetch; });

test('invalid filters retain safe exclusions even when another filter is present', () => {
  for (const contentFilter of ['', 'unknown', undefined, null]) {
    const settings = { contentFilter, banAnthro: true, onlyPony: true, hiddenTags: ['spoiler'] };
    const built = decodeURIComponent(query.buildSearchQueryFrom(settings));
    for (const tag of ['-suggestive', '-explicit', '-questionable', '-grotesque', '-grimdark']) {
      assert.ok(built.includes(tag), `${String(contentFilter)} lost ${tag}`);
    }
  }
  assert.equal(query.parseBrowsingFingerprint('invalid|a|d|p|spoiler').contentFilter, 'safe');
  assert.equal(query.parseContentFilter('developer'), 'developer');
});

test('browsing and line settings tolerate blocked storage and reject damaged sort values', async () => {
  values.set(LS_KEYS.contentFilter, 'broken');
  values.set(LS_KEYS.homeSort, 'score&q=explicit');
  values.set(LS_KEYS.searchSort, 'width');
  assert.equal(client.getBrowsingSettings().contentFilter, 'safe');
  assert.equal(client.getBrowsingSettings().homeSort, 'created_at');
  assert.equal(client.getBrowsingSettings().searchSort, 'width');
  globalThis.localStorage = { getItem() { throw new DOMException('blocked', 'SecurityError'); } };
  assert.equal(client.getBrowsingSettings().contentFilter, 'safe');
  assert.doesNotThrow(() => route.syncLinePrefs());
  await assert.doesNotReject(route.ensureRoutePolicy());
});

test('a shorter browsing fingerprint replaces the cookie whose value has that prefix', () => {
  const expected = catalogue.browsingFingerprint().split('|').slice(0, 5).join('|');
  cookies.set(COOKIE_KEYS.browsing, `${encodeURIComponent(expected)}old-hidden-tag`);
  catalogue.syncBrowsingCookie();
  assert.equal(cookies.get(COOKIE_KEYS.browsing), encodeURIComponent(expected));
});

test('forced direct image routing unwraps an already proxied response', () => {
  const raw = 'https://derpicdn.net/img/2026/1/1/123/small.png';
  const wrapped = IMAGE_WORKER_BASE + encodeURIComponent(raw);
  const mapped = client.applyImageLine({ representations: { small: wrapped }, view_url: wrapped });
  assert.equal(mapped.representations.small, raw);
  assert.equal(mapped.view_url, raw);
});

test('non-envelope JSON is reported as API failure instead of crashing callers', async () => {
  for (const body of ['', '<html>error</html>', 'null', '[]', 'true', '12', '"text"']) {
    assert.equal((await client.readJson(new Response(body))).success, false, body);
  }
  assert.deepEqual(await client.readJson(json({ success: true, value: 1 })), { success: true, value: 1 });
});

test('comment sources survive each other\'s decode failure and both failures remain an error', async () => {
  for (const failed of ['picpony', 'derpi', 'both']) {
    globalThis.fetch = async (url) => {
      const local = String(url).includes('get_comments');
      if (failed === 'both' || (local ? failed === 'picpony' : failed === 'derpi')) {
        return new Response('<html>bad gateway</html>', { status: 200 });
      }
      return json({ success: true, comments: [{ id: local ? 1 : 2, body: 'kept', created_at: '2026-01-01',
        user_id: 1, username: 'local', author: 'external', avatar: null }] });
    };
    const result = await picpony.getComments('123');
    assert.equal(result.success, failed !== 'both');
    assert.equal(result.comments.length, failed === 'both' ? 0 : 1);
  }
  globalThis.fetch = async () => json({ success: true, comments: [] });
  assert.deepEqual(await picpony.getComments('123'), { success: true, comments: [] });
});

test('user ids, featured keys and explicit search sorts cannot append URL parameters', async () => {
  const urls = [];
  globalThis.fetch = async (url) => { urls.push(new URL(String(url), 'https://app.invalid')); return json({ images: [], total: 0 }); };
  const id = '1&action=unintended';
  await picpony.getUserProfile(id);
  assert.equal(urls.at(-1).searchParams.get('action'), 'get_user_profile');
  assert.equal(urls.at(-1).searchParams.get('user_id'), id);
  const key = 'secret&filter_id=0#fragment';
  await derpi.getFeatured(key);
  assert.equal(urls.at(-1).searchParams.get('key'), key);
  assert.equal(urls.at(-1).searchParams.has('filter_id'), false);
  await client.fetchDerpiImages('https://derpibooru.org/api/v1/json', { query: 'pony', sortField: 'score&q=explicit' });
  assert.equal(urls.at(-1).searchParams.get('sf'), 'created_at');
  assert.equal(urls.at(-1).searchParams.getAll('q').length, 1);
  await client.fetchDerpiImages('https://derpibooru.org/api/v1/json', { query: 'pony', sortField: 'hotness' });
  assert.equal(urls.at(-1).searchParams.get('sf'), 'hotness');
});

test('request cancellation interrupts a retry delay without another fetch', async () => {
  const controller = new AbortController();
  let calls = 0;
  let released = false;
  globalThis.fetch = async () => {
    calls += 1;
    setImmediate(() => controller.abort());
    return new Response(new ReadableStream({ cancel() { released = true; } }), { status: 503 });
  };
  await assert.rejects(client.proxyFetch('https://derpibooru.org/api/v1/json/images/1', { signal: controller.signal }),
    { name: 'AbortError' });
  assert.equal(calls, 1);
  assert.equal(released, true);
});

test('featured resources partition two account API keys and forum errors never become empty lists', async () => {
  assert.notEqual(catalogue.featuredImage.keyOf({ apiKey: 'key-a' }), catalogue.featuredImage.keyOf({ apiKey: 'key-b' }));
  globalThis.fetch = async () => json({ success: false, message: 'upstream failure' });
  await assert.rejects(catalogue.forumPosts.read({ page: 1 }), /论坛/);
  await assert.rejects(derpi.getImages(), /响应无效/);
  await assert.rejects(admin.checkTagExists('fake-token', 'pony'), /upstream failure/);
});

test('every catalogue read forwards its AbortSignal through its real API adapter', async () => {
  const cases = [
    [catalogue.homeFeed, { page: 2, sort: 'score', fp: 'safe|-|d|-|' }],
    [catalogue.searchFeed, { query: 'pony', page: 1, sortDir: 'desc' }],
    [catalogue.featuredImage, { apiKey: 'fake-key' }],
    [catalogue.imagesByIds, { ids: [1], page: 1, perPage: 1 }],
    [catalogue.forumPosts, { page: 1 }], [catalogue.forumThread, { id: '1', page: 1 }],
    [catalogue.userProfile, { id: '1' }], [catalogue.sharedFaveIds, { username: 'pony' }],
    [catalogue.userPosts, { id: '1', page: 1 }], [catalogue.userComments, { id: '1', page: 1 }],
    [catalogue.userUploads, { id: '1', page: 1, perPage: 1, token: 'fake' }],
    [catalogue.sessionUser, { token: 'fake' }], [catalogue.unreadCounts, { token: 'fake' }],
    [catalogue.faveIds, { token: 'fake' }], [catalogue.browsingHistory, { token: 'fake', page: 1 }],
    [catalogue.tasks, { token: 'fake' }], [catalogue.blockGroups, { token: 'fake' }],
    [catalogue.teamMembers, {}],
  ];
  for (const [resource, args] of cases) {
    let signal;
    globalThis.fetch = async (_, init) => {
      signal = init?.signal;
      return new Promise((_, reject) => signal?.addEventListener('abort', () => reject(signal.reason), { once: true }));
    };
    const pending = resource.read(args, { priority: 'background' });
    await tick();
    assert.ok(signal instanceof AbortSignal, `${resource.name} did not pass its signal`);
    assert.equal(resource.cancelBackground(args), true, resource.name);
    assert.equal(signal.aborted, true, resource.name);
    await assert.rejects(pending, { name: 'AbortError' });
    await tick();
  }
});

test('reconnection retries a mounted cold failure and keeps its subscription', async () => {
  let online = false;
  let calls = 0;
  const resource = defineResource({ name: 'offline-regression', key: () => 'same', fetch: async () => {
    calls += 1;
    if (!online) throw new Error('offline');
    return 'online result';
  } });
  let notices = 0;
  const unsubscribe = resource.subscribe({}, () => { notices += 1; });
  await assert.rejects(resource.read({}), /offline/);
  await tick();
  online = true;
  expireAllResources();
  await tick();
  assert.equal(calls, 2);
  assert.equal(resource.peek({}).data, 'online result');
  assert.ok(notices >= 2);
  unsubscribe();
});

test('a repeated SSR seed cannot cancel a refresh or remove its displayed answer', async () => {
  const incoming = deferred();
  let signal;
  const resource = defineResource({ name: 'seed-refresh-regression', key: () => 'same', fetch: (_, current) => {
    signal = current;
    return incoming.promise;
  } });
  const at = Date.now() - 100;
  resource.seed({}, ['SSR'], at);
  const pending = resource.read({}, { force: true });
  resource.seed({}, ['SSR'], at);
  assert.equal(signal.aborted, false);
  assert.deepEqual(resource.peek({}).data, ['SSR']);
  incoming.resolve(['fresh']);
  assert.deepEqual(await pending, ['fresh']);
  await tick();
  assert.deepEqual(resource.peek({}).data, ['fresh']);
});

test('an old first SSR seed cannot replace a newer unseeded client refresh', async () => {
  const incoming = deferred();
  let signal;
  const resource = defineResource({ name: 'unseeded-refresh', key: () => 'same', fetch: (_, current) => {
    signal = current;
    return incoming.promise;
  } });
  resource.write({}, ['client']);
  await tick();
  const pending = resource.read({}, { force: true });
  resource.seed({}, ['stale SSR'], Date.now() - 60_000);
  assert.equal(signal.aborted, false);
  assert.deepEqual(resource.peek({}).data, ['client']);
  incoming.resolve(['refreshed']);
  assert.deepEqual(await pending, ['refreshed']);
});

test('failed resource entries respect their LRU limit', async () => {
  const resource = defineResource({ name: 'failed-lru', maxEntries: 2, key: ({ id }) => id,
    fetch: async () => { throw new Error('unavailable'); } });
  for (const id of ['a', 'b', 'c']) {
    await assert.rejects(resource.read({ id }));
    await tick();
  }
  assert.equal(resource.peek({ id: 'a' }).error, undefined);
  assert.equal(resource.peek({ id: 'c' }).error.message, 'unavailable');
});

test('relay rejects off-namespace targets and executable upstream documents', async () => {
  let calls = 0;
  globalThis.fetch = async () => { calls += 1; return new Response('<script>bad()</script>', {
    headers: { 'Content-Type': 'text/html' },
  }); };
  for (const target of ['http://derpibooru.org/api/v1/json/images', 'https://evil.invalid/api/',
    'https://user:pass@derpibooru.org/api/', 'https://derpibooru.org:444/api/', 'https://derpibooru.org/']) {
    const response = await relay.GET(request(`https://app.invalid/relay?url=${encodeURIComponent(target)}`));
    assert.equal(response.status, 400, target);
  }
  assert.equal(calls, 0);
  const response = await relay.GET(request('https://app.invalid/relay?url=https%3A%2F%2Fderpibooru.org%2Fapi%2Fv1%2Fjson%2Fimages'));
  assert.equal(response.status, 502);
  assert.match(response.headers.get('content-type'), /application\/json/);
  assert.equal((await response.text()).includes('<script>'), false);
});

test('relay strips session/framing headers, prohibits caches and follows request cancellation', async () => {
  let init;
  globalThis.fetch = async (_, options) => {
    init = options;
    return json({ images: [] }, { headers: { 'Set-Cookie': 'secret=1', 'Cache-Control': 'public, max-age=600',
      'CDN-Cache-Control': 'public', 'Content-Encoding': 'gzip', 'Connection': 'x-private-hop', 'x-private-hop': 'remove' } });
  };
  const controller = new AbortController();
  const response = await relay.GET(request('https://app.invalid/relay?url=https%3A%2F%2Fderpibooru.org%2Fapi%2Fv1%2Fjson%2Fimages', {
    signal: controller.signal, headers: { Accept: 'text/html' },
  }));
  assert.equal(init.headers.Accept, 'application/json');
  for (const header of ['set-cookie', 'content-encoding', 'cdn-cache-control', 'x-private-hop']) {
    assert.equal(response.headers.has(header), false, header);
  }
  assert.equal(response.headers.get('Cache-Control'), 'private, no-store');
  assert.equal(response.headers.get('X-Content-Type-Options'), 'nosniff');
  assert.match(response.headers.get('Content-Security-Policy'), /sandbox/);
  controller.abort();
  assert.equal(init.signal.aborted, true);
});

test('PHP proxy streams request bodies, preserves captcha cookie policy and rejects path escapes', async () => {
  let fetched;
  let calls = 0;
  globalThis.fetch = async (url, init) => {
    calls += 1;
    fetched = { url: String(url), init };
    return json({ success: true }, { headers: { 'Set-Cookie': 'PHPSESSID=fake; Secure; HttpOnly; SameSite=None',
      'Cache-Control': 'public, max-age=600' } });
  };
  for (const path of [['..'], ['../admin'], ['%2e%2e'], ['test\\admin']]) {
    const result = await php.GET(request('https://app.invalid/api.php/anything'), context(path));
    assert.equal(result.status, 400);
  }
  assert.equal(calls, 0);
  const controller = new AbortController();
  const incoming = request('http://app.invalid/api.php?action=captcha_verify', { method: 'POST', body: 'payload',
    signal: controller.signal, headers: { Connection: 'x-request-hop', 'x-request-hop': 'remove' } });
  incoming.arrayBuffer = () => { throw new Error('request must not be buffered'); };
  const response = await php.POST(incoming, context());
  assert.equal(fetched.init.body, incoming.body);
  assert.equal(fetched.init.duplex, 'half');
  assert.equal(await new Request(fetched.url, fetched.init).text(), 'payload');
  assert.equal(fetched.init.headers.has('x-request-hop'), false);
  assert.equal(fetched.url, 'https://picpony.top/api.php?action=captcha_verify');
  assert.equal(response.headers.get('Cache-Control'), 'private, no-store');
  assert.equal(response.headers.get('Set-Cookie'), 'PHPSESSID=fake; HttpOnly; SameSite=Lax');
  controller.abort();
  assert.equal(fetched.init.signal.aborted, true);
  const secure = await php.GET(request('https://app.invalid/api.php'), context());
  assert.match(secure.headers.get('Set-Cookie'), /Secure/);
});

test('blocked CacheStorage cannot break a successful static chunk request', async () => {
  const handlers = new Map();
  let fetches = 0;
  const runtime = {
    URL, Response,
    self: { location: new URL('https://app.invalid/sw.js?v=test'), addEventListener: (name, handler) => handlers.set(name, handler) },
    caches: { match: async () => { throw new DOMException('blocked', 'SecurityError'); },
      open: async () => { throw new DOMException('blocked', 'SecurityError'); } },
    fetch: async () => { fetches += 1; return new Response('chunk'); },
  };
  vm.runInNewContext(readFileSync(new URL('../public/sw.js', import.meta.url), 'utf8'), runtime);
  let answer;
  const background = [];
  handlers.get('fetch')({ request: new Request('https://app.invalid/_next/static/chunks/test.js'),
    respondWith: (promise) => { answer = promise; }, waitUntil: (promise) => background.push(promise) });
  assert.equal(await (await answer).text(), 'chunk');
  await Promise.all(background);
  assert.equal(fetches, 1);
});

test('server memo coalesces in-flight calls at TTL zero and retries failed results', async () => {
  let calls = 0;
  let answer = deferred();
  const memo = createServerMemo({ ttlMs: 0, max: 2, keyOf: (id) => id,
    load: () => { calls += 1; return answer.promise; } });
  const a = memo('same');
  assert.equal(memo('same'), a);
  assert.equal(calls, 1);
  answer.resolve(null);
  assert.equal(await a, null);
  answer = deferred();
  const b = memo('same');
  assert.equal(calls, 2);
  answer.resolve({ user: 'only this key' });
  await b;
  answer = deferred();
  const c = memo('same');
  assert.equal(calls, 3, 'TTL zero disables resolved caching');
  answer.resolve(null);
  await c;
});

test('SSR reads have bounded anonymous requests and keys partition public profile results', async () => {
  const observed = [];
  globalThis.fetch = async (url, init) => {
    const parsed = new URL(String(url));
    observed.push({ parsed, init });
    if (parsed.searchParams.get('action') === 'get_team_members') return json({ success: true, members: [] });
    if (parsed.searchParams.get('action') === 'get_user_profile') {
      return json({ success: true, user: { id: parsed.searchParams.get('user_id'), username: 'public' } });
    }
    return json({ total: 0, images: [] });
  };
  const [a, b, team, feed] = await Promise.all([
    readUserProfile('12&action=other'), readUserProfile('13'), readTeamMembers(),
    readHomeFeed('invalid|a|d|p|blocked', 'score&q=explicit'),
  ]);
  assert.notEqual(a.key, b.key);
  assert.equal(a.data.id, '12&action=other');
  assert.equal(b.data.id, '13');
  assert.deepEqual(team.data, []);
  assert.deepEqual(feed.data.images, []);
  for (const { init } of observed) {
    assert.ok(init.signal instanceof AbortSignal);
    const headers = new Headers(init.headers);
    assert.equal(headers.has('authorization'), false);
    assert.equal(headers.has('cookie'), false);
  }
  const upstreamFeed = observed.find(({ parsed }) => parsed.pathname.endsWith('/search/images')).parsed;
  assert.equal(upstreamFeed.searchParams.get('sf'), 'created_at');
  assert.match(upstreamFeed.searchParams.get('q'), /-explicit/);
  assert.equal(upstreamFeed.searchParams.getAll('q').length, 1);
});

test('resource SSR seeding is isolated and inline route policy escapes script terminators', () => {
  const resource = defineResource({ name: 'SSR-isolated', key: () => 'one', fetch: async () => 'client' });
  const browser = globalThis.window;
  delete globalThis.window;
  try {
    resource.seed({}, 'private SSR value', Date.now());
    assert.equal(resource.peek({}).data, undefined);
  } finally {
    globalThis.window = browser;
  }
  const policy = { api: 'third_party', image: 'direct', thirdPartyPassApiKey: false,
    thirdPartyUrl: '</script><script>window.stolen=true</script>' };
  const script = inlineRoutePolicyScript(policy);
  assert.equal(script.includes('</script>'), false);
  const result = { window: {} };
  vm.runInNewContext(script, result);
  assert.equal(result.window.stolen, undefined);
  assert.equal(result.window.__picponyRoutePolicy.thirdPartyUrl, policy.thirdPartyUrl);
});

test('third-party key forwarding honors policy and an older policy refresh cannot win', async () => {
  for (const pass of [false, true]) {
    globalThis.fetch = async () => json({ success: true, global_api_route_policy: 'third_party',
      global_api_third_party_url: 'https://third-party.invalid', global_api_third_party_pass_api_key: pass });
    await route.refreshRoutePolicy();
    const target = new URL(route.buildApiLineUrl('https://derpibooru.org/api/v1/json/images?key=fake&key=duplicate', 'third_party'));
    assert.equal(target.origin, 'https://third-party.invalid');
    assert.equal(target.searchParams.has('key'), pass);
  }
  const first = deferred();
  const second = deferred();
  let calls = 0;
  globalThis.fetch = (url) => String(url).includes('get_block_tags') ? Promise.resolve(json(blockFiltersEnvelope())) :
    ++calls === 1 ? first.promise : second.promise;
  const old = route.refreshRoutePolicy();
  const latest = route.refreshRoutePolicy();
  second.resolve(json({ success: true, global_api_route_policy: 'direct', global_image_route_policy: 'direct' }));
  await latest;
  first.resolve(json({ success: true, global_api_route_policy: 'api_accel' }));
  await old;
  assert.equal(route.apiPolicy(), 'direct');
});

test('a cancelled caller stops waiting for the shared policy without cancelling that policy', async () => {
  const incoming = deferred();
  let fetches = 0;
  globalThis.fetch = (url) => {
    fetches += 1;
    return String(url).includes('get_block_tags') ? Promise.resolve(json(blockFiltersEnvelope())) : incoming.promise;
  };
  const policy = route.refreshRoutePolicy();
  const controller = new AbortController();
  const read = client.proxyFetch('https://derpibooru.org/api/v1/json/images/1', { signal: controller.signal });
  controller.abort();
  await assert.rejects(read, { name: 'AbortError' });
  assert.equal(fetches, 2, 'only the shared policy and public-filter requests were sent');
  incoming.resolve(json({ success: true, global_api_route_policy: 'direct', global_image_route_policy: 'direct' }));
  await policy;
});

test('public block definitions use the real flat/grouped envelope and affect every enabled filter', () => {
  const fixture = blockFiltersEnvelope();
  const flat = blockFilters.parseBlockFilters(fixture);
  const grouped = blockFilters.parseBlockFilters({ success: true, grouped: fixture.grouped });
  assert.deepEqual(flat, grouped);
  assert.deepEqual(flat, blockFilters.DEFAULT_BLOCK_FILTERS);
  const settings = { contentFilter: 'safe', banAnthro: true, banDiscomfort: true, onlyPony: true, hiddenTags: [] };
  const built = decodeURIComponent(query.buildSearchQueryFrom(settings, 'pony OR zebra', flat));
  assert.ok(built.startsWith('(pony OR zebra), '));
  assert.match(built, /-nightmare\\ fuel/);
  assert.match(built, /-morbidly\\ obese/);
  assert.match(built, /\(pony OR kirin OR griffon OR hippogriff OR changeling OR zebra\)/);
  const disabled = decodeURIComponent(query.buildSearchQueryFrom({ ...settings, contentFilter: 'developer',
    banAnthro: false, banDiscomfort: false, onlyPony: false }, undefined, flat));
  assert.equal(disabled, '*');
  assert.equal(blockFilters.parseBlockFilters({ success: false, tags: [] }), null);
});

test('rule installation changes resource keys and publishes settings once per semantic change', () => {
  const original = catalogue.browsingFingerprint();
  assert.equal(original, query.DEFAULT_BROWSING_FINGERPRINT);
  const changed = { ...blockFilters.DEFAULT_BLOCK_FILTERS, safe: [...blockFilters.DEFAULT_BLOCK_FILTERS.safe, 'new blocked tag'] };
  events.length = 0;
  blockFilters.installBlockFilters(changed);
  assert.notEqual(catalogue.browsingFingerprint(), original);
  assert.deepEqual(events, ['settings_updated']);
  blockFilters.installBlockFilters({ ...changed, safe: [...changed.safe].reverse() });
  assert.deepEqual(events, ['settings_updated']);
  const browser = globalThis.window;
  delete globalThis.window;
  try {
    blockFilters.installBlockFilters(changed);
    assert.equal(blockFilters.currentBlockFilters(), blockFilters.DEFAULT_BLOCK_FILTERS);
  } finally { globalThis.window = browser; }
});

test('SSR waits for public rules before querying pictures and produces the same key as the browser', async () => {
  clearBlockFiltersMemo();
  const rules = deferred();
  const fixture = blockFiltersEnvelope();
  fixture.tags.push({ id: 999, filter_key: 'safe', tag_name: 'freshly blocked' });
  let ruleCalls = 0;
  let imageCalls = 0;
  globalThis.fetch = async (url, init) => {
    if (String(url).includes('get_block_tags')) {
      ruleCalls += 1;
      assert.deepEqual(init.next.tags, [BLOCK_FILTERS_CACHE_TAG]);
      return rules.promise;
    }
    imageCalls += 1;
    const target = new URL(String(url));
    assert.match(decodeURIComponent(target.searchParams.get('q') ?? ''), /-freshly\\ blocked/);
    return json({ total: 0, images: [] });
  };
  const feed = readHomeFeed('safe|-|d|-|', 'created_at');
  const sameRules = readBlockFilters();
  await tick();
  assert.equal(ruleCalls, 1, 'layout and feed share their public definition request');
  assert.equal(imageCalls, 0);
  rules.resolve(json(fixture));
  const [seed, current] = await Promise.all([feed, sameRules]);
  assert.ok(seed, `feed seed missing; ruleCalls=${ruleCalls}, imageCalls=${imageCalls}`);
  blockFilters.installBlockFilters(current);
  const fp = catalogue.browsingFingerprint();
  assert.equal(seed.fp, fp);
  assert.equal(seed.key, catalogue.homeFeed.keyOf({ page: 1, sort: 'created_at', fp }));
  assert.equal(imageCalls, 1);
});

test('failed public rules preserve the known safe fallback and a failed maintenance read cannot discard valid rules', async () => {
  clearBlockFiltersMemo();
  globalThis.fetch = async () => new Response('<html>offline</html>', { status: 503 });
  assert.equal(await readBlockFilters(), blockFilters.DEFAULT_BLOCK_FILTERS);
  const fixture = blockFiltersEnvelope();
  fixture.tags.push({ id: 999, filter_key: 'safe', tag_name: 'still loaded' });
  globalThis.fetch = async (url) => String(url).includes('get_block_tags') ? json(fixture) : new Response('<html>broken policy</html>');
  await route.refreshRoutePolicy();
  assert.ok(blockFilters.currentBlockFilters().safe.includes('still loaded'));
});

test('only accepted block-tag mutations expire both Next tags and the process memo', async () => {
  let invalidations = 0;
  let memoClears = 0;
  const source = readFileSync(new URL('../app/api.php/[[...path]]/route.ts', import.meta.url), 'utf8');
  const transpiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  let envelope = { success: true };
  let status = 200;
  const exports = {};
  const dependencies = {
    'next/cache': { revalidateTag: (tag, profile) => {
      assert.equal(tag, BLOCK_FILTERS_CACHE_TAG);
      assert.equal(profile.expire, 0);
      invalidations += 1;
    } },
    '@/lib/blockFilters.server': { BLOCK_FILTERS_CACHE_TAG, clearBlockFiltersMemo: () => { memoClears += 1; } },
  };
  vm.runInNewContext(transpiled, { exports, require: (name) => {
    assert.ok(name in dependencies, name);
    return dependencies[name];
  }, Response, Headers, URL, AbortSignal, fetch: async () => json(envelope, { status }) });
  for (const [method, action, success, httpStatus, expected] of [
    ['POST', 'admin_add_block_tag', false, 200, 0],
    ['POST', 'admin_add_block_tag', true, 403, 0],
    ['GET', 'admin_add_block_tag', true, 200, 0],
    ['POST', 'admin_update_user', true, 200, 0],
    ['POST', 'admin_add_block_tag', true, 200, 1],
    ['POST', 'admin_remove_block_tag', true, 200, 2],
  ]) {
    envelope = { success };
    status = httpStatus;
    const response = await exports[method](request(`https://app.invalid/api.php?action=${action}`, { method }), context());
    assert.equal((await response.json()).success, success, 'the original response body remains available');
    assert.equal(invalidations, expected);
    assert.equal(memoClears, expected);
  }
});

test('clearing server filters during an in-flight read cannot restore the old rule generation', async () => {
  clearBlockFiltersMemo();
  const old = deferred();
  const fresh = blockFiltersEnvelope();
  fresh.tags.push({ id: 888, filter_key: 'safe', tag_name: 'after write' });
  let calls = 0;
  globalThis.fetch = async () => ++calls === 1 ? old.promise : json(fresh);
  const pending = readBlockFilters();
  clearBlockFiltersMemo();
  old.resolve(json(blockFiltersEnvelope()));
  assert.ok((await pending).safe.includes('after write'));
  assert.equal(calls, 2);
});

test('OtherTab refreshes real statistics and saves text without changing maintenance mode', async () => {
  let state;
  let statusValue = { maintenanceMode: true, maintenanceMessage: 'old text', translateEnabled: true };
  let statusError;
  let statsError = 'statistics unavailable';
  const maintenanceWrites = [];
  let statsRefreshes = 0;
  let statusRefreshes = 0;
  let patched;
  const toasts = [];
  const element = (type, props) => ({ type, props: props ?? {} });
  const componentStub = (name) => ({ default: name });
  const dependencies = {
    'react': { useState: () => [state ?? null, (value) => { state = value; }] },
    'react/jsx-runtime': { jsx: element, jsxs: element, Fragment: 'Fragment' },
    '@/components/Toast': { showToast: (...args) => toasts.push(args) },
    '@/components/ToggleSwitch': componentStub('ToggleSwitch'),
    '@/components/Button': componentStub('Button'), '@/components/Card': componentStub('Card'),
    '@/components/SectionHeading': componentStub('SectionHeading'),
    '@/components/ErrorRetry': componentStub('ErrorRetry'), '@/components/Skeleton': componentStub('Skeleton'),
    '@/components/Input': { Textarea: 'Textarea' }, '@/lib/icons': { ICON: {} },
    'react-icons/md': {},
    '@/components/ConfirmDialog': { useConfirm: () => ({ confirmThen: (_a, _b, run) => run(), confirmDialog: null }) },
    '@/lib/api/admin': {
      adminToggleMaintenance: async (_token, values) => { maintenanceWrites.push(values); return json({ success: true }); },
    },
    './queries': {
      defineAdminQuery: (name) => ({ name, write: (_token, value) => { patched = value; statusValue = value; } }),
      adminData: (_, value) => value,
      useAdminQuery: (resource) => resource.name === 'site-status' ? {
        data: statusValue, error: statusError, loading: false, refresh: () => {
          assert.ok(patched, 'the accepted write must be patched before refresh');
          statusRefreshes += 1;
        },
      } : { data: undefined, error: statsError, loading: false, refresh: () => { statsRefreshes += 1; } },
    },
    './useAdminMutation': { useAdminMutation: () => ({ busy: false, run: async (request, success) => {
      const response = await request(() => true);
      const data = await response.json();
      if (response.ok && data.success) success(data);
    } }) },
  };
  const exports = {};
  const source = ts.transpileModule(readFileSync(new URL('../components/admin/OtherTab.tsx', import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  vm.runInNewContext(source, { exports, require: (name) => {
    assert.ok(name in dependencies, name);
    return dependencies[name];
  } });
  function find(node, check) {
    if (Array.isArray(node)) return node.flatMap((child) => find(child, check));
    if (!node || typeof node !== 'object') return [];
    return [...(check(node) ? [node] : []), ...find(node.props?.children, check)];
  }
  let tree = exports.default({ token: 'fake' });
  const switches = find(tree, (node) => node.type === 'ToggleSwitch');
  assert.ok(switches.every((node) => node.props.disabled === false), 'statistics failure cannot disable loaded status controls');
  const textarea = find(tree, (node) => node.type === 'Textarea')[0];
  textarea.props.onChange({ target: { value: 'saved independently' } });
  tree = exports.default({ token: 'fake' });
  const save = find(tree, (node) => node.type === 'Button' && node.props.children === '保存提示文字')[0];
  await save.props.onClick();
  assert.equal(maintenanceWrites.length, 1);
  assert.equal(maintenanceWrites[0].maintenance_mode, true);
  assert.equal(maintenanceWrites[0].maintenance_message, 'saved independently');
  assert.equal(patched.maintenanceMessage, 'saved independently');
  assert.equal(statusRefreshes, 1);
  assert.equal(toasts.at(-1)[0], '维护提示已保存');
  statsError = undefined;
  tree = exports.default({ token: 'fake' });
  const refresh = find(tree, (node) => node.type === 'Button' && node.props.children === '刷新统计')[0];
  refresh.props.onClick();
  assert.equal(statsRefreshes, 1);
  statusValue = undefined;
  statusError = 'not loaded';
  tree = exports.default({ token: 'fake' });
  assert.ok(find(tree, (node) => node.type === 'ToggleSwitch').every((node) => node.props.disabled));
  assert.equal(find(tree, (node) => node.type === 'Button' && node.props.children === '保存提示文字').length, 0);
});
