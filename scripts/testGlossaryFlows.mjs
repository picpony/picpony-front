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
const exports = {};
vm.runInNewContext(code, { exports, require: () => ({}) });
const response = (body, ok = true, status = 200) => ({ ok, status, json: async () => body });
await assert.rejects(exports.requireAdminSuccess(response({ success: false, error: 'denied' })), /denied/);
await assert.rejects(exports.requireAdminSuccess(response({ success: true }, false, 503)), /HTTP 503/);
await assert.rejects(exports.requireAdminSuccess({ ok: true, status: 200, json: async () => { throw new Error('html'); } }), /HTTP 200/);
assert.deepEqual(await exports.requireAdminSuccess(response({ success: true, id: 7 })), { success: true, id: 7 });

console.log('Admin response checks passed: rejected writes, failed HTTP statuses and malformed responses.');
