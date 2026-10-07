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

test('history normalizes its UTC columns and refuses a missing list', async () => {
  assert.equal(history.utcStamp('2026-10-01 12:00:00'), '2026-10-01T12:00:00Z');
  assert.equal(history.historyEntryOf({ image_id: '7', view_time: '2026-10-01 12:00:00' }).id, 7);
  assert.equal(history.historyEntryOf({ id: 'bad' }), null);
  globalThis.fetch = async () => Response.json({ success: true });
  await assert.rejects(history.getBrowsingHistory('fixture'));
});
test('task document never fabricates figures or missing categories', () => {
  const empty = tasks.taskDocumentOf({});
  assert.equal(empty.level, null); assert.equal(empty.coins, null);
  assert.deepEqual(empty.progress, { novice: null, daily: null, weekly: null });
  assert.equal(tasks.taskDocumentOf({ level: null, coins: '' }).coins, null);
});
test('block and tag group contracts normalize legacy tag lists and preserve query syntax', () => {
  const row = groups.blockGroupOf({ id: '3', name: 'x', tags: 'Pony, cute, pony', is_active: '1' });
  assert.deepEqual(row.hidden_tags, ['pony', 'cute']);
  assert.equal(row.is_active, 1);
  assert.deepEqual(tags.tagGroupOf({ id: 4, tags: ['Pony', 'pony'] }).tags, ['pony']);
  assert.equal(tags.tagGroupQuery(['pony', 'princess luna (season 1)']), 'pony, "princess luna (season 1)"');
});
test('tag group save sends the original collection discriminator', async () => {
  let sent;
  globalThis.fetch = async (_url, init) => { sent = JSON.parse(init.body); return Response.json({ success: true, id: 8 }); };
  assert.deepEqual(await tags.saveTagGroup('fixture', { name: '组合', tags: ['pony'] }), { id: 8 });
  assert.deepEqual(sent, { id: 0, name: '组合', tags: ['pony'], type: 'collection' });
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

/* G4-027: until the first answer says whether the backend pages the ledger, only page 1 is read —
   on the original's backend that answer is the whole ledger, and a remembered page slices it. */
test('the coin ledger asks for page 1 until it knows the backend pages', async () => {
  const { readFileSync } = await import('node:fs');
  const vm = await import('node:vm');
  const ts = (await import('typescript')).default;
  const code = ts.transpileModule(readFileSync(new URL('../app/tasks/coins/CoinLedger.tsx', import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  const requested = (remembered) => {
    const reads = [];
    const exports = {};
    const jsx = (type, props) => ({ type, props });
    const dependencies = {
      react: { useEffect() {}, useMemo: (create) => create() },
      'react/jsx-runtime': { jsx, jsxs: jsx, Fragment: 'Fragment' },
      '@/lib/screenState': { useScreenState: (key, initial) => [key in remembered ? remembered[key] : initial, () => {}] },
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
    return { ...reads[0] };
  };
  assert.deepEqual(requested({ 'coins:page': 3, 'coins:unpaged': null }), { token: 'fixture', page: 1 }, 'a remembered page, the shape unknown');
  assert.deepEqual(requested({ 'coins:page': 3, 'coins:unpaged': true }), { token: 'fixture', page: 1 }, 'the whole ledger, sliced here');
  assert.deepEqual(requested({ 'coins:page': 3, 'coins:unpaged': false }), { token: 'fixture', page: 3 }, 'a paging backend');
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
  const bytes = new TextEncoder().encode('马'.repeat(50_000));
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
