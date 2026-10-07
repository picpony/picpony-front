/** Full-page regressions for live favourites and untrusted tag names.
 * Requires a production build, Python Playwright and Edge. All APIs use fixtures.
 */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { createServer } from 'node:http';
import path from 'node:path';
import { image, stubFor } from './netAuditFixtures.mjs';

const root = path.resolve(import.meta.dirname, '..');
assert.ok(existsSync(path.join(root, '.next/BUILD_ID')), 'Run npm run build first');
const user = { id: 1, username: 'fixture', token: 'favorites-regression', role: 'user', api_key: '' };
let favorites = Array.from({ length: 120 }, (_, i) => 2000 + i);
let mutations = 0;
let failRefresh = true;
const translatedTags = new Set();
const json = (value) => ({ body: JSON.stringify(value), contentType: 'application/json' });
function fixture(rawUrl, body) {
  const url = new URL(rawUrl);
  const action = url.searchParams.get('action');
  if (action === 'get_user') return json({ success: true, user: { ...user, settings: {} } });
  if (action === 'get_fave_folders') return json({ success: true, folders: [{id:1,name:'主收藏夹',is_main:1,item_count:favorites.length,latest_image_id:2000}] });
  if (action === 'get_faves') return json({ success: true, faves: favorites, faves_folders: Object.fromEntries(favorites.map(id=>[id,[1]])) });
  if (action === 'toggle_fave') {
    const id = JSON.parse(body).image_id;
    mutations++;
    favorites = favorites.includes(id) ? favorites.filter((value) => value !== id) : [id, ...favorites];
    return json({ success: true, is_faved: favorites.includes(id) });
  }
  if (action === 'get_tag_translations') {
    for (const tag of JSON.parse(body).tags) translatedTags.add(tag);
    return json({ success: true, translations: {} });
  }
  const target = new URL(url.searchParams.get('url') ?? rawUrl);
  if (target.pathname.endsWith('/search/images')) {
    /* Positive `id:` terms only: a list query also carries the public blacklist as `-id:N`
       exclusions, and matching those answered an id search nobody made (B2, F3). */
    const ids = [...(target.searchParams.get('q') ?? '').matchAll(/(?<![-\w])id:(\d+)/g)].map((match) => Number(match[1]));
    if (mutations === 1 && ids.includes(2100) && failRefresh) {
      failRefresh = false;
      return { ...json({ error: 'Retry this refresh' }), status: 429 };
    }
    if (ids.length) return json({ images: ids.map((id) => image(id)), total: ids.length });
  }
  if (target.pathname.endsWith('/images/2010')) {
    return json({ image: { ...image(2010), tags: ['safe', 'species:__proto__', 'species:constructor'] } });
  }
  return stubFor(rawUrl);
}

