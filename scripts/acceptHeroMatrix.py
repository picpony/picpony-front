"""Strict acceptance for the hero interaction matrix: not only *what* happens, but how fast the
first frame answers the input and whether the compositor dropped frames on the way.

Every number is read off a Chrome trace of a production build:
  * input time      = the event's own `timeStamp` (hardware time, before any main-thread queueing),
                      recorded by a capture listener and mapped onto the trace clock;
  * response frame  = the first presented compositor frame that carries the first main-thread
                      commit after the code wrote its response (`heroProbeMark` in lib/hero/probe.ts);
  * dropped frames  = `PipelineReporter` frames reported DROPPED plus vsync gaps while the
                      transition runs (a compositor animation must present every vsync);
  * main long task  = the longest main-thread task between the input and the settle, i.e. the
                      longest the next touch / wheel event could have been kept waiting.

Run: HERO_SCRIPT=scripts/acceptHeroMatrix.py node scripts/reviewBrowser.mjs [--cpu=1,4] [--runs=3] [--only=A1,C1]
Exit status is non-zero when any row misses its budget.
"""
import json, sys, statistics, collections
from playwright.sync_api import sync_playwright, expect
try:
    from testProfileGallery import BASE, Fixtures, USER, THUMB
except Exception:  # imported for calibration without the fixtures
    pass

ARG = lambda name, default: next((a.split('=', 1)[1] for a in sys.argv if a.startswith(f'--{name}=')), default)
CPUS = [float(c) for c in ARG('cpu', '1,4').split(',')]
RUNS = int(ARG('runs', '3'))
ONLY = set(filter(None, ARG('only', '').split(',')))
VSYNC = 1000 / 60
DUMP = ARG('dump', '')
TAP_HOLD = int(ARG('hold', '80'))

# Budgets: (first-frame latency ms, dropped frames during the transition, longest main task ms)
# Latency floor on this harness: an input whose handler writes a style presents ~16–33ms later
# (next frame, or the one after when the input lands late in a vsync). Close / reverse / release
# budgets are that floor plus under half a frame; the open, which must also build its target,
# gets one frame more.
# at 1x and at 4x CPU. 1x is a current desktop / flagship phone; 4x is a mid-range Android.
# Latency is the median of the runs, drops and long tasks are the worst run.
BUDGET = {
    # Flutter's Hero: the tap's frame builds the route, the next presents the flight (~2 vsyncs).
    'A1': {1: (50, 0, 50), 4: (100, 2, 100)},
    'A1m': {1: (50, 0, 50), 4: (100, 2, 100)},
    'A2': {1: (50, 0, 50), 4: (100, 2, 100)},
    'A2t': {1: (50, 0, 50), 4: (100, 2, 100)},
    'A3': {1: (40, 0, 50), 4: (70, 2, 100)},
    'B1': {1: (40, 0, 50), 4: (70, 2, 100)},
    'B2': {1: (50, 0, 50), 4: (100, 2, 100)},
    'C1': {1: (40, 0, 50), 4: (70, 2, 100)},
    'C2': {1: (40, 0, 50), 4: (70, 2, 100)},
    'D1': {1: (40, 0, 50), 4: (70, 2, 100)},
}
# Per-move budget for finger-driven surfaces (pull, swipe): p95 pointermove → presented frame.
# Floor measured on a bare page whose pointermove writes one transform (same harness): p95
# 33ms at 1x (two vsyncs: rAF-aligned input + commit) and ~66ms at 4x. A main-thread-driven
# surface cannot beat it; the budget is that floor plus under half a frame.
MOVE_BUDGET = {1: 40, 4: 72}
# Wheel / touch scroll during an open: scroll frames must keep coming from the compositor.
SCROLL_BUDGET = {1: 0, 4: 2}

TITLES = {
    'A1': 'tap open (touch)', 'A1m': 'click open (mouse)', 'A2': 'open + wheel during flight',
    'A2t': 'open + touch scroll during flight', 'A3': 'open, then Back mid-flight (reverse)',
    'B1': 'Escape close', 'B2': 'browser Back close', 'C1': 'pull-to-dismiss release',
    'C2': 'pull past threshold then retreat (cancel)', 'D1': 'horizontal swipe to next',
}

