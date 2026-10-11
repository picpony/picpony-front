"""Hold the real production form chunk across dismissals; no live business requests."""
import json
import pathlib
import sys
import time
from urllib.parse import urlparse
from playwright.sync_api import sync_playwright, expect

BASE = sys.argv[1]
ROOT = pathlib.Path(__file__).resolve().parent.parent
CHUNKS = ROOT / '.next' / 'static' / 'chunks'
AUTH_PATHS = {
    '/_next/static/chunks/' + file.relative_to(CHUNKS).as_posix()
    for file in CHUNKS.rglob('*.js') if 'picpony_pending_reset' in file.read_text(encoding='utf-8')
}
assert AUTH_PATHS, 'The production build must contain the authentication forms'


def check(browser, scenario, touch=False):
    context = browser.new_context(
        viewport={'width': 390 if touch else 1440, 'height': 900},
        is_mobile=touch, has_touch=touch, service_workers='block',
    )
    pending, errors, loaded = [], [], []
    released = False

    def route_request(route):
        url = route.request.url
        if not url.startswith(BASE + '/'):
            route.fulfill(status=204, body='')
        elif 'action=get_announcement' in url:
            route.fulfill(status=200, content_type='application/json',
                          body=json.dumps({'success': True, 'announcement': None}))
        elif urlparse(url).path in AUTH_PATHS:
            loaded.append(url)
            if released:
                route.continue_()
            else:
                pending.append(route)
        else:
            route.continue_()

    context.route('**/*', route_request)
    try:
        page = context.new_page()
        page.on('pageerror', lambda error: errors.append(str(error)))
        page.goto(BASE + '/history', wait_until='networkidle')
        trigger = page.get_by_role('main').get_by_role('button', name='登录', exact=True)
        expect(trigger).to_be_visible()
        assert not loaded, 'Providing openAuth must not load the forms on a signed-out page'
        trigger.click()
        dialog = page.get_by_role('dialog', name='登录', exact=True)
        expect(dialog.get_by_role('progressbar', name='加载中', exact=True)).to_be_visible()
        deadline = time.monotonic() + 10
        while not pending and time.monotonic() < deadline:
            page.wait_for_timeout(20)
        assert pending, 'Opening the dialog must request its form code'

        if scenario != 'arrive':
            if scenario == 'escape':
                page.keyboard.press('Escape')
            elif scenario == 'back':
                page.evaluate('history.back()')
            else:
                dialog.get_by_role('button', name='关闭', exact=True).click()
            expect(dialog).not_to_be_visible()
            if scenario == 'replace':
                trigger.click()
                expect(dialog.get_by_role('progressbar')).to_be_visible()

        released = True
        for request in pending:
            request.continue_()
        pending.clear()
        page.wait_for_load_state('networkidle')

        if scenario in ('escape', 'back'):
            expect(dialog).not_to_be_visible()
            expect(trigger).to_be_focused()
            assert urlparse(page.url).path == '/history', 'Back closes the layer, not its page'
            trigger.click()

        username = dialog.get_by_label('用户名', exact=True)
        expect(username).to_be_visible()
        expect(dialog.get_by_role('progressbar')).to_have_count(0)
        if touch:
            expect(dialog.get_by_role('heading', name='登录', exact=True)).to_be_focused()
            expect(username).not_to_be_focused()
        else:
            expect(username).to_be_focused()
        username.fill('A fresh flow')
        expect(username).to_have_value('A fresh flow')
        dialog.get_by_role('button', name='关闭', exact=True).click()
        expect(dialog).not_to_be_visible()
        assert not errors, errors
    finally:
        context.close()


with sync_playwright() as playwright:
    browser = playwright.chromium.launch(channel='msedge', headless=True)
    try:
        for scenario in ['escape', 'back', 'replace']:
            check(browser, scenario)
        check(browser, 'arrive', touch=True)
    finally:
        browser.close()
print(json.dumps({'ok': True, 'checks': ['deferred-auth-chunk', 'loading-escape',
    'loading-back', 'loading-replacement', 'mouse-focus', 'touch-focus']}))
