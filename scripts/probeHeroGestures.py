"""Gestures during an open, sampled every frame on a touch phone.

  pull-<ms>   : a downward pull started <ms> after the tap (the open still running), released past
                the dismiss distance — the picture must keep moving, never hold then snap.
  pullback-<ms>: the same pull released short of it — it must settle back without a jump.
  fling-<ms>  : an upward fling started <ms> after the tap — the picture must move with the finger,
                through the handoff, with no backward jump and no stall.
  retarget    : a second card tapped while the first is still opening — it must launch at once.
  retarget-reverse / retarget-same : the first open is turned back (Escape) and, mid-reverse, another
                card / the same card is tapped — it must launch at once, not after the reverse.

Each case prints the largest per-frame jump of the picture, the longest stretch it held still
while a transition was running, and the phases it went through.

Run: npm run build && npm run perf:hero-gestures   (add --cpu=4 to throttle)
Flags: --only=<case prefix>  --trace (compositor frames per phase)  --profile (CPU profile)
       --film=<dir> (screencast + trace)  --dump  --marks  --click (synthetic click, not touch)
"""
import json
import sys

from playwright.sync_api import sync_playwright, expect
from testProfileGallery import BASE, Fixtures, USER, THUMB

# --profile writes <case>.cpuprofile here (HERO_PROBE_PROFILE_DIR, default: the working directory).
PROFILE_DIR = __import__('os').environ.get('HERO_PROBE_PROFILE_DIR', '.')
CPU = int(next((a.split('=', 1)[1] for a in sys.argv if a.startswith('--cpu=')), '4'))
REPEAT = int(next((a.split('=', 1)[1] for a in sys.argv if a.startswith('--repeat=')), '1'))
FILM = next((a.split('=', 1)[1] for a in sys.argv if a.startswith('--film=')), '')
ONLY = next((a.split('=', 1)[1] for a in sys.argv if a.startswith('--only=')), '')


class SafeFixtures(Fixtures):
    def __call__(self, route):
        try:
            super().__call__(route)
        except Exception:
            try:
                route.fulfill(status=404, body='')
            except Exception:
                pass


SAMPLER = """() => {
  window.__g = []; window.__gOn = true; const t0 = performance.now(); window.__gt0 = t0;
  // One style read per node: the sampler itself was the largest main-thread cost in the
  // profiles (~60ms a frame at 4x), which inflated every hold it reported.
  const visible = (n) => { if (!n) return false; const s = getComputedStyle(n); return s.visibility !== 'hidden' && Number(s.opacity) > 0.01; };
  const detail = !!window.__gDetail;
  const tick = () => {
    if (!window.__gOn) return;
    const root = document.documentElement;
    const layer = document.querySelector('.image-hero-flight-layer[data-image-hero-role="foreground"]');
    const flyer = layer && layer.querySelector('.image-hero-flyer');
    const route = document.querySelector('[data-image-hero-surface-id]');
    const media = route && route.querySelector('[data-image-hero-role="detail"]');
    let pic = null, who = '';
    if (flyer && visible(layer) && visible(flyer)) { pic = flyer.getBoundingClientRect(); who = 'flyer'; }
    else if (media && visible(route)) { pic = media.getBoundingClientRect(); who = 'route'; }
    const stage = document.querySelector('[data-image-hero-stage-scroll]');
    const rs = route && route.querySelector('.image-detail-overlay-scroll');
    window.__g.push({t: Math.round(performance.now() - t0), phase: root.dataset.imageHeroState,
      gesture: root.dataset.imageHeroDismissGesture || '', who,
      top: pic ? Math.round(pic.top * 10) / 10 : null, h: pic ? Math.round(pic.height) : null,
      stageTop: stage ? Math.round(stage.scrollTop) : null, routeTop: rs ? Math.round(rs.scrollTop) : null,
      layers: !detail ? [] : [...document.querySelectorAll('.image-hero-flight-layer')].map((l) => {
        const f = l.querySelector('.image-hero-flyer'); const r = f && f.getBoundingClientRect();
        return [l.dataset.imageHeroRole, visible(l) && visible(f) ? 1 : 0, r ? Math.round(r.top) : null, r ? Math.round(r.height) : null,
          getComputedStyle(l).zIndex, l.parentElement && (l.parentElement.className || l.parentElement.tagName).toString().slice(0, 40)];
      }),
      thumbs: !detail ? '' : [...document.querySelectorAll('[data-tab-pane-active] [data-image-hero-id]')].filter((n) => n.tagName === 'IMG' && Number(getComputedStyle(n).opacity) < 0.5).map((n) => n.dataset.imageHeroId).join(',')});
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}"""


