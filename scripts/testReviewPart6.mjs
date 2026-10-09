/**
 * Regression cases for review part 6 (the admin console, its routes and models), with no live
 * service: each test names the finding it pins (`P6-Fn` in `part6-review.md`). The cases that need
 * the console's panel harness live at the end of `testAdminConsistency.mjs`.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { test } from 'node:test';
import { webcrypto } from 'node:crypto';
import ts from 'typescript';

const root = path.resolve(import.meta.dirname, '..');

/** CommonJS through the TypeScript transpiler, `@/` resolved, one module instance per file. */
function loader(overrides = {}, globals = {}) {
  const cache = new Map();
  const load = (file) => {
    const key = path.normalize(file);
    if (cache.has(key)) return cache.get(key);
    const exports = {};
    cache.set(key, exports);
    const code = ts.transpileModule(readFileSync(path.join(root, key), 'utf8'), {
      compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
    }).outputText;
    vm.runInNewContext(code, {
      exports, console, Error, TypeError, Response, Request, File, Blob, FormData, URL, URLSearchParams, AbortController, AbortSignal,
      TextDecoder, Uint8Array, crypto: webcrypto, setTimeout, clearTimeout, queueMicrotask, process: { env: {} }, ...globals,
      require: (name) => {
        if (name in overrides) return overrides[name];
        const target = name.startsWith('@/') ? name.slice(2) : path.join(path.dirname(key), name);
        return load(`${target}.ts`);
      },
    }, { filename: key });
    return exports;
  };
  return load;
}

const HTTP_STUB = { deadlineSignal: () => ({ signal: undefined, timedOut: () => false, dispose() {} }), noteUnauthorized() {}, picponyRequest() {}, picponyPostJson() {} };
const flush = () => new Promise((resolve) => setImmediate(resolve));
const settle = async () => { for (let i = 0; i < 12; i++) await flush(); };

// ---------------------------------------------------------------------------------------------
// P6-F1 — the import route's own refusals are refusals, not lost acknowledgements
// ---------------------------------------------------------------------------------------------

function upstream({ verify = 'admin', hold = false } = {}) {
  let release;
  const held = new Promise((resolve) => { release = resolve; });
  const fetcher = async (target) => {
    const url = String(target);
    if (url.includes('action=get_user')) {
      if (verify === 'down') throw new Error('down');
      return Response.json({ success: true, user: { role: verify === 'admin' ? 'admin' : 'user' } });
    }
    if (hold) await held;
    return Response.json({ success: true, upload_id: 'fixture-import-1', stage: 'processing' });
  };
  return { fetcher, release };
}
const post = (form, token = 'fixture') => new Request('https://front.test/admin/import-tools/dictionary', { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: form });
const dictionaryForm = () => { const form = new FormData(); form.set('upload_id', 'fixture-import-1'); form.set('package', new File(['data'], 'package.ppsync')); return form; };

