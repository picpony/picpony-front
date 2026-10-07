/**
 * /messages without a browser: what a message's text is (plain text, links, emoji, the original
 * front end's BBCode), the composer's value and undo, the share-card wire format, the thread's
 * arithmetic (merging pages, read receipts, outgoing messages, the tab a visit opens on) and the
 * inbox adapters' strict reads.
 */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { after, beforeEach, test } from 'node:test';
import { requireTypeStripping } from './tsResolve.mjs';

requireTypeStripping('testMessages');

const originalFetch = globalThis.fetch;
const originalWindow = globalThis.window;
globalThis.window = { __picponyRoutePolicy: { api: 'direct', image: 'direct' } };

const text = await import('../app/messages/messageText.ts');
const composer = await import('../app/messages/composerModel.ts');
const model = await import('../app/messages/threadModel.ts');
const messaging = await import('../lib/api/messages.ts');
const { ApiError } = await import('../lib/api/errors.ts');
const { PONY_EMOJI } = await import('../lib/generated/emoji.ts');

let respond;
let calls;
beforeEach(() => {
  calls = [];
  respond = () => Response.json({ success: true });
  globalThis.fetch = async (url, init = {}) => {
    const request = { url: new URL(String(url), 'https://app.invalid'), init };
    calls.push(request);
    return respond(request);
  };
});
after(() => {
  globalThis.fetch = originalFetch;
  if (originalWindow === undefined) delete globalThis.window;
  else globalThis.window = originalWindow;
});

const ORIGIN = 'https://picpony.top';
const plain = (tokens) => tokens.map((token) => (token.type === 'text' ? token.text : `<${token.type}>`)).join('');

test('a direct message is plain text: line breaks and Markdown characters survive as typed', () => {
  const tokens = text.messageTokens('1. 早上好\n# 这不是标题\n> 这不是引用\n**加粗**', ORIGIN);
  assert.deepEqual(tokens, [{ type: 'text', text: '1. 早上好\n# 这不是标题\n> 这不是引用\n**加粗**' }]);
});

test('links are found in running text and end at Chinese punctuation and sentence ends', () => {
  const tokens = text.messageTokens('地址：https://dev.picpony.top/，测试 see https://example.com/a. 和 (https://en.wikipedia.org/wiki/Pony_(horse))', ORIGIN);
  const links = tokens.filter((token) => token.type === 'link');
  assert.deepEqual(links.map((link) => link.text), [
    'https://dev.picpony.top/',
    'https://example.com/a',
    'https://en.wikipedia.org/wiki/Pony_(horse)',
  ]);
  assert.equal(links[1].internal, false);
  assert.equal(plain(tokens), '地址：<link>，测试 see <link>. 和 (<link>)');
});

test('PicPony pages and mirrored Derpibooru pictures open in the app; other schemes are never links', () => {
  assert.deepEqual(text.resolveLink('https://picpony.top/pic/12', ORIGIN), { href: '/pic/12', internal: true });
  assert.deepEqual(text.resolveLink('https://www.picpony.top/forum/5/', ORIGIN), { href: '/forum/5', internal: true });
  assert.deepEqual(text.resolveLink('https://derpibooru.org/images/3456', ORIGIN), { href: '/pic/3456', internal: true });
  assert.equal(text.resolveLink('https://picpony.top/admin', ORIGIN).internal, false);
  assert.equal(text.resolveLink('javascript:alert(1)', ORIGIN), null);
  assert.deepEqual(text.messageTokens('javascript:alert(1)', ORIGIN), [{ type: 'text', text: 'javascript:alert(1)' }]);
});

test('emoji markers draw as pictures; a marker naming no picture stays text', () => {
  const name = PONY_EMOJI[0].name;
  const tokens = text.messageTokens(`你好$emoji_${name}$$emoji_nosuchface$`, ORIGIN);
  assert.equal(tokens[0].text, '你好');
  assert.equal(tokens[1].type, 'emoji');
  assert.equal(tokens[1].emoji.name, name);
  assert.deepEqual(tokens[2], { type: 'text', text: '$emoji_nosuchface$' });
});

