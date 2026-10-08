/**
 * Review part 1 regressions for the server hops (P1-F1, P1-F2):
 *
 * - `app/api.php/…/route.ts` bounds a request **body** by its pace, not by the 30s answer budget —
 *   a 50MB upload on a slow line used to be cut off and reported as an outage;
 * - `next.config.ts` keeps its security headers off exactly the handlers that set a stricter policy
 *   of their own, matched as whole path segments.
 *
 * The route is run in a VM with its timers and `AbortSignal.timeout` recorded, so nothing here
 * waits for a real timeout.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { test } from 'node:test';
import ts from 'typescript';

const root = path.resolve(import.meta.dirname, '..');
const require = createRequire(import.meta.url);

function loadProxy(fetchImpl) {
  const source = readFileSync(path.join(root, 'app/api.php/[[...path]]/route.ts'), 'utf8');
  const code = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const timers = [];
  const budgets = [];
  const exports = {};
  const FakeAbortSignal = {
    any: (signals) => AbortSignal.any(signals),
    timeout: (ms) => { budgets.push(ms); return new AbortController().signal; },
  };
  vm.runInNewContext(code, {
    exports,
    require: (name) => ({
      'next/cache': { revalidateTag: () => {} },
      '@/lib/blockFilters.server': {
        BLOCK_FILTERS_CACHE_TAG: 'a', PUBLIC_BLACKLIST_CACHE_TAG: 'b',
        clearBlockFiltersMemo: () => {}, clearPublicBlacklistMemo: () => {},
      },
      '@/lib/constants': { COOKIE_KEYS: {}, SITE_STATUS_CACHE_TAG: 'c' },
    })[name],
    process: { env: {} },
    Response, Headers, URL, AbortController, DOMException, TransformStream,
    AbortSignal: FakeAbortSignal,
    setTimeout: (fn, ms) => { const timer = { fn, ms, cleared: false }; timers.push(timer); return timer; },
    clearTimeout: (timer) => { if (timer) timer.cleared = true; },
    fetch: fetchImpl,
  });
  const live = () => timers.filter((timer) => !timer.cleared);
  return { exports, timers, live, budgets };
}

function request(url, init) {
  const value = new Request(url, init);
  Object.defineProperty(value, 'nextUrl', { value: new URL(url) });
  return value;
}
const context = () => ({ params: Promise.resolve({}) });

test('P1-F1: a bodyless request keeps the 30s budget', async () => {
  const proxy = loadProxy(async () => Response.json({ success: true }));
  await proxy.exports.GET(request('https://app.invalid/api.php?action=get_user'), context());
  assert.deepEqual(proxy.budgets, [30_000]);
  assert.equal(proxy.timers.length, 0);
});

test('P1-F1: a body is bounded by its pace, then the answer by 30s, never by one 30s total', async () => {
  let push;
  const body = new ReadableStream({ start(controller) { push = controller; } });
  let sent = 0;
  let signal;
  let answer;
  const proxy = loadProxy(async (_url, init) => {
    signal = init.signal;
    const reader = init.body.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      sent += value.byteLength;
    }
    return new Promise((resolve) => { answer = resolve; });
  });
  const pending = proxy.exports.POST(request('https://app.invalid/api.php?action=upload_temp_upload', {
    method: 'POST', body, duplex: 'half',
  }), context());
  const tick = () => new Promise((resolve) => setImmediate(resolve));
  await tick();
  assert.deepEqual(proxy.budgets, [15 * 60_000], 'only the overall cap is a fixed budget');
  assert.deepEqual(proxy.live().map((timer) => timer.ms), [30_000], 'an idle timer, armed before the first byte');
  for (let i = 0; i < 5; i += 1) {
    push.enqueue(new Uint8Array(1024));
    await tick();
  }
  assert.equal(sent, 5 * 1024, 'the body streams through unchanged');
  assert.equal(proxy.live().length, 1, 'each chunk re-arms the one idle timer');
  push.close();
  await tick(); await tick();
  assert.deepEqual(proxy.live().map((timer) => timer.ms), [30_000], 'the answer gets its own 30s once the body is sent');
  answer(Response.json({ success: true, url: 'https://picpony.top/tmp/x.png' }));
  const response = await pending;
  assert.equal(response.status, 200);
  assert.equal(proxy.live().length, 0, 'no timer outlives the answer');
  assert.equal(signal.aborted, false);
});

test('P1-F1: a stalled body aborts the upstream call and answers 502', async () => {
  const body = new ReadableStream({ start() {} });
  const proxy = loadProxy((_url, init) => new Promise((_, reject) => {
    init.signal.addEventListener('abort', () => reject(init.signal.reason), { once: true });
  }));
  const pending = proxy.exports.POST(request('https://app.invalid/api.php?action=upload_temp_upload', {
    method: 'POST', body, duplex: 'half',
  }), context());
  await new Promise((resolve) => setImmediate(resolve));
  const [idle] = proxy.live();
  assert.equal(idle.ms, 30_000);
  idle.fn();
  const response = await pending;
  assert.equal(response.status, 502);
});

test('P1-F2: security headers skip exactly the handlers with their own sandbox policy', async () => {
  const config = readFileSync(path.join(root, 'next.config.ts'), 'utf8');
  const literal = /source: ('\/:path\(\(\?!.*?\)'),/.exec(config)?.[1];
  assert.ok(literal, 'the headers() source is where the test expects it');
  const source = vm.runInNewContext(literal);
  const { pathToRegexp } = require('next/dist/compiled/path-to-regexp');
  const re = pathToRegexp(source, [], { strict: true, sensitive: false, delimiter: '/' });
  for (const own of ['/api.php', '/api.php/x', '/relay', '/share.php', '/upload/submit']) {
    assert.equal(re.test(own), false, `${own} keeps its own policy`);
  }
  for (const app of ['/', '/forum/1', '/relayX', '/api.phpfoo', '/share.php.bak', '/upload', '/upload/submitx', '/mascot-shape', '/admin/import-tools/images']) {
    assert.equal(re.test(app), true, `${app} gets the app's headers`);
  }
});