test('P6-F1: the import route marks every refusal it makes before the upstream, and nothing after it', async () => {
  const load = loader();
  const { handleImport } = load('lib/adminCatalogTools/importProxy.ts');
  const { IMPORT_NOT_SENT_HEADER } = load('lib/adminCatalogTools/importModel.ts');
  const marked = (response) => response.headers.get(IMPORT_NOT_SENT_HEADER) === '1';

  /* Busy: one body is held while the upstream has not answered. */
  const slow = upstream({ hold: true });
  const first = handleImport(post(dictionaryForm(), 'busy-a'), 'dictionary', slow.fetcher);
  await settle();
  const busy = await handleImport(post(dictionaryForm(), 'busy-b'), 'dictionary', slow.fetcher);
  assert.equal(busy.status, 503);
  assert.ok(marked(busy), 'a busy slot is a refusal made here');
  assert.equal(busy.headers.get('Retry-After'), '5');
  slow.release();
  assert.equal((await first).status, 200);
  assert.equal(marked(await first), false, 'an upstream answer is never marked');

  const down = await handleImport(post(dictionaryForm(), 'verify-down'), 'dictionary', upstream({ verify: 'down' }).fetcher);
  assert.equal(down.status, 503);
  assert.ok(marked(down), 'an unverifiable session never reached the importer');

  const denied = await handleImport(post(dictionaryForm(), 'verify-user'), 'dictionary', upstream({ verify: 'user' }).fetcher);
  assert.equal(denied.status, 403);
  assert.ok(marked(denied));

  const bad = new FormData(); bad.set('upload_id', 'fixture-import-1'); bad.set('extra', 'x');
  const refused = await handleImport(post(bad, 'bad-form'), 'dictionary', upstream().fetcher);
  assert.equal(refused.status, 400);
  assert.ok(marked(refused));

  /* After the upstream was asked the outcome is unknown, and stays unmarked. */
  const lost = await handleImport(post(dictionaryForm(), 'lost'), 'dictionary', async (target) => {
    if (String(target).includes('action=get_user')) return Response.json({ success: true, user: { role: 'admin' } });
    throw new Error('connection reset');
  });
  assert.equal(lost.status, 502);
  assert.equal(marked(lost), false);
});

function importClient(responses) {
  const sent = [];
  const fetch = async (url, init) => {
    sent.push({ url, init });
    const next = responses.shift();
    if (next instanceof Error) throw next;
    return next;
  };
  const load = loader({
    '@/lib/api/http': HTTP_STUB, './http': HTTP_STUB,
  }, { fetch });
  return { client: load('lib/adminCatalogTools/importClient.ts'), catalog: load('lib/api/adminCatalogTools.ts'), errors: load('lib/api/errors.ts'), model: load('lib/adminCatalogTools/importModel.ts'), load, sent };
}

test('P6-F1: writeImport reads a marked refusal as ImportNotSent, and only an unmarked 5xx or a lost answer as unknown', async () => {
  const { model } = importClient([]);
  const header = { [model.IMPORT_NOT_SENT_HEADER]: '1' };
  const { client, catalog } = importClient([
    Response.json({ success: false, error: '导入服务正忙，请稍后重试' }, { status: 503, headers: header }),
    Response.json({ success: false, error: '上传中断或过慢，请重新上传' }, { status: 408, headers: header }),
    Response.json({ success: false, error: '未能确认提交结果，请核对任务状态' }, { status: 502 }),
    new TypeError('fetch failed'),
    Response.json({ success: false, error: 'x' }, { status: 503 }),
  ]);
  const busy = await client.writeImport('dictionary', 'token', new FormData()).catch((error) => error);
  assert.ok(busy instanceof client.ImportNotSent, 'a busy slot is not a lost acknowledgement');
  assert.equal(busy instanceof catalog.CatalogOutcomeUnknown, false);
  assert.equal(busy.message, '导入服务正忙，请稍后重试');
  assert.equal(busy.retryable, true);
  const stalled = await client.writeImport('dictionary', 'token', new FormData()).catch((error) => error);
  assert.ok(stalled instanceof client.ImportNotSent);
  assert.equal(stalled.status, 408);
  for (const reason of ['a 502 after the upstream was asked', 'no answer at all', 'an unmarked 503']) {
    const unknown = await client.writeImport('dictionary', 'token', new FormData()).catch((error) => error);
    assert.ok(unknown instanceof catalog.CatalogOutcomeUnknown, reason);
  }
});

