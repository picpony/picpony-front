"""Paused-frame hero contact sheets, separate from performance measurements.

Run: python scripts/captureHeroMotion.py BASE FIXTURES --label=before

Uses the production gallery fixtures and the browser's public Web Animations API.
The capture hook pauses the application's real animations after their creation;
it never imports or calls an application/controller debugging interface. Every
track is sampled at the same elapsed milliseconds, including shorter chrome
tracks, then replayed from zero and allowed to finish before the next gesture.
Screenshots, pose measurements and one contact sheet per viewport are written to
.workbuddy/hero-visuals/<label>/.
"""
import argparse
import importlib
import json
import math
import pathlib
import re
import sys

from PIL import Image, ImageDraw, ImageFont
from playwright.sync_api import expect, sync_playwright


ROOT = pathlib.Path(__file__).resolve().parent.parent
TIMES_MS = (0, 60, 100, 160, 220, 250)
PROFILES = ((1440, 900), (1920, 1080), (390, 844))

# Installed only in this test context. Wrapping animate lets us pause before a
# slow screenshot round trip could miss the flight. Native animate runs first.
INSTALL_CAPTURE = r"""() => {
  const selector = [
    '.image-hero-flyer', '.image-hero-flyer-clip', '.image-hero-flyer-image',
    '.image-hero-flight-layer', '.image-hero-flight-compensator',
    '[data-image-detail-background-visual]', '[data-image-detail-clip]',
    '[data-image-detail-unclip]', '[data-image-detail-crossfade]',
    '[data-image-detail-surface]', '[data-image-detail-reveal]',
    '[data-image-detail-floating-back]', '[data-image-hero-chrome]'
  ].join(',');
  const nativeAnimate = Element.prototype.animate;
  let armed = false, direction = null, tracks = [], serial = 0;
  const rect = node => {
    if (!node) return null;
    const r = node.getBoundingClientRect();
    return {x:r.x, y:r.y, width:r.width, height:r.height};
  };
  const relevant = element => element instanceof Element && element.matches(selector)
    && element.isConnected && getComputedStyle(element).visibility !== 'hidden';
  const name = element => ({tag:element.tagName.toLowerCase(), className:element.className,
    attributes:Object.fromEntries([...element.attributes]
      .filter(a => a.name.startsWith('data-image-')).map(a => [a.name, a.value]))});
  const collect = animation => {
    const element = animation.effect?.target;
    if (!armed || !relevant(element) || tracks.some(t => t.animation === animation)) return;
    if (!Number.isFinite(Number(animation.effect.getComputedTiming().endTime))) return;
    animation.pause();
    animation.currentTime = 0;
    tracks.push({animation, element, id:++serial});
  };
  Element.prototype.animate = function(...args) {
    const animation = Reflect.apply(nativeAnimate, this, args);
    collect(animation);
    return animation;
  };
  const describe = ({animation, element, id}) => {
    const timing = animation.effect.getTiming();
    const computed = animation.effect.getComputedTiming();
    return {id, target:name(element), currentTime:animation.currentTime,
      playState:animation.playState, duration:timing.duration, delay:timing.delay,
      endDelay:timing.endDelay, easing:timing.easing, endTime:computed.endTime,
      properties:[...new Set(animation.effect.getKeyframes()
        .flatMap(f => Object.keys(f)).filter(k => !['offset','computedOffset','easing','composite'].includes(k)))]};
  };
  const twoFrames = () => new Promise(resolve => requestAnimationFrame(
    () => requestAnimationFrame(resolve)));
  const pose = element => {
    if (!element) return null;
    const style = getComputedStyle(element);
    let rise = null;
    try { rise = style.transform === 'none' ? 0 : new DOMMatrixReadOnly(style.transform).m42; }
    catch {}
    return {rect:rect(element), opacity:Number(style.opacity), transform:style.transform,
      translate:style.translate, rise, borderRadius:style.borderRadius,
      visibility:style.visibility};
  };
  window.__heroVisualCapture = {
    arm(nextDirection) {
      if (armed) throw new Error('A previous visual capture is still armed');
      tracks = []; serial = 0; direction = nextDirection; armed = true;
    },
    get count() { return tracks.length; },
    get hasFlight() { return tracks.some(t => t.element.matches('.image-hero-flyer')); },
    async freeze() {
      // Include the real source-card CSS transitions exposed by getAnimations(),
      // so their opacity does not drift while screenshots take wall-clock time.
      await twoFrames();
      document.getAnimations().forEach(collect);
      await twoFrames();
      if (!this.hasFlight) throw new Error('No actual hero flight was created');
      tracks.forEach(t => { t.animation.pause(); t.animation.currentTime = 0; });
      return tracks.map(describe);
    },
    async sample(milliseconds) {
      if (!armed) throw new Error('Capture must be armed before sampling');
      // Absolute time, not a separate normalized fraction per animation.
      tracks.forEach(t => { t.animation.pause(); t.animation.currentTime = milliseconds; });
      await twoFrames();
      const layer = document.querySelector('.image-hero-flight-layer[data-image-hero-role="foreground"]')
        ?? document.querySelector('.image-hero-flight-layer');
      const overlay = [...document.querySelectorAll('[data-image-detail-overlay]')]
        .find(n => getComputedStyle(n).visibility !== 'hidden'
          && (direction === 'forward' ? n.hasAttribute('data-image-hero-stage')
            : !n.hasAttribute('data-image-hero-stage')))
        ?? [...document.querySelectorAll('[data-image-detail-overlay]')]
          .find(n => getComputedStyle(n).visibility !== 'hidden');
      const reveal = role => [...(overlay?.querySelectorAll(`[data-image-detail-reveal="${role}"]`) ?? [])]
        .map(pose);
      const back = tracks.find(t => t.element.matches('[data-image-detail-floating-back]'))?.element;
      return {milliseconds, direction, state:document.documentElement.dataset.imageHeroState,
        host:rect(document.querySelector('[data-image-detail-host]')),
        galleryScroll:document.querySelector('[data-image-hero-gallery-scroll]')?.scrollTop,
        picture:pose(layer?.querySelector('.image-hero-flyer')),
        pictureClip:pose(layer?.querySelector('.image-hero-flyer-clip')),
        image:pose(layer?.querySelector('.image-hero-flyer-image')),
        clip:pose(overlay?.querySelector('[data-image-detail-clip]')),
        content:pose(overlay?.querySelector('[data-image-detail-crossfade]')),
        surface:pose(overlay?.querySelector('[data-image-detail-surface]')),
        header:reveal('header'), body:reveal('body'), floatingBack:pose(back),
        background:pose(document.querySelector('[data-image-detail-background-visual]')),
        tracks:tracks.map(describe)};
    },
    resume() {
      // Replaying from zero makes completion a real full-duration playback, not
      // an immediate finish caused by the final endpoint screenshot.
      armed = false;
      tracks.forEach(t => { t.animation.currentTime = 0; t.animation.play(); });
    }
  };
}"""


