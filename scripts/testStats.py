"""Offline /stats consistency regressions. Caller prepares the production build.
Run: node scripts/reviewBrowser.mjs --stats
Follow-up: add --stats-followup-only; old-build geometry repro: add --stats-geometry-only.
Or PowerShell: $env:HERO_SCRIPT='scripts/testStats.py'; node scripts/reviewBrowser.mjs
The runner passes BASE/FIXTURES and has no --help mode. Never forwards API/media
to real services. Only the off-tier profile saves the two requested screenshots.
"""
import base64
import datetime as dt
import json
import pathlib
import re
import sys
import time
import traceback
import urllib.parse as url
import urllib.request
from playwright.sync_api import sync_playwright, expect
from browserLaunch import browser_options

ROOT = pathlib.Path(__file__).resolve().parent.parent
AXE = (ROOT / 'node_modules/axe-core/axe.min.js').read_text(encoding='utf-8')
OUTPUT = ROOT / '.workbuddy/stats-regression'
OPENER = urllib.request.build_opener(urllib.request.ProxyHandler({}))
CACHE = {}
TABS = ('用户', '中文词条', '访客与浏览量', '社区内容')
TOTALS = dict(users=54321, chinese_tags=6543, posts=1234, comments=2345, favorites=3456, badges=456)


def origin(raw):
    parsed = url.urlparse(raw)
    return parsed.scheme, parsed.netloc


def day_text(day):
    date = dt.date.fromisoformat(day)
    return f'{date.year}年{date.month}月{date.day}日'


def bucket(day):
    date = dt.date.fromisoformat(day)
    return f'{date.month}/{date.day}'


def requested(raw):
    query = url.parse_qs(url.urlparse(raw).query)
    assert len(query.get('start', [])) == len(query.get('end', [])) == 1, raw
    window = query['start'][0], query['end'][0]
    assert dt.date.fromisoformat(window[0]) <= dt.date.fromisoformat(window[1]), raw
    return window


def site_stats(window, revision=0, empty=False):
    """Complete SiteStats/StatsPoint DTO, echoing the real SSR-owned Beijing dates."""
    start, end = window
    first, last = dt.date.fromisoformat(start), dt.date.fromisoformat(end)
    totals = {key: 0 if empty else value + revision * 1000 for key, value in TOTALS.items()}
    points = []
    if not empty:
        for index in range((last - first).days + 1):
            points.append(dict(
                date=(first + dt.timedelta(days=index)).isoformat(),
                new_users=11 + index % 7 + revision, total_users=51001 + index * 13 + revision * 1000,
                new_chinese_tags=21 + index % 5 + revision,
                total_chinese_tags=6001 + index * 23 + revision * 1000,
                visitors=101 + index * 3 + revision, hits=401 + index * 7 + revision,
                new_posts=2 + index % 3 + revision, total_posts=1001 + index * 2 + revision * 1000,
                new_comments=3 + index % 4 + revision, total_comments=2001 + index * 3 + revision * 1000,
                new_favorites=4 + index % 5 + revision, total_favorites=3001 + index * 4 + revision * 1000,
                new_badges=1 + index % 2 + revision, total_badges=301 + index + revision * 1000))
    return dict(timezone='Asia/Shanghai', granularity='day', start=start, end=end,
                earliest=(first - dt.timedelta(days=90)).isoformat(), totals=totals,
                window=dict(visitors=sum(p['visitors'] for p in points), hits=sum(p['hits'] for p in points)),
                series=points)


class Fixture:
    def __init__(self, base, fixtures):
        self.base, self.fixtures = base, fixtures
        self.mode, self.revision, self.data = 'ok', 0, None
        self.requests, self.pending, self.errors = [], [], []

    def respond(self, route, window, message=None):
        if message is not None:
            # Retryable 409 preserves the backend sentence; 5xx/429 replaces it.
            route.fulfill(status=409, content_type='application/json', body=json.dumps(
                {'error': {'code': 'STATS_FIXTURE_REFUSED', 'message': message}}))
        else:
            self.data = site_stats(window, self.revision, self.mode == 'empty')
            route.fulfill(status=200, content_type='application/json', body=json.dumps(self.data))

    def release(self, message=None):
        assert self.pending, 'No held stats read'
        route, window = self.pending.pop(0)
        self.respond(route, window, message)

    def intercepted(self, route):
        request, parsed = route.request, url.urlparse(route.request.url)
        if parsed.path == '/api/v1/stats':
            assert origin(request.url) == origin(self.base), 'Stats must use the same-origin proxy'
            assert request.method == 'GET' and 'authorization' not in request.headers
            window = requested(request.url)
            self.requests.append(dict(method=request.method, start=window[0], end=window[1]))
            if self.mode == 'pending':
                self.pending.append((route, window))
            else:
                self.respond(route, window)
            return
        if origin(request.url) == origin(self.base) and not parsed.path.startswith(
                ('/api/v1', '/relay', '/search-api', '/_next/image')):
            route.continue_()  # Local documents/RSC/assets only, never business reads.
            return
        pairs = [(k, v) for k, v in url.parse_qsl(parsed.query) if k != '_t']
        normalized = parsed._replace(query=url.urlencode(pairs)).geturl()
        key = normalized, request.method
        if key not in CACHE:
            target = self.fixtures + '/__review_fixture?' + url.urlencode(dict(url=normalized, method=request.method))
            try:
                with OPENER.open(target, timeout=10) as response:
                    CACHE[key] = json.load(response)
            except Exception as error:
                self.errors.append(str(error))
                route.abort()
                return
        answer = CACHE[key]
        if answer is None:
            route.abort()  # Unknown fixtures may not escape to a live API or media host.
        else:
            route.fulfill(status=answer.get('status', 200), content_type=answer['contentType'],
                          body=base64.b64decode(answer['body']) if answer.get('binary') else answer['body'])


def new_context(browser, fixture, tier, width):
    context = browser.new_context(viewport=dict(width=width, height=900), color_scheme='dark',
                                  reduced_motion='no-preference', is_mobile=width < 500,
                                  has_touch=width < 500, timezone_id='Asia/Shanghai', service_workers='block')
    context.route('**/*', fixture.intercepted)
    stored = dict(picpony_dev_banner_dismissed='true', trixie_use_cdn='false', picpony_use_proxy='false',
                  picpony_hk_relay='false', picpony_motion=tier, picpony_motion_speed='default',
                  picpony_entrance_motion='off', darkMode='true', followSystemPrefersColorScheme='false')
    context.add_init_script('for(const [k,v] of Object.entries(' + json.dumps(stored) + '))localStorage.setItem(k,v)')
    cookies = dict(motion=tier, motionSpeed='default', entranceMotion='off', darkMode='true')
    context.add_cookies([dict(name=k, value=v, url=fixture.base + '/') for k, v in cookies.items()])
    return context


def main(page):
    return page.get_by_role('main')


def pane(page, name='用户'):
    return main(page).get_by_role('tabpanel', name=name, exact=True)


def slider(page, name):
    return main(page).get_by_role('slider', name=name, exact=True)


