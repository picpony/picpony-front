"""Native slider input and painted motion against the production build and local fixtures."""
import base64
import json
import pathlib
import sys
import urllib.parse
import urllib.request
from playwright.sync_api import sync_playwright, expect
from browserLaunch import browser_options

BASE, FIXTURES = sys.argv[1:3]
OUTPUT = pathlib.Path(__file__).resolve().parent.parent / '.workbuddy' / 'slider-regression'
OUTPUT.mkdir(parents=True, exist_ok=True)
OPENER = urllib.request.build_opener(urllib.request.ProxyHandler({}))
CACHE = {}


def intercepted(route):
    request = route.request
    path = urllib.parse.urlparse(request.url).path
    if request.url.startswith(BASE) and not path.startswith(('/api/v1', '/relay', '/search-api', '/_next/image')):
        route.continue_()
        return
    key = (request.url, request.method)
    if key not in CACHE:
        url = FIXTURES + '/__review_fixture?' + urllib.parse.urlencode({'url': request.url, 'method': request.method})
        with OPENER.open(url) as response:
            CACHE[key] = json.load(response)
    answer = CACHE[key]
    if answer is None:
        route.abort()
    else:
        route.fulfill(status=answer.get('status', 200), content_type=answer['contentType'],
                      body=base64.b64decode(answer['body']) if answer.get('binary') else answer['body'])


READ = r"""e => {
  const root=e.closest('[data-slider]'), rail=root.querySelector('[data-slider-rail]'),
    thumb=root.querySelector('[data-slider-thumb]'), ink=root.querySelector('[data-slider-ink]');
  const r=rail.getBoundingClientRect(), t=thumb.getBoundingClientRect(), i=e.getBoundingClientRect();
  const scroller=e.closest('.popover-scrollbar');
  const clips=['active','inactive'].map(name=>getComputedStyle(root.querySelector('[data-slider-track='+name+']')).clipPath);
  const percentages=clips.map(clip=>Number(clip.match(/calc\(([-\d.]+)%/)?.[1]));
  return { value:Number(e.value), min:Number(e.min), max:Number(e.max), valueText:e.getAttribute('aria-valuetext'),
    x:t.x+t.width/2, y:i.y+i.height/2, left:r.left, right:r.right, width:r.width, height:i.height,
    overflow:root.scrollWidth-root.clientWidth, scrollOverflow:scroller.scrollWidth-scroller.clientWidth,
    fraction:(t.x+t.width/2-r.left)/r.width, ink:ink.getBoundingClientRect().width,
    activeFraction:1-percentages[0]/100, inactiveFraction:percentages[1]/100,
    clips, ring:getComputedStyle(thumb).boxShadow,
    runs:root.getAnimations({subtree:true}).map(a=>({state:a.playState,duration:a.effect.getTiming().duration})) };
}"""


def read(slider):
    return slider.evaluate(READ)


def aligned(state):
    target = (state['value'] - state['min']) / (state['max'] - state['min'])
    assert abs(state['fraction'] - target) < .001, state
    assert not state['runs'], state
    assert state['overflow'] <= 1 and state['scrollOverflow'] <= 1, state


def point(slider, fraction):
    state = read(slider)
    return state['left'] + state['width'] * fraction, state['y']


def settle(slider):
    slider.evaluate("e=>e.closest('[data-slider]').getAnimations({subtree:true}).forEach(a=>a.finish())")
    aligned(read(slider))


def reset(slider):
    slider.press('Home')
    aligned(read(slider))
    slider.evaluate('e=>e.blur()')


def freeze(slider, progress):
    slider.evaluate("""(e,p)=>e.closest('[data-slider]').getAnimations({subtree:true}).forEach(a=>{
      a.pause();a.currentTime=a.effect.getTiming().duration*p;
    })""", progress)
    return read(slider)


def open_slider(context):
    page = context.new_page()
    page.goto(BASE + '/search', wait_until='networkidle')
    page.get_by_role('button', name='以图搜图', exact=True).click()
    slider = page.get_by_role('slider', name='搜索容差')
    expect(slider).to_be_visible()
    page.wait_for_function("""() => {
      let e=document.querySelector('[data-slider]');
      if (!e) return false;
      for (;e;e=e.parentElement) if (e.getAnimations().some(a=>a.playState==='running')) return false;
      return true;
    }""")
    return page, slider


