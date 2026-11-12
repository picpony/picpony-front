"""Hero interruption, native scroll boundaries and the viewer's own navigation (上一张 / 下一张,
Back/Forward, reload, layers) on a production build.

Run: npm run build && npm run test:hero
CDP touch and Playwright wheel input exercise real hit testing/default scrolling. The
separate stale-receiver case deliberately dispatches to the outgoing node to cover wheel
latching consistently across Chromium versions. All business/media requests use fixtures.
"""
import json
import os
import pathlib
import random
import re
import sys
from playwright.sync_api import sync_playwright, expect
import urllib.parse

# `HERO_BROWSER_CHANNEL=chromium` runs on Playwright's bundled Chromium (CI / Linux sandboxes).
from browserLaunch import browser_options
BROWSER_CHANNEL = browser_options()
from testProfileGallery import BASE, Fixtures, USER, THUMB, image_record, unwrap

OUTPUT = pathlib.Path(__file__).resolve().parent.parent / '.workbuddy' / 'hero-interactions'
OUTPUT.mkdir(parents=True, exist_ok=True)
RESULTS = []
FAILURES = []
REQUESTED_CASES = {arg.split('=',1)[1] for arg in sys.argv if arg.startswith('--case=')}
REQUESTED_PROFILES = {arg.split('=',1)[1] for arg in sys.argv if arg.startswith('--profile=')}
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
  // Every history write and traversal, and every popstate: the order a race resolved in.
  const heroRole = state => state?.__picponyImageHero ? state.__picponyImageHero.role + ':' + state.__picponyImageHero.imageId : null;
  const historyProto = History.prototype;
  for (const name of ['pushState','replaceState','go','back','forward']) {
    const original = historyProto[name];
    historyProto[name] = function(...args) {
      if(window.__heroRecord)window.__heroLog.events.push({at:performance.now(),type:'history.'+name,
        marker:name.endsWith('State')?heroRole(args[0]):null,
        arg:name.endsWith('State')?String(args[2]??''):args[0],from:location.pathname});
      return original.apply(this,args);
    };
  }
  window.addEventListener('popstate', e => {
    if(window.__heroRecord)window.__heroLog.events.push({at:performance.now(),type:'popstate',
      marker:heroRole(e.state),at_url:location.pathname});
  }, true);
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
    expect(page.locator('[data-image-hero-close-shield]')).to_have_count(0)
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


def hold_close_shield(page, input_type):
    """Keep the real first-frame shield until native input reaches it, then release ready."""
    page.evaluate("""type => {
      const native=Element.prototype.animate,gates=[];
      window.__shieldInputs=[];
      const gallery=document.querySelector('[data-image-hero-gallery-scroll]');
      const input=e=>{
        window.__shieldInputs.push({at:performance.now(),trusted:e.isTrusted,
          shield:e.target?.hasAttribute?.('data-image-hero-close-shield'),
          gallery:e.composedPath().includes(gallery),scroll:gallery.scrollTop});
        if(window.__shieldInputs.length===1)setTimeout(()=>gates.splice(0).forEach(release=>release()),80);
      };
      addEventListener(type,input,{capture:true,passive:true});
      Element.prototype.animate=function(...args){
        const animation=Reflect.apply(native,this,args);
        if(this.matches('.image-hero-flyer')&&document.documentElement.dataset.imageHeroState==='closing.flight'){
          const ready=animation.ready,gate=new Promise(resolve=>gates.push(resolve));
          Object.defineProperty(animation,'ready',{configurable:true,
            value:Promise.all([ready,gate]).then(()=>animation)});
        }
        return animation;
      };
      window.__restoreCloseShield=()=>{
        Element.prototype.animate=native;
        removeEventListener(type,input,true);
        gates.splice(0).forEach(release=>release());
      };
    }""", input_type)


def shield_scroll(page, cdp, label, touch=False):
    """Start one native scroll stream on the real shield and keep it moving past removal."""
    open_image(page)
    bounds = page.locator(GALLERY).bounding_box()
    offsets = page.locator(GALLERY).evaluate('n=>({top:n.scrollTop,max:n.scrollHeight-n.clientHeight})')
    before = offsets['top']
    direction = 1 if touch or offsets['max']-before >= 300 else -1
    room = offsets['max']-before if direction > 0 else before
    distance = min(400, room-16)
    assert distance > 120, offsets
    x = bounds['x'] + bounds['width']*.55
    y = bounds['y'] + bounds['height']*.82
    hold_close_shield(page, 'touchstart' if touch else 'wheel')
    start = record(page)
    touching = False
    initial = None
    try:
        page.keyboard.press('Escape')
        page.locator('[data-image-hero-close-shield]').wait_for(state='attached')
        if touch:
            cdp.send('Input.dispatchTouchEvent', {'type':'touchStart','touchPoints':[{'x':x,'y':y}]})
            touching = True
            for i in range(1,25):
                cdp.send('Input.dispatchTouchEvent', {'type':'touchMove',
                    'touchPoints':[{'x':x,'y':y-distance*i/24}]})
                page.wait_for_timeout(25)
                if i==6:
                    initial = page.locator(GALLERY).evaluate('n=>n.scrollTop')-before
            # The same finger is still held after the shield and route have left.
            state(page, 'gallery-idle')
            after = page.locator(GALLERY).evaluate('n=>n.scrollTop')
            cdp.send('Input.dispatchTouchEvent', {'type':'touchEnd','touchPoints':[]})
            touching = False
        else:
            # A single browser-generated wheel gesture preserves scroll latching. Repeated
            # mouse.wheel calls may start fresh streams and hide the lost-first-packet bug.
            cdp.send('Input.synthesizeScrollGesture', {'x':x,'y':y,'yDistance':-direction*distance,
                'speed':max(1,round(distance/5)),'gestureSourceType':'mouse','preventFling':True})
            inputs = page.evaluate('window.__shieldInputs')
            early = next(event for event in inputs if event['at'] >= inputs[0]['at']+500)
            initial = direction*(early['scroll']-before)
            after = page.locator(GALLERY).evaluate('n=>n.scrollTop')
        first = page.evaluate('window.__shieldInputs[0]')
        assert first and first['trusted'] and first['shield'] and first['gallery'], first
        assert initial > 15, f'The first part of the native stream did not scroll: {initial}'
        assert direction*(after-before) > distance*.8, (before, after, distance)
        assert_clean(page)
        log = save(page, label)
        idle = next(s['at'] for s in log['states'] if s['state']=='gallery-idle')
        assert idle-start < 1200, f'The new stream waited for an old receiver: {idle-start}'
        return {'nativeInput':'touch' if touch else 'wheel','firstInputOnShield':True,
                'initialDelta':round(initial),'totalDelta':round(direction*(after-before))}
    finally:
        if touching:
            cdp.send('Input.dispatchTouchEvent', {'type':'touchEnd','touchPoints':[]})
        page.evaluate('() => { window.__restoreCloseShield(); }')


def shield_tap(page, cdp, label, touch=False):
    """A native tap during the shield still reopens once and leaves no shield after close."""
    open_image(page)
    before = page.evaluate('({key:navigation.currentEntry.key,index:navigation.currentEntry.index})')
    source = page.locator('[data-tab-pane-active] '+THUMB+'[data-image-hero-id="3000"]')
    box = source.bounding_box()
    x,y = box['x']+box['width']/2, box['y']+box['height']/2
    hold_close_shield(page, 'pointerdown')
    record(page)
    try:
        page.keyboard.press('Escape')
        page.locator('[data-image-hero-close-shield]').wait_for(state='attached')
        if touch:
            cdp.send('Input.dispatchTouchEvent', {'type':'touchStart','touchPoints':[{'x':x,'y':y}]})
            cdp.send('Input.dispatchTouchEvent', {'type':'touchEnd','touchPoints':[]})
        else:
            page.mouse.click(x,y)
        first = page.evaluate('window.__shieldInputs[0]')
        assert first and first['trusted'] and first['shield'] and first['gallery'], first
        state(page, 'detail-idle')
        expect(page.locator('[data-image-hero-close-shield]')).to_have_count(0)
        after = page.evaluate('({key:navigation.currentEntry.key,index:navigation.currentEntry.index})')
        assert after == before, (before, after)
    finally:
        page.evaluate('() => { window.__restoreCloseShield(); }')
    page.keyboard.press('Escape')
    assert_clean(page)
    save(page, label)
    return {'firstInputOnShield':True,'tapReplayedOnce':True,'cleanup':True}


def continued_scroll(page, cdp, label, touch=False, opening=False, reopen=False):
    """One native stream starts on detail/Stage and continues after that exact node is removed."""
    open_image(page)
    if opening:
        page.keyboard.press('Escape')
        assert_clean(page)
    gallery_box = page.locator(GALLERY).bounding_box()
    x = gallery_box['x'] + gallery_box['width']*.55
    y = gallery_box['y'] + gallery_box['height']*.78
    page.evaluate("""({touch,opening,reopen}) => {
      const gallery=document.querySelector('[data-image-hero-gallery-scroll]');
      let source=null,closeTimer=0,reopenTimer=0;
      const log=window.__continuedLog={frames:[],first:null,close:null,reopen:null};
      const snapshot=window.__continuedSnapshot=()=>({at:performance.now(),gallery:gallery.scrollTop,
        old:source?.scrollTop??0,connected:Boolean(source?.isConnected),phase:document.documentElement.dataset.imageHeroState});
      const requestClose=()=>{
        log.close=snapshot();
        window.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true}));
        if(reopen)reopenTimer=setTimeout(()=>{
          log.reopen=snapshot();
          document.querySelector('[data-tab-pane-active] [data-image-hero-id="3000"]')?.closest('a').click();
        },900);
      };
      const input=e=>{
        if(log.first)return;
        source=e.composedPath().find(n=>n instanceof HTMLElement&&n.classList.contains('image-detail-overlay-scroll'));
        log.first={...snapshot(),trusted:e.isTrusted,source:Boolean(source),
          stage:Boolean(source?.hasAttribute('data-image-hero-stage-scroll'))};
        if(!touch)closeTimer=setTimeout(requestClose,opening?60:180);
      };
      const type=touch?'touchstart':'wheel';
      addEventListener(type,input,{capture:true,passive:true});
      window.__continuedOn=true;
      const frame=()=>{if(window.__continuedOn){log.frames.push(snapshot());requestAnimationFrame(frame);}};
      requestAnimationFrame(frame);
      window.__restoreContinued=()=>{
        window.__continuedOn=false;removeEventListener(type,input,true);
        clearTimeout(closeTimer);clearTimeout(reopenTimer);
      };
    }""", {'touch':touch,'opening':opening,'reopen':reopen})
    touching = False
    try:
        if opening:
            source = page.locator('[data-tab-pane-active] '+THUMB+'[data-image-hero-id="3000"]')
            box = source.bounding_box()
            x,y = box['x']+box['width']/2, box['y']+box['height']/2
            source.locator('..').evaluate('n=>n.click()')
            page.wait_for_function("p=>Boolean(document.elementFromPoint(p.x,p.y)?.closest('.image-detail-overlay-scroll'))", arg={'x':x,'y':y})
        if touch:
            cdp.send('Input.dispatchTouchEvent', {'type':'touchStart','touchPoints':[{'x':x,'y':y}]})
            touching = True
            for distance in [25,50,75]:
                cdp.send('Input.dispatchTouchEvent', {'type':'touchMove','touchPoints':[{'x':x,'y':y-distance}]})
                page.wait_for_timeout(25)
            page.evaluate('window.__continuedLog.close=window.__continuedSnapshot()')
            page.keyboard.press('Escape')
            for i in range(1,121):
                cdp.send('Input.dispatchTouchEvent', {'type':'touchMove','touchPoints':[{'x':x,'y':y-75-i*2}]})
                page.wait_for_timeout(25)
            cdp.send('Input.dispatchTouchEvent', {'type':'touchEnd','touchPoints':[]})
            touching = False
        else:
            cdp.send('Input.synthesizeScrollGesture', {'x':x,'y':y,'yDistance':-400,'speed':65,
                'gestureSourceType':'mouse','preventFling':True})
        page.wait_for_timeout(450)
        data = page.evaluate('window.__continuedLog')
        (OUTPUT/(label+'.json')).write_text(json.dumps(data,indent=2),encoding='utf-8')
        assert data['first']['trusted'] and data['first']['source'], data['first']
        assert data['close'] and data['close']['old'] > 0, 'The native stream must already be scrolling before close'
        if opening:
            assert data['close']['phase'].startswith('opening'), data['close']
        frames = [f for f in data['frames'] if f['at'] >= data['close']['at']]
        idle = next(f for f in frames if f['phase']=='gallery-idle')
        assert idle['at']-data['close']['at'] < 1200, 'A live stream must not hold history behind timeout budgets'
        gone = next(f for f in frames if not f['connected'])
        if reopen:
            assert data['reopen'] and data['reopen']['phase']=='gallery-idle', data['reopen']
            state(page, 'detail-idle')
            later = [f for f in frames if f['at'] > data['reopen']['at']+100]
            assert max(abs(f['gallery']-data['reopen']['gallery']) for f in later) < 1, 'The old relay scrolled beneath a new Hero'
            page.keyboard.press('Escape')
        else:
            later = [f for f in frames if f['at'] > gone['at']+800]
            assert later[-1]['gallery']-later[0]['gallery'] > 30, 'Scroll stopped when the old route was removed'
            movement = frames[-1]['gallery']-data['close']['gallery']
            assert movement > (200 if touch else 300), movement
            positions = [f['gallery'] for f in frames]
            assert all(b>=a-1 for a,b in zip(positions,positions[1:])), 'The removed source pulled the gallery backwards'
        assert_clean(page)
        return {'startedOn':'stage' if data['first']['stage'] else 'route',
                'closedWhileMoving':True,'continuedAfterUnmount':not reopen,'newHeroProtected':reopen}
    finally:
        if touching:
            cdp.send('Input.dispatchTouchEvent', {'type':'touchEnd','touchPoints':[]})
        page.evaluate('() => { window.__restoreContinued(); }')


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


