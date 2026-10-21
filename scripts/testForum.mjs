/**
 * The forum: its data model and bodies, the transport's contract, the words a quote and a teaser are
 * built from, the draft kept on this device, picture preparation, and the post form's publishing
 * flow. No server, browser, credentials or network.
 */
import { requireTypeStripping } from './tsResolve.mjs';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { after, beforeEach, test } from 'node:test';
import ts from 'typescript';

requireTypeStripping('testForum');

const root = path.resolve(import.meta.dirname, '..');

/* ----- a fake browser, enough for the modules under test ----------------------------------- */

class MemoryStorage {
  constructor() { this.map = new Map(); this.refuse = false; }
  getItem(key) { return this.map.has(key) ? this.map.get(key) : null; }
  setItem(key, value) { if (this.refuse) throw new Error('QuotaExceededError'); this.map.set(key, String(value)); }
  removeItem(key) { this.map.delete(key); }
  clear() { this.map.clear(); }
}

const storage = new MemoryStorage();
const originalFetch = globalThis.fetch;
globalThis.localStorage = storage;
globalThis.window = { __picponyRoutePolicy: { api: 'direct', image: 'direct' }, location: { origin: 'https://app.invalid' } };
globalThis.fetch = async () => { throw new Error('Unexpected request during initialization'); };

const model = await import('../lib/forumModel.ts');
const forum = await import('../lib/api/forum.ts');
const { ApiError } = await import('../lib/api/errors.ts');
const text = await import('../lib/forumText.ts');
const drafts = await import('../lib/forumDraft.ts');
const images = await import('../lib/forumImages.ts');
const { forumListKey, DEFAULT_FORUM_LIST } = await import('../lib/forumKeys.ts');

let calls;
let respond;
beforeEach(() => {
  storage.clear();
  storage.refuse = false;
  calls = [];
  respond = () => Response.json({});
  globalThis.fetch = async (url, init = {}) => {
    const request = { url: new URL(String(url), 'https://app.invalid'), init };
    calls.push(request);
    return respond(request);
  };
});
after(() => {
  globalThis.fetch = originalFetch;
});

/* ----- the model ---------------------------------------------------------------------------- */

const author = { id: 3, username: 'u', avatar: null, role: 'admin', experience: 250, equipped_badges: [{ id: 1, name: 'A', color: '#fff' }] };
const wirePost = (overrides = {}) => ({
  id: 7, user_id: 3, title: 'T', excerpt: '  简介  ', content: { type: 'discussion', html: 'c' }, cover_image: '  ',
  category: 'discussion', is_pinned: true, views: 12, revision: 4, created_at: '2026-01-01T02:00:00Z',
  updated_at: '2026-01-02T02:00:00Z', author, reply_count: 0, like_count: 2, is_liked: true, ...overrides,
});

test('rows are read at the boundary: the author, the badges, the body by kind', () => {
  const post = model.postOf(wirePost());
  assert.equal(post.id, 7);
  assert.equal(post.content, 'c');
  assert.equal(post.excerpt, '简介');
  assert.deepEqual([post.views, post.reply_count, post.like_count, post.revision], [12, 0, 2, 4]);
  assert.deepEqual([post.is_pinned, post.is_liked], [true, true]);
  assert.equal(post.cover_image, null, 'a blank cover is none');
  assert.deepEqual([post.username, post.role, post.experience], ['u', 'admin', 250]);
  assert.deepEqual(post.badges, [{ badge_name: 'A', badge_color: '#fff' }]);
  assert.equal(model.sortOf('views'), 'views');

  const commission = model.postOf(wirePost({ category: 'commission', content: { type: 'commission', description: '[b]d[/b]', commission_link: 'https://x.test' } }));
  assert.deepEqual([commission.content, commission.commission_link, commission.shared_groups], ['[b]d[/b]', 'https://x.test', null]);
  const share = model.postOf(wirePost({
    category: 'taggroups',
    content: { type: 'taggroups', description: '说明', tag_groups: [{ name: '小马', tags: ['pony'] }], block_groups: [{ name: '屏蔽', hidden_tags: ['gore'], spoilered_tags: ['blood'] }] },
  }));
  assert.equal(share.content, '说明');
  assert.deepEqual(share.shared_groups, {
    tagGroups: [{ name: '小马', tags: ['pony'] }],
    blockGroups: [{ name: '屏蔽', hidden_tags: ['gore'], spoilered_tags: ['blood'] }],
  }, 'a shared block group carries its hidden and its 打码 tags');
});

test('a post is written as the backend’s typed document, by kind', () => {
  assert.deepEqual(model.contentWire('discussion', 'c', '', null), { type: 'discussion', html: 'c' });
  assert.deepEqual(model.contentWire('commission', 'd', ' https://x.test ', null), { type: 'commission', description: 'd', commission_link: 'https://x.test' });
  assert.deepEqual(
    model.contentWire('taggroups', '说明', '', {
      tag_groups: [{ name: 'g', tags: ['a'] }],
      block_groups: [{ name: 'b', hidden_tags: ['x'], spoilered_tags: ['y'] }],
    }),
    { type: 'taggroups', description: '说明', tag_groups: [{ name: 'g', tags: ['a'] }], block_groups: [{ name: 'b', hidden_tags: ['x'], spoilered_tags: ['y'] }] },
  );
  assert.equal(model.isCommissionLink('http://x.test'), true);
  assert.equal(model.isCommissionLink('ftp://x.test'), false);
});