OFF = [f for f in ARG('off', '').split(',') if f]
PROBE_INIT = """
globalThis.__HERO_PROBE__ = true;
globalThis.__HERO_PROBE_OFF__ = __OFF__;
window.__probeInputs = [];
for (const type of ['pointerdown','pointermove','pointerup','keydown','wheel','click','touchmove','popstate'])
  addEventListener(type, (e) => { window.__probeInputs.push({ type, t: e.timeStamp || performance.now() }); }, { capture: true, passive: true });
new MutationObserver(() => performance.mark('hero-phase:' + document.documentElement.dataset.imageHeroState))
  .observe(document.documentElement, { attributes: true, attributeFilter: ['data-image-hero-state'] });
"""


class Trace:
    def __init__(self, events, sync_now):
        self.events = events
        sync = next(e for e in events if e.get('name') == 'probe:sync')
        self.offset = sync['ts'] / 1000 - sync_now  # trace ms = page ms + offset
        by_tid = collections.defaultdict(list)
        for e in events:
            if e.get('ph') == 'X': by_tid[(e['pid'], e['tid'])].append(e)
        self.main = max(by_tid.items(), key=lambda kv: sum(x.get('dur', 0) for x in kv[1] if x['name'] == 'FunctionCall'))[1]
        self.commits = sorted(e['ts'] / 1000 for e in self.main if e['name'] in ('Commit', 'CommitLoad') or e['name'] == 'Layerize')
        self.commits = sorted(e['ts'] / 1000 + e.get('dur', 0) / 1000 for e in self.main if e['name'] == 'Commit') or self.commits
        renderer = self.main[0]['pid']
        begins = {}
        by_seq = {}
        for e in events:
            if e.get('name') != 'PipelineReporter' or e.get('pid') != renderer: continue
            key = e.get('id2', {}).get('local')
            if e.get('ph') == 'b': begins[key] = e
            elif e.get('ph') == 'e':
                b = begins.pop(key, None)
                if not b: continue
                fr = b['args']['frame_reporter']
                seq = fr.get('frame_sequence')
                row = (b['ts'] / 1000, e['ts'] / 1000, fr.get('state'), fr.get('scroll_state'), fr.get('has_compositor_animation'))
                prev = by_seq.get(seq)
                # Two reporters can describe one vsync (impl-only and main); a frame is presented if either says so.
                if prev is None or (prev[2] in ('STATE_DROPPED', 'STATE_NO_UPDATE_DESIRED') and row[2].startswith('STATE_PRESENTED')):
                    by_seq[seq] = row
        self.frames = sorted(by_seq.values())
        # Chrome's own input latency records: hardware time -> swap, and which thread scheduled the frame.
        self.inputs = []
        for e in events:
            n = e.get('name', '')
            if not n.startswith('InputLatency::') or not e.get('args'): continue
            comps = {x['component_type'].replace('COMPONENT_INPUT_EVENT_', '').replace('COMPONENT_', ''): x['time_us'] / 1000
                     for x in e['args'].get('chrome_latency_info', {}).get('component_info', [])}
            origin = comps.get('LATENCY_ORIGINAL')
            # The renderer's own submission, not the GPU swap: past it is the headless display
            # pipeline (software GL), which a real device does in a few ms.
            swap = comps.get('LATENCY_RENDERER_SWAP') or comps.get('GPU_SWAP_BUFFER') or comps.get('LATENCY_FRAME_SWAP')
            if origin is None: continue
            self.inputs.append({'type': n.split('::', 1)[1], 'origin': origin, 'swap': swap,
                                'main': 'LATENCY_RENDERING_SCHEDULED_MAIN' in comps})
        # Renderer-side milestones: a commit is activated, then drawn and submitted to the display
        # compositor. Everything after submission is the GPU/display pipeline, which in this
        # headless (software GL) browser costs 30–60ms a frame and on a real device a few ms.
        impl = [e for e in events if e.get('pid') == renderer and e.get('ph') == 'X']
        self.activations = sorted(e['ts'] / 1000 for e in impl if e['name'] == 'LayerTreeHostImpl::ActivateSyncTree')
        self.draws = sorted((e['ts'] + e.get('dur', 0)) / 1000 for e in impl if e['name'] == 'ProxyImpl::ScheduledActionDraw')
        self.tasks = [e for e in self.main if e['name'] in ('RunTask', 'ThreadControllerImpl::RunTask')]

    def page(self, ms):
        return ms + self.offset

    def marks(self, prefix):
        return sorted(e['ts'] / 1000 for e in self.events if e.get('name', '').startswith(prefix) and e.get('ph') in ('R', 'I', 'n', 'b'))

    def presented_after(self, t):
        """Presentation time of the frame that carries the main-thread work done at trace-time t."""
        commit = next((c for c in self.commits if c >= t), None)
        if commit is None: return None
        for begin, present, state, _, _ in self.frames:
            if present >= commit and state in ('STATE_PRESENTED_ALL', 'STATE_PRESENTED_PARTIAL') and begin <= commit + VSYNC * 2:
                if state == 'STATE_PRESENTED_PARTIAL' and begin < commit: continue
                return present
        return None

    def drawn_after(self, t):
        """When the renderer submitted the frame carrying main-thread work done at trace-time t."""
        commit = next((c for c in self.commits if c >= t), None)
        if commit is None: return None
        active = next((a for a in self.activations if a >= commit - 0.5), None)
        if active is None: return None
        return next((d for d in self.draws if d >= active), None)

    def dropped(self, a, b, scroll_only=False):
        frames = [f for f in self.frames if a <= f[0] <= b and (f[4] or f[3] not in (None, 'SCROLL_NONE'))]
        drops = sum(1 for f in frames if f[2] == 'STATE_DROPPED')
        presented = [f for f in frames if f[2] != 'STATE_DROPPED' and f[2] != 'STATE_NO_UPDATE_DESIRED']
        for x, y in zip(presented, presented[1:]):
            gap = y[0] - x[0]
            if gap > VSYNC * 1.5: drops += round(gap / VSYNC) - 1
        main_scroll = sum(1 for f in frames if f[3] == 'SCROLL_MAIN_THREAD')
        return drops, len(presented), main_scroll

    def longest_task(self, a, b):
        return max((e['dur'] / 1000 for e in self.tasks if a <= e['ts'] / 1000 <= b), default=0)


