/**
 * 标签订阅 without a browser: the six actions' wire (`lib/api/tagSubscriptions.ts`), the live count a
 * subscription starts from (the original front end's two Derpibooru reads, an alias followed to
 * its tag, a tag that does not exist, a rate limit surfacing as itself), Philomena's slugs, the
 * subscription's address, and the sync (`components/subscriptions/sync.ts`) — its batches under one
 * `sync_token`, its finalise, its stamp and schedule, and what a failure, a rate limit and a
 * sign-out midway leave behind.
 */
import assert from 'node:assert/strict';
import { beforeEach, test } from 'node:test';
import { requireTypeStripping } from './tsResolve.mjs';

requireTypeStripping('testSubscriptions');

const values = new Map();
globalThis.localStorage = {
  getItem: (key) => values.get(key) ?? null,
  setItem: (key, value) => values.set(key, String(value)),
  removeItem: (key) => values.delete(key),
};
const sessionValues = new Map();
globalThis.sessionStorage = {
  getItem: (key) => sessionValues.get(key) ?? null,
  setItem: (key, value) => sessionValues.set(key, String(value)),
  removeItem: (key) => sessionValues.delete(key),
};
globalThis.window = {
  requestAnimationFrame: (callback) => setTimeout(callback, 0),
  addEventListener() {}, removeEventListener() {},
  dispatchEvent() { return true; },
  setTimeout: (...args) => setTimeout(...args),
  clearTimeout: (...args) => clearTimeout(...args),
  matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }),
  location: { origin: 'https://app.invalid' },
  __picponyRoutePolicy: { api: 'direct', image: 'direct' },
};
globalThis.document = { visibilityState: 'visible', hidden: false, cookie: '', addEventListener() {}, removeEventListener() {} };

/** Derpibooru's tags, as the stub answers them: name → record. */
const TAGS = new Map([
  ['fluttershy', { slug: 'fluttershy', images: 290010 }],
  ['rainbow dash', { slug: 'rainbow+dash', images: 315460, aliases: ['rd', 'dashie'] }],
  ['rd', { slug: 'rd', images: 0, aliased_tag: 'rainbow+dash' }],
  ['oc:nyx', { slug: 'oc-colon-nyx', images: 3020 }],
]);
const row = (name) => ({ name, slug: TAGS.get(name).slug, images: TAGS.get(name).images, aliases: TAGS.get(name).aliases ?? [], aliased_tag: TAGS.get(name).aliased_tag ?? null });
const unescape = (term) => term.replace(/\\(.)/g, '$1');

let calls;
/** PicPony actions → body; Derpibooru reads go to `derpi`. */
let picpony;
let derpi;
beforeEach(() => {
  values.clear();
  sessionValues.clear();
  calls = [];
  picpony = {};
  derpi = (url) => {
    const q = url.searchParams.get('q');
    const rows = [];
    for (const term of q.split(' OR ')) {
      const [, field, value] = /^(name:|slug:)?(.*)$/.exec(term.trim());
      const wanted = unescape(value);
      for (const name of TAGS.keys()) {
        const record = TAGS.get(name);
        const loose = name.includes(wanted) || (record.aliases ?? []).includes(wanted);
        if (field === 'slug:' ? record.slug === wanted : field === 'name:' ? name === wanted : loose) rows.push(row(name));
      }
    }
    return Response.json({ tags: rows, total: rows.length });
  };
  globalThis.fetch = async (input, init = {}) => {
    const url = new URL(String(input), 'https://app.invalid');
    calls.push({ url, init, body: init.body ? JSON.parse(init.body) : undefined });
    if (url.hostname === 'trixiebooru.org') return derpi(url);
    const action = url.searchParams.get('action');
    const answer = picpony[action];
    if (!answer) throw new Error(`unexpected request: ${url}`);
    return typeof answer === 'function' ? answer(calls.at(-1)) : Response.json(answer);
  };
});

const api = await import('../lib/api/tagSubscriptions.ts');
const { ApiError, apiErrorStatus } = await import('../lib/api/errors.ts');
const { escapeTag } = await import('../lib/searchQuery.ts');
const href = await import('../components/subscriptions/href.ts');
const sync = await import('../components/subscriptions/sync.ts');
const catalogue = await import('../lib/resources.ts');
const actions = await import('../components/subscriptions/actions.ts');
await (await import('../lib/route.ts')).ensureRoutePolicy();