/** The hook under a minimal React: state slots, refs, callbacks and effects run on demand. */
function hookHarness() {
  const slots = [];
  const cleanups = [];
  let cursor = 0;
  let effects = [];
  const react = {
    useState(initial) {
      const index = cursor++;
      if (!(index in slots)) slots[index] = typeof initial === 'function' ? initial() : initial;
      return [slots[index], (next) => { slots[index] = typeof next === 'function' ? next(slots[index]) : next; }];
    },
    useRef(initial) { return slots[cursor++] ??= { current: initial }; },
    useCallback(callback, deps) {
      const index = cursor++;
      const previous = slots[index];
      if (!previous || deps.some((value, i) => !Object.is(value, previous.deps[i]))) slots[index] = { deps, value: callback };
      return slots[index].value;
    },
    useEffect(effect, deps) {
      const index = cursor++;
      const previous = slots[index];
      if (!previous || deps.some((value, i) => !Object.is(value, previous[i]))) {
        slots[index] = deps;
        effects.push(() => { cleanups[index]?.(); cleanups[index] = effect(); });
      }
    },
  };
  return {
    react,
    render(hook) { cursor = 0; return hook(); },
    effects() { const pending = effects; effects = []; pending.forEach((effect) => effect()); },
    dispose() { cleanups.forEach((cleanup) => cleanup?.()); },
  };
}

async function importTask(dataset, responses, stored) {
  const values = new Map();
  if (stored) values.set(`picpony-admin-import:7:${dataset}`, JSON.stringify(stored));
  const localStorage = { getItem: (k) => values.get(k) ?? null, setItem: (k, v) => values.set(k, String(v)), removeItem: (k) => values.delete(k) };
  const harness = hookHarness();
  const sent = [];
  const fetch = async (url, init) => {
    sent.push({ url, init });
    const next = responses.shift();
    if (next instanceof Error) throw next;
    return next;
  };
  const load = loader({
    react: harness.react,
    '@/lib/hooks': { readToken: () => 'token' },
    '@/lib/utils': { randomId: () => 'fixture-import-2' },
    '@/lib/constants': { LS_KEYS: { adminImportPrefix: 'picpony-admin-import' } },
    '@/lib/api/http': HTTP_STUB, './http': HTTP_STUB,
  }, { fetch, localStorage, document: { hidden: false } });
  const { useImportTask } = load('components/admin/catalogTools/useImportTask.ts');
  const model = load('lib/adminCatalogTools/importModel.ts');
  const run = () => harness.render(() => useImportTask('token', 7, dataset, false));
  run();
  harness.effects();
  await settle();
  return { run, harness, sent, values, model };
}

test('P6-F1: a submission the route refused before the upstream puts the job back as it was, and can be made again', async () => {
  const { model } = importClient([]);
  const refused = () => Response.json({ success: false, error: '导入服务正忙，请稍后重试' }, { status: 503, headers: { [model.IMPORT_NOT_SENT_HEADER]: '1' } });

  /* A dictionary package: nothing before, so nothing after — and the same press goes out again. */
  const dictionary = await importTask('dictionary', [refused(), Response.json({ success: true, upload_id: 'fixture-import-2', stage: 'processing' })]);
  const pack = new File(['data'], 'package.ppsync');
  await dictionary.run().submit(pack);
  await settle();
  let task = dictionary.run();
  assert.equal(task.job, null, 'no 提交结果待核对 for an id the server never saw');
  assert.equal(dictionary.values.size, 0, 'and no stored job to recover');
  assert.equal(task.error, '导入服务正忙，请稍后重试');
  await task.submit(pack);
  await settle();
  task = dictionary.run();
  assert.equal(dictionary.sent.length, 2, 'the second press is sent');
  assert.equal(task.job.phase, 'processing');

  /* A staged image database: the refused 校验并导入 leaves the upload staged, not 导入未全部完成. */
  const staged = { id: 'fixture-import-1', dataset: 'images', filename: 'tags.db', size: 10, totalChunks: 1, chunks: [0], fingerprint: 'x', phase: 'staged', percent: 100 };
  const images = await importTask('images', [refused()], staged);
  assert.equal(images.run().job.phase, 'staged');
  await images.run().submit();
  await settle();
  task = images.run();
  assert.equal(task.job.phase, 'staged', 'the staged upload can be submitted again');
  assert.equal(JSON.parse(images.values.get('picpony-admin-import:7:images')).phase, 'staged');

  /* Before: an unmarked 503 is still unknown. */
  const lost = await importTask('dictionary', [Response.json({ success: false }, { status: 503 })]);
  await lost.run().submit(pack);
  await settle();
  assert.equal(lost.run().job.phase, 'unknown', 'an answer from beyond the route keeps its caution');
});