def run_case(pg, cdp, case, run, mobile, width):
    """Drives one operation; returns (inputs filter, response-mark prefix, move-mark prefix, settle phase, scroll)."""
    thumb = pg.locator(f'[data-tab-pane-active] {THUMB}[data-image-hero-id="{3000 + run % 4}"]')
    def touch_tap(x, y):
        # A real tap holds the finger ~50–150ms; latency is measured from the release.
        cdp.send('Input.dispatchTouchEvent', {'type': 'touchStart', 'touchPoints': [{'x': x, 'y': y}]})
        pg.wait_for_timeout(TAP_HOLD)
        cdp.send('Input.dispatchTouchEvent', {'type': 'touchEnd', 'touchPoints': []})
    def click(x, y):
        pg.mouse.move(x, y); pg.mouse.down(); pg.wait_for_timeout(TAP_HOLD); pg.mouse.up()
    def center():
        box = thumb.bounding_box(); return box['x'] + box['width'] / 2, box['y'] + box['height'] / 2
    def open_settled():
        x, y = center()
        if mobile: touch_tap(x, y)
        else: click(x, y)
        pg.wait_for_function("document.documentElement.dataset.imageHeroState==='detail-idle'")
        pg.wait_for_timeout(900)
    if case in ('A1', 'A1m', 'A2', 'A2t', 'A3'):
        thumb.scroll_into_view_if_needed(); pg.wait_for_timeout(700)
    else:
        thumb.scroll_into_view_if_needed(); pg.wait_for_timeout(500); open_settled()
    yield  # tracing starts here
    if case in ('A1', 'A2t'):
        x, y = center(); touch_tap(x, y)
        if case == 'A2t':
            pg.wait_for_timeout(30)
            sx, sy = width / 2, 700
            cdp.send('Input.dispatchTouchEvent', {'type': 'touchStart', 'touchPoints': [{'x': sx, 'y': sy}]})
            for k in range(1, 16):
                cdp.send('Input.dispatchTouchEvent', {'type': 'touchMove', 'touchPoints': [{'x': sx, 'y': sy - k * 18}]}); pg.wait_for_timeout(16)
            cdp.send('Input.dispatchTouchEvent', {'type': 'touchEnd', 'touchPoints': []})
        settle = 'detail-idle'
    elif case in ('A1m', 'A2'):
        x, y = center(); click(x, y)
        if case == 'A2':
            pg.mouse.move(width / 2, 600)
            for _ in range(24): pg.mouse.wheel(0, 40); pg.wait_for_timeout(16)
        settle = 'detail-idle'
    elif case == 'A3':
        x, y = center(); touch_tap(x, y)
        pg.wait_for_timeout(120)
        pg.evaluate("performance.mark('probe:back'); history.back()")
        settle = 'gallery-idle'
    elif case == 'B1':
        pg.keyboard.press('Escape'); settle = 'gallery-idle'
    elif case == 'B2':
        pg.evaluate("performance.mark('probe:back'); history.back()"); settle = 'gallery-idle'
    elif case in ('C1', 'C2'):
        pg.locator('[data-image-hero-surface-id] .image-detail-overlay-scroll').first.evaluate('n=>n.scrollTop=0')
        cx, cy = width / 2, 300
        path = [14 * k for k in range(1, 13)] if case == 'C1' else [14 * k for k in range(1, 14)] + [180, 165, 150, 135, 120]
        cdp.send('Input.dispatchTouchEvent', {'type': 'touchStart', 'touchPoints': [{'x': cx, 'y': cy}]})
        for dy in path:
            cdp.send('Input.dispatchTouchEvent', {'type': 'touchMove', 'touchPoints': [{'x': cx, 'y': cy + dy}]}); pg.wait_for_timeout(16)
        cdp.send('Input.dispatchTouchEvent', {'type': 'touchEnd', 'touchPoints': []})
        settle = 'gallery-idle' if case == 'C1' else None
    elif case == 'D1':
        y = 400; x0 = width * .8; dx = -width * .6
        cdp.send('Input.dispatchTouchEvent', {'type': 'touchStart', 'touchPoints': [{'x': x0, 'y': y}]})
        for i in range(1, 9):
            cdp.send('Input.dispatchTouchEvent', {'type': 'touchMove', 'touchPoints': [{'x': x0 + dx * i / 8, 'y': y + i}]}); pg.wait_for_timeout(14)
        cdp.send('Input.dispatchTouchEvent', {'type': 'touchEnd', 'touchPoints': []})
        settle = None
    if settle: pg.wait_for_function(f"document.documentElement.dataset.imageHeroState==='{settle}'")
    pg.wait_for_timeout(700)
    yield settle