def pane_state(page, expected):
    # CSS selection deliberately includes concealed panes that role locators/axe skip.
    state = main(page).locator('[data-tab-panel] > [data-tab-pane]').evaluate_all("""nodes=>nodes.map(e=>{
      const c=getComputedStyle(e),active=e.hasAttribute('data-tab-pane-active');
      return {name:e.getAttribute('data-tab-pane'),
        active,inert:e.inert,ariaHidden:e.getAttribute('aria-hidden'),visibility:c.visibility,
        contentVisibility:c.contentVisibility,display:c.display,
        escapedChildren:[...e.querySelectorAll('figure,[data-slider],button')]
          .filter(child=>getComputedStyle(child).visibility==='visible').length,
        flags:[...e.attributes].map(a=>a.name).filter(n=>/^data-tab-pane-(leaving|entering|done|prerender)$/.test(n))};
    })""")
    assert len(state) == len(TABS), json.dumps(state, ensure_ascii=False)
    keys = ('stats-users', 'stats-tags', 'stats-visits', 'stats-community')
    assert [item['name'] for item in state] == list(keys), state
    expected_key = dict(zip(TABS, keys))[expected]
    assert [item['name'] for item in state if item['active']] == [expected_key], state
    for item in state:
        assert not item['flags'], 'Settled tab flags must not remain: ' + json.dumps(state, ensure_ascii=False)
        if item['active']:
            assert item['visibility'] == 'visible' and item['contentVisibility'] != 'hidden' and not item['inert'], state
            assert item['ariaHidden'] != 'true' and item['display'] != 'none', state
        else:
            assert item['inert'] and item['ariaHidden'] == 'true', state
            assert item['visibility'] == 'hidden' and item['contentVisibility'] == 'visible', state
            assert item['display'] != 'none' and item['escapedChildren'] == 0, state
    return state


def settle(page):
    page.wait_for_function("""() => !document.querySelector(
      'main [data-tab-pane-leaving],main [data-tab-pane-entering],main [data-tab-pane-done],main [data-tab-pane-prerender],[data-axis-running]')""", timeout=6000)


def tab(page, name):
    control = main(page).get_by_role('tab', name=name, exact=True)
    control.click()
    expect(control).to_have_attribute('aria-selected', 'true')
    expect(pane(page, name)).to_be_visible()
    settle(page)
    if '--stats-geometry-only' not in sys.argv:
        pane_state(page, name)
    return pane(page, name)


def choice(page, name, name_of_tab='用户'):
    return pane(page, name_of_tab).get_by_role('group', name='图表视图', exact=True).get_by_role('button', name=name, exact=True)


def selected(page, name, name_of_tab='用户'):
    expect(choice(page, name, name_of_tab)).to_have_attribute('aria-pressed', 'true')
    expect(choice(page, '累计' if name == '每日' else '每日', name_of_tab)).to_have_attribute('aria-pressed', 'false')


def wait_reads(page, fixture, count, quiet=False):
    deadline = time.monotonic() + 8
    while len(fixture.requests) < count and time.monotonic() < deadline:
        page.wait_for_timeout(20)
    if quiet:
        page.wait_for_timeout(250)  # Negative assertions need event processing plus a quiet window.
    assert len(fixture.requests) == count, f'Expected exactly {count} stats reads: {fixture.requests}'


def last_window(fixture):
    return fixture.requests[-1]['start'], fixture.requests[-1]['end']


def chosen_window(page):
    days = []
    for name in ('开始日期', '结束日期'):
        value = slider(page, name).get_attribute('aria-valuetext') or ''
        match = re.search(r'(\d{4})年(\d{1,2})月(\d{1,2})日', value)
        if match:
            days.append(dt.date(*map(int, match.groups())).isoformat())
        else:
            match = re.search(r'\d{4}-\d{2}-\d{2}', value)
            assert match, f'A date slider must expose its date, not only an ordinal: {value}'
            days.append(dt.date.fromisoformat(match.group()).isoformat())
    return tuple(days)


def chart_window(page, window):
    owner = main(page).locator('[data-stats-start][data-stats-end]')
    expect(owner).to_have_attribute('data-stats-start', window[0])
    expect(owner).to_have_attribute('data-stats-end', window[1])


def headline(page, data, name='用户'):
    if name == '用户':
        value = data['totals']['users']
    elif name == '中文词条':
        value = data['totals']['chinese_tags']
    elif name == '访客与浏览量':
        value = data['window']['visitors']
    else:
        value = sum(data['totals'][k] for k in ('posts', 'comments', 'favorites', 'badges'))
    expect(pane(page, name).get_by_text(f'{value:,}', exact=True).first).to_be_visible()


def paths(page):
    return pane(page).locator('figure svg[preserveAspectRatio="none"] path[stroke]').evaluate_all(
        "nodes=>nodes.filter(e=>e.getClientRects().length).map(e=>e.getAttribute('d'))")


def retained(page, data, window, plotted):
    headline(page, data)
    chart_window(page, window)
    assert paths(page) == plotted, 'Pending/failed refresh must retain the plotted old answer'
    selected(page, '每日')


def no_range_hints(page):
    expect(main(page).get_by_text('拖动两端选择日期，松开后更新图表', exact=True)).to_have_count(0)
    expect(main(page).get_by_text(re.compile(r'^图表范围：'))).to_have_count(0)


def ready(page, fixture, verify_window=True):
    response = page.goto(fixture.base + '/stats', wait_until='networkidle')
    assert response and response.status == 200
    expect(main(page).get_by_role('heading', name='站点统计', level=1, exact=True)).to_be_visible()
    expect(main(page).get_by_role('tab', name='用户', exact=True)).to_have_attribute('aria-selected', 'true')
    wait_reads(page, fixture, 1)
    assert fixture.data is not None, 'Unexpected SSR seed bypassed the browser stats mock'
    headline(page, fixture.data)
    if verify_window:
        chart_window(page, last_window(fixture))
        no_range_hints(page)
        pane_state(page, '用户')
    for name in ('开始日期', '结束日期'):
        expect(slider(page, name)).to_be_visible()
    settle(page)


def categories(page, fixture, width):
    fixture.mode = 'pending'
    page.goto(fixture.base + '/stats', wait_until='domcontentloaded')
    wait_reads(page, fixture, 1)
    expect(main(page).get_by_label('正在加载站点统计', exact=True)).to_be_visible()
    fixture.mode = 'ok'
    fixture.release()
    headline(page, fixture.data)
    selected(page, '累计')
    for name in TABS:
        tab(page, name)
        headline(page, fixture.data, name)
        wait_reads(page, fixture, 1, quiet=True)
    tab(page, '用户')
    choice(page, '每日').click()
    for name in ('中文词条', '社区内容'):
        tab(page, name)
        selected(page, '每日', name)
    tab(page, '访客与浏览量')
    tab(page, '用户')
    selected(page, '每日')
    choice(page, '累计').click()
    for name in ('中文词条', '社区内容', '用户'):
        tab(page, name)
        selected(page, '累计', name)
    wait_reads(page, fixture, 1, quiet=True)
    return dict(categories=TABS, preservedViews=['每日', '累计'], reads=1)


