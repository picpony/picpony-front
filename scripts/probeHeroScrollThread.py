"""Which thread scrolls the picture while it is opening. Traces a wheel stream during the open
and lists the compositor's verdict for each scroll it began (main-thread reasons, if any)."""
import json
import sys
from playwright.sync_api import sync_playwright, expect
from testProfileGallery import BASE, Fixtures, USER, THUMB

with sync_playwright() as playwright:
    browser = playwright.chromium.launch(headless=True)
    context = browser.new_context(viewport={'width': 1440, 'height': 900}, reduced_motion='no-preference')
    fixtures = Fixtures()
    fixtures.hold_uploads = False
    fixtures.hold_details = False
    context.route('**/*', fixtures)
    stored = {'picpony_dev_banner_dismissed': 'true', 'picpony_motion': 'standard', 'user_info': json.dumps(USER)}
    context.add_init_script('for(const [k,v] of Object.entries(' + json.dumps(stored) + '))localStorage.setItem(k,v)')
    page = context.new_page()
    cdp = context.new_cdp_session(page)
    page.goto(BASE + '/user/1', wait_until='networkidle')
    expect(page.locator('[data-tab-pane-active] ' + THUMB)).to_have_count(12)
    page.wait_for_timeout(800)
    for mode in ['gallery', 'opening', 'detail']:
        chunks = []
        cdp.on('Tracing.dataCollected', lambda e: chunks.extend(e['value']))
        cdp.send('Tracing.start', {'categories': 'cc,input,latencyInfo,disabled-by-default-cc.debug.scheduler',
                                   'transferMode': 'ReportEvents'})
        if mode == 'opening':
            thumb = page.locator(f'[data-tab-pane-active] {THUMB}[data-image-hero-id="3001"]')
            thumb.locator('..').click(no_wait_after=True)
            page.wait_for_timeout(40)
        page.mouse.move(720, 600)
        for k in range(12):
            page.mouse.wheel(0, 60)
            page.wait_for_timeout(16)
        page.wait_for_timeout(600)
        done = []
        cdp.once('Tracing.tracingComplete', lambda e: done.append(1))
        cdp.send('Tracing.end')
        while not done:
            page.wait_for_timeout(100)
        reasons = {}
        names = {}
        for ev in chunks:
            n = ev.get('name', '')
            if 'Scroll' in n or 'scroll' in n:
                names[n] = names.get(n, 0) + 1
            args = json.dumps(ev.get('args', {}))
            if 'main_thread_scrolling_reasons' in args or 'MainThreadScrollingReason' in args or 'main_thread_repaint' in args:
                reasons[args[:300]] = reasons.get(args[:300], 0) + 1
        print(mode, json.dumps(sorted(names.items(), key=lambda kv: -kv[1])[:14]))
        for r, c in list(reasons.items())[:6]:
            print('   ', c, r)
        page.wait_for_timeout(300)
        if mode == 'opening':
            page.wait_for_function("document.documentElement.dataset.imageHeroState==='detail-idle'")
    browser.close()