def parse_args():
    parser = argparse.ArgumentParser(description=__doc__,
                                     formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument('base', help='Running application origin, e.g. http://127.0.0.1:3100')
    parser.add_argument('fixtures', help='Fixture server origin used by testProfileGallery')
    parser.add_argument('--label', default='current', help='Output directory name (default: current)')
    args = parser.parse_args()
    if not re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9._-]{0,79}', args.label):
        parser.error('--label must be 1-80 letters, digits, dots, underscores or hyphens, starting with a letter or digit')
    args.base = args.base.rstrip('/')
    args.fixtures = args.fixtures.rstrip('/')
    return args


def load_fixtures(args):
    # The existing fixture module consumes argv[1:3] at import time. Normalize
    # those inputs without changing its source or restricting argparse ordering.
    previous = sys.argv
    try:
        sys.argv = [previous[0], args.base, args.fixtures]
        module = importlib.import_module('testProfileGallery')
    finally:
        sys.argv = previous
    return module.BASE, module.Fixtures, module.USER, module.THUMB


def wait_state(page, phase):
    expect(page.locator('html')).to_have_attribute('data-image-hero-state', phase, timeout=15000)


def pick_sources(page, thumb):
    selector = '[data-tab-pane-active] ' + thumb
    expect(page.locator(selector)).to_have_count(12)
    page.locator(selector).first.evaluate("""n => {
      const s=document.querySelector('[data-image-hero-gallery-scroll]');
      s.scrollTop += n.getBoundingClientRect().top-s.getBoundingClientRect().top-100;
    }""")
    page.wait_for_function("""selector => [...document.querySelectorAll(selector)].filter(n => {
      const r=n.getBoundingClientRect(), s=n.closest('[data-image-hero-gallery-scroll]').getBoundingClientRect();
      return r.top>=s.top && r.bottom<=s.bottom;
    }).every(n => {const i=n.querySelector('img');return i?.complete && i.naturalWidth>0;})""", arg=selector)
    # Let the existing pane/gallery entrances and image decode fades settle.
    page.wait_for_timeout(750)
    rows = page.locator(selector).evaluate_all("""nodes => nodes.map(n => {
      const r=n.getBoundingClientRect(), s=n.closest('[data-image-hero-gallery-scroll]').getBoundingClientRect();
      const i=n.querySelector('img');
      return {id:Number(n.dataset.imageHeroId), x:r.x,y:r.y,width:r.width,height:r.height,
        visible:r.top>=s.top+8 && r.bottom<=s.bottom-8,
        decoded:!!i && i.complete && i.naturalWidth>0 && Number(getComputedStyle(i).opacity)>.99};
    }).filter(n => n.visible && n.decoded)""")
    assert len(rows) >= 2, f'Need decoded, fully visible cards in at least two columns: {rows}'
    left_x, right_x = min(r['x'] for r in rows), max(r['x'] for r in rows)
    assert right_x - left_x > 20, f'Only one visible gallery column: {rows}'
    left = min((r for r in rows if abs(r['x'] - left_x) < 1), key=lambda r: r['y'])
    right = min((r for r in rows if abs(r['x'] - right_x) < 1), key=lambda r: r['y'])
    return [('left', left), ('right', right)]