def detail_content_handoff(page, fixtures, label, tier='standard', empty=False):
    """Static chrome survives adoption; a held record expands only the content below its rows."""
    page.mouse.move(1, 1)
    fixtures.hold_details = True
    try:
        fresh_profile(page)
        source = page.locator('[data-tab-pane-active] '+THUMB+'[data-image-hero-id="3004"]')
        source.scroll_into_view_if_needed()
        page.wait_for_timeout(350)
        page.evaluate("""() => {
          window.__detailFrames=[]; window.__recordDetail=true;
          const frame=()=>{
            if(!window.__recordDetail)return;
            const stage=document.querySelector('[data-image-hero-stage]');
            const route=document.querySelector('[data-image-hero-surface-id]');
            const sample=root=>{
              const actions=root?.querySelector('[data-image-detail-actions]');
              if(!actions)return null;
              const headings=[...root.querySelectorAll('h2')].filter(n=>n.checkVisibility()).map(n=>n.textContent);
              return {visible:actions.checkVisibility(),y:actions.getBoundingClientRect().y,headings};
            };
            window.__detailFrames.push({phase:document.documentElement.dataset.imageHeroState,
              stage:sample(stage),route:sample(route)});
            requestAnimationFrame(frame);
          };
          requestAnimationFrame(frame);
        }""")
        source.locator('..').click()
        state(page, 'detail-idle')
        page.wait_for_timeout(180)
        frames = page.evaluate('window.__recordDetail=false;window.__detailFrames')
        opening = [f for f in frames if f['phase'].startswith('opening')]
        assert opening, 'Test must observe a real flight'
        assert any(f['stage'] and f['stage']['visible'] for f in opening), 'Actions waited for landing'
        optional = ['艺术家', '图中包含的 OC', '简介', '来源']
        for f in opening:
            visible = f['route'] if f['route'] and f['route']['visible'] else f['stage']
            assert visible and visible['visible'], 'Static content disappeared during handoff'
            assert '标签' in visible['headings'], visible
            assert not any(title in visible['headings'] for title in optional), visible

        route = page.locator(ROUTE)
        expect(route.get_by_role('button', name='下载原图', exact=True)).to_be_visible()
        expect(route.get_by_role('button', name='收藏', exact=True)).to_be_enabled()
        expect(route.locator('[data-image-detail-score-loading]')).to_have_count(1)
        assert any(i == 3004 for _, i in fixtures.pending_details), 'Test needs an unresolved record'
        route.get_by_role('button', name='分享', exact=True).click()
        expect(page.get_by_role('menu', name='分享', exact=True)).to_be_visible()
        page.keyboard.press('Escape')

        page.evaluate("""tier => {
          // Isolate list motion: changing the image tier would start its CSS arrival too.
          document.documentElement.dataset.motion='custom';
          document.documentElement.dataset.motionEffects='list:'+tier;
          document.documentElement.dataset.motionList=tier;
          const scroller=document.querySelector('[data-image-hero-surface-id] .image-detail-overlay-scroll');
          const root=scroller.closest('[data-image-hero-surface-id]');
          const tagHeading=root.querySelector('[data-image-detail-tag-section="regular"]');
          scroller.scrollTop+=tagHeading.getBoundingClientRect().top-scroller.getBoundingClientRect().top-160;
          window.__fixedDetailNodes=[...root.querySelectorAll('[data-image-detail-actions] button,[data-image-detail-tag-section="regular"] h2')];
          window.__sampleDetail=()=>{
            const y=selector=>root.querySelector(selector).getBoundingClientRect().top+scroller.scrollTop;
            return {image:y('[data-image-detail-media]'),actions:y('[data-image-detail-actions]'),
              tags:y('[data-image-detail-tag-section="regular"]')};
          };
          window.__detailLayout=[];window.__recordDetail=true;
          const frame=()=>{if(!window.__recordDetail)return;
            window.__detailLayout.push(window.__sampleDetail());requestAnimationFrame(frame);};
          requestAnimationFrame(frame);
        }""", tier)
        before = page.evaluate('window.__sampleDetail()')
        pending = fixtures.pending_details.copy()
        fixtures.pending_details.clear()
        fixtures.hold_details = False
        for held, image_id in pending:
            data = image_record(image_id)
            if image_id == 3004 and not empty:
                data['tags'] = ([f'artist:Fixture Artist {i:02}' for i in range(28)] +
                                [f'oc:Fixture Pony {i:02}' for i in range(8)] + ['pony', 'safe', 'solo'])
                data['description'] = 'Fixture description\n\nA second paragraph fills the existing section.'
                data['source_urls'] = ['https://example.test/art/3004']
            fixtures.json(held, {'image': data})
        expect(route.locator('[data-image-detail-score-loading]')).to_have_count(0)
        if not empty:
            expect(route.get_by_role('button', name='Fixture Artist 27', exact=True)).to_have_count(1)
        page.wait_for_function("""!document.getAnimations().some(a=>
          a.effect?.target?.closest('[data-image-hero-surface-id]') &&
          a.effect.getKeyframes().some(f=>f.height!==undefined))""")
        after = page.evaluate('window.__sampleDetail()')
        samples = page.evaluate('window.__recordDetail=false;window.__detailLayout')
        intermediate = [f['tags'] for f in samples if before['tags'] + 1 < f['tags'] < after['tags'] - 1]
        if empty:
            for title in optional:
                expect(route.get_by_role('heading', name=title, exact=True)).to_have_count(0)
            assert abs(after['tags'] - before['tags']) < 1, 'Empty optional sections reserved space'
        else:
            assert after['tags'] > before['tags'] + 40, (before, after)
            if tier == 'off':
                assert not intermediate, 'Off tier interpolated the layout'
            else:
                assert len(set(round(v, 1) for v in intermediate)) >= 3, 'Multi-row content jumped instead of following'
        for key in ['image', 'actions']:
            assert abs(after[key] - before[key]) < 1, f'{key} moved as record values arrived: {before} -> {after}'
        assert page.evaluate('window.__fixedDetailNodes.every(n=>n.isConnected)'), 'Fixed chrome remounted'
        expect(route.locator('[data-image-detail-score-loading]')).to_have_count(0)
        page.screenshot(path=str(OUTPUT/(label+'.png')))
        page.evaluate("document.documentElement.dataset.motion='standard'")
        page.keyboard.press('Escape')
        assert_clean(page, 3004)
        return {'staticDuringFlight':True,'layoutTier':tier,'intermediateFrames':len(intermediate),
                'fixedGeometry':True,'retainedNodes':True,'emptyOptionalSections':empty}
    finally:
        page.evaluate("window.__recordDetail=false;document.documentElement.dataset.motion='standard'")
        fixtures.release_details()


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
    # The gallery is covered (`aria-hidden`, focus guarded) once the detail has settled — the commit after `detail-idle`, never
    # inside the reversed leg's frames (R12-009) — so wait for that commit rather than race it.
    page.wait_for_function("document.querySelector('[data-image-hero-gallery-scroll]').getAttribute('aria-hidden')==='true'", timeout=1000)
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
    # Rubber-banded finger travel, less the touch slop the recogniser spends deciding (6px).
    band=lambda raw: raw/(1+raw/360)
    assert abs(result['first']-band(20-6))<.01,result
    assert abs(result['second']-band(45-6))<.01,'Drag lagged an extra frame: '+str(result)
    page.wait_for_function("!document.querySelector('[data-image-hero-pulling]')")
    page.keyboard.press('Escape')
    assert_clean(page)
    return result


PULL_DRIVER = """n=>{
  const box=n.getBoundingClientRect(); const x0=box.x+box.width/2, y0=box.y+100; let t=0;
  window.__pull={ send(type,dx,dy){ n.dispatchEvent(new PointerEvent(type,{bubbles:true,cancelable:true,
    pointerId:79,pointerType:'touch',isPrimary:true,clientX:x0+dx,clientY:y0+dy})); } };
}"""


def pull_path(page, points, end='pointerup', gap=16):
    """Drive a synthetic touch pull through (dx, dy) points, one per frame-ish gap, then release."""
    page.locator(ROUTE).evaluate(PULL_DRIVER)
    page.evaluate("window.__pull.send('pointerdown',0,0)")
    for dx, dy in points:
        page.wait_for_timeout(gap)
        page.evaluate(f"window.__pull.send('pointermove',{dx},{dy})")
    last = points[-1]
    page.wait_for_timeout(4)
    page.evaluate(f"window.__pull.send('{end}',{last[0]},{last[1]})")


def pull_follow(page, label):
    """Once the vertical drag is claimed the surface follows the finger on both axes, along the
    finger's own direction (the vertical rubber band's ratio applies to the horizontal follow)."""
    open_image(page)
    route = page.locator(ROUTE)
    route.evaluate('(n)=>n.scrollTop=0')
    page.wait_for_timeout(150)
    route.evaluate(PULL_DRIVER)
    page.evaluate("window.__pull.send('pointerdown',0,0)")
    for dx, dy in [(0, 10), (10, 60), (40, 160)]:
        page.wait_for_timeout(30)
        page.evaluate(f"window.__pull.send('pointermove',{dx},{dy})")
    page.wait_for_timeout(60)
    pose = route.evaluate("""n=>{const m=new DOMMatrixReadOnly(getComputedStyle(n.querySelector('.image-detail-overlay-content')).transform);
      return {x:m.m41,y:m.m42};}""")
    page.evaluate("window.__pull.send('pointercancel',40,160)")
    page.wait_for_function("!document.querySelector('[data-image-hero-pulling]')")
    # Claimed at the slop boundary on the first move (0, 6); the band's ratio applies to both axes.
    raw = 160 - 6
    ratio = 1 / (1 + raw / 360)
    assert abs(pose['y'] - raw * ratio) < .5, pose
    assert abs(pose['x'] - 40 * ratio) < .5, pose
    state(page, 'detail-idle')
    page.keyboard.press('Escape')
    assert_clean(page)
    return pose


def pull_retreat(page, label):
    """Past the dismiss distance but moving back up at release: the hand is taking the pull
    back, so the detail stays (it used to commit on distance alone)."""
    open_image(page)
    page.locator(ROUTE).evaluate('(n)=>n.scrollTop=0')
    page.wait_for_timeout(150)
    pull_path(page, [(0, 20), (0, 60), (0, 110), (0, 160), (0, 190), (0, 175), (0, 150), (0, 128)])
    page.wait_for_timeout(500)
    state(page, 'detail-idle')
    page.wait_for_function("!document.querySelector('[data-image-hero-pulling]')")
    page.keyboard.press('Escape')
    assert_clean(page)
    return {'cancelled': True}