def range_commits(page, fixture, width):
    ready(page, fixture)
    choice(page, '每日').click()
    commits = []
    for name, key, direction in [('开始日期', 'ArrowRight', 1), ('结束日期', 'ArrowLeft', -1)]:
        data, window, plotted = fixture.data, last_window(fixture), paths(page)
        control = slider(page, name)
        before, step = float(control.input_value()), float(control.get_attribute('step') or 1)
        count = len(fixture.requests)
        fixture.mode = 'pending'
        control.focus()
        control.press(key)
        expect(control).to_have_value(str(int(before + direction * step)))
        wait_reads(page, fixture, count + 1)
        assert last_window(fixture) == chosen_window(page)
        retained(page, data, window, plotted)
        expect(pane(page).locator('[aria-busy="true"]').first).to_be_visible()
        control.press('Tab')  # Keyup then blur must not send the committed value twice.
        wait_reads(page, fixture, count + 1, quiet=True)
        fixture.revision += 1
        fixture.mode = 'ok'
        fixture.release()
        headline(page, fixture.data)
        chart_window(page, last_window(fixture))
        expect(pane(page).locator('[aria-busy="true"]')).to_have_count(0)
        selected(page, '每日')
        commits.append(dict(control=name, key=key, window=last_window(fixture)))
    control = slider(page, '开始日期')
    control.scroll_into_view_if_needed()
    geometry = control.evaluate("""e=>{
      const rail=e.closest('[data-slider]')?.querySelector('[data-slider-rail]');
      const r=rail?.getBoundingClientRect(),b=e.getBoundingClientRect();
      return {left:r?r.left:b.left+22,right:r?r.right:b.right-22,y:b.top+b.height/2,
        fraction:(+e.value-+e.min)/(+e.max-+e.min)};
    }""")
    assert geometry['right'] > geometry['left'] and geometry['fraction'] > .2, geometry
    data, window, plotted = fixture.data, last_window(fixture), paths(page)
    count, distance = len(fixture.requests), geometry['right'] - geometry['left']
    fixture.mode = 'pending'
    page.mouse.move(geometry['left'] + distance * geometry['fraction'], geometry['y'])
    page.mouse.down()
    try:
        for index in range(1, 13):
            page.mouse.move(geometry['left'] + distance * (geometry['fraction'] - .18 * index / 12), geometry['y'], steps=2)
            page.wait_for_timeout(25)
            assert len(fixture.requests) == count, f'Drag frame {index} fetched: {fixture.requests}'
        assert chosen_window(page) != window, 'The held pointer gesture must really change a date'
        chart_window(page, window)
    finally:
        page.mouse.up()
    wait_reads(page, fixture, count + 1)
    assert last_window(fixture) == chosen_window(page)
    retained(page, data, window, plotted)
    wait_reads(page, fixture, count + 1, quiet=True)
    fixture.revision += 1
    fixture.mode = 'ok'
    fixture.release()
    headline(page, fixture.data)
    chart_window(page, last_window(fixture))
    selected(page, '每日')
    return dict(keyboard=commits, heldMoves=12, readsWhileHeld=0, readsOnRelease=1)


def range_pointer_edges(page, fixture, width):
    ready(page, fixture)
    slider(page, '开始日期').scroll_into_view_if_needed()
    if width < 500:
        # Leave room for a physical left-to-right crossing on a short phone rail.
        slider(page, '结束日期').press('ArrowLeft')
        wait_reads(page, fixture, 2)
        chart_window(page, last_window(fixture))
    cdp = page.context.new_cdp_session(page) if width < 500 else None
    held = False

    def point(day):
        return slider(page, '开始日期').evaluate("""(e,value)=>{
          const r=e.closest('[data-range-slider]').querySelector('[data-slider-rail]').getBoundingClientRect();
          return {x:r.left+(value-+e.min)/(+e.max-+e.min)*r.width,y:r.top+r.height/2};
        }""", (dt.date.fromisoformat(day) - dt.date(1970, 1, 1)).days)

    def send(kind, day=None):
        nonlocal held
        at = point(day) if day is not None else None
        if cdp:
            names = dict(down='touchStart', move='touchMove', up='touchEnd', cancel='touchCancel')
            cdp.send('Input.dispatchTouchEvent', dict(type=names[kind], touchPoints=(
                [dict(x=at['x'], y=at['y'], id=1)] if at else [])))
        elif kind == 'down':
            page.mouse.move(at['x'], at['y'])
            page.mouse.down()
        elif kind == 'move':
            page.mouse.move(at['x'], at['y'], steps=2)
        elif kind == 'up':
            page.mouse.up()
        else:
            page.evaluate("""()=>{
              const p=window.__statsRangePointer;
              p.target.dispatchEvent(new PointerEvent('pointercancel',{bubbles:true,pointerId:p.id,
                pointerType:'mouse',isPrimary:true}));
            }""")
        if kind == 'down':
            held = True
        elif kind == 'up' or (kind == 'cancel' and cdp):
            held = False
        page.wait_for_timeout(25)

    page.wait_for_function("""()=>![...document.querySelectorAll('[data-tab-pane-active] g[data-stat-series]')]
      .some(e=>e.getAnimations().some(a=>a.playState==='running'||a.pending))""", timeout=6000)
    page.evaluate("""()=>{
      const root=document.querySelector('main [data-range-slider]');
      window.__statsRangePointer=null;window.__statsRangeEvents=[];
      for(const type of ['pointerdown','pointercancel','lostpointercapture'])root.addEventListener(type,e=>{
        window.__statsRangeEvents.push({type,pointerType:e.pointerType,trusted:e.isTrusted});
        if(type==='pointerdown')window.__statsRangePointer={id:e.pointerId,target:e.target};
      },true);
    }""")
    evidence = []
    try:
        # End crosses start and crosses back without drifting the stationary physical endpoint.
        window, count = chosen_window(page), len(fixture.requests)
        assert int(slider(page, '开始日期').input_value()) - int(slider(page, '开始日期').get_attribute('min')) >= 3, (
            'The fixture must leave a left margin for crossing')
        early = (dt.date.fromisoformat(window[0]) - dt.timedelta(days=3)).isoformat()
        later = (dt.date.fromisoformat(window[0]) + dt.timedelta(days=2)).isoformat()
        fixture.mode = 'pending'
        send('down', window[1])
        assert page.evaluate('()=>window.__statsRangePointer.target.hasPointerCapture(window.__statsRangePointer.id)')
        send('move', early)
        assert chosen_window(page) == (early, window[0]), chosen_window(page)
        assert slider(page, '开始日期').evaluate('e=>document.activeElement===e'), 'Crossing must transfer focus'
        wait_reads(page, fixture, count, quiet=True)
        send('move', later)
        assert chosen_window(page) == (window[0], later), chosen_window(page)
        assert slider(page, '结束日期').evaluate('e=>document.activeElement===e')
        wait_reads(page, fixture, count, quiet=True)
        send('up')
        wait_reads(page, fixture, count + 1)
        assert last_window(fixture) == chosen_window(page)
        slider(page, '结束日期').evaluate('e=>e.blur()')
        wait_reads(page, fixture, count + 1, quiet=True)
        fixture.mode = 'ok'
        fixture.release()
        chart_window(page, last_window(fixture))
        evidence.append(dict(gesture='cross both ways', window=chosen_window(page), commits=1))
        # The start can also cross right; max-bound clamping is exercised on the physical rail.
        window, count = chosen_window(page), len(fixture.requests)
        maximum = slider(page, '开始日期').get_attribute('max')
        max_day = (dt.date(1970, 1, 1) + dt.timedelta(days=int(maximum))).isoformat()
        fixture.mode = 'pending'
        send('down', window[0])
        send('move', max_day)
        assert chosen_window(page) == (window[1], max_day), chosen_window(page)
        assert slider(page, '结束日期').evaluate('e=>document.activeElement===e')
        wait_reads(page, fixture, count, quiet=True)
        send('up')
        wait_reads(page, fixture, count + 1)
        fixture.mode = 'ok'
        fixture.release()
        chart_window(page, last_window(fixture))
        evidence.append(dict(gesture='start crosses right', window=chosen_window(page), commits=1))
        for reason in ('pointercancel', 'lostcapture', 'input blur', 'window blur'):
            window, count = chosen_window(page), len(fixture.requests)
            draft = (dt.date.fromisoformat(window[0]) - dt.timedelta(days=3)).isoformat()
            plotted = paths(page)
            send('down', window[0])
            send('move', draft)
            assert chosen_window(page) != window, 'Cancellation must test a changed, unfinished draft'
            wait_reads(page, fixture, count, quiet=True)
            if reason == 'pointercancel':
                send('cancel')
            elif reason == 'lostcapture':
                page.evaluate('()=>{const p=window.__statsRangePointer;p.target.releasePointerCapture(p.id)}')
                send('move', draft)  # Native lostcapture is delivered before the next pointer event.
            elif reason == 'input blur':
                slider(page, '开始日期').evaluate('e=>e.blur()')
            else:
                page.evaluate("()=>window.dispatchEvent(new Event('blur'))")
            if held:
                send('up')
            wait_reads(page, fixture, count, quiet=True)
            assert chosen_window(page) == window, f'{reason} must roll back the draft, not commit it'
            assert paths(page) == plotted
            assert not page.evaluate('()=>window.__statsRangePointer.target.hasPointerCapture(window.__statsRangePointer.id)')
            # A fresh gesture at the same value after cancellation must remain usable and silent.
            send('down', window[0])
            send('up')
            wait_reads(page, fixture, count, quiet=True)
            evidence.append(dict(gesture=reason, rollback=True, commits=0, sameValueCommits=0))
        events = page.evaluate('()=>window.__statsRangeEvents')
        assert any(e['type'] == 'pointercancel' for e in events), events
        assert any(e['type'] == 'lostpointercapture' and e['trusted'] for e in events), events
        assert any(e['type'] == 'pointerdown' and e['trusted'] and e['pointerType'] == ('touch' if cdp else 'mouse')
                   for e in events), events
        return dict(pointer='CDP touch' if cdp else 'mouse', gestures=evidence, events=events,
                    windowBlur='DOM event injection; OS focus loss not simulated',
                    pointerCancel='native CDP touchCancel' if cdp else 'DOM event after real mouse drag')
    finally:
        if held:
            send('up')
        if cdp:
            cdp.detach()


