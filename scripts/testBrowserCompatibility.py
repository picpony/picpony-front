"""Built CSS, stored themes and overlay motion on the selected real browser."""
import json
import pathlib
import re
from playwright.sync_api import sync_playwright, expect
from browserLaunch import browser_options
from testProfileGallery import BASE, Fixtures

OUTPUT = pathlib.Path(__file__).resolve().parent.parent / '.workbuddy' / 'browser-compatibility'
OUTPUT.mkdir(parents=True, exist_ok=True)

CSS_CHECKS = """() => {
  const fixture = document.createElement('section');
  fixture.innerHTML = `
    <div class="bg-scrim-veil"></div>
    <div class="bg-accent-red"></div>
    <div class="media-caption-gradient"></div>
    <div class="skeleton"></div>
    <div style="--tw-ring-inset:inset"><button class="ring-2 focus-ring">Ring</button></div>
    <div class="backdrop-filter" style="--tw-backdrop-blur:blur(4px)"></div>
    <div class="spring-fast-spatial transition-transform"></div>
    <div class="m3-field" data-labelled><input disabled><fieldset></fieldset></div>
    <div data-colour style="color:var(--md-sys-color-on-surface)"></div>`;
  fixture.style.cssText = 'position:fixed;left:-1000px;top:0;width:240px';
  document.body.append(fixture);
  const css = (selector, pseudo) => getComputedStyle(fixture.querySelector(selector), pseudo);
  const root = getComputedStyle(document.documentElement);
  const spatial = css('.spring-fast-spatial');
  const node = fixture.querySelector('.spring-fast-spatial');
  const animation = node.animate([{transform:'translateX(0px)'},{transform:'translateX(100px)'}], {
    duration:1000, easing:spatial.transitionTimingFunction, fill:'both'
  });
  animation.pause(); animation.currentTime = 400;
  const result = {
    scrim: css('.bg-scrim-veil').backgroundColor,
    accent: css('.bg-accent-red').backgroundColor,
    caption: css('.media-caption-gradient').backgroundImage,
    shimmer: css('.skeleton', '::after').backgroundImage,
    ring: css('button').boxShadow,
    blur: css('.backdrop-filter').backdropFilter,
    duration: spatial.transitionDuration,
    travel: new DOMMatrixReadOnly(getComputedStyle(node).transform).m41,
    disabled: css('fieldset').borderColor,
    ink: css('[data-colour]').color,
    channels: root.getPropertyValue('--md-sys-color-on-surface-rgb').trim(),
  };
  animation.cancel(); fixture.remove(); return result;
}"""

