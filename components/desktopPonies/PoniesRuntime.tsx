'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useResource, SKIP } from '@/lib/resource';
import { ponyCatalog, myPonies, ponyConfigs } from '@/lib/desktopPonies/queries';
import { cn, randomId } from '@/lib/utils';
import { MEDIA } from '@/lib/constants';
import { MOTION_SPEED_SCALE, motionScale, useMotionSpeed, subscribeAppearance } from '@/lib/appearance';
import { getAppScroller } from '@/lib/appScroller';
import { showToast } from '@/components/Toast';
import type { PonyConfig } from '@/lib/api/desktopPonies';
import styles from './PoniesRuntime.module.css';

const BASE_SPEED = 3;
/** How long an emptied frame is kept: the 撤销 under 清空, and a pony put back a moment after it was
    removed, find the engine — and the spots their ponies left — still there. */
const EMPTY_GRACE_MS = 10_000;
/** Frames the content area must hold its size for before the frame is told its new stage. */
const SETTLE_FRAMES = 2;

interface Rect { x: number; y: number; width: number; height: number }

/**
 * The account's chosen ponies, kept on the page while the selection changes underneath them.
 *
 * Configurations are read **only for ponies not already loaded** and kept once read: choosing a
 * pony costs one `get_pony_configs` for that pony alone, deselecting one costs nothing, and the
 * frame applies either in place. The whole set used to be the read's key, so every change was a
 * read of every chosen pony and a new frame — each pick in /settings sent the others back to
 * random spots, after a moment with none of them on screen.
 *
 * **The frame outlives what covers it and an empty selection.** `paused` (a dialog, a picture, the
 * keyboard) stops the engine where it is and fades the layer; a route change or a flight does not
 * touch it at all. It used to be unmounted for all of them, so every navigation and every dialog
 * dropped the ponies for a second or two and respawned them at random spots. Emptied, it is kept
 * for `EMPTY_GRACE_MS`, so each pony fades out on the engine's own clock instead of being cut with
 * the frame, and an undo brings them back where they stood.
 */
export default function PoniesRuntime({ token, paused }: { token: string; paused: boolean }) {
  const catalog = useResource(ponyCatalog, {});
  const chosen = useResource(myPonies, { token });
  const names = catalog.data?.enabled ? (chosen.data ?? []).filter(name => catalog.data!.ponies.some(p => p.name === name)) : [];
  const [loaded, setLoaded] = useState<readonly PonyConfig[]>([]);
  const [merged, setMerged] = useState<readonly PonyConfig[] | undefined>();
  const missing = names.filter(name => !loaded.some(config => config.name === name));
  const read = useResource(ponyConfigs, missing.length ? { names: missing } : SKIP);
  if (read.data && read.data !== merged) {
    const fresh = read.data;
    setMerged(fresh);
    setLoaded(previous => [...previous.filter(config => !fresh.some(item => item.name === config.name)), ...fresh]);
  }
  const configs = names.flatMap(name => loaded.find(config => config.name === name) ?? []);
  const [held, setHeld] = useState(false);
  if (configs.length > 0 && !held) setHeld(true);
  const empty = configs.length === 0;
  useEffect(() => {
    if (!empty || !held) return;
    const timer = window.setTimeout(() => setHeld(false), EMPTY_GRACE_MS);
    return () => window.clearTimeout(timer);
  }, [empty, held]);
  if (!held) return null;
  return <PonyFrame configs={configs} paused={paused} />;
}

/**
 * The original Browser Ponies engine, running in a disposable sandbox frame over the content area,
 * with one invisible control per pony laid over its sprite for pointer and keyboard.
 *
 * **Nothing is written to the page per frame.** The engine reports each sprite's rect; they are
 * kept in memory, and a control is placed over its sprite only while it matters: a fine pointer is
 * over that pony, it is being dragged, or it has keyboard focus. Mirroring every rect onto every
 * control each frame cost one style recalculation per frame for as long as the feature was on
 * (190 in 6 seconds with a single pony).
 *
 * **Under a finger the ponies are scenery.** A control over a wandering sprite is a moving dead
 * region on a phone — a tap on the picture under a pony did nothing — and dragging is a pointer
 * gesture. So a coarse pointer gets no hit targets at all; the ponies still walk, and every tap
 * reaches the page. The keyboard controls remain on every device.
 *
 * **No state layer.** A control over a sprite with a transparent margin painted a grey box over
 * whatever was behind it on hover; the pony's own reaction (it stops, it speaks) is the feedback.
 *
 * **The layer lives beside the scroller, in the box the scroller fills** (`main` is `absolute
 * inset-0` in it), and covers it by the stylesheet. Inside the scroller it had to be `fixed` and
 * measured onto the scroller in script, so every frame of a docked drawer run — which resizes the
 * content area — rewrote its box after layout and laid the page out a second time.
 */
