"""Motion regression against the production build and local API fixtures.

Asserts what the motion system promises, per tier (standard at default/fast/slow speed, reduced,
off), on desktop and phone widths, by reading the browser rather than the source:

* the *computed* transition lists — positional lists drift when the build inserts a prefixed
  property (`-webkit-backdrop-filter` once moved `transition-ui`'s rotate onto the effects clock,
  invisible in globals.css);
* the animations that actually start (`document.getAnimations()` polled every frame) for the
  Modal, the lightbox, the docked and phone drawers, the gallery hover scrim and the reaction fill;
* the Modal's opacity and scale per frame: monotonic, never past 1;
* the reaction fill playing for a press only — not for a picture or thread that loads already
  favourited/liked, not for a walk to a favourited neighbour, not for a failed un-press putting the
  filled icon back.

Run with `npm run test:motion` (scripts/reviewBrowser.mjs starts the server and fixtures).
Expected durations are the spring tokens' base values times the tier's scale."""
import base64
import json
import pathlib
import sys
import urllib.parse
import urllib.request
from playwright.sync_api import sync_playwright

BASE, FIXTURES = sys.argv[1:3]
ROOT = pathlib.Path(__file__).resolve().parent.parent
OUTPUT = ROOT / '.workbuddy' / 'motion-regression'
OUTPUT.mkdir(parents=True, exist_ok=True)
USER = {'id': 1, 'username': 'Review Admin', 'role': 'super_admin', 'token': 'review-fixture-token',
        'api_key': 'review-fixture-key', 'email': 'review@example.test', 'email_verified': True,
        'avatar': '', 'experience': 1350, 'coins': 100}
# Base durations (ms) at scale 1 — app/globals.css `--motion-base-spring-*` and the state layer.
FAST_EFFECTS, FAST_SPATIAL, DEFAULT_EFFECTS, STATE_LAYER, REACTION = 108, 137, 166, 150, 221
TIERS = [('standard', 'default', 1.0), ('standard', 'fast', 0.7), ('standard', 'slow', 1.4),
         ('reduced', 'default', 1.0), ('off', 'default', 0.0)]
TOLERANCE_MS = 2
# A local fixture server must never go through a proxy the environment sets.
OPENER = urllib.request.build_opener(urllib.request.ProxyHandler({}))
cache = {}
failures = []
results = []


def intercepted(route):
    request = route.request
    parsed = urllib.parse.urlparse(request.url)
    if request.url.startswith(BASE) and not parsed.path.startswith(('/api/v1', '/relay', '/search-api', '/_next/image')):
        try:
            route.continue_()
        except Exception:  # the page closed mid-request
            pass
        return
    pairs = [(k, v) for k, v in urllib.parse.parse_qsl(parsed.query) if k != '_t']
    key = parsed._replace(query=urllib.parse.urlencode(pairs)).geturl()
    if key not in cache:
        try:
            with OPENER.open(FIXTURES + '/__review_fixture?url=' + urllib.parse.quote(key, safe='')) as response:
                cache[key] = json.load(response)
        except Exception:
            cache[key] = None
    data = cache[key]
    if data is None:
        route.abort()
        return
    route.fulfill(status=200, content_type=data['contentType'],
                  body=base64.b64decode(data['body']) if data.get('binary') else data['body'])


def new_context(browser, motion, speed, width=1440):
    context = browser.new_context(viewport={'width': width, 'height': 900}, reduced_motion='no-preference',
                                  is_mobile=width < 500, has_touch=width < 500)
    context.route('**/*', intercepted)
    stored = {'picpony_dev_banner_dismissed': 'true', 'trixie_use_cdn': 'false', 'picpony_use_proxy': 'false',
              'picpony_hk_relay': 'false', 'picpony_motion': motion, 'picpony_motion_speed': speed,
              'picpony_entrance_motion': 'off', 'user_info': json.dumps(USER)}
    context.add_init_script('for (const [k,v] of Object.entries(' + json.dumps(stored) + ')) localStorage.setItem(k,v)')
    host = urllib.parse.urlparse(BASE).hostname
    context.add_cookies([{'name': n, 'value': v, 'domain': host, 'path': '/'}
                         for n, v in [('motion', motion), ('motionSpeed', speed), ('entranceMotion', 'off')]])
    return context


# Polls getAnimations() every frame; animations already running when it starts are ignored.
CAPTURE_START = '''(ms) => { window.__cap = { done: false, list: [] }; const seen = new Set(document.getAnimations());
  const t0 = performance.now();
  const tick = () => { for (const a of document.getAnimations()) if (!seen.has(a)) { seen.add(a);
      const e = a.effect, el = e && e.target;
      window.__cap.list.push({ name: a.animationName || a.transitionProperty || '', type: a.constructor.name,
        dur: Math.round(e ? e.getComputedTiming().duration : 0), pseudo: (e && e.pseudoElement) || '',
        cls: el ? String(el.getAttribute('class') || '') : '', tag: el ? el.tagName : '', id: el ? el.id : '' }); }
    if (performance.now() - t0 < ms) requestAnimationFrame(tick); else window.__cap.done = true; };
  tick(); }'''