test('the original front end’s BBCode reads into the same plain model', () => {
  const tokens = text.messageTokens(
    '[p]第一行[/p]\n[p][b]第二行[/b][br]第三行[/p][p][img]https://derpicdn.net/a.png[/img][/p][p][url=https://picpony.top/forum/5]帖子[/url][/p]',
    ORIGIN,
  );
  assert.equal(plain(tokens), '第一行\n第二行\n第三行\n<image>\n<link>');
  assert.deepEqual(tokens.find((token) => token.type === 'image'), { type: 'image', src: 'https://derpicdn.net/a.png' });
  assert.deepEqual(tokens.find((token) => token.type === 'link'), { type: 'link', text: '帖子', href: '/forum/5', internal: true });
  /* A digit-only paragraph is text, not a hole the sentinels left behind. */
  assert.equal(plain(text.messageTokens('[p]12345[/p]', ORIGIN)), '12345');
  assert.equal(plain(text.messageTokens('[p][img]javascript:alert(1)[/img]x[/p]', ORIGIN)), 'x');
});

test('a contact row’s preview is one line: cards by their summary, emoji by their name', () => {
  assert.equal(text.messagePreview('[image_share:12:https%3A%2F%2Fderpicdn.net%2Fa.png]'), '[图片]');
  assert.equal(text.messagePreview(`看$emoji_${PONY_EMOJI[0].name}$\n第二行`), `看[${PONY_EMOJI[0].label}] 第二行`);
  assert.equal(text.messagePreview('[p]旧消息[/p]'), '旧消息');
});

test('notification link markers become links, the tag-subscription marker its subscription', () => {
  const tokens = text.notificationTokens('[user:12|小马] 回复了 [post:5|帖子]：[image:9|图片] [tag_subscription|oc:nyx] https://example.com', ORIGIN);
  const links = tokens.filter((token) => token.type === 'link');
  assert.deepEqual(links.map((link) => link.href), ['/user/12', '/forum/5', '/pic/9', '/subscriptions/oc%3Anyx', 'https://example.com/']);
  assert.deepEqual(links[3], { type: 'link', text: 'oc:nyx', href: '/subscriptions/oc%3Anyx', internal: true });
  /* Any tag name survives its path segment, a slash included. */
  const [slashed] = text.notificationTokens('[tag_subscription|80s/90s style]').filter((token) => token.type === 'link');
  assert.equal(slashed.href, '/subscriptions/80s%2F90s%20style');
});

test('the composer holds pictures and sends markers', () => {
  const name = PONY_EMOJI[1].name;
  const value = `你好$emoji_${name}$\n再见`;
  const pieces = composer.parseComposerValue(value);
  assert.deepEqual(pieces, [
    { type: 'text', text: '你好' },
    { type: 'emoji', name },
    { type: 'text', text: '\n再见' },
  ]);
  assert.equal(composer.serializePieces(pieces), value);
  assert.equal(composer.readablePieces(pieces), `你好[${PONY_EMOJI[1].label}]\n再见`);
  assert.equal(composer.isBlankValue(' \n '), true);
  assert.equal(composer.isBlankValue(`$emoji_${name}$`), false);
  assert.equal(composer.outgoingValue('  第一行\n第二行 \n'), '第一行\n第二行');
});

test('the composer’s undo coalesces typing and keeps an insertion its own step', () => {
  const history = composer.createComposerHistory({ value: '', caret: 0 });
  history.record({ value: '你', caret: 1 }, 'type', 0);
  history.record({ value: '你好', caret: 2 }, 'type', 200);
  history.record({ value: '你好$emoji_joy$', caret: 3 }, 'insert', 300);
  history.record({ value: '你好$emoji_joy$！', caret: 4 }, 'type', 400);
  assert.equal(history.undo().value, '你好$emoji_joy$');
  assert.equal(history.undo().value, '你好');
  assert.equal(history.undo().value, '');
  assert.equal(history.undo(), null);
  assert.equal(history.redo().value, '你好');
  history.record({ value: '你好呀', caret: 3 }, 'type', 5000);
  assert.equal(history.redo(), null, 'a new edit drops the redo branch');
});

