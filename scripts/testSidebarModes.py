"""Desktop sidebar modes, interrupted layout motion and independent phone state.
Run against a production build with bun run test:sidebar. All API/media use fixtures.
"""
import base64
import json
import pathlib
import statistics
import sys
import urllib.parse
import urllib.request
from playwright.sync_api import sync_playwright, expect
from browserLaunch import browser_options

BASE, FIXTURES = sys.argv[1:3]
OUTPUT = pathlib.Path(__file__).resolve().parent.parent / '.workbuddy/sidebar-regression'
OPENER = urllib.request.build_opener(urllib.request.ProxyHandler({}))
CACHE = {}
USER = {'id': 1, 'username': 'Review Admin', 'role': 'super_admin',
        'token': 'review-fixture-token', 'avatar': ''}
CONTROL = 'button[aria-controls="app-sidebar"]'
POSE = """() => {
  const side = document.querySelector('#app-sidebar'), box = side.getBoundingClientRect();
  const host = document.querySelector('[data-image-detail-host]').getBoundingClientRect();
  const page = document.querySelector('.app-scroller');
  const card = page.querySelector('[data-masonry-id]')?.getBoundingClientRect();
  const label = side.querySelector('.sidebar-row .sidebar-label');
  return {width: box.width, right: box.right, page: host.left,
    contentWidth: page.getBoundingClientRect().width, heldWidth: page.style.minWidth,
    layoutWidth: page.querySelector('[data-image-detail-background-visual]').getBoundingClientRect().width,
    card: card ? {left: card.left - host.left, top: card.top, width: card.width, height: card.height} : null,
    mode: side.dataset.sidebarMode, inert: side.inert,
    label: Number(getComputedStyle(label).opacity)};
}"""
SETTLED = """() => !document.getAnimations().some(a => {
  const el = a.effect?.target;
  return el instanceof Element && el.closest('#app-sidebar') &&
    a instanceof CSSTransition && a.playState === 'running';
}) && !document.querySelector('.app-scroller').hasAttribute('data-sidebar-resizing')"""


def intercepted(route):
    raw = route.request.url
    parsed = urllib.parse.urlparse(raw)
    if raw.startswith(BASE) and not parsed.path.startswith(('/api/v1', '/relay', '/search-api', '/_next/image')):
        route.continue_()
        return
    if parsed.path == '/api/v1/me/unread-counts':
        route.fulfill(content_type='application/json', body=json.dumps(
            dict(messages=12, notifications=3, interactions=1, forum=4)))
        return
    key = parsed._replace(query=urllib.parse.urlencode([
        (k, v) for k, v in urllib.parse.parse_qsl(parsed.query) if k != '_t'])).geturl()
    if key not in CACHE:
        with OPENER.open(FIXTURES + '/__review_fixture?url=' + urllib.parse.quote(key, safe='')) as response:
            CACHE[key] = json.load(response)
    data = CACHE[key]
    if data is None:
        route.abort()
    else:
        route.fulfill(status=data.get('status', 200), content_type=data['contentType'],
                      body=base64.b64decode(data['body']) if data.get('binary') else data['body'])


def context_for(browser, tier='standard', speed='default', mode='expanded', signed_in=True, width=1440):
    context = browser.new_context(viewport=dict(width=width, height=900),
                                  is_mobile=width < 768, has_touch=width < 768,
                                  reduced_motion='no-preference', service_workers='block')
    context.route('**/*', intercepted)
    stored = {'picpony_entrance_motion': 'off', 'picpony_motion': tier,
              'picpony_motion_speed': speed, 'sidebar_collapsed': mode,
              'picpony_dev_banner_dismissed': 'true', 'trixie_use_cdn': 'false'}
    if signed_in:
        stored['user_info'] = json.dumps(USER)
    context.add_init_script('for (const [k,v] of Object.entries(' + json.dumps(stored) +
                            ')) if (localStorage.getItem(k) === null) localStorage.setItem(k,v)')
    cookies = dict(entranceMotion='off', motion=tier, motionSpeed=speed, sidebarCollapsed=mode)
    context.add_cookies([dict(name=k, value=v, url=BASE) for k, v in cookies.items()])
    return context