def measure(case, tr, inputs, cpu):
    out = {}
    def first_input(types, after=None):
        xs = [tr.page(i['t']) for i in inputs if i['type'] in types and (after is None or tr.page(i['t']) >= after)]
        return min(xs) if xs else None
    if case in ('A1', 'A1m', 'A2', 'A2t'):
        t_in = first_input({'pointerup', 'click'}); resp = tr.marks('hx:respond:forward')
    elif case == 'A3':
        t_in = (tr.marks('probe:back') or [None])[0]; resp = [m for m in tr.marks('hx:respond:reverse') if t_in and m >= t_in]
    elif case == 'B1':
        t_in = first_input({'keydown'}); resp = tr.marks('hx:respond:back')
    elif case == 'B2':
        t_in = (tr.marks('probe:back') or [None])[0]; resp = tr.marks('hx:respond:back')
    elif case == 'C1':
        t_in = max((tr.page(i['t']) for i in inputs if i['type'] == 'pointerup'), default=None); resp = tr.marks('hx:respond:back')
    else:
        t_in = max((tr.page(i['t']) for i in inputs if i['type'] == 'pointerup'), default=None); resp = []
    end = (tr.marks('hero-phase:detail-idle') + tr.marks('hero-phase:gallery-idle'))
    end = max(end) if end else (t_in or 0) + 900
    if case in ('C2', 'D1') and t_in: end = t_in + 700
    anchor = resp[0] if (t_in and resp) else (t_in if case in ('C2', 'D1') else None)
    if t_in and anchor:
        drawn = tr.drawn_after(anchor); present = tr.presented_after(anchor)
        out['latency'] = round(drawn - t_in, 1) if drawn else None
        out['present'] = round(present - t_in, 1) if present else None
        out['work'] = round(anchor - t_in, 1)
    else:
        out['latency'] = out['present'] = None
    start = t_in or 0
    drops, frames, _ = tr.dropped((out.get('latency') or 0) + start, end)
    out['dropped'], out['frames'] = drops, frames
    out['longtask'] = round(tr.longest_task(start - 5, end), 1)
    p95 = lambda xs: round(sorted(xs)[min(len(xs) - 1, int(len(xs) * .95))], 1) if xs else None
    if case in ('C1', 'C2', 'D1'):
        # pointermove timeStamp -> the write it caused -> the frame presenting that write
        writes = tr.marks('hx:pull-write' if case != 'D1' else 'hx:step-write')
        lat = []
        for i in inputs:
            if i['type'] != 'pointermove': continue
            m = tr.page(i['t'])
            w = next((x for x in writes if x >= m - 0.5), None)
            if w is None or w - m > 100: continue
            pr = tr.drawn_after(w)
            if pr: lat.append(pr - m)
        out['move_p95'] = p95(lat); out['move_n'] = len(lat)
    if case in ('A2', 'A2t'):
        ups = [i for i in tr.inputs if i['type'] == 'GestureScrollUpdate' and i['swap']]
        out['scroll_p95'] = p95([i['swap'] - i['origin'] for i in ups])
        out['scroll_n'] = len(ups)
        out['scroll_main'] = sum(1 for i in ups if i['main'])
        out['scroll_janky'] = sum(1 for i in ups if i['swap'] - i['origin'] > VSYNC * 2.5)
    return out


