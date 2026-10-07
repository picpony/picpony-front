/* Original engine runs only in this disposable, opaque-origin sandbox. */
(() => {
  'use strict';
  let channel = '', timer = 0, started = false;
  let names = [];
  let theme = {};
  /* Why the engine is stopped: `away` while the page is covered (a dialog, a picture, the keyboard —
     the layer is faded out meanwhile), `focus` while the keyboard holds a pony. Kept as a set so one
     reason ending does not wake the ponies under another: the focused pony's blur used to resume a
     frame that a dialog had paused. */
  const holds = new Set();
  /* The engine's `start()` waits for the first moment nothing holds it: started under a hold, its
     own load callback would start the clock behind the pause. */
  let deferred = false;
  /* A change of selection that arrived while held, applied on release: the engine spawns a pony only
     into a running clock, so one added while paused was never drawn. */
  let queued = null;
  /* Where each pony that left was standing, so one put back within a minute — 撤销 under 清空, or a
     pony deselected by mistake — walks in where it left rather than at a random spot. */
  const left = new Map();
  const settle = new Map();
  const RETURN_MS = 60_000;
  /* The app's speed scale (0.7 / 1 / 1.4): CSS reads it as --motion, and the engine's own fade —
     a removed pony, a speech bubble's exit — runs 150ms of it. The runtime only exists in the
     standard tier, so it is never 0 here. */
  const motion = () => { const value = Number(theme.motion); return Number.isFinite(value) && value > 0 ? value : 1; };
  const applyMotion = () => {
    document.documentElement.style.setProperty('--motion', String(motion()));
    window.BrowserPonies?.setFadeDuration(Math.round(150 * motion()));
  };
  const instance = name => {
    const ponies = window.BrowserPonies?.ponies(), key = String(name).toLowerCase();
    return ponies && Object.hasOwn(ponies, key) ? ponies[key].instances?.[0] : undefined;
  };
  const tell = data => parent.postMessage({ ...data, source: 'picpony-ponies', channel }, '*');
  /** Load one pony and spawn it; false if the engine refused its configuration. */
  const add = config => {
    if (!config || typeof config.name !== 'string' || typeof config.ini !== 'string' || typeof config.baseurl !== 'string') return false;
    try {
      BrowserPonies.loadConfig({ ponies: [{ ini: config.ini, baseurl: config.baseurl }], spawn: { [config.name]: 1 } });
      const pony = instance(config.name);
      if (pony) hookSpeech(pony);
      return !!pony;
    } catch { tell({ type: 'error' }); return false; }
  };
  /** A returning pony takes its old spot once the engine has drawn it (its load may be async). */
  const settleSpots = () => {
    for (const [name, spot] of settle) {
      const pony = instance(name);
      if (!pony) { settle.delete(name); continue; }
      if (!pony.img.isConnected) continue;
      pony.setPosition({ x: spot.x, y: spot.y });
      pony.clipToScreen();
      settle.delete(name);
    }
  };
  /* A change of selection is applied in place: a pony that left fades out, one that joined walks
     in, and the rest carry on where they are. The frame used to be torn down and rebuilt for
     every change, so choosing a sixth pony sent the other five back to random spots. */
  const apply = configs => {
    const wanted = configs.filter(c => c && typeof c.name === 'string').map(c => c.name);
    const now = Date.now();
    for (const name of names) {
      if (wanted.includes(name)) continue;
      const pony = instance(name);
      if (pony) { const at = pony.position(); left.set(name, { x: at.x, y: at.y, at: now }); }
      try { BrowserPonies.removePony(name); } catch { /* already gone */ }
      reported.delete(name);
      settle.delete(name);
    }
    const joined = configs.filter(c => c && !names.includes(c.name) && add(c)).map(c => c.name);
    for (const name of joined) {
      const spot = left.get(name);
      left.delete(name);
      if (spot && now - spot.at < RETURN_MS) settle.set(name, spot);
    }
    names = [...names.filter(name => wanted.includes(name)), ...joined];
    settleSpots();
  };
  /* **The stage is the content area, not this frame's viewport.** The frame is the window's size,
     so nothing the page does to the content area — a docked drawer's run, the home pill's band —
     ever resizes it (a resized frame holds the page's frames back on its new surface); the page
     sends the area's box instead (`stage`), once it has settled. The engine measures its world by
     `innerWidth` / `innerHeight` (and so does the speech below), so those two answer with the
     stage; before the first one arrives they are the frame's own. */
  let stage = null;
  const stageOf = data => {
    const width = Math.floor(Number(data?.width)), height = Math.floor(Number(data?.height));
    return width > 0 && height > 0 ? { width, height } : null;
  };
  for (const [key, axis] of [['innerWidth', 'width'], ['innerHeight', 'height']]) {
    const own = Object.getOwnPropertyDescriptor(window, key) || Object.getOwnPropertyDescriptor(Window.prototype, key);
    if (typeof own?.get !== 'function') continue;
    Object.defineProperty(window, key, { configurable: true, enumerable: own.enumerable, get: () => (stage ? stage[axis] : own.get.call(window)) });
  }
  /* A new stage arrives once per change of the area, not per frame. A pony the smaller stage
     leaves outside — carried past the trailing edge as a docked drawer opened — walks back in now,
     on the engine's own terms (its next behaviour, moving into the screen), instead of standing
     cut off at the edge until its current one runs out. One wholly past the edge is out of sight,
     so it is first brought up to the edge, unseen, to step straight back in rather than walk a
     drawer's width in the dark. Held, it waits for the release. */
  let restage = false;
  const walkIn = () => {
    restage = false;
    for (const name of names) {
      const pony = instance(name);
      if (!pony?.img.isConnected || !pony.isOffscreen()) continue;
      const at = pony.topLeftPosition();
      if (stage && (at.x >= stage.width || at.y >= stage.height)) {
        pony.setTopLeftPosition({ x: Math.min(at.x, stage.width), y: Math.min(at.y, stage.height) });
      }
      pony.nextBehavior();
    }
  };
  const hold = (reason, on) => {
    const was = holds.size > 0;
    if (on) holds.add(reason); else holds.delete(reason);
    const now = holds.size > 0;
    if (!started) return;
    if (now && !was) {
      BrowserPonies.pause();
      /* A start, a resume or a spawn still waiting on its images starts the clock when they land;
         stop it again behind them. */
      BrowserPonies.Util.onload(() => { if (holds.size > 0) BrowserPonies.pause(); });
    } else if (!now && was) {
      if (deferred) { deferred = false; restage = false; BrowserPonies.start(); } else BrowserPonies.resume();
      if (queued) { const next = queued; queued = null; apply(next); }
      if (restage) walkIn();
    }
    if (!holds.has('away') && !timer) timer = requestAnimationFrame(frame);
  };
  /* The last rect reported per pony: a standing pony reports nothing, so an idle page receives no
     message at all, and a walking one at most one per frame. Away, the loop stops altogether. */
  const reported = new Map();
  const moved = (a, b) => !a || Math.abs(a.x - b.x) > 0.5 || Math.abs(a.y - b.y) > 0.5 || Math.abs(a.width - b.width) > 0.5 || Math.abs(a.height - b.height) > 0.5;
  function frame() {
    timer = 0;
    if (!started || holds.has('away')) return;
    if (settle.size) settleSpots();
    const rects = names.flatMap(name => {
      const pony = instance(name);
      if (!pony?.img.isConnected) return [];
      const box = pony.img.getBoundingClientRect();
      const rect = { name, x: box.x, y: box.y, width: box.width, height: box.height };
      if (!moved(reported.get(name), rect)) return [];
      reported.set(name, rect);
      return [rect];
    });
    if (rects.length) tell({ type: 'rects', rects });
    /* Every rect read before any bubble is written, so following them costs no forced layout. */
    if (speaking.size) {
      const boxes = [];
      for (const [node, entry] of speaking) {
        if (!node.isConnected || !entry.pony.img.isConnected) speaking.delete(node);
        else boxes.push([node, entry, entry.pony.img.getBoundingClientRect()]);
      }
      for (const [node, entry, box] of boxes) placeSpeech(node, entry, box);
    }
    timer = requestAnimationFrame(frame);
  }
  /* A pony's speech wears the mascot's bubble: the popover recipe (the container tone, the large
     corner, level 2 as a filter so the tail casts its shadow with the body, no keyline), the
     mascot's text role and its 16px inset — so the two companions speak alike. */
  function speechStyle(node) {
    node.style.background = theme.surface || '';
    node.style.color = theme.ink || '';
    node.style.font = theme.font || '';
    node.style.letterSpacing = theme.tracking || '';
    node.style.borderRadius = theme.radius || '';
    node.style.boxShadow = 'none';
    node.style.filter = theme.filter || '';
    node.style.border = '0';
    node.style.padding = '10px 16px';
    node.style.maxWidth = `${Math.max(0, Math.min(240, innerWidth - 16))}px`;
    node.style.setProperty('--motion', String(Number(theme.motion) || 0));
  }
  /* Each bubble and its speaker. The engine places a bubble once, centred on the sprite with its
     own 4px padding (so the restyle above pushed it 10px off centre), hanging below it (so near the
     bottom it was clamped over its own pony), and leaves it there while the pony walks on. Here it
     stands over its speaker for as long as it is up, its tail on the sprite. */
  const speaking = new Map();
  const SPEECH_GAP = 10;
  const SPEECH_EDGE = 8;
  const TAIL_INSET = 18;
  function measure(node, entry) {
    entry.w = node.offsetWidth;
    entry.h = node.offsetHeight;
  }
  function placeSpeech(node, entry, box) {
    const vw = innerWidth, vh = innerHeight;
    const centre = box.left + box.width / 2;
    const left = Math.max(SPEECH_EDGE, Math.min(vw - entry.w - SPEECH_EDGE, centre - entry.w / 2));
    const above = box.top - SPEECH_GAP - entry.h >= SPEECH_EDGE;
    const below = box.bottom + SPEECH_GAP + entry.h <= vh - SPEECH_EDGE;
    /* Above, where speech is drawn; below only where the top of the frame is in the way — and kept
       on its side while it still fits, so a pony walking along an edge does not flip it. */
    const side = entry.side === 'below' ? (below || !above ? 'below' : 'above') : (above || !below ? 'above' : 'below');
    const top = side === 'above' ? box.top - SPEECH_GAP - entry.h : box.bottom + SPEECH_GAP;
    node.style.left = `${left}px`;
    node.style.top = `${Math.max(SPEECH_EDGE, Math.min(vh - entry.h - SPEECH_EDGE, top))}px`;
    node.style.setProperty('--tail', `${Math.max(TAIL_INSET, Math.min(entry.w - TAIL_INSET, centre - left))}px`);
    if (side !== entry.side) {
      entry.side = side;
      node.dataset.side = side;
    }
  }
  function adopt(node, pony) {
    speechStyle(node);
    const entry = { pony, w: 0, h: 0, side: '' };
    measure(node, entry);
    placeSpeech(node, entry, pony.img.getBoundingClientRect());
    /* The attribute last: its entrance starts from the place and the side just given it. */
    node.setAttribute('data-pony-speech', '');
    speaking.set(node, entry);
  }
  /* The engine has no hook for speech, so its one method is wrapped, once: the bubble it appends to
     its overlay is the speaking instance's. */
  let hooked = false;
  function hookSpeech(pony) {
    const proto = Object.getPrototypeOf(pony);
    if (hooked || typeof proto?.speak !== 'function') return;
    hooked = true;
    const speak = proto.speak;
    proto.speak = function (time, speech) {
      const overlay = BrowserPonies.Util.getOverlay();
      const before = overlay.lastElementChild;
      const result = speak.call(this, time, speech);
      const node = overlay.lastElementChild;
      if (node instanceof HTMLElement && node !== before && node.tagName === 'DIV') adopt(node, this);
      return result;
    };
  }
  addEventListener('message', event => {
    if (event.source !== parent || !event.data || event.data.source !== 'picpony-companions') return;
    const data = event.data;
    if (data.type === 'ping') { tell({ type: 'ready' }); return; }
    if (data.type === 'init') {
      if (started || typeof data.channel !== 'string' || !Array.isArray(data.configs) || data.configs.length > 6 || !window.BrowserPonies) return;
      channel = data.channel; theme = data.theme || {}; stage = stageOf(data.stage);
      try {
        BrowserPonies.loadConfig({ fps: 60, speed: data.speed, showLoadProgress: false, audioEnabled: false, preloadAll: false });
        applyMotion();
        names = data.configs.filter(add).map(c => c.name);
        started = true;
        if (data.paused) holds.add('away');
        if (holds.size > 0) deferred = true; else BrowserPonies.start();
        if (!holds.has('away')) timer = requestAnimationFrame(frame);
      } catch { tell({ type: 'error' }); }
      return;
    }
    if (!started || data.channel !== channel) return;
    if (data.type === 'theme') {
      theme = data.theme || {};
      applyMotion();
      for (const [node, entry] of speaking) { speechStyle(node); measure(node, entry); }
      return;
    }
    if (data.type === 'configs') {
      if (!Array.isArray(data.configs) || data.configs.length > 6) return;
      if (holds.size > 0) queued = data.configs; else apply(data.configs);
      return;
    }
    if (data.type === 'stage') {
      const next = stageOf(data);
      if (!next) return;
      stage = next;
      if (holds.size > 0) restage = true; else walkIn();
      return;
    }
    if (data.type === 'pause') { hold('away', true); return; }
    if (data.type === 'resume') { hold('away', false); return; }
    if (data.type === 'speed') { BrowserPonies.setSpeed(data.speed); return; }
    if (data.type === 'blur') { hold('focus', false); return; }
    const pony = instance(data.name);
    if (!pony) return;
    if (data.type === 'focus') { hold('focus', true); return; }
    if (data.type === 'speak') { pony.speakRandom(Date.now(), 1); return; }
    if (data.type === 'nudge') {
      const position = pony.position();
      pony.setPosition({ x: position.x + Number(data.dx || 0), y: position.y + Number(data.dy || 0) });
      pony.clipToScreen(); return;
    }
    if (['mousedown', 'mousemove', 'mouseup', 'mouseover', 'mouseout'].includes(data.type)) {
      const options = { bubbles: true, clientX: Number(data.x || 0), clientY: Number(data.y || 0), button: 0, buttons: data.type === 'mouseup' ? 0 : 1 };
      (data.type === 'mousemove' || data.type === 'mouseup' ? document : pony.img).dispatchEvent(new MouseEvent(data.type, options));
    }
  });
  addEventListener('pagehide', () => { started = false; cancelAnimationFrame(timer); speaking.clear(); BrowserPonies.unspawnAll(); BrowserPonies.stop(); });
  parent.postMessage({ source: 'picpony-ponies', type: 'ready' }, '*');
})();
