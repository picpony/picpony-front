/**
 * Regression cases for review part 2 (shell, session, request lines, shared helpers), with no
 * live service: each test names the finding it pins (`P2-Fn` in `part2-review.md`).
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { requireTypeStripping } from './tsResolve.mjs';

requireTypeStripping('testReviewPart2');

const values = new Map();
globalThis.localStorage = {
  getItem: (key) => values.get(key) ?? null,
  setItem: (key, value) => values.set(key, String(value)),
  removeItem: (key) => values.delete(key),
};
const events = [];
globalThis.window = {
  requestAnimationFrame: (callback) => setTimeout(callback, 0),
  addEventListener() {}, removeEventListener() {},
  dispatchEvent(event) { events.push(event.type); return true; },
  setTimeout: (...args) => setTimeout(...args),
  clearTimeout: (...args) => clearTimeout(...args),
};
globalThis.document = {
  visibilityState: 'visible', hidden: false, activeElement: null, cookie: '',
  addEventListener() {}, removeEventListener() {},
};
globalThis.fetch = async (url) => { throw new Error(`Unexpected network request: ${url}`); };

const route = await import('../lib/route.ts');
const hooks = await import('../lib/hooks.ts');
const { isInternalHref } = await import('../lib/richTextLinks.ts');
const { bbcodeToSafeHtml } = await import('../lib/bbcode.ts');
const { formatCount } = await import('../lib/format.ts');
const { parseUpstreamOrigin, DEFAULT_UPSTREAM_ORIGIN } = await import('../lib/upstream.server.ts');
const { LS_KEYS } = await import('../lib/constants.ts');

const flush = () => new Promise((resolve) => setImmediate(resolve));

test('P2-F3: only the host is canonicalised, never a query that mentions trixiebooru', () => {
  const searched = 'https://trixiebooru.org/api/v1/json/search/images?q=source_url%3A*trixiebooru.org*&key=k';
  assert.equal(
    route.canonicalDerpiUrl(searched),
    'https://derpibooru.org/api/v1/json/search/images?q=source_url%3A*trixiebooru.org*&key=k',
  );
  /* The query used to be rewritten and the host left as it was when the query came first. */
  const queryFirst = 'https://derpibooru.org/api/v1/json/search/images?q=trixiebooru.org';
  assert.equal(route.canonicalDerpiUrl(queryFirst), queryFirst, 'a canonical URL is left exactly as it is');
  assert.equal(route.canonicalDerpiUrl('https://www.trixiebooru.org/api/v1/json/images/1'), 'https://derpibooru.org/api/v1/json/images/1');
  assert.equal(route.canonicalDerpiUrl('/relative/trixiebooru.org'), '/relative/trixiebooru.org');
  const accel = route.buildApiLineUrl(searched, 'api_accel');
  const inner = decodeURIComponent(accel.slice(accel.indexOf('?url=') + 5));
  assert.equal(new URL(inner).hostname, 'derpibooru.org');
  assert.match(new URL(inner).searchParams.get('q'), /trixiebooru\.org/, 'the search the user typed reaches the worker intact');
});

test('P2-F4: a new stay on the backup line checks home after 10s, whatever the last stay reached', async (t) => {
  values.set(LS_KEYS.useHongKongRelay, 'false');
  values.set(LS_KEYS.useApiAccel, 'true');
  route.syncLinePrefs();
  route.setLineNotifier(() => {});
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'] });
  const probes = [];
  globalThis.fetch = async (url) => {
    probes.push(String(url));
    return new Response('{}', { status: 503 });
  };
  assert.equal(route.stepApiFailover(502), true);
  /* Home stays down: the checks back off 10s, 20s, 40s, 80s. */
  for (const step of [10_000, 20_000, 40_000, 80_000]) {
    t.mock.timers.tick(step);
    await flush();
  }
  assert.equal(probes.length, 4);
  /* The backup line itself fails: auto goes home with a 30s cooldown. */
  assert.equal(route.stepApiFailover(502), true);
  assert.equal(route.resolveApiLine(), 'direct');
  t.mock.timers.tick(30_000);
  /* Home fails again: a new stay on the backup line. */
  assert.equal(route.stepApiFailover(502), true);
  assert.equal(route.resolveApiLine(), 'api_accel');
  t.mock.timers.tick(10_000);
  await flush();
  assert.equal(probes.length, 5, 'the first check of the new stay is ten seconds in, not 160');
  globalThis.fetch = async (url) => { throw new Error(`Unexpected network request: ${url}`); };
});

