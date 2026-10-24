/**
 * Review part 1 regressions for the server hops (P1-F1, P1-F2):
 *
 * - `app/api/v1/[...path]/route.ts` bounds a request **body** by its pace, not by the 30s answer budget —
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

/* The shared header rules the route imports (review P1-F12) — pure, so the real module is loaded. */
function loadPure(relative) {
  const code = ts.transpileModule(readFileSync(path.join(root, relative), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const exports = {};
  vm.runInNewContext(code, { exports, Headers, Set });
  return exports;
}
const proxyHeaders = loadPure('lib/proxyHeaders.ts');

function loadProxy(fetchImpl) {
  const source = readFileSync(path.join(root, 'app/api/v1/[...path]/route.ts'), 'utf8');
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
      '@/lib/upstream.server': { upstreamOrigin: () => 'https://picpony.top' },
      '@/lib/proxyHeaders': proxyHeaders,
    })[name],
    process: { env: {} },
    Response, Headers, URL, AbortController, DOMException, TransformStream, ReadableStream,
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
const context = (...path) => ({ params: Promise.resolve({ path }) });

test('P1-F1: a bodyless request keeps the 30s budget', async () => {
  const proxy = loadProxy(async () => Response.json({ user: { id: 1 } }));
  await proxy.exports.GET(request('https://app.invalid/api/v1/me'), context('me'));
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
  const pending = proxy.exports.POST(request('https://app.invalid/api/v1/me/uploads/works', {
    method: 'POST', body, duplex: 'half',
  }), context('me', 'uploads', 'works'));
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
  answer(Response.json({ url: 'https://picpony.top/tmp/x.png' }));
  const response = await pending;
  assert.equal(response.status, 200);
  assert.equal(proxy.live().length, 0, 'no timer outlives the answer');
  assert.equal(signal.aborted, false);
});

test('P1-F1 / P4-O2: a stalled body aborts the upstream call and answers 408, not an outage', async () => {
  const body = new ReadableStream({ start() {} });
  const proxy = loadProxy((_url, init) => new Promise((_, reject) => {
    init.signal.addEventListener('abort', () => reject(init.signal.reason), { once: true });
  }));
  const pending = proxy.exports.POST(request('https://app.invalid/api/v1/me/uploads/works', {
    method: 'POST', body, duplex: 'half',
  }), context('me', 'uploads', 'works'));
  await new Promise((resolve) => setImmediate(resolve));
  const [idle] = proxy.live();
  assert.equal(idle.ms, 30_000);
  idle.fn();
  const response = await pending;
  assert.equal(response.status, 408);
  const failure = await response.json();
  assert.equal(failure.error.code, 'BODY_STALLED');
  assert.match(failure.error.message, /上传中断/);
});

test('a small declared body goes upstream whole, with its length, never chunked (WAF 拦截分块请求)', async () => {
  let init;
  const proxy = loadProxy(async (_url, value) => { init = value; return Response.json({ revision: 2 }); });
  const payload = JSON.stringify({ visited_at: 1 });
  const response = await proxy.exports.POST(request('https://app.invalid/api/v1/me/browsing-history/1', {
    method: 'PUT', body: payload,
    headers: { 'content-type': 'application/json', 'content-length': String(payload.length) },
  }), context('me', 'browsing-history', '1'));
  assert.equal(response.status, 200);
  assert.equal(Object.prototype.toString.call(init.body), '[object ArrayBuffer]', 'a buffer, so fetch sends a Content-Length');
  assert.equal(new TextDecoder().decode(init.body), payload);
  assert.equal(init.headers.has('content-length'), false, 'fetch computes the length itself');
  assert.deepEqual(proxy.budgets, [30_000], 'a buffered body gets the plain answer budget');
  assert.equal(proxy.live().length, 0, 'no timer outlives the answer');
});

test('a small body with no declared length still goes upstream whole, never chunked (WAF 拦截分块请求)', async () => {
  /* A hop in front of the server (a LAN reverse proxy, a tunnel) can strip the browser's
     Content-Length and deliver the JSON chunked; forwarded as is, the WAF blocked
     `POST /images/comment-counts` and banned the visitor's address. */
  let init;
  const proxy = loadProxy(async (_url, value) => { init = value; return Response.json({ counts: {} }); });
  const payload = JSON.stringify({ image_ids: [1, 2, 3] });
  const body = new ReadableStream({
    start(controller) {
      const bytes = new TextEncoder().encode(payload);
      controller.enqueue(bytes.slice(0, 5));
      controller.enqueue(bytes.slice(5));
      controller.close();
    },
  });
  const response = await proxy.exports.POST(request('https://app.invalid/api/v1/images/comment-counts', {
    method: 'POST', body, duplex: 'half', headers: { 'content-type': 'application/json' },
  }), context('images', 'comment-counts'));
  assert.equal(response.status, 200);
  assert.equal(Object.prototype.toString.call(init.body), '[object ArrayBuffer]', 'a buffer, so fetch sends a Content-Length');
  assert.equal(new TextDecoder().decode(init.body), payload);
  assert.deepEqual(proxy.budgets, [30_000], 'a buffered body gets the plain answer budget');
});

test('an undeclared body past the cap streams on intact from where the probe stopped', async () => {
  let received;
  const proxy = loadProxy(async (_url, value) => {
    const reader = value.body.getReader();
    const parts = [];
    for (;;) { const { done, value: chunk } = await reader.read(); if (done) break; parts.push(chunk); }
    received = parts.reduce((sum, part) => sum + part.byteLength, 0);
    return Response.json({});
  });
  const chunk = new Uint8Array(400 * 1024);
  const body = new ReadableStream({
    start(controller) { for (let i = 0; i < 4; i += 1) controller.enqueue(chunk); controller.close(); },
  });
  const response = await proxy.exports.POST(request('https://app.invalid/api/v1/me/preferences', {
    method: 'PUT', body, duplex: 'half', headers: { 'content-type': 'application/json' },
  }), context('me', 'preferences'));
  assert.equal(response.status, 200);
  assert.equal(received, 4 * 400 * 1024, 'no byte lost across the probe');
});

test('a body larger than declared is cut off at the cap with a 413', async () => {
  let calls = 0;
  const proxy = loadProxy(async () => { calls += 1; return Response.json({}); });
  const big = new Uint8Array(1024 * 1024 + 1);
  const body = new ReadableStream({ start(controller) { controller.enqueue(big); controller.close(); } });
  const response = await proxy.exports.POST(request('https://app.invalid/api/v1/me/preferences', {
    method: 'PUT', body, duplex: 'half', headers: { 'content-type': 'application/json', 'content-length': '10' },
  }), context('me', 'preferences'));
  assert.equal(response.status, 413);
  assert.equal(calls, 0);
});

test('a streamed upload keeps its declared Content-Length upstream', async () => {
  let init;
  const proxy = loadProxy(async (_url, value) => {
    init = value;
    const reader = value.body.getReader();
    while (!(await reader.read()).done) { /* drain */ }
    return Response.json({ url: 'x' });
  });
  const body = new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array(4)); controller.close(); } });
  await proxy.exports.POST(request('https://app.invalid/api/v1/me/avatar', {
    method: 'POST', body, duplex: 'half',
    headers: { 'content-type': 'multipart/form-data; boundary=x', 'content-length': '4' },
  }), context('me', 'avatar'));
  assert.ok(init.body instanceof ReadableStream, 'multipart still streams');
  assert.equal(init.headers.get('content-length'), '4');
});