test('the list key normalises its defaults, so the server seed and the first read agree', () => {
  assert.equal(forumListKey({ page: 1 }), forumListKey(DEFAULT_FORUM_LIST));
  assert.equal(forumListKey({ page: 1, category: 'all', sort: 'updated_at', search: '  ', token: null }), forumListKey({ page: 1 }));
  assert.notEqual(forumListKey({ page: 1, token: 'a' }), forumListKey({ page: 1 }), 'a signed-in list is its own answer');
});

/* ----- the transport ------------------------------------------------------------------------- */

test('the list read sends the category, the order and a trimmed search, and names the session', async () => {
  respond = () => Response.json({ posts: [wirePost({ id: 1 })], total: 1, page: 2, total_pages: 0 });
  const list = await forum.getForumPosts({ page: 2, category: 'commission', sort: 'views', search: '  pony ', token: 'T' });
  assert.equal(calls[0].url.pathname, '/api/v1/forum/posts');
  const query = calls[0].url.searchParams;
  assert.deepEqual([query.get('page'), query.get('category'), query.get('sort'), query.get('search')], ['2', 'commission', 'views', 'pony']);
  assert.equal(new Headers(calls[0].init.headers).get('Authorization'), 'Bearer T');
  assert.deepEqual(list.posts.map((post) => post.id), [1]);
  assert.deepEqual([list.total, list.totalPages, list.signedIn], [1, 1, true]);

  await forum.getForumPosts({ page: 1, category: 'all', search: '   ' });
  assert.equal(calls[1].url.searchParams.has('search'), false, 'an empty search is not sent');
  assert.equal(calls[1].url.searchParams.has('category'), false, '「all」 is no category');
});

test('a thread is its post and a page of replies; past its last page it is that page; a missing thread is not found', async () => {
  respond = ({ url }) => url.pathname.endsWith('/comments')
    ? Response.json({
      comments: url.searchParams.get('page') === '2'
        ? [{ id: 21, post_id: 5, user_id: 3, content: 'r', created_at: 'x', author }]
        : [],
      total: 21, total_pages: 2,
    })
    : Response.json({ post: wirePost({ id: 5 }) });
  const detail = await forum.getForumPostDetail('5', 9999, undefined, 'T');
  assert.equal(detail.page, 2);
  assert.equal(detail.total_comments, 21);
  assert.deepEqual(detail.comments.map((row) => [row.id, row.username]), [[21, 'u']]);
  assert.equal(calls.filter((call) => call.url.pathname === '/api/v1/forum/posts/5').length, 1, 'the post is read once');
  respond = () => Response.json({ error: { code: 'POST_NOT_FOUND', message: '帖子不存在' } }, { status: 404 });
  await assert.rejects(forum.getForumPostDetail('404'), (error) => error instanceof ApiError && error.notFound && !error.retryable);
  respond = () => Response.json({ error: { code: 'BAD_REQUEST', message: '无效' } }, { status: 400 });
  await assert.rejects(forum.getForumPostDetail('x'), (error) => error instanceof ApiError && error.notFound, 'a malformed id is not found too');
});

