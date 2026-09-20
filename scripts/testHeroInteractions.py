"""Hero interruption and native scroll boundaries on a production build.

Run: npm run build && npm run test:hero
CDP touch and Playwright wheel input exercise real hit testing/default scrolling. The
separate stale-receiver case deliberately dispatches to the outgoing node to cover wheel
latching consistently across Chromium versions. All business/media requests use fixtures.
"""
import json
import pathlib
import sys
from playwright.sync_api import sync_playwright, expect
from testProfileGallery import BASE, Fixtures, USER, THUMB

OUTPUT = pathlib.Path(__file__).resolve().parent.parent / '.workbuddy' / 'hero-interactions'
OUTPUT.mkdir(parents=True, exist_ok=True)
RESULTS = []
FAILURES = []
REQUESTED_CASES = {arg.split('=',1)[1] for arg in sys.argv if arg.startswith('--case=')}
MATCHED_CASES = set()
GALLERY = '[data-image-hero-gallery-scroll]'
ROUTE = '[data-image-hero-surface-id] .image-detail-overlay-scroll'
RECORDER = """() => {
  if (!document.documentElement) {
    document.addEventListener('DOMContentLoaded', () => window.__installHeroRecorder(), {once:true});
    return;
  }
  const root = document.documentElement;
  const receiver = node => node?.closest?.('[data-image-hero-gallery-scroll]') ? 'gallery'
    : node?.closest?.('[data-image-hero-stage-scroll]') ? 'stage'
    : node?.closest?.('[data-image-hero-surface-id]') ? 'route' : 'other';
  window.__heroLog = {frames:[], events:[], states:[]};
  window.__heroRecord = false;
  const rect = node => { if(!node)return null; const r=node.getBoundingClientRect();
    return {x:r.x,y:r.y,width:r.width,height:r.height}; };
  for (const type of ['wheel','pointerdown','pointerup','pointercancel']) {
    window.addEventListener(type, e => {
      if(window.__heroRecord)window.__heroLog.events.push({at:performance.now(),type,
        receiver:receiver(e.target),trusted:e.isTrusted,y:e.clientY,
        target:e.target?.tagName+'.'+e.target?.className,state:root.dataset.imageHeroState,
        hit:document.elementFromPoint(e.clientX,e.clientY)?.className});
    }, {capture:true,passive:true});
  }
  new MutationObserver(() => {
    if(window.__heroRecord)window.__heroLog.states.push({at:performance.now(),state:root.dataset.imageHeroState});
  }).observe(root,{attributes:true,attributeFilter:['data-image-hero-state']});
  function frame(){
    if(window.__heroRecord){
      const source=document.querySelector('[data-tab-pane-active] [data-image-hero-id="3000"]');
      const flyer=document.querySelector('.image-hero-flyer');
      const overlay=document.querySelector('[data-image-hero-surface-id]');
      window.__heroLog.frames.push({at:performance.now(),state:root.dataset.imageHeroState,
        scroll:document.querySelector('[data-image-hero-gallery-scroll]')?.scrollTop,
        detail:overlay?.querySelector('.image-detail-overlay-scroll')?.scrollTop,
        flyer:rect(flyer),source:rect(source),sourceOpacity:source&&getComputedStyle(source).opacity});
    }
    requestAnimationFrame(frame);
  }requestAnimationFrame(frame);
}"""


def state(page, value, timeout=6000):
    expect(page.locator('html')).to_have_attribute('data-image-hero-state', value, timeout=timeout)


def record(page):
    return page.evaluate("window.__heroLog={frames:[],events:[],states:[]};window.__heroRecord=true;performance.now()")


def save(page, label):
    log = page.evaluate('window.__heroRecord=false;window.__heroLog')
    (OUTPUT / (label + '.json')).write_text(json.dumps(log, indent=2), encoding='utf-8')
    return log