def context_for(browser, tier='standard', speed='default', touch=False):
    context = browser.new_context(viewport={'width': 390 if touch else 1280, 'height': 1000},
                                  is_mobile=touch, has_touch=touch, reduced_motion='no-preference',
                                  service_workers='block')
    context.route('**/*', intercepted)
    effects = 'feedback:off,overlay:standard'
    stored = {'picpony_motion': tier, 'picpony_motion_speed': speed, 'picpony_entrance_motion': 'off',
              'picpony_motion_effects': effects, 'picpony_dev_banner_dismissed': 'true',
              'trixie_use_cdn': 'false', 'picpony_use_proxy': 'false', 'picpony_hk_relay': 'false'}
    context.add_init_script('for(const [k,v] of Object.entries(' + json.dumps(stored) + '))localStorage.setItem(k,v)')
    host = urllib.parse.urlparse(BASE).hostname
    context.add_cookies([{'name': key, 'value': value, 'domain': host, 'path': '/'} for key, value in
                        [('motion', tier), ('motionSpeed', speed), ('entranceMotion', 'off'), ('motionEffects', effects)]])
    return context


with sync_playwright() as p:
    browser = p.chromium.launch(headless=True, **browser_options())
    durations = {}
    for tier, speed in [('standard', 'default'), ('standard', 'fast'), ('standard', 'slow'),
                        ('reduced', 'default'), ('off', 'default'), ('custom', 'default')]:
        context = context_for(browser, tier, speed)
        page, slider = open_slider(context)
        state = read(slider)
        assert state['height'] >= 48 and abs(state['ink'] - 4) < .01, state
        assert 'round 8px 2px 2px 8px' in state['clips'][0], state
        assert 'round 2px 8px 8px 2px' in state['clips'][1], state

        # A held thumb never changes the value; release restores width without a rebound.
        page.mouse.move(state['x'], state['y'])
        page.mouse.down()
        held = read(slider)
        assert abs(held['ink'] - 2) < .01 and held['value'] == state['value'], held
        page.mouse.up()
        released = slider.evaluate("""async e=>{
          const read=""" + READ + """, frames=[];
          for(let i=0;i<25;i++){await new Promise(requestAnimationFrame);frames.push(read(e));}
          return frames;
        }""")
        assert all(abs(frame['ink'] - 4) < .01 and abs(frame['x'] - state['x']) < .01 for frame in released), released
        assert all(frame['value'] == state['value'] and not frame['runs'] for frame in released), released

        reset(slider)
        page.mouse.click(*point(slider, .75))
        target = read(slider)
        assert abs(target['value'] - .75) < .001 and target['valueText'] == '容差 0.75', target
        if tier in ('off', 'custom'):
            aligned(target)
        else:
            assert len(target['runs']) == 3, target
            durations[tier, speed] = target['runs'][0]['duration']
            frames = []
            for progress in [i / 40 for i in range(40)]:
                frame = freeze(slider, progress)
                frames.append(frame)
                assert frame['value'] == target['value'], frame
                assert -.0001 <= frame['fraction'] <= 1.0001, frame
                assert frame['overflow'] <= 1 and frame['scrollOverflow'] <= 1, frame
                assert abs(frame['activeFraction'] - frame['fraction']) < .001, frame
                assert abs(frame['inactiveFraction'] - frame['fraction']) < .001, frame
            assert any(.05 < frame['fraction'] < .65 for frame in frames), frames
            if tier == 'reduced':
                assert all(b['fraction'] >= a['fraction'] - .001 for a, b in zip(frames, frames[1:])), frames
                assert max(frame['fraction'] for frame in frames) <= (target['value'] - .01) / .99 + .001
            settle(slider)

        # Keyboard actions and native accessibility values are immediate, including endpoints.
        for key, value in [('Home', .01), ('ArrowRight', .02), ('End', 1), ('ArrowLeft', .99)]:
            slider.press(key)
            state = read(slider)
            assert abs(state['value'] - value) < .001 and state['valueText'] == f'容差 {value:.2f}', state
            aligned(state)
            assert state['ring'] != 'none' and abs(state['ink'] - 2) < .01, state
        print(f'ok slider press, jump, clips, keyboard and endpoints: {tier}/{speed}', flush=True)
        context.close()

    base = durations['standard', 'default']
    assert abs(durations['standard', 'fast'] - base * .7) < 1, durations
    assert abs(durations['standard', 'slow'] - base * 1.4) < 1, durations
    assert durations['reduced', 'default'] == base, durations

    context = context_for(browser)
    page, slider = open_slider(context)
    reset(slider)
    page.mouse.click(*point(slider, .85))
    before = freeze(slider, .12)
    page.mouse.click(*point(slider, .2))
    after = freeze(slider, 0)
    assert abs(before['x'] - after['x']) < .1, (before, after)
    settle(slider)

    # Starting a drag takes over the jump; moving outside the input still clamps and releases.
    reset(slider)
    page.mouse.move(*point(slider, .85))
    page.mouse.down()
    assert read(slider)['runs']
    for fraction in [.55, .35, 1.15, -.15]:
        page.mouse.move(*point(slider, fraction))
        aligned(read(slider))
    page.mouse.up()
    state = read(slider)
    assert state['value'] == .01 and abs(state['ink'] - 4) < .01, state
    aligned(state)

    # The bounded spring stays inside the rail at both ends for its entire sampled duration.
    for start, end in [(.25, 1), (.75, 0)]:
        page.mouse.click(*point(slider, start))
        settle(slider)
        page.mouse.click(*point(slider, end))
        for progress in [i / 40 for i in range(40)]:
            frame = freeze(slider, progress)
            assert -.0001 <= frame['fraction'] <= 1.0001, frame
            assert frame['overflow'] <= 1 and frame['scrollOverflow'] <= 1, frame
        settle(slider)

    # The real image-search form disables the primitive while its request is pending.
    pending = []
    page.route('**/search-api/api/reverse-search', lambda route: pending.append(route))
    page.get_by_role('textbox', name='或粘贴图片链接').fill('https://example.test/pony.png')
    page.get_by_role('button', name='开始搜索', exact=True).click()
    expect(slider).to_be_disabled()
    disabled = read(slider)
    page.mouse.click(*point(slider, .75))
    assert read(slider)['value'] == disabled['value'] and not read(slider)['runs']
    assert len(pending) == 1
    pending.pop().fulfill(content_type='application/json', body='{"images":[],"total":0}')
    expect(slider).to_be_enabled()

    page.mouse.click(*point(slider, .5))
    settle(slider)
    page.screenshot(path=str(OUTPUT / 'desktop.png'))
    page.emulate_media(forced_colors='active')
    slider.press('ArrowRight')
    aligned(read(slider))
    assert slider.evaluate("e=>getComputedStyle(e.closest('[data-slider]').querySelector('[data-slider-track=inactive]')).outlineStyle") == 'solid'
    page.screenshot(path=str(OUTPUT / 'forced-colors.png'))
    page.emulate_media(forced_colors='none')

    reset(slider)
    page.mouse.click(*point(slider, .8))
    slider.evaluate("e=>window.sliderRuns=e.closest('[data-slider]').getAnimations({subtree:true})")
    page.keyboard.press('Escape')
    expect(slider).not_to_be_visible()
    assert page.evaluate("window.sliderRuns.every(a=>a.playState==='idle'||a.playState==='finished')")
    print('ok slider rapid retarget, drag interruption, bounded jumps, disabled form, forced colors and unmount', flush=True)
    context.close()

    context = context_for(browser, touch=True)
    page, slider = open_slider(context)
    page.touchscreen.tap(*point(slider, .75))
    assert abs(read(slider)['value'] - .75) < .02 and len(read(slider)['runs']) == 3
    settle(slider)
    cdp = context.new_cdp_session(page)
    state = read(slider)
    cdp.send('Input.dispatchTouchEvent', {'type': 'touchStart', 'touchPoints': [{'x': state['x'], 'y': state['y'], 'id': 1}]})
    x, y = point(slider, .35)
    cdp.send('Input.dispatchTouchEvent', {'type': 'touchMove', 'touchPoints': [{'x': x, 'y': y, 'id': 1}]})
    aligned(read(slider))
    cdp.send('Input.dispatchTouchEvent', {'type': 'touchCancel', 'touchPoints': []})
    page.wait_for_timeout(50)
    state = read(slider)
    assert abs(state['ink'] - 4) < .01 and not state['runs'], state
    page.touchscreen.tap(*point(slider, .9))
    assert read(slider)['runs']
    settle(slider)
    page.screenshot(path=str(OUTPUT / 'touch.png'))
    print('ok slider touch tap, drag, cancellation and next gesture', flush=True)
    context.close()
    browser.close()

print('Slider browser regression passed.', flush=True)