with sync_playwright() as p:
    browser = p.chromium.launch(**browser_options(), headless=True)
    results = []
    for width, palette, scheme in [(1366, 'default', 'light'), (390, 'default', 'dark'),
                                    (1366, 'custom', 'light'), (390, 'custom', 'dark')]:
        context = browser.new_context(viewport={'width': width, 'height': 900},
                                      color_scheme=scheme, service_workers='block')
        fixtures = Fixtures()
        fixtures.hold_details = fixtures.hold_uploads = False
        context.route('**/*', fixtures)
        cookies = {'palette': palette, 'paletteCustom': '#237a94', 'darkMode': scheme,
                   'motion': 'standard', 'motionSpeed': 'default'}
        context.add_cookies([{'name': k, 'value': v, 'url': BASE} for k, v in cookies.items()])
        stored = {'picpony_motion': 'standard', 'picpony_motion_speed': 'default',
                  'picpony_palette': palette, 'picpony_palette_custom': '#237a94',
                  'darkMode': scheme, 'picpony_dev_banner_dismissed': 'true'}
        context.add_init_script('for(const [k,v] of Object.entries(' + json.dumps(stored) + '))localStorage.setItem(k,v)')
        page = context.new_page()
        errors = []
        page.on('pageerror', lambda error: errors.append(str(error)))
        page.goto(BASE, wait_until='networkidle')
        page.wait_for_timeout(600)
        expect(page.locator('html')).to_have_attribute('data-palette', palette)
        styles = page.evaluate(CSS_CHECKS)
        assert styles['scrim'] == 'rgba(0, 0, 0, 0.32)', styles
        assert styles['accent'] != 'rgba(0, 0, 0, 0)', styles
        assert styles['caption'] != 'none' and styles['shimmer'] != 'none', styles
        assert styles['ring'] != 'none' and 'inset' not in styles['ring'], styles
        assert styles['blur'].startswith('blur('), styles
        assert styles['travel'] > 100, 'Spatial overshoot disappeared: ' + str(styles)
        assert styles['disabled'].endswith(', 0.12)'), styles
        channels = ', '.join(styles['channels'].split())
        assert styles['ink'] == f'rgb({channels})', styles
        assert float(styles['duration'].removesuffix('s')) > 0, styles
        if palette == 'custom':
            expect(page.locator('#palette-custom')).to_have_count(1)

        # A real overlay exercises springTiming, dismissal and focus alongside the CSS checks.
        if width > 500:
            page.get_by_text('点击登录', exact=True).click()
            dialog = page.get_by_role('dialog')
            expect(dialog).to_be_visible()
            page.wait_for_timeout(500)
            scrim = page.locator('.bg-scrim-veil').last
            assert scrim.evaluate('(el) => getComputedStyle(el).backgroundColor') == 'rgba(0, 0, 0, 0.32)'
            page.keyboard.press('Escape')
            expect(dialog).to_have_count(0)

            page.goto(BASE + '/settings', wait_until='networkidle')
            page.wait_for_timeout(600)
            tabs = page.get_by_role('tab')
            assert tabs.count() > 1
            page.evaluate("""() => {
              window.__compatTracks = [];
              const until = performance.now() + 1600;
              const record = () => {
                for (const animation of document.getAnimations()) {
                  if (animation.id === 'tab-strip' || animation.id === 'tab-lean') {
                    window.__compatTracks.push({id: animation.id, frames: animation.effect.getKeyframes().length});
                  }
                }
                if (performance.now() < until) requestAnimationFrame(record);
              }; requestAnimationFrame(record);
            }""")
            tabs.nth(1).click()
            expect(tabs.nth(1)).to_have_attribute('aria-selected', 'true')
            page.wait_for_function('window.__compatTracks.length > 0')
            tabs.first.click()
            expect(tabs.first).to_have_attribute('aria-selected', 'true')
            page.wait_for_timeout(600)
            tracks = page.evaluate('window.__compatTracks')
            expected = 2 if page.evaluate("CSS.supports('transition-timing-function', 'linear(0, 1)')") else 3
            assert any(t['id'] == 'tab-strip' and t['frames'] >= expected for t in tracks), tracks

            theme = page.get_by_role('button', name=re.compile('切换为'))
            # Escape during entry must reverse from the displayed opacity, not finish fading in.
            page.evaluate("""() => {
              window.__tooltipExit = {done: false, before: null, closed: []};
              const result = window.__tooltipExit;
              const deadline = performance.now() + 4000;
              let born = null, dismissed = null;
              const record = now => {
                const el = document.querySelector('[role=tooltip]');
                if (el && born === null) born = now;
                if (el) {
                  const opacity = +getComputedStyle(el).opacity;
                  if (el.dataset.open === 'false') result.closed.push(opacity);
                  if (dismissed === null && now - born >= 40) {
                    result.before = opacity;
                    dismissed = now;
                    document.dispatchEvent(new KeyboardEvent('keydown', {key:'Escape', bubbles:true}));
                  }
                }
                if (now >= deadline || (dismissed !== null && now - dismissed > 700)) {
                  result.done = true; return;
                }
                requestAnimationFrame(record);
              }; requestAnimationFrame(record);
            }""")
            theme.hover()
            page.wait_for_function('window.__tooltipExit.done')
            leaving = page.evaluate('window.__tooltipExit')
            assert leaving['before'] is not None and 0 < leaving['before'] < 1, leaving
            assert leaving['closed'] and max(leaving['closed']) <= leaving['closed'][0] + 0.005, leaving
            expect(page.get_by_role('tooltip')).to_have_count(0)
            page.mouse.move(0, 0)
            theme.hover()
            tooltip = page.get_by_role('tooltip')
            expect(tooltip).to_be_visible()
            place = tooltip.evaluate('(el) => [el.style.left, el.style.top, el.style.bottom]')
            page.wait_for_timeout(450)
            assert tooltip.evaluate('(el) => [el.style.left, el.style.top, el.style.bottom]') == place
            dark = page.locator('html').evaluate('(el) => el.classList.contains("dark")')
            for target in [not dark, dark]:
                theme.click()
                page.wait_for_function('(dark) => document.documentElement.classList.contains("dark") === dark', arg=target)
                page.wait_for_function('!document.documentElement.hasAttribute("data-theme-vt")')

        page.goto(BASE + '/pic/1000', wait_until='networkidle')
        expect(page.get_by_text('下载原图', exact=True)).to_be_visible()
        assert not errors, errors
        page.screenshot(path=str(OUTPUT / f'{browser.version}-{width}-{palette}-{scheme}.png'))
        results.append({'width': width, 'palette': palette, 'scheme': scheme, 'styles': styles})
        print(f'PASS {browser.version} {width}px {palette}/{scheme}', flush=True)
        context.close()
    (OUTPUT / f'{browser.version}.json').write_text(json.dumps(results, indent=2), encoding='utf-8')
    browser.close()
