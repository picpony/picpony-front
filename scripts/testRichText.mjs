/** The forum's rich-text pipeline: what the display renders, the plain text a teaser or a quote
 *  is built from, and the Markdown line-break rule. No browser, no network. */
import './tsResolve.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';

const bb = await import('../lib/bbcode.ts');
const { remarkHardBreaks } = await import('../lib/markdownBreaks.ts');

test('an empty paragraph is dropped, the text around it kept (R6-050)', () => {
  assert.equal(bb.bbcodeToSafeHtml('[div][p][br][/p]\n[p]after[/p]\n[/div]'), '<div><p>after</p></div>');
  assert.equal(bb.bbcodeToSafeHtml('[p][br][/p]'), '');
  assert.equal(bb.bbcodeToSafeHtml('[p]a[br][br][/p]'), '<p>a</p>');
  assert.equal(bb.bbcodeToSafeHtml('[quote][/quote]after'), '<p>after</p>');
});

test('one line-break rule: a newline is a break, a blank line a paragraph (R6-049)', () => {
  assert.equal(bb.bbcodeToSafeHtml('纯文本第一行\n纯文本第二行'), '<p>纯文本第一行<br />纯文本第二行</p>');
  assert.equal(bb.bbcodeToSafeHtml('一\n\n二'), '<p>一</p><p>二</p>');
});

test('the original front end’s alignment and highlight render, and a colour is kept legible (R6-043)', () => {
  assert.equal(bb.bbcodeToSafeHtml('[right]r[/right]'), '<div style="text-align:right;"><p>r</p></div>');
  assert.equal(bb.bbcodeToSafeHtml('[center]c[/center]'), '<div style="text-align:center;"><p>c</p></div>');
  assert.equal(
    bb.bbcodeToSafeHtml('[color=rgb(44, 62, 80)]ink[/color]'),
    '<p><span data-ink="" style="--rt-ink:rgb(44, 62, 80);">ink</span></p>',
  );
  assert.equal(
    bb.bbcodeToSafeHtml('[bg=rgba(216, 68, 147, 0.5)]mark[/bg]'),
    '<p><span data-highlight="" style="--rt-highlight:rgba(216, 68, 147, 0.5);">mark</span></p>',
  );
  /* The editor is handed one span per run, carrying both. */
  assert.equal(
    bb.bbcodeToHtml('[bg=#000][color=#f00]both[/color][/bg]'),
    '<p><span style="color:#f00;background-color:#000;">both</span></p>',
  );
  assert.equal(bb.bbcodeToHtml('[center]c[/center]'), '<p style="text-align:center;">c</p>');
  assert.equal(bb.bbcodeToHtml('[img]/uploads/forum/a.png[/img]'), '<p><img src="https://picpony.top/uploads/forum/a.png" alt="" /></p>');
});

test('a colour is a colour: functional forms pass, a bare function name and anything else do not', () => {
  for (const value of ['#fff', 'red', 'rgb(1, 2, 3)', 'rgba(1, 2, 3, 0.5)', 'hsl(120deg, 50%, 50%)', 'hsla(120, 50%, 50%, .5)']) {
    assert.equal(bb.safeColor(value), value, value);
  }
  for (const value of ['rgba', 'rgb', 'hsl', 'red;position:fixed', 'url(x)', 'rgb(1,2,3);x:y', 'expression(1)']) {
    assert.equal(bb.safeColor(value), null, value);
  }
  assert.equal(bb.bbcodeToSafeHtml('[color=rgba]lost colour[/color]'), '<p>lost colour</p>');
});

test('pictures: responsive sources from the hook, a zoom button outside links, lazy and marked loading', () => {
  const image = (src) => ({ src: `/_next/image?url=${encodeURIComponent(src)}&w=828&q=75`, srcSet: `${src} 1x`, sizes: '100vw' });
  const html = bb.bbcodeToSafeHtml('[img]/uploads/forum/a.png[/img]', { image, zoomable: true });
  assert.match(html, /^<button type="button" class="rt-image" data-rt-zoom="" aria-label="查看大图"><img /);
  assert.match(html, /src="\/_next\/image\?url=https%3A%2F%2Fpicpony\.top%2Fuploads%2Fforum%2Fa\.png&amp;w=828&amp;q=75"/);
  assert.match(html, /srcset="https:\/\/picpony\.top\/uploads\/forum\/a\.png 1x" sizes="100vw"/);
  assert.match(html, /loading="lazy" decoding="async" data-loading=""/);
  /* Inside a link the link takes the press: no second control inside it. */
  const linked = bb.bbcodeToSafeHtml('[url=https://example.test/][img]https://example.test/a.png[/img][/url]', { zoomable: true });
  assert.doesNotMatch(linked, /<button/);
  assert.match(linked, /^<a href="https:\/\/example\.test\/" target="_blank"/);
});

