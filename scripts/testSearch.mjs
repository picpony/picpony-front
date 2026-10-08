/**
 * /search's pure rules, with no browser and no network: the grammar the screen reads a query
 * with (terms, the advanced conditions it shows as controls, single tags, excluded terms), the
 * image-search content check, the URL model (every state reproducible from the URL alone),
 * the semantic configuration's estimate and timeout, and the transports' answers mapped to
 * `ApiError` (fetch stubbed).
 */
import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { requireTypeStripping } from './tsResolve.mjs';

requireTypeStripping('testSearch');

const values = new Map();
globalThis.localStorage = {
  getItem: (key) => values.get(key) ?? null,
  setItem: (key, value) => values.set(key, String(value)),
  removeItem: (key) => values.delete(key),
};
globalThis.window = {
  addEventListener() {}, removeEventListener() {}, dispatchEvent() { return true; },
  setTimeout: (...args) => setTimeout(...args), clearTimeout: (...args) => clearTimeout(...args),
};
globalThis.document = { visibilityState: 'visible', cookie: '', addEventListener() {}, removeEventListener() {} };
const originalFetch = globalThis.fetch;
after(() => { globalThis.fetch = originalFetch; });

const query = await import('../lib/searchQuery.ts');
const state = await import('../lib/searchState.ts');
const { semanticConfigFrom } = await import('../app/search/semantic.server.ts');
const semantic = await import('../lib/api/semantic.ts');
const { ApiError } = await import('../lib/api/errors.ts');

test('top-level terms split at commas outside groups and quotes, full-width commas included', () => {
  assert.deepEqual(query.splitQueryTerms('fluttershy, rarity，safe'), ['fluttershy', 'rarity', 'safe']);
  assert.deepEqual(
    query.splitQueryTerms('pony, (mime_type:video/webm OR mime_type:video/mp4), "a, b"'),
    ['pony', '(mime_type:video/webm OR mime_type:video/mp4)', '"a, b"'],
  );
  assert.deepEqual(query.splitQueryTerms(' , ,'), []);
  assert.equal(query.normalizeSearchText('  小蝶，雨天 ,  '), '小蝶,雨天');
});

test('advanced conditions are parsed out of the query and written back in place, never appended', () => {
  const parsed = query.parseSearchFilters('pony, upvotes.gte:100, Aspect_Ratio.GT: 1, animated:true, created_at.gte:1 weeks ago');
  assert.deepEqual(parsed.terms, ['pony']);
  assert.deepEqual(parsed.filters, {
    upvotes: { op: 'gte', value: 100 }, score: null, aspect: 'landscape', media: 'animated', since: 'week',
  });
  const once = query.composeQuery(parsed.terms, parsed.filters);
  const twice = query.composeQuery(query.parseSearchFilters(once).terms, query.parseSearchFilters(once).filters);
  assert.equal(once, twice, 'applying the same conditions twice changes nothing');
  assert.equal(
    query.composeQuery(parsed.terms, query.NO_SEARCH_FILTERS),
    'pony',
    'clearing the conditions removes them from the query',
  );
  const video = query.parseSearchFilters('(mime_type:video/mp4 OR mime_type:video/webm), score.lt:-5');
  assert.equal(video.filters.media, 'video');
  assert.deepEqual(video.filters.score, { op: 'lt', value: -5 });
  const kept = query.parseSearchFilters('upvotes.gt:5, -animated:true');
  assert.deepEqual(kept.terms, ['upvotes.gt:5', '-animated:true'], 'conditions the panel cannot express stay terms');
  assert.equal(query.countSearchFilters(kept.filters), 0);
});

test('quick tags toggle a top-level term, case-insensitively', () => {
  assert.equal(query.toggleQueryTerm('', 'fluttershy'), 'fluttershy');
  assert.equal(query.toggleQueryTerm('fluttershy', 'safe'), 'fluttershy, safe');
  assert.equal(query.toggleQueryTerm('Fluttershy, safe', 'fluttershy'), 'safe');
  assert.equal(query.queryHasTerm('a, B', 'b'), true);
});

test('semantic eligibility is the original front end’s: Chinese words and no query syntax', () => {
  assert.equal(query.isSemanticText('在下雨天撑伞的小蝶'), true);
  assert.equal(query.isSemanticText('小蝶, 雨天'), true);
  assert.equal(query.isSemanticText('fluttershy'), false);
  for (const syntax of ['小蝶 OR 云宝', '小蝶, -explicit', '(小蝶)', '小蝶 && 云宝']) {
    assert.equal(query.isSemanticText(syntax), false, syntax);
  }
});