test('writes speak /api/v1, carry their Idempotency-Key, and fail as sentences', async () => {
  respond = () => Response.json({ id: 42, revision: 0 }, { status: 201 });
  const body = {
    title: '标题标题标题', excerpt: '', content: 'c', commission_link: '', category: 'discussion', cover_image: null,
    shared_groups: null,
  };
  assert.equal(await forum.createForumPost('T', body, 'k1'), 42);
  assert.equal(calls[0].url.pathname, '/api/v1/forum/posts');
  assert.equal(new Headers(calls[0].init.headers).get('Idempotency-Key'), 'k1');
  assert.deepEqual(JSON.parse(calls[0].init.body), {
    title: '标题标题标题', excerpt: '', content: { type: 'discussion', html: 'c' }, cover_image: null,
  });

  respond = () => Response.json({ id: 42, revision: 5 });
  assert.equal(await forum.updateForumPost('T', 42, body, 4, 'k2'), 5);
  assert.equal(calls.at(-1).init.method, 'PUT');
  assert.equal(calls.at(-1).url.pathname, '/api/v1/forum/posts/42');
  assert.equal(JSON.parse(calls.at(-1).init.body).expected_revision, 4);

  respond = () => new Response(null, { status: 204 });
  await forum.deleteForumPost('T', 42);
  assert.deepEqual([calls.at(-1).init.method, calls.at(-1).url.pathname], ['DELETE', '/api/v1/forum/posts/42']);
  await forum.deleteForumComment('T', 9);
  assert.deepEqual([calls.at(-1).init.method, calls.at(-1).url.pathname], ['DELETE', '/api/v1/forum/comments/9']);

  respond = () => Response.json({ id: 1, content: 'hi' }, { status: 201 });
  await forum.createForumComment('T', { postId: 42, content: 'hi', replyToUserId: 3 }, 'k3');
  assert.equal(calls.at(-1).url.pathname, '/api/v1/forum/posts/42/comments');
  assert.deepEqual(JSON.parse(calls.at(-1).init.body), { content: 'hi', reply_to_user_id: 3 });
  await forum.createForumComment('T', { postId: 42, content: 'top' }, 'k4');
  assert.deepEqual(JSON.parse(calls.at(-1).init.body), { content: 'top' }, 'a top-level reply names nobody');

  respond = () => Response.json({ liked: true, like_count: 8 });
  assert.deepEqual(await forum.setForumPostLike('T', 42, true), { liked: true, count: 8 });
  assert.deepEqual([calls.at(-1).init.method, calls.at(-1).url.pathname, JSON.parse(calls.at(-1).init.body)],
    ['PUT', '/api/v1/me/forum/posts/42/like', { liked: true }]);

  respond = () => Response.json({ error: { code: 'POST_VERSION_CONFLICT', message: '帖子已更新，请刷新后重试' } }, { status: 409 });
  await assert.rejects(forum.updateForumPost('T', 42, body, 4, 'k5'), (error) => error instanceof ApiError && error.message === '帖子已更新，请刷新后重试');

  respond = () => Response.json({ id: 9, revision: 0 }, { status: 201 });
  await forum.createForumPost('T', {
    ...body, category: 'taggroups', shared_groups: { tag_groups: [], block_groups: [{ name: 'b', hidden_tags: [], spoilered_tags: ['s'] }] },
  }, 'k6');
  assert.deepEqual(JSON.parse(calls.at(-1).init.body).content.block_groups, [{ name: 'b', hidden_tags: [], spoilered_tags: ['s'] }],
    'a block group\'s 打码 tags travel in a share');

  respond = () => Response.json({ id: 1, revision: 0 }, { status: 201 });
  await forum.importSharedTagGroup('T', { name: 'g', tags: ['a'] });
  assert.deepEqual([calls.at(-1).url.pathname, JSON.parse(calls.at(-1).init.body)], ['/api/v1/me/tag-group-imports', { name: 'g', tags: ['a'] }]);
  await forum.importSharedBlockGroup('T', { name: 'b', hidden_tags: ['x'], spoilered_tags: [] });
  assert.deepEqual([calls.at(-1).url.pathname, JSON.parse(calls.at(-1).init.body)],
    ['/api/v1/me/block-group-imports', { name: 'b', hidden_tags: ['x'], spoilered_tags: [], active: false }]);

  respond = () => Response.json({ tag_groups: [{ id: 1, name: 'g', tags: ['a'], revision: 0 }], block_groups: [{ id: 2, name: 'b', hidden_tags: ['h'], spoilered_tags: [], revision: 1 }] });
  assert.deepEqual(await forum.getMyShareableGroups('T'), {
    tagGroups: [{ id: 1, name: 'g', tags: ['a'] }],
    blockGroups: [{ id: 2, name: 'b', hidden_tags: ['h'], spoilered_tags: [] }],
  });
});

class FakeXHR {
  static last = null;
  constructor() {
    FakeXHR.last = this;
    this.upload = {};
    this.headers = {};
    this.status = 0;
    this.responseText = '';
  }
  open(method, url) { this.method = method; this.url = url; }
  setRequestHeader(name, value) { this.headers[name] = value; }
  send(body) { this.body = body; }
  abort() { this.onabort?.(); }
  respond(status, body) {
    this.status = status;
    this.responseText = typeof body === 'string' ? body : JSON.stringify(body);
    this.onload?.();
  }
}

test('a picture uploads over XHR with progress and the session’s CSRF token, and every failure is a sentence', async () => {
  globalThis.XMLHttpRequest = FakeXHR;
  globalThis.FormData = class { constructor() { this.parts = []; } append(...args) { this.parts.push(args); } };
  const asset = 'a'.repeat(64);
  const progress = [];
  let pending = forum.uploadForumImage('T', new Blob(['x']), { onProgress: (fraction) => progress.push(fraction) });
  const xhr = FakeXHR.last;
  assert.equal(xhr.method, 'POST');
  assert.equal(xhr.url, '/api/v1/me/uploads/forum-images');
  assert.equal(xhr.headers.Authorization, 'Bearer T');
  assert.equal(xhr.body.parts[0][0], 'image');
  xhr.upload.onprogress({ lengthComputable: true, loaded: 50, total: 100 });
  xhr.respond(201, { asset, url: `/api/v1/media/${asset}`, mime: 'image/png', size_bytes: 1, width: 1, height: 1, expires_at: 'x', max_bytes: 5 });
  assert.equal(await pending, `/api/v1/media/${asset}`);
  assert.deepEqual(progress, [0.5, 1]);

  pending = forum.uploadForumImage('T', new Blob(['x']));
  FakeXHR.last.respond(413, { error: { code: 'FILE_TOO_LARGE', message: '文件超过该用途的上传限制' } });
  await assert.rejects(pending, (error) => error instanceof ApiError && error.message === '图片太大，服务器拒绝了这次上传');

  pending = forum.uploadForumImage('T', new Blob(['x']));
  FakeXHR.last.respond(400, { error: { code: 'BAD_REQUEST', message: '图片格式不支持' } });
  await assert.rejects(pending, (error) => error instanceof ApiError && error.message === '图片格式不支持');

  pending = forum.uploadForumImage('T', new Blob(['x']));
  FakeXHR.last.respond(201, '<html></html>');
  await assert.rejects(pending, (error) => error instanceof ApiError && error.kind === 'invalid');

  const controller = new AbortController();
  pending = forum.uploadForumImage('T', new Blob(['x']), { signal: controller.signal });
  controller.abort();
  await assert.rejects(pending, (error) => error.name === 'AbortError', 'a cancelled upload stays a cancellation');
});

