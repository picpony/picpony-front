/** Regression checks for BBCode attribute injection and the public badge-claim
 *  request contract. `--browser` also parses every output in Edge and exercises
 *  the installed rich-text editor (requires Python Playwright, no live API). */
import './tsResolve.mjs';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';

const { bbcodeToHtml, bbcodeToSafeHtml, htmlToBBCode } = await import('../lib/bbcode.ts');
const { claimBadge } = await import('../lib/api/badges.ts');

const attacks = [
  '[img]https://example.invalid/[url=/onerror=globalThis.__picpony_review_marker=1//]x[/url][/img]',
  '[url=[img]x[/img]]text[/url]',
  '[img]x" onerror="alert(1)[/img]',
  '[url=https://example.test/" onclick="alert(1)]click[/url]',
  '[url=javascript:alert(1)]click[/url]',
  '[url=java\tscript:alert(1)]click[/url]',
  '[url=java\nscript:alert(1)]click[/url]',
  '[url=javascript&#58;alert(1)]click[/url]',
  '[url=javascript&colon;alert(1)]click[/url]',
  '[url]data:text/html,<script>alert(1)</script>[/url]',
  '[img]data:image/svg+xml,<svg onload="alert(1)">[/img]',
  '[color=red;position:fixed;inset:0]content[/color]',
  '[color=url(https://example.test/)]content[/color]',
  '[bg=red;position:fixed;inset:0]content[/bg]',
  '[bg=url(https://example.test/)]content[/bg]',
  '[color=rgb(1,2,3);--x:url(https://example.test/)]content[/color]',
  '[url=https://example.test/][img]https://example.test/a.png" onerror="alert(1)[/img][/url]',
  '[quote="<img src=x onerror=alert(1)>"]body[/quote]',
  '[code]<img src=x onerror=alert(1)>[url=javascript:alert(1)]x[/url][/code]',
  '<svg><style><img src=x onerror=alert(1)></style></svg>',
];
const samples = [
  '[b]outer[b]inner[/b]tail[/b]',
  '[i]italic[/i] [u]underlined[/u] [s]struck[/s]',
  '[url=https://example.test/?a=1&b=2][b]label[/b][/url]',
  '[url=https://outer.test][url=https://inner.test]nested[/url][/url]',
  '[img]/uploads/example.png?a=1&b=2[/img]',
  '[quote="Alice"]first\n\n[code][b]literal[/b]\n\n<script>x</script>[/code][/quote]\n\nreply',
  '[list=1][*]one[*]two[list][*]nested[/list][/list]',
  '[color=rgb(1, 2, 3)]colour[/color]',
  '[table][tr][th]heading[/th][td][b]cell[/b][/td][/tr][/table]',
  'line 1\nline 2\n\nparagraph 2',
  '[quote]before[quote]inside[/quote]after[/quote]reply',
  '[h2]heading[/h2][p]paragraph[/p]',
  '[center]centred[/center][right]right[/right]',
  '[bg=yellow]highlight[/bg] [color=rgba]lost colour[/color]',
  '[div][p][br][/p]\n[p]after a blank paragraph[/p]\n[/div]',
];
const outputs = [...attacks, ...samples].map((input) => {
  const html = bbcodeToSafeHtml(input);
  const editorHtml = bbcodeToHtml(input);
  return { input, html, editorHtml };
});
// Exercise what RichTextEditor actually does: the editor normalizes our HTML
// before htmlToBBCode serializes it, and the resulting BBCode is rendered again.
const editorSources = [
  'first\n\nsecond',
  'line 1\nline 2\n\nparagraph 2',
  '[b]bold[/b] [i]italic[/i] [u]underlined[/u] [s]struck[/s]',
  '[code][b]literal[/b]\n\n<script>x</script>[/code]',
  /* What the toolbar makes, the renderer shows (R6-043): alignment, a highlight, a colour with
     a highlight on the same words, a table, both lists, a heading, a picture, a link. */
  '[center]centred[/center]\n\n[right]right side[/right]',
  '[bg=rgb(255, 235, 59)]highlight[/bg] and [bg=rgb(0, 0, 0)][color=rgb(231, 95, 51)]both[/color][/bg]',
  '[table][tr][th]名称[/th][th]日期[/th][/tr][tr][td]a[/td][td]b[/td][/tr][/table]',
  '[list][*]one[*]two[/list]\n\n[list=1][*]first[*]second[/list]',
  '[h2]heading[/h2]\n\nparagraph',
  '[img]https://picpony.top/uploads/forum/example.png[/img]',
  '[url=https://example.test/?a=1&b=2]link[/url] after',
  '[quote="Alice"]body[/quote]',
];
/* The converter on its own, for what the editor may hold that BBCode cannot say: styles as the
   CSSOM reports them, a target that would end its own tag, a scheme that must not survive. */