def pull_loading_content(page, fixtures, label):
    # Fresh sparse image: metadata arrives while the user's finger is held still.
    # New reveal nodes must inherit the live gesture pose, then fully clean up.
    # Fresh for real: an earlier case's hover intent or a viewer warming its neighbours may
    # already hold this picture's record, and then there is nothing left to arrive.
    page.mouse.move(1, 1)
    page.goto(BASE + '/user/1', wait_until='networkidle')
    expect(page.locator('[data-tab-pane-active] ' + THUMB)).to_have_count(12)
    page.wait_for_timeout(600)
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
            surface:Number(getComputedStyle(root.querySelector('[data-image-detail-surface]')).opacity),
            fades:[...root.querySelectorAll('[data-image-detail-reveal]')].map(el=>Number(getComputedStyle(el).opacity))};
        }""")
        assert abs(values['y']-(45-6)/(1+(45-6)/360))<.01, values
        assert all(abs(value-(1-(45-6)/140))<.001 for value in values['fades']),values
        assert values['surface'] == 1, values
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


def covered_tab_order(page,label):
    """Native Tab skips the covered list before it can scroll, in both directions."""
    open_image(page)
    page.wait_for_function("document.querySelector('[data-image-hero-gallery-scroll]').getAttribute('aria-hidden') === 'true'")
    gallery = page.locator(GALLERY)
    origin = gallery.evaluate('n => n.scrollTop')
    back = page.locator('[data-image-hero-surface-id] [data-image-detail-back-button]')
    back.focus()
    page.keyboard.press('Shift+Tab')
    assert page.evaluate("""() => {
      const active = document.activeElement;
      window.__heroChromeFocus = active;
      return active instanceof HTMLElement && active !== document.body &&
        !active.closest('[data-image-detail-overlay], [data-image-hero-gallery-scroll], [inert], [aria-hidden="true"]');
    }"""), 'Shift+Tab must reach live chrome before the detail'
    assert gallery.evaluate('n => n.scrollTop') == origin, 'Tab scrolled the covered gallery'
    page.keyboard.press('Tab')
    assert back.evaluate('n => document.activeElement === n'), 'Tab from chrome must reach the first detail control'
    assert gallery.evaluate('n => n.scrollTop') == origin
    # The initial dialog focus is the section itself (tabIndex=-1), outside the tab-stop list.
    page.locator('[data-image-hero-surface-id]').focus()
    page.keyboard.press('Shift+Tab')
    assert page.evaluate('document.activeElement === window.__heroChromeFocus')
    page.keyboard.press('Tab')
    assert back.evaluate('n => document.activeElement === n')
    assert gallery.evaluate('n => n.scrollTop') == origin
    page.keyboard.press('Escape')
    assert_clean(page)
    return {'chromeReachableBothWays': True, 'galleryScrollUnchanged': True}


def covered_release(page,label):
    """Off-screen slots stay covered through the return and are released in idle chunks."""
    open_image(page)
    page.wait_for_function("document.querySelector('[data-image-hero-gallery-scroll]').getAttribute('aria-hidden') === 'true'")
    page.evaluate("""() => {
      const gallery = document.querySelector('[data-image-hero-gallery-scroll]');
      window.__coverRelease = [];
      window.__coverObserver = new MutationObserver(() => window.__coverRelease.push({
        phase: document.documentElement.dataset.imageHeroState,
        covered: gallery.hasAttribute('data-gallery-covered'),
        live: gallery.querySelectorAll('[data-gallery-live]').length,
      }));
      window.__coverObserver.observe(gallery, {
        attributes: true, subtree: true, attributeFilter: ['data-gallery-covered', 'data-gallery-live'],
      });
    }""")
    page.keyboard.press('Escape')
    assert_clean(page)
    page.wait_for_function("!document.querySelector('[data-image-hero-gallery-scroll]').hasAttribute('data-gallery-covered')")
    released = page.evaluate('window.__coverObserver.disconnect(); window.__coverRelease')
    assert released and all(row['phase'] == 'gallery-idle' for row in released), released
    assert any(row['covered'] and row['live'] > 0 for row in released), 'Slots were released all at once'
    return {'releasedAfterLanding': True, 'releasedInChunks': True}


def return_focus(page,label):
    """A focus given to the gallery the moment a close hands it back is kept: the leaving detail
    must have let go of the keyboard in that same commit. It is taken inside the mutation that
    lifts the gallery's cover (`aria-hidden`) — polling for it from here was a race the full production run
    once lost, since the flight waits two frames before it starts."""
    open_image(page)
    page.evaluate("""() => { window.__handback = null;
      const gallery = document.querySelector('[data-image-hero-gallery-scroll]');
      const target = document.querySelector('[data-tab-pane-active] [data-image-hero-role="thumbnail"][data-image-hero-id="3001"]').closest('a');
      const observer = new MutationObserver(() => {
        if (gallery.getAttribute('aria-hidden') === 'true') return;
        observer.disconnect();
        target.focus();
        window.__handback = { immediate: document.activeElement === target, active: document.activeElement?.tagName };
      });
      observer.observe(gallery, { attributes: true, attributeFilter: ['aria-hidden'] }); }""")
    page.keyboard.press('Escape')
    page.wait_for_function('window.__handback !== null')
    handback=page.evaluate('window.__handback')
    target=page.locator('[data-tab-pane-active] '+THUMB+'[data-image-hero-id="3001"]').locator('..')
    assert handback['immediate'],f'Closing detail trapped the gallery focus: {handback}'
    assert target.evaluate('(n)=>document.activeElement===n'),'The leaving detail took the focus back'
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



# --- The detail's own navigation: 上一张 / 下一张 in the list's order, Back, reload (R10-009) ---

NAV = """() => { const nav = window.navigation; if (!nav) return null;
  return { index: nav.currentEntry.index,
    entries: nav.entries().map(e => { const u = new URL(e.url); return u.pathname + u.search; }),
    marker: history.state?.__picponyImageHero?.role ?? null }; }"""
DETAIL = '[data-image-hero-surface-id] [data-image-hero-role="detail"]'
# Flyer, Stage landing target and routed media per frame, for the landing checks.
LANDING = """() => { window.__landing = []; window.__landingOn = true; window.__landingTracks = 0;
  const rect = n => { if (!n) return null; const r = n.getBoundingClientRect(); return [r.x, r.y, r.width, r.height]; };
  const watched = new WeakSet();
  const sample = () => { const a=document.querySelector('.image-hero-flyer')?.getAnimations()[0];
    window.__landing.push({ at:performance.now(), time:a?.currentTime, duration:a?.effect.getTiming().duration,
      state: document.documentElement.dataset.imageHeroState,
      flyer: rect(document.querySelector('.image-hero-flyer')),
      routed: rect(document.querySelector('[data-image-hero-surface-id] [data-image-hero-role="detail"]')),
      target: rect(document.querySelector('[data-image-hero-stage-target]')) }); };
  const tick = () => {
    const flyer = document.querySelector('.image-hero-flyer');
    const a = flyer?.getAnimations()[0];
    if (a && !watched.has(a)) {
      watched.add(a);
      window.__landingTracks++;
      // Completion can dispose the flyer before the next rAF. Sample its actual endpoint,
      // rather than comparing an arbitrary penultimate spring frame with the settled slot.
      a.finished.then(() => {
        if (window.__landingOn && flyer.isConnected && flyer.getAnimations()[0] === a) sample();
      }, () => {});
    }
    sample();
    if(window.__resizeDetailTail && document.documentElement.dataset.imageHeroState==='opening.flight') {
      const content=document.querySelector('[data-image-hero-surface-id] .image-detail-overlay-content');
      if(content)content.style.paddingBottom=(window.__landing.length%2)+'px';
    }
    if (window.__landingOn) requestAnimationFrame(tick); };
  requestAnimationFrame(tick); }"""


def card_rect(page, image_id):
    return page.locator(f'[data-tab-pane-active] {THUMB}[data-image-hero-id="{image_id}"]').evaluate(
        "n => { const r = n.getBoundingClientRect(); return [r.x, r.y, r.width, r.height]; }")


def within(a, b, tolerance=0.5):
    return a is not None and b is not None and max(abs(x - y) for x, y in zip(a, b)) <= tolerance


def wait_detail(page, image_id, timeout=4000):
    """The viewer shows `image_id`, settled, and — once its idle slice has run — the ladder names it."""
    page.wait_for_function(
        f"""() => document.querySelector('{DETAIL}')?.getAttribute('data-image-hero-id') === '{image_id}'
          && document.documentElement.dataset.imageHeroState === 'detail-idle'""", timeout=timeout)
    expect(page).to_have_url(BASE + f'/pic/{image_id}', timeout=timeout)


def prev_next(page, label):
    open_image(page)
    before = page.evaluate(NAV)
    assert page.get_by_role('button', name='上一张').is_disabled(), 'The first picture offered 上一张'
    page.keyboard.press('ArrowRight')
    wait_detail(page, 3001)
    page.get_by_role('button', name='下一张').click()
    wait_detail(page, 3002)
    page.keyboard.press('ArrowLeft')
    wait_detail(page, 3001)
    # ←/→ belong to a field when one has focus.
    page.evaluate("""() => { const i = document.createElement('input'); i.id = '__typing';
      document.querySelector('[data-image-hero-surface-id]').append(i); i.focus(); }""")
    page.keyboard.press('ArrowRight')
    page.wait_for_timeout(400)
    assert page.locator(DETAIL).get_attribute('data-image-hero-id') == '3001', 'An arrow typed into a field stepped'
    page.evaluate("document.getElementById('__typing').remove()")
    after = page.evaluate(NAV)
    assert after['index'] == before['index'] and len(after['entries']) == len(before['entries']), (before, after)
    assert after['entries'][after['index']] == '/pic/3001' and after['marker'] == 'guard', after
    page.keyboard.press('Escape')
    assert_clean(page, 3001)
    closed = page.evaluate(NAV)
    assert closed['index'] == before['index'] - 3, (before, closed)
    return {'entries': len(after['entries']), 'index': after['index'], 'closedAt': closed['index']}


def step_back(page, label):
    """Back after stepping closes to the list and flies home to the picture on screen."""
    open_image(page)
    page.keyboard.press('ArrowRight')
    wait_detail(page, 3001)
    page.evaluate(LANDING)
    page.go_back()
    assert_clean(page, 3001)
    page.evaluate('window.__landingOn = false')
    frames = [f for f in page.evaluate('window.__landing') if f['flyer']]
    card = card_rect(page, 3001)
    assert frames, 'The close did not fly'
    assert within(frames[-1]['flyer'], card), f"Landed {frames[-1]['flyer']} vs card {card}"
    return {'frames': len(frames), 'landing': 'exact'}


def forward_replay(page, label):
    """Forward after a close replays the open of the picture the viewer closed on."""
    open_image(page)
    page.keyboard.press('ArrowRight')
    wait_detail(page, 3001)
    page.go_back()
    assert_clean(page, 3001)
    page.go_forward()
    wait_detail(page, 3001, timeout=6000)
    expect(page.locator('[data-image-hero-surface-id]')).to_be_visible()
    page.keyboard.press('Escape')
    assert_clean(page, 3001)
    return {'replayed': True}


def landing(page, label, resize_tail=False):
    """The last flyer frame is the destination's own box, both ways — within half a pixel, with a
    classic scrollbar's gutter between the scroller's border and padding edges (the regression
    that put every return 10px right of its thumbnail)."""
    source = page.locator('[data-tab-pane-active] ' + THUMB + '[data-image-hero-id="3000"]')
    source.evaluate("""n => {const s=document.querySelector('[data-image-hero-gallery-scroll]');
      s.scrollTop += n.getBoundingClientRect().top-s.getBoundingClientRect().top-140;}""")
    page.wait_for_function("""() => { const i=document.querySelector('[data-tab-pane-active] [data-image-hero-id="3000"] img');
      return i?.complete && i.naturalWidth>0 && getComputedStyle(i).opacity==='1'; }""")
    page.wait_for_timeout(350)
    gutter = page.locator(GALLERY).evaluate('n => n.offsetWidth - n.clientWidth')
    # Simulate repeated below-media layout changes while the window tracks interpolate.
    # These must not turn the sampled counter-transform's residual into a new landing box.
    page.evaluate('value=>window.__resizeDetailTail=value', resize_tail)
    page.evaluate(LANDING)
    source.locator('..').click()
    state(page, 'detail-idle')
    page.evaluate("""() => { window.__resizeDetailTail=false;
      document.querySelector('[data-image-hero-surface-id] .image-detail-overlay-content').style.paddingBottom=''; }""")
    page.evaluate('window.__landingOn = false')
    opening = [f for f in page.evaluate('window.__landing') if f['flyer']]
    (OUTPUT / (label+'-opening.json')).write_text(json.dumps(opening, indent=2), encoding='utf-8')
    assert opening, 'The open did not fly'
    last = opening[-1]
    assert within(last['flyer'], last['target']), f"Opened onto {last['flyer']} vs target {last['target']}"
    if resize_tail:
        assert page.evaluate('window.__landingTracks') == 1, 'Below-media layout changes rebuilt an unchanged flight'
    page.wait_for_timeout(300)
    page.evaluate(LANDING)
    page.keyboard.press('Escape')
    assert_clean(page)
    page.evaluate('window.__landingOn = false')
    closing = [f for f in page.evaluate('window.__landing') if f['flyer']]
    card = card_rect(page, 3000)
    assert closing, 'The close did not fly'
    assert within(closing[-1]['flyer'], card), f"Returned onto {closing[-1]['flyer']} vs card {card}"
    return {'gutter': gutter, 'openFrames': len(opening), 'closeFrames': len(closing)}


def reload_collapse(page, label):
    """After a reload with the viewer open, the page's 返回 collapses the surviving ladder (R10-003)."""
    open_image(page)
    before = page.evaluate(NAV)
    page.reload(wait_until='networkidle')
    expect(page.locator('[data-image-hero-role="detail"]')).to_be_visible()
    assert page.evaluate(NAV)['marker'] == 'guard', 'The reload did not land on the guard entry'
    page.get_by_role('button', name='返回图片列表').click()
    expect(page).to_have_url(BASE + '/user/1', timeout=6000)
    after = page.evaluate(NAV)
    assert after['index'] == before['index'] - 3 and len(after['entries']) == len(before['entries']), (before, after)
    page.wait_for_timeout(600)
    return {'collapsedTo': after['index']}


def lightbox_back(page, label):
    """Back inside the viewer peels one layer: the lightbox first, then the viewer (R10-004)."""
    open_image(page)
    page.locator(DETAIL).click()
    expect(page.locator('.yarl__container')).to_be_visible(timeout=6000)
    page.go_back()
    expect(page.locator('.yarl__container')).to_have_count(0, timeout=4000)
    state(page, 'detail-idle')
    expect(page).to_have_url(BASE + '/pic/3000')
    page.go_back()
    assert_clean(page)
    return {'layers': 'lightbox, then viewer'}