def analyse(name, frames, expect_end):
    moving = [f for f in frames if f['top'] is not None]
    jumps = []
    for a, b in zip(moving, moving[1:]):
        if a['who'] == b['who'] or {a['who'], b['who']} == {'flyer', 'route'}:
            jumps.append((abs(b['top'] - a['top']), b['t'], a['who'] + '>' + b['who']))
    jumps.sort(reverse=True)
    # A raw jump conflates speed with discontinuity: a fast spring sampled on a 60ms frame moves
    # 150px honestly. Predict each sample from the two before it (constant velocity over the
    # actual frame gaps) and report the worst miss on runs of the same surface; a real snap
    # misses by its full size, a smooth curve by a fraction of a frame's travel.
    misses = []
    for a, b, c in zip(moving, moving[1:], moving[2:]):
        if not (a['who'] == b['who'] == c['who']) or b['t'] == a['t']:
            continue
        predicted = b['top'] + (b['top'] - a['top']) * (c['t'] - b['t']) / (b['t'] - a['t'])
        misses.append((round(abs(c['top'] - predicted), 1), c['t'], c['who']))
    for a, b in zip(moving, moving[1:]):
        if {a['who'], b['who']} == {'flyer', 'route'}:
            misses.append((round(abs(b['top'] - a['top']), 1), b['t'], a['who'] + '>' + b['who']))
    misses.sort(reverse=True)
    # Longest hold: consecutive frames, transition running, picture unmoved, finger not down.
    hold, best, start = 0, 0, None
    for a, b in zip(moving, moving[1:]):
        running = b['phase'] not in ('gallery-idle', 'detail-idle')
        if running and abs(b['top'] - a['top']) < 0.25 and not b['gesture'] == 'dragging':
            start = a['t'] if start is None else start
            best = max(best, b['t'] - start)
        else:
            start = None
    phases = []
    for f in frames:
        if not phases or phases[-1][1] != f['phase']:
            phases.append([f['t'], f['phase']])
    print(json.dumps({'case': name, 'maxJumpPx': jumps[0][0] if jumps else 0, 'at': jumps[0][1:] if jumps else None,
                      'top3': jumps[:3], 'maxMissPx': misses[0] if misses else None, 'longestHoldMs': best, 'end': frames[-1]['phase'] if frames else None,
                      'expectEnd': expect_end, 'phases': phases}), flush=True)


def touch_path(cdp, page, x, y0, y1, steps, step_ms, release=True):
    cdp.send('Input.dispatchTouchEvent', {'type': 'touchStart', 'touchPoints': [{'x': x, 'y': y0}]})
    for i in range(1, steps + 1):
        cdp.send('Input.dispatchTouchEvent', {'type': 'touchMove', 'touchPoints': [{'x': x, 'y': y0 + (y1 - y0) * i / steps}]})
        page.wait_for_timeout(step_ms)
    if release:
        cdp.send('Input.dispatchTouchEvent', {'type': 'touchEnd', 'touchPoints': []})


