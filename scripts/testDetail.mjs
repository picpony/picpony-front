/**
 * The image detail's pure contracts, with no browser and no live service: Derpibooru's markup
 * made readable here (relative links, picture references, code left alone), any comment as plain
 * text (a reply's preview, a translation's input), the comment adapters' shapes, the translation
 * adapters and the download name.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { requireTypeStripping } from './tsResolve.mjs';

requireTypeStripping('testDetail');

const values = new Map();
globalThis.localStorage = {
  getItem: (key) => values.get(key) ?? null,
  setItem: (key, value) => values.set(key, String(value)),
  removeItem: (key) => values.delete(key),
};
globalThis.window = {
  requestAnimationFrame: (callback) => setTimeout(callback, 0),
  addEventListener() {}, removeEventListener() {},
  dispatchEvent() { return true; },
  setTimeout: (...args) => setTimeout(...args),
  clearTimeout: (...args) => clearTimeout(...args),
  matchMedia: () => ({ matches: false }),
  location: { origin: 'http://localhost:3101', href: 'http://localhost:3101/' },
};
globalThis.document = {
  visibilityState: 'visible', hidden: false, cookie: '',
  addEventListener() {}, removeEventListener() {},
};
globalThis.fetch = async (url) => { throw new Error(`Unexpected network request: ${url}`); };

const markup = await import('../lib/derpiMarkup.ts');

test('a Derpibooru comment links to Derpibooru, and its picture references to this app', () => {
  const body = '[@Someone](/images/232093#comment_10184427)\n>>123 and >>456s here (>>789t)\nsee [tag](/tags/pony)';
  const out = markup.derpiMarkdown(body);
  assert.match(out, /\]\(https:\/\/derpibooru\.org\/images\/232093#comment_10184427\)/);
  assert.match(out, /^\[>>123\]\(\/pic\/123\) and \[>>456\]\(\/pic\/456\) here \(\[>>789\]\(\/pic\/789\)\)/m);
  assert.match(out, /\]\(https:\/\/derpibooru\.org\/tags\/pony\)/);
  /* An absolute link and a protocol-relative one are left as written. */
  assert.equal(markup.derpiMarkdown('[a](https://example.com/x) [b](//cdn.example/y)'), '[a](https://example.com/x) [b](//cdn.example/y)');
  /* A reference inside a word, or a number after a quote marker with no second `>`, is not one. */
  assert.equal(markup.derpiMarkdown('a>>12 > 34'), 'a>>12 > 34');
  /* Code is shown as written. */
  assert.equal(markup.derpiMarkdown('`>>123` and\n```\n>>456 [x](/y)\n```'), '`>>123` and\n```\n>>456 [x](/y)\n```');
  /* A quoted reference is still a reference. */
  assert.equal(markup.derpiMarkdown('> >>42 quoted'), '> [>>42](/pic/42) quoted');
  assert.equal(markup.derpiMarkdown(null), '');
});

test('a link to a Derpibooru comment is recognised in every spelling Philomena writes', () => {
  assert.deepEqual(markup.derpiCommentTarget('https://derpibooru.org/images/232093#comment_10184427'), { imageId: 232093, commentId: 10184427 });
  assert.deepEqual(markup.derpiCommentTarget('/images/5#comment_6'), { imageId: 5, commentId: 6 });
  assert.deepEqual(markup.derpiCommentTarget('https://trixiebooru.org/7#comment_8'), { imageId: 7, commentId: 8 });
  assert.equal(markup.derpiCommentTarget('https://derpibooru.org/images/5'), null);
  assert.equal(markup.derpiCommentTarget('https://evil.example/images/5#comment_6'), null);
});

test('plain text keeps the words of BBCode and Markdown alike', () => {
  const bbcode = '[div][p]小时候在4399上玩过……[/p]\n[/div]';
  assert.equal(markup.plainTextOf(bbcode), '小时候在4399上玩过……');
  const reply = '[quote="甲"]\n被回复的话\n[/quote]\n\n[b]我的[/b]回答 [url=https://a.b]链接[/url][img]https://x/y.png[/img]';
  assert.equal(markup.plainTextOf(reply, { keepQuotes: false }), '我的回答 链接');
  assert.match(markup.plainTextOf(reply), /被回复的话/);
  const md = '[@Someone](/images/1#comment_2)\n> quoted line\nthanks **a lot** >>123 ||secret||';
  assert.equal(markup.plainTextOf(md, { keepQuotes: false }), '@Someone thanks a lot >>123');
  /* Paragraphs survive, so a translation keeps its breaks. */
  assert.equal(markup.plainTextOf('first\n\nsecond'), 'first\n\nsecond');
  /* A Markdown link's text is not mistaken for a BBCode tag. */
  assert.equal(markup.plainTextOf('[link](https://a.b) [b]bold[/b]'), 'link bold');
  assert.equal(markup.plainTextOf('一二三四五六七八九十', { max: 5 }), '一二三四…');
  assert.equal(markup.plainTextOf(''), '');
});