def open_image(page):
    state(page, 'gallery-idle')
    source = page.locator('[data-tab-pane-active] ' + THUMB + '[data-image-hero-id="3000"]')
    source.evaluate("""n => {const s=document.querySelector('[data-image-hero-gallery-scroll]');
      s.scrollTop += n.getBoundingClientRect().top-s.getBoundingClientRect().top-140;}""")
    page.wait_for_function("""() => { const i=document.querySelector('[data-tab-pane-active] [data-image-hero-id="3000"] img');
      return i?.complete && i.naturalWidth>0 && getComputedStyle(i).opacity==='1'; }""")
    page.wait_for_timeout(350)
    source.locator('..').click()
    state(page, 'detail-idle')
    expect(page.locator('[data-image-hero-role="detail"]')).to_be_visible()
    page.wait_for_timeout(150)


def assert_clean(page, image_id=3000):
    state(page, 'gallery-idle')
    expect(page).to_have_url(BASE + '/user/1')
    expect(page.locator('.image-hero-flight-layer')).to_have_count(0)
    expect(page.locator('[data-image-detail-overlay]')).to_have_count(0)
    assert page.locator(GALLERY).evaluate("n=>getComputedStyle(n).pointerEvents") != 'none'
    assert page.locator('[data-image-detail-background-visual]').evaluate("n=>getComputedStyle(n).transform") == 'none'
    assert page.locator(f'[data-tab-pane-active] [data-image-hero-id="{image_id}"]').evaluate("n=>getComputedStyle(n).opacity") == '1'


def wheel_return(page, label, gap, scrolling_before=False):
    open_image(page)
    route = page.locator(ROUTE)
    route.evaluate('(n)=>n.scrollTop=100')
    box = route.bounding_box()
    page.mouse.move(box['x'] + box['width'] * .7, box['y'] + min(300, box['height'] / 2))
    if scrolling_before:
        page.mouse.wheel(0, 65)
        page.wait_for_timeout(20)
    start = record(page)
    page.keyboard.press('Escape')
    page.wait_for_timeout(gap)
    before = page.locator(GALLERY).evaluate('(n)=>n.scrollTop')
    for _ in range(18):
        page.mouse.wheel(0, 22)
        page.wait_for_timeout(30)
    during = page.evaluate('document.documentElement.dataset.imageHeroState')
    page.wait_for_timeout(150)
    after = page.locator(GALLERY).evaluate('(n)=>n.scrollTop')
    log = save(page, label)
    native = [e for e in log['events'] if e['type'] == 'wheel' and e['receiver'] == 'gallery']
    assert native, 'No real wheel event reached the destination'
    idle = next((s['at'] for s in log['states'] if s['state'] == 'gallery-idle'), None)
    assert idle is not None and idle - max(start, native[0]['at']) < 800, (during, log['states'])
    assert after - before > 220, f'Wheel movement lost: {before} -> {after}'
    assert during == 'gallery-idle', 'Return waited for the NEW scroll stream to end'
    positions = [f['scroll'] for f in log['frames'] if f['at'] >= native[0]['at']]
    assert all(b >= a - 2 for a, b in zip(positions, positions[1:])), 'Forward scrolling jumped backwards'
    assert_clean(page)
    return {'idleMs': round(idle-start), 'scrollDelta': round(after-before), 'nativeWheels': len(native)}


def stale_wheel_takeover(page, label):
    open_image(page)
    page.evaluate("window.__oldScroller=document.querySelector('[data-image-hero-surface-id] .image-detail-overlay-scroll')")
    start = record(page)
    page.keyboard.press('Escape')
    # A latched stream still addresses the old node, even when pointer-events is none.
    page.evaluate("""() => { window.__staleWheel=setInterval(()=>window.__oldScroller.dispatchEvent(
      new WheelEvent('wheel',{deltaY:18,bubbles:true,cancelable:true})),24); }""")
    page.wait_for_timeout(160)
    page.mouse.move(700, 450)
    before = page.locator(GALLERY).evaluate('(n)=>n.scrollTop')
    page.mouse.wheel(0, 85)
    state(page, 'gallery-idle', timeout=1000)
    page.evaluate('clearInterval(window.__staleWheel)')
    page.wait_for_timeout(180)
    settled = page.locator(GALLERY).evaluate('(n)=>n.scrollTop')
    # Retained DOM nodes must no longer write into the live gallery after release.
    page.evaluate("""window.__oldScroller.dispatchEvent(new WheelEvent('wheel',
      {deltaY:400,bubbles:true,cancelable:true}));window.__oldScroller.scrollTop+=300;""")
    page.wait_for_timeout(180)
    assert abs(page.locator(GALLERY).evaluate('(n)=>n.scrollTop') - settled) <= 1
    assert settled > before + 40
    log = save(page, label)
    assert_clean(page)
    idle = next(s['at'] for s in log['states'] if s['state'] == 'gallery-idle')
    return {'idleMs': round(idle-start), 'takeoverDelta': round(settled-before)}