test('a picture is checked before it is sent: kind, size, and a GIF is never redrawn', async () => {
  const file = (type, size) => ({ type, size, name: 'f' });
  await assert.rejects(images.prepareForumImage(file('text/plain', 10)), /请选择图片文件/);
  await assert.rejects(images.prepareForumImage(file('image/png', 60 * 1024 * 1024)), /50MB/);
  await assert.rejects(images.prepareForumImage(file('image/gif', 6 * 1024 * 1024)), /动图超过 5MB/);
  const small = file('image/gif', 1024);
  assert.equal(await images.prepareForumImage(small), small, 'a small picture goes as it is');
  globalThis.createImageBitmap = async () => { throw new Error('cannot decode'); };
  await assert.rejects(images.prepareForumImage(file('image/heic', 6 * 1024 * 1024)), /无法在浏览器中压缩/);
  assert.equal(images.storedAssetPath(`https://picpony.top/api/v1/media/${'a'.repeat(64)}`), `/api/v1/media/${'a'.repeat(64)}`);
  assert.equal(images.storedAssetPath('https://derpicdn.net/a.png'), 'https://derpicdn.net/a.png');
});

/* ----- words ---------------------------------------------------------------------------------- */

test('a quote is built from the words it answers: no tags, no nested quote, no cut mid-tag (R6-031)', () => {
  const quoted = text.replyQuote('fl"utter]shy', '[quote="a"]旧的[/quote]逆天图？[img]/uploads/forum/x.png[/img]');
  assert.match(quoted, /^\[quote="fluttershy"\]\n/);
  assert.doesNotMatch(quoted, /\[img\]|旧的/);
  assert.match(quoted, /逆天图？/);
  assert.match(quoted, /\[图片\]/);
  const long = text.replyQuote('u', `[url=https://example.test/${'a'.repeat(200)}]链接[/url]${'字'.repeat(150)}`);
  const inner = long.slice(long.indexOf('\n') + 1, long.indexOf('\n[/quote]'));
  assert.ok(Array.from(inner).length <= text.QUOTE_LENGTH + 1);
  assert.doesNotMatch(inner, /\[|\]/, 'nothing left open');
  assert.equal(text.replyQuote('u', '[img]/a.png[/img]').includes('[图片]'), true, 'a picture alone is 「[图片]」');
});

test('a teaser prefers the 简介, then the body’s own words', () => {
  const base = { title: '标题', excerpt: '', category: 'discussion' };
  assert.equal(text.forumTeaser({ ...base, excerpt: '简介', content: '正文' }), '简介');
  assert.equal(text.forumTeaser({ ...base, content: '[img]/a.png[/img]正文[b]粗[/b]' }), '正文粗');
  assert.equal(text.forumTeaser({ ...base, category: 'commission', content: '', commission_link: 'https://x.test' }), '附有约稿链接');
  const shared_groups = { tagGroups: [{ name: 'a', tags: [] }], blockGroups: [] };
  assert.equal(text.forumTeaser({ ...base, category: 'taggroups', content: '', shared_groups }), '分享了 1 个标签组');
  assert.equal(text.isBlankRichText('[p][br][/p]'), true);
  assert.equal(text.isBlankRichText('[img]/a.png[/img]'), false, 'a picture is something to send');
});

/* ----- the draft ------------------------------------------------------------------------------- */

test('a draft is kept per account and per post, and an empty one is not kept (R6-042)', () => {
  const draft = { ...drafts.EMPTY_DRAFT, title: '写到一半', content: '[b]内容[/b]' };
  drafts.writeDraft('1', null, draft);
  assert.equal(drafts.readDraft('2', null), null, 'another account sees nothing');
  const read = drafts.readDraft('1', null);
  assert.equal(read.title, '写到一半');
  assert.equal(read.content, '[b]内容[/b]');
  assert.equal(typeof read.savedAt, 'number');
  drafts.writeDraft('1', 42, { ...draft, title: '修改' });
  assert.equal(drafts.readDraft('1', 42).title, '修改');
  assert.equal(drafts.readDraft('1', null).title, '写到一半', 'an edit is its own draft');
  drafts.writeDraft('1', null, { ...drafts.EMPTY_DRAFT, content: '[p][br][/p]' });
  assert.equal(drafts.readDraft('1', null), null, 'emptied, it is removed');
  drafts.clearDraft('1', 42);
  assert.equal(drafts.readDraft('1', 42), null);
  storage.refuse = true;
  assert.doesNotThrow(() => drafts.writeDraft('1', null, draft), 'refused storage is not an error');
});

test('the original front end’s draft is adopted once, by the first account to write', () => {
  storage.setItem('forum_post_draft', JSON.stringify({
    title: '旧草稿', excerpt: '', content: '<p><br></p>', category: 'commission', commissionLink: 'https://x.test',
    taggroupsDescription: '', draftImages: ['/uploads/forum/a.png'],
  }));
  const adopted = drafts.readDraft('1', null);
  assert.equal(adopted.title, '旧草稿');
  assert.equal(adopted.category, 'commission');
  assert.equal(adopted.commissionLink, 'https://x.test');
  assert.deepEqual(adopted.images, [], 'its pictures were staged on the old backend, which the new one refuses');
  assert.equal(storage.getItem('forum_post_draft'), null, 'removed once it is this account’s');
  assert.equal(drafts.readDraft('2', null), null, 'and nobody else adopts it');
  assert.equal(drafts.readDraft('1', null).title, '旧草稿');
});

/* ----- components, through a small hook runner ------------------------------------------------ */

