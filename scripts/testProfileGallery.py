"""Profile galleries and hero return paths against a production build.

Run: npm run build && npm run test:browser -- --profile-gallery
All business traffic is intercepted, including generated, decodable image bytes.
A profile's uploads are its bound Derpibooru account's (`uploader_id:` search — PicPony has no
uploads action), and its 收藏夹 tab lists the public folders (`get_profile_fave_folders`).
Against the dev server the profile header comes from the real backend's seed; the browser's
reads are the fixtures below either way.
"""
import base64
import io
import json
import pathlib
import re
import sys
import urllib.parse
import urllib.request

from PIL import Image, ImageDraw
from playwright.sync_api import sync_playwright, expect


BASE, FIXTURES = sys.argv[1:3]
ROOT = pathlib.Path(__file__).resolve().parent.parent
OUTPUT = ROOT / '.workbuddy' / 'profile-gallery'
OUTPUT.mkdir(parents=True, exist_ok=True)
HEIGHTS = [1200, 1600, 900, 2000, 1400]
THUMB = '.image-card [data-image-hero-role="thumbnail"]'
USER = {'id': 1, 'username': 'fixture', 'role': 'user', 'token': 'review-fixture-token',
        'email': 'review@example.test', 'email_verified': True, 'avatar': '', 'experience': 1350}
RESULTS = []
FAILURES = []
FOLDERS = [
    {'id': 1, 'name': '主收藏夹', 'is_main': 1, 'item_count': 1139, 'latest_image_id': 3004},
    {'id': 8, 'name': '测试合并', 'is_main': 0, 'item_count': 10, 'latest_image_id': 3005},
    {'id': 61, 'name': 'panel', 'is_main': 0, 'item_count': 0, 'latest_image_id': None},
]


def image_record(image_id):
    stem = f'https://derpicdn.net/img/2024/1/1/{image_id}'
    return {'id': image_id, 'name': f'fixture_{image_id}', 'width': 1600,
            'height': HEIGHTS[image_id % len(HEIGHTS)], 'view_url': stem + '/view.png',
            'representations': {key: f'{stem}/{key}.png' for key in
                                ['full', 'large', 'medium', 'small', 'tall', 'thumb', 'thumb_small', 'thumb_tiny']},
            'aspect_ratio': 1600 / HEIGHTS[image_id % len(HEIGHTS)], 'format': 'png',
            'source_url': None, 'uploader': 'fixture', 'uploader_id': 1,
            'created_at': '2024-01-01T00:00:00Z', 'size': 1024,
            'score': 42, 'comment_count': 3, 'tags': ['pony', 'safe', 'solo'],
            'description': '', 'upvotes': 40, 'downvotes': 2}


def unwrap(raw):
    for _ in range(5):
        parsed = urllib.parse.urlparse(raw)
        inner = urllib.parse.parse_qs(parsed.query).get('url', [None])[0]
        if not inner:
            return parsed
        raw = urllib.parse.urljoin(BASE, inner)
    return urllib.parse.urlparse(raw)


