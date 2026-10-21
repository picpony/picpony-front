"""Scroll smoothness during an opening, and the wait between the flyer landing and the detail
being complete. Run: node scripts/reviewBrowser.mjs --hero-open-probe [--cpu=4]

Per open: the press, then a wheel/touch scroll stream from 30ms on over the picture, sampled every
rAF until the detail settles. Reports frame gaps and long tasks inside the opening window, the
phase timeline relative to the press, and when the detail's body (`data-image-detail-reveal=body`
on the routed surface) is laid out with content.
"""
import json
import statistics
import sys
from playwright.sync_api import sync_playwright, expect
from testProfileGallery import BASE, Fixtures, USER, THUMB

CPU = next((float(a.split('=', 1)[1]) for a in sys.argv if a.startswith('--cpu=')), 1)
OPENS = next((int(a.split('=', 1)[1]) for a in sys.argv if a.startswith('--opens=')), 5)
DETAIL_DELAY = next((int(a.split('=', 1)[1]) for a in sys.argv if a.startswith('--detail-delay=')), 0)

RECORDER = """() => {
  window.__p = {frames: [], tasks: [], phases: [], scroll: []};
  window.__rec = false;
  const frame = t => {
    if (window.__rec) {
      const st = document.querySelector('[data-image-hero-stage-scroll]');
      const rt = document.querySelector('[data-image-hero-surface-id] .image-detail-overlay-scroll');
      const body = document.querySelector('[data-image-hero-surface-id] [data-image-detail-reveal="body"] button');
      window.__p.frames.push({t, stage: st ? st.scrollTop : null, route: rt ? rt.scrollTop : null,
        body: body && body.checkVisibility() ? 100 : null,
        state: document.documentElement.dataset.imageHeroState});
    }
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
  new PerformanceObserver(list => { if (window.__rec) for (const e of list.getEntries())
    window.__p.tasks.push({at: e.startTime, d: e.duration}); }).observe({type: 'longtask'});
  new MutationObserver(() => { if (window.__rec) window.__p.phases.push({at: performance.now(),
    phase: document.documentElement.dataset.imageHeroState}); })
    .observe(document.documentElement, {attributes: true, attributeFilter: ['data-image-hero-state']});
}"""


class DelayedFixtures(Fixtures):
    def __call__(self, route):
        import re, time
        if DETAIL_DELAY and re.search(r'/images/\\d+', route.request.url):
            time.sleep(DETAIL_DELAY / 1000)
        super().__call__(route)