function PonyFrame({ configs, paused }: { configs: PonyConfig[]; paused: boolean }) {
  const [host] = useState(() => getAppScroller()?.parentElement ?? null);
  const frame = useRef<HTMLIFrameElement>(null);
  const layer = useRef<HTMLDivElement>(null);
  const targets = useRef(new Map<string, HTMLButtonElement>());
  const rects = useRef(new Map<string, Rect>());
  const tracked = useRef(new Set<string>());
  const [channel] = useState(randomId);
  const speed = useMotionSpeed();
  const initialized = useRef(false);
  const warned = useRef(false);
  const gesture = useRef<{ pointerId: number; name: string; x: number; y: number; moved: boolean } | null>(null);
  const focused = useRef<string | null>(null);
  const suppressClick = useRef(false);
  const current = useRef(configs);
  const sent = useRef('');
  const pausedNow = useRef(paused);
  const stage = useRef<{ width: number; height: number } | null>(null);

  function send(type: string, payload: Record<string, unknown> = {}) {
    frame.current?.contentWindow?.postMessage({ source: 'picpony-companions', channel, type, ...payload }, '*');
  }
  function pointer(type: string, name: string, x: number, y: number) {
    const bounds = layer.current?.getBoundingClientRect();
    if (bounds) send(type, { name, x: x - bounds.x, y: y - bounds.y });
  }
  /** Lay one control over its sprite's last known rect. Refs only, so one function for the frame's life. */
  const place = useCallback((name: string) => {
    const button = targets.current.get(name);
    const rect = rects.current.get(name);
    if (!button || !rect) return;
    button.style.transform = `translate(${rect.x}px, ${rect.y}px)`;
    button.style.width = `${rect.width}px`;
    button.style.height = `${rect.height}px`;
  }, []);
  const track = useCallback((name: string, on: boolean) => {
    const button = targets.current.get(name);
    if (on) { tracked.current.add(name); place(name); button?.setAttribute('data-active', ''); }
    else { tracked.current.delete(name); button?.removeAttribute('data-active'); }
  }, [place]);

  /* **The stage is the layer's box, told to the frame once it settles — the frame is never
     resized for it.** The layer follows the content area by the stylesheet (less the home pill's
     band, so the ponies walk above the pill rather than across it); the frame is the window's size
     under it, and the engine walks the stage it is sent. A sandboxed frame is its own process:
     resized on every frame of a drawer run, as it was, it kept each of the page's frames waiting
     on the frame's new surface — one pony cost the drawer 18 dropped frames in six runs where the
     drawer alone dropped none, and resizing it once at the end still held one frame per run. The
     new stage goes over when the box has held still for `SETTLE_FRAMES` — the end of a drawer run,
     a paused window drag, the band arriving. Until then the ponies ride the leading edge, clipped
     by the area: what they did when the frame was resized every frame, as the engine moves no pony
     on a resize. */
  useEffect(() => {
    const node = layer.current;
    if (!node) return;
    /* `quiet` counts the frames since the area last changed: the rAF below counts one up, and
       the observer — which reports after that frame's layout — sets it back. */
    const run = { size: null as { width: number; height: number } | null, first: true, quiet: 0, wait: 0 };
    const apply = () => {
      run.wait = 0;
      if (!run.size) return;
      stage.current = run.size;
      run.size = null;
      if (initialized.current) frame.current?.contentWindow?.postMessage({ source: 'picpony-companions', channel, type: 'stage', ...stage.current }, '*');
    };
    const settle = () => {
      run.quiet += 1;
      if (run.quiet >= SETTLE_FRAMES) apply();
      else run.wait = requestAnimationFrame(settle);
    };
    const observer = new ResizeObserver(entries => {
      const box = entries[entries.length - 1].contentRect;
      run.size = { width: box.width, height: box.height };
      run.quiet = 0;
      if (run.first) { run.first = false; apply(); return; }
      if (!run.wait) run.wait = requestAnimationFrame(settle);
    });
    observer.observe(node);
    return () => { observer.disconnect(); cancelAnimationFrame(run.wait); };
  }, [channel]);

  /* A fine pointer finds its pony by arithmetic over the stored rects — no hit target is needed
     until it is over one, and none sits over the page until then. */
  useEffect(() => {
    if (!window.matchMedia(MEDIA.pointerFine).matches) return;
    let frameId = 0;
    let last: { x: number; y: number } | null = null;
    const check = () => {
      frameId = 0;
      if (pausedNow.current) return;
      const bounds = layer.current?.getBoundingClientRect();
      if (!bounds || !last) return;
      const x = last.x - bounds.x, y = last.y - bounds.y;
      for (const [name, rect] of rects.current) {
        const over = x >= rect.x && x <= rect.x + rect.width && y >= rect.y && y <= rect.y + rect.height;
        const held = gesture.current?.name === name || focused.current === name;
        if (over && !tracked.current.has(name)) track(name, true);
        else if (!over && !held && tracked.current.has(name)) track(name, false);
      }
    };
    const move = (event: globalThis.PointerEvent) => {
      if (event.pointerType !== 'mouse' && event.pointerType !== 'pen') return;
      last = { x: event.clientX, y: event.clientY };
      if (!frameId) frameId = requestAnimationFrame(check);
    };
    window.addEventListener('pointermove', move, { passive: true });
    return () => { window.removeEventListener('pointermove', move); cancelAnimationFrame(frameId); };
  }, [track]);

  /* A change of selection after the frame has started is sent as a diff (see `ponies-frame.js`);
     before that, `init` reads the latest set. The keyboard controls are React's own and follow the
     list; a pony that left takes its rect and its tracking with it. */
  useEffect(() => {
    current.current = configs;
    const key = JSON.stringify(configs.map(config => config.name));
    for (const name of [...rects.current.keys()]) {
      if (!configs.some(config => config.name === name)) { rects.current.delete(name); tracked.current.delete(name); }
    }
    if (!initialized.current || key === sent.current) return;
    sent.current = key;
    frame.current?.contentWindow?.postMessage({ source: 'picpony-companions', channel, type: 'configs', configs }, '*');
  }, [configs, channel]);

  useEffect(() => {
    const target = frame.current;
    /* The mascot's bubble, spelled out for a document the tokens cannot reach: its container and
       ink, its corner, level 2 as a filter, and its text role (`body-m`, read off a probe so the
       frame gets the computed font, not the body's larger one). */
    const theme = () => {
      const style = getComputedStyle(document.documentElement);
      const probe = document.createElement('span');
      probe.className = 'text-body-m';
      probe.hidden = true;
      document.body.appendChild(probe);
      const text = getComputedStyle(probe);
      const font = text.font;
      const tracking = text.letterSpacing;
      probe.remove();
      return {
        surface: style.getPropertyValue('--md-sys-color-surface-container'),
        ink: style.getPropertyValue('--md-sys-color-on-surface'),
        radius: style.getPropertyValue('--radius-lg'),
        filter: style.getPropertyValue('--md-sys-elevation-filter-2'),
        font,
        tracking,
        motion: motionScale(),
      };
    };
    const sendToFrame = (type: string, payload: Record<string, unknown> = {}) => target?.contentWindow?.postMessage({ source: 'picpony-companions', channel, type, ...payload }, '*');
    const receive = (event: MessageEvent) => {
      if (event.source !== target?.contentWindow || event.data?.source !== 'picpony-ponies') return;
      if (event.data.type === 'ready') {
        if (initialized.current) return; // the frame answers both its own load and the ping
        initialized.current = true;
        sent.current = JSON.stringify(current.current.map(config => config.name));
        sendToFrame('init', { configs: current.current, speed: BASE_SPEED / MOTION_SPEED_SCALE[speed], theme: theme(), paused: pausedNow.current, stage: stage.current }); return;
      }
      if (event.data.channel !== channel) return;
      if (event.data.type === 'error' && !warned.current) { warned.current = true; showToast('桌面小马暂时无法加载，可在设置中重新选择', 'warning'); }
      if (event.data.type !== 'rects' || !Array.isArray(event.data.rects)) return;
      for (const rect of event.data.rects.slice(0, 6)) {
        if (typeof rect?.name !== 'string' || ![rect.x, rect.y, rect.width, rect.height].every(Number.isFinite) || rect.width <= 0 || rect.height <= 0) continue;
        if (!current.current.some(config => config.name === rect.name)) continue; // a pony that has since left
        const first = !rects.current.has(rect.name);
        rects.current.set(rect.name, { x: rect.x, y: rect.y, width: rect.width, height: rect.height });
        /* Placed once so the keyboard can reach it; after that only while it is tracked. */
        if (first) { place(rect.name); targets.current.get(rect.name)?.setAttribute('data-placed', ''); }
        else if (tracked.current.has(rect.name)) place(rect.name);
      }
    };
    window.addEventListener('message', receive);
    const stopTheme = subscribeAppearance(() => sendToFrame('theme', { theme: theme() }));
    return () => { window.removeEventListener('message', receive); stopTheme(); };
  }, [channel, place, speed]);

  useEffect(() => {
    if (initialized.current) frame.current?.contentWindow?.postMessage({ source: 'picpony-companions', channel, type: 'speed', speed: BASE_SPEED / MOTION_SPEED_SCALE[speed] }, '*');
  }, [channel, speed]);

  /* Covered, the engine stops where it is and the layer fades on FastEffects; uncovered, it walks
     on from the same spots (see `ponies-frame.js`). Before the frame has started, `init` carries it. */
  useEffect(() => {
    pausedNow.current = paused;
    if (paused) for (const name of [...tracked.current]) track(name, false);
    if (initialized.current) frame.current?.contentWindow?.postMessage({ source: 'picpony-companions', channel, type: paused ? 'pause' : 'resume' }, '*');
  }, [channel, paused, track]);

  if (!host) return null;
  return createPortal(<div ref={layer} data-desktop-ponies="" data-paused={paused || undefined} inert={paused || undefined} className={cn(styles.layer, 'z-companions')}>
    <iframe ref={frame} title="桌面小马动画" src="/companions/ponies-frame.html" sandbox="allow-scripts" referrerPolicy="no-referrer" tabIndex={-1} aria-hidden="true" className={styles.frame}
      onLoad={() => send('ping')} />
    {configs.map(config => <button
      key={config.name}
      type="button"
      ref={node => { if (node) targets.current.set(config.name, node); else targets.current.delete(config.name); }}
      /* A band of the page's surface inside the ring: a pony walks over anything, pictures included
         (G1-022; the mascot's control does the same). */
      className={cn(styles.target, 'rounded-md focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-offset-surface focus-ring')}
      aria-label={`${config.name}，方向键移动，回车让它说话`}
      onFocus={() => { focused.current = config.name; track(config.name, true); if (!gesture.current) send('focus', { name: config.name }); }}
      onBlur={() => { focused.current = null; if (gesture.current?.name !== config.name) track(config.name, false); send('blur', { name: config.name }); }}
      onKeyDown={event => {
        const directions: Record<string, [number, number]> = { ArrowLeft: [-16, 0], ArrowRight: [16, 0], ArrowUp: [0, -16], ArrowDown: [0, 16] };
        const direction = directions[event.key]; if (direction) { event.preventDefault(); send('nudge', { name: config.name, dx: direction[0], dy: direction[1] }); }
      }}
      onPointerEnter={event => pointer('mouseover', config.name, event.clientX, event.clientY)}
      onPointerLeave={event => { if (!gesture.current) pointer('mouseout', config.name, event.clientX, event.clientY); }}
      onPointerDown={event => {
        if (!event.isPrimary || event.button !== 0) return;
        event.currentTarget.setPointerCapture(event.pointerId);
        suppressClick.current = false;
        gesture.current = { pointerId: event.pointerId, name: config.name, x: event.clientX, y: event.clientY, moved: false };
        pointer('mousedown', config.name, event.clientX, event.clientY);
      }}
      onPointerMove={event => { if (gesture.current?.pointerId === event.pointerId) { if (Math.hypot(event.clientX - gesture.current.x, event.clientY - gesture.current.y) > 8) gesture.current.moved = true; pointer('mousemove', config.name, event.clientX, event.clientY); } }}
      onPointerUp={event => { pointer('mouseup', config.name, event.clientX, event.clientY); suppressClick.current = gesture.current?.moved ?? false; gesture.current = null; }}
      onPointerCancel={event => { pointer('mouseup', config.name, event.clientX, event.clientY); suppressClick.current = true; gesture.current = null; }}
      onClick={() => { if (suppressClick.current) { suppressClick.current = false; return; } send('speak', { name: config.name }); }}
    />)}
  </div>, host);
}