def refresh_failure(page, fixture, width):
    ready(page, fixture)
    choice(page, '每日').click()
    data, window, plotted = fixture.data, last_window(fixture), paths(page)
    fixture.mode = 'pending'
    slider(page, '开始日期').press('ArrowRight')
    wait_reads(page, fixture, 2)
    failed = last_window(fixture)
    assert failed == chosen_window(page) and failed != window
    retained(page, data, window, plotted)
    fixture.release(message='统计刷新测试失败')
    expect(main(page).get_by_text('统计刷新测试失败', exact=True)).to_be_visible()
    retry = main(page).get_by_role('button', name='重试', exact=True)
    expect(retry).to_be_visible()
    expect(retry).to_be_enabled()
    retained(page, data, window, plotted)
    assert chosen_window(page) == failed
    retry.click()
    wait_reads(page, fixture, 3)
    assert last_window(fixture) == failed, 'Retry must use the failed selected window'
    retained(page, data, window, plotted)
    fixture.revision, fixture.mode = 1, 'ok'
    fixture.release()
    headline(page, fixture.data)
    chart_window(page, failed)
    expect(main(page).get_by_text('统计刷新测试失败', exact=True)).to_have_count(0)
    expect(main(page).get_by_role('button', name='重试', exact=True)).to_have_count(0)
    selected(page, '每日')
    wait_reads(page, fixture, 3, quiet=True)
    return dict(retainedWindow=window, retriedWindow=failed, reads=3)


def initial_failure(page, fixture, width):
    fixture.mode = 'pending'
    page.goto(fixture.base + '/stats', wait_until='domcontentloaded')
    wait_reads(page, fixture, 1)
    expect(main(page).get_by_label('正在加载站点统计', exact=True)).to_be_visible()
    fixture.release(message='统计初次加载测试失败')
    expect(main(page).get_by_text('站点统计加载失败', exact=True)).to_be_visible()
    expect(main(page).get_by_text('统计初次加载测试失败', exact=True)).to_be_visible()
    window = last_window(fixture)
    main(page).get_by_role('button', name='重试', exact=True).click()
    wait_reads(page, fixture, 2)
    assert last_window(fixture) == window
    fixture.mode = 'ok'
    fixture.release()
    headline(page, fixture.data)
    expect(main(page).get_by_text('统计初次加载测试失败', exact=True)).to_have_count(0)
    wait_reads(page, fixture, 2, quiet=True)
    return dict(initialWindow=window, retryWindow=last_window(fixture), reads=2)


def empty_charts(page, fixture, width):
    fixture.mode = 'empty'
    ready(page, fixture)
    for name in TABS:
        panel = tab(page, name)
        empty = panel.get_by_text('此时间范围暂无数据', exact=True)
        expect(empty).to_be_visible()
        # Observable EmptyState/StatusView layout, not the former naked <p>.
        assert empty.evaluate("""text=>{
          for(let e=text.parentElement;e&&e.getAttribute('role')!=='tabpanel';e=e.parentElement)
            if(['flex','flex-col','items-center','justify-center','text-center'].every(n=>e.classList.contains(n)))return true;
          return false;
        }"""), 'An empty plot must use shared EmptyState/StatusView'
        expect(panel.get_by_text('请选择其他日期范围', exact=True)).to_be_visible()
        expect(panel.locator('figure svg[preserveAspectRatio="none"] path[stroke]')).to_have_count(0)
    for name in ('开始日期', '结束日期'):
        expect(slider(page, name)).to_be_visible()
    wait_reads(page, fixture, 1, quiet=True)
    return dict(emptyTabs=TABS, sharedEmptyState=True, reads=1)


def initial_plot_geometry(page, fixture, width):
    fixture.mode = 'pending'
    page.goto(fixture.base + '/stats', wait_until='domcontentloaded')
    wait_reads(page, fixture, 1)
    loading = main(page).get_by_label('正在加载站点统计', exact=True)
    expect(loading).to_be_visible()
    page.evaluate('()=>document.fonts.ready.then(()=>true)')
    placeholder = loading.locator('.skeleton.h-60')
    expect(placeholder).to_have_count(1)
    before = placeholder.bounding_box()
    assert before and abs(before['height'] - 240) <= 1 and before['width'] > 100, before
    fixture.mode = 'ok'
    fixture.release()
    headline(page, fixture.data)
    svg = pane(page).locator('figure svg[preserveAspectRatio="none"]')
    page.wait_for_function("""()=>{
      const svg=document.querySelector('[data-tab-pane-active] figure svg[preserveAspectRatio="none"]');
      return svg&&Math.abs(svg.getBoundingClientRect().width-svg.viewBox.baseVal.width)<1;
    }""", timeout=6000)
    after = svg.bounding_box()
    expect(loading).to_have_count(0)
    assert after and all(abs(before[key] - after[key]) <= 1 for key in ('x', 'width', 'height')), (
        'Initial chart skeleton must occupy the destination chart width and 240px well: ' + json.dumps(dict(before=before, after=after)))
    chart_window(page, last_window(fixture))
    no_range_hints(page)
    pane_state(page, '用户')
    wait_reads(page, fixture, 1, quiet=True)
    return dict(placeholder=before, svg=after, topShift=round(after['y'] - before['y'], 3), reads=1)