def capture_leg(page, output, name, direction, trigger):
    page.evaluate('(direction)=>window.__heroVisualCapture.arm(direction)', direction)
    trigger()
    page.wait_for_function('window.__heroVisualCapture.hasFlight', timeout=12000)
    tracks = page.evaluate('window.__heroVisualCapture.freeze()')
    result = {'case':name, 'direction':direction, 'tracks':tracks, 'frames':[]}
    try:
        for milliseconds in TIMES_MS:
            sample = page.evaluate('(ms)=>window.__heroVisualCapture.sample(ms)', milliseconds)
            assert sample['picture'], f'Flyer disappeared at {milliseconds}ms in {name}'
            assert sample['clip'], f'Container clip missing at {milliseconds}ms in {name}'
            filename = f'{name}-{milliseconds:03d}ms.png'
            page.screenshot(path=str(output / filename), animations='allow', timeout=15000)
            sample['screenshot'] = filename
            result['frames'].append(sample)
    finally:
        page.evaluate('window.__heroVisualCapture.resume()')
    wait_state(page, 'detail-idle' if direction == 'forward' else 'gallery-idle')
    expect(page.locator('.image-hero-flight-layer')).to_have_count(0)
    (output / (name + '.json')).write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding='utf-8')
    return result


def font(size):
    for path in ('C:/Windows/Fonts/segoeui.ttf', '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf'):
        if pathlib.Path(path).exists():
            return ImageFont.truetype(path, size)
    return ImageFont.load_default()


def make_contact_sheet(output, width, height, rows):
    cell_width = 320 if width >= 500 else 220
    header_height, row_label_height, gutter = 66, 30, 8
    tiles = []
    for row in rows:
        row_tiles = []
        for sample in row['frames']:
            with Image.open(output / sample['screenshot']) as opened:
                image = opened.convert('RGB')
            host = sample['host']
            # Keep the same app-content enclosure in all cells. Full viewport
            # screenshots are retained beside the sheet for pixel inspection.
            if host:
                box = (max(0, math.floor(host['x'])), max(0, math.floor(host['y'])),
                       min(image.width, math.ceil(host['x'] + host['width'])),
                       min(image.height, math.ceil(host['y'] + host['height'])))
                image = image.crop(box)
            cell_height = max(1, round(image.height * cell_width / image.width))
            row_tiles.append(image.resize((cell_width, cell_height), Image.Resampling.LANCZOS))
        tiles.append(row_tiles)
    row_heights = [max(tile.height for tile in row) for row in tiles]
    sheet = Image.new('RGB', (len(TIMES_MS) * (cell_width + gutter) + gutter,
                             header_height + sum(h + row_label_height + gutter for h in row_heights)),
                      '#edf0f2')
    draw = ImageDraw.Draw(sheet)
    draw.text((gutter, 6), f'Hero motion | {width} x {height} | {output.name}', font=font(20), fill='#18232c')
    for index, milliseconds in enumerate(TIMES_MS):
        draw.text((gutter + index * (cell_width + gutter), 38), f'{milliseconds} ms', font=font(16), fill='#394c5b')
    y = header_height
    for row, row_tiles, row_height in zip(rows, tiles, row_heights):
        draw.text((gutter, y + 4), row['case'], font=font(16), fill='#18232c')
        y += row_label_height
        for index, tile in enumerate(row_tiles):
            sheet.paste(tile, (gutter + index * (cell_width + gutter), y))
        y += row_height + gutter
    filename = f'{width}-contact-sheet.png'
    sheet.save(output / filename)
    return filename


