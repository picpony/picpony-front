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

test('a share link is the backend’s short link, made once, and the long one on any refusal', async () => {
  const share = await import('../lib/api/share.ts');
  const calls = [];
  let answer = () => Response.json({ share_id: 'AbCdEfGhIjKlMnOpQrStUvWx', url: 'x', preview_status: 'generic' }, { status: 201 });
  globalThis.window.location = { origin: 'https://picpony.test' };
  globalThis.fetch = async (url, init) => { calls.push({ url: String(url), init }); return answer(); };
  const input = { targetUrl: 'https://picpony.test/search?q=pony&from=R', title: '分享搜索结果：pony', desc: 'R 向您分享了ta的搜索结果，快来看看吧~' };
  assert.deepEqual(await share.createShareLink(input), { url: 'https://picpony.test/share.php?id=AbCdEfGhIjKlMnOpQrStUvWx', short: true });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, '/api/v1/share-links');
  assert.equal(calls[0].init.method, 'POST');
  assert.deepEqual(JSON.parse(calls[0].init.body), { target_url: input.targetUrl, title: input.title, description: input.desc });
  assert.equal(new Headers(calls[0].init.headers).get('authorization'), null, 'no session, no attribution');
  /* A picture names its id; its preview picture is the backend’s own, so no URL is sent. */
  await share.createShareLink({ ...input, imageId: 42, imageUrl: 'https://derpicdn.net/t.png' }, { token: 'tok' });
  assert.deepEqual(JSON.parse(calls[1].init.body), { target_url: input.targetUrl, title: input.title, description: input.desc, image_id: 42 });
  assert.equal(new Headers(calls[1].init.headers).get('authorization'), 'Bearer tok');
  /* A refused target (not this site) or a failure hands over the long link. */
  answer = () => Response.json({ error: { code: 'SHARE_TARGET_NOT_ALLOWED', message: '分享目标只能是本站页面' } }, { status: 400 });
  assert.deepEqual(await share.createShareLink(input), { url: input.targetUrl, short: false });
  answer = () => { throw new TypeError('offline'); };
  assert.deepEqual(await share.createShareLink(input), { url: input.targetUrl, short: false });
  /* The caller’s own abort is not a failure to fall back from. */
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(share.createShareLink(input, { signal: controller.signal }));
  delete globalThis.window.location;
});

test('the semantic estimate and timeout follow the backend’s own numbers', () => {
  /* `GET /semantic-searches/settings` fields: availability is `semantic_search_mode` alone. */
  const live = semanticConfigFrom({
    semantic_search_mode: 'qwen', semantic_cloud_enabled: true, semantic_cloud_has_key: true,
    semantic_cloud_timeout_ms: 8000, semantic_search_estimate_ms: 851,
  });
  assert.deepEqual(live, { availability: 'on', estimateMs: 851, timeoutMs: 10_000 });
  const local = semanticConfigFrom({ semantic_search_mode: 'legacy', semantic_search_estimate_ms: null });
  assert.equal(local.estimateMs, 7000, 'a local model with no measurement: 6–8 s');
  assert.equal(local.timeoutMs, 16_000, 'never less than twice the expected time');
  assert.equal(semanticConfigFrom({ semantic_search_mode: 'qwen' }).availability, 'on');
  assert.equal(semanticConfigFrom({ semantic_search_mode: 'off' }).availability, 'off');
  assert.equal(semanticConfigFrom({}).availability, 'off', 'a caller without the mode (an admin cloud save) does not switch it on');
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
  const answer = {
    query: '小蝶 简单背景', mode: 'qwen', tags: ['fluttershy', 'simple background'], details: [],
    model_used: true, model_engines: ['cloud'], cached: false, ai_receipt: null,
  };
  const calls = stubFetch(() => [200, answer]);
  const parse = await semantic.parseSemanticQuery('小蝶 简单背景', { timeoutMs: 5000 });
  assert.deepEqual(parse, { enabled: true, tags: ['fluttershy', 'simple background'], modelUsed: true, engines: ['cloud'], mode: 'qwen' });
  assert.equal(calls[0].url, '/api/v1/semantic-searches');
  assert.equal(calls[0].init.method, 'POST');
  assert.deepEqual(JSON.parse(calls[0].init.body), { query: '小蝶 简单背景' });

  for (const code of ['SEMANTIC_SEARCH_DISABLED', 'SEMANTIC_CLOUD_NOT_CONFIGURED']) {
    stubFetch(() => [503, { error: { code, message: '智能中文搜索未开启' } }]);
    assert.equal((await semantic.parseSemanticQuery('小蝶')).enabled, false, `${code} is an answer, not a failure`);
  }

  stubFetch(() => [400, { error: { code: 'INVALID_INPUT', message: '搜索内容不能为空' } }]);
  await assert.rejects(semantic.parseSemanticQuery('x'), (error) =>
    error instanceof ApiError && error.message === '搜索内容不能为空' && !error.retryable);

  stubFetch(() => [503, { error: { code: 'SEMANTIC_SEARCH_UNAVAILABLE', message: '智能解析暂时不可用，请按原文搜索' } }]);
  await assert.rejects(semantic.parseSemanticQuery('x'), (error) =>
    error instanceof ApiError && error.code === 'SEMANTIC_SEARCH_UNAVAILABLE' && error.retryable);

  stubFetch(() => [502, '<html>bad gateway</html>']);
  await assert.rejects(semantic.parseSemanticQuery('x'), (error) => error instanceof ApiError && error.retryable);
});