def plot_snapshot(page):
    return pane(page).locator('figure svg[preserveAspectRatio="none"]').evaluate("""svg=>({
      paths:[...svg.querySelectorAll('path')].map(e=>({d:e.getAttribute('d'),fill:e.getAttribute('fill'),stroke:e.getAttribute('stroke')})),
      axes:[...svg.querySelectorAll('text')].map(e=>({text:e.textContent,x:e.getAttribute('x'),y:e.getAttribute('y')}))
    })""")


def plot_skeleton(page, fixture, width):
    # Deliberately skip new owner attrs/copy assertions: this is also the old-build repro.
    ready(page, fixture, verify_window=False)
    before = plot_snapshot(page)
    assert before['paths'] and before['axes'], 'The retained chart must already have real curves and axes'
    fixture.mode = 'pending'
    slider(page, '开始日期').press('ArrowRight')
    wait_reads(page, fixture, 2)
    expect(pane(page).locator('figure .skeleton').first).to_be_visible()
    expect(pane(page).locator('[aria-busy="true"]').first).to_be_visible()
    geometry = pane(page).evaluate("""panel=>{
      const svg=panel.querySelector('figure svg[preserveAspectRatio="none"]');
      const s=svg.getBoundingClientRect();
      const overlays=[...panel.querySelectorAll('figure .skeleton')].filter(e=>{
        const r=e.getBoundingClientRect();return r.width>0&&r.height>0&&getComputedStyle(e).visibility!=='hidden';
      });
      return {svg:{width:s.width,height:s.height,viewBoxWidth:svg.viewBox.baseVal.width},
        expected:{left:48,top:12,width:s.width-60,height:200},
        overlays:overlays.map(e=>{const r=e.getBoundingClientRect();
          return {left:r.left-s.left,top:r.top-s.top,width:r.width,height:r.height,
            background:getComputedStyle(e).backgroundColor};})};
    }""")
    retained_plot = plot_snapshot(page) == before
    fixture.mode = 'ok'
    fixture.release()
    assert len(geometry['overlays']) == 1, json.dumps(geometry)
    actual, expected = geometry['overlays'][0], geometry['expected']
    assert abs(geometry['svg']['height'] - 240) <= 1, json.dumps(geometry)
    assert abs(geometry['svg']['width'] - geometry['svg']['viewBoxWidth']) <= 1, json.dumps(geometry)
    assert all(abs(actual[key] - expected[key]) <= 1 for key in expected), (
        'Loading must cover the plot rectangle, not a 4px line or the axes: ' + json.dumps(geometry))
    assert retained_plot, 'Pending refresh must retain the old fill, curves and axis labels'
    assert actual['background'] == 'rgba(0, 0, 0, 0)', (
        'A retained-chart skeleton must not paint an opaque surface over the old curves: ' + json.dumps(geometry))
    headline(page, fixture.data)
    expect(pane(page).locator('figure .skeleton')).to_have_count(0)
    wait_reads(page, fixture, 2, quiet=True)
    return dict(**geometry, retainedCurvesAndAxes=retained_plot)


READ_RANGE_GEOMETRY = """()=>{
  const input=document.querySelector('main [aria-label="开始日期"]');
  let card=input?.parentElement;
  for(;card;card=card.parentElement){
    if(card.querySelector('[aria-label="结束日期"]')&&[...card.querySelectorAll('h2,h3')]
      .some(h=>h.textContent.trim()==='时间范围'))break;
  }
  if(!card)throw new Error('The shared time-range Card could not be located by its heading/inputs');
  const scroll=input.closest('main.app-scroller')||input.closest('main');
  const r=card.getBoundingClientRect(),s=scroll.getBoundingClientRect();
  return {top:r.top-s.top+scroll.scrollTop,viewportTop:r.top,height:r.height,scrollTop:scroll.scrollTop};
}"""


def range_layout_round(page, label):
    # Capture before pointerdown, through every transition frame, and after final cleanup.
    page.evaluate("""()=>{const measure=""" + READ_RANGE_GEOMETRY + """;
      const capture=window.__statsRange={running:true,frames:[],error:null};
      const tick=()=>{
        if(!capture.running)return;
        try{capture.frames.push(measure());}catch(error){capture.error=String(error);capture.running=false;return;}
        requestAnimationFrame(tick);
      };tick();
    }""")
    try:
        for name in ('中文词条', '访客与浏览量', '社区内容', '用户', '社区内容', '用户'):
            tab(page, name)
        page.evaluate('async()=>{await new Promise(requestAnimationFrame);await new Promise(requestAnimationFrame)}')
    finally:
        capture = page.evaluate('()=>{window.__statsRange.running=false;return window.__statsRange}')
    assert capture['error'] is None, capture['error']
    frames = capture['frames']
    assert len(frames) >= 3, f'No real range geometry frames: {frames}'
    spans = {key: max(frame[key] for frame in frames) - min(frame[key] for frame in frames)
             for key in ('top', 'viewportTop', 'height', 'scrollTop')}
    evidence = dict(phase=label, frames=len(frames), first=frames[0], last=frames[-1], spans=spans)
    assert all(value <= 1 for value in spans.values()), (
        'The shared time range must not move/resize/scroll while changing tabs: ' + json.dumps(evidence))
    return evidence


def range_layout(page, fixture, width):
    ready(page, fixture, verify_window=False)
    page.evaluate('()=>document.fonts.ready.then(()=>true)')
    main(page).evaluate('e=>{e.scrollTop=0}')
    rounds = [range_layout_round(page, 'opening width')]
    if '--stats-geometry-only' not in sys.argv:
        # A resize may naturally change wrapping. Rebase after it, then require stable tabs again.
        page.set_viewport_size(dict(width=430 if width < 500 else 1180, height=900))
        page.wait_for_timeout(300)
        main(page).evaluate('e=>{e.scrollTop=0}')
        rounds.append(range_layout_round(page, 'after responsive resize'))
        if width >= 500:
            collapsed = page.get_by_role('button', name='收起侧边栏', exact=True)
            expanded = page.get_by_role('button', name='展开侧边栏', exact=True)
            control = collapsed if collapsed.count() and collapsed.is_visible() else expanded
            if control.count() and control.is_visible():
                control.click()
                page.wait_for_function("""()=>!document.getAnimations().some(a=>{
                  const target=a.effect?.target;return target instanceof Element&&target.id==='app-sidebar'&&a.playState==='running';
                })""", timeout=6000)
                page.wait_for_timeout(200)
                main(page).evaluate('e=>{e.scrollTop=0}')
                rounds.append(range_layout_round(page, 'after docked drawer width change'))
    wait_reads(page, fixture, 1, quiet=True)
    return dict(width=width, rounds=rounds, reads=1)


CAPTURE = """()=>{
  window.__statsMotion={frames:[],done:false};const start=performance.now();
  const tick=()=>{
    const panes=[...document.querySelectorAll('main [role="tabpanel"]')]
      .filter(e=>e.getClientRects().length&&getComputedStyle(e).visibility!=='hidden');
    window.__statsMotion.frames.push(panes.map(e=>{
      const c=getComputedStyle(e),m=c.transform==='none'?new DOMMatrix():new DOMMatrix(c.transform);
      return {x:m.e,opacity:+c.opacity};
    }));
    if(performance.now()-start<1100)requestAnimationFrame(tick);else window.__statsMotion.done=true;
  };tick();
}"""