test('share cards are the original front end’s wire format, byte for byte', () => {
  const image = { kind: 'image', imageId: 3456, thumbUrl: 'https://derpicdn.net/img/2024/1/1/3456/small.png' };
  assert.equal(messaging.encodeShare(image), '[image_share:3456:https%3A%2F%2Fderpicdn.net%2Fimg%2F2024%2F1%2F1%2F3456%2Fsmall.png]');
  assert.deepEqual(messaging.parseShare(messaging.encodeShare(image)), image);

  const folder = { kind: 'fave-folder', ownerUsername: 'pony: 小马', folderId: 7, folderName: '最爱:第一' };
  assert.equal(messaging.encodeShare(folder), '[fave_folder_share:pony%3A%20%E5%B0%8F%E9%A9%AC:7:%E6%9C%80%E7%88%B1%3A%E7%AC%AC%E4%B8%80]');
  assert.deepEqual(messaging.parseShare(messaging.encodeShare(folder)), folder);

  const privacy = { kind: 'privacy-space', ownerId: 12, ownerName: '小马' };
  assert.equal(messaging.encodeShare(privacy), '[privacy_space_share:12:小马]');
  assert.deepEqual(messaging.parseShare(' [privacy_space_share:12:小马] '), privacy);

  assert.equal(messaging.parseShare('看 [image_share:1:x]'), null, 'a card is the whole message');
  assert.equal(messaging.parseShare('[image_share:abc:x]'), null);
  assert.deepEqual(messaging.parseShare('[image_share:5:javascript%3Aalert(1)]'), { kind: 'image', imageId: 5, thumbUrl: '' });

  assert.equal(messaging.shareHref(image), '/pic/3456');
  assert.equal(messaging.shareHref(folder), '/favorites/shared/pony%3A%20%E5%B0%8F%E9%A9%AC/7');
  assert.equal(messaging.shareSummary(folder), '[收藏夹] 最爱:第一');
});

test('a card’s thumbnail is the small rendition, absolute and off any image line', () => {
  assert.equal(messaging.shareThumbUrl({ small: '//derpicdn.net/a/small.png', thumb: '//derpicdn.net/a/thumb.png' }), 'https://derpicdn.net/a/small.png');
  assert.equal(messaging.shareThumbUrl({ thumb: '/img/a/thumb.png' }), 'https://derpibooru.org/img/a/thumb.png');
  assert.equal(
    messaging.shareThumbUrl({ medium: `https://wsrv.nl/?url=${encodeURIComponent('https://derpicdn.net/a/medium.png')}` }),
    'https://derpicdn.net/a/medium.png',
  );
  assert.equal(messaging.shareThumbUrl(null), '');
});

const message = (id, sender, extra = {}) => ({
  id, sender_id: sender, receiver_id: sender === 2 ? 1 : 2, content: `m${id}`, is_read: 0,
  created_at: '2026-09-24 12:00:00', sender_name: '', sender_avatar: null, ...extra,
});
const isOwn = (m) => m.sender_id !== 2;

test('pages merge into one thread: repeats once, a later copy wins, oldest first', () => {
  const page1 = [message(3, 2), message(4, 1)];
  const merged = model.mergeMessages([], page1);
  assert.deepEqual(merged.map((m) => m.id), [3, 4]);
  assert.equal(model.mergeMessages(merged, [message(3, 2)]), merged, 'nothing new keeps the identity');
  const withOlder = model.mergeMessages(merged, [message(1, 1), message(2, 2), message(3, 2)]);
  assert.deepEqual(withOlder.map((m) => m.id), [1, 2, 3, 4]);
  const read = model.mergeMessages(withOlder, [message(4, 1, { is_read: 1 })]);
  assert.equal(read.find((m) => m.id === 4).is_read, 1);
});

test('已读 sits under the newest message they have read, 已送达 under a newer one', () => {
  assert.deepEqual(model.receiptPlacement([message(1, 1, { is_read: 1 }), message(2, 2), message(3, 1)], isOwn), { readId: 1, deliveredId: 3 });
  assert.deepEqual(model.receiptPlacement([message(1, 1), message(2, 1, { is_read: 1 })], isOwn), { readId: 2, deliveredId: null });
  assert.deepEqual(model.receiptPlacement([message(1, 2)], isOwn), { readId: null, deliveredId: null });
});