def lightbox_depth(page, label):
    """The complete shell recedes while the fullscreen surface rises, and every close restores it."""
    open_image(page)
    results = []
    modes = [('standard', 'standard', False), ('reduced', 'reduced', False),
             ('off', 'off', False), ('custom', 'reduced', False), ('custom', 'off', False),
             ('standard', 'standard', True)]
    try:
        for motion, image_tier, system_reduced in modes:
            page.emulate_media(reduced_motion='reduce' if system_reduced else 'no-preference')
            page.evaluate("""([motion, tier]) => {
              const root=document.documentElement;
              root.dataset.motion=motion; root.dataset.motionImage=tier;
              root.style.setProperty('--motion-custom-enabled-image',tier==='off'?'0':'1');
              window.__lightboxFrames=[]; window.__lightboxRecording=true;
              const tick=()=>{
                const shell=document.querySelector('[data-app-root]');
                const portal=document.querySelector('.pic-lightbox');
                const bar=document.querySelector('[data-app-bar]');
                window.__lightboxFrames.push({at:performance.now(), depth:shell.hasAttribute('data-lightbox-depth'),
                  scale:shell.getBoundingClientRect().width/innerWidth,
                  barScale:bar.getBoundingClientRect().width/innerWidth,
                  radius:parseFloat(getComputedStyle(shell).borderTopLeftRadius),
                  shellOpacity:+getComputedStyle(shell).opacity,
                  y:portal?.getBoundingClientRect().top??null,
                  opacity:portal?+getComputedStyle(portal).opacity:null});
                if(window.__lightboxRecording)requestAnimationFrame(tick);
              }; requestAnimationFrame(tick);
            }""", [motion, image_tier])
            page.locator(DETAIL).click()
            portal = page.locator('.pic-lightbox')
            expect(portal).to_have_count(1)
            if motion=='standard' and not system_reduced:
                page.wait_for_timeout(70)
                page.screenshot(path=str(OUTPUT/(label+'-arrival.png')))
            page.wait_for_timeout(850)
            frames = page.evaluate('window.__lightboxFrames')
            (OUTPUT/(label+'-'+motion+'-'+image_tier+'-'+str(system_reduced)+'-frames.json')).write_text(json.dumps(frames),encoding='utf-8')
            pose = frames[-1]
            assert abs(pose['scale']-(.92 if image_tier=='standard' else 1))<.001, pose
            assert abs(pose['barScale']-pose['scale'])<.001, pose
            assert abs(pose['shellOpacity']-.8)<.001, pose
            assert abs(pose['y'])<.5 and pose['opacity']==1, pose
            moving = [frame['y'] for frame in frames if frame['y'] is not None]
            if image_tier=='standard':
                assert max(moving)>80, 'The viewer did not arrive from below the viewport'
                assert any(.925<frame['scale']<.995 for frame in frames), 'The shell snapped to depth'
                assert any(0<frame['radius']<27.5 for frame in frames), 'Shell corners snapped into place'
                early = [frame for frame in frames if .972<frame['scale']<.996]
                assert early and max(frame['radius'] for frame in early)<14, 'Corners rounded ahead of the retreat'
                first = next(frame for frame in frames if frame['depth'])
                assert first['radius']<.1, 'The first depth frame must retain square corners'
                assert any(.8<frame['shellOpacity']<.999 for frame in frames), 'Background opacity snapped'
                assert abs(pose['radius']-28)<.1, pose
            elif image_tier=='reduced':
                assert max(moving)<=8.5, moving[:5]
            else:
                assert max(abs(y) for y in moving)<.5, moving[:5]
            assert portal.evaluate('n=>n.contains(document.activeElement)'), 'Viewer lost focus'
            buttons = portal.locator('.yarl__button')
            backgrounds = buttons.evaluate_all('ns=>ns.map(n=>getComputedStyle(n).backgroundColor)')
            assert backgrounds and all(bg in ('transparent','rgba(0, 0, 0, 0)') for bg in backgrounds), 'Viewer buttons have separate media plates'
            toolbar = portal.locator('.yarl__toolbar')
            plate = toolbar.evaluate('n=>getComputedStyle(n).backgroundColor')
            assert plate not in ('transparent','rgba(0, 0, 0, 0)'), 'Toolbar has no shared media plate'
            if page.viewport_size['width']>=500:
                close_button = portal.get_by_role('button',name='关闭',exact=True)
                close_button.hover()
                page.wait_for_timeout(200)
                assert toolbar.evaluate('n=>getComputedStyle(n).backgroundColor')==plate, 'Hover removed the shared toolbar background'
                if image_tier!='off':
                    assert close_button.evaluate("n=>+getComputedStyle(n,'::before').opacity")>0, 'Control lost state feedback'
            if motion=='standard' and not system_reduced:
                page.screenshot(path=str(OUTPUT/(label+'-controls.png')))
            page.keyboard.press('Escape')
            expect(portal).to_have_count(0)
            page.wait_for_timeout(300)
            if image_tier=='standard':
                returned = page.evaluate('window.__lightboxFrames')[len(frames):]
                assert any(0<frame['radius']<27.5 for frame in returned), 'Shell corners snapped back'
            assert page.locator('[data-app-root]').evaluate("n=>getComputedStyle(n).transform")=='none'
            assert page.locator('[data-app-root]').evaluate('n=>+getComputedStyle(n).opacity')==1
            assert page.locator('[data-app-root]').evaluate("n=>parseFloat(getComputedStyle(n).borderTopLeftRadius)")==0
            assert not page.locator('[data-app-root][data-lightbox-depth]').count()
            assert not page.locator('[data-app-root]').evaluate('n=>n.inert')
            page.evaluate('window.__lightboxRecording=false')
            results.append({'motion':motion,'image':image_tier,'systemReduced':system_reduced})

        # Closing before arrival settles must return from its current pose and allow a fresh open.
        page.emulate_media(reduced_motion='no-preference')
        page.evaluate("document.documentElement.dataset.motion='standard'")
        for _ in range(3):
            page.locator(DETAIL).click()
            expect(page.locator('.pic-lightbox.yarl__portal_open')).to_have_count(1)
            page.wait_for_timeout(40)
            page.keyboard.press('Escape')
            expect(page.locator('.pic-lightbox')).to_have_count(0)
            page.wait_for_timeout(250)
            assert page.locator('[data-app-root]').evaluate("n=>getComputedStyle(n).transform")=='none'
            assert page.locator('[data-app-root]').evaluate('n=>+getComputedStyle(n).opacity')==1
            assert not page.locator('[data-app-root][data-lightbox-depth]').count()
        page.go_back()
        assert_clean(page)
        return {'tiers':results,'rapidCloses':3,'shellRestored':True}
    finally:
        page.emulate_media(reduced_motion='no-preference')
        page.evaluate("""() => {
          window.__lightboxRecording=false;
          const root=document.documentElement; root.dataset.motion='standard';
          delete root.dataset.motionImage; root.style.removeProperty('--motion-custom-enabled-image');
        }""")


def dialog_back(page, label):
    """Back peels a dialog opened inside the viewer — 举报 here — before the viewer (R10-004)."""
    open_image(page)
    page.get_by_role('button', name='举报').click()
    dialog = page.get_by_role('dialog', name='举报图片')
    expect(dialog).to_be_visible(timeout=4000)
    page.go_back()
    expect(dialog).to_be_hidden(timeout=4000)
    state(page, 'detail-idle')
    expect(page).to_have_url(BASE + '/pic/3000')
    page.go_back()
    assert_clean(page)
    return {'layers': 'dialog, then viewer'}


def reopen_during_close(page, label, scrolled=False):
    """Tapping the card again while it flies home turns the same flight around (R10-006)."""
    open_image(page)
    if scrolled:
        bounds=page.locator(ROUTE).bounding_box()
        page.mouse.move(bounds['x']+bounds['width']*.6,bounds['y']+bounds['height']*.5)
        page.mouse.wheel(0,220)
        page.wait_for_function("document.querySelector('[data-image-hero-surface-id] .image-detail-overlay-scroll').scrollTop>150")
        page.wait_for_timeout(350)
    previous_top=page.locator(ROUTE).evaluate('n=>n.scrollTop')
    page.evaluate(LANDING)
    page.keyboard.press('Escape')
    state(page, 'closing.flight')
    page.wait_for_timeout(90)
    page.locator('[data-tab-pane-active] ' + THUMB + '[data-image-hero-id="3000"]').locator('..').click(force=True)
    state(page, 'detail-idle', timeout=6000)
    page.evaluate('window.__landingOn = false')
    frames = [f for f in page.evaluate('window.__landing') if f['flyer']]
    turn = next((i for i, f in enumerate(frames) if f['state'] != 'closing.flight'), None)
    assert turn, f"The tap did not turn the closing flight around: {[f['state'] for f in frames]}"
    caught, first = frames[turn - 1]['flyer'], frames[turn]['flyer']
    # The same flight turns around where it is: no snap to the thumbnail, no second copy.
    assert within(caught, first, 3), f'The reversal left from {first}, not from the caught {caught}'
    assert page.locator('.image-hero-flight-layer').count() <= 1, 'Two copies of the picture were flying'
    assert abs(page.locator(ROUTE).evaluate('n=>n.scrollTop')-previous_top)<=1, 'Cancelling a close must retain the reading position'
    page.keyboard.press('Escape')
    assert_clean(page)
    return {'turnedAt': [round(v) for v in caught]}


def repeat_open(page, label):
    """Cold and prepared launches of the same card keep the Stage hidden until the first pose."""
    source = page.locator('[data-tab-pane-active] '+THUMB+'[data-image-hero-id="3000"]')
    source.evaluate("n=>document.querySelector('[data-image-hero-gallery-scroll]').scrollTop=0")
    page.wait_for_timeout(350)
    page.evaluate("""() => {
      window.__repeatBuilds = [];
      window.__repeatNativeAnimate = Element.prototype.animate;
      const seen = new Set();
      Element.prototype.animate = function(...args) {
        if (this.matches('.image-hero-flyer')) {
          const stage = this.closest('[data-image-hero-stage]');
          const id = this.closest('[data-image-hero-session]')?.dataset.imageHeroSession;
          if (stage && !seen.has(id)) {
            seen.add(id);
            window.__repeatBuilds.push({id, clip:getComputedStyle(stage).clipPath});
          }
        }
        return Reflect.apply(window.__repeatNativeAnimate, this, args);
      };
    }""")
    try:
        for held in [None, 0, 80, 350, None, 16]:
            state(page, 'gallery-idle')
            if held is None:
                source.locator('..').evaluate('n=>n.click()')
            else:
                box = source.bounding_box()
                page.mouse.move(box['x']+box['width']/2, box['y']+box['height']/2)
                page.mouse.down()
                page.wait_for_timeout(held)
                page.mouse.up()
            page.wait_for_function("document.querySelector('.image-hero-flyer')!==null")
            state(page, 'detail-idle')
            expect(page.locator(DETAIL)).to_be_visible()
            page.keyboard.press('Escape')
            assert_clean(page)
        builds = page.evaluate('window.__repeatBuilds')
        assert len(builds) == 6, builds
        assert all('100%' in build['clip'] for build in builds), builds
        return {'launches':len(builds), 'hiddenUntilReady':True}
    finally:
        page.evaluate('() => { Element.prototype.animate=window.__repeatNativeAnimate; }')


def same_image_press_tail(page, cdp, label, touch=False):
    """A press caught during reopening cannot turn into a lightbox click after landing."""
    before = page.evaluate('({key:navigation.currentEntry.key,index:navigation.currentEntry.index})')
    open_image(page)
    page.wait_for_timeout(200)
    media = page.locator(DETAIL)
    box = media.bounding_box()
    record(page)
    page.keyboard.press('Escape')
    page.wait_for_timeout(45)
    page.locator('[data-tab-pane-active] '+THUMB+'[data-image-hero-id="3000"]').evaluate(
        'n=>n.closest("a").click()')
    state(page, 'reversing')
    x, y = box['x'] + box['width'] / 2, box['y'] + box['height'] / 2
    if touch:
        cdp.send('Input.dispatchTouchEvent', {'type':'touchStart','touchPoints':[{'x':x,'y':y}]})
    else:
        page.mouse.move(x, y)
        page.mouse.down()
    state(page, 'detail-idle')
    if touch:
        cdp.send('Input.dispatchTouchEvent', {'type':'touchEnd','touchPoints':[]})
    else:
        page.mouse.up()
    page.wait_for_timeout(300)
    expect(page.locator('.yarl__portal')).to_have_count(0)
    assert page.evaluate('Boolean(document.elementFromPoint(24,32)?.closest("[data-app-bar]"))'), 'The app bar was covered'
    log = save(page, label)
    presses = [e for e in log['events'] if e['type']=='pointerdown' and e['state']=='reversing']
    assert presses and presses[-1]['receiver']=='route', presses
    # A fresh, intentional click still works immediately after the swallowed release.
    media.click()
    expect(page.locator('.yarl__container')).to_be_visible(timeout=6000)
    page.keyboard.press('Escape')
    expect(page.locator('.yarl__container')).to_have_count(0)
    page.keyboard.press('Escape')
    assert_clean(page)
    after = page.evaluate('({key:navigation.currentEntry.key,index:navigation.currentEntry.index})')
    assert after == before, (before, after)
    return {'lateReleaseIgnored':True, 'freshClickWorks':True, 'input':'touch' if touch else 'mouse'}


def same_image_interruption(page, label, history_back=False, from_detail=False, fast=False, button=False, turn_count=None):
    """Keep reversing one flight before either endpoint, with exactly one history ladder."""
    open_image(page)
    page.keyboard.press('Escape')
    assert_clean(page)
    before = page.evaluate('({key:navigation.currentEntry.key,index:navigation.currentEntry.index})')
    turn_count = turn_count or (16 if fast else 8)
    if from_detail:
        open_image(page)
    result = page.evaluate("""({historyBack, fromDetail, fast, button, turnCount}) => new Promise((resolve, reject) => {
      const root=document.documentElement, turns=[];
      const open=()=>document.querySelector('[data-tab-pane-active] a.image-hero-card-link '+
        '[data-image-hero-id="3000"]')?.closest('a').click();
      const close=()=>{
        if (button) {
          const back=[...document.querySelectorAll('[data-image-detail-back-button]')].find(n=>{
            const r=n.getBoundingClientRect(),hit=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);
            return hit && (hit===n || n.contains(hit));
          });
          if (!back) { reject(new Error('The in-flight Back button cannot receive a click')); return; }
          back.click();
        } else if (historyBack) history.back();
        else window.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true}));
      };
      let direction=fromDetail?'back':'forward', initialFlyer=null, token=null, oldAnimation=null;
      const deadline=performance.now()+10000;
      fromDetail?close():open();
      const next=()=>{
        const flyer=document.querySelector('.image-hero-flyer');
        const animation=flyer?.getAnimations()[0];
        const marker=history.state?.__picponyImageHero;
        if (performance.now()>deadline) { reject(new Error(JSON.stringify({turns,
          phase:root.dataset.imageHeroState,path:location.pathname,waitingFor:direction}))); return; }
        const threshold=fast?[0,12,24,40][turns.length%4]:35;
        if (!animation || animation===oldAnimation || root.dataset.imageHeroTransition!==direction ||
          Number(animation.currentTime)<threshold) { requestAnimationFrame(next); return; }
        if (!initialFlyer) initialFlyer=flyer;
        if (!token && marker) token=marker.token;
        if (flyer!==initialFlyer) { reject(new Error('The same-image reversal replaced its flyer: '+JSON.stringify(turns))); return; }
        if (marker && marker.token!==token) { reject(new Error('The same-image reversal replaced its history token')); return; }
        turns.push({direction,time:animation.currentTime,phase:root.dataset.imageHeroState});
        if (turns.length===turnCount) { resolve({turns}); return; }
        oldAnimation=animation;
        direction=direction==='forward'?'back':'forward';
        direction==='forward'?open():close();
        requestAnimationFrame(next);
      };
      requestAnimationFrame(next);
    })""", {'historyBack':history_back,'fromDetail':from_detail,'fast':fast,'button':button,'turnCount':turn_count})
    ends_on_detail = from_detail if turn_count % 2 == 0 else not from_detail
    expected = 'detail-idle' if ends_on_detail else 'gallery-idle'
    state(page, expected)
    if expected == 'detail-idle':
        page.keyboard.press('Escape')
    assert_clean(page)
    after = page.evaluate('({key:navigation.currentEntry.key,index:navigation.currentEntry.index})')
    assert after == before, {'before':before,'after':after,'turns':result['turns']}
    return {'turns':len(result['turns']), 'oneFlyer':True, 'originalHistoryEntry':True}


