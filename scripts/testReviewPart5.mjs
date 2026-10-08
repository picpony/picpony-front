/**
 * Regression cases for review part 5 (profiles, settings, history, tasks, about and policy, the
 * assistant, the mascot and the desktop ponies), with no live service: each test names the finding
 * it pins (`P5-Fn` in `part5-review.md`). P5-F1 lives with the cross-tab sync's own cases in
 * `testSettingsSyncTabs.mjs`.
 */
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { requireTypeStripping } from './tsResolve.mjs';

requireTypeStripping('testReviewPart5');

const values = new Map();
globalThis.localStorage = {
  getItem: (key) => (values.has(key) ? values.get(key) : null),
  setItem: (key, value) => values.set(key, String(value)),
  removeItem: (key) => values.delete(key),
};
globalThis.window = {
  addEventListener() {}, removeEventListener() {},
  dispatchEvent() { return true; },
  setTimeout: (...args) => setTimeout(...args),
  clearTimeout: (...args) => clearTimeout(...args),
  matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }),
  location: { origin: 'https://app.invalid', pathname: '/' },
  __picponyRoutePolicy: { api: 'direct', image: 'direct' },
  /* `app/settings/tabs.ts` imports `lib/historyLayers.ts`, which wraps the history writers on load. */
  history: { state: null, length: 1, pushState() {}, replaceState() {}, back() {}, go() {} },
};
globalThis.document = { visibilityState: 'visible', hidden: false, cookie: '', addEventListener() {}, removeEventListener() {} };

const { API_KEY_PATTERN } = await import('../app/settings/identity.ts');
const { settingsHref } = await import('../app/settings/tabs.ts');
const { uploaderTerm } = await import('../lib/profiles.ts');
const { buildSearchQueryFrom } = await import('../lib/searchQuery.ts');
const { philomenaSlug, derpiProfileUrl, derpiFallbackUrl } = await import('../app/derpi/user/[id]/derpiLinks.ts');
const { createActionRunner, UncertainAction } = await import('../lib/assistant/runner.ts');
const { createReceiptJournal } = await import('../lib/assistant/journal.ts');

const source = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

test('P5-F2: the settings field accepts exactly the keys Derpibooru mints, and only keys the upload hop takes', () => {
  const hop = source('app/upload/submit/route.ts');
  const keyOk = new RegExp(/const KEY_OK = \/(.+)\/;/.exec(hop)[1]);
  /* Philomena: `:crypto.strong_rand_bytes(15) |> Base.url_encode64()`. */
  for (let i = 0; i < 500; i += 1) {
    const key = randomBytes(15).toString('base64url');
    assert.equal(key.length, 20);
    assert.ok(API_KEY_PATTERN.test(key), key);
    assert.ok(keyOk.test(key), key);
  }
  for (const key of ['abcdefghij+lmnopqrst', 'abcdefghij.lmnopqrst', 'abcdefghij lmnopqrst', 'abcdefghij/lmnopqrst', 'abcdefghijklmnopqrs', 'abcdefghijklmnopqrstu']) {
    assert.equal(API_KEY_PATTERN.test(key), false, key);
  }
  /* Whatever the field lets through, the hop takes. */
  for (const key of ['A'.repeat(20), '-_'.repeat(10), 'a1B2c3D4e5F6g7H8i9J0']) {
    assert.ok(API_KEY_PATTERN.test(key) && keyOk.test(key), key);
  }
});

test('P5-F3: the profile sends its owner to 账户 for what lives there, never the bare address', () => {
  assert.equal(settingsHref('account'), '/settings?tab=account');
  for (const path of ['app/user/[id]/ProfileHeader.tsx', 'app/user/[id]/ProfilePaneStates.tsx', 'app/user/[id]/UploadsPane.tsx']) {
    const text = source(path);
    assert.doesNotMatch(text, /href="\/settings"|'\/settings'/, path);
    assert.match(text, /settingsHref\('account'\)/, path);
  }
});

// ---------------------------------------------------------------------------------------------
// P5-F4 — Philomena's lexer, as ported for P4-F1 (`testReviewPart4.mjs`): where terms end.
// ---------------------------------------------------------------------------------------------

const OPERATOR = /^\s+(?:AND|OR|&&|\|\|)\s+/;
const STOP = (s, i) => s[i] === ',' || OPERATOR.test(s.slice(i)) || /^\s*\)/.test(s.slice(i)) || /^\s*\^[-+]?\d/.test(s.slice(i));