test('a single plain tag is recognised; conditions, negations and operators are not', () => {
  for (const tag of ['fluttershy', 'twilight sparkle', 'artist:someone', 'oc:blue sky']) {
    assert.equal(query.isSingleTagQuery(tag), true, tag);
  }
  for (const other of ['a, b', '-safe', 'score.gte:5', 'upvotes:3', 'pony*', 'a OR b', '小蝶', '"quoted"']) {
    assert.equal(query.isSingleTagQuery(other), false, other);
  }
});

test('the empty state can name the term the content settings exclude', () => {
  const excluded = query.excludedTagsFrom(
    { contentFilter: 'safe', banAnthro: false, banDiscomfort: true, onlyPony: false, hiddenTags: ['spider'] },
  );
  assert.deepEqual(query.excludedTermsIn('fluttershy, explicit', excluded), ['explicit']);
  assert.deepEqual(query.excludedTermsIn('spider', excluded), ['spider']);
  assert.deepEqual(query.excludedTermsIn('explicit OR safe', excluded), [], 'an alternative may still match');
  assert.deepEqual(query.excludedTermsIn('-explicit', excluded), []);
});

test('the query’s -tag terms and the image-search check share one exclusion set', () => {
  const settings = { contentFilter: 'safe', banAnthro: true, banDiscomfort: false, onlyPony: true, hiddenTags: ['spider'] };
  const encoded = decodeURIComponent(query.buildSearchQueryFrom(settings, 'pony'));
  for (const tag of query.excludedTagsFrom(settings)) {
    assert.ok(encoded.includes(`-${tag.replace(/([+\-=&|><!(){}[\]^"~*?:\\/\s])/g, '\\$1')}`), tag);
  }
  const allowed = query.imageFilterFor(settings, undefined, [42]);
  assert.equal(allowed({ id: 1, tags: ['pony', 'safe'] }), true);
  assert.equal(allowed({ id: 2, tags: ['pony', 'suggestive'] }), false, 'excluded by the content filter');
  assert.equal(allowed({ id: 3, tags: ['pony', 'anthro'] }), false, 'excluded by 屏蔽类人生物');
  assert.equal(allowed({ id: 4, tags: ['human', 'safe'] }), false, '只看小马 wants a pony tag');
  assert.equal(allowed({ id: 5, tags: ['Spider', 'pony'] }), false, 'hidden tags, case-insensitively');
  assert.equal(allowed({ id: 42, tags: ['pony'] }), false, 'the public blacklist');
  assert.equal(allowed({ id: 6, tags: [] }), true, 'an untagged record passes, as it did in the original front end');
  const developer = query.imageFilterFor({ ...settings, contentFilter: 'developer', onlyPony: false });
  assert.equal(developer({ id: 7, tags: ['explicit'] }), true);
});

test('the URL is the whole state: every search reproduces from it, junk falls back', () => {
  const href = state.searchHref('在下雨天撑伞的小蝶', 'score', 'asc', 3, { tags: ['fluttershy', 'umbrella', 'fluttershy'] });
  const location = state.readSearchLocation(new URL(href, 'https://example.test').searchParams);
  assert.equal(location.query, '在下雨天撑伞的小蝶', 'the original words survive');
  assert.deepEqual(location.tags, ['fluttershy', 'umbrella']);
  assert.equal(location.sort, 'score');
  assert.equal(location.direction, 'asc');
  assert.equal(location.page, 3);
  assert.equal(location.literal, false);
  const literal = state.readSearchLocation(new URL(state.searchHref('小蝶', 'created_at', 'desc', 1, { literal: true, tags: ['x'] }), 'https://e.test').searchParams);
  assert.equal(literal.literal, true);
  assert.equal(literal.tags, null, 'a literal search pins no tags');
  const image = state.readSearchLocation(new URL(state.imageSearchHref('abc12345'), 'https://e.test').searchParams);
  assert.equal(image.image, 'abc12345');
  assert.equal(state.readSearchLocation(new URLSearchParams('image=<script>')).image, null);
  const junk = state.readSearchLocation(new URLSearchParams('q=%20pony%20&dir=sideways&page=-4&tags=,,'));
  assert.deepEqual(
    { query: junk.query, direction: junk.direction, page: junk.page, tags: junk.tags },
    { query: 'pony', direction: 'desc', page: 1, tags: null },
  );
});