def run(browser, width):
    mobile = width < 500
    context = browser.new_context(viewport={'width': width, 'height': 900}, reduced_motion='no-preference',
                                  is_mobile=mobile, has_touch=mobile)
    fixtures = DelayedFixtures()
    fixtures.hold_uploads = False
    fixtures.hold_details = False
    context.route('**/*', fixtures)
    stored = {'picpony_dev_banner_dismissed': 'true', 'trixie_use_cdn': 'false',
              'picpony_use_proxy': 'false', 'picpony_hk_relay': 'false', 'picpony_motion': 'standard',
              'picpony_motion_speed': 'default', 'user_info': json.dumps(USER)}
    context.add_init_script('for(const [k,v] of Object.entries(' + json.dumps(stored) + '))localStorage.setItem(k,v)')
    context.add_init_script('(' + RECORDER + ')()')
    page = context.new_page()
    page.set_default_timeout(10000)
    cdp = context.new_cdp_session(page)
    page.goto(BASE + '/user/1', wait_until='networkidle')
    expect(page.locator('[data-tab-pane-active] ' + THUMB)).to_have_count(12)
    page.wait_for_timeout(800)
    if CPU > 1:
        cdp.send('Emulation.setCPUThrottlingRate', {'rate': CPU})
    ids = page.eval_on_selector_all('[data-tab-pane-active] ' + THUMB, 'ns => ns.map(n => Number(n.dataset.imageHeroId))')
    out = []
    for n in range(OPENS):
        image_id = ids[n % len(ids)]
        thumb = page.locator(f'[data-tab-pane-active] {THUMB}[data-image-hero-id="{image_id}"]')
        thumb.scroll_into_view_if_needed()
        page.wait_for_timeout(500)
        box = thumb.bounding_box()
        x, y = box['x'] + box['width'] / 2, box['y'] + box['height'] / 2
        t0 = page.evaluate("window.__p={frames:[],tasks:[],phases:[],scroll:[]};window.__rec=true;performance.now()")
        if mobile:
            cdp.send('Input.dispatchTouchEvent', {'type': 'touchStart', 'touchPoints': [{'x': x, 'y': y}]})
            cdp.send('Input.dispatchTouchEvent', {'type': 'touchEnd', 'touchPoints': []})
        else:
            page.mouse.move(x, y)
            page.mouse.down()
            page.mouse.up()
        page.wait_for_timeout(30)
        # The scroll stream, over the middle of the screen.
        cx, cy = width / 2, 600
        if '--no-scroll' in sys.argv:
            pass
        elif mobile:
            for k in range(3):
                cdp.send('Input.synthesizeScrollGesture', {'x': int(cx), 'y': int(cy), 'yDistance': -260,
                                                           'speed': 1400, 'gestureSourceType': 'touch',
                                                           'preventFling': False})
        else:
            page.mouse.move(cx, cy)
            for k in range(24):
                page.mouse.wheel(0, 40)
                page.wait_for_timeout(16)
        try:
            page.wait_for_function("document.documentElement.dataset.imageHeroState==='detail-idle'", timeout=8000)
        except Exception:
            pass
        page.wait_for_timeout(700)
        data = page.evaluate("window.__rec=false;window.__p")
        frames = data['frames']
        phases = []
        for f in frames:
            if not phases or phases[-1]['phase'] != f['state']:
                phases.append({'phase': f['state'], 'at': f['t']})
        data['phases'] = phases
        idle_at = next((p['at'] for p in phases if p['phase'] == 'detail-idle'), None)
        landed_at = next((p['at'] for p in phases if p['phase'] == 'opening.landed'), None)
        win = [f for f in frames if idle_at is None or f['t'] <= idle_at]
        gaps = [b['t'] - a['t'] for a, b in zip(win, win[1:])]
        body_at = next((f['t'] for f in frames if f['body'] and f['body'] > 40), None)
        moved = sum(1 for a, b in zip(win, win[1:]) if (b['stage'] or b['route'] or 0) != (a['stage'] or a['route'] or 0))
        res = {
            'id': image_id,
            'landed': round(landed_at - t0) if landed_at else None,
            'idle': round(idle_at - t0) if idle_at else None,
            'body': round(body_at - t0) if body_at else None,
            'frames': len(win), 'p50gap': round(statistics.median(gaps), 1) if gaps else None,
            'maxgap': round(max(gaps), 1) if gaps else None,
            'over33': sum(1 for g in gaps if g > 33.4),
            'scrollFramesMoved': moved,
            'longtasks': [round(t['d']) for t in data['tasks'] if idle_at is None or t['at'] <= idle_at],
            'phases': [(p['phase'], round(p['at'] - t0)) for p in data['phases']],
        }
        if '--dump' in sys.argv:
            print('  ', ' '.join(f"{round(f['t']-t0)}:{f['state'][:9] if f['state'] else '-'}:{f['stage']}/{f['route']}" for f in frames[:90]))
        out.append(res)
        print(width, json.dumps(res), flush=True)
        page.keyboard.press('Escape')
        try:
            page.wait_for_function("document.documentElement.dataset.imageHeroState==='gallery-idle'", timeout=6000)
        except Exception:
            page.goto(BASE + '/user/1', wait_until='networkidle')
        page.wait_for_timeout(700)
    context.close()
    return out


with sync_playwright() as playwright:
    browser = playwright.chromium.launch(headless=True)
    for width in [1440, 390]:
        run(browser, width)
    browser.close()