const translate = await import('../lib/api/translate.ts');
const download = await import('../lib/download.ts');
const searchState = await import('../lib/searchState.ts');

test('a translation is the backend\'s words, and a failure is its sentence rather than an empty result', async () => {
  const sent = [];
  globalThis.fetch = async (url, init) => {
    sent.push([String(url), init?.method, String(init?.body ?? '')]);
    return Response.json({ success: true, translation: '  译文  ' });
  };
  assert.equal(await translate.translateText('Some words'), '译文');
  assert.match(sent[0][0], /action=translate/);
  assert.equal(sent[0][1], 'POST');
  assert.equal(sent[0][2], 'text=Some+words');
  globalThis.fetch = async () => Response.json({ success: false, translation: '翻译服务繁忙' });
  await assert.rejects(translate.translateText('Some words'), (error) => error.message.includes('翻译服务繁忙'));
  globalThis.fetch = async () => Response.json({ success: true, translation: '' });
  await assert.rejects(translate.translateText('Some words'), /没有返回译文/);
  await assert.rejects(translate.translateText('   '), /没有可以翻译的内容/);
  globalThis.fetch = async (url) => { throw new Error(`Unexpected network request: ${url}`); };
});

test('the image translation job reads the queue, the finished picture and the service\'s own failure', async () => {
  const answers = [
    { success: true, status: 'pending', queue_ahead: 3 },
    { success: true, status: 'translating' },
    { success: true, status: 'completed', translated_url: '/translated/abc.png' },
    { success: true, status: 'failed', error_message: '图片过大' },
  ];
  const urls = [];
  globalThis.fetch = async (url) => {
    urls.push(String(url));
    return Response.json(answers.shift());
  };
  const source = 'https://derpicdn.net/img/view/2026/1/1/1.png';
  assert.deepEqual(await translate.requestImageTranslation(source), { state: 'pending', translatedUrl: null, queueAhead: 3, message: undefined });
  assert.equal((await translate.pollImageTranslation(source)).state, 'translating');
  const done = await translate.pollImageTranslation(source);
  assert.equal(done.state, 'completed');
  assert.match(done.translatedUrl, /^https?:\/\/.+\/translated\/abc\.png$/);
  assert.deepEqual(await translate.pollImageTranslation(source), { state: 'failed', translatedUrl: null, queueAhead: 0, message: '图片过大' });
  /* The raw URL is the service's cache key: sent as is, on every line. */
  assert.ok(urls.every((url) => new URL(url, 'http://localhost').searchParams.get('image') === source));
  globalThis.fetch = async (url) => { throw new Error(`Unexpected network request: ${url}`); };
});

test('a download is named by the picture, whichever line carried it, and falls back to the source', () => {
  const raw = 'https://derpicdn.net/img/view/2013/2/3/232093__safe_artist-colon-x.gif';
  const wrapped = `https://147052.xyz/?url=${encodeURIComponent(raw)}`;
  assert.equal(download.downloadName({ id: 232093, url: raw, format: 'gif' }), '232093.gif');
  /* The last path segment of a wrapped URL is the proxy's query string; the name ignores it. */
  assert.equal(download.downloadName({ id: 232093, url: wrapped }), '232093.gif');
  assert.equal(download.downloadName({ id: 5, url: 'https://example.com/file', format: 'JPEG' }), '5.jpeg');
  assert.equal(download.downloadName({ id: 6, url: 'https://example.com/file' }), '6');
  const candidates = download.downloadCandidates(wrapped);
  assert.equal(candidates.at(-1), raw);
  assert.equal(new Set(candidates).size, candidates.length);
});

test('the original front end\'s picture link opens the picture, and nothing else does', () => {
  assert.equal(searchState.legacySharedImageHref('#q=id:232093'), '/pic/232093');
  assert.equal(searchState.legacySharedImageHref('#q=id%3A5&page=1&sf=first_seen_at&sd=desc'), '/pic/5');
  assert.equal(searchState.legacySharedImageHref('#q=pony'), null);
  assert.equal(searchState.legacySharedImageHref('#q=id:5 OR id:6'), null);
  assert.equal(searchState.legacySharedImageHref('#mode=shared_search&q=id:5'), null);
  assert.equal(searchState.legacySharedImageHref('#q=id:0'), null);
  assert.equal(searchState.legacySharedImageHref(''), null);
});
