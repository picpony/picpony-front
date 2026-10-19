/** Admin glossary mutation regressions with fake responses; no server or account. */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import ts from 'typescript';

const root = path.resolve(import.meta.dirname, '..');
const code = ts.transpileModule(readFileSync(path.join(root, 'lib/adminMutations.ts'), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const calls = [];
let answer;
const api = async (method, route, options) => {
  calls.push({ method, route, options });
  if (answer instanceof Error) throw answer;
  return answer;
};
const exports = {};
vm.runInNewContext(code, { exports, crypto, require: (name) => (name === '@/lib/api/http' ? { api } : {}) });

/* Every console write carries a fresh v4 Idempotency-Key, and the caller's own options win. */
answer = { id: 7 };
assert.deepEqual(await exports.adminWrite('POST', '/admin/dictionary/tags', { token: 't', json: { en: 'pony' } }), { id: 7 });
assert.match(calls[0].options.idempotencyKey, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
assert.equal(calls[0].options.token, 't');
answer = undefined;
await exports.adminWrite('DELETE', '/admin/dictionary/tags/7', { token: 't' });
assert.notEqual(calls[1].options.idempotencyKey, calls[0].options.idempotencyKey, 'one key per press');
/* A 204 is a write that happened: `{}`, never `undefined`. */
answer = undefined;
assert.equal(JSON.stringify(await exports.adminWrite('PUT', '/admin/x', { token: 't' })), '{}');
/* A refusal is the transport's error, rethrown as is and never retried. */
answer = new Error('denied');
await assert.rejects(exports.adminWrite('PUT', '/admin/x', { token: 't' }), /denied/);
assert.equal(calls.length, 4);
assert.equal(exports.requireAdminSuccess, undefined, 'the PHP envelope check is gone');

console.log('Admin write checks passed: idempotency keys, 204 answers and refusals.');