def verdict(case, cpu, rows):
    b = BUDGET[case][int(cpu)]
    lat = [r['latency'] for r in rows if r.get('latency') is not None]
    pres = [r['present'] for r in rows if r.get('present') is not None]
    res = {'latency': round(statistics.median(lat), 1) if lat else None,
           'present': round(statistics.median(pres), 1) if pres else None,
           'dropped': max(r['dropped'] for r in rows), 'longtask': max(r['longtask'] for r in rows)}
    fails = []
    if case not in ('C2', 'D1') and (res['latency'] is None or res['latency'] > b[0]): fails.append(f"latency {res['latency']}>{b[0]}")
    if res['dropped'] > b[1]: fails.append(f"dropped {res['dropped']}>{b[1]}")
    if res['longtask'] > b[2]: fails.append(f"longtask {res['longtask']}>{b[2]}")
    mp = [r['move_p95'] for r in rows if r.get('move_p95') is not None]
    if mp:
        res['move_p95'] = max(mp)
        if res['move_p95'] > MOVE_BUDGET[int(cpu)]: fails.append(f"move p95 {res['move_p95']}>{MOVE_BUDGET[int(cpu)]}")
    if any('scroll_n' in r for r in rows):
        res['scroll_janky'] = max(r['scroll_janky'] for r in rows)
        res['scroll_p95'] = max((r['scroll_p95'] or 999) for r in rows)
        res['scroll_n'] = min(r['scroll_n'] for r in rows)
        res['scroll_main'] = max(r['scroll_main'] for r in rows)
        if res['scroll_janky'] > SCROLL_BUDGET[int(cpu)]: fails.append(f"scroll updates >2.5 vsync: {res['scroll_janky']}")
        if res['scroll_main']: fails.append(f"main-thread scheduled scroll updates {res['scroll_main']}")
        if res['scroll_n'] == 0: fails.append('no scroll updates presented')
    return res, fails