const picponyCalls = (action) => calls.filter((call) => call.url.searchParams.get('action') === action);
const derpiCalls = () => calls.filter((call) => call.url.hostname === 'trixiebooru.org');
const signIn = (token) => values.set('user_info', JSON.stringify({ id: 1, username: 'a', token }));

// --- the wire ---------------------------------------------------------------------------------

test('the list is read with the token, de-duplicated as Derpibooru matches names, counts made whole', async () => {
  picpony.get_tag_subscriptions = {
    success: true,
    subscriptions: [
      { tag_name: 'Fluttershy', image_count: '290000', unread_new_count: 3 },
      { tag_name: 'fluttershy', image_count: 1, unread_new_count: 1 },
      { tag: 'oc:nyx', image_count: 3015 },
      { tag_name: '   ', image_count: 5 },
      { tag_name: 'princess luna', image_count: -4, unread_new_count: 'x' },
      null,
    ],
  };
  const list = await api.getTagSubscriptions('tok');
  assert.deepEqual(list, [
    { tagName: 'Fluttershy', imageCount: 290000, newCount: 3 },
    { tagName: 'oc:nyx', imageCount: 3015, newCount: 0 },
    { tagName: 'princess luna', imageCount: 0, newCount: 0 },
  ]);
  const [{ url, init }] = calls;
  assert.ok(url.searchParams.get('_t'));
  assert.equal(new Headers(init.headers).get('authorization'), 'Bearer tok');
  picpony.get_tag_subscriptions = { success: true };
  await assert.rejects(api.getTagSubscriptions('tok'), (error) => error instanceof ApiError && error.kind === 'invalid',
    'a body without a list is not an empty list');
});

test('add, remove and seen are the original’s JSON bodies; 已订阅 is recognised', async () => {
  picpony.add_tag_subscription = { success: true };
  picpony.remove_tag_subscription = { success: true };
  picpony.mark_tag_subscription_seen = { success: true };
  await api.addTagSubscription('tok', 'rainbow dash', 315460);
  await api.removeTagSubscription('tok', 'oc:nyx');
  await api.markTagSubscriptionSeen('tok', 'fluttershy');
  assert.deepEqual(calls.map((call) => [call.url.searchParams.get('action'), call.init.method, call.body]), [
    ['add_tag_subscription', 'POST', { tag_name: 'rainbow dash', image_count: 315460 }],
    ['remove_tag_subscription', 'POST', { tag_name: 'oc:nyx' }],
    ['mark_tag_subscription_seen', 'POST', { tag_name: 'fluttershy' }],
  ]);
  assert.ok(calls.every((call) => new Headers(call.init.headers).get('authorization') === 'Bearer tok'));
  picpony.add_tag_subscription = { success: false, error: '您已订阅该标签' };
  const error = await api.addTagSubscription('tok', 'x', 1).catch((caught) => caught);
  assert.equal(api.isAlreadySubscribed(error), true);
  assert.equal(api.isAlreadySubscribed(new ApiError('network')), false);
});

test('sync and finalise carry one sync_token; the token is the original’s alphabet', async () => {
  picpony.sync_tag_subscriptions = { success: true };
  picpony.finalize_tag_subscription_sync = { success: true, updated_tags: '2' };
  const token = api.newSyncToken();
  assert.match(token, /^[A-Za-z0-9_-]+$/);
  assert.notEqual(api.newSyncToken(), token);
  await api.syncTagSubscriptions('tok', token, [{ tag_name: 'fluttershy', image_count: 290010 }]);
  assert.deepEqual(await api.finalizeTagSubscriptionSync('tok', token), { updatedTags: 2 });
  assert.deepEqual(calls.map((call) => call.body), [
    { sync_token: token, updates: [{ tag_name: 'fluttershy', image_count: 290010 }] },
    { sync_token: token },
  ]);
});

// --- the live count -------------------------------------------------------------------------

test('a tag’s live count: the exact name first, one read', async () => {
  assert.deepEqual(await api.lookupDerpiTag(' Fluttershy '), { name: 'fluttershy', count: 290010, aliasOf: null });
  assert.equal(derpiCalls().length, 1);
  assert.equal(derpiCalls()[0].url.searchParams.get('q'), 'name:fluttershy');
  assert.equal(derpiCalls()[0].url.searchParams.get('per_page'), '10');
});

