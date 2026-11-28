import './tsResolve.mjs';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

const { sanitizeHtml } = await import('../lib/sanitizeHtml.ts');
const { sanitizeAnnouncementUrl, sanitizeAnnouncementAttr } =
  await import('../lib/sanitizeHtml.browser.ts');
const attacks = [
  '<img src=x onerror="globalThis.__reviewExecuted=1">',
  '<a href="javascript:globalThis.__reviewExecuted=1">click</a>',
  '<a href="java&#x09;script:globalThis.__reviewExecuted=1">click</a>',
  '<a href="&#x6a;avascript&colon;globalThis.__reviewExecuted=1">click</a>',
  '<a href="tel:12345">call</a>',
  '<a href="//evil.test/x">proto-rel</a><a href="/\\evil.test/x">backslash</a>',
  '<img src="mailto:a@example.test">',
  "<img src=\"data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' onload='alert(1)'/>\">",
  '<svg><a xlink:href="javascript:alert(1)">SVG</a><script>alert(1)</script></svg>',
  '<math><mtext><table><mglyph><style><!--</style><img title="--><img src=1 onerror=alert(1)>">',
  '<iframe srcdoc="<script>alert(1)</script>"></iframe><object data="/api.php"></object><embed src="/x.swf">',
  '<p style="position:fixed;inset:0;background:url(https://example.invalid/)">text</p>',
  '<form id="location"><input name="cookie" autofocus onfocus="alert(1)"></form>',
  '<form><input name="attributes"><input name="firstChild"><input name="nextSibling"><input name="localName"><img src=x onerror="globalThis.__reviewExecuted=1"></form>',
  '<a id="location" name="document" href="https://example.test">link</a>',
  '<style>body{display:none}</style><script>globalThis.__reviewExecuted=1</script><noscript><img src=x onerror="globalThis.__reviewExecuted=1"></noscript><p>visible</p>',
  '<video src=x onerror=alert(1)><source src=x onerror=alert(1)></video>',
  '<template><img src=x onerror=alert(1)></template>',
  '<title>secret-title</title><textarea>secret-textarea</textarea><xmp>secret-xmp</xmp><p>visible</p>',
];
const article =
  '<h2>公告</h2><p>正文 <strong>重点</strong> <em>强调</em> <a href="https://example.test/?a=1&amp;b=2">链接</a> <a href=" mailto:hi@picpony.top?subject=Hello World ">邮件</a></p><ul><li>一</li><li>二</li></ul><blockquote>引用</blockquote><table><tr><th colspan="+2">列</th><td colspan=" 2 ">值</td></tr></table>';
assert.equal(sanitizeHtml(''), '');
assert.match(sanitizeHtml(article), /<h2>公告<\/h2>/);
assert.match(sanitizeHtml(article), /<strong>重点<\/strong>/);
assert.match(sanitizeHtml(article), /<table>/);
assert.match(sanitizeHtml(article), /rel="noopener noreferrer"/);
assert.match(sanitizeHtml(article), /href="mailto:hi@picpony\.top\?subject=Hello World"/);
assert.match(sanitizeHtml(article), /colspan="2"/);
assert.doesNotMatch(sanitizeHtml(article), /\+2/);
assert.equal(sanitizeHtml('<script>bad()</script><p>visible</p>'), '<p>visible</p>');
assert.equal(
  sanitizeHtml('<title>a</title><textarea>b</textarea><xmp>c</xmp><p>ok</p>'),
  '<p>ok</p>',
);
assert.doesNotMatch(
  sanitizeHtml('<a href="//evil.test/x">a</a><a href="/\\evil.test/x">b</a>'),
  /evil\.test/,
);
assert.doesNotMatch(
  sanitizeHtml('<a id="location" name="document" href="https://example.test">link</a>'),
  /\b(?:id|name)=/i,
);

// Verify the browser sanitizer's URL & attribute validators in Node as well.
assert.equal(
  sanitizeAnnouncementUrl('href', 'https://example.test/?a=1&b=2'),
  'https://example.test/?a=1&b=2',
);
assert.equal(sanitizeAnnouncementUrl('href', 'mailto:hi@picpony.top'), 'mailto:hi@picpony.top');
assert.equal(
  sanitizeAnnouncementUrl('href', ' mailto:hi@picpony.top?subject=Hello World '),
  'mailto:hi@picpony.top?subject=Hello World',
);
assert.equal(sanitizeAnnouncementUrl('href', 'tel:12345'), null);
assert.equal(sanitizeAnnouncementUrl('href', 'java\tscript:alert(1)'), null);
assert.equal(sanitizeAnnouncementUrl('href', 'java script:alert(1)'), null);
assert.equal(sanitizeAnnouncementUrl('href', '//evil.test/x'), null);
assert.equal(sanitizeAnnouncementUrl('href', '/\\evil.test/x'), null);
assert.equal(
  sanitizeAnnouncementUrl('src', 'https://picpony.top/a.png'),
  'https://picpony.top/a.png',
);
assert.equal(sanitizeAnnouncementUrl('src', '/uploads/a.png'), '/uploads/a.png');
assert.equal(sanitizeAnnouncementUrl('src', 'mailto:a@b.c'), null);
assert.equal(sanitizeAnnouncementUrl('src', 'data:image/svg+xml,<svg/>'), null);
assert.equal(sanitizeAnnouncementUrl('src', ''), null);
assert.equal(sanitizeAnnouncementAttr('a', 'id', 'location'), null);
assert.equal(sanitizeAnnouncementAttr('a', 'name', 'document'), null);
assert.equal(sanitizeAnnouncementAttr('p', 'style', 'color:red'), null);
assert.equal(sanitizeAnnouncementAttr('img', 'onerror', 'alert(1)'), null);
assert.equal(sanitizeAnnouncementAttr('td', 'colspan', '02'), '2');
assert.equal(sanitizeAnnouncementAttr('td', 'colspan', ' 2 '), '2');
assert.equal(sanitizeAnnouncementAttr('td', 'colspan', '+2'), null);
assert.equal(sanitizeAnnouncementAttr('td', 'colspan', '0'), null);
assert.equal(sanitizeAnnouncementAttr('td', 'colspan', '1001'), null);