def ready(context):
    page = context.new_page()
    page.goto(BASE, wait_until='networkidle')
    expect(page.locator(CONTROL)).to_be_visible()
    page.wait_for_function(SETTLED)
    return page


def assert_mode(page, mode):
    page.wait_for_function(SETTLED)
    pose = page.evaluate(POSE)
    assert pose['mode'] == mode, pose
    assert abs(pose['width'] - (288 if mode == 'expanded' else 80)) < 1, pose
    assert abs(pose['page'] - (dict(expanded=288, icons=80, hidden=0)[mode] + 12)) < 1, pose
    assert pose['inert'] == (mode == 'hidden'), pose
    assert pose['label'] == (1 if mode == 'expanded' else 0), pose
    assert pose['heldWidth'] == '', pose
    return pose


def cycle(page, target, animated=True):
    page.evaluate("""() => {
      window.sidebarFrames = [];
      window.sidebarCapture = true;
      const tick = () => {
        window.sidebarFrames.push((""" + POSE + """)());
        if (window.sidebarCapture) requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    }""")
    before = page.evaluate(POSE)
    page.locator(CONTROL).click()
    after = assert_mode(page, target)
    frames = page.evaluate('() => { window.sidebarCapture = false; return window.sidebarFrames; }')
    # The page stays beside the moving panel, with no overlap or gap beyond its normal gutter.
    assert all(abs(f['page'] - f['right'] - 12) < 1 for f in frames), frames
    direction = 1 if after['page'] > before['page'] else -1
    positions = [f['page'] for f in frames]
    assert all(direction * (b - a) >= -1 for a, b in zip(positions, positions[1:])), positions
    if animated:
        assert any(min(before['page'], after['page']) + 1 < p < max(before['page'], after['page']) - 1
                   for p in positions), positions
        # The shell follows the drawer, but its content must not reflow every frame.
        moving = [f for f in frames if min(before['page'], after['page']) + 1 < f['page'] <
                  max(before['page'], after['page']) - 1]
        wider = max(before['contentWidth'], after['contentWidth'])
        assert all(abs(f['contentWidth'] - wider) < 1 for f in moving), moving
        assert all(abs(f['layoutWidth'] - after['layoutWidth']) < 1 for f in moving), moving
        if before['card'] and after['card']:
            low, high = sorted([before['card']['width'], after['card']['width']])
            if high - low > 2:
                assert any(low + .5 < f['card']['width'] < high - .5 for f in moving), moving
                assert all(abs(
                    (f['card']['width'] - before['card']['width']) /
                    (after['card']['width'] - before['card']['width']) -
                    (f['page'] - before['page']) / (after['page'] - before['page'])
                ) < .05 for f in moving), moving
                # The image keeps its aspect ratio as its position and size interpolate.
                ratio = before['card']['width'] / before['card']['height']
                assert all(abs(f['card']['width'] / f['card']['height'] - ratio) < .01
                           for f in moving), moving
            low, high = sorted([before['card']['left'], after['card']['left']])
            if high - low > 2:
                assert any(low + .5 < f['card']['left'] < high - .5 for f in moving), moving
    else:
        assert not any(min(before['page'], after['page']) + 1 < p < max(before['page'], after['page']) - 1
                       for p in positions), positions