test('an internal link navigates in place; an external one opens beside the app (R6-040)', () => {
  const isInternal = (href) => href.startsWith('/') || href.startsWith('https://picpony.top/');
  assert.equal(
    bb.bbcodeToSafeHtml('[url=/forum/5]thread[/url]', { isInternal }),
    '<p><a href="/forum/5">thread</a></p>',
  );
  assert.equal(
    bb.bbcodeToSafeHtml('[url=https://example.test/]out[/url]', { isInternal }),
    '<p><a href="https://example.test/" target="_blank" rel="noopener noreferrer">out</a></p>',
  );
});

test('the original front end’s links lead to this app’s routes: a picture, a shared search or tag group, a thread', async () => {
  const { inAppHref, isInternalHref } = await import('../lib/richTextLinks.ts');
  const site = 'https://picpony.top';
  assert.equal(inAppHref(`${site}/#q=id:5`), '/pic/5');
  /* A shared tag group is its tags as a search, from the person who shared it. */
  const group = new URL(
    inAppHref(`${site}/#mode=shared_tag_group&user=${encodeURIComponent('小明')}&q=${encodeURIComponent('fluttershy, safe')}`),
    site,
  );
  assert.equal(group.pathname, '/search');
  assert.equal(group.searchParams.get('q'), 'fluttershy, safe');
  assert.equal(group.searchParams.get('from'), '小明');
  assert.equal(inAppHref(`${site}/#mode=shared_search&user=x&q=*`), '/search');
  assert.equal(inAppHref(`${site}/?post=21`), '/forum/21');
  assert.equal(inAppHref(`${site}/index.html`), '/');
  assert.equal(inAppHref('/forum/21?page=2'), '/forum/21?page=2');
  assert.equal(inAppHref('https://www.picpony.top/user/3'), '/user/3');
  /* The backend's own files and endpoints, and anybody else's site, are the browser's. */
  assert.equal(inAppHref(`${site}/uploads/forum/a.png`), null);
  assert.equal(inAppHref(`${site}/api.php?action=x`), null);
  assert.equal(inAppHref('https://example.test/forum/21'), null);
  assert.equal(inAppHref('javascript:alert(1)'), null);
  /* The page's own origin counts, read at the event (a preview deployment, localhost). */
  assert.equal(inAppHref('http://localhost:3101/forum/5', 'http://localhost:3101'), '/forum/5');
  assert.equal(isInternalHref('//example.test/x'), false);
  assert.equal(isInternalHref('/uploads/x.png'), false);
  assert.equal(isInternalHref('https://picpony.top/forum/5'), true);
});

test('plain text comes from the parse tree: pictures are words, quotes are left out, the cut is clean (R6-031)', () => {
  const reply = '[quote="小雨天"]\n[div][p]吃一半开始互撸对方肚皮了()[/p]\n[/div]\n[/quote]\n\n[div][p]我也要撸肚皮[/p]\n[/div]';
  assert.equal(bb.bbcodeToPlainText(reply), '我也要撸肚皮');
  assert.equal(bb.bbcodeToPlainText(reply, { quotes: true }), '吃一半开始互撸对方肚皮了() 我也要撸肚皮');
  assert.equal(bb.bbcodeToPlainText('逆天图？一大堆欸。[img]/uploads/forum/forum_6a40.png[/img]'), '逆天图？一大堆欸。 [图片]');
  assert.equal(bb.bbcodeToPlainText('[img]/a.png[/img]', { images: 'drop' }), '');
  assert.equal(bb.bbcodeToPlainText('[url=https://example.test/]链接文字[/url]'), '链接文字');
  assert.equal(bb.bbcodeToPlainText('a[br]b', { singleLine: false }), 'a\nb');
  /* Code points, not UTF-16 units: an emoji at the cut survives whole. */
  assert.equal(bb.bbcodeToPlainText('一二三😀四五', { maxLength: 4 }), '一二三😀…');
  /* A cut can no longer leave a tag open: the text was never markup to begin with. */
  const long = `[img]https://derpicdn.net/img/view/2026/8/29/${'x'.repeat(120)}.png[/img]`;
  assert.equal(bb.bbcodeToPlainText(long, { maxLength: 100 }), '[图片]');
});

test('the first picture a text shows is its cover, as written', () => {
  assert.equal(bb.firstImageOf('text [b][img]/uploads/forum/a.png[/img][/b] [img]/b.png[/img]'), '/uploads/forum/a.png');
  assert.equal(bb.firstImageOf('[code][img]/not-a-picture.png[/img][/code]'), null);
  assert.equal(bb.firstImageOf('no pictures'), null);
});

test('Markdown keeps a single line break, the way BBCode does (R6-049)', () => {
  const tree = {
    type: 'root',
    children: [{ type: 'paragraph', children: [{ type: 'text', value: '第一行\n第二行' }, { type: 'inlineCode', value: 'a\nb' }] }],
  };
  remarkHardBreaks()(tree);
  assert.deepEqual(tree.children[0].children, [
    { type: 'text', value: '第一行' },
    { type: 'break' },
    { type: 'text', value: '第二行' },
    { type: 'inlineCode', value: 'a\nb' },
  ]);
});