test('an alias record (0 pictures) is followed to the tag it stands for, and the subscription is to that', async () => {
  const found = await api.lookupDerpiTag('rd');
  assert.deepEqual(found, { name: 'rainbow dash', count: 315460, aliasOf: 'rd' });
  assert.deepEqual(derpiCalls().map((call) => call.url.searchParams.get('q')), ['name:rd', `slug:${escapeTag('rainbow+dash')}`]);
});

test('an alias found only in a tag’s list of aliases resolves through the original’s second read', async () => {
  const found = await api.lookupDerpiTag('dashie');
  assert.deepEqual(found, { name: 'rainbow dash', count: 315460, aliasOf: 'dashie' });
  const [exact, loose] = derpiCalls();
  assert.equal(exact.url.searchParams.get('q'), 'name:dashie');
  assert.equal(loose.url.searchParams.get('per_page'), '50');
});

test('a name with query syntax in it is one literal term', async () => {
  await api.lookupDerpiTag('oc:nyx');
  assert.equal(derpiCalls()[0].url.searchParams.get('q'), `name:${escapeTag('oc:nyx')}`);
});

test('a tag Derpibooru does not have is not-found with its own sentence', async () => {
  const error = await api.lookupDerpiTag('notatag').catch((caught) => caught);
  assert.ok(error instanceof ApiError && error.notFound);
  assert.equal(error.message, api.TAG_NOT_FOUND_MESSAGE);
  await assert.rejects(api.lookupDerpiTag('   '), (caught) => caught instanceof ApiError && caught.notFound);
});

test('a count Derpibooru did not send refuses the subscription instead of recording 0 (G3-015)', async () => {
  for (const images of [null, '', '  ', 'many', true, [], {}]) {
    TAGS.set('odd count', { slug: 'odd+count', images });
    const error = await api.lookupDerpiTag('odd count').catch((caught) => caught);
    assert.ok(error instanceof ApiError, `images ${JSON.stringify(images)}`);
    assert.equal(error.kind, 'invalid');
    assert.equal(error.message, api.TAG_COUNT_UNREADABLE_MESSAGE);
  }
  TAGS.set('odd count', { slug: 'odd+count', images: 0 });
  assert.deepEqual(await api.lookupDerpiTag('odd count'), { name: 'odd count', count: 0, aliasOf: null },
    'an explicit 0 is a real tag with no pictures');
  TAGS.set('odd count', { slug: 'odd+count', images: '12' });
  assert.equal((await api.lookupDerpiTag('odd count')).count, 12, 'a numeric string is a count');
  TAGS.delete('odd count');
  /* Followed to an alias's tag, the tag's own count is the one that must be readable. */
  TAGS.set('dash alias', { slug: 'dash+alias', images: 0, aliased_tag: 'dash+target' });
  TAGS.set('dash target', { slug: 'dash+target', images: null });
  const aliased = await api.lookupDerpiTag('dash alias').catch((caught) => caught);
  assert.equal(aliased.message, api.TAG_COUNT_UNREADABLE_MESSAGE);
  TAGS.delete('dash alias');
  TAGS.delete('dash target');
});

test('subscribing to a tag whose count is unreadable sends no add_tag_subscription', async () => {
  signIn('g3-015');
  TAGS.set('odd count', { slug: 'odd+count', images: null });
  picpony.add_tag_subscription = { success: true };
  const outcome = await actions.subscribeToTag('g3-015', 'odd count');
  assert.deepEqual(outcome, { kind: 'failed', message: api.TAG_COUNT_UNREADABLE_MESSAGE });
  assert.equal(actions.subscribeMessage(outcome)[0], `订阅失败：${api.TAG_COUNT_UNREADABLE_MESSAGE}`);
  assert.equal(picponyCalls('add_tag_subscription').length, 0);
  TAGS.delete('odd count');
});

test('a sign-out during the lookup stops the subscribe before it writes, and says so without 订阅失败', async () => {
  signIn('lookup-leave');
  picpony.add_tag_subscription = { success: true };
  const inner = derpi;
  derpi = (url) => {
    values.delete('user_info');
    return inner(url);
  };
  const outcome = await actions.subscribeToTag('lookup-leave', 'fluttershy');
  assert.deepEqual(outcome, { kind: 'stale-session' });
  assert.deepEqual(actions.subscribeMessage(outcome), [actions.SESSION_CHANGED_MESSAGE, 'warning']);
  assert.equal(picponyCalls('add_tag_subscription').length, 0);
});

