"""Where the main thread goes during an open/close: every task over 40ms, broken into its children.
Run: HERO_SCRIPT=scripts/probeHeroCost.py node scripts/reviewBrowser.mjs  [--cpu=4] [--mobile] [--scroll]"""
import json, sys, collections
from playwright.sync_api import sync_playwright, expect
from testProfileGallery import BASE, Fixtures, USER, THUMB

CPU = next((float(a.split('=', 1)[1]) for a in sys.argv if a.startswith('--cpu=')), 4)
MOBILE = '--mobile' in sys.argv
SCROLL = '--scroll' in sys.argv
CLOSE = '--close' in sys.argv or '--pull' in sys.argv
PULL = '--pull' in sys.argv

def analyse(events, label):
    by_tid = collections.defaultdict(list)
    for e in events:
        if e.get('ph') == 'X': by_tid[(e['pid'], e['tid'])].append(e)
    main = max(by_tid.items(), key=lambda kv: sum(x.get('dur', 0) for x in kv[1] if x['name'] == 'FunctionCall'))[1]
    main.sort(key=lambda e: e['ts'])
    t0 = next(e['ts'] for e in events if e.get('name') == 'probe:press')
    tasks = [e for e in main if e['name'] in ('RunTask', 'ThreadControllerImpl::RunTask') and e.get('dur', 0) > 40000]
    print(label, 'tasks>40ms:', len(tasks))
    for t in tasks:
        kids = [e for e in main if t['ts'] < e['ts'] < t['ts'] + t['dur'] and e is not t]
        agg = collections.Counter()
        fn = collections.Counter()
        for k in kids:
            if k['name'] in ('FunctionCall', 'UpdateLayoutTree', 'Layout', 'Paint', 'PrePaint', 'Commit', 'TimerFire',
                             'FireAnimationFrame', 'EventDispatch', 'MajorGC', 'MinorGC', 'V8.GC_SCAVENGER', 'ParseHTML',
                             'Decode Image', 'HitTest', 'IntersectionObserverController::computeIntersections',
                             'Document::updateStyle', 'v8.compile', 'v8.parseOnBackground', 'EvaluateScript', 'v8.run',
                             'RunMicrotasks', 'Layerize', 'UpdateLayer', 'ScrollLayer', 'PaintImage', 'Animation'):
                agg[k['name']] += k.get('dur', 0)
            if k['name'] == 'FunctionCall':
                d = k.get('args', {}).get('data', {})
                fn[(d.get('functionName') or '?') + '@' + (d.get('url') or '').split('/')[-1][:24]] += k.get('dur', 0)
            if k['name'] in ('EventDispatch', 'TimerFire'):
                d = k.get('args', {}).get('data', {})
                fn['#' + k['name'] + ':' + str(d.get('type') or d.get('timerId'))] += k.get('dur', 0)
        print(f"  at {round((t['ts']-t0)/1000)}ms dur {round(t['dur']/1000)}ms ::",
              ', '.join(f'{n} {round(v/1000,1)}' for n, v in agg.most_common(8)))
        print('     ', ', '.join(f'{n} {round(v/1000,1)}' for n, v in fn.most_common(5)))
    seen=set(); marks=[]
    for e in sorted(events, key=lambda e:e.get('ts',0)):
        n=e.get('name','')
        if (n.startswith('hero-phase:') or n.startswith('hx:') or n.startswith('probe:')) and e.get('ph') in ('R','I','n','b','e') or ((n.startswith('hx:') or n.startswith('probe:')) and n not in seen):
            if (n,e['ts']) in seen: continue
            seen.add((n,e['ts'])); marks.append((n, round((e['ts']-t0)/1000)))
    print('  phases', marks)
    win = sys.argv and next((a.split('=',1)[1] for a in sys.argv if a.startswith('--window=')), None)
    if win:
        a, b = win.split(',')
        ta = next((e['ts'] for e in events if e.get('name') == a), None); tb = next((e['ts'] for e in events if e.get('name') == b), None)
        if ta and tb:
            for e in main:
                if ta <= e['ts'] <= tb and e.get('dur', 0) > 1500:
                    d = e.get('args', {}).get('data', {}) or {}
                    print('    ', round((e['ts']-ta)/1000,1), e['name'], round(e['dur']/1000,1), json.dumps({k:v for k,v in (e.get('args') or {}).items() if k!='beginData'})[:400], d.get('functionName',''), d.get('elementCount',''), (d.get('stackTrace') or [{}])[0].get('functionName','') if isinstance(d.get('stackTrace'), list) else '')