test('P6-F1: a chunk whose answer was lost pauses the upload with resume advice, not 勿重复提交', async () => {
  const bytes = new Uint8Array(12 * 1024 * 1024);
  const file = new File([bytes], 'tags.db');
  const task = await importTask('images', [Response.json({ success: true }), new TypeError('fetch failed')]);
  await task.run().stage(file);
  await settle();
  const state = task.run();
  assert.equal(state.job.phase, 'paused');
  assert.deepEqual(JSON.parse(JSON.stringify(state.job.chunks)), [0], 'the accepted chunk is remembered');
  assert.match(state.error, /继续上传/);
  assert.doesNotMatch(state.error, /勿重复提交/);
});

// ---------------------------------------------------------------------------------------------
// P6-F3 — an untouched translations field keeps the stored names
// ---------------------------------------------------------------------------------------------

test('P6-F3: saving a tag without touching its names sends them as stored; 、 is not a separator', () => {
  const load = loader({ '@/lib/format': { formatDateTime: String, parseBackendUtcTime: () => null } });
  const model = load('components/admin/glossary/model.ts');
  const plain = (value) => JSON.parse(JSON.stringify(value));
  const tag = { id: 3, en: 'applejack', cn: '苹果嘉儿、AJ', aliases: ['小苹果，大苹果'], cat: 'character', count: 1, description: '' };
  const form = { ...model.tagFormOf(tag), description: '只改简介' };
  const payload = plain(model.tagSavePayload(form, tag));
  assert.equal(payload.cn, '苹果嘉儿、AJ', 'a name with 、 is one name');
  assert.deepEqual(payload.aliases, ['小苹果，大苹果'], 'a stored alias with a comma survives a description-only save');
  assert.equal(payload.description, '只改简介');

  /* An edited field is parsed — on commas only. */
  assert.deepEqual(plain(model.parseTranslations('紫悦、暮光闪闪, ts，TS')), { cn: '紫悦、暮光闪闪', aliases: ['ts', 'TS'] });
  const edited = plain(model.tagSavePayload({ ...form, translations: '苹果嘉儿, AJ' }, tag));
  assert.deepEqual([edited.cn, edited.aliases], ['苹果嘉儿', ['AJ']]);
  /* 未翻译 untouched is still no translation. */
  const untranslated = { ...tag, cn: '未翻译', aliases: [] };
  assert.equal(model.tagSavePayload(model.tagFormOf(untranslated), untranslated).cn, '');
  assert.equal(model.sameTag(' TAG-2 ', 'tag-2'), true);
  assert.equal(model.sameTag('tag-2', 'tag-20'), false);
});

// ---------------------------------------------------------------------------------------------
// P6-F7 — a comma in a rule's tag cannot become AND
// ---------------------------------------------------------------------------------------------

test('P6-F7: escapeTag escapes the comma, so a tag never splits into two terms', async () => {
  const { requireTypeStripping } = await import('./tsResolve.mjs');
  requireTypeStripping('testReviewPart6');
  const { escapeTag } = await import('../lib/searchQuery.ts');
  assert.equal(escapeTag('explicit, grimdark'), 'explicit\\,\\ grimdark');
  assert.equal(escapeTag('oc:nyx (pony)'), 'oc\\:nyx\\ \\(pony\\)', 'what worked is unchanged');
  for (const tag of ['a,b', 'a, b', 'a，b']) assert.doesNotMatch(escapeTag(tag), /(^|[^\\]),/, tag);
});