TRANSITIONS = '''([selector, pseudo]) => { const el = document.querySelector(selector); if (!el) return null;
  const cs = getComputedStyle(el, pseudo || null);
  const props = cs.transitionProperty.split(', '), durs = cs.transitionDuration.split(', ');
  const out = {}; props.forEach((p, i) => { out[p] = Math.round(parseFloat(durs[i % durs.length]) * 1000); });
  return out; }'''

SAMPLE = '''(selector) => new Promise((resolve) => { const out = []; const t0 = performance.now();
  const f = () => { const el = document.querySelector(selector);
    if (el) { const cs = getComputedStyle(el); const m = cs.transform === 'none' ? 1 : new DOMMatrix(cs.transform).a;
      out.push([+cs.opacity, m]); }
    if (performance.now() - t0 < 450) requestAnimationFrame(f); else resolve(out); }; f(); })'''


def capture(page, action, ms=900):
    page.evaluate(CAPTURE_START, ms)
    action()
    page.wait_for_function('() => window.__cap && window.__cap.done', timeout=ms + 15000)
    return page.evaluate('() => window.__cap.list')


def kb_focus(page, locator):
    page.keyboard.press('Shift')  # keyboard modality, so programmatic focus is :focus-visible
    locator.focus()


def check(tier, name, ok, detail=''):
    entry = {'tier': tier, 'check': name, 'passed': bool(ok), 'detail': detail}
    results.append(entry)
    if not ok:
        failures.append(entry)
    print(f"{'ok  ' if ok else 'FAIL'} [{tier}] {name}{(' — ' + str(detail)) if detail and not ok else ''}", flush=True)


def near(actual, expected):
    return actual is not None and abs(actual - expected) <= TOLERANCE_MS


def durations(items, predicate):
    return sorted({a['dur'] for a in items if predicate(a)})