def stale_wheel_expiry(page, label):
    open_image(page)
    page.evaluate("""() => {
      window.__oldScroller=document.querySelector('[data-image-hero-surface-id] .image-detail-overlay-scroll');
      window.__staleWheel=setInterval(()=>window.__oldScroller.dispatchEvent(
        new WheelEvent('wheel',{deltaY:2,bubbles:true,cancelable:true})),24);
    }""")
    start = record(page)
    try:
        page.keyboard.press('Escape')
        # No fresh destination input helps this case: the bounded OLD stream must expire
        # as a successful handoff, including timers firing just before a fractional deadline.
        state(page,'gallery-idle',timeout=8000)
    finally:
        page.evaluate('clearInterval(window.__staleWheel)')
    log = save(page,label)
    assert_clean(page)
    idle = next(s['at'] for s in log['states'] if s['state']=='gallery-idle')
    before = page.locator(GALLERY).evaluate('n=>n.scrollTop')
    box = page.locator(GALLERY).bounding_box()
    page.mouse.move(box['x']+box['width']/2,box['y']+200)
    direction = -1 if before > 90 else 1
    page.mouse.wheel(0,90*direction)
    page.wait_for_function("({before,direction})=>(document.querySelector('[data-image-hero-gallery-scroll]').scrollTop-before)*direction>40",
                           arg={'before':before,'direction':direction})
    return {'idleMs':round(idle-start),'nativeScrollRestored':True}


def touch_return(page, cdp, label, gap):
    open_image(page)
    start = record(page)
    page.keyboard.press('Escape')
    page.wait_for_timeout(gap)
    before = page.locator(GALLERY).evaluate('(n)=>n.scrollTop')
    cdp.send('Input.dispatchTouchEvent', {'type':'touchStart','touchPoints':[{'x':210,'y':650}]})
    for y in [635,610,580,545,505,460,415]:
        cdp.send('Input.dispatchTouchEvent', {'type':'touchMove','touchPoints':[{'x':210,'y':y}]})
        page.wait_for_timeout(25)
    cdp.send('Input.dispatchTouchEvent', {'type':'touchEnd','touchPoints':[]})
    page.wait_for_timeout(500)
    after = page.locator(GALLERY).evaluate('(n)=>n.scrollTop')
    log = save(page, label)
    assert after > before + 120, f'Native touch stopped at the handoff: {before} -> {after}'
    assert_clean(page)
    idle = next(s['at'] for s in log['states'] if s['state'] == 'gallery-idle')
    return {'idleMs':round(idle-start), 'scrollDelta':round(after-before)}