const conversions = [
  ['<p style="text-align: center;">居中的段落</p><p style="text-align: right;">右对齐</p>', '[center]居中的段落[/center]\n\n[right]右对齐[/right]'],
  ['<p><span style="background-color: rgb(216, 68, 147);">高亮文字</span></p>', '[bg=rgb(216, 68, 147)]高亮文字[/bg]'],
  ['<p><span style="color: rgb(231, 95, 51); background-color: rgb(216, 68, 147);">两者</span></p>', '[bg=rgb(216, 68, 147)][color=rgb(231, 95, 51)]两者[/color][/bg]'],
  ['<p><span style="color: rgba(1, 2, 3, 0.5);">半透明</span></p>', '[color=rgba(1, 2, 3, 0.5)]半透明[/color]'],
  ['<p>第一行<br>第二行</p><p>第二段</p>', '第一行\n第二行\n\n第二段'],
  ['<p><a href="https://example.test/a]b c">x</a></p>', '[url=https://example.test/a%5Db%20c]x[/url]'],
  ['<p><a href="javascript:alert(1)">x</a> <img src="data:image/png;base64,AAAA"></p>', 'x'],
  ['<p><br></p><p>after a blank line</p><p><br></p>', 'after a blank line'],
];
assert.equal(bbcodeToSafeHtml(''), '');
assert.equal(bbcodeToHtml(''), '<p><br></p>');
assert.equal(bbcodeToSafeHtml('[b]outer[b]inner[/b]tail[/b]'), '<p><strong>outer<strong>inner</strong>tail</strong></p>');
assert.equal(bbcodeToSafeHtml('[code][b]literal[/b]\n\n<script>x</script>[/code]'), '<pre><code>[b]literal[/b]\n\n&lt;script&gt;x&lt;/script&gt;</code></pre>');
assert.equal(bbcodeToSafeHtml('line 1\nline 2\n\nparagraph 2'), '<p>line 1<br />line 2</p><p>paragraph 2</p>');
assert.equal(bbcodeToSafeHtml('[list][*]first[*]second[/list]'), '<ul><li>first</li><li>second</li></ul>');
assert.doesNotMatch(outputs[0].html, /<a\b/);
assert.doesNotMatch(bbcodeToSafeHtml('[color=red;position:fixed]safe[/color]'), /style=/);
assert.doesNotThrow(() => bbcodeToSafeHtml('[quote]'.repeat(10_000) + 'text' + '[/quote]'.repeat(10_000)));

const realFetch = globalThis.fetch;
try {
  const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url, init });
    return Response.json({ success: true, badge_name: 'Test badge' });
  };
  assert.deepEqual(await claimBadge('session-token', 'link-token&value'), { success: true, badge_name: 'Test badge', error: undefined });
  assert.equal(calls.length, 1);
  assert.match(calls[0].url, /action=user_claim_badge$/);
  assert.equal(calls[0].init.method, 'POST');
  assert.equal(new Headers(calls[0].init.headers).get('Authorization'), 'Bearer session-token');
  assert.deepEqual(JSON.parse(calls[0].init.body), { token: 'link-token&value' });
  globalThis.fetch = async () => Response.json({ success: true }, { status: 403 });
  assert.equal((await claimBadge('session-token', 'expired')).success, false);
  globalThis.fetch = async () => new Response('<html>502 Bad Gateway</html>', { status: 502 });
  await assert.rejects(claimBadge('session-token', 'link-token'), (error) => error?.name === 'ApiError' && error.kind === 'invalid',
    'an unreadable claim response is unknown, never a refusal');
  const failure = new TypeError('Failed to fetch');
  globalThis.fetch = async () => { throw failure; };
  await assert.rejects(claimBadge('session-token', 'link-token'), (error) =>
    error?.name === 'ApiError' && error.kind === 'network' && error.cause === failure);
} finally {
  globalThis.fetch = realFetch;
}

