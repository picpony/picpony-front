"""Gallery video recovery: bun run build && bun run test:browser --card-video.

The browser decodes real VP8 bytes. All API and media requests use local fixtures.
"""
import json
import os
import pathlib
import re
import sys
import time
import urllib.parse

from playwright.sync_api import sync_playwright, expect

from browserLaunch import browser_options
from testProfileGallery import BASE, Fixtures, THUMB, image_record, unwrap

OUTPUT = pathlib.Path(__file__).resolve().parent.parent / '.workbuddy' / 'card-video'
OUTPUT.mkdir(parents=True, exist_ok=True)
CASES = {arg.split('=', 1)[1] for arg in sys.argv if arg.startswith('--case=')}
MATCHED = set()


def fixture_clip():
    os.environ.setdefault('OPENCV_LOG_LEVEL', 'ERROR')
    import cv2
    import numpy
    path = OUTPUT / 'clip.webm'
    writer = cv2.VideoWriter(str(path), cv2.VideoWriter_fourcc(*'VP80'), 10, (320, 240))
    for index in range(20):
        writer.write(numpy.full((240, 320, 3), (40 + index * 8, 120, 200), dtype=numpy.uint8))
    writer.release()
    return path.read_bytes()


class VideoFixtures(Fixtures):
    def __init__(self, clip, mode):
        super().__init__()
        self.clip = clip
        self.mode = mode
        self.requests = []
        self.pending = []
        self.hold_details = False
        self.hold_uploads = False

    def __call__(self, route):
        target = unwrap(route.request.url)
        if target.path.replace('/api/v1/json', '') == '/search/images':
            records = [image_record(3000 + index) for index in range(12)]
            for record in records[:2]:
                record['format'] = 'webm'
                record['width'], record['height'] = 320, 240
                record['representations'] = {key: value.replace('.png', '.webm')
                                             for key, value in record['representations'].items()}
                record['view_url'] = record['view_url'].replace('.png', '.webm')
            self.json(route, {'total': len(records), 'images': records})
            return
        if target.path.endswith('.webm'):
            image_id = int(re.search(r'/2024/1/1/(\d+)/', target.path).group(1))
            count = sum(row['id'] == image_id for row in self.requests)
            self.requests.append({'id': image_id, 'url': route.request.url, 'at': time.monotonic()})
            if image_id == 3000 and self.mode == 'hold' and count == 0:
                self.pending.append(route)
                return
            failed = image_id == 3000 and (
                (self.mode == 'transient' and count == 0) or self.mode == 'permanent' or
                (self.mode == 'fallback' and urllib.parse.urlparse(route.request.url).hostname != 'derpicdn.net'))
            if failed:
                route.fulfill(status=503, content_type='text/plain', body='Temporary media outage')
            else:
                # The CDN supports byte ranges. Without them Chromium exposes only [0, 0]
                # as seekable even after buffering this small clip, so returning to 0.1s clamps to 0.
                headers = {'access-control-allow-origin': '*', 'accept-ranges': 'bytes'}
                byte_range = re.fullmatch(r'bytes=(\d+)-(\d*)', route.request.headers.get('range', ''))
                if byte_range:
                    start = int(byte_range.group(1))
                    end = min(int(byte_range.group(2) or len(self.clip) - 1), len(self.clip) - 1)
                    headers['content-range'] = f'bytes {start}-{end}/{len(self.clip)}'
                    route.fulfill(status=206, content_type='video/webm', body=self.clip[start:end + 1], headers=headers)
                else:
                    route.fulfill(status=200, content_type='video/webm', body=self.clip, headers=headers)
            return
        super().__call__(route)


VIDEO = THUMB + '[data-image-hero-id="3000"] video'
CONTROL = THUMB + '[data-image-hero-id="3001"] video'
CARD = '.image-card:has([data-image-hero-id="3000"])'


def requests_for(fixtures, image_id=3000):
    return [row for row in fixtures.requests if row['id'] == image_id]


def ready(page, selector=VIDEO, timeout=8000):
    page.wait_for_function("""selector => {
      const video = document.querySelector(selector);
      return video && video.readyState >= 2 && !video.error && getComputedStyle(video).opacity === '1';
    }""", arg=selector, timeout=timeout)
    assert not page.locator(selector).evaluate('(video) => video.closest(".image-card").innerText.includes("图片加载失败")')