def motion_probe(page, tier):
    tab(page, '中文词条')
    tab(page, '用户')  # Warm the lazy engine before sampling a deliberate switch.
    page.wait_for_load_state('networkidle')
    page.evaluate(CAPTURE)
    tab(page, '中文词条')
    page.wait_for_function('()=>window.__statsMotion.done', timeout=6000)
    frames = page.evaluate('()=>window.__statsMotion.frames')
    poses = [pose for frame in frames for pose in frame]
    assert poses
    travel, opacity = max(abs(p['x']) for p in poses), min(p['opacity'] for p in poses)
    assert all(0 <= p['opacity'] <= 1.001 for p in poses)
    if tier == 'standard':
        assert travel > 8.5, f'Standard spatial transition missing: {travel}'
    elif tier == 'reduced':
        assert .01 < travel <= 8.5 and opacity < .99, f'Reduced must keep 8px travel/fade: {travel}, {opacity}'
    else:
        assert travel <= .01 and opacity >= .999, f'Off must cut without travel/fade: {travel}, {opacity}'
    settle(page)
    return dict(frames=len(frames), maxTravel=round(travel, 3), minOpacity=round(opacity, 3))


def chart_inputs(page, fixture, mobile):
    tab(page, '用户')
    chart = pane(page).get_by_role('group', name=re.compile('折线图'))
    expect(chart).to_have_attribute('tabindex', '0')
    status = pane(page).get_by_role('status')
    points = fixture.data['series']
    if mobile:
        assert not chart.evaluate('e=>document.activeElement===e'), 'Touch coverage must start without chart focus'
        chart.tap(position=dict(x=1, y=80))
        expect(status).to_contain_text(bucket(points[0]['date']))
        expect(status.locator('dd')).to_have_text(f"{points[0]['total_users']:,}")
    chart.focus()
    expect(status).to_have_attribute('aria-live', 'polite')
    points, before = fixture.data['series'], status.bounding_box()
    for key, index in [('Home', 0), ('ArrowRight', 1), ('End', len(points) - 1), ('ArrowLeft', len(points) - 2)]:
        chart.press(key)
        expect(status).to_contain_text(bucket(points[index]['date']))
        expect(status.locator('dd')).to_have_text(f"{points[index]['total_users']:,}")
    after = status.bounding_box()
    assert before and after and abs(before['y'] - after['y']) <= 1, (before, after)
    if mobile:
        chart.tap(position=dict(x=1, y=80))
    else:
        chart.hover(position=dict(x=1, y=80))
    expect(status).to_contain_text(bucket(points[0]['date']))
    expect(status.locator('dd')).to_have_text(f"{points[0]['total_users']:,}")
    wait_reads(page, fixture, 1, quiet=True)
    return dict(keyboard=['Home', 'ArrowRight', 'End', 'ArrowLeft'], pointer='tap' if mobile else 'hover', stableReadout=True)


def audit(page):
    page.evaluate(AXE)
    result = page.evaluate("""async()=>{
      const result=await axe.run(document,{
        runOnly:{type:'tag',values:['wcag2a','wcag2aa','wcag21a','wcag21aa']},
        // Existing exceptions: docs/design/colour.md#known-contrast-exceptions.
        // No other rules/selectors are excluded.
        rules:{'color-contrast':{enabled:false}}
      });
      const main=document.querySelector('main'),scroller=document.querySelector('main.app-scroller'),
        pane=main.querySelector('[role=tabpanel][data-tab-pane-active]');
      return {
        violations:result.violations.map(v=>({id:v.id,impact:v.impact,nodes:v.nodes.map(n=>({target:n.target,summary:n.failureSummary}))})),
        overflow:{document:document.documentElement.scrollWidth-innerWidth,main:main.scrollWidth-main.clientWidth,
          scroller:scroller?scroller.scrollWidth-scroller.clientWidth:0,activePane:pane?pane.scrollWidth-pane.clientWidth:0},
        nestedControls:[...main.querySelectorAll('button button,a button,button a,a a')]
          .filter(e=>e.getClientRects().length).map(e=>e.outerHTML.slice(0,180))
      };
    }""")
    assert not result['violations'] and not result['nestedControls'], json.dumps(result, ensure_ascii=False)
    assert all(v <= 1 for v in result['overflow'].values()), json.dumps(result, ensure_ascii=False)
    return result


RECORD_SERIES = """()=>{
  const native=Element.prototype.animate;
  window.__statsSeriesRuns=[];
  window.__statsRestoreSeries=()=>{Element.prototype.animate=native;};
  Element.prototype.animate=function(...args){
    const animation=native.apply(this,args);
    // SwapContent's inert departure is a snapshot, not the newly visible chart.
    if(this.matches('g[data-stat-series]')&&this.closest('[data-tab-pane-active]')&&!this.closest('[inert]')){
      const target=this;
      const paths=()=>[...target.querySelectorAll('path')].map(p=>p.getAttribute('d'));
      const record={animation,target,frames:animation.effect.getKeyframes(),before:paths(),
        finished:false,cancelled:false,samples:[]};
      window.__statsSeriesRuns.push(record);
      animation.finished.then(()=>{record.finished=true;},()=>{record.cancelled=true;});
      const tick=()=>{
        const css=getComputedStyle(target);
        record.samples.push({clipPath:css.clipPath,opacity:+css.opacity,paths:paths(),
          viewBox:target.ownerSVGElement?.getAttribute('viewBox')});
        if(animation.playState==='running'||animation.pending)requestAnimationFrame(tick);
      };tick();
    }
    return animation;
  };
}"""


def inset_edges(value):
    """Normalize CSSOM inset serialization without assuming its shorthand length."""
    match = re.fullmatch(r'inset\(([^()]*)\)', value)
    if not match:
        return None
    parts = match[1].split()
    if len(parts) == 1:
        parts *= 4
    elif len(parts) == 2:
        parts *= 2
    elif len(parts) == 3:
        parts.append(parts[1])
    if len(parts) != 4:
        return None
    return tuple('0' if re.fullmatch(r'0(?:px|%)?', part) else part for part in parts)


