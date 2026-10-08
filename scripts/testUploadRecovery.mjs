/** D2 recovery: upload races and transport failures, with no live transport. */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';
import { requireTypeStripping } from './tsResolve.mjs';

requireTypeStripping('testUploadRecovery');
const upload = await import('../lib/api/upload.ts');
const { POST } = await import('../app/upload/submit/route.ts');
const flush = () => new Promise((resolve) => setImmediate(resolve));
function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

function storeFixture() {
  let token = 'account-a';
  const stages = [], submissions = [], counted = [], guards = new Set();
  const dependencies = {
    react: { useSyncExternalStore: (_subscribe, get) => get() },
    '@/components/Toast': { showToast() {} },
    '@/lib/api/errors': { apiErrorMessage: (error) => error.message, isAborted: (error) => error.name === 'AbortError' },
    '@/lib/api/tasks': { recordWeeklyUpload: async (owner) => { counted.push(owner); } },
    '@/lib/api/upload': {
      DUPLICATE_COMPLAINT: upload.DUPLICATE_COMPLAINT,
      stageUpload(owner, file, options) {
        const pending = deferred();
        stages.push({ owner, file, ...options, ...pending });
        return pending.promise;
      },
      submitDerpiImage(input) {
        const pending = deferred();
        submissions.push({ input, ...pending });
        return pending.promise;
      },
    },
    '@/lib/hooks': { readToken: () => token },
    '@/lib/resources': { tasks: { expire() {} } },
  };
  const code = ts.transpileModule(readFileSync(new URL('../app/upload/uploadStore.ts', import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const exports = {};
  vm.runInNewContext(code, {
    exports, AbortController, Date, console,
    window: { addEventListener: (name) => guards.add(name), removeEventListener: (name) => guards.delete(name) },
    require(name) {
      assert.ok(name in dependencies, `Unstubbed dependency ${name}`);
      return dependencies[name];
    },
  }, { filename: 'app/upload/uploadStore.ts' });
  return {
    store: exports, stages, submissions, counted, guards,
    account: (value) => { token = value; },
    start: (owner = token) => exports.startUpload({ owner, apiKey: 'fixtureKey123', tagInput: 'safe, pony, cute', navigate() {} }),
    read: (owner = token) => exports.useUpload(owner),
    draft: (name = 'fixture.png') => exports.updateDraft(token, { file: { name }, rating: 'safe', tags: ['pony', 'cute'], description: '保留草稿' }),
  };
}

test('an old account staging failure cannot disable cancellation of the new account upload', async () => {
  const f = storeFixture();
  f.draft('a.png'); const a = f.start();
  f.account('account-b'); f.draft('b.png'); const b = f.start();
  f.stages[0].reject(new Error('late failure from A')); await a;
  f.store.cancelUpload('account-b');
  assert.equal(f.stages[1].signal.aborted, true);
  f.stages[1].reject(new DOMException('cancelled', 'AbortError')); await b;
  assert.equal(f.submissions.length, 0);
  assert.equal(f.read().draft.file.name, 'b.png');
  assert.equal(f.read().job, null);
});

test('switching the draft owner cancels staging and cannot submit the old account file', async () => {
  const f = storeFixture();
  f.draft(); const pending = f.start();
  f.account('account-b'); f.draft('b.png');
  assert.equal(f.stages[0].signal.aborted, true);
  f.stages[0].resolve('https://picpony.top/uploads/a.png'); await pending;
  assert.equal(f.submissions.length, 0);
  assert.equal(f.read().draft.file.name, 'b.png');
});

test('a late submission result leaves the new owner draft and cancellation handle intact', async () => {
  const f = storeFixture();
  f.draft('a.png'); const a = f.start();
  f.stages[0].resolve('https://picpony.top/uploads/a.png'); await flush();
  f.account('account-b'); f.draft('b.png'); const b = f.start();
  f.submissions[0].resolve({ kind: 'uploaded', imageId: 12 }); await a;
  assert.equal(f.counted.length, 0);
  assert.equal(f.read().draft.file.name, 'b.png');
  f.store.cancelUpload('account-b');
  assert.equal(f.stages[1].signal.aborted, true);
  f.stages[1].reject(new DOMException('cancelled', 'AbortError')); await b;
});

test('re-entry sends one upload; a field refusal reuses staging; only confirmed success counts', async () => {
  const f = storeFixture();
  f.draft(); const first = f.start(); await f.start();
  assert.equal(f.stages.length, 1);
  f.stages[0].resolve('https://picpony.top/uploads/a.png'); await flush();
  f.submissions[0].resolve({ kind: 'rejected', fields: { tags: 'fix tags' }, message: 'fix tags' }); await first;
  assert.equal(f.counted.length, 0);
  const second = f.start(); await flush();
  assert.equal(f.stages.length, 1);
  f.submissions[1].resolve({ kind: 'uploaded', imageId: 13 }); await second;
  assert.deepEqual(f.counted, ['account-a']);
  assert.equal(f.read().draft.file, null);
  assert.equal(f.read().job.outcome.imageId, 13);
  assert.equal(f.guards.has('beforeunload'), false);
});

test('a duplicate after a lost answer stays unconfirmed, retains the draft and never counts', async () => {
  const f = storeFixture();
  const detach = f.store.attachUploadScreen();
  f.draft(); const first = f.start();
  f.stages[0].resolve('https://picpony.top/uploads/a.png'); await flush();
  f.submissions[0].resolve({ kind: 'unconfirmed', message: 'unknown' }); await first;
  const second = f.start(); await flush();
  f.submissions[1].resolve({ kind: 'rejected', fields: { image: upload.DUPLICATE_COMPLAINT }, message: upload.DUPLICATE_COMPLAINT }); await second;
  assert.equal(f.read().job.outcome.kind, 'unconfirmed');
  assert.match(f.read().job.outcome.message, /上一次未能确认/);
  assert.match(f.read().job.outcome.message, /查看你的上传以确认$/);
  assert.ok(f.read().draft.file);
  assert.equal(f.counted.length, 0);
  assert.equal(f.guards.has('beforeunload'), true, 'the kept draft asks before a reload while its screen is open');
  detach();
});

/* G4-007: an unsent draft asked before every reload, on every screen, with nothing there saying what
   would be lost. The draft guards only its own screen; an upload in flight guards everywhere, because
   closing the tab kills it. */
test('a draft arms the unload guard only on its screen; an upload in flight arms it everywhere', async () => {
  const f = storeFixture();
  f.draft();
  assert.equal(f.guards.has('beforeunload'), false, 'a draft with no screen showing it');
  const detach = f.store.attachUploadScreen();
  assert.equal(f.guards.has('beforeunload'), true, 'the screen opens on the draft');
  detach();
  assert.equal(f.guards.has('beforeunload'), false, 'the screen is left; the draft is kept, unguarded');
  assert.ok(f.read().draft.file);
  const pending = f.start();
  assert.equal(f.guards.has('beforeunload'), true, 'an upload in flight, with no screen open');
  f.stages[0].resolve('https://picpony.top/uploads/a.png'); await flush();
  f.submissions[0].resolve({ kind: 'uploaded', imageId: 21 }); await pending;
  assert.equal(f.guards.has('beforeunload'), false, 'landed: nothing left to lose');
});

test('staging sends one multipart file with Bearer and preserves cancellation and invalid-answer errors', async () => {
  const previous = globalThis.XMLHttpRequest;
  const requests = [];
  globalThis.XMLHttpRequest = class {
    upload = {};
    headers = {};
    open(method, url) { Object.assign(this, { method, url }); }
    setRequestHeader(key, value) { this.headers[key] = value; }
    send(body) { this.body = body; requests.push(this); }
    abort() { this.onabort(); }
  };
  try {
    const progress = [];
    const file = new File(['fixture'], 'image.png', { type: 'image/png' });
    const first = upload.stageUpload('fixture', file, { onProgress: (v) => progress.push(v) });
    const xhr = requests[0];
    assert.equal(xhr.method, 'POST');
    assert.match(xhr.url, /action=upload_temp_upload$/);
    assert.equal(xhr.headers.Authorization, 'Bearer fixture');
    assert.equal(xhr.body.get('file').name, 'image.png');
    xhr.upload.onprogress({ lengthComputable: true, loaded: 5, total: 10 });
    xhr.status = 200; xhr.responseText = JSON.stringify({ success: true, url: '/uploads/fixture.png' }); xhr.onload();
    assert.equal(await first, 'https://picpony.top/uploads/fixture.png');
    assert.deepEqual(progress, [0.5, 1]);
    const aborted = new AbortController();
    const second = upload.stageUpload('fixture', file, { signal: aborted.signal });
    aborted.abort();
    await assert.rejects(second, { name: 'AbortError' });
    const third = upload.stageUpload('fixture', file);
    requests[2].status = 200; requests[2].responseText = '<html>bad gateway</html>'; requests[2].onload();
    await assert.rejects(third, (error) => error.kind === 'invalid');
  } finally {
    if (previous === undefined) delete globalThis.XMLHttpRequest;
    else globalThis.XMLHttpRequest = previous;
  }
});

test('submission distinguishes refused, lost and confirmed answers without automatic retries', async () => {
  const previous = globalThis.fetch;
  const input = { apiKey: 'fixtureKey123', url: 'https://picpony.top/uploads/fixture.png', tagInput: 'safe, pony, cute' };
  let calls = 0;
  try {
    for (const [status, body, kind] of [
      [200, { success: true }, 'unconfirmed'], [502, {}, 'unconfirmed'], [504, {}, 'unconfirmed'],
      [401, {}, 'rejected'], [422, { errors: { tag_input: ['must contain a rating'] } }, 'rejected'],
      [201, { image: { id: 32 } }, 'uploaded'],
    ]) {
      globalThis.fetch = async () => { calls++; return Response.json(body, { status }); };
      assert.equal((await upload.submitDerpiImage(input)).kind, kind);
    }
    assert.equal(calls, 6);
    globalThis.fetch = async () => { calls++; throw new TypeError('offline'); };
    assert.equal((await upload.submitDerpiImage(input)).kind, 'unconfirmed');
    assert.equal(calls, 7);
  } finally { globalThis.fetch = previous; }
});

test('the submit hop rejects malformed bodies without contacting any upstream', async () => {
  const previous = globalThis.fetch;
  globalThis.fetch = async () => { assert.fail('An invalid form contacted the upstream'); };
  const valid = { key: 'fixtureKey123', url: 'https://picpony.top/uploads/fixture.png', tag_input: 'safe, pony, cute' };
  try {
    for (const patch of [{ url: 'javascript:alert(1)' }, { url: 'https://user:pass@example.test/a.png' }, { key: '!' }, { source_url: 'example.test' }, { tag_input: '' }]) {
      const response = await POST(new Request('https://app.invalid/upload/submit', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...valid, ...patch }),
      }));
      assert.equal(response.status, 400);
    }
  } finally { globalThis.fetch = previous; }
});