with sync_playwright() as p:
    b = p.chromium.launch(headless=True)
    width = 390 if MOBILE else 1440
    c = b.new_context(viewport={'width': width, 'height': 844 if MOBILE else 900}, reduced_motion='no-preference',
                      is_mobile=MOBILE, has_touch=MOBILE, device_scale_factor=3 if MOBILE else 1)
    f = Fixtures(); f.hold_uploads = False; f.hold_details = False
    c.route('**/*', f)
    stored = {'picpony_dev_banner_dismissed': 'true', 'picpony_motion': 'standard', 'user_info': json.dumps(USER)}
    c.add_init_script('for(const [k,v] of Object.entries(' + json.dumps(stored) + '))localStorage.setItem(k,v)')
    c.add_init_script('globalThis.__HERO_PROBE__=true')
    c.add_init_script("""new MutationObserver(()=>performance.mark('hero-phase:'+document.documentElement.dataset.imageHeroState))
      .observe(document.documentElement,{attributes:true,attributeFilter:['data-image-hero-state']})""")
    pg = c.new_page(); pg.set_default_timeout(20000); cdp = c.new_cdp_session(pg)
    pg.goto(BASE + '/user/1', wait_until='networkidle')
    expect(pg.locator('[data-tab-pane-active] ' + THUMB)).to_have_count(12)
    pg.wait_for_timeout(1500)
    cdp.send('Emulation.setCPUThrottlingRate', {'rate': CPU})
    for run in range(3):
        th = pg.locator(f'[data-tab-pane-active] {THUMB}[data-image-hero-id="{3000+run}"]')
        th.scroll_into_view_if_needed(); pg.wait_for_timeout(800)
        box = th.bounding_box(); x, y = box['x'] + box['width']/2, box['y'] + box['height']/2
        def press():
            if MOBILE:
                cdp.send('Input.dispatchTouchEvent', {'type': 'touchStart', 'touchPoints': [{'x': x, 'y': y}]})
                cdp.send('Input.dispatchTouchEvent', {'type': 'touchEnd', 'touchPoints': []})
            else:
                pg.mouse.move(x, y); pg.mouse.down(); pg.mouse.up()
        if CLOSE:
            press(); pg.wait_for_function("document.documentElement.dataset.imageHeroState==='detail-idle'"); pg.wait_for_timeout(900)
        chunks = []
        h = lambda e: chunks.extend(e['value'])
        cdp.on('Tracing.dataCollected', h)
        cdp.send('Tracing.start', {'categories': 'devtools.timeline,blink.user_timing,v8,disabled-by-default-devtools.timeline.stack', 'transferMode': 'ReportEvents'})
        pg.wait_for_timeout(100)
        pg.evaluate("performance.mark('probe:press')")
        if CLOSE:
            if PULL:
                cx = width/2; cy = 300
                cdp.send('Input.dispatchTouchEvent', {'type': 'touchStart', 'touchPoints': [{'x': cx, 'y': cy}]})
                for k in range(1, 13):
                    cdp.send('Input.dispatchTouchEvent', {'type': 'touchMove', 'touchPoints': [{'x': cx, 'y': cy + k*14}]}); pg.wait_for_timeout(16)
                pg.evaluate("performance.mark('probe:release')")
                cdp.send('Input.dispatchTouchEvent', {'type': 'touchEnd', 'touchPoints': []})
            else:
                pg.keyboard.press('Escape')
            pg.wait_for_function("document.documentElement.dataset.imageHeroState==='gallery-idle'")
        else:
            press()
            if SCROLL:
                pg.mouse.move(width/2, 600)
                for k in range(24): pg.mouse.wheel(0, 40); pg.wait_for_timeout(16)
            pg.wait_for_function("document.documentElement.dataset.imageHeroState==='detail-idle'")
        pg.wait_for_timeout(500)
        done = []
        cdp.once('Tracing.tracingComplete', lambda e: done.append(1))
        cdp.send('Tracing.end')
        while not done: pg.wait_for_timeout(50)
        cdp.remove_listener('Tracing.dataCollected', h)
        analyse(chunks, f'run{run}')
        if not CLOSE:
            pg.keyboard.press('Escape')
            pg.wait_for_function("document.documentElement.dataset.imageHeroState==='gallery-idle'")
        pg.wait_for_timeout(600)
    b.close()
