"""Repeated open / Back at random moments, the report: "after opening and going back a few times
the page is stuck on the list with the detail's URL and nothing responds".

Run: npm run build && node scripts/reviewBrowser.mjs --hero-stress [--rounds=N] [--seed=N]
After every round the screen must be one of the two settled states, consistently:
  - the list: `gallery-idle`, a gallery URL, no overlay, the list not inert and scrollable;
  - the picture: `detail-idle`, `/pic/<id>`, the routed overlay visible and interactive.
"""
import json
import random
import sys
from playwright.sync_api import sync_playwright, expect
from testProfileGallery import BASE, Fixtures, USER, THUMB

ROUNDS = next((int(a.split('=', 1)[1]) for a in sys.argv if a.startswith('--rounds=')), 40)
SEED = next((int(a.split('=', 1)[1]) for a in sys.argv if a.startswith('--seed=')), 7)
HEADED = '--headed' in sys.argv
GALLERY = '[data-image-hero-gallery-scroll]'

PROBE = """() => {
  const root = document.documentElement;
  const overlay = document.querySelector('[data-image-hero-surface-id]');
  const main = document.querySelector('[data-image-hero-gallery-scroll]');
  const ov = overlay && getComputedStyle(overlay);
  const stage = document.querySelector('[data-image-hero-stage]');
  return {
    state: root.dataset.imageHeroState || null,
    path: location.pathname,
    overlay: Boolean(overlay),
    overlayVisible: Boolean(ov && ov.visibility !== 'hidden' && overlay.getBoundingClientRect().width > 0),
    overlayInert: Boolean(overlay && overlay.closest('[inert]')),
    sealed: overlay?.dataset.imageHeroRouteState || null,
    galleryInert: Boolean(main && main.closest('[inert]')),
    scrollHidden: main?.hasAttribute('data-scroll-hidden') || false,
    stage: Boolean(stage),
    flyers: document.querySelectorAll('.image-hero-flight-layer').length,
    marker: history.state?.__picponyImageHero ? history.state.__picponyImageHero.role : null,
    modal: Boolean(document.querySelector('[aria-modal="true"]:not([data-image-detail-overlay])')),
  };
}"""


def probe(page):
    return page.evaluate(PROBE)


def settled(page, timeout=5000):
    """Wait until the engine reports an idle phase, then read the screen."""
    try:
        page.wait_for_function("""() => ['gallery-idle','detail-idle'].includes(
            document.documentElement.dataset.imageHeroState)""", timeout=timeout)
    except Exception:
        pass
    page.wait_for_timeout(450)
    return probe(page)


def consistent(s):
    on_detail = s['path'].startswith('/pic/')
    if s['state'] == 'detail-idle':
        return on_detail and s['overlay'] and s['overlayVisible'] and not s['overlayInert'] and s['flyers'] == 0
    if s['state'] == 'gallery-idle':
        return (not on_detail) and not s['galleryInert'] and not s['scrollHidden'] and s['flyers'] == 0 \
            and not s['stage']
    return False


def card(page, image_id):
    return page.locator(f'[data-tab-pane-active] {THUMB}[data-image-hero-id="{image_id}"]').locator('..')


ACTIONS = ['back', 'escape', 'button', 'reopen', 'other', 'wait']


