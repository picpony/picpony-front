/** D2's pure models and upload transport contracts. Every request is an in-process fixture. */
import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { requireTypeStripping } from './tsResolve.mjs';
requireTypeStripping('testPersonalScreens');
const originalFetch = globalThis.fetch;
globalThis.fetch = async () => { throw new Error('Unstubbed network request'); };
after(() => { globalThis.fetch = originalFetch; });
const history = await import('../lib/api/history.ts');
const tasks = await import('../lib/api/tasks.ts');
const groups = await import('../lib/api/blockGroups.ts');
const tags = await import('../lib/api/tagGroups.ts');
const upload = await import('../lib/api/upload.ts');
const { FlutedGlassTrail } = await import('../lib/flutedGlassTrail.ts');
const { POST } = await import('../app/upload/submit/route.ts');

test('history reads the backend’s rows and its UTC stamps, versions every write, and refuses a failed read', async () => {
  assert.equal(history.utcStamp('2026-10-01 12:00:00'), '2026-10-01T12:00:00Z');
  const row = { image_id: 7, preview_url: '', uploader: '匿名', viewed_at: '2026-10-01T12:00:00Z', previous_viewed_at: null };
  assert.deepEqual(history.historyEntryOf(row), { id: 7, previewUrl: null, uploader: '匿名', viewedAt: '2026-10-01T12:00:00Z' });
  globalThis.fetch = async () => Response.json({ error: { code: 'DATABASE_UNAVAILABLE', message: '数据库暂时不可用' } }, { status: 503 });
  await assert.rejects(history.getBrowsingHistory('fixture'), (error) => error.status === 503);
  /* The list's revision is what the delete names; a conflict reads it again and sends once more, under a new key. */
  const sent = [];
  let revision = 4;
  globalThis.fetch = async (url, init = {}) => {
    const target = new URL(url, 'https://fixture.invalid');
    sent.push({ method: init.method ?? 'GET', path: target.pathname, body: init.body ? JSON.parse(init.body) : null, key: new Headers(init.headers).get('Idempotency-Key') });
    if ((init.method ?? 'GET') === 'GET') return Response.json({ revision, entries: [row], page: 1, limit: 50, total_count: 1, total_pages: 1, date: null, time_zone: 'Asia/Shanghai' });
    const body = JSON.parse(init.body);
    if (body.expected_revision !== revision) return Response.json({ error: { code: 'HISTORY_CONFLICT', message: '浏览历史已在其他页面更新' } }, { status: 409 });
    revision += 1;
    return Response.json({ applied_revision: revision, current_revision: revision, already_applied: false, changed: true, deleted_count: 1 });
  };
  assert.deepEqual((await history.getBrowsingHistory('versioned')).entries.map((entry) => entry.id), [7]);
  revision = 6; // Another tab opened two pictures since.
  await history.deleteBrowsingHistoryItem('versioned', 7);
  await history.clearBrowsingHistory('versioned');
  assert.deepEqual(sent.map((r) => [r.method, r.path, r.body?.expected_revision ?? null]), [
    ['GET', '/api/v1/me/browsing-history', null],
    ['DELETE', '/api/v1/me/browsing-history/7', 4],
    ['GET', '/api/v1/me/browsing-history', null],
    ['DELETE', '/api/v1/me/browsing-history/7', 6],
    ['DELETE', '/api/v1/me/browsing-history', 7],
  ]);
  assert.ok(sent[1].key && sent[3].key && sent[1].key !== sent[3].key);
});
test('the task document is the backend’s, by category; a category it does not carry is null', () => {
  const task = (name, progress, required, claimed = false) => ({ task: name, period: 'p', progress, required, claimed, reward: { coins: 1, experience: 1 } });
  const doc = tasks.taskDocumentOf({
    tasks: [task('login', 1, 1, true), task('weekly_upload', 2, 5), task('novice_set_bg', 0, 1), task('unknown', 9, 9)],
    coins: 7, experience: 250, level: 3,
  });
  assert.deepEqual([doc.level, doc.experience, doc.coins], [3, 250, 7]);
  assert.deepEqual(doc.progress.daily, { login: { progress: 1, required: 1, claimed: true } });
  assert.deepEqual(doc.progress.weekly, { upload: { progress: 2, required: 5, claimed: false } }, 'the server’s own weekly count');
  assert.deepEqual(doc.progress.novice, { set_bg: { progress: 0, required: 1, claimed: false } });
  assert.deepEqual(tasks.taskDocumentOf({ tasks: [], coins: 0, experience: 0, level: 1 }).progress, { novice: null, daily: null, weekly: null });
});
test('block and tag groups read the backend’s rows; a Derpibooru tag list is normalised; queries keep their syntax', async () => {
  globalThis.fetch = async () => Response.json({ groups: [{ id: 3, name: 'x', hidden_tags: ['pony'], spoilered_tags: ['cute'], active: true, revision: 2, created_at: '2026-01-01T00:00:00Z' }] });
  assert.deepEqual(await groups.getBlockGroups('fixture'), [{ id: 3, name: 'x', hidden_tags: ['pony'], spoilered_tags: ['cute'], active: true, revision: 2 }]);
  assert.deepEqual(groups.tagList('Pony, cute, pony'), ['pony', 'cute']);
  assert.equal(tags.tagGroupQuery(['pony', 'princess luna (season 1)']), 'pony, "princess luna (season 1)"');
});
test('group saves: a new one is a POST, an edit a PUT with its revision; a block edit keeps its switch', async () => {
  const sent = [];
  globalThis.fetch = async (url, init) => {
    sent.push([init.method, new URL(url, 'https://fixture.invalid').pathname, JSON.parse(init.body)]);
    return Response.json({ id: 8, revision: init.method === 'POST' ? 0 : 3 }, { status: init.method === 'POST' ? 201 : 200 });
  };
  assert.deepEqual(await tags.saveTagGroup('fixture', { name: '组合', tags: ['pony'] }), { id: 8, revision: 0 });
  assert.deepEqual(await tags.saveTagGroup('fixture', { id: 8, revision: 2, name: '组合', tags: ['pony'] }), { id: 8, revision: 3 });
  await groups.saveBlockGroup('fixture', { id: 8, revision: 2, active: false, name: 'g', hidden: ['a'], spoilered: [] });
  await groups.toggleBlockGroup('fixture', 8, true, 3);
  assert.deepEqual(sent, [
    ['POST', '/api/v1/me/tag-groups', { name: '组合', tags: ['pony'] }],
    ['PUT', '/api/v1/me/tag-groups/8', { name: '组合', tags: ['pony'], expected_revision: 2 }],
    ['PUT', '/api/v1/me/block-groups/8', { name: 'g', hidden_tags: ['a'], spoilered_tags: [], active: false, expected_revision: 2 }],
    ['PUT', '/api/v1/me/block-groups/8/activation', { active: true, expected_revision: 3 }],
  ]);
});
test('the upload submit hop rebuilds the fixed-target JSON contract', async () => {
  let sent;
  globalThis.fetch = async (url, init) => { sent = { url: String(url), init }; return Response.json({ image: { id: 123 } }); };
  const req = new Request('https://app.invalid/upload/submit', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ key: 'fixtureKey123', url: 'https://picpony.top/uploads/fixture.png', tag_input: 'safe, pony, cute', xp_user: 'fixture' }) });
  const res = await POST(req);
  assert.equal(res.status, 200);
  const target = new URL(new URL(sent.url).searchParams.get('url'));
  assert.equal(target.origin, 'https://derpibooru.org');
  assert.equal(target.pathname, '/api/v1/json/images');
  assert.equal(target.searchParams.get('key'), 'fixtureKey123');
  assert.deepEqual(JSON.parse(sent.init.body), { image: { tag_input: 'safe, pony, cute' }, url: 'https://picpony.top/uploads/fixture.png' });
  assert.equal(sent.init.redirect, 'manual');
});
test('invalid upload input sends nothing, and lost success is unconfirmed', async () => {
  let count = 0;
  globalThis.fetch = async () => { count++; return Response.json({ success: true }); };
  const res = await POST(new Request('https://app.invalid/upload/submit', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }));
  assert.equal(res.status, 400); assert.equal(count, 0);
  const result = await upload.submitDerpiImage({ apiKey: 'fixtureKey123', url: 'https://example.test/x.png', tagInput: 'safe, pony, cute' });
  assert.equal(result.kind, 'unconfirmed'); assert.equal(count, 1);
});
test('upload field errors map to the form without claiming success', () => {
  assert.deepEqual(upload.uploadErrorsOf({ errors: { tag_input: ['must contain a rating tag'] } }), { tags: '需要且只能有一个分级标签' });
});
test('an empty trail does no work; a stroke decays to a stable resting texture', () => {
  const trail = new FlutedGlassTrail();
  assert.equal(trail.resting, true); assert.equal(trail.step(0.016), false);
  trail.move(0.2, 0.5); trail.step(0.016);
  for (let i = 0; i < 20; i++) { trail.move(0.2 + i * 0.02, 0.5); trail.step(0.016); }
  assert.equal(trail.resting, false);
  trail.leave();
  for (let i = 0; i < 3000 && !trail.resting; i++) trail.step(0.016);
  assert.equal(trail.resting, true);
  const pixels = trail.pixels.slice();
  assert.equal(trail.step(0.2), false); assert.deepEqual(trail.pixels, pixels);
  trail.clear(); assert.equal(trail.resting, true);
});