const upstream = createServer((req, res) => {
  try {
    const url = new URL(req.url, 'http://127.0.0.1');
    const isLookup = url.pathname === '/__fixture';
    const raw = isLookup ? url.searchParams.get('url') : url.pathname.startsWith('/api/v1/json')
      ? `https://trixiebooru.org${req.url}` : url.href;
    const answer = fixture(raw, url.searchParams.get('body'));
    if (isLookup) return void res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(answer));
    if (!answer) return void res.writeHead(404).end();
    res.writeHead(200, { 'content-type': answer.contentType, 'cache-control': 'no-store' });
    res.end(answer.binary ? Buffer.from(answer.body, 'base64') : answer.body);
  } catch (error) {
    res.writeHead(500).end(String(error));
  }
});
await new Promise((resolve) => upstream.listen(0, '127.0.0.1', resolve));
const upstreamOrigin = `http://127.0.0.1:${upstream.address().port}`;
const reservation = createServer();
await new Promise((resolve) => reservation.listen(0, '127.0.0.1', resolve));
const port = reservation.address().port;
await new Promise((resolve) => reservation.close(resolve));
const origin = `http://127.0.0.1:${port}`;
const server = spawn(process.execPath, [path.join(root, 'node_modules/next/dist/bin/next'), 'start', '-p', String(port)], {
  cwd: root, windowsHide: true, stdio: 'ignore', env: {
    ...process.env, PICPONY_UPSTREAM_ORIGIN: upstreamOrigin,
    PICPONY_DERPI_ORIGIN: `${upstreamOrigin}/api/v1/json`, PICPONY_SERVER_MEMO_TTL_MS: '0',
  },
});
const python = String.raw`
import sys, json, re, base64, urllib.request, urllib.parse
from playwright.sync_api import sync_playwright, expect
origin, fixture, user = sys.argv[1], sys.argv[2], json.loads(sys.argv[3])
with sync_playwright() as p:
    browser = p.chromium.launch(channel='msedge', headless=True)
    try:
        context = browser.new_context(viewport={'width': 1440, 'height': 1000}, service_workers='block')
        context.add_init_script('localStorage.setItem("picpony_motion", "off");localStorage.setItem("user_info", ' + json.dumps(json.dumps(user)) + ');')
        held_more = []
        state = {'hold_more': False}
        def route_request(route):
            raw = route.request.url
            lookup = fixture + '/__fixture?' + urllib.parse.urlencode({'url': raw, 'body': route.request.post_data or ''})
            with urllib.request.urlopen(lookup, timeout=10) as response:
                stub = json.load(response)
            if stub:
                params = urllib.parse.parse_qs(urllib.parse.urlparse(raw).query)
                target = urllib.parse.urlparse(params.get('url', [raw])[0])
                query = urllib.parse.parse_qs(target.query).get('q', [''])[0]
                if state['hold_more'] and 'id:2119' in query:
                    held_more.append((route, stub))
                    state['hold_more'] = False
                    return
                return route.fulfill(status=stub.get('status', 200), content_type=stub['contentType'], body=base64.b64decode(stub['body']) if stub.get('binary') else stub['body'])
            if raw.startswith(origin + '/'):
                return route.continue_()
            return route.abort()
        context.route('**/*', route_request)
        page = context.new_page()
        errors = []
        page.on('pageerror', lambda error: errors.append(str(error)))
        page.goto(origin + '/favorites', wait_until='networkidle')
        page.locator('a[href="/favorites/folder/1"]').click()
        cards = page.locator('[data-page-content] a[href^="/pic/"]')
        expect(cards).to_have_count(50)
        # Selection is the existing gallery, with sibling keyboard controls; Back peels it.
        page.get_by_role('button', name='选择', exact=True).click()
        selected = page.locator('[data-select-card]')
        expect(selected).to_have_count(50)
        selected.first.focus()
        page.keyboard.press('Space')
        expect(selected.first).to_have_attribute('aria-checked', 'true')
        selected.nth(2).click(modifiers=['Shift'])
        expect(page.get_by_text('已选择 3 张', exact=True)).to_be_visible()
        assert page.locator('a button').count() == 0
        assert page.locator('.image-card[inert]').count() == 50
        page.evaluate('history.back()')
        expect(page.get_by_role('button', name='选择', exact=True)).to_be_focused()
        expect(page).to_have_url(origin + '/favorites/folder/1')
        expect(cards).to_have_count(50)
        page.get_by_role('button', name='第 2 页', exact=True).click()
        expect(page).to_have_url(origin + '/favorites/folder/1?page=2')
        expect(page.locator('a[href="/pic/2090"]')).to_have_count(1)
        page.locator('a[href="/pic/2090"]').first.click()
        expect(page.locator('[data-image-detail-overlay]')).to_be_visible()
        page.get_by_role('button', name='收藏', exact=True, pressed=True).click()
        expect(page.get_by_role('button', name='收藏', exact=True, pressed=False)).to_be_visible()
        page.keyboard.press('Escape')
        expect(page).to_have_url(origin + '/favorites/folder/1?page=2')
        expect(page.get_by_role('button', name='重试', exact=True)).to_be_visible()
        expect(cards).to_have_count(49)
        page.get_by_role('button', name='重试', exact=True).click()
        expect(cards).to_have_count(50)
        expect(page.locator('a[href="/pic/2090"]')).to_have_count(0)
        page.locator('a[href="/pic/2099"]').first.click()
        page.get_by_role('button', name='收藏', exact=True, pressed=True).click()
        expect(page.get_by_role('button', name='收藏', exact=True, pressed=False)).to_be_visible()
        page.keyboard.press('Escape')
        expect(page).to_have_url(origin + '/favorites/folder/1?page=2')
        expect(cards).to_have_count(50)
        expect(page.locator('a[href="/pic/2099"]')).to_have_count(0)
        page.get_by_role('button', name='第 3 页', exact=True).click()
        expect(cards).to_have_count(18)
        page.get_by_role('button', name='第 1 页', exact=True).click()
        expect(cards).to_have_count(50)
        page.locator('a[href="/pic/2010"]').first.click()
        expect(page.get_by_role('button', name='species:__proto__', exact=True)).to_be_visible()
        expect(page.get_by_role('button', name='species:constructor', exact=True)).to_be_visible()
        page.goto(origin + '/search?q=pony&page=2', wait_until='networkidle')
        search = page.locator('[data-page-content] input[role="combobox"]')
        expect(search).to_have_value('pony')
        search.evaluate('(el) => { window.retainedSearchInput = el; }')
        page.locator('[data-page-content] a[href^="/pic/"]').first.click()
        expect(page.locator('[data-image-detail-overlay]')).to_be_visible()
        expect(search).to_have_value('pony')
        page.keyboard.press('Escape')
        expect(page).to_have_url(origin + '/search?q=pony&page=2')
        expect(search).to_have_value('pony')
        page.go_forward(wait_until='domcontentloaded')
        expect(page.locator('[data-image-detail-overlay]')).to_be_visible()
        expect(search).to_have_value('pony')
        assert search.evaluate('(el) => el === window.retainedSearchInput'), 'The background search remounted'
        page.go_back(wait_until='domcontentloaded')
        expect(page).to_have_url(origin + '/search?q=pony&page=2')
        expect(search).to_have_value('pony')
        assert not errors, errors
        print('Favourites keep the current folder page after mutation; reserved tag names render safely.', flush=True)
    finally:
        browser.close()
`;
try {
  let ready = false;
  for (let attempt = 0; attempt < 120; attempt++) {
    if (server.exitCode !== null) throw new Error('Test server exited before startup');
    try { ready = (await fetch(`${origin}/policy`)).ok; } catch { /* Starting up. */ }
    if (ready) break;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  assert.ok(ready, 'Test server did not start');
  const result = await new Promise((resolve, reject) => {
    const child = spawn('python', ['-X', 'utf8', '-c', python, origin, upstreamOrigin, JSON.stringify(user)], { stdio: 'inherit', windowsHide: true });
    child.on('error', reject);
    child.on('exit', resolve);
  });
  assert.equal(result, 0, 'Browser regression failed');
  assert.equal(mutations, 2);
  assert.ok(translatedTags.has('__proto__') && translatedTags.has('constructor'), 'Reserved tag names must also be queried');
} finally {
  server.kill();
  upstream.closeAllConnections();
  await new Promise((resolve) => upstream.close(resolve));
}