def run_tier(browser, motion, speed, scale):
    tier = f'{motion}/{speed}'
    fe, fs, de, st = (round(v * scale) for v in (FAST_EFFECTS, FAST_SPATIAL, DEFAULT_EFFECTS, STATE_LAYER))
    context = new_context(browser, motion, speed)
    page = context.new_page()
    errors = []
    page.on('pageerror', lambda error: errors.append(str(error)))

    page.goto(BASE + '/')
    page.wait_for_timeout(2500)
    # transition-ui: ink on FastEffects, travel on FastSpatial; off keeps only ink, at 0s.
    lists = page.evaluate(TRANSITIONS, ['nav .transition-ui', ''])
    ink = ['color', 'background-color', 'border-color', 'box-shadow', 'opacity']
    travel = ['transform', 'translate', 'scale', 'rotate']
    check(tier, 'transition-ui ink on FastEffects', lists and all(near(lists.get(p), fe) for p in ink), lists)
    if scale:
        check(tier, 'transition-ui travel on FastSpatial', all(near(lists.get(p), fs) for p in travel), lists)
    else:
        check(tier, 'transition-ui travel dropped under off', not any(p in lists for p in travel), lists)
    for selector in ['a[aria-label="PicPony 主页"]', '[role=tab]']:
        lists = page.evaluate(TRANSITIONS, [selector, ''])
        check(tier, f'focus ring on FastEffects: {selector}', lists and near(lists.get('box-shadow'), fe), lists)

    page.mouse.move(5, 890)
    items = capture(page, lambda: page.get_by_role('link', name='图片 #2000').first.hover(), 500)
    got = durations(items, lambda a: 'media-hover-scrim' in a['cls'])
    check(tier, 'gallery hover scrim on the state layer', got == ([st] if scale else []), got)

    items = capture(page, lambda: page.get_by_role('button', name='收起侧边栏').click(), 900)
    got = durations(items, lambda a: a['id'] == 'app-sidebar' and a['name'] in ('translate', 'margin-right'))
    check(tier, 'docked drawer on DefaultEffects', got == ([de] if scale else []), got)
    page.wait_for_timeout(500)

    page.goto(BASE + '/search?q=pony')
    page.wait_for_timeout(2000)
    lists = page.evaluate(TRANSITIONS, ['.m3-field > fieldset', '::after'])
    check(tier, 'field focus indicator on FastEffects', lists is None or near(lists.get('opacity'), fe), lists)

    page.goto(BASE + '/pic/1000')
    page.wait_for_timeout(3000)
    report = page.get_by_role('button', name='举报').first
    if scale:
        page.evaluate(CAPTURE_START, 700)
        report.click()
        samples = page.evaluate(SAMPLE, '[role=dialog] > div, [role=dialog]')
        page.wait_for_function('() => window.__cap.done')
        items = page.evaluate('() => window.__cap.list')
        opacity = [s[0] for s in samples]
        check(tier, 'modal opacity monotonic', all(b >= a - 1e-3 for a, b in zip(opacity, opacity[1:])), opacity[:6])
        check(tier, 'modal never scales past 1', max((s[1] for s in samples), default=1) <= 1.0005)
    else:
        items = capture(page, lambda: report.click(), 700)
    got = durations(items, lambda a: a['type'] == 'Animation' and 'ripple' not in a['cls'])
    check(tier, 'modal enters on DefaultEffects', got == ([de] if scale else []), got)
    page.wait_for_timeout(400)
    items = capture(page, lambda: page.keyboard.press('Escape'), 700)
    got = durations(items, lambda a: a['type'] == 'Animation' and 'ripple' not in a['cls'])
    check(tier, 'modal exits on DefaultEffects', got == ([de] if scale else []), got)
    page.wait_for_timeout(500)

    items = capture(page, lambda: page.locator('main img[alt="图片 #1000"]').first.click(), 1200)
    got = durations(items, lambda a: 'yarl__root' in a['cls'] or a['name'] == 'm3-lightbox-in')
    check(tier, 'lightbox fade and slide on DefaultEffects', got == ([de] if scale else []), got)
    page.wait_for_timeout(400)
    items = capture(page, lambda: page.keyboard.press('Escape'), 1200)
    got = durations(items, lambda a: 'yarl__root' in a['cls'])
    check(tier, 'lightbox exits on DefaultEffects', got == ([de] if scale else []), got)

    # Reaction fill: a press plays it; arriving already favourited/liked does not.
    page.goto(BASE + '/pic/2000')
    page.wait_for_timeout(3500)
    fills = page.evaluate("() => document.getAnimations().filter(a => a.animationName === 'reaction-fill').length")
    check(tier, 'no fill for a picture that loads favourited', fills == 0, fills)
    next_button = page.get_by_role('button', name='下一张')
    if next_button.count():
        items = capture(page, lambda: next_button.first.click(), 1500)
        got = [a for a in items if a['name'] == 'reaction-fill']
        check(tier, 'no fill walking to a favourited neighbour', not got, got)

    def like_route(route):
        want = json.loads(route.request.post_data or '{}').get('liked')
        if want:
            route.fulfill(status=200, content_type='application/json', body=json.dumps({'liked': True, 'like_count': 1}))
        else:
            route.fulfill(status=500, content_type='application/json',
                          body=json.dumps({'error': {'code': 'FIXTURE', 'message': 'fixture failure'}}))

    page.route('**/me/forum/posts/1/like', like_route)
    page.goto(BASE + '/forum/1')
    page.wait_for_timeout(3000)
    like = page.get_by_role('button', name='点赞').first
    items = capture(page, lambda: like.click(), 900)
    got = durations(items, lambda a: a['name'] == 'reaction-fill')
    check(tier, 'like press plays the fill once', got == [round(REACTION * scale)], got)
    page.wait_for_timeout(300)
    items = capture(page, lambda: like.click(), 900)  # the un-like fails and the filled thumb comes back
    got = [a for a in items if a['name'] == 'reaction-fill']
    check(tier, 'no fill when a failed un-like restores the thumb', not got, got)

    check(tier, 'no page errors', not errors, errors[:3])
    context.close()

    # Phone: the modal drawer and its scrim share one clock (DefaultSpatial, 194ms at scale 1).
    context = new_context(browser, motion, speed, width=390)
    page = context.new_page()
    page.goto(BASE + '/')
    page.wait_for_timeout(2500)
    items = capture(page, lambda: page.locator('header button').first.click(), 900)
    got = durations(items, lambda a: a['id'] == 'app-sidebar' or 'z-drawer-scrim' in a['cls'])
    check(tier, 'phone drawer and scrim share one clock', got == ([round(194 * scale)] if scale else []), got)
    page.wait_for_timeout(500)
    page.screenshot(path=str(OUTPUT / f'phone-drawer-{motion}-{speed}.png'))
    context.close()


with sync_playwright() as playwright:
    browser = playwright.chromium.launch()
    only = [arg for arg in sys.argv[3:] if '/' in arg]
    for motion, speed, scale in TIERS:
        if only and f'{motion}/{speed}' not in only:
            continue
        try:
            run_tier(browser, motion, speed, scale)
        except Exception as error:
            check(f'{motion}/{speed}', 'tier ran to completion', False, str(error)[:300])
    browser.close()

(OUTPUT / 'motion-results.json').write_text(json.dumps(results, ensure_ascii=False, indent=2), encoding='utf-8')
print(f'{len(results)} motion checks, {len(failures)} failed; report: {OUTPUT / "motion-results.json"}', flush=True)
sys.exit(1 if failures else 0)