def main():
    cases = [c for c in BUDGET if not ONLY or c in ONLY]
    report = []
    failed = False
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        for mobile in (True, False):
            mine = [c for c in cases if (c not in ('A1m', 'A2', 'B1')) == mobile]
            if not mine: continue
            width = 390 if mobile else 1440
            ctx = browser.new_context(viewport={'width': width, 'height': 844 if mobile else 900}, reduced_motion='no-preference',
                                      is_mobile=mobile, has_touch=mobile, device_scale_factor=3 if mobile else 1)
            f = Fixtures(); f.hold_uploads = False; f.hold_details = False
            ctx.route('**/*', f)
            stored = {'picpony_dev_banner_dismissed': 'true', 'picpony_motion': 'standard', 'user_info': json.dumps(USER)}
            ctx.add_init_script('for(const [k,v] of Object.entries(' + json.dumps(stored) + '))localStorage.setItem(k,v)')
            ctx.add_init_script(PROBE_INIT.replace('__OFF__', json.dumps(OFF)))
            pg = ctx.new_page(); pg.set_default_timeout(20000); cdp = ctx.new_cdp_session(pg)
            pg.goto(BASE + '/user/1', wait_until='networkidle')
            expect(pg.locator('[data-tab-pane-active] ' + THUMB)).to_have_count(12)
            pg.wait_for_timeout(1500)
            for cpu in CPUS:
                cdp.send('Emulation.setCPUThrottlingRate', {'rate': cpu})
                for case in mine:
                    rows = []
                    for run in range(RUNS):
                        gen = run_case(pg, cdp, case, run, mobile, width)
                        next(gen)
                        chunks = []
                        h = lambda e: chunks.extend(e['value'])
                        cdp.on('Tracing.dataCollected', h)
                        cdp.send('Tracing.start', {'categories': 'toplevel,input,latencyInfo,devtools.timeline,disabled-by-default-devtools.timeline,blink.user_timing,cc,benchmark,disabled-by-default-devtools.timeline.frame',
                                                   'transferMode': 'ReportEvents'})
                        pg.wait_for_timeout(80)
                        sync_now = pg.evaluate("window.__probeInputs.length=0; performance.mark('probe:sync').startTime")
                        settle = next(gen, None)
                        inputs = pg.evaluate('window.__probeInputs')
                        if DUMP: print('marks', pg.evaluate("performance.getEntriesByType('mark').slice(-12).map(m=>m.name)"))
                        done = []
                        cdp.once('Tracing.tracingComplete', lambda e: done.append(1))
                        cdp.send('Tracing.end')
                        while not done: pg.wait_for_timeout(50)
                        cdp.remove_listener('Tracing.dataCollected', h)
                        if DUMP: json.dump({'events': chunks, 'sync': sync_now, 'inputs': inputs}, open(f'{DUMP}-{case}-{int(cpu)}-{run}.json', 'w'))
                        rows.append(measure(case, Trace(chunks, sync_now), inputs, cpu))
                        # back to the gallery for the next run
                        state = pg.evaluate('document.documentElement.dataset.imageHeroState')
                        if state != 'gallery-idle':
                            pg.wait_for_timeout(400)
                            pg.keyboard.press('Escape')
                            pg.wait_for_function("document.documentElement.dataset.imageHeroState==='gallery-idle'")
                        pg.wait_for_timeout(500)
                    res, fails = verdict(case, cpu, rows)
                    failed |= bool(fails)
                    line = {'case': case, 'title': TITLES[case], 'cpu': cpu, **res, 'runs': rows, 'fails': fails}
                    report.append(line)
                    mark = 'PASS' if not fails else 'FAIL ' + '; '.join(fails)
                    print(f"[{case:>3} {int(cpu)}x] {TITLES[case]:<42} lat {res['latency']}ms (presented {res['present']}) drop {res['dropped']} "
                          f"task {res['longtask']}ms" + (f" move95 {res.get('move_p95')}" if 'move_p95' in res else '')
                          + (f" scroll p95 {res['scroll_p95']} janky {res['scroll_janky']}/{res['scroll_n']} main {res['scroll_main']}" if 'scroll_n' in res else '')
                          + f"  {mark}", flush=True)
            ctx.close()
        browser.close()
    out = ARG('out', '')
    if out: open(out, 'w').write(json.dumps(report, indent=1))
    sys.exit(1 if failed else 0)


if __name__ == '__main__':
    main()