def pull_reopen(page, label):
    """Reopening a dismissed picture lands in its original slot, not the translated pull pose."""
    open_image(page)
    original = page.locator(DETAIL).evaluate('n=>{const r=n.getBoundingClientRect();return [r.x,r.y,r.width,r.height]}')
    page.evaluate(LANDING)
    pull_path(page, [(0, 20), (0, 70), (0, 140), (0, 220)])
    state(page, 'closing.flight')
    page.locator('[data-tab-pane-active] '+THUMB+'[data-image-hero-id="3000"]').locator('..').evaluate('n=>n.click()')
    state(page, 'detail-idle')
    page.evaluate('window.__landingOn=false')
    frames = [f for f in page.evaluate('window.__landing') if f['flyer'] and f['state'] == 'reversing']
    assert frames, 'Reopen did not reverse the dismiss flight'
    assert within(frames[-1]['flyer'], original, 3), {'lastFlight':frames[-1]['flyer'], 'target':original}
    page.keyboard.press('Escape')
    assert_clean(page)
    return {'returnedToOriginalSlot':True}


def pending_history_turn(page, label, restoring=False):
    """Change intent after a traversal was requested but before the browser dispatched it."""
    before = page.evaluate('({key:navigation.currentEntry.key,index:navigation.currentEntry.index})')
    open_image(page)
    page.evaluate("""positive => {
      const native=History.prototype.go;
      window.__releaseHeroGo=null;
      window.__restoreHeroGo=()=>{History.prototype.go=native;};
      let held=false;
      History.prototype.go=function(delta) {
        if (!held && (positive?delta>0:delta<0)) {
          held=true;
          window.__releaseHeroGo=()=>Reflect.apply(native,this,[delta]);
          return;
        }
        return Reflect.apply(native,this,[delta]);
      };
    }""", restoring)
    try:
        source = page.locator('[data-tab-pane-active] '+THUMB+'[data-image-hero-id="3000"]').locator('..')
        if restoring:
            page.evaluate('history.back()')
            state(page, 'closing.flight')
            source.evaluate('n=>n.click()')
        else:
            page.keyboard.press('Escape')
        page.wait_for_function('window.__releaseHeroGo!==null')
        page.evaluate("window.__heldHeroFlyer=document.querySelector('.image-hero-flyer')")
        if restoring:
            page.keyboard.press('Escape')
        else:
            source.evaluate('n=>n.click()')
        page.wait_for_timeout(35)
        assert page.evaluate("document.querySelector('.image-hero-flyer')===window.__heldHeroFlyer"), 'The pending traversal replaced its flyer'
        page.evaluate('window.__releaseHeroGo()')
        if not restoring:
            state(page, 'detail-idle')
            page.keyboard.press('Escape')
        assert_clean(page)
        after = page.evaluate('({key:navigation.currentEntry.key,index:navigation.currentEntry.index})')
        assert after == before, {'before':before,'after':after}
        return {'latestIntentWon':True, 'originalHistoryEntry':True}
    finally:
        page.evaluate('window.__restoreHeroGo()')


def return_surface(page, label, scroll=False, fallback=False, reopen=False):
    """Sample the real return tracks: opaque surface, stationary content, untouched app header."""
    open_image(page)
    page.evaluate("""() => {
      window.__returnTracks = [];
      window.__returnNativeAnimate = Element.prototype.animate;
      Element.prototype.animate = function(...args) {
        const animation = Reflect.apply(window.__returnNativeAnimate, this, args);
        if (animation.timeline===document.timeline && this.matches('.image-hero-flyer,.image-hero-flyer-clip,.image-hero-flyer-image,'+
          '[data-image-detail-background-visual],[data-image-detail-clip],[data-image-detail-unclip],'+
          '[data-image-detail-crossfade],[data-image-detail-surface],[data-image-detail-reveal],'+
          '[data-image-detail-floating-back]')) {
          animation.pause(); animation.currentTime = 0;
          window.__returnTracks.push(animation);
        }
        return animation;
      };
    }""")
    samples = []
    scroll_samples = []
    if fallback:
        page.evaluate('window.__returnScrollTimeline=window.ScrollTimeline;window.ScrollTimeline=undefined')
    try:
        page.keyboard.press('Escape')
        state(page, 'closing.flight')
        page.wait_for_function('window.__returnTracks.length>=6')
        for ms in [0, 40, 100, 200, 260]:
            sample = page.evaluate("""ms => {
              for (const a of window.__returnTracks)
                a.currentTime = Math.min(ms, Number(a.effect.getTiming().duration)-0.5);
              const route = document.querySelector('[data-image-hero-surface-id]');
              const content = route.querySelector('[data-image-detail-crossfade]');
              const header = document.querySelector('header');
              const h = header.getBoundingClientRect();
              return {surface:Number(getComputedStyle(route.querySelector('[data-image-detail-surface]')).opacity),
                contentOpacity:Number(getComputedStyle(content).opacity),
                contentX:content.getBoundingClientRect().x, contentY:content.getBoundingClientRect().y,
                headerOpacity:Number(getComputedStyle(header).opacity),
                headerColour:getComputedStyle(header).backgroundColor, headerY:h.y,
                headerHeight:h.height, overlayTop:route.getBoundingClientRect().top};
            }""", ms)
            samples.append(sample)
        assert all(s['surface'] == 1 for s in samples), samples
        assert samples[0]['contentOpacity'] == 1 and samples[-1]['contentOpacity'] < .01, samples
        assert max(s['contentX'] for s in samples)-min(s['contentX'] for s in samples) < .5, samples
        assert max(s['contentY'] for s in samples)-min(s['contentY'] for s in samples) < .5, samples
        assert all(s['headerOpacity'] == 1 and s['headerColour'] == samples[0]['headerColour']
                   and s['overlayTop'] >= s['headerY']+s['headerHeight'] for s in samples), samples
        if scroll:
            read = """() => {
              const route=document.querySelector('[data-image-hero-surface-id]');
              const y=n=>n.getBoundingClientRect().y;
              return {scroll:document.querySelector('[data-image-hero-gallery-scroll]').scrollTop,
                clip:y(route.querySelector('[data-image-detail-clip]')),
                flyer:y(document.querySelector('.image-hero-flyer')),
                content:y(route.querySelector('[data-image-detail-crossfade]'))};
            }"""
            before = page.evaluate(read)
            box = page.locator(GALLERY).bounding_box()
            page.mouse.move(box['x'] + box['width'] * .7, box['y'] + box['height'] * .5)
            for delta in [140, -100, 80]:
                page.mouse.wheel(0, delta)
                page.wait_for_function("""before => Math.abs(document.querySelector(
                  '[data-image-hero-gallery-scroll]').scrollTop-before)>40""", arg=before['scroll'])
                page.wait_for_timeout(100)
                after = page.evaluate(read)
                distance = after['scroll'] - before['scroll']
                assert abs(after['flyer'] - before['flyer'] + distance) < .5, (before, after)
                assert abs(after['clip'] - before['clip'] + distance) < .5, (before, after)
                assert abs(after['content'] - before['content']) < .5, (before, after)
                scroll_samples.append({'scroll':distance, 'window':after['clip']-before['clip']})
                before = after
            if reopen:
                page.locator('[data-tab-pane-active] '+THUMB+'[data-image-hero-id="3000"]').locator('..').click(no_wait_after=True)
                state(page, 'reversing')
                after = page.evaluate(read)
                assert abs(after['clip']-before['clip']) < 1, (before, after)
                assert abs(after['flyer']-before['flyer']) < 1, (before, after)
                assert abs(after['content']-before['content']) < 1, (before, after)
    finally:
        page.evaluate("""() => {
          Element.prototype.animate=window.__returnNativeAnimate;
          for (const a of window.__returnTracks) if (a.playState!=='idle') a.play();
        }""")
        if fallback:
            page.evaluate('() => { window.ScrollTimeline=window.__returnScrollTimeline; }')
    if reopen:
        state(page, 'detail-idle')
        assert page.locator('[data-image-hero-surface-id] [data-image-detail-clip]').evaluate('n=>getComputedStyle(n).translate') == 'none'
        assert page.locator(ROUTE).evaluate('n=>getComputedStyle(n).translate') == 'none'
        page.keyboard.press('Escape')
    assert_clean(page)
    return {'samples':len(samples), 'surfaceOpacity':1, 'stationaryContent':True, 'scroll':scroll_samples}


# The step's content node: everything of one picture that the shared axis moves.
STEP_CONTENT = '[data-image-hero-surface-id] [data-image-detail-crossfade]'


def wait_shown(page, image_id, timeout=4000):
    """The viewer has swapped to `image_id` — the incoming half has just started, and the URL has
    not followed yet (it waits for the step's idle slice)."""
    try:
        page.wait_for_function(
            f"() => document.querySelector('{DETAIL}')?.getAttribute('data-image-hero-id') === '{image_id}'",
            timeout=timeout)
    except Exception as error:
        current = page.evaluate("""() => ({phase:document.documentElement.dataset.imageHeroState,
          path:location.pathname, image:document.querySelector('[data-image-hero-surface-id] '+
          '[data-image-hero-role="detail"]')?.dataset.imageHeroId})""")
        raise AssertionError(f'Expected image {image_id}; viewer stayed at {current}') from error


def swipe_step(page, cdp, label):
    """A horizontal swipe on the picture pages it, and a second flick started the moment the next
    picture is swapped in — without waiting for the URL — pages it back instead of being dropped.
    The production build dropped it: its idle slice, and with it the URL, lands inside the incoming
    half, where the recogniser used to refuse a finger. The second step also lands before the
    first step's ladder rewrite has run, and the history must end as it began. Real touches, so
    where in the incoming half the second one lands is the browser's timing (at its very end in
    development); `swipe-arrival-takeover` pins the takeover itself."""
    open_image(page)
    before = page.evaluate(NAV)
    box = page.locator(DETAIL).bounding_box()
    y = box['y'] + box['height'] / 2
    def swipe(x0, dx):
        cdp.send('Input.dispatchTouchEvent', {'type': 'touchStart', 'touchPoints': [{'x': x0, 'y': y}]})
        for i in range(1, 9):
            cdp.send('Input.dispatchTouchEvent', {'type': 'touchMove', 'touchPoints': [{'x': x0 + dx * i / 8, 'y': y + i}]})
            page.wait_for_timeout(14)
        cdp.send('Input.dispatchTouchEvent', {'type': 'touchEnd', 'touchPoints': []})
    swipe(box['x'] + box['width'] * .8, -box['width'] * .6)
    wait_shown(page, 3001)
    swipe(box['x'] + box['width'] * .2, box['width'] * .6)
    wait_detail(page, 3000)
    assert not page.locator('.yarl__container').count(), 'A swipe also opened the lightbox'
    after = page.evaluate(NAV)
    assert after['index'] == before['index'] and len(after['entries']) == len(before['entries']), (before, after)
    assert after['entries'][after['index']] == '/pic/3000' and after['marker'] == 'guard', after
    page.keyboard.press('Escape')
    assert_clean(page)
    closed = page.evaluate(NAV)
    assert closed['index'] == before['index'] - 3, (before, closed)
    return {'paged': 'both ways'}


# A touch swipe from script, for timing a real input cannot reach: synthetic pointer events carry
# the same fields the recogniser reads, and it does not ask whether they are trusted.
SYNTHETIC_SWIPE = """() => {
  const media = document.querySelector('[data-image-hero-surface-id] [data-image-detail-media]');
  const box = media.getBoundingClientRect(); const y = box.y + box.height / 2;
  let id = 90;
  const fire = (target, type, x, pointerId) => target.dispatchEvent(new PointerEvent(type, { bubbles: true,
    cancelable: true, pointerId, pointerType: 'touch', isPrimary: true, clientX: x, clientY: y }));
  window.__swipe = { start(x0) { id += 1; fire(media, 'pointerdown', x0, id); this.x0 = x0; this.id = id; },
    move(dx) { fire(media, 'pointermove', this.x0 + dx, this.id); },
    end(dx) { fire(media, 'pointerup', this.x0 + dx, this.id); } };
}"""


def swipe_exit_takeover(page, label):
    """A flick landing while the first step's outgoing half is still running — a window of one
    FastEffects response, which only a scripted swipe can hit on purpose: the swap lands at once
    and the finger takes the incoming picture from its first pose, instead of the flick being
    dropped."""
    open_image(page)
    page.evaluate(SYNTHETIC_SWIPE)
    shown = page.evaluate(f"""() => {{ const s = window.__swipe;
      const width = document.querySelector('[data-image-hero-surface-id] [data-image-detail-media]').getBoundingClientRect().width;
      s.start(width * .8); for (let i = 1; i <= 6; i += 1) s.move(-width * .1 * i); s.end(-width * .6);
      const leaving = document.querySelector('{DETAIL}').getAttribute('data-image-hero-id');
      s.start(width * .5); s.move(-12);
      const taken = document.querySelector('{DETAIL}').getAttribute('data-image-hero-id');
      for (let i = 2; i <= 6; i += 1) s.move(-width * .1 * i); s.end(-width * .6);
      return {{ leaving, taken }}; }}""")
    assert shown == {'leaving': '3000', 'taken': '3001'}, f'The flick did not take over the outgoing half: {shown}'
    wait_detail(page, 3002)
    page.keyboard.press('Escape')
    assert_clean(page, 3002)
    return {'swappedUnderTheFinger': True}