def series_observation(page, tier, phase, allow_resize=False):
    if tier == 'off':
        page.wait_for_timeout(250)  # Allow scheduled effects to run before the negative assertion.
    else:
        page.wait_for_function('()=>window.__statsSeriesRuns.length>0', timeout=6000)
        page.wait_for_function('()=>window.__statsSeriesRuns.every(r=>r.finished||r.cancelled)', timeout=6000)
    observed = page.evaluate("""async()=>{
      await new Promise(requestAnimationFrame);await new Promise(requestAnimationFrame);
      const final=e=>{const css=getComputedStyle(e);return {clipPath:css.clipPath,opacity:+css.opacity};};
      return {runs:window.__statsSeriesRuns.map(r=>({frames:r.frames,before:r.before,
        after:[...r.target.querySelectorAll('path')].map(p=>p.getAttribute('d')),
        finished:r.finished,cancelled:r.cancelled,connected:r.target.isConnected,
        final:final(r.target),samples:r.samples})),
        resting:[...document.querySelectorAll('[data-tab-pane-active] g[data-stat-series]')]
          .filter(e=>!e.closest('[inert]')).map(final)};
    }""")
    evidence = json.dumps(dict(phase=phase, **observed))
    assert observed['resting'] and all(pose['clipPath'] == 'none' and pose['opacity'] >= .999
                                       for pose in observed['resting']), 'Series must finish fully visible/static: ' + evidence
    if tier == 'off':
        assert not observed['runs'], 'Off must not start a series WAAPI animation: ' + evidence
    else:
        completed = [run for run in observed['runs'] if run['finished'] and run['connected']]
        assert completed, 'A visible series animation must run to completion: ' + evidence
        for run in completed:
            properties = {key for frame in run['frames'] for key in frame
                          if key not in ('offset', 'computedOffset', 'easing', 'composite')}
            assert run['before'], 'A drawing must retain a real path: ' + evidence
            if allow_resize:
                # Reprojection at a new measured width is legitimate; morphing within one width is not.
                by_width = {}
                for sample in run['samples']:
                    previous = by_width.setdefault(sample['viewBox'], sample['paths'])
                    assert sample['paths'] == previous, 'Drawing must not morph d within the same geometry: ' + evidence
            else:
                assert run['after'] == run['before'] and all(sample['paths'] == run['before'] for sample in run['samples']), (
                    'Drawing must reveal the real path, never morph d/data: ' + evidence)
            assert all(0 <= sample['opacity'] <= 1.001 for sample in run['samples']), evidence
            if tier == 'standard':
                assert properties == {'clipPath'}, 'Standard must reveal via clipPath only: ' + evidence
                clips = [frame.get('clipPath', '') for frame in run['frames']]
                assert clips and inset_edges(clips[0]) == ('0', '100%', '0', '0'), (
                    'Drawing starts fully clipped from the right: ' + evidence)
                assert inset_edges(clips[-1]) == ('0', '0', '0', '0'), (
                    'Drawing must reveal the complete plot: ' + evidence)
                assert any(inset_edges(sample['clipPath']) not in (None, ('0', '0', '0', '0'))
                           for sample in run['samples']), 'The reveal must actually run: ' + evidence
            else:
                assert properties == {'opacity'}, 'Reduced must fade only, without drawing/travel: ' + evidence
                assert float(run['frames'][0]['opacity']) < .99 and float(run['frames'][-1]['opacity']) >= .999, evidence
                assert all(sample['clipPath'] == 'none' for sample in run['samples']), evidence
                assert any(sample['opacity'] < .99 for sample in run['samples']), 'The reduced fade must actually run: ' + evidence
    # Keep stdout useful without dumping unchanged path strings on every frame.
    return dict(phase=phase, runs=[dict(properties=sorted({key for frame in run['frames'] for key in frame
                    if key not in ('offset', 'computedOffset', 'easing', 'composite')}),
                    finished=run['finished'], cancelled=run['cancelled'], frames=len(run['samples']),
                    final=run['final']) for run in observed['runs']], resting=observed['resting'])


def line_drawing(page, fixture, width, tier):
    ready(page, fixture)
    groups = pane(page).locator('figure svg[preserveAspectRatio="none"] g[data-stat-series]')
    assert groups.count() > 0, 'Line drawing must expose a data-stat-series SVG group (old build has none)'
    # Let first-load/resize effects settle, then sample natural playback without pausing it.
    page.wait_for_function("""()=>![...document.querySelectorAll('[data-tab-pane-active] g[data-stat-series]')]
      .some(e=>e.getAnimations().some(a=>a.playState==='running'||a.pending))""", timeout=6000)
    page.evaluate(RECORD_SERIES)
    try:
        before = paths(page)
        choice(page, '每日').click()
        selected(page, '每日')
        rounds = [series_observation(page, tier, 'view change')]
        # Avoid treating the inert departing plot as a second/current data source.
        page.wait_for_function('()=>!document.querySelector("[data-tab-pane-active] figure [inert]")', timeout=6000)
        assert paths(page) != before, 'Switching to daily must really change the plotted values'
        page.evaluate('()=>{window.__statsSeriesRuns=[]}')
        before = paths(page)
        fixture.mode = 'pending'
        slider(page, '开始日期').press('ArrowRight')
        wait_reads(page, fixture, 2)
        assert paths(page) == before, 'A held refresh must not morph/restart the old curve'
        assert page.evaluate('()=>window.__statsSeriesRuns.length') == 0, 'Loading alone must not restart drawing'
        fixture.revision += 1
        fixture.mode = 'ok'
        fixture.release()
        headline(page, fixture.data)
        chart_window(page, last_window(fixture))
        rounds.append(series_observation(page, tier, 'new data'))
        page.wait_for_function('()=>!document.querySelector("[data-tab-pane-active] figure [inert]")', timeout=6000)
        assert paths(page) != before, 'A new fixture revision must really change the plotted values'
        wait_reads(page, fixture, 2, quiet=True)
        interruptions = interrupted_drawing(page, tier)
        wait_reads(page, fixture, 2, quiet=True)
        return dict(tier=tier, rounds=rounds, reads=2, loadingDoesNotRestart=True, interruptions=interruptions)
    finally:
        page.evaluate('()=>window.__statsRestoreSeries?.()')


def interrupted_drawing(page, tier):
    page.evaluate('()=>{window.__statsSeriesRuns=[]}')
    before = page.evaluate(READ_RANGE_GEOMETRY)
    choice(page, '累计').click()
    if tier != 'off':
        page.wait_for_function('()=>window.__statsSeriesRuns.length>0', timeout=6000)
    choice(page, '每日').click()
    selected(page, '每日')
    rapid = series_observation(page, tier, 'rapid total/daily reversal')
    page.wait_for_function('()=>!document.querySelector("[data-tab-pane-active] figure [inert]")', timeout=6000)
    page.evaluate('()=>{window.__statsSeriesRuns=[]}')
    choice(page, '累计').click()
    series_observation(page, tier, 'settled total view geometry')
    page.wait_for_function('()=>!document.querySelector("[data-tab-pane-active] figure [inert]")', timeout=6000)
    after = page.evaluate(READ_RANGE_GEOMETRY)
    assert abs(before['top'] - after['top']) <= 1 and abs(before['height'] - after['height']) <= 1, (
        'Daily/total view changes must retain the shared range layout: ' + json.dumps(dict(before=before, after=after)))
    page.evaluate('()=>{window.__statsSeriesRuns=[]}')
    choice(page, '每日').click()
    if tier != 'off':
        page.wait_for_function('()=>window.__statsSeriesRuns.length>0', timeout=6000)
    viewport = page.viewport_size
    page.set_viewport_size(dict(width=viewport['width'] + 40, height=viewport['height']))
    resized = series_observation(page, tier, 'resize during reveal', allow_resize=True)
    page.wait_for_function('()=>!document.querySelector("[data-tab-pane-active] figure [inert]")', timeout=6000)
    page.evaluate('()=>{window.__statsSeriesRuns=[]}')
    choice(page, '累计').click()
    if tier != 'off':
        page.wait_for_function('()=>window.__statsSeriesRuns.length>0', timeout=6000)
    tab(page, '社区内容')
    tab(page, '用户')
    selected(page, '累计')
    page.wait_for_function("""()=>![...document.querySelectorAll('[data-tab-pane-active] g[data-stat-series]')]
      .some(e=>e.getAnimations().some(a=>a.playState==='running'||a.pending))""", timeout=6000)
    final = pane(page).locator('g[data-stat-series]').evaluate_all("""nodes=>nodes.filter(e=>!e.closest('[inert]')).map(e=>{
      const c=getComputedStyle(e);return {clipPath:c.clipPath,opacity:+c.opacity};
    })""")
    assert final and all(pose['clipPath'] == 'none' and pose['opacity'] >= .999 for pose in final), final
    pane_state(page, '用户')
    return dict(rapid=rapid, resize=resized, tabInterruptionFinal=final, viewRangeBefore=before, viewRangeAfter=after)


