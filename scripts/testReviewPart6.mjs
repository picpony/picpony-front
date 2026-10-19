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

/* P6-F1 (the import route's refusals, `writeImport`, the import task's recovery) left with the
   import tools: the `/api/v1` backend has no image-tag or PPSync import endpoint, so
   `lib/adminCatalogTools/importProxy.ts`, `importClient.ts`, `importModel.ts` and
   `useImportTask.ts` are gone (testReviewPart7 P6-O1 pins that they stay gone). */

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
  /* 未翻译 untouched is still no translation — written as 未翻译, since the backend refuses an
     empty `cn` and reads 未翻译 as "no translation". */
  const untranslated = { ...tag, cn: '未翻译', aliases: [] };
  assert.equal(model.tagSavePayload(model.tagFormOf(untranslated), untranslated).cn, '未翻译');
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