def swipe_arrival_takeover(page, label):
    """A flick landing in the incoming half's first frame — dispatched from the mutation that swaps
    the picture in, a moment only a scripted swipe reaches on purpose: the content is taken over
    where it is, so nothing jumps under the finger (its travel becomes the drag's origin) and the
    fade runs on instead of snapping to full; and the flick pages."""
    open_image(page)
    page.evaluate(SYNTHETIC_SWIPE)
    taken = page.evaluate("""([detail, content]) => new Promise((resolve) => {
      const s = window.__swipe;
      const surface = document.querySelector('[data-image-hero-surface-id]');
      const node = document.querySelector(content);
      const width = surface.querySelector('[data-image-detail-media]').getBoundingClientRect().width;
      const pose = () => { const style = getComputedStyle(node);
        return { x: style.transform === 'none' ? 0 : new DOMMatrixReadOnly(style.transform).m41, opacity: Number(style.opacity) }; };
      const observer = new MutationObserver(() => {
        if (document.querySelector(detail)?.getAttribute('data-image-hero-id') !== '3001') return;
        observer.disconnect();
        s.start(width * .2);
        const before = pose();
        s.move(12);
        const after = pose();
        for (let i = 2; i <= 6; i += 1) s.move(width * .1 * i);
        s.end(width * .6);
        resolve({ before, after });
      });
      observer.observe(surface, { subtree: true, childList: true, attributes: true, attributeFilter: ['data-image-hero-id'] });
      s.start(width * .8); for (let i = 1; i <= 6; i += 1) s.move(-width * .1 * i); s.end(-width * .6);
    })""", [DETAIL, STEP_CONTENT])
    was, now = taken['before'], taken['after']
    assert was['x'] > 20 and was['opacity'] < .2, f'The flick did not land at the start of the incoming half: {taken}'
    assert abs(now['x'] - was['x']) < .5, f'The content jumped under the finger: {taken}'
    assert abs(now['opacity'] - was['opacity']) < .05, f'The fade snapped when the finger took over: {taken}'
    wait_detail(page, 3000)
    page.keyboard.press('Escape')
    assert_clean(page)
    return {'takenOverAt': {k: round(v, 2) for k, v in was.items()}}


# --- The owner's reports (F2): a swipe stuck part-way, and swipes that stop answering ---

def touch_swipe(page, cdp, x0, y0, dx, dy=0.0, steps=8, gap=14, hold=None):
    """A real touch drag. `hold` runs in the page before the finger lifts, and its answer is
    returned — what the drag looks like mid-gesture."""
    cdp.send('Input.dispatchTouchEvent', {'type': 'touchStart', 'touchPoints': [{'x': x0, 'y': y0}]})
    for i in range(1, steps + 1):
        cdp.send('Input.dispatchTouchEvent', {'type': 'touchMove',
                                              'touchPoints': [{'x': x0 + dx * i / steps, 'y': y0 + dy * i / steps}]})
        page.wait_for_timeout(gap)
    held = None
    if hold:
        page.wait_for_timeout(50)
        held = page.evaluate(hold)
    cdp.send('Input.dispatchTouchEvent', {'type': 'touchEnd', 'touchPoints': []})
    return held


def media_box(page):
    return page.locator('[data-image-hero-surface-id] [data-image-detail-media]').bounding_box()


# The step content's pose: its offset, its opacity, what is written inline, what still runs on it.
POSE = """() => { const n = document.querySelector('%s'); const s = getComputedStyle(n);
  return { x: s.transform === 'none' ? 0 : new DOMMatrixReadOnly(s.transform).m41, opacity: Number(s.opacity),
    inline: n.style.transform, running: n.getAnimations().length }; }""" % STEP_CONTENT.replace("'", "\\'")
CONTENT_X = """() => { const s = getComputedStyle(document.querySelector('%s'));
  return s.transform === 'none' ? 0 : new DOMMatrixReadOnly(s.transform).m41; }""" % STEP_CONTENT.replace("'", "\\'")


def assert_at_rest(page, context):
    pose = page.evaluate(POSE)
    assert abs(pose['x']) < .5 and pose['opacity'] > .99 and not pose['inline'] and not pose['running'], \
        f'The content was left part-way ({context}): {pose}'


_CLIP = []


def fixture_clip():
    """A two-second VP8 clip, encoded here once (OpenCV's bundled FFmpeg): a video the browser can
    actually play, so its preview gives way and its own controls are what a finger lands on."""
    if not _CLIP:
        import os
        os.environ.setdefault('OPENCV_LOG_LEVEL', 'ERROR')
        import cv2
        import numpy
        path = OUTPUT / 'fixture-clip.webm'
        writer = cv2.VideoWriter(str(path), cv2.VideoWriter_fourcc(*'VP80'), 10, (320, 240))
        for i in range(20):
            writer.write(numpy.full((240, 320, 3), (40 + i * 8, 120, 200), dtype=numpy.uint8))
        writer.release()
        _CLIP.append(path.read_bytes())
    return _CLIP[0]


class HeroFixtures(Fixtures):
    """The shared fixtures, plus pictures whose detail records say webm video (the list's upload
    rows carry no format, so their cards stay stills), their files answered with a real clip. One
    context-level handler: a page route layered over it raced its own removal against requests
    still in flight."""

    def __init__(self):
        super().__init__()
        self.videos = set()
        self.served_videos = set()

    def __call__(self, route):
        if self.videos:
            target = unwrap(route.request.url)
            match = re.fullmatch(r'/images/(\d+)', target.path.replace('/api/v1/json', ''))
            if match and int(match.group(1)) in self.videos:
                image_id = int(match.group(1))
                record = image_record(image_id)
                stem = f'https://derpicdn.net/img/2024/1/1/{image_id}'
                record['format'] = 'webm'
                record['view_url'] = stem + '/view.webm'
                record['representations'] = {key: f'{stem}/{key}.webm' for key in record['representations']}
                self.served_videos.add(image_id)
                self.json(route, {'image': record})
                return
            if target.path.endswith('.webm'):
                route.fulfill(status=200, content_type='video/webm', body=fixture_clip(),
                              headers={'access-control-allow-origin': '*', 'accept-ranges': 'none'})
                return
        super().__call__(route)


def fresh_profile(page):
    """Load the profile anew. A same-document history write the outgoing page makes while the load
    is pending (its route, scroll or tab bookkeeping) can abort it, so it is tried twice."""
    for attempt in range(2):
        try:
            page.goto(BASE + '/user/1', wait_until='networkidle')
            break
        except Exception as error:
            if attempt or 'ERR_ABORTED' not in str(error):
                raise
            page.wait_for_timeout(500)
    expect(page.locator('[data-tab-pane-active] ' + THUMB)).to_have_count(12)
    page.wait_for_timeout(600)


def with_videos(page, fixtures, ids, work):
    """Runs `work` on a fresh profile page whose `ids` are videos, and leaves a fresh one behind:
    the detail records live in the page's own memory for its lifetime."""
    fixtures.videos = set(ids)
    fixtures.served_videos = set()
    try:
        fresh_profile(page)
        return work()
    finally:
        fixtures.videos = set()
        fresh_profile(page)


def swipe_video(page, cdp, fixtures, label):
    """A video pages under the finger like a still. "划了一会就划不动了": the picture's box went
    unbound on a video, so a reader who stepped onto one found every swipe dead. Its own controls
    keep the drags that start on them — the band along its bottom edge, the timeline among them."""
    def work():
        open_image(page)
        page.keyboard.press('ArrowRight')
        wait_detail(page, 3001)
        expect(page.locator('[data-image-hero-surface-id] [data-image-detail-media] video[controls]')).to_have_count(1)
        # Playing, its preview gone: what a finger lands on is the video and its own controls.
        page.wait_for_function("""() => { const v = document.querySelector('[data-image-hero-surface-id] [data-image-detail-media] video[controls]');
          return v && v.readyState >= 2; }""", timeout=8000)
        page.wait_for_timeout(400)
        box = media_box(page)
        touch_swipe(page, cdp, box['x'] + box['width'] * .8, box['y'] + box['height'] - 20, -box['width'] * .6)
        page.wait_for_timeout(700)
        assert page.locator(DETAIL).get_attribute('data-image-hero-id') == '3001', 'A drag on the video controls paged'
        touch_swipe(page, cdp, box['x'] + box['width'] * .8, box['y'] + box['height'] * .4, -box['width'] * .6)
        wait_detail(page, 3002)
        page.keyboard.press('Escape')
        assert_clean(page, 3002)
        return {'videoPages': True, 'controlsKeepTheirDrag': True}
    return with_videos(page, fixtures, [3001], work)


def swipe_exit_video(page, fixtures, label):
    """"滑动有的时候会卡在一半": a flick landing in the outgoing half, onto a video. The swap took the
    box out of the recogniser (a video was left unbound), which released the drag inside that very
    commit, and the takeover then pinned the content at the incoming half's first pose, with no
    finger left to move it. The flick now carries on and pages, and the content ends at rest."""
    def work():
        open_image(page)
        # The neighbour's record, a video, in hand: the swap lands on the video itself.
        for _ in range(50):
            if 3001 in fixtures.served_videos:
                break
            page.wait_for_timeout(100)
        assert 3001 in fixtures.served_videos, 'The neighbour was not warmed'
        page.wait_for_timeout(300)
        page.evaluate(SYNTHETIC_SWIPE)
        # The second flick locks a frame after the first lets go, still inside its outgoing half:
        # a frame is what lets the step's record — the video's — publish before the swap, as it
        # does under a real finger, which cannot lock in the same task.
        shown = page.evaluate(f"""async () => {{ const s = window.__swipe;
          const width = document.querySelector('[data-image-hero-surface-id] [data-image-detail-media]').getBoundingClientRect().width;
          const detail = () => document.querySelector('{DETAIL}').getAttribute('data-image-hero-id');
          s.start(width * .8); for (let i = 1; i <= 6; i += 1) s.move(-width * .1 * i); s.end(-width * .6);
          await new Promise((resolve) => requestAnimationFrame(resolve));
          const leaving = detail();
          s.start(width * .5); s.move(-12);
          const taken = detail();
          for (let i = 2; i <= 6; i += 1) {{
            await new Promise((resolve) => requestAnimationFrame(resolve));
            s.move(-width * .1 * i);
          }}
          s.end(-width * .6);
          return {{ leaving, taken }}; }}""")
        assert shown == {'leaving': '3000', 'taken': '3001'}, f'The flick did not take over the outgoing half: {shown}'
        page.wait_for_timeout(1200)
        assert_at_rest(page, 'after a flick taken over onto a video')
        wait_detail(page, 3002)
        # What the swap landed on was the video (its record was in hand before the flick).
        page.keyboard.press('ArrowLeft')
        wait_detail(page, 3001)
        expect(page.locator('[data-image-hero-surface-id] [data-image-detail-media] video')).to_have_count(1, timeout=6000)
        page.keyboard.press('Escape')
        assert_clean(page, 3001)
        return {'restedAndPaged': True}
    return with_videos(page, fixtures, [3001], work)


# Holds the list's next-page reads in the page until the test lets them land (a sleep in a route
# handler would stall this whole single-threaded driver, touches included), and records them.
HELD_PAGES = r"""() => { window.__pageReads = []; let release; const gate = new Promise((resolve) => { release = resolve; });
  window.__releasePages = () => release();
  const original = window.fetch;
  window.fetch = async function (input, init) {
    const url = typeof input === 'string' ? input : input.url;
    let inner = url; const m = /[?&]url=([^&]+)/.exec(url); if (m) inner = decodeURIComponent(m[1]);
    const page = /\/search\/images\?(?:.*&)?page=(\d+)/.exec(inner);
    const response = await original.call(this, input, init);
    if (page && Number(page[1]) >= 2) {
      window.__pageReads.push(Number(page[1]));
      await new Promise((resolve, reject) => { gate.then(resolve);
        init?.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError'))); });
    }
    return response; }; }"""


def swipe_page_end(page, cdp, label):
    """The end of the loaded list, its next page slow to arrive (seconds, as Derpibooru's lane can
    be live). "划了一会就划不动了，是等加载？" — yes: every swipe was refused until the read finished.
    A swipe then is taken — resisted under the finger while the arrow shows the wait — and the
    viewer pages once the page lands, one picture however often it was asked for; and the page is
    read ahead within the last four pictures, so the wait is rare. A search: its list is paged."""
    page.route('**/*', search_pages)
    try:
        page.goto(BASE + '/search?q=pony', wait_until='networkidle')
        page.evaluate(HELD_PAGES)
        start = page.locator('.image-card [data-image-hero-role="thumbnail"][data-image-hero-id="5044"]')
        expect(start).to_be_attached(timeout=15000)
        start.scroll_into_view_if_needed()
        page.wait_for_function("""() => { const i = document.querySelector('.image-card [data-image-hero-id="5044"] img');
          return i?.complete && i.naturalWidth > 0 && getComputedStyle(i).opacity === '1'; }""", timeout=15000)
        page.wait_for_timeout(350)
        start.locator('..').click()
        state(page, 'detail-idle')
        read_ahead = None
        for image_id in (5045, 5046, 5047, 5048, 5049):
            page.keyboard.press('ArrowRight')
            wait_shown(page, image_id)
            if image_id == 5047:
                read_ahead = page.evaluate('window.__pageReads.length')
        # At the end, the page still on its way: the step waits for it, showing the wait...
        page.keyboard.press('ArrowRight')
        expect(page.get_by_role('button', name='下一张')).to_have_attribute('aria-busy', 'true')
        # ...and a swipe meanwhile is taken and resisted rather than refused.
        box = media_box(page)
        dx = -box['width'] * .6
        held = touch_swipe(page, cdp, box['x'] + box['width'] * .8, box['y'] + box['height'] * .5, dx, hold=CONTENT_X)
        page.keyboard.press('ArrowRight')
        page.wait_for_timeout(300)
        assert page.locator(DETAIL).get_attribute('data-image-hero-id') == '5049', 'It stepped before the page landed'
        page.evaluate('window.__releasePages()')
        wait_detail(page, 5050, timeout=8000)
        page.wait_for_timeout(800)
        assert dx < held < -2, f'A swipe during the page read was refused: the content moved {held}px'
        assert page.locator(DETAIL).get_attribute('data-image-hero-id') == '5050', \
            'Asked for three times while the page was on its way, the viewer stepped more than once'
        assert read_ahead, 'The next page was not read ahead of the end'
        assert_at_rest(page, 'after the page landed')
        return {'heldPx': round(held, 1), 'readAhead': True}
    finally:
        page.unroute('**/*', search_pages)
        page.goto(BASE + '/user/1', wait_until='networkidle')
        page.wait_for_timeout(600)


