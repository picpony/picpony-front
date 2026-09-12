import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
function moduleAt(file, dependencies, globals) {
  const code = ts.transpileModule(readFileSync(path.join(root, file), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const exports = {};
  vm.runInNewContext(code, { exports, require: (name) => {
    if (!(name in dependencies)) throw new Error(`Unexpected dependency ${name}`);
    return dependencies[name];
  }, ...globals }, { filename: file });
  return exports;
}
const values = new Map();
const storage = {
  getItem: (key) => values.get(key) ?? null,
  setItem: (key, value) => values.set(key, value),
  removeItem: (key) => values.delete(key),
};
let announcements = 0;
const session = moduleAt('lib/hooks.ts', { react: {}, './constants': {
  LS_KEYS: { userInfo: 'user_info', derpiApiKey: 'derpi_api_key' }, MEDIA: {},
} }, { window: { dispatchEvent: () => announcements++ }, localStorage: storage, Event });
values.set('user_info', JSON.stringify({ token: 'B', username: 'account B' }));
assert.equal(session.updateUserInfo('A', { username: 'late A' }), false);
assert.equal(session.clearUserInfo('A'), false);
assert.equal(session.readUserInfo().token, 'B');
assert.equal(announcements, 0);
assert.equal(session.updateUserInfo('B', { api_key: 'new-key' }), true);
assert.equal(session.readUserInfo().username, 'account B');
assert.equal(announcements, 1);
assert.equal(session.updateUserInfo('B', { api_key: 'new-key' }), true);
assert.equal(announcements, 1, 'unchanged values do not publish again');

// A redacted get_user response is not an unbind. The settings-page merge uses
// the same resolver before publishing both the session and resource answer.
session.updateUserInfo('B', { derpi_user_id: '42', derpi_username: 'saved-owner' });
const credentials = session.resolveDerpiCredentials(
  { username: 'updated profile', has_api_key: true }, session.readUserInfo(),
);
assert.equal(credentials.api_key, 'new-key');
assert.equal(credentials.derpi_user_id, '42');
assert.equal(credentials.derpi_username, 'saved-owner');
session.updateUserInfo('B', credentials);
assert.equal(storage.getItem('derpi_api_key'), 'new-key');
assert.equal(session.resolveDerpiCredentials({ api_key: null }, session.readUserInfo()).api_key, 'new-key');
const verified = session.resolveDerpiCredentials(
  { api_key: 'verified-key', derpi_user_id: 73, derpi_username: 'verified-owner' }, session.readUserInfo(),
);
session.updateUserInfo('B', verified);
assert.equal(session.readUserInfo().derpi_user_id, '73');
assert.equal(storage.getItem('derpi_api_key'), 'verified-key');
const unbound = session.resolveDerpiCredentials(
  { api_key: '', derpi_user_id: '', derpi_username: '' }, session.readUserInfo(),
);
session.updateUserInfo('B', unbound);
assert.equal(session.readUserInfo().api_key, '');
assert.equal(session.readUserInfo().derpi_user_id, '');
assert.equal(session.readUserInfo().derpi_username, '');
assert.equal(storage.getItem('derpi_api_key'), null, 'an explicit unbind still clears the key');
values.set('derpi_api_key', 'new-key');
session.clearUserInfo('B');
assert.equal(session.readToken(), null);
assert.equal(storage.getItem('derpi_api_key'), null);
for (const invalid of ['null', '[]', '42', '{"token":123}', '{"token":""}', 'invalid']) {
  values.set('user_info', invalid);
  assert.equal(session.readUserInfo(), null);
}

values.clear();
let calls = 0;
let now = Date.now();
let fail = false;
const makeTags = () => moduleAt('lib/tagTranslations.ts', {
  '@/lib/api/picpony': { getTagTranslations: async () => {
    calls++;
    if (fail) throw new TypeError('offline');
    return { success: true, translations: { pony: '小马' } };
  } },
}, { window: {}, localStorage: storage, Date: { now: () => now } });
let tags = makeTags();
let partial;
await tags.loadTagTranslations(['species:pony', 'unknown'], (value) => { partial = value; });
assert.equal(partial.pony, '小马');
assert.equal(partial.unknown, null, 'a miss is published, so the view stops asking');
await tags.loadTagTranslations(['unknown']);
assert.equal(calls, 1, 'in-memory negative cache');
tags = makeTags();
await tags.loadTagTranslations(['unknown']);
assert.equal(calls, 1, 'persisted negative cache survives reload');
now += 24 * 60 * 60 * 1000 + 1;
await tags.loadTagTranslations(['unknown']);
assert.equal(calls, 2, 'negative TTL expires within the same session');
fail = true;
await tags.loadTagTranslations(['offline'], (value) => { partial = value; });
assert.equal(partial.offline, null);
assert.equal(JSON.parse(storage.getItem('picpony_tag_translations_v1')).offline, undefined,
  'a network failure does not poison the persistent dictionary cache');
fail = false;
await tags.loadTagTranslations(['offline']);
assert.equal(calls, 4, 'later visits can retry a failed request');
assert.equal(tags.tagTranslationKey('species:PONY'), 'pony');
console.log('Session guards and tag translation cache regressions passed');