/* G4-028: a pruning the browser refuses to store must say so — the picker keeps its selection and
   toasts instead of clearing it as if the tags had gone. */
test('pending-tag removal and clearing report a refused write and leave the library as it was', async () => {
  const stored = new Map([['pending_tags', JSON.stringify(['pony', 'cute', 'oc'])]]);
  let refuse = false;
  globalThis.window = { addEventListener() {}, removeEventListener() {} };
  globalThis.localStorage = {
    getItem: (key) => stored.get(key) ?? null,
    setItem: (key, value) => { if (refuse) throw new DOMException('blocked', 'SecurityError'); stored.set(key, value); },
    removeItem: (key) => { if (refuse) throw new DOMException('blocked', 'SecurityError'); stored.delete(key); },
  };
  try {
    const pending = await import('../lib/pendingTags.ts');
    assert.deepEqual([...pending.readPendingTags()], ['pony', 'cute', 'oc']);
    refuse = true;
    assert.equal(pending.removePendingTags(['cute']), false);
    assert.equal(pending.clearPendingTags(), false);
    assert.deepEqual([...pending.readPendingTags()], ['pony', 'cute', 'oc'], 'a refused write changes nothing');
    refuse = false;
    assert.equal(pending.removePendingTags(['cute']), true);
    assert.deepEqual([...pending.readPendingTags()], ['pony', 'oc']);
    assert.equal(pending.clearPendingTags(), true);
    assert.deepEqual([...pending.readPendingTags()], []);
  } finally {
    delete globalThis.window;
    delete globalThis.localStorage;
  }
});

