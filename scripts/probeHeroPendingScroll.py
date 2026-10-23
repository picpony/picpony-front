"""Scroll while a picture is opening and its detail record has not arrived yet.

Reproduces the "opening, detail still loading, scrolling drops frames" report and measures it:
rAF gaps (main-thread pacing), long tasks, compositor main-thread scroll reasons, and what the
reader can scroll at all. Then releases the record mid-flight to check whether the detail body
appears before the handoff (early reveal).

Run: npm run build && npm run perf:hero-pending
"""
import json
import math
import statistics
import sys

from playwright.sync_api import sync_playwright, expect
from testProfileGallery import BASE, Fixtures, USER, THUMB

class SafeFixtures(Fixtures):
    misses = set()

    def __call__(self, route):
        try:
            super().__call__(route)
        except Exception:
            SafeFixtures.misses.add(route.request.url[:120])
            try:
                route.fulfill(status=404, body='')
            except Exception:
                pass


_PAGES = {}


def page_of(cdp):
    return _PAGES[id(cdp)]


def swipe(cdp, page, x, y, distance=420, steps=14):
    """A real touch fling: finger moves up `distance` px over ~steps*8ms and lifts."""
    cdp.send('Input.dispatchTouchEvent', {'type': 'touchStart', 'touchPoints': [{'x': x, 'y': y}]})
    for step in range(1, steps + 1):
        cdp.send('Input.dispatchTouchEvent', {'type': 'touchMove',
                                              'touchPoints': [{'x': x, 'y': y - distance * step / steps}]})
        page.wait_for_timeout(8)
    cdp.send('Input.dispatchTouchEvent', {'type': 'touchEnd', 'touchPoints': []})


CPU = int(next((a.split('=', 1)[1] for a in sys.argv if a.startswith('--cpu=')), '4'))
LABEL = next((a.split('=', 1)[1] for a in sys.argv if a.startswith('--label=')), 'current')

RECORDER = """() => {
  window.__p = {frames: [], tasks: [], marks: []};
  window.__rec = false;
  const f = t => { if (window.__rec) window.__p.frames.push(t); requestAnimationFrame(f); };
  requestAnimationFrame(f);
  new PerformanceObserver(l => { if (window.__rec) for (const e of l.getEntries())
    window.__p.tasks.push(Math.round(e.duration)); }).observe({type: 'longtask'});
  new MutationObserver(() => { if (window.__rec) window.__p.marks.push(
    [Math.round(performance.now()), document.documentElement.dataset.imageHeroState]); })
    .observe(document.documentElement, {attributes: true, attributeFilter: ['data-image-hero-state']});
}"""

STATE = """() => {
  const stage = document.querySelector('[data-image-hero-stage-scroll]');
  const route = document.querySelector('[data-image-hero-surface-id] .image-detail-overlay-scroll');
  const overlay = route && route.closest('[data-image-detail-overlay]');
  const body = document.querySelector('[data-image-hero-surface-id] [data-image-detail-reveal="body"]');
  return {
    phase: document.documentElement.dataset.imageHeroState,
    stageRange: stage ? stage.scrollHeight - stage.clientHeight : null,
    stageTop: stage ? Math.round(stage.scrollTop) : null,
    routeRange: route ? route.scrollHeight - route.clientHeight : null,
    routeTop: route ? Math.round(route.scrollTop) : null,
    routeVisible: overlay ? getComputedStyle(overlay).visibility : null,
    bodyText: body ? body.innerText.length : 0,
  };
}"""


def q(values, p):
    values = sorted(values)
    return round(values[min(len(values) - 1, math.ceil(len(values) * p) - 1)], 1) if values else 0


def summarize(page, label):
    log = page.evaluate("window.__rec=false;window.__p")
    gaps = [b - a for a, b in zip(log['frames'], log['frames'][1:])]
    over = sum(g > 25 for g in gaps)
    print(json.dumps({'case': label, 'frames': len(gaps), 'medianMs': round(statistics.median(gaps), 1) if gaps else 0,
                      'p95Ms': q(gaps, .95), 'maxMs': q(gaps, 1), 'gapsOver25ms': over,
                      'longTasks': log['tasks'], 'phases': log['marks']}), flush=True)