def swipe_marathon(page, cdp, fixtures, label):
    """A reader's session of swipes on a phone: flicks, slow drags, short drags that should come
    back, drifting diagonals, and the next swipe often landing inside the last one's transition —
    across a video. After every lull the content is at rest, never left part-way across, and at the
    end a swipe still pages."""
    rng = random.Random(19)

    def work():
        open_image(page)
        for n in range(22):
            shown = int(page.locator(DETAIL).get_attribute('data-image-hero-id'))
            box = media_box(page)
            direction = 1 if (shown < 3011 and rng.random() < .75) or shown == 3000 else -1
            kind = rng.choice(['flick', 'flick', 'slow', 'short', 'diagonal'])
            w = box['width']
            x0 = box['x'] + w * (.78 if direction == 1 else .22)
            y0 = box['y'] + box['height'] * rng.uniform(.25, .6)
            dx = -direction * w * {'flick': .45, 'slow': .4, 'short': .08, 'diagonal': .38}[kind]
            dy = abs(dx) * rng.uniform(.25, .6) * rng.choice([-1, 1]) if kind == 'diagonal' else rng.uniform(-6, 6)
            steps, gap = {'flick': (5, 12), 'slow': (16, 26), 'short': (8, 18), 'diagonal': (10, 16)}[kind]
            touch_swipe(page, cdp, x0, y0, dx, dy, steps, gap)
            page.wait_for_timeout(rng.choice([40, 90, 160, 400]))
            if n % 4 == 3:
                page.wait_for_timeout(1300)
                assert_at_rest(page, f'swipe {n}, {kind}')
        page.wait_for_timeout(1300)
        assert_at_rest(page, 'end of the session')
        before = int(page.locator(DETAIL).get_attribute('data-image-hero-id'))
        direction = -1 if before > 3000 else 1
        box = media_box(page)
        touch_swipe(page, cdp, box['x'] + box['width'] * (.22 if direction == -1 else .78),
                    box['y'] + box['height'] * .4, box['width'] * .5 * -direction)
        wait_detail(page, before + direction)
        page.keyboard.press('Escape')
        state(page, 'gallery-idle')
        return {'swipes': 22, 'endedOn': before + direction}
    return with_videos(page, fixtures, [3005], work)

def quick_steps(page, label):
    """→ pressed again the moment the next picture is swapped in: the second step takes over the
    incoming half, and lands before the first step's ladder rewrite has run — the ladder still ends
    naming the picture on screen, with no entry added."""
    open_image(page)
    before = page.evaluate(NAV)
    page.keyboard.press('ArrowRight')
    wait_shown(page, 3001)
    page.keyboard.press('ArrowRight')
    wait_detail(page, 3002)
    after = page.evaluate(NAV)
    assert after['index'] == before['index'] and len(after['entries']) == len(before['entries']), (before, after)
    assert after['entries'][after['index']] == '/pic/3002' and after['marker'] == 'guard', after
    page.go_back()
    assert_clean(page, 3002)
    return {'reached': 3002}


SEARCH_PAGES = 4


def search_pages(route):
    """A search with more than one page (the shared fixtures answer a single short one): fifty
    records a page, numbered by page so a turned page is recognisable."""
    target = unwrap(route.request.url)
    params = urllib.parse.parse_qs(target.query)
    # Only the search typed below: a profile resolves its uploads through the same endpoint.
    if target.path.replace('/api/v1/json', '') != '/search/images' or 'pony' not in params.get('q', [''])[0]:
        route.fallback()
        return
    number = int(params.get('page', ['1'])[0])
    per_page = int(params.get('per_page', ['50'])[0])
    Fixtures.json(route, {'total': SEARCH_PAGES * per_page,
                          'images': [image_record(5000 + (number - 1) * per_page + i) for i in range(per_page)]})


def step_across_page(page, label, flightless=False):
    """下一张 past the end of a page loads the next one, and closing there turns the list to that
    page and flies home to the card (decision 19) — and focus follows to that card, not to the
    one the viewer was opened from, which went with its page. A search: its list is paged.

    `flightless`: the same under 减弱, where nothing flies and the viewer has no ladder, so it
    closes by history alone and the list turns its page after the overlay has gone."""
    page.route('**/*', search_pages)
    try:
        return across_page(page, flightless)
    finally:
        page.unroute('**/*', search_pages)
        page.goto(BASE + '/user/1', wait_until='networkidle')
        page.wait_for_timeout(600)


# The card link that holds focus, named by its picture.
FOCUSED_CARD = """() => { const a = document.activeElement;
  return a?.matches('a') ? a.querySelector('[data-image-hero-role="thumbnail"]')?.getAttribute('data-image-hero-id') ?? null : null; }"""
# How far each focus moved the list: a focus that scrolls does so inside the call, after `focusin`.
FOCUS_SCROLL = """() => { window.__focusScroll = [];
  document.addEventListener('focusin', (event) => {
    const list = document.querySelector('[data-image-hero-gallery-scroll]'); const before = list?.scrollTop ?? 0;
    const id = event.target.querySelector?.('[data-image-hero-role="thumbnail"]')?.getAttribute('data-image-hero-id') ?? null;
    queueMicrotask(() => window.__focusScroll.push([id, (list?.scrollTop ?? 0) - before]));
  }, true); }"""


def across_page(page, flightless=False):
    page.goto(BASE + '/search?q=pony', wait_until='networkidle')
    if flightless:
        # The tier is read off the root, which is what choosing 减弱 in /settings sets.
        page.evaluate("document.documentElement.dataset.motion = 'reduced'")
    thumbs = page.locator('.image-card [data-image-hero-role="thumbnail"]')
    expect(thumbs.first).to_be_visible(timeout=15000)
    page.wait_for_timeout(800)
    ids = thumbs.evaluate_all("ns => ns.map(n => n.getAttribute('data-image-hero-id'))")
    last = ids[-1]
    source = page.locator(f'.image-card [data-image-hero-role="thumbnail"][data-image-hero-id="{last}"]')
    source.scroll_into_view_if_needed()
    page.wait_for_function(f"""() => {{ const i = document.querySelector('.image-card [data-image-hero-id="{last}"] img');
      return i?.complete && i.naturalWidth > 0 && getComputedStyle(i).opacity === '1'; }}""", timeout=15000)
    page.wait_for_timeout(350)
    source.locator('..').click()
    state(page, 'detail-idle')
    page.get_by_role('button', name='下一张').click()
    page.wait_for_function(f"""() => {{ const id = document.querySelector('{DETAIL}')?.getAttribute('data-image-hero-id');
      return id && id !== '{last}'; }}""", timeout=15000)
    shown = page.locator(DETAIL).get_attribute('data-image-hero-id')
    assert shown not in ids, f'下一张 from the last card stayed on the page: {shown}'
    wait_detail(page, shown, timeout=8000)
    if flightless:
        assert page.evaluate(NAV)['marker'] is None, 'A viewer opened under 减弱 built a ladder'
    page.evaluate(LANDING)
    page.evaluate(FOCUS_SCROLL)
    page.keyboard.press('Escape')
    state(page, 'gallery-idle', timeout=10000)
    page.wait_for_timeout(300)
    page.evaluate('window.__landingOn = false')
    frames = [f for f in page.evaluate('window.__landing') if f['flyer']]
    page.wait_for_function("() => location.search.includes('page=2')", timeout=6000)
    card = page.locator(f'.image-card [data-image-hero-role="thumbnail"][data-image-hero-id="{shown}"]').evaluate(
        "n => { const r = n.getBoundingClientRect(); return [r.x, r.y, r.width, r.height]; }")
    if flightless:
        assert not frames, 'Something flew under 减弱'
    else:
        assert frames, 'The close did not fly'
        assert within(frames[-1]['flyer'], card), f"Returned onto {frames[-1]['flyer']} vs card {card}"
    try:
        page.wait_for_function(f"() => ({FOCUSED_CARD})() === '{shown}'", timeout=4000)
    except Exception:
        raise AssertionError(f"Focus did not follow to the revealed card {shown}: {page.evaluate(FOCUSED_CARD)} "
                             f"({page.evaluate('document.activeElement?.tagName')})")
    # The reveal owns the position: taking focus must not scroll the list.
    moved = [delta for id_, delta in page.evaluate('window.__focusScroll') if id_ == shown]
    assert moved and all(abs(delta) < 1 for delta in moved), f'Focusing the revealed card scrolled the list: {moved}'
    return {'lastOfPage': last, 'landedOn': shown, 'closedAt': page.url, 'focus': shown}


# The user's Back as a browser's own button makes it: `history.back()`, which the browser resolves
# against the entry history is heading for at the moment it takes it. Not Playwright's `go_back()`:
# that reads the history, then navigates to the entry it read by id — read while the ladder
# rewrite's own traversal is committing, it names that traversal's target, and the browser makes
# one traversal of the two (the Back absorbed; no browser's Back behaves so).
QUICK_BACK = r"""(when) => {
  window.__quickBack = 0;
  const back = () => { window.__quickBack += 1; history.back(); };
  if (when === 'swap-task' || when === 'swap-frame') {
    // The swap: the detail starts naming the picture stepped to. A mutation record is delivered
    // at the end of the very task that made it.
    const surface = document.querySelector('[data-image-hero-surface-id]');
    const observer = new MutationObserver(() => {
      const shown = surface.querySelector('[data-image-hero-role="detail"]')?.getAttribute('data-image-hero-id');
      if (shown !== '3001') return;
      observer.disconnect();
      if (when === 'swap-task') back();
      else requestAnimationFrame(back);
    });
    observer.observe(surface, { subtree: true, childList: true, attributes: true, attributeFilter: ['data-image-hero-id'] });
    return;
  }
  if (when === 'past-the-base') {
    /* Once the rewrite has written: a traversal onto the rung under the base, two entries back —
       what a Back the browser resolved while the rewrite stood on the base becomes when it lands
       after the writes (and what the history menu's jump to the list is). Next's patched
       pushState is the instance's own property, so the hook wraps that. */
    const push = window.history.pushState;
    window.history.pushState = function (state, ...rest) {
      const result = push.call(this, state, ...rest);
      const marker = state?.__picponyImageHero;
      if (marker?.role === 'guard' && marker.imageId === 3001) {
        window.history.pushState = push;
        setTimeout(() => { window.__quickBack += 1; history.go(-2); }, 0);
      }
      return result;
    };
    return;
  }
  // The ladder rewrite's own traversal, onto the base.
  window.__pristineGo ??= History.prototype.go;
  const go = window.__pristineGo;
  History.prototype.go = function (delta) {
    const result = go.call(this, delta);
    if (delta !== -1) return result;
    History.prototype.go = go;
    if (when === 'rewrite-busy') {
      /* A busy main thread, as the production build had: the Back's commit queues up behind the
         rewrite's own before either popstate is dispatched, and both are dispatched before the
         rewrite's continuation (Chromium orders them so every time). */
      back();
      const start = performance.now();
      while (performance.now() - start < 200);
    } else {
      // An idle one: the rewrite writes first, and the Back lands after it.
      setTimeout(back, 0);
    }
    return result;
  };
}"""
# `--quick-back=<point>` runs one point alone.
QUICK_BACK_POINTS = [arg.split('=', 1)[1] for arg in sys.argv if arg.startswith('--quick-back=')] or [
    'swap-task', 'swap-frame', 'rewrite-busy', 'rewrite-idle', 'past-the-base']


def quick_step_back(page, label):
    """Back pressed while a step's ladder rewrite is still ahead or in flight — in the task of the
    swap, the frame after it, inside the rewrite's own traversal onto the base on a busy main
    thread and on an idle one, and landing past the base once the rewrite has written. Whichever
    way they resolve, the viewer closes, once, to the list's own entry: the rewrite never writes
    the picture over the list (on the production build it did — the Back's popstate landed before
    the rewrite's continuation, which then wrote /pic/3001 over the list's entry and pushed a
    guard on top of it), and no rung of the ladder is left current. The list follows the viewer
    to the picture last on screen."""
    reached = {}
    for when in QUICK_BACK_POINTS:
        open_image(page)
        record(page)
        before = page.evaluate(NAV)
        page.evaluate(QUICK_BACK, when)
        page.keyboard.press('ArrowRight')
        try:
            page.wait_for_function('() => window.__quickBack === 1', timeout=6000)
            state(page, 'gallery-idle', timeout=8000)
            expect(page.locator('[data-image-detail-overlay]')).to_have_count(0)
            # Every rung stepped off: the list's own entry is current...
            try:
                page.wait_for_function('() => !history.state?.__picponyImageHero', timeout=6000)
            except Exception:
                raise AssertionError(f'a rung of the ladder is still current at {page.url}: {page.evaluate(NAV)}')
            # ...and nothing still in flight writes the picture back over it.
            page.wait_for_timeout(700)
            after = page.evaluate(NAV)
            assert page.url == BASE + '/user/1' and after['marker'] is None,                 f'the list reads {page.url} ({after})'
            assert after['index'] == before['index'] - 3, f'closed to another entry: {before} -> {after}'
            try:
                page.wait_for_function(f"() => ({FOCUSED_CARD})() === '3001'", timeout=4000)
            except Exception:
                raise AssertionError(f'focus is not on the card last on screen: {page.evaluate(FOCUSED_CARD)}')
        except Exception as error:
            raise AssertionError(f'Back at {when}: {error}') from error
        finally:
            page.evaluate('() => { if (window.__pristineGo) History.prototype.go = window.__pristineGo; }')
        save(page, f'{label}-{when}')
        reached[when] = 'list'
    return reached