test('a turn breaks at a five-minute pause and at midnight', () => {
  const a = message(1, 1, { created_at: '2026-09-24 12:00:00' });
  assert.equal(model.breaksRun(a, message(2, 1, { created_at: '2026-09-24 12:04:59' })), false);
  assert.equal(model.breaksRun(a, message(2, 1, { created_at: '2026-09-24 12:05:00' })), true);
  assert.equal(model.breaksRun(message(1, 1, { created_at: '2026-09-24 23:59:00' }), message(2, 1, { created_at: '2026-09-25 00:00:30' })), true);
});

test('an outgoing message leaves the screen when its server copy arrives, and only then', () => {
  const item = (localId, content, status, afterId = 10) => ({ localId, contactId: 2, content, status, afterId, createdAt: '' });
  const outgoing = [item('a', '你好', 'sent'), item('b', '再见', 'sending'), item('c', '失败', 'failed')];
  assert.deepEqual(model.matchOutgoing([message(9, 1, { content: '你好' })], outgoing, isOwn), {
    pending: outgoing, arrived: [],
  }, 'a message older than the send is not its copy');
  const server = [message(11, 1, { content: '你好' }), message(12, 1, { content: '再见' }), message(13, 2, { content: '失败' })];
  const matched = model.matchOutgoing(server, outgoing, isOwn);
  assert.deepEqual(matched.arrived, ['a', 'b']);
  assert.deepEqual(matched.pending.map((entry) => entry.localId), ['c'], 'a failure stays until it is retried or deleted');
  /* A server that normalises what it stores still settles an accepted message, in order. */
  const normalised = model.matchOutgoing([message(11, 1, { content: '你好 ' })], [item('a', '你好', 'sent'), item('b', '你好', 'sending')], isOwn);
  assert.deepEqual(normalised.arrived, ['a']);
  assert.deepEqual(normalised.pending.map((entry) => entry.localId), ['b']);
});

test('a visit opens on the tab with something unread', () => {
  const unread = { notification: 0, interaction: 2, chat: 1 };
  const choose = (requested, stored, counts) =>
    model.chooseInitialTab({ requested, stored, unread: counts, signedIn: true });
  assert.equal(choose('announcement', 'chat', unread), 'announcement');
  assert.equal(choose(null, 'chat', unread), 'chat');
  assert.equal(choose(null, 'notification', unread), 'interaction');
  assert.equal(choose(null, 'announcement', unread), 'interaction');
  assert.equal(choose(null, 'chat', { notification: 0, interaction: 0, chat: 0 }), 'chat');
  assert.equal(choose(null, null, null), 'announcement');
  assert.equal(model.isMessagesTab('chat'), true);
  assert.equal(model.isMessagesTab('admin'), false);
});

test('signed out, the row is 公告 and 系统 and a personal link lands on 系统 (decision 22)', () => {
  assert.deepEqual([...model.PUBLIC_TABS], ['announcement', 'notification']);
  assert.equal(model.landingTab('chat', false), 'notification');
  assert.equal(model.landingTab('interaction', false), 'notification');
  assert.equal(model.landingTab('announcement', false), 'announcement');
  assert.equal(model.landingTab('notification', false), 'notification');
  assert.equal(model.landingTab('chat', true), 'chat', 'signed in, every tab is offered');
  const choose = (requested, stored) =>
    model.chooseInitialTab({ requested, stored, unread: null, signedIn: false });
  assert.equal(choose('chat', null), 'notification');
  assert.equal(choose('interaction', 'announcement'), 'notification', 'the link outranks the last tab');
  assert.equal(choose('announcement', null), 'announcement');
  assert.equal(choose(null, 'announcement'), 'announcement');
  assert.equal(choose(null, 'chat'), 'notification', 'a remembered personal tab is not offered either');
  assert.equal(choose(null, null), 'announcement', 'a bare visit opens on 公告');
  assert.equal(
    model.chooseInitialTab({ requested: null, stored: null, unread: { notification: 0, interaction: 3, chat: 2 }, signedIn: false }),
    'announcement',
    'no unread count can pick a tab the row does not have',
  );
});