/** `dirty_text` from `i`: the end of the term's text, or -1 when it matches nothing. */
function dirtyText(s, i) {
  let k = i;
  for (;;) {
    if (k >= s.length || STOP(s, k)) break;
    const ch = s[k];
    if (ch === '\\') {
      k += k + 1 < s.length ? 2 : 1;
      continue;
    }
    if (ch === '(') {
      const inner = dirtyText(s, k + 1);
      if (inner !== -1 && s[inner] === ')') {
        k = inner + 1;
        continue;
      }
      break;
    }
    if (ch === ')') break;
    k += 1;
  }
  return k > i ? k : -1;
}

/** The lexer's tokens with their offsets; `null` where Philomena's lexer would fail. */
function lex(s) {
  const tokens = [];
  let i = 0;
  while (i < s.length) {
    const rest = s.slice(i);
    if (s[i] === ',') { tokens.push({ type: 'and', at: i }); i += 1; continue; }
    if (s[i] === '!' || s[i] === '-') { tokens.push({ type: 'not', at: i }); i += 1; continue; }
    const operator = OPERATOR.exec(rest);
    if (operator) { tokens.push({ type: /OR|\|\|/.test(operator[0]) ? 'or' : 'and', at: i }); i += operator[0].length; continue; }
    const not = /^NOT\s+/.exec(rest);
    if (not) { tokens.push({ type: 'not', at: i }); i += not[0].length; continue; }
    if (s[i] === '(') { tokens.push({ type: 'lparen', at: i }); i += 1; continue; }
    if (s[i] === ')') { tokens.push({ type: 'rparen', at: i }); i += 1; continue; }
    const boost = /^\^[-+]?\d+(?:\.\d+)?/.exec(rest);
    if (boost) { i += boost[0].length; continue; }
    if (/\s/.test(s[i])) { i += 1; continue; }
    if (s[i] === '"') {
      let j = i + 1;
      let closed = -1;
      while (j < s.length) {
        if (s[j] === '\\') { j += j + 1 < s.length ? 2 : 1; continue; }
        if (s[j] === '"') { closed = j; break; }
        j += 1;
      }
      if (closed !== -1) { tokens.push({ type: 'term', at: i }); i = closed + 1; continue; }
    }
    const end = dirtyText(s, i);
    if (end === -1) return null;
    tokens.push({ type: 'term', at: i });
    i = end;
  }
  return tokens;
}

/** Whether, in `(<scoped>), -explicit`, Philomena closes the opening group exactly at our `)`. */
function groupHolds(scoped) {
  const tokens = lex(`(${scoped}), -explicit`);
  if (!tokens) return true;
  let depth = 0;
  for (const token of tokens) {
    if (token.type === 'lparen') depth += 1;
    if (token.type === 'rparen') {
      depth -= 1;
      if (depth === 0) return token.at === scoped.length + 1;
    }
  }
  return true;
}

test('P5-F4: a bound name is one literal term, whatever it contains', () => {
  const names = ['a, b', 'x OR y', 'p AND q', 'p && q', 'p || q', 'x OR (y', 'NOT z', 'Foo Bar', 'tab\there', 'a,b,c', 'safe) OR (explicit', '"quoted", name'];
  for (const name of names) {
    const term = uploaderTerm({ id: 1, username: 'u', derpi_username: name, has_api_key: true });
    const tokens = lex(term);
    assert.ok(tokens, `${name} lexes`);
    assert.deepEqual(tokens.map((token) => token.type), ['term'], `${JSON.stringify(name)} → ${term}`);
    /* Wrapped in the viewer's exclusions as the uploads read does, the group still closes on ours. */
    const query = decodeURIComponent(buildSearchQueryFrom({ contentFilter: 'safe', banAnthro: false, onlyPony: false, hiddenTags: [] }, term));
    assert.ok(query.startsWith(`(${term})`), query);
    assert.ok(groupHolds(term), query);
  }
  /* The unescaped spellings the term used to produce are several terms: what P5-F4 is. */
  assert.deepEqual(lex('uploader:a, b').map((t) => t.type), ['term', 'and', 'term']);
  assert.deepEqual(lex('uploader:x OR y').map((t) => t.type), ['term', 'or', 'term']);
  /* An id is still preferred, and needs nothing escaped. */
  assert.equal(uploaderTerm({ id: 1, username: 'u', derpi_user_id: 9, derpi_username: 'a, b', has_api_key: true }), 'uploader_id:9');
});

