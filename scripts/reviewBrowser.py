"""Black-box route coverage against the production build and local API fixtures."""
import base64
import json
import pathlib
import sys
import urllib.parse
import urllib.request
from playwright.sync_api import sync_playwright, expect

BASE, FIXTURES = sys.argv[1:3]
ROOT = pathlib.Path(__file__).resolve().parent.parent
OUTPUT = ROOT / '.workbuddy' / 'review-20260912'
OUTPUT.mkdir(parents=True, exist_ok=True)
AXE = (ROOT / 'node_modules' / 'axe-core' / 'axe.min.js').read_text(encoding='utf-8')
ROUTES = ['/', '/?tab=forum', '/about', '/search?q=pony', '/settings', '/policy',
          '/tasks', '/messages', '/messages?tab=notification', '/messages?tab=interaction', '/messages?tab=chat&to=2',
          '/favorites', '/history', '/block-groups', '/upload', '/forum/create',
          '/forum/1', '/pic/1000', '/user/1', '/derpi/user/fixture', '/claim-badge',
          '/missing-route']
ADMIN = ['welcome', 'glossary', 'users', 'notifications', 'messages', 'badges',
         'blocktags', 'developer', 'team', 'shop', 'reports', 'blacklist', 'wealth', 'other']
USER = {'id': 1, 'username': 'Review Admin', 'role': 'super_admin', 'token': 'review-fixture-token',
        'api_key': 'review-fixture-key', 'email': 'review@example.test', 'email_verified': True,
        'avatar': '', 'experience': 1350, 'coins': 100}
cache = {}
results = []
failures = []


def fulfill_json(route, value):
    route.fulfill(status=200, content_type='application/json', body=json.dumps(value))