const outputs = [...attacks, article].map((input) => ({ input, html: sanitizeHtml(input) }));

if (process.argv.includes('--browser')) {
  const browserSanitizerCode = ts.transpileModule(
    readFileSync(new URL('../lib/sanitizeHtml.browser.ts', import.meta.url), 'utf8'),
    { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } },
  ).outputText;
  const python = String.raw`
import sys,json
from playwright.sync_api import sync_playwright
payload=json.load(sys.stdin)
with sync_playwright() as p:
 browser=p.chromium.launch(channel='msedge',headless=True)
 try:
  page=browser.new_page()
  page.route('**/*',lambda route:route.abort())
  result=page.evaluate(r'''({outputs,inputs,article,browserSanitizerCode})=>{
    const mod={exports:{}};
    new Function('exports','module',browserSanitizerCode)(mod.exports,mod);
    const browserSanitize=mod.exports.sanitizeHtml;
    const browserOutputs=inputs.map(input=>({input,html:browserSanitize(input)}));
    const checkList=(list,label)=>{
      const root=document.createElement('div');document.body.append(root);
      for(const {input,html} of list){
        root.innerHTML=html;
        if(root.querySelector('script,style,svg,math,iframe,object,embed,form,input,template,noscript'))throw new Error(label+' Active element survived: '+input);
        for(const el of root.querySelectorAll('*')){
          for(const attr of el.attributes){
            if(/^on/i.test(attr.name)||['style','srcdoc'].includes(attr.name))throw new Error(label+' Active attribute survived: '+input);
            if(attr.name==='href'){
              if(/^(\/\/|\\|\/\\)/.test(attr.value))throw new Error(label+' Protocol-relative href survived: '+input);
              const parsed=new URL(attr.value,'https://picpony.test/');
              if(!['https:','http:','mailto:'].includes(parsed.protocol)||parsed.hostname==='evil.test')throw new Error(label+' Active href protocol survived: '+input);
              if(el.tagName==='A'&&el.getAttribute('rel')!=='noopener noreferrer')throw new Error(label+' Missing rel on link: '+input);
            }
            if(attr.name==='src'){
              if(/^(\/\/|\\|\/\\)/.test(attr.value))throw new Error(label+' Protocol-relative src survived: '+input);
              const parsed=new URL(attr.value,'https://picpony.test/');
              if(!['https:','http:'].includes(parsed.protocol)||parsed.hostname==='evil.test')throw new Error(label+' Active src protocol survived: '+input);
            }
            if(['id','name'].includes(attr.name))throw new Error(label+' Clobbering name survived: '+input);
          }
        }
        if(/secret-(?:title|textarea|xmp)/.test(root.textContent||''))throw new Error(label+' Stripped tag text survived: '+input);
      }
      root.remove();
    };
    checkList(outputs,'node');
    checkList(browserOutputs,'browser');
    const cleanArticle=browserSanitize(article);
    if(!/<h2>公告<\/h2>/.test(cleanArticle)||!/<strong>重点<\/strong>/.test(cleanArticle)||!/<table>/.test(cleanArticle)||!/rel="noopener noreferrer"/.test(cleanArticle)||!/href="mailto:hi@picpony\.top\?subject=Hello World"/.test(cleanArticle)||!/colspan="2"/.test(cleanArticle)||/\+2/.test(cleanArticle)){
      throw new Error('Browser sanitizer dropped valid article markup: '+cleanArticle);
    }
    if(browserSanitize('<script>bad()</script><p>visible</p>')!=='<p>visible</p>'){
      throw new Error('Browser sanitizer kept script text');
    }
    if(browserSanitize(cleanArticle)!==cleanArticle){
      throw new Error('Browser sanitizer is not idempotent');
    }
    return {executed:globalThis.__reviewExecuted===1,cases:outputs.length,browserCases:browserOutputs.length};
  }''',payload)
  assert not result['executed'],result
  print(json.dumps({'ok':True,**result}))
 finally:browser.close()
`;
  const run = spawnSync('python', ['-X', 'utf8', '-c', python], {
    input: JSON.stringify({
      outputs,
      inputs: [...attacks, article],
      article,
      browserSanitizerCode,
    }),
    encoding: 'utf8',
    windowsHide: true,
  });
  if (run.error) throw run.error;
  process.stdout.write(run.stdout);
  process.stderr.write(run.stderr);
  assert.equal(run.status, 0, 'Browser HTML sanitization checks failed');
}
console.log(`HTML sanitization: ${outputs.length} attack/format fixtures passed`);