test('semanticSearch carries the assistant context and returns the receipt as sent', async () => {
  const receipt = { query_mode: 'refine', query_source: 'model_query', semantic_input: '小蝶, -human', semantic_output: ['fluttershy', '-human'] };
  const calls = stubFetch(() => [200, {
    query: '小蝶, -human', mode: 'qwen', tags: ['fluttershy', '-human'],
    details: [{ tag: 'fluttershy', en: 'fluttershy', cn: '小蝶', category: 'character', negative: false, source: 'dictionary' }],
    model_used: false, model_engines: [], cached: true, ai_receipt: receipt,
  }]);
  const result = await semantic.semanticSearch('小蝶, -human', {
    aiContext: { queryMode: 'refine', querySource: 'model_query', currentQuery: 'fluttershy' },
  });
  assert.deepEqual(JSON.parse(calls[0].init.body), {
    query: '小蝶, -human',
    ai_context: { query_mode: 'refine', query_source: 'model_query', current_query: 'fluttershy' },
  });
  assert.deepEqual(result.aiReceipt, receipt);
  assert.deepEqual(result.tags, ['fluttershy', '-human']);
  assert.equal(result.cached, true);

  stubFetch(() => [422, { error: { code: 'QUERY_UNVERIFIED', message: '标签「foo」不在词库中，未执行搜索' } }]);
  await assert.rejects(semantic.semanticSearch('foo', { aiContext: { queryMode: 'new', querySource: 'model_query' } }), (error) =>
    error instanceof ApiError && error.code === 'QUERY_UNVERIFIED');
});

test('feedback posts the proof; quick tags and suggestions read the backend rows', async () => {
  const calls = stubFetch((url) => {
    if (url.startsWith('/api/v1/search/feedback')) return [201, { success: true, message: '感谢反馈！' }];
    if (url.startsWith('/api/v1/dictionary/quick-tags')) {
      return [200, { tags: {
        rating: [{ en: 'safe', cn: '安全', category: 'rating' }, { en: 'safe', cn: 'x', category: 'rating' }],
        species: [],
        character: [{ en: 'fluttershy', cn: '未翻译', category: 'character' }],
        general: [],
      } }];
    }
    const row = { aliases: [], description: '', restricted: false, sensitive: false };
    return [200, { tags: [
      { ...row, id: 1, en: 'fluttershy', cn: '小蝶，柔柔', aliases: ['柔柔'], category: 'character', search_count: 290613 },
      { ...row, id: 2, en: 'secret', cn: '秘密', category: 'general', search_count: 5, sensitive: true },
    ], total_matches: null, stats: null, dictionary_revision: 3 }];
  });
  await semantic.submitSemanticFeedback({ query: '小蝶', tags: ['fluttershy', 'rain'], engines: ['a', 'b'], captchaProof: 'proof' }, 'user-token');
  assert.equal(calls[0].url, '/api/v1/search/feedback');
  assert.deepEqual(JSON.parse(calls[0].init.body), { captcha_proof: 'proof', query: '小蝶', result: 'fluttershy, rain', engine: 'a/b' });
  assert.equal(new Headers(calls[0].init.headers).get('Authorization'), 'Bearer user-token');

  const groups = await semantic.getQuickTags();
  assert.deepEqual(groups.rating, [{ en: 'safe', cn: '安全' }], 'one row per tag');
  assert.deepEqual(groups.character, [{ en: 'fluttershy', cn: '' }], '未翻译 is no name');
  assert.deepEqual(groups.species, []);

  const rows = await semantic.suggestTags('柔');
  assert.equal(rows.length, 1, 'a sensitive tag is not offered');
  assert.equal(rows[0].cn, '柔柔', 'the Chinese name that matches what was typed');
  assert.equal(rows[0].count, 290613);
  assert.equal(rows[0].category, 'character');
  const suggestCall = new URL(calls.at(-1).url, 'http://x');
  assert.equal(suggestCall.pathname, '/api/v1/dictionary/tags');
  assert.equal(suggestCall.searchParams.get('suggest'), 'true');
  assert.equal(suggestCall.searchParams.get('limit'), '15');
  assert.equal(new Headers(calls.at(-1).init.headers).get('Authorization'), null, 'the dictionary is public');
});