def admin_actions(context):
    """Exercise real event handlers with delayed, denied and out-of-order local responses."""
    page = context.new_page()
    try:
        page.goto(BASE + '/admin?tab=messages', wait_until='networkidle')
        page.get_by_role('button', name='检索', exact=True).click()
        expect(page.get_by_text('Review fixture message', exact=True)).to_be_visible()
        pending = []
        page.route('**/api.php?action=admin_get_all_messages*', lambda route: pending.append(route))
        user_id = page.get_by_placeholder('输入用户 ID 查询 TA 的私信…')
        user_id.fill('1')
        page.get_by_role('button', name='检索', exact=True).click()
        page.wait_for_timeout(50)
        user_id.fill('2')
        page.get_by_role('button', name='检索', exact=True).click()
        page.wait_for_timeout(50)
        assert len(pending) == 2, 'Both explicit audit searches must be sent'
        def message(text):
            return {'success': True, 'messages': [{'id': 10, 'content': text, 'sender_name': 'Fixture',
                    'receiver_name': 'Review Admin', 'is_read': 1, 'created_at': '2024-01-01'}]}
        fulfill_json(pending[1], message('latest audit result'))
        expect(page.get_by_text('latest audit result', exact=True)).to_be_visible()
        fulfill_json(pending[0], message('stale audit result'))
        page.wait_for_timeout(100)
        expect(page.get_by_text('latest audit result', exact=True)).to_be_visible()
        expect(page.get_by_text('stale audit result', exact=True)).to_have_count(0)
        page.get_by_role('button', name='检索', exact=True).click()
        page.wait_for_timeout(50)
        fulfill_json(pending[-1], {'success': False, 'error': 'Fixture denied'})
        expect(page.get_by_text('Fixture denied', exact=True)).to_be_visible()
        page.get_by_role('button', name='重试', exact=True).click()
        page.wait_for_timeout(50)
        assert 'user_id=2' in pending[-1].request.url, 'Retry must preserve the selected user'
        fulfill_json(pending[-1], message('audit recovered'))
        expect(page.get_by_text('audit recovered', exact=True)).to_be_visible()
    finally:
        page.close()

    for tab, action, text in [('users', 'admin_get_users', 'review@example.test'),
                              ('shop', 'get_shop_items', 'Fixture item'),
                              ('reports', 'admin_get_reports', 'Fixture report'),
                              ('notifications', 'admin_get_notifications', 'Fixture notice'),
                              ('team', 'get_team_members', 'FixtureDev'),
                              ('blacklist', 'admin_get_blacklist', None),
                              ('wealth', 'admin_get_users', 'Review Admin')]:
        page = context.new_page()
        deny = {'value': True}
        def respond(route):
            if deny['value']:
                fulfill_json(route, {'success': False, 'error': 'Fixture collection denied'})
            else:
                route.fallback()
        page.route('**/api.php?action=' + action + '*', respond)
        try:
            page.goto(BASE + '/admin?tab=' + tab, wait_until='networkidle')
            expect(page.get_by_text('Fixture collection denied', exact=True)).to_be_visible()
            deny['value'] = False
            page.get_by_role('button', name='重试', exact=True).click()
            expect(page.get_by_text('Fixture collection denied', exact=True)).to_have_count(0)
            if text:
                expect(page.locator('main').get_by_text(text, exact=True).first).to_be_visible()
        finally:
            page.close()

    page = context.new_page()
    pending = []
    page.route('**/api.php?action=admin_send_notification', lambda route: pending.append(route))
    try:
        page.goto(BASE + '/admin?tab=notifications', wait_until='networkidle')
        page.get_by_label('通知标题', exact=True).fill('Fixture title')
        page.get_by_label('通知正文', exact=True).fill('Fixture body')
        target = page.get_by_label('接收用户 ID（0=全站广播）', exact=True)
        target.fill('')
        page.get_by_role('button', name='发送通知', exact=True).click()
        page.wait_for_timeout(100)
        assert len(pending) == 0, 'An empty recipient must never become a global broadcast'
        target.fill('2')
        page.get_by_role('button', name='发送通知', exact=True).evaluate('(button) => {button.click(); button.click()}')
        page.wait_for_timeout(100)
        assert len(pending) == 1, 'Only one notification may be sent while its response is pending'
        assert json.loads(pending[0].request.post_data)['user_id'] == 2
        fulfill_json(pending[0], {'success': True})
        expect(page.get_by_label('通知标题', exact=True)).to_have_value('')
    finally:
        page.close()

    page = context.new_page()
    pending = []
    page.route('**/api.php?action=admin_save_shop_item', lambda route: pending.append(route))
    try:
        page.goto(BASE + '/admin?tab=shop', wait_until='networkidle')
        field = page.get_by_label('商品名称', exact=True)
        field.fill('New fixture item')
        page.get_by_role('button', name='添加商品', exact=True).evaluate('(button) => {button.click(); button.click()}')
        page.wait_for_timeout(100)
        assert len(pending) == 1, 'An in-flight create must not create a second item'
        edit = page.get_by_role('button', name='编辑 Fixture item', exact=True)
        expect(edit).to_be_disabled()
        edit.evaluate('(button) => button.click()')
        expect(field).to_have_value('New fixture item')
        fulfill_json(pending[0], {'success': False, 'error': 'Fixture save denied'})
        expect(page.get_by_text('Fixture save denied', exact=True)).to_be_visible()
        expect(field).to_have_value('New fixture item')
        expect(page.get_by_role('button', name='添加商品', exact=True)).to_be_enabled()
    finally:
        page.close()
    print('PASS admin behavior: parsed API envelope, stale responses, denied reads/retry, exact recipient, duplicate creates and preserved drafts', flush=True)