def interrupted_open(page, label, resize=False):
    source = page.locator('[data-tab-pane-active] ' + THUMB + '[data-image-hero-id="3000"]')
    source.evaluate("n=>{const s=document.querySelector('[data-image-hero-gallery-scroll]');s.scrollTop=0;}")
    page.wait_for_timeout(350)
    record(page)
    # Trigger from DOM to catch the same rendered frame, without automation round-trip latency.
    sample = source.locator('..').evaluate("""(link, resize) => new Promise((resolve,reject) => {
      link.click();
      let resized=false;
      const deadline=performance.now()+6000;
      function check(){
        if(performance.now()>deadline){reject(new Error('No interruptible opening flight'));return;}
        const fly=document.querySelector('.image-hero-flyer');
        const a=fly?.getAnimations()[0];
        if(!a || Number(a.currentTime)<60){requestAnimationFrame(check);return;}
        if(resize && !resized){
          resized=true;
          const host=document.querySelector('[data-image-detail-host]');
          host.style.marginRight='80px';
          window.dispatchEvent(new Event('orientationchange'));
          requestAnimationFrame(()=>requestAnimationFrame(check));return;
        }
        const content=document.querySelector('[data-image-hero-stage] [data-image-detail-crossfade]');
        const header=document.querySelector('[data-image-hero-stage] [data-image-detail-reveal="header"]');
        const read=()=>({opacity:Number(getComputedStyle(content).opacity),
          header:getComputedStyle(header).transform, rect:fly.getBoundingClientRect().toJSON()});
        const before=read();
        window.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true}));
        resolve({before,after:read()});
      }requestAnimationFrame(check);
    })""", resize)
    assert abs(sample['before']['opacity']-sample['after']['opacity']) < .01, sample
    assert sample['before']['header'] == sample['after']['header'], sample
    for prop in ['x','y','width','height']:
        assert abs(sample['before']['rect'][prop]-sample['after']['rect'][prop]) < 3, sample
    state(page, 'gallery-idle')
    save(page, label)
    assert_clean(page)
    if resize:
        page.locator('[data-image-detail-host]').evaluate("n=>n.style.marginRight=''")
    return sample


def opening_handoff(page, label):
    source = page.locator('[data-tab-pane-active] '+THUMB+'[data-image-hero-id="3000"]')
    source.evaluate("n=>{const s=document.querySelector('[data-image-hero-gallery-scroll]');s.scrollTop=0;}")
    page.wait_for_timeout(350)
    record(page)
    source.locator('..').evaluate("""link=>{
      link.click();
      window.__stageScroll=setInterval(()=>{
        const s=document.querySelector('[data-image-hero-stage-scroll]');
        if(s){window.__oldStage=s;s.dispatchEvent(new WheelEvent('wheel',
          {deltaY:5,bubbles:true,cancelable:true}));}
      },24);
    }""")
    page.wait_for_function("document.querySelector('[data-image-hero-route-state=active]')")
    route = page.locator(ROUTE)
    box = route.bounding_box()
    page.mouse.move(box['x']+box['width']*.7, box['y']+250)
    start = page.evaluate('performance.now()')
    for _ in range(4):
        page.mouse.wheel(0,30)
        page.wait_for_timeout(30)
    state(page,'detail-idle',timeout=600)
    top = route.evaluate('(n)=>n.scrollTop')
    page.evaluate('clearInterval(window.__stageScroll);window.__oldStage.scrollTop+=300')
    page.wait_for_timeout(160)
    assert route.evaluate('(n)=>n.scrollTop') >= top-1, 'Old Stage overwrote the new route scroll'
    log = save(page,label)
    idle = next(s['at'] for s in log['states'] if s['state']=='detail-idle')
    assert idle-start < 350, f'New route input still waited: {idle-start}ms'
    assert top > 60
    page.keyboard.press('Escape')
    assert_clean(page)
    return {'handoffAfterInputMs':round(idle-start),'scroll':round(top)}