test('a subscribe that shows its row waits briefly for the tag’s name, and asks for none with names off (M1-017)', async () => {
  signIn('named');
  picpony.get_tag_subscriptions = { success: true, subscriptions: [] };
  await catalogue.tagSubscriptions.read({ token: 'named' });
  picpony.add_tag_subscription = { success: true };
  let answerName;
  picpony.get_tag_translations = () => new Promise((resolve) => {
    answerName = () => resolve(Response.json({ success: true, translations: { fluttershy: '小蝶' } }));
  });
  let settled = false;
  const pending = actions.subscribeToTag('named', 'fluttershy', { awaitName: true }).then((outcome) => {
    settled = true;
    return outcome;
  });
  await new Promise((resolve) => setTimeout(resolve, 60));
  assert.equal(settled, false, 'the write is done, the name is still on its way');
  assert.equal(picponyCalls('add_tag_subscription').length, 1);
  assert.equal(picponyCalls('get_tag_translations').length, 1, 'asked beside the write, not after it');
  answerName();
  assert.equal((await pending).kind, 'done');
  const { peekTagTranslations } = await import('../lib/tagTranslations.ts');
  assert.deepEqual(peekTagTranslations(['fluttershy']), { fluttershy: '小蝶' }, 'the row’s first render can name it');

  /* A dictionary that does not answer costs the button its grace period, no more. */
  signIn('slow-name');
  picpony.get_tag_translations = () => new Promise(() => {});
  TAGS.set('slowly named', { slug: 'slowly+named', images: 3 });
  const started = Date.now();
  assert.equal((await actions.subscribeToTag('slow-name', 'slowly named', { awaitName: true })).kind, 'done');
  assert.ok(Date.now() - started < 1500, `waited ${Date.now() - started}ms`);
  TAGS.delete('slowly named');

  /* With 显示中文标签 off nothing would show the name: nothing asks for it. */
  calls.length = 0;
  signIn('names-off');
  values.set('picpony_show_chinese_tags', 'false');
  TAGS.set('unnamed tag', { slug: 'unnamed+tag', images: 1 });
  assert.equal((await actions.subscribeToTag('names-off', 'unnamed tag', { awaitName: true })).kind, 'done');
  assert.equal(picponyCalls('get_tag_translations').length, 0);
  TAGS.delete('unnamed tag');
});

test('取消订阅 after its confirmation reads the session again: a changed account sends nothing (G3-018)', async () => {
  picpony.remove_tag_subscription = { success: true };
  signIn('someone-else');
  assert.deepEqual(await actions.unsubscribeConfirmed('confirmed-under', 'fluttershy'), { kind: 'stale-session' });
  assert.equal(picponyCalls('remove_tag_subscription').length, 0);

  signIn('confirmed-under');
  picpony.get_tag_subscriptions = { success: true, subscriptions: [{ tag_name: 'fluttershy', image_count: 1 }] };
  await catalogue.tagSubscriptions.read({ token: 'confirmed-under' });
  assert.deepEqual(await actions.unsubscribeConfirmed('confirmed-under', 'Fluttershy'), { kind: 'done' });
  assert.deepEqual(picponyCalls('remove_tag_subscription').map((call) => call.body), [{ tag_name: 'Fluttershy' }]);
  picpony.remove_tag_subscription = { success: false, error: '服务暂不可用' };
  assert.deepEqual(await actions.unsubscribeConfirmed('confirmed-under', 'oc:nyx'),
    { kind: 'failed', message: '取消订阅失败：服务暂不可用' });
});

test('a rate limit surfaces as itself, not as a missing tag', async () => {
  derpi = () => new Response('{"error":"slow down"}', { status: 429, headers: { 'content-type': 'application/json' } });
  const error = await api.lookupDerpiTag('fluttershy').catch((caught) => caught);
  assert.equal(apiErrorStatus(error), 429);
  assert.equal(error.notFound, false);
  assert.equal(derpiCalls().length, 1, 'a 429 is not failed over to another line');
});