test('a signed-out link keeps what only an account can show', () => {
  assert.deepEqual(model.personalRequest('chat', null), { tab: 'chat', user: null });
  assert.deepEqual(model.personalRequest('interaction', null), { tab: 'interaction', user: null });
  assert.deepEqual(model.personalRequest(null, 42), { tab: 'chat', user: 42 }, 'a person opens their conversation');
  assert.deepEqual(model.personalRequest('announcement', 42), { tab: 'chat', user: 42 }, 'the person wins, as signed in');
  assert.equal(model.personalRequest('notification', null), null);
  assert.equal(model.personalRequest('announcement', null), null);
  assert.equal(model.personalRequest(null, null), null);
});

test('a contact row prints the clock today and a day label otherwise', () => {
  const now = Date.parse('2026-09-26T04:00:00Z'); /* 12:00 in Beijing */
  assert.equal(model.contactTime('2026-09-26 09:05:00', now), '09:05');
  assert.equal(model.contactTime('2026-09-25 23:00:00', now), '昨天');
  assert.equal(model.contactTime('2026-09-24 12:00:00', now), '周四');
  assert.equal(model.contactTime('', now), '');
  assert.equal(model.contactTime('2026-09-24 12:00:00', null), '2026/09/24');
});

test('inbox reads are strict: a success without its list is a failure, rows are normalised', async () => {
  respond = () => Response.json({ success: true });
  await assert.rejects(messaging.readConversation('t', 2, 1), (error) => error instanceof ApiError && error.kind === 'invalid');
  await assert.rejects(messaging.readNotifications('t', 'system', 1), (error) => error instanceof ApiError && error.kind === 'invalid');

  respond = () => Response.json({
    success: true, has_more: '1', page: 2,
    messages: [{ id: 5, sender_id: '2', content: 'b', is_read: '1' }, null, { id: 3, sender_id: 1, content: 'a' }, { id: 'x' }],
  });
  const page = await messaging.readConversation('t', 2, 2);
  assert.deepEqual(page.messages.map((m) => m.id), [3, 5], 'oldest first, broken rows dropped');
  assert.equal(page.messages[1].is_read, 1);
  assert.equal(page.hasMore, true);
  assert.equal(page.page, 2);
  const url = calls.at(-1).url;
  assert.equal(url.searchParams.get('action'), 'get_messages');
  assert.equal(url.searchParams.get('with_user_id'), '2');
  assert.equal(calls.at(-1).init.cache, 'no-store', 'a poll must never be answered from a cache');

  respond = () => Response.json({ success: true, results: [{ id: 7, username: '七' }, { id: 7, username: '重复' }, { username: '无 id' }] });
  assert.deepEqual(await messaging.searchUsers('t', '七'), [{ id: 7, username: '七', avatar: null }]);
  assert.equal(calls.at(-1).url.searchParams.get('kw'), '七');

  respond = () => Response.json({ success: true, notifications: [{ id: 1, title: 't', content: 'c', is_read: 0, created_at: 'x' }], total_pages: '0' });
  const guest = await messaging.readNotifications(null, 'system', 1);
  assert.equal(guest.totalPages, 1);
  assert.equal(new Headers(calls.at(-1).init.headers).has('Authorization'), false, 'the public list is read without a token');
});

test('sending is one JSON write whose refusal is its own sentence', async () => {
  await messaging.sendMessage('t', 2, '你好');
  const { url, init } = calls.at(-1);
  assert.equal(url.searchParams.get('action'), 'send_message');
  assert.equal(init.method, 'POST');
  assert.deepEqual(JSON.parse(init.body), { receiver_id: 2, content: '你好' });
  respond = () => Response.json({ success: false, error: '对方已将你屏蔽' });
  await assert.rejects(messaging.sendMessage('t', 2, '你好'), (error) => error instanceof ApiError && error.message === '对方已将你屏蔽');
});

test('the emoji table is current: every picture has a name, every name a picture', () => {
  const root = path.resolve(import.meta.dirname, '..');
  execFileSync(process.execPath, [path.join(root, 'scripts', 'emoji.mjs'), '--check'], { cwd: root, stdio: 'pipe' });
  assert.equal(new Set(PONY_EMOJI.map((emoji) => emoji.name)).size, PONY_EMOJI.length);
  assert.ok(PONY_EMOJI.every((emoji) => /^[一-鿿·]/.test(emoji.label)), 'names are Chinese');
});