def cancelled_return(page, label):
    open_image(page)
    page.locator(ROUTE).evaluate('(n)=>n.scrollTop=85')
    page.wait_for_timeout(350)
    record(page)
    sample = page.evaluate("""() => new Promise((resolve,reject)=>{
      history.back();
      const deadline=performance.now()+6000;
      function check(){
        if(performance.now()>deadline){reject(new Error('No interruptible closing flight'));return;}
        const fly=document.querySelector('.image-hero-flyer');const a=fly?.getAnimations()[0];
        if(!a||Number(a.currentTime)<90){requestAnimationFrame(check);return;}
        const node=document.querySelector('[data-image-hero-surface-id] [data-image-detail-crossfade]');
        const read=()=>({opacity:Number(getComputedStyle(node).opacity),rect:fly.getBoundingClientRect().toJSON()});
        const before=read();
        history.forward();
        const old=a;
        function reversed(){
          if(performance.now()>deadline){reject(new Error('Closing flight did not reverse'));return;}
          if(fly.getAnimations()[0]===old){requestAnimationFrame(reversed);return;}
          resolve({before,after:read(),direction:document.documentElement.dataset.imageHeroTransition});
        }requestAnimationFrame(reversed);
      }requestAnimationFrame(check);
    })""")
    assert sample['direction']=='forward', sample
    assert abs(sample['before']['opacity']-sample['after']['opacity']) < .12, sample
    # history.forward is asynchronous; continuity is sampled separately by interrupted_open.
    state(page,'detail-idle')
    expect(page.locator('[data-image-hero-role=detail]')).to_be_visible()
    assert page.locator(ROUTE).evaluate('(n)=>n.scrollTop')==85
    assert page.locator(GALLERY).evaluate('(n)=>n.inert'), 'Reopened detail left gallery active'
    save(page,label)
    page.keyboard.press('Escape')
    assert_clean(page)
    return {'direction':sample['direction'],'poseError':max(abs(sample['before']['rect'][p]-sample['after']['rect'][p]) for p in ['x','y','width','height'])}


def pull_frame(page, label):
    open_image(page)
    route=page.locator(ROUTE)
    route.evaluate('(n)=>n.scrollTop=0')
    page.wait_for_timeout(150)
    result=route.evaluate("""n=>new Promise(resolve=>{
      const box=n.getBoundingClientRect(),x=box.x+box.width/2,y=box.y+100;
      const send=(type,dy)=>n.dispatchEvent(new PointerEvent(type,{bubbles:true,cancelable:true,
        pointerId:77,pointerType:'touch',isPrimary:true,clientX:x,clientY:y+dy}));
      const value=()=>new DOMMatrixReadOnly(getComputedStyle(n.querySelector('.image-detail-overlay-content')).transform).m42;
      send('pointerdown',0);send('pointermove',20);
      requestAnimationFrame(()=>{
        const first=value();send('pointermove',45);
        requestAnimationFrame(()=>{const second=value();send('pointercancel',45);resolve({first,second});});
      });
    })""")
    assert abs(result['first']-20/(1+20/360))<.01,result
    assert abs(result['second']-45/(1+45/360))<.01,'Drag lagged an extra frame: '+str(result)
    page.wait_for_function("!document.querySelector('[data-image-hero-pulling]')")
    page.keyboard.press('Escape')
    assert_clean(page)
    return result


def pull_loading_content(page, fixtures, label):
    # Fresh sparse image: metadata arrives while the user's finger is held still.
    # New reveal nodes must inherit the live gesture pose, then fully clean up.
    source = page.locator('[data-tab-pane-active] '+THUMB+'[data-image-hero-id="3004"]')
    source.evaluate("n=>{const s=document.querySelector('[data-image-hero-gallery-scroll]');s.scrollTop+=n.getBoundingClientRect().top-s.getBoundingClientRect().top-140;}")
    fixtures.hold_details = True
    try:
        source.locator('..').evaluate('n=>n.click()')
        state(page,'detail-idle')
        route = page.locator(ROUTE)
        route.evaluate('n=>n.scrollTop=0')
        page.wait_for_timeout(180)
        assert any(image_id == 3004 for _,image_id in fixtures.pending_details), 'Test needs pending metadata for this image'
        width_before = route.evaluate('n=>n.clientWidth')
        route.evaluate("""n=>{
          const box=n.getBoundingClientRect(),x=box.x+box.width/2,y=box.y+100;
          window.__heldPull=(type,dy)=>n.dispatchEvent(new PointerEvent(type,{bubbles:true,cancelable:true,
            pointerId:78,pointerType:'touch',isPrimary:true,clientX:x,clientY:y+dy}));
          window.__heldPull('pointerdown',0);window.__heldPull('pointermove',45);
        }""")
        page.wait_for_function("document.querySelector('[data-image-hero-pulling]')!==null")
        fixtures.release_details()
        expect(page.locator('[data-image-hero-surface-id] [data-image-detail-reveal="header"]')).to_contain_text('fixture')
        values = route.evaluate("""n=>{
          const root=n.closest('[data-image-detail-overlay]');
          return {y:new DOMMatrixReadOnly(getComputedStyle(n.querySelector('.image-detail-overlay-content')).transform).m42,
            fades:[...root.querySelectorAll('[data-image-detail-surface],[data-image-detail-reveal]')].map(el=>Number(getComputedStyle(el).opacity))};
        }""")
        assert abs(values['y']-45/(1+45/360))<.01, values
        assert all(abs(value-(1-45/140))<.001 for value in values['fades']),values
        assert route.evaluate('n=>n.clientWidth') == width_before, 'Pull changed the media gutter'
        page.evaluate("window.__heldPull('pointercancel',45)")
        page.wait_for_function("!document.querySelector('[data-image-hero-pulling]')")
        assert route.evaluate("n=>getComputedStyle(n.querySelector('.image-detail-overlay-content')).transform")=='none'
        assert route.evaluate('n=>getComputedStyle(n).overflowY') == 'auto'
        box = route.bounding_box()
        page.mouse.move(box['x']+box['width']/2,box['y']+box['height']/2)
        page.mouse.wheel(0,90)
        page.wait_for_function("document.querySelector('[data-image-hero-surface-id] .image-detail-overlay-scroll').scrollTop>0")
        page.keyboard.press('Escape')
        assert_clean(page, 3004)
        return {'asyncContentKeptPose':True,'cleanup':True}
    finally:
        fixtures.release_details()