test('Philomena’s slugs, as a tag’s aliases are listed', () => {
  assert.equal(api.tagSlug('rainbow dash'), 'rainbow+dash');
  assert.equal(api.tagSlug('oc:nyx'), 'oc-colon-nyx');
  assert.equal(api.tagSlug('80s/90s style'), '80s-fwslash-90s+style');
  assert.equal(api.tagSlug('semi-grimdark'), 'semi-dash-grimdark');
  assert.equal(api.tagSlug('mr. cake'), 'mr-dot-+cake');
  assert.equal(api.tagSlug('c++'), 'c-plus--plus-');
  assert.equal(api.tagSlug('a\\b'), 'a-bwslash-b');
  assert.equal(api.tagSlug('小马'), '%E5%B0%8F%E9%A9%AC');
  assert.equal(api.normaliseTagName('  Rainbow   Dash '), 'rainbow dash');
});

// --- the address ----------------------------------------------------------------------------

test('a subscription’s address carries its tag as one segment, and reads back', () => {
  assert.equal(href.subscriptionHref('oc:nyx'), '/subscriptions/oc%3Anyx');
  assert.equal(href.subscriptionHref(' 80s/90s style '), '/subscriptions/80s%2F90s%20style');
  for (const tag of ['oc:nyx', '80s/90s style', '小马', 'a%b', 'what?']) {
    assert.equal(href.tagFromSegment(href.subscriptionHref(tag).slice('/subscriptions/'.length)), tag);
  }
  assert.equal(href.tagFromSegment('%E0%A4%A'), '%E0%A4%A', 'a malformed segment is taken as written');
  assert.equal(href.tagFromSegment('  fluttershy '), 'fluttershy');
});

// --- the sync -------------------------------------------------------------------------------

function subscriptions(count) {
  return Array.from({ length: count }, (_, index) => ({ tag_name: `tag ${index}`, image_count: 10, unread_new_count: 0 }));
}

test('a run: the list, its live counts fifty at a time, each batch reported under one token, then finalise', async () => {
  signIn('sync-a');
  for (let index = 0; index < 55; index += 1) TAGS.set(`tag ${index}`, { slug: `tag+${index}`, images: 10 + index });
  picpony.get_tag_subscriptions = { success: true, subscriptions: subscriptions(55) };
  picpony.sync_tag_subscriptions = { success: true };
  picpony.finalize_tag_subscription_sync = { success: true, updated_tags: 3 };
  const result = await sync.syncTagSubscriptionsNow('sync-a', () => 5_000_000);
  assert.deepEqual(result, { ok: true, updatedTags: 3 });

  const batches = derpiCalls().map((call) => call.url.searchParams.get('q').split(' OR ').length);
  assert.deepEqual(batches, [50, 5]);
  const posts = picponyCalls('sync_tag_subscriptions');
  assert.equal(posts.length, 2);
  assert.equal(posts[0].body.updates.length, 50);
  assert.deepEqual(posts[1].body.updates.at(-1), { tag_name: 'tag 54', image_count: 64 });
  const [finalise] = picponyCalls('finalize_tag_subscription_sync');
  assert.ok(posts.every((post) => post.body.sync_token === finalise.body.sync_token), 'one token for the run');
  assert.equal(sessionValues.get('tag_subscription_sync_v2_sync-a'), '5000000', 'stamped under the original’s key');
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(picponyCalls('get_tag_subscriptions').length, 2, 'the list re-read for its new counts');
  for (let index = 0; index < 55; index += 1) TAGS.delete(`tag ${index}`);
});

test('a run that moved nothing does not read the list again; one that moved a count does', async () => {
  signIn('still');
  for (let index = 0; index < 3; index += 1) TAGS.set(`tag ${index}`, { slug: `tag+${index}`, images: 10 });
  picpony.get_tag_subscriptions = { success: true, subscriptions: subscriptions(3) };
  picpony.sync_tag_subscriptions = { success: true };
  picpony.finalize_tag_subscription_sync = { success: true, updated_tags: 0 };
  assert.deepEqual(await sync.syncTagSubscriptionsNow('still', () => 5_100_000), { ok: true, updatedTags: 0 });
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(picponyCalls('get_tag_subscriptions').length, 1, 'every count where the list had it: no second read');

  signIn('shrunk');
  TAGS.set('tag 1', { slug: 'tag+1', images: 7 });
  assert.deepEqual(await sync.syncTagSubscriptionsNow('shrunk', () => 5_200_000), { ok: true, updatedTags: 0 });
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(picponyCalls('get_tag_subscriptions').length, 3, 'a count that fell is a change the list shows');
  for (let index = 0; index < 3; index += 1) TAGS.delete(`tag ${index}`);
});