test('a shared search names its sharer, and the original front end’s links still arrive', () => {
  const shared = state.searchHref('小蝶', 'score', 'desc', 1, { tags: ['fluttershy'], sharedBy: '  Review Admin ' });
  const location = state.readSearchLocation(new URL(shared, 'https://e.test').searchParams);
  assert.equal(location.sharedBy, 'Review Admin');
  assert.deepEqual(location.tags, ['fluttershy'], 'the shared search runs the sharer’s tags at once');
  const hostile = state.readSearchLocation(new URLSearchParams(`q=pony&from=${encodeURIComponent('a\u0000b\n' + 'x'.repeat(80))}`));
  assert.equal(hostile.sharedBy, `ab${'x'.repeat(30)}`, 'control characters dropped, length bounded');
  assert.equal(state.readSearchLocation(new URLSearchParams('q=pony&from=%20%20')).sharedBy, null);

  const legacy = state.legacySharedSearchHref(`#mode=shared_search&user=${encodeURIComponent('小明')}&q=${encodeURIComponent('fluttershy, safe')}`);
  const arrived = state.readSearchLocation(new URL(legacy, 'https://e.test').searchParams);
  assert.equal(new URL(legacy, 'https://e.test').pathname, '/search');
  assert.equal(arrived.query, 'fluttershy, safe');
  assert.equal(arrived.sharedBy, '小明');
  assert.equal(state.legacySharedSearchHref('#mode=shared_search&user=x&q=*'), '/search', 'the old “everything” query');
  assert.equal(state.legacySharedSearchHref('#mode=shared_faves&user=x'), null, 'other fragments are not this one’s');
  assert.equal(state.legacySharedSearchHref(''), null);
});

test('a share link is short when share.php answers, and the long link on any failure', async () => {
  const share = await import('../lib/api/share.ts');
  globalThis.window.location = { origin: 'https://picpony.test' };
  const calls = [];
  const answer = (body, init = {}) => new Response(typeof body === 'string' ? body : JSON.stringify(body), {
    status: init.status ?? 200,
    headers: { 'content-type': init.type ?? 'application/json; charset=utf-8' },
  });
  let next = () => answer({ success: true, share_id: 'Ab3x' });
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), init });
    return next();
  };
  const input = { targetUrl: 'https://picpony.test/search?q=pony&from=R', title: '分享搜索结果：pony', desc: 'R 向您分享了ta的搜索结果，快来看看吧~' };
  const short = await share.createShareLink(input, { token: 'tok' });
  assert.deepEqual(short, { url: 'https://picpony.test/share.php?id=Ab3x', short: true });
  assert.equal(calls[0].url, '/share.php?action=create');
  assert.equal(calls[0].init.method, 'POST');
  assert.equal(calls[0].init.headers.Authorization, 'Bearer tok');
  assert.deepEqual(JSON.parse(calls[0].init.body), {
    target_url: input.targetUrl, title: input.title, desc: input.desc, image_url: 'Derp.png',
  }, 'the original front end’s body, field for field');
  const withImage = await share.createShareLink({ ...input, imageId: 42, imageUrl: 'https://derpicdn.net/t.png' });
  assert.equal(JSON.parse(calls[1].init.body).image_id, 42);
  assert.equal(calls[1].init.headers.Authorization, undefined, 'no token, no header');
  assert.equal(withImage.short, true);

  for (const failure of [
    () => answer({ success: false, error: 'x' }),
    () => answer({ success: true }),
    () => answer('<html>404</html>', { status: 404, type: 'text/html' }),
    () => answer({ success: true, share_id: 'x' }, { status: 500 }),
    () => { throw new TypeError('Failed to fetch'); },
  ]) {
    next = failure;
    assert.deepEqual(await share.createShareLink(input), { url: input.targetUrl, short: false });
  }
});

test('the semantic estimate and timeout follow the backend’s own numbers', () => {
  const live = semanticConfigFrom({
    success: true, semantic_search_mode: 'qwen', semantic_cloud_enabled: true, semantic_cloud_has_key: true,
    semantic_cloud_timeout_ms: 8000, semantic_search_estimate_ms: 851,
  });
  assert.deepEqual(live, { availability: 'on', estimateMs: 851, timeoutMs: 10_000 });
  const local = semanticConfigFrom({ success: true, semantic_search_mode: 'legacy', semantic_search_estimate_ms: 0 });
  assert.equal(local.estimateMs, 7000, 'a local model with no measurement: 6–8 s');
  assert.equal(local.timeoutMs, 16_000, 'never less than twice the expected time');
  assert.equal(semanticConfigFrom({ success: true, semantic_search_enabled: true }).availability, 'on');
  assert.equal(semanticConfigFrom({ success: true, semantic_search_mode: 'off', semantic_search_enabled: true }).availability, 'off');
});