test('P4-O2: an upstream that fails on its own is still a 502', async () => {
  const proxy = loadProxy(async () => { throw new TypeError('fetch failed'); });
  const response = await proxy.exports.POST(request('https://app.invalid/api/v1/me/uploads/works', {
    method: 'POST', body: 'x', duplex: 'half',
  }), context('me', 'uploads', 'works'));
  assert.equal(response.status, 502);
});

test('P1-F2: security headers skip exactly the handlers with their own sandbox policy', async () => {
  const config = readFileSync(path.join(root, 'next.config.ts'), 'utf8');
  const literal = /source: ('\/:path\(\(\?!.*?\)'),/.exec(config)?.[1];
  assert.ok(literal, 'the headers() source is where the test expects it');
  const source = vm.runInNewContext(literal);
  const { pathToRegexp } = require('next/dist/compiled/path-to-regexp');
  const re = pathToRegexp(source, [], { strict: true, sensitive: false, delimiter: '/' });
  for (const own of ['/api/v1', '/api/v1/me', '/relay', '/share.php', '/upload/submit']) {
    assert.equal(re.test(own), false, `${own} keeps its own policy`);
  }
  for (const app of ['/', '/forum/1', '/relayX', '/api', '/api/v1x', '/api.php', '/share.php.bak', '/upload', '/upload/submitx', '/mascot-shape']) {
    assert.equal(re.test(app), true, `${app} gets the app's headers`);
  }
});