if (process.argv.includes('--browser')) {
  const python = String.raw`
import json, sys
from playwright.sync_api import sync_playwright
data = json.load(sys.stdin)
with sync_playwright() as p:
    browser = p.chromium.launch(channel='msedge', headless=True)
    try:
        page = browser.new_page()
        page.route('**/*', lambda route: route.abort())
        result = page.evaluate('''(data) => {
          const allowed = new Set('P BR STRONG EM U S SPAN DIV H1 H2 H3 H4 H5 H6 A IMG PRE CODE BLOCKQUOTE CITE UL OL LI TABLE TBODY TR TD TH BUTTON'.split(' '));
          for (const {input, html, editorHtml} of data.outputs) {
            for (const rendered of [html, editorHtml]) {
            const template = document.createElement('template');
            template.innerHTML = rendered;
            for (const el of template.content.querySelectorAll('*')) {
              if (!allowed.has(el.tagName)) throw new Error('Unexpected element: ' + input);
              for (const attr of el.attributes) {
                if (!['src', 'href', 'alt', 'loading', 'decoding', 'style', 'class', 'target', 'rel', 'data-loading', 'data-ink', 'data-highlight', 'data-rt-zoom', 'type', 'aria-label'].includes(attr.name)) throw new Error('Injected attribute ' + attr.name + ': ' + input);
                if (attr.name === 'href' || attr.name === 'src') {
                  const protocol = new URL(attr.value, 'https://picpony.test/').protocol;
                  if (!['https:', 'http:'].includes(protocol)) throw new Error('Unsafe URL: ' + input);
                }
              }
              for (const property of el.style) if (!['color', 'background-color', 'text-align', '--rt-ink', '--rt-highlight'].includes(property)) throw new Error('Injected style: ' + input);
            }
            }
          }
          const convert = (0, eval)('(' + data.converter + ')');
          return {samples: data.samples.map((input) => ({input: input.input, roundtrip: convert(input.html)})), conversions: data.conversions.map(([html, expected]) => ({html, expected, actual: convert(html)}))};
        }''', data)
        page.set_content('<div id="editor"></div>')
        page.add_script_tag(path=data['editorPath'])
        editor = page.evaluate('''async (data) => {
          const convert = (0, eval)('(' + data.converter + ')');
          const cases = [];
          /* A fresh editor per case: setHtml restores the previous selection, so a case written
             into a used one lands wherever the last left it (inside a table cell). And a task
             between writing and reading: the editor writes its list containers from state its
             render fills in, so HTML read in the same task has list items with no list. */
          for (const {input, html} of data.editorSources) {
            const host = document.createElement('div');
            document.body.append(host);
            const editor = window.wangEditor.createEditor({selector: host, config: {autoFocus: false}, mode: 'simple'});
            editor.setHtml(html);
            await new Promise((resolve) => setTimeout(resolve, 20));
            const normalizedHtml = editor.getHtml();
            editor.destroy();
            host.remove();
            cases.push({input, normalizedHtml, bbcode: convert(normalizedHtml)});
          }
          return cases;
        }''', data)
        print(json.dumps({'roundtrips': result['samples'], 'conversions': result['conversions'], 'editor': editor}))
    finally:
        browser.close()
`;
  const result = spawnSync('python', ['-X', 'utf8', '-c', python], {
    input: JSON.stringify({ outputs, conversions, samples: outputs.slice(attacks.length), editorSources: editorSources.map((input) => ({ input, html: bbcodeToHtml(input) })), converter: htmlToBBCode.toString(), editorPath: path.resolve('node_modules/@wangeditor/editor/dist/index.js') }),
    encoding: 'utf8', windowsHide: true, timeout: 45_000,
  });
  assert.equal(result.status, 0, result.stderr || result.error?.message);
  const browser = JSON.parse(result.stdout);
  for (const item of browser.editor.slice(0, -1)) {
    assert.equal(bbcodeToSafeHtml(item.bbcode), bbcodeToSafeHtml(item.input), `Published content survives an editor round trip: ${item.input}`);
    assert.equal(bbcodeToHtml(item.bbcode), bbcodeToHtml(item.input), `Editor paragraph boundaries survive serialization: ${item.input}`);
  }
  // Citation metadata was already unsupported by wangEditor. Do not turn that
  // existing limitation into the author's name being inserted into quoted text.
  assert.equal(browser.editor.at(-1).bbcode, '[quote]body[/quote]');
  assert.match(bbcodeToSafeHtml(editorSources.at(-1)), /<cite>Alice<\/cite><p>body<\/p>/);
  for (const { html, expected, actual } of browser.conversions) {
    assert.equal(actual, expected, `The editor's HTML serialises as written: ${html}`);
  }
  assert.match(browser.roundtrips[5].roundtrip, /\[quote="Alice"\]/);
  assert.match(browser.roundtrips[5].roundtrip, /\[code\]\[b\]literal\[\/b\]\n\n<script>x<\/script>\[\/code\]/);
  /* A row ends its line, as the original front end writes it; the renderer reads both. */
  assert.match(browser.roundtrips[8].roundtrip, /\[table\]\[tr\]\[th\]heading\[\/th\]\[td\]\[b\]cell\[\/b\]\[\/td\]\[\/tr\]\n?\[\/table\]/);
  console.log(`Browser parsed both presentations of ${outputs.length} BBCode cases safely; ${browser.editor.length} complete editor roundtrips passed.`);
}
console.log('BBCode security, nesting, paragraphs, literal code and badge request regressions passed.');