def run_profile(browser, output, base, Fixtures, user, thumb, width, height):
    context = browser.new_context(viewport={'width':width, 'height':height}, device_scale_factor=1,
                                  color_scheme='light', reduced_motion='no-preference',
                                  is_mobile=width < 500, has_touch=width < 500)
    fixtures = Fixtures()
    fixtures.hold_uploads = False
    fixtures.hold_details = False
    context.route('**/*', fixtures)
    stored = {'picpony_dev_banner_dismissed':'true', 'trixie_use_cdn':'false',
              'picpony_use_proxy':'false', 'picpony_hk_relay':'false',
              'picpony_motion':'standard', 'picpony_motion_speed':'default',
              'user_info':json.dumps(user)}
    context.add_init_script('for(const [k,v] of Object.entries(' + json.dumps(stored) + '))localStorage.setItem(k,v)')
    context.add_init_script('(' + INSTALL_CAPTURE + ')()')
    page = context.new_page()
    page.set_default_timeout(15000)
    errors, rows = [], []
    page.on('pageerror', lambda error: errors.append(str(error)))
    try:
        page.goto(base + '/user/1', wait_until='networkidle')
        sources = pick_sources(page, thumb)
        for side, source in sources:
            wait_state(page, 'gallery-idle')
            selector = '[data-tab-pane-active] ' + thumb + f'[data-image-hero-id="{source["id"]}"]'
            card = page.locator(selector).locator('..')
            name = f'{width}-{side}-{source["id"]}'
            opening = capture_leg(page, output, name + '-open', 'forward', card.click)
            opening['source'] = source
            rows.append(opening)
            # A close only begins after the original opening tracks have played
            # completely and the real detail route has finished its handoff.
            page.wait_for_timeout(200)
            rows.append(capture_leg(page, output, name + '-return', 'back',
                                    lambda: page.keyboard.press('Escape')))
            expect(page).to_have_url(base + '/user/1')
            expect(page.locator('[data-image-detail-overlay]')).to_have_count(0)
            page.wait_for_timeout(200)
        assert not errors, errors
        sheet = make_contact_sheet(output, width, height, rows)
        print(f'PASS {width}x{height}: left/right open + return; {output / sheet}', flush=True)
        return {'viewport':{'width':width, 'height':height}, 'sources':sources,
                'contactSheet':sheet, 'journeys':rows, 'pageErrors':errors}
    except Exception:
        try:
            page.screenshot(path=str(output / f'{width}-failure.png'), animations='allow', timeout=5000)
        except Exception:
            pass
        raise
    finally:
        context.close()


def main():
    args = parse_args()
    base, Fixtures, user, thumb = load_fixtures(args)
    output = ROOT / '.workbuddy' / 'hero-visuals' / args.label
    output.mkdir(parents=True, exist_ok=True)
    results, failures = [], []
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(channel='msedge', headless=True)
        try:
            for width, height in PROFILES:
                try:
                    results.append(run_profile(browser, output, base, Fixtures, user, thumb, width, height))
                except Exception as error:
                    failures.append({'width':width, 'height':height, 'error':str(error)})
                    print(f'FAIL {width}x{height}: {error}', flush=True)
        finally:
            browser.close()
    report = {'label':args.label, 'base':base, 'timesMs':TIMES_MS,
              'note':'Paused WAAPI visual inspection; screenshot timings are not performance measurements.',
              'results':results, 'failures':failures}
    (output / 'results.json').write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding='utf-8')
    print(f'{len(results)} contact sheets, {len(failures)} failures; {output / "results.json"}', flush=True)
    return 1 if failures else 0


if __name__ == '__main__':
    sys.exit(main())