def run_case(browser, name, action, expect_end):
    context = browser.new_context(viewport={'width': 390, 'height': 844}, is_mobile=True, has_touch=True,
                                  reduced_motion='no-preference')
    fixtures = SafeFixtures()
    fixtures.hold_uploads = False
    fixtures.hold_details = False
    context.route('**/*', fixtures)
    stored = {'picpony_dev_banner_dismissed': 'true', 'picpony_motion': 'standard', 'user_info': json.dumps(USER),
              'trixie_use_cdn': 'false', 'picpony_use_proxy': 'false', 'picpony_hk_relay': 'false'}
    context.add_init_script('for(const [k,v] of Object.entries(' + json.dumps(stored) + '))localStorage.setItem(k,v)')
    context.add_init_script('globalThis.__HERO_PROBE__ = true')
    if __import__('os').environ.get('HERO_PROBE_INIT'): context.add_init_script(path=__import__('os').environ['HERO_PROBE_INIT'])
    page = context.new_page()
    page.set_default_timeout(15000)
    errors = []
    page.on('pageerror', lambda e: errors.append(str(e)))
    cdp = context.new_cdp_session(page)
    CURRENT['cdp'] = cdp
    try:
        page.goto(BASE + '/user/1', wait_until='networkidle')
        expect(page.locator('[data-tab-pane-active] ' + THUMB)).to_have_count(12)
        cdp.send('Emulation.setTouchEmulationEnabled', {'enabled': True, 'maxTouchPoints': 1})
        cdp.send('Emulation.setCPUThrottlingRate', {'rate': CPU})
        page.wait_for_timeout(600)
        if '--dump' in sys.argv: page.evaluate('window.__gDetail = true')
        page.evaluate(SAMPLER)
        chunks = []
        if '--trace' in sys.argv:
            cdp.on('Tracing.dataCollected', lambda e: chunks.extend(e['value']))
            cdp.send('Tracing.start', {'categories': 'toplevel,devtools.timeline,blink.user_timing,v8.execute,disabled-by-default-devtools.timeline.invalidationTracking,disabled-by-default-devtools.timeline,benchmark,cc,disabled-by-default-devtools.timeline.frame', 'transferMode': 'ReportEvents'})
        film = []
        if FILM:
            def frame(e):
                film.append((e['metadata']['timestamp'], e['data']))
                try:
                    cdp.send('Page.screencastFrameAck', {'sessionId': e['sessionId']})
                except Exception:
                    pass
            cdp.on('Page.screencastFrame', frame)
            cdp.send('Page.startScreencast', {'format': 'jpeg', 'quality': 60, 'maxWidth': 390, 'maxHeight': 844, 'everyNthFrame': 1})
        if '--profile' in sys.argv:
            cdp.send('Profiler.enable')
            cdp.send('Profiler.setSamplingInterval', {'interval': 200})
            cdp.send('Profiler.start')
        action(page, cdp)
        try:
            page.wait_for_function(f"document.documentElement.dataset.imageHeroState==='{expect_end}'", timeout=6000)
        except Exception:
            pass
        page.wait_for_timeout(400)
        frames = page.evaluate('window.__gOn=false;window.__g')
        if '--profile' in sys.argv:
            prof = cdp.send('Profiler.stop')['profile']
            json.dump(prof, open(f'{PROFILE_DIR}/{name}.cpuprofile', 'w'))
        import os
        if FILM:
            import base64
            cdp.send('Page.stopScreencast')
            os.makedirs(FILM, exist_ok=True)
            t0 = film[0][0] if film else 0
            for ts, data in film:
                open(os.path.join(FILM, f"{name}-{int((ts - t0) * 1000):05d}.jpg"), 'wb').write(base64.b64decode(data))
            json.dump(frames, open(os.path.join(FILM, name + '.json'), 'w'))
        if chunks is not None and '--trace' in sys.argv:
            done = []
            cdp.once('Tracing.tracingComplete', lambda e: done.append(1))
            cdp.send('Tracing.end')
            while not done:
                page.wait_for_timeout(50)
            if FILM:
                json.dump(chunks, open(os.path.join(FILM, name + '.trace.json'), 'w'))
            # Presented vs dropped compositor frames while the transition runs. This is what the
            # eye sees (the flyer is a compositor animation), unlike the rAF sampler, whose reads
            # stall whenever the main thread does.
            marks = sorted((e['ts'], e['name']) for e in chunks if e.get('name', '').startswith('hero-phase:') and e.get('ts'))
            begin = next((ts for ts, n in marks if n == 'hero-phase:opening.flight'), marks[0][0] if marks else 0)
            finish = next((ts for ts, n in reversed(marks) if n.endswith('-idle')), float('inf'))
            states = {}
            for e in chunks:
                if e.get('name') != 'PipelineReporter' or e.get('ph') != 'b' or not (begin <= e.get('ts', 0) <= finish):
                    continue
                fr = e.get('args', {}).get('frame_reporter') or {}
                st = fr.get('state', '?').replace('STATE_', '')
                if st == 'NO_UPDATE_DESIRED':
                    continue
                key = st + ('*' if fr.get('affects_smoothness') else '')
                states[key] = states.get(key, 0) + 1
                if st == 'DROPPED' and fr.get('affects_smoothness'):
                    phase = next((n.split(':', 1)[1] for ts, n in reversed(marks) if ts <= e['ts']), '?')
                    states.setdefault('drops', []).append((round((e['ts'] - begin) / 1000), phase))
            print('   frames', states, flush=True)
            tasks = [e for e in chunks if e.get('ph') == 'X' and e.get('name') in ('RunTask', 'ThreadControllerImpl::RunTask') and e.get('dur', 0) > 30000]
            base = min((e['ts'] for e in chunks if e.get('ts')), default=0)
            for task in sorted(tasks, key=lambda e: e['ts']):
                inner = [e for e in chunks if e.get('ph') == 'X' and e.get('tid') == task.get('tid') and task['ts'] <= e.get('ts', 0) <= task['ts'] + task['dur'] and e.get('dur', 0) > 4000 and e.get('name') not in ('RunTask', 'ThreadControllerImpl::RunTask')]
                desc = []
                for e in sorted(inner, key=lambda e: -e['dur'])[:8]:
                    d = e.get('args', {}).get('data', {})
                    desc.append(f"{e['name']}:{d.get('functionName') or d.get('type') or d.get('url','')[-30:] or ''}:{round(e['dur']/1000)}")
                print('   task', round((task['ts'] - base) / 1000), round(task['dur'] / 1000), desc)
        analyse(name, frames, expect_end)
        if '--marks' in sys.argv:
            print('   marks', page.evaluate("()=>performance.getEntriesByType('mark').filter(m=>m.startTime>window.__gt0&&/hx:(rev|pull|respond)|hero-phase/.test(m.name)).map(m=>[m.name,Math.round(m.startTime-window.__gt0)])"))
            print('   rm', page.evaluate('()=>(globalThis.__RM__||[]).filter(r=>r[0]>window.__gt0).map(r=>[r[0]-Math.round(window.__gt0),r[1],r[2],r[3]])'))
        if '--dump' in sys.argv:
            for f in frames:
                print('   ', f['t'], f['phase'], f['gesture'], f['who'], f['top'], f['stageTop'], f['routeTop'])
        if errors:
            print('   errors', errors[:3])
        return frames
    finally:
        cdp.detach()
        context.close()