def custom_isolation(page, fixture, width):
    ready(page, fixture)
    page.evaluate(RECORD_SERIES)
    try:
        page.evaluate("""()=>{
          const root=document.documentElement;
          root.dataset.motion='custom';root.dataset.motionEffects='feedback:off,tabs:standard,entrance:off';
          root.setAttribute('data-motion-feedback','off');root.setAttribute('data-motion-tabs','standard');
          root.style.setProperty('--motion-custom-enabled-feedback','0');
        }""")
        # A media-store notification makes attribute injection visible to useAppearance subscribers.
        page.emulate_media(reduced_motion='reduce')
        page.emulate_media(reduced_motion='no-preference')
        motion = motion_probe(page, 'standard')
        tab(page, '用户')
        choice(page, '每日').click()
        selected(page, '每日')
        off = series_observation(page, 'off', 'custom feedback off; tabs standard')
        page.wait_for_function('()=>!document.querySelector("[data-tab-pane-active] figure [inert]")', timeout=6000)
        page.evaluate("""()=>{
          const root=document.documentElement;
          root.dataset.motionEffects='feedback:reduced,tabs:off,entrance:off';
          root.setAttribute('data-motion-feedback','reduced');root.setAttribute('data-motion-tabs','off');
          root.style.setProperty('--motion-custom-enabled-feedback','1');root.style.setProperty('--motion-custom-enabled-tabs','0');
          window.__statsSeriesRuns=[];
        }""")
        page.emulate_media(reduced_motion='reduce')
        page.emulate_media(reduced_motion='no-preference')
        choice(page, '累计').click()
        reduced = series_observation(page, 'reduced', 'custom feedback reduced; tabs off')
        still = motion_probe(page, 'off')
        wait_reads(page, fixture, 1, quiet=True)
        return dict(feedbackOff=off, tabsStandard=motion, feedbackReduced=reduced, tabsOff=still,
                    preferences='root attribute injection; settings persistence tested by motion suite', reads=1)
    finally:
        page.evaluate('()=>window.__statsRestoreSeries?.()')


def profile(page, fixture, width, tier):
    ready(page, fixture)
    expect(page.locator('html')).to_have_class(re.compile(r'\bdark\b'))
    expect(page.locator('html')).to_have_attribute('data-motion', tier)
    motion, inputs = motion_probe(page, tier), chart_inputs(page, fixture, width < 500)
    audits = []
    for name in TABS:
        panel = tab(page, name)
        headline(page, fixture.data, name)
        expect(panel.get_by_role('heading').first).to_be_visible()
        fonts = panel.locator('figure svg text').evaluate_all("""nodes=>nodes.map(e=>{
          const svg=e.ownerSVGElement,r=svg.getBoundingClientRect(),style=getComputedStyle(e);
          return {size:parseFloat(style.fontSize),scale:r.width/svg.viewBox.baseVal.width,
            labelRole:e.classList.contains('text-label-s')};
        })""")
        assert fonts and all(item['labelRole'] and abs(item['size'] - 11) <= .1 and abs(item['scale'] - 1) <= .01
                             for item in fonts), 'Axes must keep real label-s typography after sizing: ' + json.dumps(fonts)
        result = audit(page)
        audits.append(dict(tab=name, axeViolations=len(result['violations']), overflow=result['overflow'],
                          paneState=pane_state(page, name), axisFonts=fonts))
    wait_reads(page, fixture, 1, quiet=True)
    screenshot = None
    if tier == 'off':
        tab(page, '用户')
        main(page).evaluate('e=>{e.scrollTop=0}')
        OUTPUT.mkdir(parents=True, exist_ok=True)
        screenshot = str(OUTPUT / f'stats-dark-{width}.png')
        page.screenshot(path=screenshot)
    return dict(scheme='dark', width=width, tier=tier, motion=motion, chartInput=inputs, audits=audits, screenshot=screenshot)


def run_case(browser, base, fixtures, name, action, tier='off', width=1440):
    fixture = Fixture(base, fixtures)
    context = new_context(browser, fixture, tier, width)
    page = context.new_page()
    page.set_default_timeout(8000)
    errors = []
    page.on('pageerror', lambda error: errors.append(str(error)))
    result = dict(case=name, tier=tier, width=width)
    try:
        result['evidence'] = action(page, fixture, width)
        assert not errors and not fixture.errors, dict(pageErrors=errors, fixtureErrors=fixture.errors)
        assert not fixture.pending, 'Every held stats read must be released'
        result['passed'] = True
        print('PASS ' + name, flush=True)
    except Exception as error:
        result.update(passed=False, error=str(error), pageErrors=errors, fixtureErrors=fixture.errors, traceback=traceback.format_exc())
        try:
            result['mainText'] = main(page).inner_text(timeout=1000)[:3500]
        except Exception:
            result['mainText'] = '<main unavailable>'
        print('FAIL ' + name + ': ' + str(error), flush=True)
    finally:
        result['requests'] = fixture.requests
        context.close()  # Cancels held routes if an assertion failed mid-read/drag.
    print(json.dumps(result, ensure_ascii=False), flush=True)
    return result


def run():
    if len(sys.argv) < 3:
        raise SystemExit('Use node scripts/reviewBrowser.mjs --stats; BASE/FIXTURES are required.')
    base, fixtures = (arg.rstrip('/') for arg in sys.argv[1:3])
    for raw in (base, fixtures):
        parsed = url.urlparse(raw)
        assert parsed.scheme in ('http', 'https') and parsed.hostname in ('127.0.0.1', 'localhost', '::1'), ('Only local review servers allowed', raw)
    results = []
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(headless=True, **browser_options())
        try:
            geometry_only = '--stats-geometry-only' in sys.argv
            followup_only = geometry_only or '--stats-followup-only' in sys.argv
            if not followup_only:
                for width in (1440, 390):
                    results.append(run_case(browser, base, fixtures, f'{width}px pointer crossing and cancellation', range_pointer_edges, width=width))
                    results.append(run_case(browser, base, fixtures, f'{width}px initial chart skeleton geometry', initial_plot_geometry, width=width))
                results.append(run_case(browser, base, fixtures, 'custom feedback/tab category isolation', custom_isolation, tier='custom'))
                for name, action in [('loading and local categories', categories), ('keyboard commits and held drag', range_commits),
                                     ('failed refresh retains data and retries', refresh_failure), ('initial failure retries', initial_failure),
                                     ('empty charts use EmptyState', empty_charts)]:
                    results.append(run_case(browser, base, fixtures, name, action))
                for tier in ('standard', 'reduced', 'off'):
                    for width in (1440, 390):
                        def check(page, fixture, current_width, current_tier=tier):
                            return profile(page, fixture, current_width, current_tier)
                        results.append(run_case(browser, base, fixtures, f'dark {width}px {tier}: input motion axe overflow', check, tier, width))
            for tier in (('off',) if geometry_only else ('standard', 'reduced', 'off')):
                for width in (1440, 390):
                    for name, action in [('full plot loading skeleton', plot_skeleton), ('stable shared time range', range_layout)]:
                        results.append(run_case(browser, base, fixtures, f'{width}px {tier}: {name}', action, tier, width))
                    if not geometry_only:
                        def draw(page, fixture, current_width, current_tier=tier):
                            return line_drawing(page, fixture, current_width, current_tier)
                        results.append(run_case(browser, base, fixtures, f'{width}px {tier}: line drawing tier', draw, tier, width))
        finally:
            browser.close()
    failed = sum(not r['passed'] for r in results)
    planned_axe = 0 if followup_only else 24
    print(f'{len(results)} stats scenarios, {failed} failed; {planned_axe} planned dark tab/profile axe audits; only color-contrast excluded.', flush=True)
    return 1 if failed else 0


if __name__ == '__main__':
    sys.exit(run())