test('the schedule: once per tab session at load, then ten minutes on, never within a minute of a try', async () => {
  assert.equal(sync.loadSyncDue('sched'), true, 'nothing ran in this tab session');
  sessionValues.set('tag_subscription_sync_v2_sched', '1');
  assert.equal(sync.loadSyncDue('sched'), false, 'the original’s own stamp counts');
  assert.equal(sync.periodicSyncDue('sched', Date.now()), true, 'its time unknown: as old as it gets');
  sessionValues.set('tag_subscription_sync_v2_sched', '1000000');
  assert.equal(sync.periodicSyncDue('sched', 1_000_000 + sync.SYNC_PERIOD_MS - 1), false);
  assert.equal(sync.periodicSyncDue('sched', 1_000_000 + sync.SYNC_PERIOD_MS), true);

  signIn('sched-fail');
  picpony.get_tag_subscriptions = { success: false, error: '服务暂不可用' };
  const failed = await sync.syncTagSubscriptionsNow('sched-fail', () => 2_000_000);
  assert.deepEqual(failed, { ok: false, updatedTags: 0 });
  assert.equal(sync.periodicSyncDue('sched-fail', 2_000_000 + 1000), false, 'a failed try waits a minute');
  assert.equal(sync.periodicSyncDue('sched-fail', 2_000_000 + sync.SYNC_MIN_GAP_MS), true);
  assert.equal(derpiCalls().length, 0, 'no list, no Derpibooru reads');
});

test('an empty list is a finished run with nothing sent', async () => {
  signIn('empty');
  picpony.get_tag_subscriptions = { success: true, subscriptions: [] };
  assert.deepEqual(await sync.syncTagSubscriptionsNow('empty', () => 3_000_000), { ok: true, updatedTags: 0 });
  assert.equal(calls.length, 1);
  assert.equal(sessionValues.get('tag_subscription_sync_v2_empty'), '3000000');
});

test('a rate limit ends the run’s reads; the batches already read still count', async () => {
  signIn('limited');
  for (let index = 0; index < 60; index += 1) TAGS.set(`tag ${index}`, { slug: `tag+${index}`, images: 1 });
  picpony.get_tag_subscriptions = { success: true, subscriptions: subscriptions(120) };
  picpony.sync_tag_subscriptions = { success: true };
  picpony.finalize_tag_subscription_sync = { success: true, updated_tags: 0 };
  let reads = 0;
  derpi = (url) => {
    reads += 1;
    if (reads === 2) return new Response('{}', { status: 429, headers: { 'content-type': 'application/json' } });
    const rows = url.searchParams.get('q').split(' OR ').map((term) => unescape(term.slice('name:'.length)))
      .filter((name) => TAGS.has(name)).map(row);
    return Response.json({ tags: rows, total: rows.length });
  };
  const result = await sync.syncTagSubscriptionsNow('limited', () => 4_000_000);
  assert.equal(result.ok, true);
  assert.equal(reads, 2, 'the third fifty was never asked for');
  assert.equal(picponyCalls('sync_tag_subscriptions').length, 1, 'the first batch was reported');
  assert.equal(picponyCalls('finalize_tag_subscription_sync').length, 1);
  for (let index = 0; index < 60; index += 1) TAGS.delete(`tag ${index}`);
});

test('a sign-out midway stops the run before it writes again', async () => {
  signIn('leaving');
  TAGS.set('tag 0', { slug: 'tag+0', images: 5 });
  picpony.get_tag_subscriptions = { success: true, subscriptions: subscriptions(1) };
  picpony.sync_tag_subscriptions = { success: true };
  picpony.finalize_tag_subscription_sync = { success: true, updated_tags: 1 };
  const inner = derpi;
  derpi = (url) => {
    values.delete('user_info');
    return inner(url);
  };
  assert.deepEqual(await sync.syncTagSubscriptionsNow('leaving', () => 6_000_000), { ok: false, updatedTags: 0 });
  assert.equal(picponyCalls('sync_tag_subscriptions').length, 0);
  assert.equal(picponyCalls('finalize_tag_subscription_sync').length, 0);
  assert.equal(sessionValues.get('tag_subscription_sync_v2_leaving'), undefined, 'not stamped');
  TAGS.delete('tag 0');
});