def run_case(browser, clip, name, mode, work, suppressed=(), forced_line=None):
    if CASES and name not in CASES:
        return
    MATCHED.add(name)
    context = browser.new_context(viewport={'width': 1440, 'height': 1000}, service_workers='block')
    fixtures = VideoFixtures(clip, mode)
    context.route('**/*', fixtures)
    if forced_line:
        # Amend the document's public policy seed exactly where the server installs it.
        context.add_init_script('''(() => {
          let policy;
          Object.defineProperty(window, '__picponyRoutePolicy', {
            configurable: true, get: () => policy,
            set: value => { policy = {...value, image: %s}; }
          });
        })();''' % json.dumps(forced_line))
    if suppressed:
        context.add_init_script("""(() => {
          for (const type of %s) document.addEventListener(type, event => {
            if (event.target.closest?.('[data-image-hero-id="3000"]')) event.stopImmediatePropagation();
          }, true);
        })();""" % json.dumps(suppressed))
    page = context.new_page()
    errors = []
    page.on('pageerror', lambda error: errors.append(str(error)))
    try:
        # A held media response intentionally prevents networkidle. The control video's decoded
        # pixels and the rendered gallery establish readiness without waiting for that request.
        page.goto(BASE + '/user/1', wait_until='domcontentloaded')
        expect(page.locator(THUMB)).to_have_count(12)
        ready(page, CONTROL)
        work(page, context, fixtures)
        assert not errors, errors
        print(json.dumps({'case': name, 'result': 'passed', 'mediaRequests': len(requests_for(fixtures))}), flush=True)
    except Exception:
        page.screenshot(path=str(OUTPUT / (name + '.png')))
        media = page.locator('video').evaluate_all('''videos => videos.map(video => ({
          src: video.currentSrc, time: video.currentTime, duration: video.duration,
          ready: video.readyState, network: video.networkState, paused: video.paused, seeking: video.seeking,
          seekable: [...Array(video.seekable.length)].map((_, i) => [video.seekable.start(i), video.seekable.end(i)]),
          buffered: [...Array(video.buffered.length)].map((_, i) => [video.buffered.start(i), video.buffered.end(i)])
        }))''')
        print(json.dumps({'case': name, 'requests': fixtures.requests, 'errors': errors, 'media': media}), flush=True)
        raise
    finally:
        for route in fixtures.pending:
            route.abort()
        context.unroute_all(behavior='wait')
        context.close()


def transient_and_hover(page, context, fixtures):
    ready(page)
    requests = requests_for(fixtures)
    assert len(requests) == 2, requests
    assert requests[1]['at'] - requests[0]['at'] >= .25, 'The media retry did not back off'
    assert 'retry=' in requests[1]['url'], 'The retry reused the failed cache entry'
    assert len(requests_for(fixtures, 3001)) == 1, 'A healthy video was requested again'
    video = page.locator(VIDEO)
    assert video.evaluate('(video) => video.paused && video.muted && video.preload === "metadata"')
    video.hover()
    page.wait_for_function('''selector => {
      const video = document.querySelector(selector);
      return !video.paused && video.readyState >= 2 && video.currentTime > .2;
    }''', arg=VIDEO, timeout=5000)
    page.mouse.move(0, 0)
    page.wait_for_function('''selector => {
      const video = document.querySelector(selector);
      return video.paused && !video.seeking && Math.abs(video.currentTime - .1) < .05;
    }''', arg=VIDEO, timeout=5000)


def fallback(page, context, fixtures):
    ready(page)
    requests = requests_for(fixtures)
    assert len(requests) >= 3, requests
    assert urllib.parse.urlparse(requests[-1]['url']).hostname == 'derpicdn.net', requests
    assert not any('/_next/image' in row['url'] for row in fixtures.requests)


def suppressed_events(page, context, fixtures):
    ready(page, timeout=18000)
    assert len(requests_for(fixtures)) == 1, 'An already decoded frame triggered a retry'