test('P5-F5: the Derpibooru profile link is the slug the site keys it by', () => {
  assert.equal(philomenaSlug('Background Pony'), 'Background+Pony');
  assert.equal(philomenaSlug('a.b-c/d\\e:f+g'), 'a-dot-b-dash-c-fwslash-d-bwslash-e-colon-f-plus-g');
  assert.equal(derpiProfileUrl({ name: 'Foo Bar' }), 'https://derpibooru.org/profiles/Foo+Bar');
  assert.equal(derpiProfileUrl({ name: 'Mr. X' }), 'https://derpibooru.org/profiles/Mr-dot-+X');
  assert.equal(derpiProfileUrl({ name: '小马 迷' }), `https://derpibooru.org/profiles/${encodeURIComponent('小马')}+${encodeURIComponent('迷')}`);
  /* The API's own slug wins over one made from the name. */
  assert.equal(derpiProfileUrl({ name: 'Renamed', slug: 'old-dash-slug' }), 'https://derpibooru.org/profiles/old-dash-slug');
  /* An id is not a slug: the failure state offers the account's uploads instead. */
  assert.equal(derpiFallbackUrl('583672'), 'https://derpibooru.org/search?q=uploader_id%3A583672');
  assert.equal(derpiFallbackUrl('Foo Bar'), 'https://derpibooru.org/profiles/Foo+Bar');
  const page = source('app/derpi/user/[id]/page.tsx');
  assert.doesNotMatch(page, /derpibooru\.org\/profiles\/\$\{encodeURIComponent/);
});

function runnerFixture() {
  const stored = new Map();
  const storage = { getItem: (k) => stored.get(k) ?? null, setItem: (k, v) => stored.set(k, v), removeItem: (k) => stored.delete(k) };
  const journal = createReceiptJournal(storage, '1');
  const counts = { dispatch: 0 };
  const deps = {
    assertCurrent() {},
    permission: async () => 'default',
    claim: async () => ({ success: true, request: { endpoint: 'get_tasks', method: 'GET', query: {} } }),
    save: async (receipt) => ({ success: true, result: receipt }),
    dispatch: async () => { counts.dispatch += 1; return { ok: true, summary: '已读取', data: {} }; },
    journal, failure: (error) => error.message, definitive: () => false,
  };
  return { deps, journal, counts };
}

test('P5-F6: a read left started by a lost page is asked again; a write left started is not', async () => {
  const f = runnerFixture();
  const read = { name: 'open_image', arguments: { image_id: 5 }, call_id: 'read-1', risk: 'read', approval_granted: false };
  f.journal.start(10, 'read-1');
  const result = await createActionRunner(f.deps).run(read, 10);
  assert.equal(result.ok, true);
  assert.equal(f.counts.dispatch, 1);
  /* A claimed read (a site read through the server's claim) likewise. */
  const siteRead = { name: 'call_site_api', arguments: { endpoint: 'get_tasks' }, call_id: 'read-2', risk: 'read', approval_granted: false };
  f.journal.start(10, 'read-2');
  assert.equal((await createActionRunner(f.deps).run(siteRead, 10)).ok, true);
  assert.equal(f.counts.dispatch, 2);
  /* The server's own word that a claim is still pending stands for a read too. */
  f.deps.claim = async () => ({ success: true, pending: true });
  await assert.rejects(createActionRunner(f.deps).run({ ...siteRead, call_id: 'read-3' }, 10), UncertainAction);
  /* A write keeps its guard: a recorded start is never permission to send it again. */
  const write = { name: 'call_site_api', arguments: { endpoint: 'claim_task', parameters: { task_type: 'login' } }, call_id: 'write-1', risk: 'write', approval_granted: false };
  f.deps.claim = async () => ({ success: true, request: { endpoint: 'claim_task', method: 'POST', body: { task_type: 'login' } } });
  f.journal.start(10, 'write-1');
  await assert.rejects(createActionRunner(f.deps).run(write, 10, true), UncertainAction);
  const nav = { name: 'toggle_unknown_write', arguments: {}, call_id: 'write-2', risk: 'write', approval_granted: false };
  f.journal.start(10, 'write-2');
  await assert.rejects(createActionRunner(f.deps).run(nav, 10, true), UncertainAction);
  assert.equal(f.counts.dispatch, 2);
});

test('P5-F7: the one synced row under 仅保存在本设备 says that it follows the account', () => {
  const text = source('app/settings/AppearanceSection.tsx');
  assert.match(text, /label="入场动画"\s+description="此项随账号同步到你登录的设备"/);
});