test('a list that failed once does not block the next run (G3-017)', async () => {
  signIn('once-failed');
  picpony.get_tag_subscriptions = { success: false, error: '服务暂不可用' };
  assert.deepEqual(await sync.syncTagSubscriptionsNow('once-failed', () => 7_000_000), { ok: false, updatedTags: 0 });
  picpony.get_tag_subscriptions = { success: true, subscriptions: [] };
  assert.deepEqual(await sync.syncTagSubscriptionsNow('once-failed', () => 7_100_000), { ok: true, updatedTags: 0 },
    'the failed read is retried, not taken for the answer');
  assert.equal(picponyCalls('get_tag_subscriptions').length, 2);
  assert.equal(sessionValues.get('tag_subscription_sync_v2_once-failed'), '7100000');
});

test('a sign-out during finalize writes nothing more for that account (G3-023)', async () => {
  signIn('finalize-leave');
  TAGS.set('tag 0', { slug: 'tag+0', images: 6 });
  picpony.get_tag_subscriptions = { success: true, subscriptions: subscriptions(1) };
  picpony.sync_tag_subscriptions = { success: true };
  picpony.finalize_tag_subscription_sync = () => {
    values.delete('user_info');
    return Response.json({ success: true, updated_tags: 1 });
  };
  assert.deepEqual(await sync.syncTagSubscriptionsNow('finalize-leave', () => 8_000_000), { ok: true, updatedTags: 1 });
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(sessionValues.get('tag_subscription_sync_v2_finalize-leave'), undefined, 'not stamped');
  assert.equal(picponyCalls('get_tag_subscriptions').length, 1, 'no forced re-read for a signed-out account');
  TAGS.delete('tag 0');
});

test('a scheduled attempt never rejects, whatever its handler does (G3-016)', async () => {
  signIn('attempt');
  picpony.get_tag_subscriptions = { success: true, subscriptions: [] };
  const unhandled = [];
  const onUnhandled = (reason) => unhandled.push(reason);
  process.on('unhandledRejection', onUnhandled);
  try {
    let seen = null;
    await sync.attemptSync('attempt', (result) => {
      seen = result;
      throw new Error('the toast failed');
    });
    assert.deepEqual(seen, { ok: true, updatedTags: 0 });
    await new Promise((resolve) => setTimeout(resolve, 20));
    assert.deepEqual(unhandled, []);
  } finally {
    process.off('unhandledRejection', onUnhandled);
  }
});

test('two calls for one account share a run', async () => {
  signIn('shared');
  picpony.get_tag_subscriptions = { success: true, subscriptions: [] };
  const first = sync.syncTagSubscriptionsNow('shared');
  const second = sync.syncTagSubscriptionsNow('shared');
  assert.equal(first, second);
  await first;
  assert.equal(picponyCalls('get_tag_subscriptions').length, 1);
});

test('the gallery reads one literal term, newest first, inside the device’s exclusions', async () => {
  const seen = [];
  derpi = (url) => {
    seen.push(url);
    return Response.json({ images: [], total: 0, interactions: [] });
  };
  await catalogue.tagGallery.read({ tag: 'oc:nyx (pony)', page: 2, perPage: 24, contentFilter: 'safe', fp: 'x' });
  const [url] = seen;
  assert.equal(url.pathname, '/api/v1/json/search/images');
  assert.ok(url.searchParams.get('q').startsWith(`(${escapeTag('oc:nyx (pony)')})`), url.searchParams.get('q'));
  assert.equal(url.searchParams.get('page'), '2');
  assert.equal(url.searchParams.get('per_page'), '24');
});

// --- what a subscriber is told ----------------------------------------------------------------

const { formatCount } = await import('../lib/format.ts');

test('a subscribe says what happened, in the original’s words where it had them', () => {
  assert.deepEqual(actions.subscribeMessage({ kind: 'done', tagName: 'fluttershy', count: 290010, aliasOf: null }),
    [`已订阅「fluttershy」，当前记录 ${formatCount(290010)} 张图片`, 'success']);
  assert.deepEqual(actions.subscribeMessage({ kind: 'done', tagName: 'rainbow dash', count: 315460, aliasOf: 'rd' }),
    ['「rd」是「rainbow dash」的别名，已订阅「rainbow dash」', 'success']);
  assert.deepEqual(actions.subscribeMessage({ kind: 'exists', tagName: 'oc:nyx' }), ['标签「oc:nyx」已在订阅中', 'warning']);
  assert.deepEqual(actions.subscribeMessage({ kind: 'not-found' }), [api.TAG_NOT_FOUND_MESSAGE, 'warning']);
  assert.deepEqual(actions.subscribeMessage({ kind: 'failed', message: '请求过于频繁，请稍后再试' }),
    ['订阅失败：请求过于频繁，请稍后再试', 'error']);
});