function load(file, dependencies = {}, globals = {}) {
  const code = ts.transpileModule(readFileSync(path.join(root, file), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  const exports = {};
  vm.runInNewContext(code, {
    exports, require: (name) => {
      if (name in dependencies) return dependencies[name];
      if (name === 'next/dynamic') return { default: () => 'DynamicComponent' };
      return new Proxy({}, { get: (_, key) => key === '__esModule' ? true : `${name}:${String(key)}` });
    }, URLSearchParams, URL, setTimeout, clearTimeout, queueMicrotask, console, JSON, ...globals,
  }, { filename: file });
  return exports;
}

function harness() {
  const slots = [];
  const cleanups = [];
  let cursor = 0;
  let pending = [];
  const react = {
    useState(initial) {
      const index = cursor++;
      if (!(index in slots)) slots[index] = typeof initial === 'function' ? initial() : initial;
      return [slots[index], (next) => { slots[index] = typeof next === 'function' ? next(slots[index]) : next; }];
    },
    useRef(initial) {
      const index = cursor++;
      return slots[index] ??= { current: initial };
    },
    useId: () => 'id',
    useEffect(callback, deps) {
      const index = cursor++;
      const previous = slots[index];
      if (!deps || !previous || deps.some((value, offset) => !Object.is(value, previous[offset]))) {
        slots[index] = deps ?? [];
        pending.push(() => { cleanups[index]?.(); cleanups[index] = callback(); });
      }
    },
  };
  react.useLayoutEffect = react.useEffect;
  const jsx = (type, props) => ({ type, props });
  return {
    dependencies: { react, 'react/jsx-runtime': { jsx, jsxs: jsx, Fragment: 'Fragment' } },
    render: (component) => { cursor = 0; return component(); },
    effects: () => { const run = pending; pending = []; run.forEach((effect) => effect()); },
    dispose: () => cleanups.forEach((cleanup) => cleanup?.()),
  };
}

function find(tree, predicate) {
  if (!tree || typeof tree !== 'object') return undefined;
  if (Array.isArray(tree)) {
    for (const item of tree) { const result = find(item, predicate); if (result) return result; }
    return undefined;
  }
  if (predicate(tree)) return tree;
  for (const value of Object.values(tree.props ?? {})) {
    const result = find(value, predicate);
    if (result) return result;
  }
  return undefined;
}
const byType = (tree, type) => find(tree, (node) => node.type === type);
const byLabel = (tree, label) => find(tree, (node) => node.props?.label === label);
const flush = () => new Promise((resolve) => setImmediate(resolve));

test('the post form checks every field, blocks on an upload, sends once and keeps the draft until it lands', async () => {
  const hooks = harness();
  const created = [];
  let createReply = null;
  const toasts = [];
  const saved = [];
  const cleared = [];
  const done = [];
  const timers = [];
  const fakeWindow = {
    setTimeout: (callback) => { timers.push(callback); return timers.length; },
    clearTimeout: () => {},
    addEventListener() {}, removeEventListener() {},
  };
  const { default: PostComposer } = load('components/forum/PostComposer.tsx', {
    ...hooks.dependencies,
    '@/components/ConfirmDialog': { useConfirm: () => ({ confirm: async () => true, confirmDialog: null }) },
    '@/components/Toast': { showToast: (message) => toasts.push(message) },
    '@/components/RichTextEditorShell': { EditorPlaceholder: 'EditorPlaceholder' },
    '@/components/forum/SharedGroupsPicker': { default: 'SharedGroupsPicker', sharedGroupsOf: () => ({ tag_groups: [], block_groups: [] }) },
    '@/lib/api/forum': {
      ...model,
      createForumPost: async (token, body, key) => { created.push({ token, body, key }); return createReply(); },
      updateForumPost: async () => {},
    },
    '@/lib/api/errors': { apiErrorMessage: (error, fallback) => error?.message || fallback },
    '@/lib/api/idempotency': await import('../lib/api/idempotency.ts'),
    '@/lib/bbcode': { firstImageOf: (value) => /\[img\](.*?)\[\/img\]/.exec(value)?.[1] ?? null },
    '@/lib/forumDraft': {
      EMPTY_DRAFT: drafts.EMPTY_DRAFT,
      readDraft: () => null,
      writeDraft: (...args) => saved.push(args),
      clearDraft: (...args) => cleared.push(args),
    },
    '@/lib/forumImages': { storedAssetPath: images.storedAssetPath },
    '@/lib/forumText': { isBlankRichText: text.isBlankRichText },
    '@/lib/format': { formatShortDateTime: () => 'time' },
    '@/lib/hooks': { readToken: () => 'T' },
    '@/lib/icons': { ICON: { control: 20, dense: 18 } },
    '@/lib/resources': { shareableGroups: { peek: () => ({ data: undefined }) } },
  }, { window: fakeWindow, document: { addEventListener() {}, removeEventListener() {}, visibilityState: 'visible' } });

  const props = { userId: '1', token: 'T', onDone: (...args) => done.push(args), onCancel() {} };
  let tree = hooks.render(() => PostComposer(props));
  hooks.effects();
  const submit = async () => {
    await byType(tree, 'form').props.onSubmit({ preventDefault() {} });
    await flush();
    tree = hooks.render(() => PostComposer(props));
    hooks.effects();
  };

  byLabel(tree, '标题').props.onChange({ target: { value: '短' } });
  tree = hooks.render(() => PostComposer(props));
  await submit();
  assert.equal(created.length, 0);
  assert.equal(byLabel(tree, '标题').props.error, '标题至少需要 5 个字符', 'the message is the field’s');
  assert.equal(byType(tree, 'DynamicComponent').props.invalid, true, 'and an empty body is flagged at the editor');
  assert.deepEqual(toasts, [], 'no toast for a problem that belongs to a field');

  byLabel(tree, '标题').props.onChange({ target: { value: '一个足够长的标题' } });
  tree = hooks.render(() => PostComposer(props));
  byType(tree, 'DynamicComponent').props.onChange(`[img]https://picpony.top/api/v1/media/${'c'.repeat(64)}[/img]正文`);
  byType(tree, 'DynamicComponent').props.onUploaded(`/api/v1/media/${'c'.repeat(64)}`);
  byType(tree, '@/components/forum/CoverField:default').props.onBusyChange(true);
  tree = hooks.render(() => PostComposer(props));
  assert.equal(byLabel(tree, '标题').props.error, undefined, 'typing clears the field’s message');
  await submit();
  assert.equal(created.length, 0, 'a cover still uploading holds the post');
  assert.ok(find(tree, (node) => node.type === 'p' && node.props.children === '图片还在上传，请稍候'));

  byType(tree, '@/components/forum/CoverField:default').props.onBusyChange(false);
  tree = hooks.render(() => PostComposer(props));
  createReply = async () => { throw new ApiError('network'); };
  await submit();
  assert.equal(created.length, 1);
  /* Through JSON: the component runs in its own realm, whose objects have their own prototype. */
  assert.deepEqual(JSON.parse(JSON.stringify(created[0].body)), {
    title: '一个足够长的标题', excerpt: '', category: 'discussion',
    content: `[img]https://picpony.top/api/v1/media/${'c'.repeat(64)}[/img]正文`, commission_link: '',
    cover_image: `/api/v1/media/${'c'.repeat(64)}`, shared_groups: null,
  }, 'the first picture stands in for the cover, in its stored form');
  assert.equal(done.length, 0);
  assert.equal(cleared.length, 0, 'a failed publish keeps the draft');

  timers.splice(0).forEach((callback) => callback());
  assert.equal(saved.at(-1)?.[2].title, '一个足够长的标题', 'the form is saved as it changes');

  createReply = async () => 88;
  await submit();
  assert.equal(created.length, 2, 'retried by the writer');
  assert.equal(created[1].key, created[0].key, 'a retry after a lost answer is the same post (one Idempotency-Key)');
  assert.deepEqual(done.map(([id]) => id), [88]);
  assert.deepEqual(JSON.parse(JSON.stringify(cleared.at(-1))), ['1', null], 'published: the draft goes');
  assert.deepEqual(toasts, ['已发布']);
  const savesBefore = saved.length;
  timers.splice(0).forEach((callback) => callback());
  hooks.dispose();
  assert.equal(saved.length, savesBefore, 'nothing is written back after the post is out');
});

test('a reply’s floor number does not assume the page size (R6-038)', () => {
  const { floorOf } = load('components/forum/ThreadComments.tsx', { react: { memo: (component) => component }, 'react/jsx-runtime': { jsx() {}, jsxs() {} } });
  assert.equal(floorOf(0, 1, 3, 15, 40), 1);
  assert.equal(floorOf(4, 2, 3, 15, 40), 20, 'a full page before the last');
  assert.equal(floorOf(0, 3, 3, 10, 40), 31, 'the last page ends at the total');
  assert.equal(floorOf(9, 3, 3, 10, 40), 40);
  assert.equal(floorOf(2, 1, 1, 3, 3), 3);
});

/* ----- the container transform: its geometry and its clock ---------------------------------- */

const container = await import('../lib/forumContainer.ts');
const heroConstants = await import('../lib/hero/constants.ts');
const spring = await import('../lib/spring.ts');

test('the container transform’s clip is the container at every sample, in both of its forms', () => {
  const card = { left: 416, top: 96, width: 896, height: 724 };
  const row = { left: 416, top: 416, width: 896, height: 112 };
  const narrow = { left: 430, top: 300, width: 860, height: 120 };
  const cases = [
    [card, row, container.shutterLevels({ left: 416, width: 896 })],
    [card, narrow, container.shutterLevels(null)],
    [row, card, container.shutterLevels(null)],
  ];
  assert.ok(container.sameColumn(card, row));
  assert.ok(!container.sameColumn(card, narrow));
  for (const [from, to, levels] of cases) {
    for (let i = 0; i <= 20; i += 1) {
      const box = container.boxAt(from, to, container.forumTransformProgress(i / 20));
      const { clip, origin } = container.resolveShutter(levels, box);
      for (const key of ['left', 'top', 'width', 'height']) assert.ok(Math.abs(clip[key] - box[key]) < 1e-6, `${key} at ${i}`);
      /* The content frame sits at the container's top left: the contents ride it, unscaled. */
      assert.ok(Math.abs(origin[0] - box.left) < 1e-6 && Math.abs(origin[1] - box.top) < 1e-6);
    }
    /* Every clipping level owns a corner of its own, and all four are owned. */
    const owned = levels.flatMap((level) => level.corners).sort();
    assert.deepEqual(owned, [0, 1, 2, 3]);
  }
});

test('the container flies the picture flight’s spring: Compose’s shared-element spring, moving from its first frame, never past its rectangle', () => {
  const p = container.forumTransformProgress;
  /* One gesture, one motion: the flight's clock and the flight spring's shape (`FLIGHT_SPRING`). */
  assert.equal(container.FORUM_TRANSFORM_MS, heroConstants.HERO_DURATIONS.forward);
  assert.equal(container.FORUM_TRANSFORM_MS, spring.springDurationMs(spring.FLIGHT_SPRING));
  assert.equal(container.FORUM_TRANSFORM_EASING, spring.springToLinear(spring.FLIGHT_SPRING));
  assert.equal(p(0), 0);
  assert.equal(p(1), 1);
  const frame = 1000 / 60 / container.FORUM_TRANSFORM_MS;
  const steps = [];
  for (let t = frame; t < 1 + frame; t += frame) steps.push(p(Math.min(1, t)) - p(t - frame));
  /* It answers the press on the next frame and only gains speed for a frame or two. */
  assert.ok(steps[0] > 0.02, `first frame ${steps[0]}`);
  const fastest = steps.indexOf(Math.max(...steps));
  assert.ok(fastest >= 1 && fastest <= 4, `fastest frame ${fastest}`);
  const at = (q) => {
    for (let ms = 0; ms <= container.FORUM_TRANSFORM_MS; ms += 0.5) if (p(ms / container.FORUM_TRANSFORM_MS) >= q) return ms;
    return Infinity;
  };
  /* Unhurried but not slow: half by ~53ms, nine tenths by ~123ms, then a soft settle. */
  assert.ok(at(0.5) < 100, `half at ${at(0.5)}`);
  assert.ok(at(0.9) < 220, `nine tenths at ${at(0.9)}`);
  assert.ok(steps.at(-1) < 0.003, `last frame ${steps.at(-1)}`);
  for (let t = 0; t < 1; t += 0.01) assert.ok(p(t + 0.01) >= p(t), 'monotone: nothing overshoots its rectangle');
});

test('the contents hand over on the flight’s windows, one after the other', () => {
  const { open, back } = container.FORUM_FADE;
  /* Opening: the row goes over the first stretch, as a card's marks go at take-off; the page comes
     in over the flight's content window. Returning: the page goes from the first frame and the row
     comes in once the container is most of the way home. */
  assert.deepEqual(open.incoming, heroConstants.HERO_CONTENT_FADE.forward);
  assert.deepEqual(back.outgoing, heroConstants.HERO_CONTENT_FADE.back);
  assert.deepEqual(back.incoming, heroConstants.HERO_CONTAINER_FADE.back);
  assert.equal(open.outgoing.start, 0);
  assert.equal(back.outgoing.start, 0);
  /* Never two contents on screen at once: anchored at one corner and unscaled, two lines of text
     that do not line up read as one doubled line. */
  for (const leg of [open, back]) {
    assert.ok(leg.outgoing.end <= leg.incoming.start + 1e-9, 'the outgoing content is gone before the incoming one comes');
    for (let p = 0; p <= 1; p += 0.01) {
      const shown = container.fadeAt(leg.outgoing, p, true) + container.fadeAt(leg.incoming, p);
      assert.ok(shown <= 1 + 1e-9, `both at ${p}`);
    }
  }
  assert.ok(back.incoming.start >= 0.5, 'returning, the row arrives late');
});

test('the container starts from what is on screen of a card, and not at all from nothing', () => {
  const view = { left: 300, top: 76, width: 1128, height: 812 };
  assert.deepEqual(container.visibleBox({ left: 416, top: -400, width: 896, height: 2385 }, view), { left: 416, top: 76, width: 896, height: 812 });
  assert.equal(container.visibleBox({ left: 416, top: 900, width: 896, height: 112 }, view), null);
  assert.deepEqual(container.radiiAt([12, 12, 12, 12], [4, 4, 16, 16], 0.5), [8, 8, 14, 14]);
});

test('a fresh leg fades each content over its window, exactly as the window states it', () => {
  for (const leg of [container.FORUM_FADE.open, container.FORUM_FADE.back]) {
    const window = leg.incoming;
    assert.deepEqual(container.fadeTrack(window, 0, 1), [
      { offset: 0, opacity: 0 },
      { offset: window.start, opacity: 0 },
      { offset: window.end, opacity: 1 },
      { offset: 1, opacity: 1 },
    ]);
    /* The outgoing one starts with the leg: no keyframe at its own start but the leg's. */
    assert.deepEqual(container.fadeTrack(leg.outgoing, 0, 1, true), [
      { offset: 0, opacity: 1 },
      { offset: leg.outgoing.end, opacity: 0 },
      { offset: 1, opacity: 0 },
    ]);
  }
});

/** The track's opacity at progress `u`, read off its keyframes the way Web Animations does. */
function trackAt(track, u) {
  for (let i = 1; i < track.length; i += 1) {
    const a = track[i - 1];
    const b = track[i];
    if (u <= b.offset) return b.offset === a.offset ? b.opacity : a.opacity + ((b.opacity - a.opacity) * (u - a.offset)) / (b.offset - a.offset);
  }
  return track[track.length - 1].opacity;
}

test('a turned leg sends each content back over the same stretch of travel it came over', () => {
  const windows = [container.FORUM_FADE.open, container.FORUM_FADE.back].flatMap((leg) => [
    [leg.outgoing, true],
    [leg.incoming, false],
  ]);
  for (const [window, out] of windows) {
    for (const p of [0.02, 0.1, 0.3, 0.45, 0.62, 0.8, 0.95, 1]) {
      for (const to of [0, 1]) {
        const track = container.fadeTrack(window, p, to, out);
        for (let i = 1; i < track.length; i += 1) assert.ok(track[i].offset > track[i - 1].offset, 'offsets climb');
        assert.equal(track[0].offset, 0);
        assert.equal(track.at(-1).offset, 1);
        for (let u = 0; u <= 1.0001; u += 0.025) {
          const expected = container.fadeAt(window, p + (to - p) * Math.min(1, u), out);
          assert.ok(Math.abs(trackAt(track, Math.min(1, u)) - expected) < 1e-9, `p ${p} → ${to} at ${u}`);
        }
        /* It leaves from exactly what was on screen at the turn: no step in the content's opacity. */
        assert.ok(Math.abs(track[0].opacity - container.fadeAt(window, p, out)) < 1e-12);
      }
    }
  }
});

test('a turn leaves from where the container is, at once, on the curve, over what is left of the way', () => {
  const full = container.FORUM_TRANSFORM_MS;
  const leg = container.freshContainerLeg(full);
  const frame = 1000 / 60;
  for (const elapsed of [frame, 30, 60, 120, 180, full]) {
    const turned = container.turnContainer(leg, elapsed, full);
    const p = container.forumTransformProgress(elapsed / full);
    assert.ok(Math.abs(turned.from - p) < 1e-9, 'from the pose on screen');
    assert.equal(turned.to, 0, 'back towards the first end');
    /* The flight's reversal rule: a share of a full leg that shrinks with the way left to undo,
       never under its floor. */
    const share = Math.max(
      heroConstants.HERO_REVERSE_MIN_DURATION_MS / full,
      heroConstants.HERO_REVERSE_BASE_RATIO + heroConstants.HERO_REVERSE_TRAVEL_RATIO * Math.sqrt(p),
    );
    assert.ok(Math.abs(turned.duration - full * share) < 1e-9, `duration ${turned.duration}`);
    assert.ok(turned.duration <= full + 1e-9);
    /* It moves on its first frame, the way it was sent, and lands on its end without passing it. */
    const travel = (ms) => container.legAt(turned, ms).travel;
    assert.ok(travel(frame) < turned.from - 1e-6, `elapsed ${elapsed}: still on the first frame`);
    for (let ms = 0; ms < turned.duration; ms += 1) assert.ok(travel(ms + 1) <= travel(ms) + 1e-12, 'one way');
    assert.ok(Math.abs(travel(turned.duration)) < 1e-12, 'lands on the first end');
  }
  /* A turn of a turn heads for the second end again, from where the turned leg had got to. */
  const back = container.turnContainer(leg, 120, full);
  const again = container.turnContainer(back, 40, full);
  assert.equal(again.to, 1);
  assert.ok(again.from < back.from, 'from where the turned leg had got to');
  assert.ok(Math.abs(again.from - container.legAt(back, 40).travel) < 1e-12);
});

test('a turn reads the container off the leg on the display’s clock: the clip the shutters draw then, tone and corners with it', () => {
  const full = container.FORUM_TRANSFORM_MS;
  const leg = container.freshContainerLeg(full);
  const card = { box: { left: 603, top: 309, width: 253, height: 249.8 }, radii: [12, 12, 12, 12], colour: 'rgb(232, 222, 248)' };
  const page = { box: { left: 334, top: 100, width: 1060, height: 788 }, radii: [0, 0, 0, 0], colour: 'rgb(255, 248, 248)' };
  for (const levels of [container.shutterLevels(null), container.shutterLevels({ left: 416, width: 896 })]) {
    for (const elapsed of [0, 1000 / 60, 90, 200, 333, full, full + 50]) {
      const pose = container.containerPose(leg, card, page, elapsed);
      const p = container.forumTransformProgress(Math.min(1, elapsed / full));
      /* Each level's keyframes run between its translations at the two ends on the leg's easing, and
         a translation is linear in the box: the pose is what the shutters show at that moment. */
      levels.forEach((level) => {
        const [ax, ay] = level.translate(card.box);
        const [bx, by] = level.translate(page.box);
        const [x, y] = level.translate(pose.box);
        assert.ok(Math.abs(ax + (bx - ax) * p - x) < 1e-6 && Math.abs(ay + (by - ay) * p - y) < 1e-6, `level at ${elapsed}`);
      });
      assert.ok(Math.abs(pose.radii[0] - 12 * (1 - p)) < 1e-9, `corner at ${elapsed}`);
    }
  }
  assert.deepEqual(container.containerPose(leg, card, page, 0).box, card.box);
  assert.deepEqual(container.containerPose(leg, card, page, full).box, page.box);
  /* The tone too, between two computed colours; one the browser would not print stays at its end. */
  assert.equal(container.colourAt('rgb(0, 0, 0)', 'rgba(255, 255, 255, 0.5)', 0.5), 'rgba(128, 128, 128, 0.75)');
  assert.equal(container.colourAt('rgb(1, 2, 3)', 'rgb(1, 2, 3)', 0.3), 'rgb(1, 2, 3)');
  assert.equal(container.colourAt('color(display-p3 1 0 0)', 'rgb(0, 0, 0)', 0.2), 'color(display-p3 1 0 0)');
  /* The turned leg starts exactly there: its own first pose is the pose it was turned at. */
  const elapsed = 120;
  const now = container.containerPose(leg, card, page, elapsed);
  const turned = container.turnContainer(leg, elapsed, full);
  assert.deepEqual(container.containerPose(turned, now, card, 0), now);
});
