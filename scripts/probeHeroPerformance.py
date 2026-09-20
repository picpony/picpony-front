"""Production hero frame/trace probe. Run via npm run perf:hero.

Measures a real browser with its normal compositor enabled. Fixtures isolate network
variability. rAF gaps measure main-thread pacing, not physical display presentation.
Trace windows contain only the operation; screenshots are taken separately.
"""
import json
import math
import pathlib
import statistics
import sys

from playwright.sync_api import sync_playwright, expect
from testProfileGallery import BASE, Fixtures, USER, THUMB

ROOT = pathlib.Path(__file__).resolve().parent.parent
LABEL = next((a.split('=', 1)[1] for a in sys.argv if a.startswith('--label=')), 'current')
PULL_ONLY = '--pull-only' in sys.argv
OUTPUT = ROOT / '.workbuddy' / 'hero-performance' / LABEL
OUTPUT.mkdir(parents=True, exist_ok=True)
RESULTS = []
CADENCES = {}

RECORDER = """() => {
  window.__heroPerf = {frames: [], phases: [], tasks: []};
  window.__heroRecord = false;
  const frame = t => {
    if (window.__heroRecord) window.__heroPerf.frames.push(t);
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
  new PerformanceObserver(list => {
    if (window.__heroRecord) for (const e of list.getEntries())
      window.__heroPerf.tasks.push({at:e.startTime,duration:e.duration});
  }).observe({type:'longtask', buffered:false});
  new MutationObserver(() => {
    if (!window.__heroRecord) return;
    const phase = document.documentElement.dataset.imageHeroDismissGesture || document.documentElement.dataset.imageHeroState;
    window.__heroPerf.phases.push({at:performance.now(),phase});
    performance.mark('hero-phase:'+phase);
  }).observe(document.documentElement, {attributes:true,attributeFilter:['data-image-hero-state','data-image-hero-dismiss-gesture']});
}"""


def quantile(values, p):
    values = sorted(values)
    return round(values[min(len(values)-1, math.ceil(len(values)*p)-1)], 2) if values else 0


def start_trace(page, cdp):
    chunks = []
    collected = lambda e: chunks.extend(e['value'])
    cdp.on('Tracing.dataCollected', collected)
    cdp.send('Tracing.start', {'categories':'devtools.timeline,blink.user_timing',
                              'options':'record-as-much-as-possible', 'transferMode':'ReportEvents'})
    page.evaluate("window.__heroPerf={frames:[],phases:[],tasks:[]};window.__heroRecord=true;performance.mark('hero-probe:start')")
    return chunks, collected


def stop_trace(page, cdp, trace, name):
    chunks, collected = trace
    log = page.evaluate("performance.mark('hero-probe:end');window.__heroRecord=false;window.__heroPerf")
    ended = []
    completed = lambda _: ended.append(True)
    cdp.on('Tracing.tracingComplete', completed)
    cdp.send('Tracing.end')
    for _ in range(100):
        if ended:
            break
        page.wait_for_timeout(20)
    assert ended, 'Trace did not finish'
    cdp.remove_listener('Tracing.dataCollected', collected)
    cdp.remove_listener('Tracing.tracingComplete', completed)
    start = next(e['ts'] for e in chunks if e.get('name') == 'hero-probe:start')
    end = next(e['ts'] for e in chunks if e.get('name') == 'hero-probe:end')
    events = [e for e in chunks if start <= e.get('ts', 0) <= end]
    def costs_in(window):
        costs = {}
        for event in ['Layout', 'UpdateLayoutTree', 'Paint', 'PrePaint', 'FunctionCall']:
            selected = [e for e in window if e.get('name') == event and e.get('ph') == 'X']
            costs[event] = {'count':len(selected), 'ms':round(sum(e.get('dur',0) for e in selected)/1000,2)}
        return costs
    costs = costs_in(events)
    flight_start = next((e['ts'] for e in events if e.get('name') in ['hero-phase:opening.flight','hero-phase:closing.flight']),None)
    flight_end = next((e['ts'] for e in events if e.get('name') in ['hero-phase:opening.landed','hero-phase:gallery-idle']),None)
    gaps = [b-a for a,b in zip(log['frames'], log['frames'][1:])]
    profile = name.split('-',1)[0]
    if name.endswith('-idle') and gaps:
        CADENCES[profile] = statistics.median(gaps)
    cadence = CADENCES.get(profile, 1000/60)
    result = {'case':name, 'durationMs':round((end-start)/1000), 'frameCount':len(log['frames']),
              'medianFrameMs':round(statistics.median(gaps),2) if gaps else 0,
              'p95FrameMs':quantile(gaps,.95), 'maxFrameMs':quantile(gaps,1),
              'idleFrameMs':round(cadence,2),
              'gapsOverIdleCadence':sum(x>cadence*1.5 for x in gaps), 'costs':costs,
              'longTasks':log['tasks'], 'phases':log['phases']}
    if flight_start and flight_end:
        result['flightCosts'] = costs_in([e for e in events if flight_start<=e['ts']<=flight_end])
    (OUTPUT/(name+'.trace.json')).write_text(json.dumps({'traceEvents':chunks}),encoding='utf-8')
    (OUTPUT/(name+'.json')).write_text(json.dumps({**result,'frames':log['frames']},indent=2),encoding='utf-8')
    RESULTS.append(result)
    print(json.dumps(result), flush=True)


