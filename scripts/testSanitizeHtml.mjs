import './tsResolve.mjs';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';

const { sanitizeHtml } = await import('../lib/sanitizeHtml.ts');
const attacks = [
  '<img src=x onerror="globalThis.__reviewExecuted=1">',
  '<a href="javascript:globalThis.__reviewExecuted=1">click</a>',
  '<a href="java&#x09;script:globalThis.__reviewExecuted=1">click</a>',
  '<a href="&#x6a;avascript&colon;globalThis.__reviewExecuted=1">click</a>',
  '<img src="data:image/svg+xml,<svg xmlns=\'http://www.w3.org/2000/svg\' onload=\'alert(1)\'/>">',
  '<svg><a xlink:href="javascript:alert(1)">SVG</a><script>alert(1)</script></svg>',
  '<math><mtext><table><mglyph><style><!--</style><img title="--><img src=1 onerror=alert(1)>">',
  '<iframe srcdoc="<script>alert(1)</script>"></iframe><object data="/api.php"></object>',
  '<p style="position:fixed;inset:0;background:url(https://example.invalid/)">text</p>',
  '<form id="location"><input name="cookie" autofocus onfocus="alert(1)"></form>',
  '<a id="location" name="document" href="https://example.test">link</a>',
  '<style>body{display:none}</style><script>globalThis.__reviewExecuted=1</script><p>visible</p>',
  '<video src=x onerror=alert(1)><source src=x onerror=alert(1)></video>',
  '<template><img src=x onerror=alert(1)></template>',
];
const article = '<h2>公告</h2><p>正文 <strong>重点</strong> <em>强调</em> <a href="https://example.test/?a=1&amp;b=2">链接</a></p><ul><li>一</li><li>二</li></ul><blockquote>引用</blockquote><table><tr><th>列</th><td>值</td></tr></table>';
assert.equal(sanitizeHtml(''), '');
assert.match(sanitizeHtml(article), /<h2>公告<\/h2>/);
assert.match(sanitizeHtml(article), /<strong>重点<\/strong>/);
assert.match(sanitizeHtml(article), /<table>/);
assert.equal(sanitizeHtml('<script>bad()</script><p>visible</p>'), '<p>visible</p>');
const outputs = [...attacks, article].map(input=>({input,html:sanitizeHtml(input)}));

if (process.argv.includes('--browser')) {
  const python = String.raw`
import sys,json
from playwright.sync_api import sync_playwright
with sync_playwright() as p:
 browser=p.chromium.launch(channel='msedge',headless=True)
 try:
  page=browser.new_page()
  page.route('**/*',lambda route:route.abort())
  result=page.evaluate('''outputs=>{
    const root=document.createElement('div');document.body.append(root);
    for(const {input,html} of outputs){
      root.innerHTML=html;
      if(root.querySelector('script,style,svg,math,iframe,object,embed,form,input,template'))throw new Error('Active element survived: '+input);
      for(const el of root.querySelectorAll('*')){
        for(const attr of el.attributes){
          if(/^on/i.test(attr.name)||['style','srcdoc'].includes(attr.name))throw new Error('Active attribute survived: '+input);
          if(['href','src'].includes(attr.name)){
            const protocol=new URL(attr.value,'https://picpony.test/').protocol;
            if(!['https:','http:','mailto:'].includes(protocol))throw new Error('Active protocol survived: '+input);
          }
          if(['id','name'].includes(attr.name)&&!attr.value.startsWith('user-content-'))throw new Error('Clobbering name survived: '+input);
        }
      }
    }
    return {executed:globalThis.__reviewExecuted===1,cases:outputs.length};
  }''',json.load(sys.stdin))
  assert not result['executed'],result
  print(json.dumps({'ok':True,**result}))
 finally:browser.close()
`;
  const run=spawnSync('python',['-X','utf8','-c',python],{input:JSON.stringify(outputs),encoding:'utf8',windowsHide:true});
  if(run.error)throw run.error;
  process.stdout.write(run.stdout);process.stderr.write(run.stderr);
  assert.equal(run.status,0,'Browser HTML sanitization checks failed');
}
console.log(`HTML sanitization: ${outputs.length} attack/format fixtures passed`);