CURRENT = {}


def tap(page, image_id):
    """A real touch tap (touchstart → touchend at the card's centre), so the pointerdown arming
    path runs as it does on a phone; --click restores a synthetic click."""
    card = page.locator(f'[data-tab-pane-active] {THUMB}[data-image-hero-id="{image_id}"]').locator('..')
    if '--click' in sys.argv or 'cdp' not in CURRENT:
        card.evaluate('n=>n.click()')
        return
    box = card.evaluate('n=>{const r=n.getBoundingClientRect();return [r.left+r.width/2,r.top+r.height/2]}')
    cdp = CURRENT['cdp']
    cdp.send('Input.dispatchTouchEvent', {'type': 'touchStart', 'touchPoints': [{'x': box[0], 'y': box[1]}]})
    page.wait_for_timeout(60)
    cdp.send('Input.dispatchTouchEvent', {'type': 'touchEnd', 'touchPoints': []})


def pull(after, distance, release_ms):
    def action(page, cdp):
        tap(page, 3001)
        page.wait_for_timeout(after)
        touch_path(cdp, page, 200, 300, 300 + distance, 12, release_ms // 12)
    return action


def fling(after):
    def action(page, cdp):
        tap(page, 3001)
        page.wait_for_timeout(after)
        touch_path(cdp, page, 200, 700, 250, 10, 8)
        page.wait_for_timeout(300)
        touch_path(cdp, page, 200, 700, 400, 10, 8)
    return action


def retarget(page, cdp):
    tap(page, 3001)
    page.wait_for_timeout(120)
    tap(page, 3000)


def escape_then(image_id):
    def action(page, cdp):
        tap(page, 3001)
        page.wait_for_timeout(160)
        page.keyboard.press('Escape')
        page.wait_for_timeout(60)
        tap(page, image_id)
    return action


HIT = '''(id) => { const c = document.querySelector(`[data-tab-pane-active] [data-image-hero-id="${id}"]`).parentElement;
  const r = c.getBoundingClientRect(); const x = r.left + r.width / 2, y = r.top + r.height / 2;
  const e = document.elementFromPoint(x, y);
  return [document.documentElement.dataset.imageHeroState, e ? (e.tagName + '.' + (e.className || '').toString().slice(0, 50) + JSON.stringify(e.dataset)).slice(0, 160) : null]; }'''


def tap_log(page, cdp):
    page.evaluate('''()=>{window.__ev=[];const t0=performance.now();for(const k of ['pointerdown','pointerup','pointercancel','touchstart','touchend','click']){document.addEventListener(k,(e)=>{window.__ev.push([k,Math.round(performance.now()-t0),(e.target.className||e.target.tagName||'').toString().slice(0,30),e.defaultPrevented])},true);document.addEventListener(k,(e)=>{window.__ev.push([k+'/bubble',Math.round(performance.now()-t0),e.defaultPrevented])},false)}}''')
    tap(page, 3001)
    page.wait_for_timeout(120)
    tap(page, 3000)
    page.wait_for_timeout(900)
    for e in page.evaluate('window.__ev'):
        print('   ev', e)


def hit_probe(page, cdp):
    print('   cards', page.evaluate("()=>[...document.querySelectorAll('[data-tab-pane-active] [data-image-hero-role=thumbnail]')].slice(0,8).map(n=>{const r=n.getBoundingClientRect();return [n.dataset.imageHeroId,Math.round(r.left),Math.round(r.top)]})"))
    tap(page, 3001)
    for _ in range(4):
        page.wait_for_timeout(60)
        print('   hit-open', page.evaluate(HIT, 3000))
    page.keyboard.press('Escape')
    for _ in range(4):
        page.wait_for_timeout(50)
        print('   hit-rev', page.evaluate(HIT, 3000))


CASES = [
    ('pull-80', pull(80, 260, 180), 'gallery-idle'),
    ('pull-250', pull(250, 260, 180), 'gallery-idle'),
    ('pull-450', pull(450, 260, 180), 'gallery-idle'),
    ('pullback-150', pull(150, 40, 240), 'detail-idle'),
    ('fling-60', fling(60), 'detail-idle'),
    ('fling-250', fling(250), 'detail-idle'),
    ('fling-450', fling(450), 'detail-idle'),
    ('retarget', retarget, 'detail-idle'),
    ('retarget-reverse', escape_then(3000), 'detail-idle'),
    ('retarget-same', escape_then(3001), 'detail-idle'),
    ('zhit', hit_probe, 'gallery-idle'),
    ('ztaplog', tap_log, 'detail-idle'),
]

with sync_playwright() as playwright:
    browser = playwright.chromium.launch(headless=True)
    for name, action, end in CASES:
        if ONLY and not name.startswith(ONLY):
            continue
        for _ in range(REPEAT):
            run_case(browser, name, action, end)
    browser.close()