def run(browser, name, width):
    context = browser.new_context(viewport={'width':width,'height':900}, reduced_motion='no-preference',
                                  is_mobile=width<500, has_touch=width<500)
    fixtures = Fixtures()
    fixtures.hold_uploads = False
    fixtures.hold_details = False
    context.route('**/*', fixtures)
    stored = {'picpony_dev_banner_dismissed':'true', 'trixie_use_cdn':'false',
              'picpony_use_proxy':'false', 'picpony_hk_relay':'false', 'picpony_motion':'standard',
              'picpony_motion_speed':'default', 'user_info':json.dumps(USER)}
    context.add_init_script('for(const [k,v] of Object.entries('+json.dumps(stored)+'))localStorage.setItem(k,v)')
    page = context.new_page()
    page.set_default_timeout(12000)
    errors = []
    page.on('pageerror', lambda e: errors.append(str(e)))
    cdp = context.new_cdp_session(page)
    try:
        page.goto(BASE+'/user/1', wait_until='networkidle')
        expect(page.locator('[data-tab-pane-active] '+THUMB)).to_have_count(12)
        page.evaluate(RECORDER)
        source = page.locator('[data-tab-pane-active] '+THUMB+'[data-image-hero-id="3000"]')
        source.evaluate("n=>{const s=document.querySelector('[data-image-hero-gallery-scroll]');s.scrollTop+=n.getBoundingClientRect().top-s.getBoundingClientRect().top-140;}")
        page.wait_for_timeout(800)
        trace = start_trace(page, cdp)
        page.wait_for_timeout(600)
        stop_trace(page, cdp, trace, f'{name}-idle')
        # One cold run and three warm runs, each with open and return as separate windows.
        for iteration in range(0 if PULL_ONLY else 4):
            trace = start_trace(page, cdp)
            source.locator('..').evaluate('(n)=>n.click()')
            page.wait_for_function("document.documentElement.dataset.imageHeroState==='detail-idle'",polling='raf')
            stop_trace(page, cdp, trace, f'{name}-open-{iteration}')
            page.wait_for_timeout(350)
            trace = start_trace(page, cdp)
            page.keyboard.press('Escape')
            page.wait_for_function("document.documentElement.dataset.imageHeroState==='gallery-idle'",polling='raf')
            stop_trace(page, cdp, trace, f'{name}-return-{iteration}')
            page.wait_for_timeout(350)
        source.locator('..').evaluate('(n)=>n.click()')
        expect(page.locator('html')).to_have_attribute('data-image-hero-state','detail-idle')
        page.wait_for_timeout(500)
        route = page.locator('[data-image-hero-surface-id] .image-detail-overlay-scroll')
        route.evaluate('n=>n.scrollTop=0')
        box = route.bounding_box()
        x = box['x'] + box['width']*.75
        y = box['y'] + 180
        trace = start_trace(page, cdp)
        # Slowly pull less than the dismiss distance, then settle. Native touch input
        # exercises the actual recognizer and its coalescing rather than direct style writes.
        cdp.send('Emulation.setTouchEmulationEnabled', {'enabled':True,'maxTouchPoints':1})
        cdp.send('Input.dispatchTouchEvent', {'type':'touchStart','touchPoints':[{'x':x,'y':y}]})
        for step in range(1,37):
            cdp.send('Input.dispatchTouchEvent', {'type':'touchMove','touchPoints':[{'x':x,'y':y+step*2}]})
            page.wait_for_timeout(8)
        assert page.locator('[data-image-hero-pulling]').count()>0, 'No native pull started'
        cdp.send('Input.dispatchTouchEvent', {'type':'touchEnd','touchPoints':[]})
        page.wait_for_function("!document.querySelector('[data-image-hero-pulling]')")
        stop_trace(page, cdp, trace, f'{name}-pull')
        assert not errors, errors
        page.screenshot(path=str(OUTPUT/(name+'-detail.png')))
        page.keyboard.press('Escape')
        expect(page.locator('html')).to_have_attribute('data-image-hero-state','gallery-idle')
    finally:
        cdp.detach()
        context.close()


with sync_playwright() as playwright:
    browser = playwright.chromium.launch(channel='msedge', headless=True)
    for profile in [('desktop',1440),('mobile',390)]:
        run(browser,*profile)
    browser.close()
(OUTPUT/'results.json').write_text(json.dumps(RESULTS,indent=2),encoding='utf-8')
print(f'Hero performance report: {OUTPUT / "results.json"}',flush=True)