def direct_back(page, label):
    """A cold load of a picture: 返回 goes up to the gallery in place of this entry (R4-041) —
    a fresh tab, so nothing of the app's is behind it."""
    tab = page.context.new_page()
    try:
        tab.goto(BASE + '/pic/3000', wait_until='networkidle')
        expect(tab.locator('[data-image-hero-role="detail"]')).to_be_visible()
        assert len(tab.evaluate(NAV)['entries']) == 1
        tab.keyboard.press('Escape')
        expect(tab).to_have_url(BASE + '/', timeout=6000)
        after = tab.evaluate(NAV)
        assert len(after['entries']) == 1, f'返回 pushed an entry: {after}'
    finally:
        tab.close()
    return {'replaced': True}

def opening_native_wheel(page, cdp, fixtures, label, close_after_handoff=False):
    """One native wheel stream starts on the Stage and outlives its visual handoff."""
    fixtures.hold_details = False
    page.mouse.move(0,0)
    fresh_profile(page)
    source = page.locator('[data-tab-pane-active] ' + THUMB + '[data-image-hero-id="3004"]')
    source.scroll_into_view_if_needed()
    page.wait_for_timeout(400)
    page.evaluate("""closeAfter => {
      const log=window.__openingWheel={frames:[],events:[]};window.__openingWheelOn=true;
      const originalFetch=window.fetch;
      let releaseRoute;
      const gate=new Promise(resolve=>{releaseRoute=resolve;});
      window.fetch=async (...args)=>{
        const result=await Reflect.apply(originalFetch,window,args);
        const raw=args[0] instanceof Request?args[0].url:String(args[0]);
        if(new URL(raw,location.href).pathname==='/pic/3004')await gate;
        return result;
      };
      window.__restoreOpeningFetch=()=>{releaseRoute();window.fetch=originalFetch;};
      let released=false,closeAt=null;
      const owner=n=>n?.closest?.('[data-image-hero-stage-scroll]')?'stage'
        :n?.closest?.('[data-image-hero-surface-id]')?'route':'gallery';
      const input=e=>{
        log.events.push({at:performance.now(),owner:owner(e.target),trusted:e.isTrusted});
        if(!released){released=true;setTimeout(releaseRoute,120);}
      };
      addEventListener('wheel',input,{capture:true,passive:true});
      const tick=()=>{
        if(!window.__openingWheelOn){removeEventListener('wheel',input,true);return;}
        const stage=document.querySelector('[data-image-hero-stage-scroll]');
        const route=document.querySelector('[data-image-hero-surface-id] .image-detail-overlay-scroll');
        const flyer=document.querySelector('.image-hero-flyer');
        const target=route?.querySelector('[data-image-hero-role="detail"]');
        const picture=flyer??target;
        const phase=document.documentElement.dataset.imageHeroState;
        const at=performance.now();
        log.frames.push({at,phase,stage:stage?.scrollTop??null,route:route?.scrollTop??null,
          gallery:document.querySelector('[data-image-hero-gallery-scroll]')?.scrollTop,
          y:picture?.getBoundingClientRect().y??null});
        if(closeAfter&&phase==='detail-idle'){
          closeAt??=at;
          if(at-closeAt>150){closeAt=Infinity;document.querySelector('[data-image-hero-surface-id] [data-image-detail-back-button]')?.click();}
        }
        requestAnimationFrame(tick);
      };requestAnimationFrame(tick);
    }""", close_after_handoff)
    try:
        source.locator('..').evaluate('link=>link.click()')
        cdp.send('Input.synthesizeScrollGesture', {'x':900,'y':500,'yDistance':-480,
            'speed':90,'gestureSourceType':'mouse','preventFling':True})
        state(page, 'gallery-idle' if close_after_handoff else 'detail-idle')
        page.wait_for_timeout(400)
        log = page.evaluate('window.__openingWheelOn=false;window.__openingWheel')
        (OUTPUT/(label+'.json')).write_text(json.dumps(log),encoding='utf-8')
        assert log['events'][0]['trusted'] and log['events'][0]['owner']=='stage', log['events'][:1]
        handoff = next(f for f in log['frames'] if f['phase']=='detail-idle')
        end = log['frames'][-1]
        assert handoff['at'] < log['events'][-1]['at']-1000, 'the handoff must finish while the same stream continues'
        if close_after_handoff:
            closed = next(f for f in log['frames'] if f['phase']=='gallery-idle' and f['at']>handoff['at'])
            assert end['gallery']-closed['gallery']>60, 'the inherited stream stopped after closing'
            assert_clean(page,3004)
        else:
            assert end['route']>=460, f"Opening lost wheel movement: {end['route']} of 480 px"
            settled = [f['y'] for f in log['frames'] if f['phase'] in ('opening.landed','opening.handoff','detail-idle') and f['y'] is not None]
            assert all(b<=a+2 for a,b in zip(settled,settled[1:])), 'the image rebounded while scrolling downward'
            page.keyboard.press('Escape')
            assert_clean(page,3004)
        source.scroll_into_view_if_needed()
        page.wait_for_timeout(350)
        source.locator('..').click()
        state(page,'detail-idle')
        page.wait_for_timeout(250)
        reopened=page.locator(ROUTE).evaluate('n=>n.scrollTop')
        assert reopened==0, f'The new open retained a previous offset: {reopened}'
        page.keyboard.press('Escape')
        assert_clean(page,3004)
        return {'nativeWheelContinued':True,'closedDuringStream':close_after_handoff,'reopenedAtTop':True}
    finally:
        page.evaluate('window.__openingWheelOn=false;window.__restoreOpeningFetch()')
        fixtures.release_details()


def run(browser, name, width, only=None):
    context = browser.new_context(viewport={'width':width,'height':900}, reduced_motion='no-preference',
                                  is_mobile=width<500, has_touch=width<500, service_workers='block')
    fixtures = HeroFixtures()
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
        cases += [('shield-wheel', lambda label: shield_scroll(page,cdp,label)),
                  ('shield-tap', lambda label: shield_tap(page,cdp,label,width<500)),
                  ('continued-wheel', lambda label: continued_scroll(page,cdp,label)),
                  ('continued-opening-wheel', lambda label: continued_scroll(page,cdp,label,opening=True)),
                  ('continued-wheel-reopen', lambda label: continued_scroll(page,cdp,label,reopen=True))]
        if width >= 500:
            cases += [('wheel-before', lambda label: wheel_return(page,label,0,True)),
                      ('stale-wheel-takeover', lambda label: stale_wheel_takeover(page,label)),
                      ('opening-native-wheel', lambda label: opening_native_wheel(page,cdp,fixtures,label)),
                      ('opening-native-wheel-close', lambda label: opening_native_wheel(page,cdp,fixtures,label,True))]
        else:
            cases += [(f'touch-{gap}', lambda label,gap=gap: touch_return(page,cdp,label,gap)) for gap in [70,245,320]]
            cases += [('shield-touch', lambda label: shield_scroll(page,cdp,label,True))]
            cases += [('continued-touch', lambda label: continued_scroll(page,cdp,label,touch=True))]
        cases += [('interrupt', lambda label: interrupted_open(page,label)),
                  ('stale-wheel-expiry', lambda label: stale_wheel_expiry(page,label)),
                  ('resize-interrupt', lambda label: interrupted_open(page,label,True)),
                  ('opening-handoff', lambda label: opening_handoff(page,label)),
                  ('detail-content', lambda label: detail_content_handoff(page,fixtures,label)),
                  ('detail-content-reduced', lambda label: detail_content_handoff(page,fixtures,label,'reduced')),
                  ('detail-content-off', lambda label: detail_content_handoff(page,fixtures,label,'off')),
                  ('detail-content-empty', lambda label: detail_content_handoff(page,fixtures,label,empty=True)),
                  ('cancel-return', lambda label: cancelled_return(page,label)),
                  ('pull-frame', lambda label: pull_frame(page,label)),
                  ('pull-loading', lambda label: pull_loading_content(page,fixtures,label)),
                  ('pull-follow', lambda label: pull_follow(page,label)),
                  ('pull-retreat', lambda label: pull_retreat(page,label)),
                  ('covered-tab-order', lambda label: covered_tab_order(page,label)),
                  ('covered-release', lambda label: covered_release(page,label)),
                  ('return-focus', lambda label: return_focus(page,label))]
        cases += [(f'loading-escape-scroll-{delay}', lambda label,delay=delay:
                   loading_escape_scroll(page,fixtures,label,delay)) for delay in [40,170,260,450]]
        cases += [('landing', lambda label: landing(page,label)),
                  ('landing-content-resize', lambda label: landing(page,label,True)),
                  ('prev-next', lambda label: prev_next(page,label)),
                  ('step-back', lambda label: step_back(page,label)),
                  ('forward-replay', lambda label: forward_replay(page,label)),
                  ('lightbox-back', lambda label: lightbox_back(page,label)),
                  ('lightbox-depth', lambda label: lightbox_depth(page,label)),
                  ('dialog-back', lambda label: dialog_back(page,label)),
                  ('reopen-during-close', lambda label: reopen_during_close(page,label)),
                  ('reopen-scrolled-close', lambda label: reopen_during_close(page,label,True)),
                  ('repeat-open', lambda label: repeat_open(page,label)),
                  ('same-image-interruption', lambda label: same_image_interruption(page,label)),
                  ('same-image-history-interruption', lambda label: same_image_interruption(page,label,True)),
                  ('same-image-close-interruption', lambda label: same_image_interruption(page,label,False,True)),
                  ('same-image-close-history-interruption', lambda label: same_image_interruption(page,label,True,True)),
                  ('same-image-fast-interruption', lambda label: same_image_interruption(page,label,True,False,True)),
                  ('same-image-fast-close-interruption', lambda label: same_image_interruption(page,label,True,True,True)),
                  ('same-image-button-interruption', lambda label: same_image_interruption(page,label,button=True)),
                  ('same-image-button-close-interruption', lambda label: same_image_interruption(page,label,from_detail=True,button=True)),
                  ('same-image-reopen-settle', lambda label: same_image_interruption(page,label,turn_count=9)),
                  ('same-image-history-reopen-settle', lambda label: same_image_interruption(page,label,True,turn_count=9)),
                  ('same-image-close-settle', lambda label: same_image_interruption(page,label,from_detail=True,turn_count=9)),
                  ('same-image-history-close-settle', lambda label: same_image_interruption(page,label,True,True,turn_count=9)),
                  ('same-image-pending-close', lambda label: pending_history_turn(page,label)),
                  ('same-image-pending-restore', lambda label: pending_history_turn(page,label,True)),
                  ('same-image-press-tail', lambda label: same_image_press_tail(page,cdp,label,width<500)),
                  ('pull-reopen', lambda label: pull_reopen(page,label)),
                  ('return-surface', lambda label: return_surface(page,label)),
                  ('return-scroll-surface', lambda label: return_surface(page,label,True)),
                  ('return-scroll-fallback', lambda label: return_surface(page,label,True,True,True)),
                  ('return-scroll-reopen', lambda label: return_surface(page,label,True,False,True)),
                  ('reload-collapse', lambda label: reload_collapse(page,label)),
                  ('direct-back', lambda label: direct_back(page,label)),
                  ('step-across-page', lambda label: step_across_page(page,label)),
                  ('step-across-page-flightless', lambda label: step_across_page(page,label,True)),
                  ('quick-step-back', lambda label: quick_step_back(page,label)),
                  ('quick-steps', lambda label: quick_steps(page,label))]
        if width < 500:
            cases += [('swipe-step', lambda label: swipe_step(page,cdp,label)),
                      ('swipe-arrival-takeover', lambda label: swipe_arrival_takeover(page,label)),
                      ('swipe-exit-takeover', lambda label: swipe_exit_takeover(page,label)),
                      ('swipe-video', lambda label: swipe_video(page,cdp,fixtures,label)),
                      ('swipe-exit-video', lambda label: swipe_exit_video(page,fixtures,label)),
                      ('swipe-page-end', lambda label: swipe_page_end(page,cdp,label)),
                      ('swipe-marathon', lambda label: swipe_marathon(page,cdp,fixtures,label))]
        if only:
            cases = [(case,work) for case,work in cases if case in only]
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
    browser = playwright.chromium.launch(**BROWSER_CHANNEL, headless=True)
    for profile in [('desktop',1440),('mobile',390)]:
        if not REQUESTED_PROFILES or profile[0] in REQUESTED_PROFILES:
            run(browser,*profile)
    # The wide desktop: four columns and a centred well, where both legs have the longest reach.
    if not REQUESTED_PROFILES or 'wide' in REQUESTED_PROFILES:
        run(browser,'wide',1920,only={'landing','landing-content-resize','step-back','lightbox-back','lightbox-depth'})
    browser.close()
for missing in sorted(REQUESTED_CASES - MATCHED_CASES):
    FAILURES.append({'case':missing,'error':'Unknown hero test case'})
for missing in sorted(REQUESTED_PROFILES - {'desktop','mobile','wide'}):
    FAILURES.append({'case':missing,'error':'Unknown hero test profile'})
(OUTPUT/'results.json').write_text(json.dumps({'results':RESULTS,'failures':FAILURES},indent=2),encoding='utf-8')
print(f'{len(RESULTS)} passed, {len(FAILURES)} failed; {OUTPUT / "results.json"}',flush=True)
sys.exit(1 if FAILURES else 0)