class Fixtures:
    def __init__(self):
        self.cache = {}
        self.pngs = {}
        self.pending_uploads = []
        self.pending_details = []
        self.details = []
        self.allowed_details = set()
        self.profile_reads = []
        self.upload_queries = []
        self.folder_reads = []
        self.history = []
        self.hold_uploads = True
        self.hold_details = True

    @staticmethod
    def json(route, value):
        route.fulfill(status=200, content_type='application/json', body=json.dumps(value),
                      headers={'access-control-allow-origin': '*'})

    def png(self, image_id):
        if image_id not in self.pngs:
            # Actual pixels (not a transparent placeholder) are needed by canvas frame capture.
            width, height = 400, HEIGHTS[image_id % len(HEIGHTS)] // 4
            image = Image.new('RGB', (width, height), (65 + image_id % 110, 115, 170))
            draw = ImageDraw.Draw(image)
            draw.rectangle((width // 5, height // 5, width * 4 // 5, height * 4 // 5),
                           fill=(220, 180, 100))
            draw.line((0, 0, width, height), fill=(60, 70, 80), width=6)
            draw.text((20, 20), f'IMAGE {image_id}', fill=(250, 250, 245))
            buf = io.BytesIO()
            image.save(buf, format='PNG')
            self.pngs[image_id] = buf.getvalue()
        return self.pngs[image_id]

    def release_uploads(self):
        self.hold_uploads = False
        for route, value in self.pending_uploads:
            self.json(route, value)
        self.pending_uploads.clear()

    def release_details(self):
        self.hold_details = False
        for route, image_id in self.pending_details:
            self.json(route, {'image': image_record(image_id)})
        self.pending_details.clear()

    def __call__(self, route):
        request = route.request
        parsed = urllib.parse.urlparse(request.url)
        target = unwrap(request.url)
        params = urllib.parse.parse_qs(target.query)
        action = params.get('action', [''])[0]
        if action == 'add_browsing_history':
            self.history.append(json.loads(request.post_data))
            self.json(route, {'success': True})
            return
        if action == 'get_user_profile' or '/profiles/' in target.path:
            self.profile_reads.append({'action': action, 'userId': params.get('user_id', [None])[0],
                                       'path': target.path})
        if action == 'get_user_uploads':
            raise AssertionError('get_user_uploads does not exist; uploads are an uploader_id: search')
        if action == 'get_profile_fave_folders':
            self.folder_reads.append(params.get('username', [None])[0])
            self.json(route, {'success': True, 'folders': FOLDERS})
            return
        api_path = target.path.replace('/api/v1/json', '')
        detail = re.fullmatch(r'/images/(\d+)', api_path)
        if detail:
            image_id = int(detail.group(1))
            self.details.append(image_id)
            if self.hold_details:
                self.pending_details.append((route, image_id))
            else:
                self.json(route, {'image': image_record(image_id)})
            return
        if api_path == '/search/images':
            query = params.get('q', [''])[0]
            if 'uploader_id:' in query:
                # The profile's uploads (and the Derpibooru profile's): the first read is held so
                # the grid skeleton can be inspected.
                count = int(params.get('per_page', ['12'])[0])
                page = int(params.get('page', ['1'])[0])
                self.upload_queries.append(query)
                value = {'total': 48, 'images': [image_record(3000 + (page - 1) * count + i) for i in range(count)]}
                if self.hold_uploads:
                    self.pending_uploads.append((route, value))
                else:
                    self.json(route, value)
                return
            # Positive `id:` terms only. Every image search also carries the site's public blacklist
            # as `-id:N` exclusions, and on a dev server that list is the live backend's: read as ids,
            # a home-feed revalidation (a seed past its two-minute TTL) came back as the fifteen
            # blacklisted pictures, and the home check saw a 15-card grid.
            ids = [int(found) for found in re.findall(r'(?<![-\w])id:(\d+)', query)]
            if ids:
                # The folder covers: one search for every folder's newest picture.
                self.json(route, {'total': len(ids), 'images': [image_record(image_id) for image_id in ids]})
                return
        if api_path.startswith('/profiles/'):
            self.json(route, {'user': {'id': 1, 'name': 'fixture', 'slug': 'fixture',
                                      'avatar': None, 'avatar_url': None, 'description': '',
                                      'uploads_count': 48, 'comments_count': 3, 'posts_count': 2,
                                      'created_at': '2024-01-01T00:00:00Z', 'awards': []}})
            return
        if request.resource_type == 'image' and (not request.url.startswith(BASE) or parsed.path == '/_next/image'):
            match = re.search(r'/2024/1/1/(\d+)/', target.path)
            image_id = int(match.group(1)) if match else 3000
            route.fulfill(status=200, content_type='image/png', body=self.png(image_id),
                          headers={'access-control-allow-origin': '*'})
            return
        if request.url.startswith(BASE) and not parsed.path.startswith(('/api.php', '/relay', '/search-api', '/_next/image')):
            route.continue_()
            return
        pairs = [(key, value) for key, value in urllib.parse.parse_qsl(parsed.query) if key != '_t']
        key = parsed._replace(query=urllib.parse.urlencode(pairs)).geturl()
        if key not in self.cache:
            with urllib.request.urlopen(FIXTURES + '/__review_fixture?url=' + urllib.parse.quote(key, safe='')) as response:
                self.cache[key] = json.load(response)
        result = self.cache[key]
        if result is None:
            route.abort()
        else:
            route.fulfill(status=200, content_type=result['contentType'],
                          body=base64.b64decode(result['body']) if result.get('binary') else result['body'])


# Observe browser-rendered frames without reaching into the controller's private state.
FRAME_RECORDER = """() => {
  window.__galleryFrames = [];
  window.__galleryRecording = false;
  const rect = node => {
    if (!node) return null;
    const r = node.getBoundingClientRect();
    return {x:r.x,y:r.y,width:r.width,height:r.height};
  };
  const sample = () => {
    if (window.__galleryRecording) {
      const root = document.documentElement;
      window.__galleryFrames.push({
        state:root.dataset.imageHeroState, transition:root.dataset.imageHeroTransition,
        scroll:document.querySelector('[data-image-hero-gallery-scroll]')?.scrollTop,
        stage:!!document.querySelector('[data-image-hero-stage]'),
        flight:rect(document.querySelector('.image-hero-flyer')),
        hiddenSources:[...document.querySelectorAll('[data-image-hero-role="thumbnail"]')]
          .filter(n => n.style.opacity === '0').map(n => ({
            id:n.dataset.imageHeroId, pane:n.closest('[data-tab-pane]')?.dataset.tabPane,
            active:!n.closest('[data-tab-pane]') || n.closest('[data-tab-pane]').hasAttribute('data-tab-pane-active'),
            rect:rect(n)
          }))
      });
    }
    requestAnimationFrame(sample);
  };
  requestAnimationFrame(sample);
}"""


def wait_pending(page, queue, label):
    for _ in range(50):
        if queue:
            return
        page.wait_for_timeout(100)
    raise AssertionError(f'No {label} request arrived')


def gallery_scope(page):
    pane = page.locator('[data-tab-pane-active]')
    return pane if pane.count() else page.locator('main')


def inspect_grid(page, expected_count, baseline=None):
    scope = gallery_scope(page)
    expect(scope.locator(THUMB)).to_have_count(expected_count)
    page.wait_for_timeout(650)
    # The masonry is one flat list of absolutely placed slots (`.masonry-grid > .masonry-item`),
    # so columns and gaps are read off the slots' boxes rather than off column containers.
    rows = scope.locator(THUMB).evaluate_all("""nodes => nodes.map(n => {
      const card=n.closest('.image-card'), slot=card.closest('.masonry-item') || card, r=slot.getBoundingClientRect();
      const picture=n.querySelector('img'), s=getComputedStyle(n);
      return {id:Number(n.dataset.imageHeroId),width:r.width,height:r.height,x:r.x,y:r.y,
        thumbWidth:n.getBoundingClientRect().width,thumbHeight:n.getBoundingClientRect().height,
        aspect:s.aspectRatio,radius:s.borderRadius,linked:card.querySelector('a')?.pathname,
        inViewport:r.bottom>0 && r.top<innerHeight,
        decoded:!!picture && picture.complete && picture.naturalWidth>0,
        imageRatio:picture?.naturalWidth/picture?.naturalHeight,
        badges:card.querySelector('[data-image-hero-chrome]')?.textContent.trim()};
    })""")
    columns = sorted({round(row['x']) for row in rows})
    first_column = sorted((row for row in rows if round(row['x']) == columns[0]), key=lambda row: row['y'])
    layout = {
        'cols': len(columns),
        'gap': round(columns[1] - columns[0] - rows[0]['width']) if len(columns) > 1 else 0,
        'rowGap': round(first_column[1]['y'] - first_column[0]['y'] - first_column[0]['height'])
        if len(first_column) > 1 else None,
        'radius': rows[0]['radius'],
    }
    expected_cols = 4 if page.viewport_size['width'] >= 1024 else 2
    assert layout['cols'] == expected_cols, layout
    expected_gap = 16 if page.viewport_size['width'] >= 640 else 8
    assert layout['gap'] == layout['rowGap'] == expected_gap, layout
    assert len({round(row['thumbWidth'] / row['thumbHeight'], 2) for row in rows}) >= 3, 'Previews became square tiles'
    for row in rows:
        w, h = map(float, row['aspect'].split('/'))
        assert abs(row['thumbWidth'] / row['thumbHeight'] - w / h) < .01, row
        # Only the fixtures' own pictures have a known shape (a dev server's home seed is live).
        if row['id'] < 100000:
            assert abs(w / h - 1600 / HEIGHTS[row['id'] % len(HEIGHTS)]) < .01, row
        assert row['linked'] == f"/pic/{row['id']}", row
        if row['inViewport']:
            assert row['decoded'], f'Visible preview did not decode: {row}'
    if baseline:
        assert {key: layout[key] for key in baseline} == baseline, (layout, baseline)
    assert page.evaluate('document.documentElement.scrollWidth <= innerWidth + 1'), 'Horizontal overflow'
    return layout


def select_page_two(page):
    scope = gallery_scope(page)
    scope.get_by_role('button', name='第 2 页', exact=True).click()
    page.mouse.move(0, 0)
    expect(scope.locator('[aria-current="page"]')).to_have_text('2')
    expect(scope.locator(THUMB + '[data-image-hero-id="3012"]')).to_be_visible()
    page.wait_for_load_state('networkidle')
    page.wait_for_timeout(600)


def journey(page, fixtures, label, image_id, animated=True, delayed=False, expected_page=None):
    path = urllib.parse.urlparse(page.url).path
    scope = gallery_scope(page)
    source = scope.locator(THUMB + f'[data-image-hero-id="{image_id}"]')
    # Put the requested card in the same useful place on desktop and phone without hover intent.
    source.evaluate("""n => {
      const s=document.querySelector('[data-image-hero-gallery-scroll]');
      s.scrollTop += n.getBoundingClientRect().top-s.getBoundingClientRect().top-150;
    }""")
    page.mouse.move(0, 0)
    page.wait_for_timeout(650)
    expect(source.locator('img')).to_be_visible()
    page.wait_for_function("""selector => {
      const n=document.querySelector(selector), image=n?.querySelector('img');
      return image?.complete && image.naturalWidth>0 && Number(getComputedStyle(image).opacity)>.99;
    }""", arg=(f'[data-tab-pane-active] {THUMB}[data-image-hero-id="{image_id}"]'
                if page.locator('[data-tab-pane-active]').count() else THUMB + f'[data-image-hero-id="{image_id}"]'))
    original = source.bounding_box()
    scroll = page.locator('[data-image-hero-gallery-scroll]').evaluate('(n)=>n.scrollTop')
    active_tab = page.locator('[data-tab-pane-active]').get_attribute('data-tab-pane') if page.locator('[data-tab-pane-active]').count() else None
    assert set(fixtures.details) <= fixtures.allowed_details, f'Unrequested details fetched: {fixtures.details}'
    # The viewer warms the pictures either side of the one it settles on (the list's order,
    # consecutive ids here), so a step paints at once; nothing else may be read.
    fixtures.allowed_details.update({image_id - 1, image_id, image_id + 1})
    fixtures.hold_details = delayed
    previous_visits = len(fixtures.history)
    page.evaluate('window.__galleryFrames=[];window.__galleryRecording=true')
    source.locator('..').click()
    page.mouse.move(0, 0)
    if animated:
        expect(page.locator('html')).to_have_attribute('data-image-hero-transition', 'forward')
        expect(page.locator('[data-image-hero-stage]')).to_be_attached()
        expect(page.locator('.image-hero-flight-layer')).to_be_attached()
    if delayed:
        wait_pending(page, fixtures.pending_details, 'image detail')
        page.wait_for_timeout(350)
        if animated:
            # The stage hands the card's own record to the routed detail before the detail read
            # lands: what the card carried shows, and nothing reads as a broken value.
            stage_text = page.locator('[data-image-detail-host]').inner_text()
            assert 'Invalid Date' not in stage_text and 'NaN' not in stage_text, stage_text
        assert len(fixtures.history) == previous_visits, 'A preview was recorded before its metadata arrived'
        fixtures.release_details()
    expect(page).to_have_url(BASE + f'/pic/{image_id}', timeout=15000)
    expect(page.locator('html')).to_have_attribute('data-image-hero-state', 'detail-idle', timeout=15000)
    detail = page.locator(f'[data-image-hero-role="detail"][data-image-hero-id="{image_id}"]')
    expect(detail).to_be_visible()
    for _ in range(50):
        if len(fixtures.history) > previous_visits:
            break
        page.wait_for_timeout(100)
    assert len(fixtures.history) == previous_visits + 1, 'Opening detail should record exactly one visit'
    assert fixtures.history[-1]['image_id'] == image_id, fixtures.history[-1]
    page.wait_for_timeout(200)
    opening = page.evaluate('window.__galleryFrames')
    (OUTPUT / f'{label}-opening.json').write_text(json.dumps(opening, indent=2), encoding='utf-8')
    if animated:
        assert any(frame.get('transition') == 'forward' and frame['stage'] and frame['flight'] for frame in opening), opening
    else:
        assert not any(frame['flight'] for frame in opening), 'Reduced/off motion started a hero flight'
    page.screenshot(path=str(OUTPUT / f'{label}-detail.png'))
    page.evaluate('window.__galleryFrames=[]')
    page.keyboard.press('Escape')
    expect(page).to_have_url(BASE + path, timeout=15000)
    expect(page.locator('[data-image-detail-overlay]')).to_have_count(0, timeout=15000)
    page.wait_for_timeout(400)
    closing = page.evaluate('window.__galleryRecording=false;window.__galleryFrames')
    if active_tab:
        expect(page.locator('[data-tab-pane-active]')).to_have_attribute('data-tab-pane', active_tab)
    if expected_page:
        expect(gallery_scope(page).locator('[aria-current="page"]')).to_have_text(str(expected_page))
    returned_scroll = page.locator('[data-image-hero-gallery-scroll]').evaluate('(n)=>n.scrollTop')
    assert abs(scroll - returned_scroll) <= 2, f'Scroll changed: {scroll} -> {returned_scroll}'
    expect(source).to_be_visible()
    assert source.evaluate('(n)=>getComputedStyle(n).opacity') == '1', 'Returned source remains hidden'
    if animated:
        flights = [frame for frame in closing if frame.get('transition') == 'back' and frame['flight']]
        assert flights, 'Escape returned without the gallery hero flight'
        wrong_source = [source for frame in flights for source in frame['hiddenSources'] if not source['active']]
        assert not wrong_source, f'Return flight selected a hidden tab source: {wrong_source[0] if wrong_source else None}'
        def distance(frame):
            rect = frame['flight']
            return max(abs(rect[key] - original[key]) for key in ['x', 'y', 'width', 'height'])
        assert min(map(distance, flights)) < 25, f'Return flight missed its card: {flights[-1]["flight"]} vs {original}'
    else:
        assert not any(frame['flight'] for frame in closing), 'Reduced/off close started a hero flight'
    assert set(fixtures.details) <= fixtures.allowed_details, f'Unrequested details fetched: {fixtures.details}'
    wrong_profile = [read for read in fixtures.profile_reads if read['userId'] not in [None, '1']]
    wrong_profile.extend(read for read in fixtures.profile_reads
                         if '/profiles/' in read['path'] and not read['path'].endswith('/profiles/fixture'))
    assert not wrong_profile, f'Opening a picture changed the background profile id: {wrong_profile}'
    for item in fixtures.history:
        assert item.get('uploader') == 'fixture', f'History captured preview metadata: {item}'
    page.screenshot(path=str(OUTPUT / f'{label}-returned.png'))
    return {'route': path, 'tab': active_tab, 'scrollBefore': scroll, 'scrollAfter': returned_scroll,
            'openingFrames': len(opening), 'closingFrames': len(closing),
            'detailRequests': fixtures.details.copy(), 'profileReads': fixtures.profile_reads.copy(),
            'history': fixtures.history.copy()}


def step_journey(page, fixtures, from_id, to_id, expected_page):
    """Open `from_id`, step once with the keyboard to `to_id` (on the next page), close."""
    scope = gallery_scope(page)
    source = scope.locator(THUMB + f'[data-image-hero-id="{from_id}"]')
    source.evaluate("""n => {
      const s=document.querySelector('[data-image-hero-gallery-scroll]');
      s.scrollTop += n.getBoundingClientRect().top-s.getBoundingClientRect().top-150;
    }""")
    page.mouse.move(0, 0)
    page.wait_for_timeout(650)
    fixtures.allowed_details.update({from_id - 1, from_id, to_id, to_id + 1})
    fixtures.hold_details = False
    source.locator('..').click()
    page.mouse.move(0, 0)
    expect(page).to_have_url(BASE + f'/pic/{from_id}', timeout=15000)
    expect(page.locator('html')).to_have_attribute('data-image-hero-state', 'detail-idle', timeout=15000)
    page.wait_for_timeout(300)
    page.keyboard.press('ArrowRight')
    expect(page).to_have_url(BASE + f'/pic/{to_id}', timeout=15000)
    expect(page.locator(f'[data-image-hero-role="detail"][data-image-hero-id="{to_id}"]')).to_be_visible(timeout=15000)
    page.wait_for_timeout(400)
    page.keyboard.press('Escape')
    expect(page).to_have_url(BASE + '/user/1', timeout=15000)
    expect(page.locator('[data-image-detail-overlay]')).to_have_count(0, timeout=15000)
    page.wait_for_timeout(500)
    expect(gallery_scope(page).locator('[aria-current="page"]')).to_have_text(str(expected_page))
    target = gallery_scope(page).locator(THUMB + f'[data-image-hero-id="{to_id}"]')
    expect(target).to_be_in_viewport()
    assert set(fixtures.details) <= fixtures.allowed_details, f'Unrequested details fetched: {fixtures.details}'
    return {'from': from_id, 'to': to_id, 'page': expected_page}


def inspect_folders(page, fixtures):
    """The 收藏夹 tab: one card per public folder, linking to the shared-folder route."""
    scope = gallery_scope(page)
    cards = scope.locator('a[href^="/favorites/shared/"]')
    expect(cards).to_have_count(len(FOLDERS))
    assert fixtures.folder_reads, 'The folders tab did not read get_profile_fave_folders'
    hrefs = cards.evaluate_all('ns => ns.map(n => n.getAttribute("href"))')
    for href, folder in zip(hrefs, FOLDERS):
        assert re.fullmatch(r'/favorites/shared/[^/]+/' + str(folder['id']), href), href
    page.wait_for_function("""() => [...document.querySelectorAll('[data-tab-pane-active] a[href^="/favorites/shared/"] img')]
      .every(i => i.complete && i.naturalWidth > 0)""")
    covered = cards.evaluate_all('ns => ns.map(n => !!n.querySelector("img"))')
    assert covered == [folder['latest_image_id'] is not None for folder in FOLDERS], covered
    assert page.evaluate('document.documentElement.scrollWidth <= innerWidth + 1'), 'Horizontal overflow'
    return {'folders': hrefs}


def run_profile(browser, name, width, motion):
    context = browser.new_context(viewport={'width': width, 'height': 900}, color_scheme='light',
                                  reduced_motion='reduce' if motion == 'system' else 'no-preference',
                                  is_mobile=width < 500, has_touch=width < 500)
    fixtures = Fixtures()
    context.route('**/*', fixtures)
    stored = {'picpony_dev_banner_dismissed': 'true', 'trixie_use_cdn': 'false',
              'picpony_use_proxy': 'false', 'picpony_hk_relay': 'false',
              'picpony_motion': motion, 'picpony_motion_speed': 'default',
              'user_info': json.dumps(USER)}
    context.add_init_script('for (const [k,v] of Object.entries(' + json.dumps(stored) + ')) localStorage.setItem(k,v)')
    context.add_init_script('(' + FRAME_RECORDER + ')()')
    page = context.new_page()
    page.set_default_timeout(12000)
    errors = []
    page.on('pageerror', lambda error: errors.append(str(error)))
    animated = motion == 'standard'
    try:
        baseline = None
        if animated:
            page.goto(BASE + '/', wait_until='networkidle')
            baseline = inspect_grid(page, 50)
            assert not fixtures.details, 'Home idle fetched image details'
        page.goto(BASE + '/user/1', wait_until='domcontentloaded')
        wait_pending(page, fixtures.pending_uploads, 'profile uploads')
        assert all('uploader_id:' in query for query in fixtures.upload_queries), fixtures.upload_queries
        expect(page.locator('[data-tab-pane-active] .skeleton')).to_have_count(12)
        fixtures.release_uploads()
        page.wait_for_load_state('networkidle')
        inspect_grid(page, 12, baseline)
        assert not fixtures.details, 'Profile idle fetched image details'
        if animated:
            select_page_two(page)
        image_id = 3012 if animated else 3000
        result = journey(page, fixtures, name + '-uploads', image_id, animated=animated,
                         delayed=True, expected_page=2 if animated else 1)
        RESULTS.append({'profile': name, 'case': 'uploads', **result})
        print(f'PASS {name} uploads: masonry, open and return', flush=True)
        if animated:
            # 上一张 / 下一张 cross the tab's pages: from page 2's last picture into page 3, and
            # the close lands on page 3's card.
            result = step_journey(page, fixtures, 3023, 3024, expected_page=3)
            RESULTS.append({'profile': name, 'case': 'uploads-step', **result})
            print(f'PASS {name} uploads: a step crosses the page and the close turns the list', flush=True)
            page.get_by_role('tab', name='收藏夹', exact=True).click()
            page.mouse.move(0, 0)
            page.wait_for_load_state('networkidle')
            page.wait_for_timeout(600)
            result = inspect_folders(page, fixtures)
            RESULTS.append({'profile': name, 'case': 'folders', **result})
            print(f'PASS {name} public folders: one card per folder, covers inside the filters', flush=True)
            page.goto(BASE + '/derpi/user/fixture', wait_until='networkidle')
            inspect_grid(page, 24, baseline)
            result = journey(page, fixtures, name + '-derpi', 3000)
            RESULTS.append({'profile': name, 'case': 'derpi', **result})
            print(f'PASS {name} Derpi uploads: masonry, open and return', flush=True)
        assert not errors, errors
    except Exception as error:
        failure = {'profile': name, 'error': str(error), 'pageErrors': errors, 'url': page.url,
                   'details': fixtures.details, 'profileReads': fixtures.profile_reads,
                   'text': page.locator('main').inner_text()[:2000]}
        try:
            failure['frames'] = page.evaluate('window.__galleryFrames')
            page.screenshot(path=str(OUTPUT / f'{name}-failure.png'))
        except Exception:
            pass
        FAILURES.append(failure)
        print(f'FAIL {name}: {error}', flush=True)
    finally:
        for route, _ in fixtures.pending_uploads + fixtures.pending_details:
            try:
                route.abort()
            except Exception:
                pass
        context.close()


if __name__ == '__main__':
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(channel='msedge', headless=True)
        profiles = [('desktop', 1440, 'standard'), ('mobile', 390, 'standard'),
                    ('reduced', 1440, 'system'), ('off', 390, 'off')]
        if '--quick' in sys.argv:
            profiles = profiles[:1]
        for profile in profiles:
            run_profile(browser, *profile)
        browser.close()

    (OUTPUT / 'results.json').write_text(json.dumps({'results': RESULTS, 'failures': FAILURES},
                                                  ensure_ascii=False, indent=2), encoding='utf-8')
    print(f'{len(RESULTS)} gallery journeys passed, {len(FAILURES)} profiles failed; {OUTPUT / "results.json"}', flush=True)
    sys.exit(1 if FAILURES else 0)