function stubFetch(handler) {
  const calls = [];
  globalThis.fetch = async (url, init = {}) => {
    calls.push({ url: String(url), init });
    const [status, body] = handler(String(url), init);
    return new Response(typeof body === 'string' ? body : JSON.stringify(body), {
      status, headers: { 'content-type': 'application/json' },
    });
  };
  return calls;
}

test('the semantic parse posts the words and maps every answer', async () => {
  const calls = stubFetch(() => [200, {
    success: true, enabled: true, mode: 'qwen', tags: ['fluttershy', 'simple background', 'Fluttershy', 3],
    model_used: true, model_engines: ['cloud'],
  }]);
  const parse = await semantic.parseSemanticQuery('小蝶 简单背景', { timeoutMs: 5000 });
  assert.deepEqual(parse, { enabled: true, tags: ['fluttershy', 'simple background'], modelUsed: true, engines: ['cloud'], mode: 'qwen' });
  assert.match(calls[0].url, /action=semantic_search/);
  assert.equal(calls[0].init.method, 'POST');
  assert.deepEqual(JSON.parse(calls[0].init.body), { query: '小蝶 简单背景' });

  stubFetch(() => [200, { success: false, enabled: false }]);
  assert.equal((await semantic.parseSemanticQuery('小蝶')).enabled, false, 'switched off is an answer, not a failure');

  stubFetch(() => [400, { error: '搜索内容为空或过长' }]);
  await assert.rejects(semantic.parseSemanticQuery('x'), (error) =>
    error instanceof ApiError && error.message === '搜索内容为空或过长' && !error.retryable);

  stubFetch(() => [502, '<html>bad gateway</html>']);
  await assert.rejects(semantic.parseSemanticQuery('x'), (error) => error instanceof ApiError && error.retryable);
});

test('feedback sends the original front end’s body; quick tags and suggestions normalise their rows', async () => {
  const calls = stubFetch((url) => {
    if (url.includes('submit_semantic_feedback')) return [200, { success: true, message: '感谢反馈！' }];
    if (url.includes('get_quick_tags')) {
      return [200, { success: true, tags: { rating: [{ en: 'safe', cn: '安全' }, { en: 'safe', cn: 'x' }], character: [{ en: 'fluttershy', cn: '未翻' }] } }];
    }
    return [200, { success: true, tags: [
      { id: 1, en: 'fluttershy', cn: '小蝶，柔柔', aliases: ['柔柔'], cat: 'character', count: '290613', is_restricted: 0 },
      { id: 2, en: 'secret', cn: '秘密', cat: 'general', count: 5, is_sensitive: 1 },
    ] }];
  });
  await semantic.submitSemanticFeedback({ query: '小蝶', tags: ['fluttershy', 'rain'], engines: ['a', 'b'], cfToken: 'tok' }, 'user-token');
  assert.deepEqual(JSON.parse(calls[0].init.body), { query: '小蝶', result: 'fluttershy, rain', engine: 'a/b', mode: '', cf_token: 'tok' });
  assert.equal(new Headers(calls[0].init.headers).get('Authorization'), 'Bearer user-token');

  const groups = await semantic.getQuickTags();
  assert.deepEqual(groups.rating, [{ en: 'safe', cn: '安全' }], 'one row per tag');
  assert.deepEqual(groups.character, [{ en: 'fluttershy', cn: '' }], '未翻 is no name');
  assert.deepEqual(groups.species, []);

  const rows = await semantic.suggestTags('柔');
  assert.equal(rows.length, 1, 'a sensitive tag is not offered');
  assert.equal(rows[0].cn, '柔柔', 'the Chinese name that matches what was typed');
  assert.equal(rows[0].count, 290613);
  const suggestCall = calls.at(-1).url;
  assert.match(suggestCall, /mode=suggest/);
  assert.match(suggestCall, /filter_artist=0/);
  assert.equal(new Headers(calls.at(-1).init.headers).get('Authorization'), null, 'the dictionary is public');
});