test('P2-F5: a link the browser resolves to another host is never internal', () => {
  for (const href of ['/\\evil.example/x', '/\t/evil.example', '/\n/evil.example', '//evil.example', 'https://evil.example/forum/1']) {
    assert.equal(isInternalHref(href), false, JSON.stringify(href));
  }
  for (const href of ['/forum/12', 'https://picpony.top/forum/5', 'https://www.picpony.top/pic/1?x=1#c']) {
    assert.equal(isInternalHref(href), true, href);
  }
  assert.equal(isInternalHref('relative/path'), false, 'a document-relative link depends on its page');
  assert.equal(isInternalHref('/api.php?action=x'), false);
  /* What the published BBCode does with it: an external link opens beside the app, with no opener. */
  const html = bbcodeToSafeHtml('[url=/\\evil.example/login]登录[/url]', { isInternal: isInternalHref });
  assert.match(html, /target="_blank" rel="noopener noreferrer"/);
});

test('P2-F6: a count that rounds up to 10,000万 reads as 1亿', () => {
  assert.equal(formatCount(99_999_999), '1亿');
  assert.equal(formatCount(99_999_500), '1亿');
  assert.equal(formatCount(99_995_000), '9,999.5万');
  assert.equal(formatCount(12_345), '1.2万');
  assert.equal(formatCount(9_999), '9,999');
  assert.equal(formatCount(250_000_000), '2.5亿');
});

test('P2-F10: clearing a session answers true once, even when storage refuses the removal', () => {
  values.clear();
  events.length = 0;
  hooks.writeUserInfo({ token: 'stuck', username: 'pony' });
  const stored = globalThis.localStorage;
  globalThis.localStorage = { ...stored, removeItem: () => { throw new Error('SecurityError'); } };
  try {
    assert.equal(hooks.clearUserInfo('stuck'), true, 'the first 401 ends the session');
    assert.equal(hooks.clearUserInfo('stuck'), false, 'a second 401 for the same token is not a second ending');
  } finally {
    globalThis.localStorage = stored;
  }
  assert.equal(events.filter((type) => type === 'user_info_updated').length, 2, 'one for the sign-in, one for the ending');
  /* A new sign-in with the same token (storage that never let go of it) can be ended again. */
  hooks.writeUserInfo({ token: 'stuck', username: 'pony' });
  assert.equal(hooks.clearUserInfo('stuck'), true);
});

test('P2-F7: one parser for the upstream origin, failing loudly on a malformed override', () => {
  assert.equal(parseUpstreamOrigin(undefined), DEFAULT_UPSTREAM_ORIGIN);
  assert.equal(parseUpstreamOrigin('  '), DEFAULT_UPSTREAM_ORIGIN);
  assert.equal(parseUpstreamOrigin('http://127.0.0.1:4100/'), 'http://127.0.0.1:4100');
  assert.equal(parseUpstreamOrigin('https://staging.picpony.top'), 'https://staging.picpony.top');
  for (const bad of ['picpony.top', 'ftp://x.test', 'https://x.test/api.php', 'https://u:p@x.test', 'https://x.test?a=1']) {
    assert.throws(() => parseUpstreamOrigin(bad), /PICPONY_UPSTREAM_ORIGIN/, bad);
  }
  /* No reader keeps a private copy of the override, or of its default. */
  const readers = [
    'app/api.php/[[...path]]/route.ts', 'app/share.php/route.ts', 'app/search/semantic.server.ts',
    'lib/adminCatalogTools/importProxy.ts', 'lib/blockFilters.server.ts', 'lib/detail.server.ts',
    'lib/forum.server.ts', 'lib/maintenance.server.ts', 'lib/profile.server.ts', 'lib/route.server.ts',
    'lib/team.server.ts', 'next.config.ts',
  ];
  for (const file of readers) {
    const source = readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
    assert.doesNotMatch(source, /process\.env\.PICPONY_UPSTREAM_ORIGIN/, file);
    assert.match(source, /upstreamOrigin\(\)/, file);
  }
});

test('P2-F8: the sign-in dialog uses the shared field-error hook rather than a private copy', () => {
  const source = readFileSync(new URL('../components/AuthModal.tsx', import.meta.url), 'utf8');
  assert.match(source, /from '@\/lib\/useFieldErrors'/);
  assert.doesNotMatch(source, /function useFieldErrors/);
});