def run(browser, width, rounds, seed):
    rng = random.Random(seed)
    context = browser.new_context(viewport={'width': width, 'height': 900}, reduced_motion='no-preference',
                                  is_mobile=width < 500, has_touch=width < 500)
    fixtures = Fixtures()
    fixtures.hold_uploads = False
    fixtures.hold_details = False
    context.route('**/*', fixtures)
    stored = {'picpony_dev_banner_dismissed': 'true', 'trixie_use_cdn': 'false',
              'picpony_use_proxy': 'false', 'picpony_hk_relay': 'false', 'picpony_motion': 'standard',
              'picpony_motion_speed': 'default', 'user_info': json.dumps(USER)}
    context.add_init_script('for(const [k,v] of Object.entries(' + json.dumps(stored) + '))localStorage.setItem(k,v)')
    page = context.new_page()
    page.set_default_timeout(8000)
    errors = []
    page.on('pageerror', lambda e: errors.append(str(e)))
    failures = []
    page.goto(BASE + '/user/1', wait_until='networkidle')
    expect(page.locator('[data-tab-pane-active] ' + THUMB)).to_have_count(12)
    page.wait_for_timeout(600)
    ids = page.eval_on_selector_all('[data-tab-pane-active] ' + THUMB,
                                    'ns => ns.slice(0,4).map(n => Number(n.dataset.imageHeroId))')
    for round_no in range(rounds):
        start = probe(page)
        seq = []
        # A burst of 2–5 actions with gaps from 0 to 420ms: inside the flight, at the landing,
        # inside the handoff, and on a settled screen.
        for _ in range(rng.randint(2, 5)):
            action = rng.choice(ACTIONS)
            gap = rng.choice([0, 16, 40, 90, 140, 200, 260, 320, 420])
            s = probe(page)
            try:
                if action in ('reopen', 'other') or s['path'].startswith('/pic/') is False:
                    image_id = ids[0] if action != 'other' else rng.choice(ids[1:])
                    card(page, image_id).click(force=True, timeout=1500, no_wait_after=True)
                    seq.append(f'open{image_id}')
                elif action == 'back':
                    page.evaluate('history.back()')
                    seq.append('back')
                elif action == 'escape':
                    page.keyboard.press('Escape')
                    seq.append('esc')
                elif action == 'button':
                    btn = page.locator('[data-image-detail-back-button]:not([data-image-hero-stage-back])')
                    if btn.count():
                        btn.first.click(force=True, timeout=800, no_wait_after=True)
                        seq.append('btn')
                    else:
                        page.evaluate('history.back()')
                        seq.append('back*')
                else:
                    seq.append('wait')
            except Exception as error:
                seq.append(f'{action}!')
            page.wait_for_timeout(gap)
            seq.append(str(gap))
        end = settled(page)
        for _ in range(3):
            # A press that landed on the open picture opens its lightbox or a tag dialog: a real
            # modal, closed by Escape, not the reported state.
            if not end.get('modal'):
                break
            page.keyboard.press('Escape')
            end = settled(page)
        if not consistent(end):
            # Give it a long time: a slow-but-correct recovery is not the reported bug.
            page.wait_for_timeout(3500)
            end = probe(page)
        ok = consistent(end)
        print(('ok   ' if ok else 'FAIL ') + f'{width} r{round_no} {" ".join(seq)} -> {json.dumps(end)}', flush=True)
        if not ok:
            failures.append({'round': round_no, 'seq': seq, 'end': end})
            page.screenshot(path=f'/tmp/stress-{width}-{round_no}.png')
            page.goto(BASE + '/user/1', wait_until='networkidle')
            page.wait_for_timeout(600)
            continue
        # Leave every round on the list, by the route the user would take.
        if end['state'] == 'detail-idle':
            page.keyboard.press('Escape')
            end = settled(page)
            if not consistent(end) or end['state'] != 'gallery-idle':
                print(f'FAIL {width} r{round_no} close-after -> {json.dumps(end)}', flush=True)
                failures.append({'round': round_no, 'seq': seq + ['close'], 'end': end})
                page.goto(BASE + '/user/1', wait_until='networkidle')
                page.wait_for_timeout(600)
    context.close()
    return failures, errors


with sync_playwright() as playwright:
    browser = playwright.chromium.launch(headless=not HEADED)
    total = []
    for width in [1440, 390]:
        failures, errors = run(browser, width, ROUNDS, SEED + width)
        total += failures
        if errors:
            print('page errors:', errors[:5], flush=True)
    browser.close()
print(f'{len(total)} inconsistent rounds', flush=True)
sys.exit(1 if total else 0)