def return_focus(page,label):
    open_image(page)
    page.keyboard.press('Escape')
    page.wait_for_function("!document.querySelector('[data-image-hero-gallery-scroll]').inert")
    target=page.locator('[data-tab-pane-active] '+THUMB+'[data-image-hero-id="3001"]').locator('..')
    target.focus()
    immediate=target.evaluate('(n)=>document.activeElement===n')
    assert immediate,'Closing detail trapped the gallery focus'
    assert_clean(page)
    page.wait_for_timeout(100)
    assert target.evaluate('(n)=>document.activeElement===n'),'Old route stole the new focus at cleanup'
    return {'newFocusRetained':True}


def loading_escape_scroll(page, fixtures, label, delay):
    fixtures.hold_details = True
    page.goto(BASE+'/user/1',wait_until='networkidle')
    source = page.locator('[data-tab-pane-active] '+THUMB+'[data-image-hero-id="3000"]')
    source.evaluate("n=>{const s=document.querySelector('[data-image-hero-gallery-scroll]');s.scrollTop+=n.getBoundingClientRect().top-s.getBoundingClientRect().top-140;}")
    page.wait_for_function("""() => {const i=document.querySelector('[data-tab-pane-active] [data-image-hero-id="3000"] img');
      return i?.complete&&i.naturalWidth>0&&getComputedStyle(i).opacity==='1';}""")
    page.wait_for_timeout(350)
    record(page)
    source.locator('..').click()
    page.wait_for_timeout(delay)
    assert fixtures.pending_details, 'Test needs an outstanding metadata response'
    page.mouse.move(210 if page.viewport_size['width']<500 else 800,460)
    start = page.evaluate('performance.now()')
    # Same input task window: no waiting for the preceding wheel's smooth-scroll tail.
    page.mouse.wheel(0,35)
    page.keyboard.press('Escape')
    for _ in range(22):
        page.mouse.wheel(0,22)
        page.wait_for_timeout(25)
    assert_clean(page)
    fixtures.release_details()
    page.wait_for_timeout(150)
    # The old response must neither reclaim the screen nor poison the next open.
    assert_clean(page)
    log=save(page,label)
    gaps=[b['at']-a['at'] for a,b in zip(log['frames'],log['frames'][1:])]
    assert max(gaps,default=0)<1000, f'Main thread stalled: {max(gaps)}ms'
    open_image(page)
    page.keyboard.press('Escape')
    assert_clean(page)
    return {'inputAt':round(start),'maxFrameGap':round(max(gaps,default=0)),'nextOpen':'responsive'}