with sync_playwright() as p:
    browser = p.chromium.launch(**browser_options(), headless=True)
    OUTPUT.mkdir(parents=True, exist_ok=True)
    for tier, speed in [('standard', 'default'), ('standard', 'slow'), ('reduced', 'default'), ('off', 'default')]:
        context = context_for(browser, tier, speed)
        page = ready(context)
        errors = []
        page.on('pageerror', lambda error: errors.append(str(error)))
        assert_mode(page, 'expanded')
        cycle(page, 'icons', tier != 'off')
        home = page.locator('#app-sidebar a[href="/"]')
        expect(home).to_have_accessible_name('首页')
        page.keyboard.press('Shift')
        home.focus()
        expect(page.get_by_role('tooltip', name='首页', exact=True)).to_be_visible()
        page.locator(CONTROL).focus()
        badge = page.locator('#app-sidebar a[href="/messages"] .sidebar-trailing')
        expect(badge).to_be_visible()
        assert badge.bounding_box()['x'] + badge.bounding_box()['width'] <= 80
        assert badge.evaluate("""el => {
          const b = el.getBoundingClientRect();
          return [[b.left + 3, b.top + 3], [b.right - 3, b.top + 3],
                  [b.left + 3, b.bottom - 3], [b.right - 3, b.bottom - 3]]
            .every(([x, y]) => el.contains(document.elementFromPoint(x, y)));
        }"""), 'Unread badge is clipped by the row indicator'
        page.screenshot(path=str(OUTPUT / f'{tier}-{speed}-icons.png'))
        page.reload(wait_until='networkidle')
        assert_mode(page, 'icons')
        cycle(page, 'hidden', tier != 'off')
        cycle(page, 'expanded', tier != 'off')
        # New clicks retarget the active transition instead of waiting for its tail.
        page.evaluate("""async () => {
          const button = document.querySelector('""" + CONTROL + """');
          for (let i = 0; i < 5; i++) {
            button.click();
            await new Promise(resolve => setTimeout(resolve, 35));
          }
        }""")
        assert_mode(page, 'hidden')
        assert page.evaluate('localStorage.getItem("sidebar_collapsed")') == 'hidden'
        assert next(c['value'] for c in context.cookies() if c['name'] == 'sidebarCollapsed') == 'hidden'
        # Resizing to a phone preserves the desktop choice; the modal drawer stays two-state.
        page.set_viewport_size(dict(width=390, height=844))
        expect(page.locator('#app-sidebar')).to_have_attribute('aria-hidden', 'true')
        page.locator(CONTROL).click()
        expect(page.locator('#app-sidebar')).to_have_attribute('aria-modal', 'true')
        page.wait_for_function(SETTLED)
        assert page.evaluate(POSE)['label'] == 1
        page.keyboard.press('Escape')
        expect(page.locator('#app-sidebar')).to_have_attribute('aria-hidden', 'true')
        assert page.evaluate('localStorage.getItem("sidebar_collapsed")') == 'hidden'
        page.set_viewport_size(dict(width=1440, height=900))
        assert_mode(page, 'hidden')
        assert not errors, errors
        context.close()
        print(f'PASS: sidebar {tier}/{speed}: cycle, layout, tooltip, badge, reload, interruption, resize')

    # Releasing a width hold must not depend on a normal transitionend event.
    context = context_for(browser, signed_in=False)
    page = ready(context)
    page.locator(CONTROL).click()
    page.wait_for_function('document.querySelector(".app-scroller").style.minWidth !== ""')
    page.set_viewport_size(dict(width=1000, height=900))
    page.wait_for_function('document.querySelector(".app-scroller").style.minWidth === ""')
    page.wait_for_function(SETTLED)
    assert abs(page.evaluate(POSE)['contentWidth'] - 896) < 1
    page.set_viewport_size(dict(width=1440, height=900))
    cycle(page, 'hidden')
    cycle(page, 'expanded')
    page.locator(CONTROL).click()
    page.wait_for_function('document.querySelector(".app-scroller").style.minWidth !== ""')
    page.evaluate('document.documentElement.dataset.motion = "off"')
    assert_mode(page, 'icons')
    context.close()

    for saved, expected in [('true', 'hidden'), ('false', 'expanded'), ('invalid', 'expanded')]:
        context = context_for(browser, mode=saved, signed_in=False)
        page = ready(context)
        assert_mode(page, expected)
        context.close()

    context = context_for(browser, mode='icons', signed_in=False, width=390)
    page = ready(context)
    for _ in range(2):
        page.locator(CONTROL).click()
        expect(page.locator('#app-sidebar')).to_have_attribute('aria-modal', 'true')
        page.wait_for_function(SETTLED)
        assert page.evaluate(POSE)['label'] == 1
        page.locator('.z-drawer-scrim').click(position=dict(x=350, y=400))
        expect(page.locator('#app-sidebar')).to_have_attribute('aria-hidden', 'true')
    assert page.evaluate('localStorage.getItem("sidebar_collapsed")') == 'icons'
    context.close()

    # Hold the destination's RSC payload so the real Link pending state stays observable.
    context = context_for(browser, signed_in=False)
    held = []
    releasing = {'value': False}

    def hold_settings(route):
        if releasing['value']:
            route.continue_()
        else:
            held.append(route)

    context.route('**/settings?*', hold_settings)
    page = context.new_page()
    page.goto(BASE, wait_until='domcontentloaded')
    settings = page.locator('#app-sidebar a[href="/settings"]')
    expect(settings).to_be_visible()
    settings.click()
    expect(settings.locator('.sidebar-trailing').get_by_text('正在打开')).to_be_visible()
    page.locator(CONTROL).click()
    assert_mode(page, 'icons')
    progress = settings.locator('.sidebar-row-layout > span:first-child .m3-progress-spin')
    expect(progress).to_be_visible()
    expect(settings.get_by_text('正在打开')).to_have_count(0)
    expect(settings.locator('.sidebar-trailing .m3-progress-spin')).to_have_count(0)
    # The rotating SVG's painted bounds vary; its fixed cell and intrinsic size do not.
    cell = settings.locator('.sidebar-row-layout > span:first-child').bounding_box()
    assert cell['width'] == cell['height'] == 24, cell
    assert progress.evaluate('el => [el.width.baseVal.value, el.height.baseVal.value]') == [24, 24]
    page.screenshot(path=str(OUTPUT / 'icons-pending.png'))
    releasing['value'] = True
    for route in held:
        try:
            route.continue_()
        except Exception:
            pass  # The clicked navigation may have superseded a prefetch.
    page.wait_for_url(BASE + '/settings')
    expect(progress).to_have_count(0)
    expect(settings.locator('.sidebar-row-layout > span:first-child svg')).to_be_visible()
    context.close()

    # Overlay motion remains independent of feedback, including a speed change mid-run.
    for effects, animated in [('feedback:off,overlay:standard', True), ('feedback:standard,overlay:off', False)]:
        context = context_for(browser, tier='custom')
        context.add_cookies([dict(name='motionEffects', value=effects, url=BASE)])
        context.add_init_script('localStorage.setItem("picpony_motion_effects",' + json.dumps(effects) + ')')
        page = ready(context)
        cycle(page, 'icons', animated)
        cycle(page, 'hidden', animated)
        cycle(page, 'expanded', animated)
        if animated:
            page.evaluate("""async () => {
              document.querySelector('""" + CONTROL + """').click();
              await new Promise(resolve => setTimeout(resolve, 40));
              document.documentElement.dataset.motionSpeed = 'slow';
            }""")
            assert_mode(page, 'icons')
        context.close()
    browser.close()
    print('PASS: legacy preferences, phone cycle, icon loading and custom motion isolation')

    if '--performance' in sys.argv:
        browser = p.chromium.launch(**browser_options(), headless=True)
        context = context_for(browser, signed_in=False)
        page = ready(context)
        page.wait_for_timeout(1200)
        cdp = context.new_cdp_session(page)
        cdp.send('Performance.enable')
        cdp.send('Emulation.setCPUThrottlingRate', {'rate': 4})
        keys = ['LayoutDuration', 'RecalcStyleDuration', 'ScriptDuration', 'TaskDuration']

        def metrics():
            return {m['name']: m['value'] for m in cdp.send('Performance.getMetrics')['metrics']}

        samples = []
        for _ in range(9):
            before = metrics()
            gaps = page.evaluate("""() => new Promise(resolve => {
              let last = performance.now(), start = last, gaps = [];
              document.querySelector('""" + CONTROL + """').click();
              function tick(now) {
                gaps.push(now - last); last = now;
                if (now - start < 850) requestAnimationFrame(tick); else resolve(gaps);
              }
              requestAnimationFrame(tick);
            })""")
            page.wait_for_function(SETTLED)
            after = metrics()
            samples.append({**{k: round((after[k] - before[k]) * 1000, 2) for k in keys},
                            'p95FrameMs': round(sorted(gaps)[int(len(gaps) * .95)], 2),
                            'maxFrameMs': round(max(gaps), 2)})
        print(json.dumps({'build': 'production', 'viewport': '1440x900', 'DPR': 1, 'CPU': 4,
                          'scenario': 'expanded -> icons -> hidden -> expanded', 'samples': samples,
                          'median': {k: statistics.median(s[k] for s in samples) for k in samples[0]}}))
        context.close()
        browser.close()