def timeout_and_stale_event(page, context, fixtures):
    old_video = page.locator(VIDEO).element_handle()
    ready(page, timeout=20000)
    assert len(requests_for(fixtures)) == 2, 'The stalled request was not retried'
    assert page.locator(VIDEO).evaluate('(video, old) => video !== old', old_video)
    old_video.evaluate('(video) => video.dispatchEvent(new Event("error"))')
    page.wait_for_timeout(600)
    ready(page)
    assert len(requests_for(fixtures)) == 2, 'A stale media error advanced the new attempt'


def offline(page, context, fixtures):
    page.wait_for_function('selector => !!document.querySelector(selector)?.currentSrc', arg=VIDEO)
    assert len(fixtures.pending) == 1
    context.set_offline(True)
    fixtures.pending.pop().abort('internetdisconnected')
    page.wait_for_function('selector => !!document.querySelector(selector).error', arg=VIDEO)
    page.wait_for_timeout(1000)
    assert len(requests_for(fixtures)) == 1, 'An offline failure consumed a retry'
    assert '图片加载失败' not in page.locator(CARD).inner_text()
    context.set_offline(False)
    ready(page)
    assert len(requests_for(fixtures)) == 2


def exhausted_and_manual_retry(page, context, fixtures):
    retry = page.locator(CARD).get_by_role('button', name='重新加载图片', exact=True)
    expect(retry).to_be_visible(timeout=20000)
    count = len(requests_for(fixtures))
    assert 5 <= count <= 9, f'The retry ladder must be bounded: {count}'
    page.wait_for_timeout(1000)
    assert len(requests_for(fixtures)) == count
    fixtures.mode = 'healthy'
    retry.click()
    ready(page)
    expect(retry).to_have_count(0)


def rapid_online_recovery(page, context, fixtures):
    ready(page)
    # Deliver the error and reconnection in one task, before React can install a new effect.
    old_video = page.locator(VIDEO).element_handle()
    old_video.evaluate('''video => {
      Object.defineProperty(navigator, 'onLine', {configurable: true, value: false});
      video.dispatchEvent(new Event('error'));
      Object.defineProperty(navigator, 'onLine', {configurable: true, value: true});
      window.dispatchEvent(new Event('online'));
    }''')
    page.wait_for_function('old => !old.isConnected', arg=old_video, timeout=5000)
    ready(page)
    assert page.evaluate('navigator.onLine')
    assert len(requests_for(fixtures)) == 2, 'An early online event left the video waiting offline'


def forced_policy(page, context, fixtures):
    exhausted_and_manual_retry(page, context, fixtures)
    requests = requests_for(fixtures)
    assert len(requests) == 6, 'Five forced-line attempts, then one manual retry'
    assert all(urllib.parse.urlparse(row['url']).hostname == '147052.xyz' for row in requests)


def cancelled(page, context, fixtures):
    page.wait_for_function('selector => !!document.querySelector(selector)?.currentSrc', arg=VIDEO)
    page.goto(BASE + '/settings', wait_until='networkidle')
    count = len(requests_for(fixtures))
    page.wait_for_timeout(16000)
    assert len(requests_for(fixtures)) == count, 'An unmounted card continued its timeout/retry ladder'


with sync_playwright() as playwright:
    browser = playwright.chromium.launch(headless=True, **browser_options())
    try:
        clip = fixture_clip()
        run_case(browser, clip, 'transient-and-hover', 'transient', transient_and_hover)
        run_case(browser, clip, 'line-fallback', 'fallback', fallback)
        run_case(browser, clip, 'missing-loadeddata', 'healthy', suppressed_events, ('loadeddata',))
        run_case(browser, clip, 'decoded-without-events', 'healthy', suppressed_events,
                 ('loadeddata', 'canplay', 'seeked'))
        run_case(browser, clip, 'timeout-and-stale-event', 'hold', timeout_and_stale_event)
        run_case(browser, clip, 'offline-recovery', 'hold', offline)
        run_case(browser, clip, 'rapid-online-recovery', 'healthy', rapid_online_recovery)
        run_case(browser, clip, 'exhaustion-and-manual-retry', 'permanent', exhausted_and_manual_retry)
        run_case(browser, clip, 'forced-line-policy', 'permanent', forced_policy, forced_line='picpony')
        run_case(browser, clip, 'unmount-cancels-loading', 'hold', cancelled)
        assert not CASES - MATCHED, f'Unknown cases: {CASES - MATCHED}'
    finally:
        browser.close()