def run(browser, name, width):
    context = browser.new_context(viewport={'width':width,'height':900}, reduced_motion='no-preference',
                                  is_mobile=width<500, has_touch=width<500)
    fixtures = Fixtures()
    fixtures.hold_uploads = False
    fixtures.hold_details = False
    context.route('**/*', fixtures)
    stored = {'picpony_dev_banner_dismissed':'true', 'trixie_use_cdn':'false',
              'picpony_use_proxy':'false', 'picpony_hk_relay':'false', 'picpony_motion':'standard',
              'picpony_motion_speed':'default', 'user_info':json.dumps(USER)}
    context.add_init_script('for(const [k,v] of Object.entries('+json.dumps(stored)+'))localStorage.setItem(k,v)')
    context.add_init_script('window.__installHeroRecorder=('+RECORDER+');window.__installHeroRecorder()')
    page = context.new_page()
    page.set_default_timeout(12000)
    errors = []
    page.on('pageerror', lambda e: errors.append(str(e)))
    cdp = context.new_cdp_session(page)
    try:
        page.goto(BASE+'/user/1', wait_until='networkidle')
        expect(page.locator('[data-tab-pane-active] '+THUMB)).to_have_count(12)
        page.wait_for_timeout(600)
        cases = [(f'wheel-{gap}', lambda label,gap=gap: wheel_return(page,label,gap)) for gap in [0,110,245,320]]
        if width >= 500:
            cases += [('wheel-before', lambda label: wheel_return(page,label,0,True)),
                      ('stale-wheel-takeover', lambda label: stale_wheel_takeover(page,label))]
        else:
            cases += [(f'touch-{gap}', lambda label,gap=gap: touch_return(page,cdp,label,gap)) for gap in [70,245,320]]
        cases += [('interrupt', lambda label: interrupted_open(page,label)),
                  ('stale-wheel-expiry', lambda label: stale_wheel_expiry(page,label)),
                  ('resize-interrupt', lambda label: interrupted_open(page,label,True)),
                  ('opening-handoff', lambda label: opening_handoff(page,label)),
                  ('cancel-return', lambda label: cancelled_return(page,label)),
                  ('pull-frame', lambda label: pull_frame(page,label)),
                  ('pull-loading', lambda label: pull_loading_content(page,fixtures,label)),
                  ('return-focus', lambda label: return_focus(page,label))]
        cases += [(f'loading-escape-scroll-{delay}', lambda label,delay=delay:
                   loading_escape_scroll(page,fixtures,label,delay)) for delay in [40,170,260,450]]
        if REQUESTED_CASES:
            cases = [(case,work) for case,work in cases if case in REQUESTED_CASES]
        MATCHED_CASES.update(case for case,_ in cases)
        for case, work in cases:
            label = name+'-'+case
            try:
                result = work(label)
                RESULTS.append({'case':label, **result})
                print('PASS '+label+' '+json.dumps(result if 'before' not in result else {'continuousPose':True}), flush=True)
            except Exception as e:
                FAILURES.append({'case':label,'error':str(e),'pageErrors':errors.copy()})
                save(page,label+'-failure')
                page.screenshot(path=str(OUTPUT/(label+'-failure.png')))
                print('FAIL '+label+' '+str(e), flush=True)
                page.wait_for_timeout(4500)
                page.goto(BASE+'/user/1',wait_until='networkidle')
                page.wait_for_timeout(600)
        assert not errors, errors
    finally:
        context.close()


with sync_playwright() as playwright:
    browser = playwright.chromium.launch(channel='msedge',headless=True)
    for profile in [('desktop',1440),('mobile',390)]:
        run(browser,*profile)
    browser.close()
for missing in sorted(REQUESTED_CASES - MATCHED_CASES):
    FAILURES.append({'case':missing,'error':'Unknown hero test case'})
(OUTPUT/'results.json').write_text(json.dumps({'results':RESULTS,'failures':FAILURES},indent=2),encoding='utf-8')
print(f'{len(RESULTS)} passed, {len(FAILURES)} failed; {OUTPUT / "results.json"}',flush=True)
sys.exit(1 if FAILURES else 0)