test('a failure says what failed once, even when the backend’s words already do', () => {
  assert.equal(actions.failureSentence('取消订阅失败', '网络连接失败，请检查网络后再试'), '取消订阅失败：网络连接失败，请检查网络后再试');
  assert.equal(actions.failureSentence('取消订阅失败', '取消订阅失败，请稍后再试'), '取消订阅失败，请稍后再试');
  assert.equal(actions.failureSentence('订阅失败', '订阅失败'), '订阅失败');
});

test('a subscription is found as Derpibooru matches names', () => {
  const list = [{ tagName: 'Rainbow  Dash', imageCount: 1, newCount: 0 }];
  assert.equal(actions.findSubscription(list, 'rainbow dash'), list[0]);
  assert.equal(actions.findSubscription(list, 'fluttershy'), undefined);
  assert.equal(actions.findSubscription(undefined, 'x'), undefined);
});

// --- a tag's name slot --------------------------------------------------------------------------

const names = await import('../components/subscriptions/useTagNames.ts');

test('a name slot is asked for, then named or the tag itself — and an answer once had is kept (M1-017)', () => {
  const known = (patch = {}) => ({ enabled: true, peeked: {}, answers: {}, waited: new Set(), ...patch });
  // still asking: the slot holds a placeholder
  assert.equal(names.tagNameOf('Rainbow Dash', known()), undefined);
  // answered: the name, keyed as the dictionary keys it (namespace off, lower case)
  assert.equal(names.tagNameOf('Rainbow Dash', known({ answers: { 'rainbow dash': ' 云宝 ' } })), '云宝');
  assert.equal(names.tagNameOf('oc:Nyx', known({ answers: { nyx: '妮克丝' } })), '妮克丝');
  // the dictionary has none, or its wait ran out: the tag reads as itself
  assert.equal(names.tagNameOf('cute', known({ answers: { cute: null } })), null);
  assert.equal(names.tagNameOf('cute', known({ waited: new Set(['cute']) })), null);
  // a cached miss is an answer: never waited for, and an older name does not override it
  assert.equal(names.tagNameOf('cute', known({ peeked: { cute: null }, answers: { cute: '可爱' } })), null);
  assert.equal(names.tagNameOf('cute', known({ peeked: { cute: '可爱' } })), '可爱');
  // a late answer replaces the tag the wait put there
  assert.equal(names.tagNameOf('cute', known({ waited: new Set(['cute']), answers: { cute: '可爱' } })), '可爱');
  // a row on its way out is no longer among the tags peeked, and keeps the name it had
  assert.equal(names.tagNameOf('Rainbow Dash', known({ peeked: { fluttershy: '小蝶' }, answers: { 'rainbow dash': '云宝' } })), '云宝');
  // names off: always the tag; and no tag named like an object's own members reads as a name
  assert.equal(names.tagNameOf('Rainbow Dash', known({ enabled: false, answers: { 'rainbow dash': '云宝' } })), null);
  assert.equal(names.tagNameOf('constructor', known()), undefined);
  assert.equal(names.tagNameOf('toString', known({ waited: new Set(['tostring']) })), null);
});

test('review P4-F5: a run that could read no counts at all is a failed run — not finalised, not stamped', async () => {
  signIn('unread');
  picpony.get_tag_subscriptions = { success: true, subscriptions: subscriptions(2) };
  picpony.sync_tag_subscriptions = { success: true };
  picpony.finalize_tag_subscription_sync = { success: true, updated_tags: 0 };
  derpi = () => new Response('busy', { status: 503 });
  assert.deepEqual(await sync.syncTagSubscriptionsNow('unread', () => 7_000_000), { ok: false, updatedTags: 0 });
  assert.equal(picponyCalls('finalize_tag_subscription_sync').length, 0, 'nothing reported, nothing to finalise');
  assert.equal(sessionValues.get('tag_subscription_sync_v2_unread'), undefined, 'not stamped as a finished run');
  assert.equal(sync.periodicSyncDue('unread', 7_000_000 + sync.SYNC_MIN_GAP_MS), true, 'retried after a minute, not ten');
});