def intercepted(route):
    request = route.request
    parsed = urllib.parse.urlparse(request.url)
    # Local code/documents pass through; every business endpoint and external asset is mocked.
    if request.url.startswith(BASE) and not (parsed.path.startswith(('/api.php', '/relay', '/search-api', '/_next/image'))):
        route.continue_()
        return
    # Timestamp cache-busters are irrelevant to a deterministic fixture.
    pairs = [(k, v) for k, v in urllib.parse.parse_qsl(parsed.query) if k != '_t']
    key = parsed._replace(query=urllib.parse.urlencode(pairs)).geturl()
    if key not in cache:
        target = FIXTURES + '/__review_fixture?url=' + urllib.parse.quote(key, safe='')
        with urllib.request.urlopen(target) as response:
            cache[key] = json.load(response)
    data = cache[key]
    if data is None:
        route.abort()
        return
    route.fulfill(status=200, content_type=data['contentType'],
                  body=base64.b64decode(data['body']) if data.get('binary') else data['body'])


def inspect(page, name, route_path):
    errors = []
    page.on('pageerror', lambda error: errors.append(str(error)))
    response = page.goto(BASE + route_path, wait_until='networkidle')
    if route_path.startswith('/messages?tab='):
        labels = {'notification': '系统', 'interaction': '互动', 'chat': '私信'}
        requested = urllib.parse.parse_qs(urllib.parse.urlparse(route_path).query)['tab'][0]
        page.get_by_role('tab', name=labels[requested], exact=True).click()
        expect(page.get_by_role('tab', name=labels[requested], exact=True)).to_have_attribute('aria-selected', 'true')
        page.wait_for_load_state('networkidle')
    page.wait_for_timeout(250)
    # Shell text alone must never turn a failed content request into a passing smoke check.
    if route_path in ['/', '/search?q=pony']:
        page.locator('main a[href^="/pic/"]').first.wait_for(state='visible')
    elif route_path == '/?tab=forum':
        page.locator('main a[href^="/forum/"]').first.wait_for(state='visible')
    elif route_path == '/forum/1':
        page.get_by_text('Review fixture thread', exact=True).first.wait_for(state='visible')
    elif route_path == '/about':
        page.get_by_text('FixtureDev', exact=True).first.wait_for(state='visible')
    elif route_path == '/user/1':
        page.get_by_role('heading', name='fixture', exact=True).wait_for(state='visible')
    elif route_path == '/missing-route':
        page.get_by_role('heading', name='这里什么都没有', exact=True).wait_for(state='visible')
        expect(page.locator('meta[name="robots"]').first).to_have_attribute('content', 'noindex')
    if 'admin' in name:
        checks = {'/admin?tab=users': 'review@example.test', '/admin?tab=shop': 'Fixture item',
                  '/admin?tab=reports': 'Fixture report', '/admin?tab=notifications': 'Fixture notice',
                  '/admin?tab=team': 'FixtureDev', '/messages?tab=notification': 'Fixture notification body'}
        if route_path in checks:
            page.get_by_text(checks[route_path], exact=True).first.wait_for(state='visible')
        if route_path in ['/history', '/favorites']:
            page.locator('main a[href^="/pic/"]').first.wait_for(state='visible')
    page.evaluate(AXE)
    report = page.evaluate("""async () => {
      const result = await axe.run(document, {
        runOnly: {type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']},
        // AGENTS.md documents deliberate palette contrast exceptions. The palette generator
        // asserts its own role matrix; this suite checks the remaining WCAG contracts.
        rules: {'color-contrast': {enabled: false}}
      });
      const main = document.querySelector('main');
      const scroller = document.querySelector('[data-app-scroller]');
      return {
        violations: result.violations.map(v => ({id: v.id, impact: v.impact,
          nodes: v.nodes.map(n => ({target: n.target, html: n.html, summary: n.failureSummary}))})),
        textLength: main?.innerText.trim().length ?? 0,
        overflow: {document: document.documentElement.scrollWidth - innerWidth,
          main: main ? main.scrollWidth - main.clientWidth : 0,
          scroller: scroller ? scroller.scrollWidth - scroller.clientWidth : 0},
        invalidNestedControls: [...document.querySelectorAll('button button, a button, button a, a a')]
          .filter(e => e.getClientRects().length).map(e => e.outerHTML.slice(0, 200))
      };
    }""")
    report.update({'profile': name, 'route': route_path, 'status': response.status, 'pageErrors': errors})
    results.append(report)
    bad = report['violations'] or errors or report['invalidNestedControls'] or report['textLength'] == 0
    bad = bad or report['overflow']['document'] > 1 or report['overflow']['main'] > 1
    # Next's documented streaming not-found contract uses 200 after headers are sent.
    # The noindex tag and the actual not-found view above establish the route's meaning.
    bad = bad or response.status not in ([200, 404] if route_path == '/missing-route' else [200])
    if bad:
        failures.append(report)
        print(f"FAIL {name} {route_path}: axe={[v['id'] for v in report['violations']]} errors={errors} overflow={report['overflow']}", flush=True)
    else:
        print(f"PASS {name} {route_path}", flush=True)
    if route_path in ['/', '/about', '/settings', '/admin?tab=users'] or bad:
        slug = urllib.parse.quote(route_path, safe='').replace('%', '_')
        page.screenshot(path=str(OUTPUT / f'{name}-{slug}.png'))