def scroll_reasons(chunks):
    reasons = {}
    for ev in chunks:
        args = ev.get('args', {})
        text = json.dumps(args)
        if 'main_thread_scrolling_reasons' in text or 'MainThreadScrollingReason' in text:
            reasons[text[:200]] = reasons.get(text[:200], 0) + 1
    return reasons


def run(browser, width, touch):
    context = browser.new_context(viewport={'width': width, 'height': 900}, reduced_motion='no-preference',
                                  is_mobile=touch, has_touch=touch)
    fixtures = SafeFixtures()
    fixtures.hold_uploads = False
    fixtures.hold_details = True
    context.route('**/*', fixtures)
    stored = {'picpony_dev_banner_dismissed': 'true', 'picpony_motion': 'standard', 'user_info': json.dumps(USER),
              'trixie_use_cdn': 'false', 'picpony_use_proxy': 'false', 'picpony_hk_relay': 'false'}
    context.add_init_script('for(const [k,v] of Object.entries(' + json.dumps(stored) + '))localStorage.setItem(k,v)')
    context.add_init_script('globalThis.__HERO_PROBE__ = true')
    page = context.new_page()
    page.set_default_timeout(15000)
    errors = []
    page.on('pageerror', lambda e: errors.append(str(e)))
    cdp = context.new_cdp_session(page)
    _PAGES[id(cdp)] = page
    name = f"{'mobile' if touch else 'desktop'}"
    try:
        page.goto(BASE + '/user/1', wait_until='networkidle')
        expect(page.locator('[data-tab-pane-active] ' + THUMB)).to_have_count(12)
        page.evaluate(RECORDER)
        cdp.send('Emulation.setCPUThrottlingRate', {'rate': CPU})
        page.wait_for_timeout(600)
        source = page.locator(f'[data-tab-pane-active] {THUMB}[data-image-hero-id="3001"]')
        box = source.bounding_box()
        chunks = []
        cdp.on('Tracing.dataCollected', lambda e: chunks.extend(e['value']))
        cdp.send('Tracing.start', {'categories': 'cc,input,benchmark,disabled-by-default-devtools.timeline.frame,devtools.timeline',
                                   'transferMode': 'ReportEvents'})
        page.evaluate("window.__rec=true")
        source.locator('..').evaluate('n=>n.click()')
        page.wait_for_timeout(30)
        states = [page.evaluate(STATE)]
        cx, cy = width / 2, 600
        if touch:
            cdp.send('Emulation.setTouchEmulationEnabled', {'enabled': True, 'maxTouchPoints': 1})
            for rep in range(3):
                swipe(cdp, page_of(cdp), cx, cy)
                states.append(page.evaluate(STATE))
        else:
            page.mouse.move(cx, cy)
            for k in range(40):
                page.mouse.wheel(0, 50)
                page.wait_for_timeout(16)
                if k % 10 == 9:
                    states.append(page.evaluate(STATE))
        summarize(page, f'{name}-scroll-while-pending')
        done = []
        cdp.once('Tracing.tracingComplete', lambda e: done.append(1))
        cdp.send('Tracing.end')
        while not done:
            page.wait_for_timeout(50)
        for s in states:
            print('   state', json.dumps(s))
        states_count = {}
        main = {}
        for ev in chunks:
            if ev.get('name') == 'PipelineReporter' and ev.get('ph') in ('b', 'X'):
                st = ev.get('args', {}).get('chrome_frame_reporter', {}).get('state', '?')
                states_count[st] = states_count.get(st, 0) + 1
            if ev.get('ph') == 'X' and ev.get('dur', 0) > 8000 and ev.get('name') in ('FunctionCall', 'Layout', 'UpdateLayoutTree', 'Paint', 'EvaluateScript', 'RunTask', 'TimerFire', 'FireAnimationFrame', 'EventDispatch', 'PrePaint', 'Commit', 'Layerize'):
                key = ev['name'] + ':' + str(ev.get('args', {}).get('data', {}).get('functionName') or ev.get('args', {}).get('data', {}).get('type') or '')
                main.setdefault(key, []).append(round(ev['dur'] / 1000))
        print('   frames', json.dumps(states_count))
        for k, v in sorted(main.items(), key=lambda kv: -sum(kv[1]))[:14]:
            print('   heavy', k, v[:8])
        for r, c in list(scroll_reasons(chunks).items())[:5]:
            print('   mainThreadReason', c, r)
        # Release the record now; record when the body becomes visible relative to the handoff.
        page.evaluate("window.__p={frames:[],tasks:[],marks:[]};window.__rec=true")
        fixtures_release_at = page.evaluate('performance.now()')
        page.evaluate("0")
        fixtures.release_details()
        page.wait_for_function("document.documentElement.dataset.imageHeroState==='detail-idle'", polling='raf')
        summarize(page, f'{name}-release-to-idle')
        print('   final', json.dumps(page.evaluate(STATE)), 'errors', errors[:3])
        page.keyboard.press('Escape')
        page.wait_for_function("document.documentElement.dataset.imageHeroState==='gallery-idle'", polling='raf')

        # Early reveal: record held for 120ms only, i.e. lands mid-flight.
        fixtures.hold_details = True
        page.wait_for_timeout(500)
        other = page.locator(f'[data-tab-pane-active] {THUMB}[data-image-hero-id="3008"]')
        page.evaluate("""() => { window.__seen = null; window.__timeline = []; const t0 = performance.now(); window.__t0 = t0;
          const tick = () => {
            const o = document.querySelector('[data-image-hero-surface-id]');
            const b = o && o.querySelector('[data-image-detail-reveal="body"]');
            const vis = o ? getComputedStyle(o).visibility : 'none';
            const text = b ? b.innerText.length : 0;
            const phase = document.documentElement.dataset.imageHeroState;
            const row = [Math.round(performance.now() - t0), phase, vis, text];
            const last = window.__timeline[window.__timeline.length - 1];
            if (!last || last[1] !== row[1] || last[2] !== row[2] || (last[3] > 20) !== (row[3] > 20)) window.__timeline.push(row);
            if (!window.__seen && text > 20 && vis === 'visible') window.__seen = [row[0], phase];
            if (phase !== 'detail-idle' || !window.__seen) requestAnimationFrame(tick); };
          requestAnimationFrame(tick); }""")
        other.locator('..').evaluate('n=>n.click()')
        page.wait_for_timeout(120)
        fixtures.release_details()
        page.wait_for_function("document.documentElement.dataset.imageHeroState==='detail-idle'", polling='raf')
        page.wait_for_function("window.__seen")
        print(json.dumps({'case': f'{name}-body-visible-at', 'value': page.evaluate('window.__seen'),
                          'timeline': page.evaluate('window.__timeline'),
                          'events': page.evaluate("""() => [
                            ...performance.getEntriesByType('resource').filter(e => /images\\/3002(\\?|$)/.test(e.name))
                              .map(e => ['record', Math.round(e.responseEnd - window.__t0)]),
                            ...performance.getEntriesByType('mark').filter(e => e.startTime > window.__t0 && /early-reveal|body-publish|hero-phase/.test(e.name))
                              .map(e => [e.name, Math.round(e.startTime - window.__t0)])]""")}), flush=True)
        page.keyboard.press('Escape')
        page.wait_for_function("document.documentElement.dataset.imageHeroState==='gallery-idle'", polling='raf')
    finally:
        cdp.detach()
        context.close()


if __name__ == '__main__':
  with sync_playwright() as playwright:
      browser = playwright.chromium.launch(headless=True, args=['--enable-gpu-rasterization'])
      for width, touch in [(1440, False), (390, True)]:
          run(browser, width, touch)
      browser.close()
      print('fixture misses', sorted(SafeFixtures.misses)[:10])