test('the coin ledger is paged by the backend: the remembered page is the page read', async () => {
  const { readFileSync } = await import('node:fs');
  const vm = await import('node:vm');
  const ts = (await import('typescript')).default;
  const code = ts.transpileModule(readFileSync(new URL('../app/tasks/coins/CoinLedger.tsx', import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  const reads = [];
  const exports = {};
  const jsx = (type, props) => ({ type, props });
  const dependencies = {
    react: { useEffect() {}, useMemo: (create) => create() },
    'react/jsx-runtime': { jsx, jsxs: jsx, Fragment: 'Fragment' },
    '@/lib/screenState': { useScreenState: (key, initial) => [key === 'coins:page' ? 3 : initial, () => {}] },
    '@/lib/resource': {
      SKIP: 'SKIP',
      useResource: (_resource, args) => { reads.push(args); return { data: undefined, error: undefined, isLoading: true, isPrevious: false, refresh() {} }; },
    },
    '@/lib/hooks': { useSession: () => ({ user: null, token: 'fixture', ready: true }), useEscapeBack() {}, useNow: () => null },
    '@/lib/backNavigation': { useBackOrParent: () => () => {} },
  };
  vm.runInNewContext(code, {
    exports,
    require: (name) => dependencies[name] ?? new Proxy({}, { get: (_, key) => (key === '__esModule' ? true : `${name}:${String(key)}`) }),
  }, { filename: 'app/tasks/coins/CoinLedger.tsx' });
  exports.default();
  assert.deepEqual({ ...reads[0] }, { token: 'fixture', page: 3 });
});

test('the coin ledger reads by cursor: page 2 starts where page 1 ended', async () => {
  const asked = [];
  globalThis.fetch = async (url) => {
    const target = new URL(String(url), 'https://app.invalid');
    asked.push(target);
    const before = target.searchParams.get('before');
    const row = (id) => ({ id, amount: -5, balance_after: 10, reason: ' 购买 ', source_type: 'checkout', source_id: 'c', created_at: '2026-10-01T00:00:00Z' });
    return Response.json(before === null
      ? { transactions: [row(9), row(8)], next_cursor: 8 }
      : { transactions: [row(7)], next_cursor: null });
  };
  const first = await tasks.getCoinTransactions('ledger', 1);
  assert.equal(asked[0].pathname, '/api/v1/me/coins/transactions');
  assert.equal(first.totalPages, 2, 'one more page is known to exist');
  assert.deepEqual(first.transactions[0], { key: '9', amount: -5, balanceAfter: 10, reason: '购买', createdAt: '2026-10-01T00:00:00Z' });
  const second = await tasks.getCoinTransactions('ledger', 2);
  assert.equal(asked[1].searchParams.get('before'), '8');
  assert.deepEqual([second.transactions.map((row) => row.key), second.totalPages], [['7'], 2]);
});
test('浏览历史 is walked in the order the screen shows it: day group by day group', async () => {
  const { byDay, readingOrder } = await import('../app/history/days.ts');
  const row = (id, viewedAt) => ({ id, previewUrl: null, uploader: null, viewedAt });
  /* A page whose days are not contiguous and whose undated rows are scattered (G4-001's shape):
     the screen regroups them, and 上一张 / 下一张 must visit the rows in that order, not the
     backend's — the next picture is the row under this one on screen (G4-004). */
  const page = [
    row(1, '2026-09-23T15:00:00Z'),
    row(2, null),
    row(3, '2026-09-22T15:00:00Z'),
    row(4, '2026-09-23T14:00:00Z'),
    row(5, null),
  ];
  assert.deepEqual(byDay(page, null).map((day) => day.entries.map((entry) => entry.id)), [[1, 4], [2, 5], [3]]);
  assert.deepEqual(readingOrder(page), [1, 4, 2, 5, 3]);
  assert.deepEqual(readingOrder([]), []);
});


test('upload submit bounds streamed UTF-8 bytes before contacting upstream', async () => {
  let requests = 0;
  globalThis.fetch = async () => { requests++; throw new Error('must not reach upstream'); };
  let cancelled = false;
  /* Past the 512KB cap (review P4-F2 raised it from 128KB to hold every valid form). */
  const bytes = new TextEncoder().encode('马'.repeat(200_000));
  const body = new ReadableStream({
    start(controller) { controller.enqueue(bytes); },
    cancel() { cancelled = true; },
  });
  const response = await POST(new Request('https://app.invalid/upload/submit', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body, duplex: 'half',
  }));
  assert.equal(response.status, 413);
  assert.equal(requests, 0);
  assert.equal(cancelled, true);
});

test('filter imports reject negated or compound expressions instead of reversing their meaning', () => {
  for (const expression of ['NOT "safe"', '-"rainbow dash"', 'NOT (safe OR cute)', 'safe AND cute', 'score.lt:0']) {
    assert.throws(() => groups.complexTerms(expression), /无法转换/);
  }
  assert.deepEqual(groups.complexTerms('safe OR "rainbow dash"'), ['safe', 'rainbow dash']);
  assert.deepEqual(groups.complexTerms('"princess luna (season 1)"'), ['princess luna (season 1)']);
});

test('unknown profile fields never resolve inherited object properties', async () => {
  const fields = await import('../lib/profileFields.ts');
  for (const value of ['__proto__', 'constructor', 'toString']) {
    assert.equal(fields.normalizeGender(value), value);
    assert.equal(fields.normalizeRace(value), value);
    assert.equal(fields.raceLabel(value), value);
  }
});

test('an unusable legacy forum draft is ignored rather than crashing the composer', async () => {
  const saved = new Map();
  globalThis.localStorage = { getItem: (key) => saved.get(key) ?? null, setItem: (key, value) => saved.set(key, value), removeItem: (key) => saved.delete(key) };
  try {
    const drafts = await import('../lib/forumDraft.ts');
    for (const raw of ['null', '[]', '1', '"words"']) {
      saved.set('forum_post_draft', raw);
      assert.equal(drafts.readDraft('fixture', null), null);
    }
    saved.set('forum_post_draft', JSON.stringify({ title: 'kept' }));
    assert.equal(drafts.readDraft('fixture', null).title, 'kept');
  } finally { delete globalThis.localStorage; }
});