with sync_playwright() as playwright:
    browser = playwright.chromium.launch(channel='msedge', headless=True)
    profiles = [('desktop-guest', 1440, False, 'light'), ('desktop-admin', 1440, True, 'dark'),
                ('mobile-admin', 390, True, 'light')]
    if '--quick' in sys.argv:
        profiles = profiles[:2]
    if '--actions-only' in sys.argv:
        profiles = profiles[1:2]
    if '--mobile-only' in sys.argv:
        profiles = profiles[-1:]
    for name, width, logged_in, scheme in profiles:
        context = browser.new_context(viewport={'width': width, 'height': 900},
                                      color_scheme=scheme, reduced_motion='reduce',
                                      is_mobile=width < 500, has_touch=width < 500)
        context.route('**/*', intercepted)
        stored = {'picpony_dev_banner_dismissed': 'true', 'trixie_use_cdn': 'false',
                  'picpony_use_proxy': 'false', 'picpony_motion': 'off', 'picpony_hk_relay': 'false'}
        if logged_in:
            stored['user_info'] = json.dumps(USER)
        context.add_init_script('for (const [k,v] of Object.entries(' + json.dumps(stored) + ')) localStorage.setItem(k,v)')
        paths = ROUTES + ([f'/admin?tab={tab}' for tab in ADMIN] if logged_in else ['/admin'])
        if '--actions-only' in sys.argv:
            paths = []
        for route_path in paths:
            page = context.new_page()
            try:
                inspect(page, name, route_path)
            except Exception as error:
                entry = {'profile': name, 'route': route_path, 'error': str(error),
                         'text': page.locator('main').inner_text()[:2500]}
                slug = urllib.parse.quote(route_path, safe='').replace('%', '_')
                page.screenshot(path=str(OUTPUT / f'{name}-{slug}-error.png'))
                failures.append(entry)
                results.append(entry)
                print(f'FAIL {name} {route_path}: {error}', flush=True)
            finally:
                page.close()
        if name == 'desktop-admin':
            try:
                admin_actions(context)
                results.append({'profile': name, 'route': 'admin behaviors', 'passed': True})
            except Exception as error:
                entry = {'profile': name, 'route': 'admin behaviors', 'error': str(error)}
                failures.append(entry)
                results.append(entry)
                print(f'FAIL admin behaviors: {error}', flush=True)
        context.close()
    browser.close()

(OUTPUT / 'browser-results.json').write_text(json.dumps(results, ensure_ascii=False, indent=2), encoding='utf-8')
print(f'{len(results)} route/profile checks, {len(failures)} failed; report: {OUTPUT / "browser-results.json"}', flush=True)
sys.exit(1 if failures else 0)
