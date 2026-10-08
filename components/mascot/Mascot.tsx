'use client';

import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type MouseEvent, type PointerEvent } from 'react';
import { MdClose, MdExpandMore } from 'react-icons/md';
import IconButton from '@/components/IconButton';
import { useSyncedSetting } from '@/lib/settingsSync';
import { useMediaQuery, useStoredBoolean } from '@/lib/hooks';
import { MEDIA } from '@/lib/constants';
import { MASCOT_KEYS, MASCOT_PIXELS, writeStored } from '@/lib/mascot/settings';
import { SKIP, useResource } from '@/lib/resource';
import { mascotConfig, mascotShape } from '@/lib/mascot/queries';
import { shapeHead, shapeLift, shapePath } from '@/lib/mascot/shapeModel';
import { MOTION_SPEED_SCALE, entranceMotion, motionTier, scaledMs } from '@/lib/appearance';
import { getAppScroller } from '@/lib/appScroller';
import { TOUCH_PRESS_DELAY_MS, TOUCH_SLOP_PX } from '@/lib/ripple';
import { SPRING_MS } from '@/lib/spring';
import { springTiming } from '@/lib/springTiming';
import { clamp, cn } from '@/lib/utils';
import styles from './Mascot.module.css';

/** How long a hold takes to open 彩彩 AI — the original's three seconds. */
const HOLD_MS = 3000;
/** A hold shows its countdown only once it is clearly a hold, so a tap never flashes the hint. */
const HOLD_HINT_MS = 350;
/** The squash shows for at least this long — scaled with the motion speed — so a tap too quick to
    have pressed yet still squashes the figure and springs back (`trackPress` plays a quick tap's
    press at once for the same reason). */
const MIN_PRESS_MS = 120;
/** The original's spacing between tips, so hovering back and forth is not a stream of chatter. */
const TIP_GAP_MS = 3000;
/** A pointer crossing a gap in the outline is still on the character: the lift waits this long
    before it settles (`Mascot.module.css` spells the same number), and an enter this soon after a
    leave is the same hover, not a new greeting. */
const HOVER_GRACE_MS = 150;
/** The collapsed plate: M3's FAB size, and the largest side of the character tucked into it. */
const PLATE_PX = 56;
const PEEK_PX = 44;
/** How far past the character's outline a pointer still counts as on it: a few pixels under a
    mouse, a fingertip's worth under a finger. */
const HIT_PAD = { fine: 3, coarse: 8 } as const;
/** From the top of the head to the bubble's foot: the tail's 8.5px and a clear gap. */
const BUBBLE_GAP = 14;
/** The tail's centre keeps this far in from the bubble's ends, clear of its 16dp corners. */
const TAIL_INSET = 24;
/** The bubble keeps this far inside the scroller it is drawn in. */
const EDGE_PX = 16;
/** The collapse control: 32dp, standing 6px out from the art's top-right corner, its target the
    touch floor around it (48 under a finger, the 32dp box itself under a mouse). Where the head
    reaches that corner — a small figure — it rises until its target keeps `TOOLS_GAP` off the
    character, so a tap on the hair is the character's. */
const TOOLS_PX = 32;
const TOOLS_OUT = 6;
const TOOLS_GAP = 4;
const TOUCH_FLOOR = { fine: 24, coarse: 48 } as const;
/** It reaches this far in from the art's right edge; a bubble over that strip stands 8px above it,
    which keeps its tail off it too. */
const TOOLS_REACH = TOOLS_PX - TOOLS_OUT;
const TOOLS_CLEAR = TOOLS_OUT + 8;

type Bubble = { kind: 'tip' | 'hold'; text: string };

/** Long enough to read: a base dwell plus a little per character, bounded both ways. */
const dwellFor = (text: string) => Math.min(12_000, Math.max(4_500, 3_000 + text.length * 90));

/**
 * The site mascot — the original's 绘云彩彩, rebuilt as one figure that belongs to this app.
 *
 * **What is kept from the original**, which is the identity decision 30 asks for: the character
 * standing at the bottom-right in its own silhouette shadow; lifting under a hovering pointer and
 * squashing under a press; hopping when it speaks a tip (on a tap, or a hover on a desktop); a long
 * press — or Space held — for three seconds opening 彩彩 AI; collapsing into a small, quiet peek in
 * the corner and greeting you with 我回来啦！ when brought back; and a drag that starts on it
 * scrolling the page instead of being swallowed.
 *
 * **What is this app's**: the motion system (springs per object, the three tiers, the speed scale,
 * 入场动画 for its first appearance), the speech bubble as the popover material with a tail rather
 * than a site toast, a hit region that is the character's own outline instead of its artwork's
 * box, a countdown that shows the hold is working, rising above the route's bottom navigation, one
 * live region for screen readers, and leaving and returning with an animation instead of a cut.
 *
 * **The character's outline comes from the server** (`app/mascot-shape/route.ts`): the artwork's
 * host sends no CORS headers, so the page cannot read its alpha. It is the hit region — a
 * `clip-path`, which clips hit-testing with the paint, so the artwork's transparent margins and the
 * gaps between wing and tail are the page's — and it says where the head is, which is where the
 * speech bubble's tail points. Until it lands, or if it never does, an ellipse over the art stands in.
 */
export default function Mascot({ onChat, active = true }: { onChat: () => void; active?: boolean }) {
  const selected = useSyncedSetting('mascotId');
  const config = useResource(mascotConfig, { selected }, { keepPrevious: 'mascot-runtime' });
  const desktopSize = useSyncedSetting('mascotSizeDesktop');
  const mobileSize = useSyncedSetting('mascotSizeMobile');
  const wide = useMediaQuery(MEDIA.md);
  const coarse = useMediaQuery(MEDIA.pointerCoarse);
  const collapsed = useStoredBoolean(MASCOT_KEYS.collapsed);
  const src = config.data?.enabled ? config.data.image : '';
  const shape = useResource(mascotShape, src ? { src } : SKIP);

  const [art, setArt] = useState<{ src: string; w: number; h: number } | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const [shown, setShown] = useState(false);
  const [instant, setInstant] = useState(false);
  const [pressed, setPressed] = useState(false);
  const [bubble, setBubble] = useState<Bubble | null>(null);
  const [bubbleOpen, setBubbleOpen] = useState(false);
  const [announcement, setAnnouncement] = useState('');

  const control = useRef<HTMLButtonElement | null>(null);
  const stage = useRef<HTMLDivElement | null>(null);
  const figure = useRef<HTMLSpanElement | null>(null);
  const bubbleNode = useRef<HTMLDivElement | null>(null);
  const reaction = useRef<HTMLSpanElement | null>(null);
  /* Whether the bubble is open, for the timers that run outside a render; when it last began to
     close; and the next utterance, waiting for it to be gone. */
  const openNow = useRef(false);
  const closedAt = useRef(-Infinity);
  const pending = useRef<{ timer: number; kind: Bubble['kind'] } | null>(null);
  /* What the bubble holds, readable from a handler without a stale closure. */
  const bubbleKind = useRef<Bubble['kind'] | null>(null);
  const holdFill = useRef<HTMLDivElement | null>(null);
  const meter = useRef<Animation | null>(null);
  const hold = useRef<{ pointer: number; x: number; y: number; timer: number; hint: number; started: number; hinted: boolean } | null>(null);
  const press = useRef<{ pointer: number; x: number; y: number; timer: number; shown: boolean } | null>(null);
  /* When the squash went on, and when it lets go: the hop of a tap waits for the release. */
  const pressedAt = useRef(0);
  const releaseAt = useRef(0);
  const releaseTimer = useRef(0);
  const hopTimer = useRef(0);
  const swallow = useRef(false);
  const leftAt = useRef(-Infinity);
  const dismissTimer = useRef(0);
  const lastTip = useRef({ at: 0, text: '' });
  const everShown = useRef(false);
  /* The head the next bubble points at, and how far the collapse control has risen — or null where
     it steps aside while the figure speaks. Refs, so an outline landing while a bubble is open does
     not move it under the reader; the next one uses them. */
  const headAt = useRef<{ x: number; top: number } | null>(null);
  const toolsAt = useRef<number | null>(0);

  const ready = !!src && art?.src === src && failed !== src;
  const size = wide ? MASCOT_PIXELS.desktop[desktopSize] : MASCOT_PIXELS.mobile[mobileSize];
  const aspect = ready && art ? art.w / art.h : 1;
  const artW = aspect >= 1 ? size : Math.round(size * aspect);
  const artH = aspect >= 1 ? Math.round(size / aspect) : size;
  const peek = PEEK_PX / Math.max(artW, artH);
  /* Scaled about its bottom-right corner, the figure would shrink into the plate's corner; these
     carry it to the plate's centre. */
  const peekX = -(PLATE_PX - artW * peek) / 2;
  const peekY = -(PLATE_PX - artH * peek) / 2;
  const visible = active && ready;
  const open = bubbleOpen && shown && !collapsed;
  /* An outline of another shape is another picture's (a stale answer, a rotated file): not used. */
  const outline = ready && art && shape.data && Math.abs(shape.data.w / shape.data.h - aspect) < 0.05 ? shape.data : null;
  const hitPath = outline ? shapePath(outline, artW, artH, coarse ? HIT_PAD.coarse : HIT_PAD.fine) : null;
  const head = outline ? shapeHead(outline) : null;
  const reach = Math.max(0, ((coarse ? TOUCH_FLOOR.coarse : TOUCH_FLOOR.fine) - TOOLS_PX) / 2);
  const toolsLift = outline
    ? Math.ceil(shapeLift(outline, artW, artH, { left: artW + TOOLS_OUT - TOOLS_PX - reach, right: artW + TOOLS_OUT + reach, top: -TOOLS_OUT - reach, bottom: TOOLS_PX - TOOLS_OUT + reach }, TOOLS_GAP))
    : 0;

  useLayoutEffect(() => {
    headAt.current = head;
    /* Under a finger the control is always shown and steps aside while the figure speaks
       (`Mascot.module.css`), so the bubble need not clear it. */
    toolsAt.current = coarse ? null : toolsLift;
  }, [head, coarse, toolsLift]);

  /* Arrive and leave on the tier's terms. The first appearance is volunteered by the app — an
     entrance — so 入场动画 off makes the figure simply be there; leaving and returning with a
     route or an overlay is the tier's business and always animates (AGENTS: 入场动画). */
  useEffect(() => {
    if (!visible) {
      const frame = requestAnimationFrame(() => setShown(false));
      return () => cancelAnimationFrame(frame);
    }
    const first = !everShown.current;
    everShown.current = true;
    const skip = first && !entranceMotion();
    let settle = 0;
    const frame = requestAnimationFrame(() => {
      if (skip) setInstant(true);
      setShown(true);
      if (skip) settle = requestAnimationFrame(() => requestAnimationFrame(() => setInstant(false)));
    });
    return () => { cancelAnimationFrame(frame); cancelAnimationFrame(settle); };
  }, [visible]);

  /* Away (another route's media, a dialog, the keyboard) or collapsed, nothing is in progress.
     Spelled out on the refs rather than calling `endHold`/`closeBubble`, which are declared below:
     an effect reading a function before its declaration is a bail-out for the React Compiler. */
  useEffect(() => {
    if (active && !collapsed) return;
    if (hold.current) { clearTimeout(hold.current.timer); clearTimeout(hold.current.hint); hold.current = null; }
    if (press.current) { clearTimeout(press.current.timer); press.current = null; }
    if (pending.current) { clearTimeout(pending.current.timer); pending.current = null; }
    clearTimeout(releaseTimer.current);
    clearTimeout(hopTimer.current);
    clearTimeout(dismissTimer.current);
    releaseAt.current = 0;
    pressedAt.current = 0;
    if (openNow.current) { openNow.current = false; closedAt.current = performance.now(); }
    queueMicrotask(() => { setPressed(false); setBubbleOpen(false); });
  }, [active, collapsed]);

  useEffect(() => () => {
    if (hold.current) { clearTimeout(hold.current.timer); clearTimeout(hold.current.hint); }
    if (press.current) clearTimeout(press.current.timer);
    if (pending.current) clearTimeout(pending.current.timer);
    clearTimeout(releaseTimer.current);
    clearTimeout(hopTimer.current);
    clearTimeout(dismissTimer.current);
  }, []);

  /* Where the bubble stands, measured each time it is given something to say, since its own width
     decides it: centred over the head where the scroller allows, never past the art's right edge,
     with its tail on the head and its foot just above it. Where it would pass over the collapse
     control (under a mouse — under a finger the control steps aside), it steps left of the control
     while its tail can still reach the head, and only otherwise stands above it: standing above a
     risen control put a small figure's tail 23px off its head. Written as properties on the bubble
     rather than state, before the frame that shows it. */
  useLayoutEffect(() => {
    const node = bubbleNode.current;
    const box = stage.current;
    if (!node || !box || !bubble) return;
    const width = node.offsetWidth;
    const at = headAt.current ?? { x: 0.5, top: 0 };
    const fromRight = artW * (1 - at.x);
    /* The farthest in from the art's right edge its right end may sit, keeping it off the floor. */
    const floor = (getAppScroller()?.getBoundingClientRect().left ?? 0) + EDGE_PX;
    const most = Math.max(0, box.getBoundingClientRect().left + artW - width - floor);
    let right = clamp(fromRight - width / 2, 0, most);
    let bottom = artH * (1 - at.top) + BUBBLE_GAP;
    const lift = toolsAt.current;
    const above = lift === null ? 0 : artH + TOOLS_CLEAR + lift;
    if (right < TOOLS_REACH && above > bottom) {
      if (TOOLS_REACH <= most && fromRight - TOOLS_REACH >= TAIL_INSET - 1) right = TOOLS_REACH;
      else bottom = above;
    }
    const tail = width > TAIL_INSET * 2 ? clamp(fromRight - right, TAIL_INSET, width - TAIL_INSET) : width / 2;
    node.style.setProperty('--bubble-right', `${right}px`);
    node.style.setProperty('--bubble-bottom', `${bottom}px`);
    node.style.setProperty('--bubble-tail', `${tail}px`);
  }, [bubble, artW, artH]);

  function closeBubble() {
    clearTimeout(dismissTimer.current);
    if (pending.current) { clearTimeout(pending.current.timer); pending.current = null; }
    if (!openNow.current) return;
    openNow.current = false;
    closedAt.current = performance.now();
    setBubbleOpen(false);
  }
  function scheduleDismiss(text: string) {
    clearTimeout(dismissTimer.current);
    dismissTimer.current = window.setTimeout(closeBubble, dwellFor(text));
  }
  /** One utterance at a time. What is on screen leaves on FastEffects before the next one rises out
      of the tail, so the bubble never changes its words and its size in one frame — and one still
      leaving is waited out rather than reopened with new words half-faded. */
  function present(next: Bubble) {
    clearTimeout(dismissTimer.current);
    if (pending.current) clearTimeout(pending.current.timer);
    pending.current = null;
    if (openNow.current) {
      openNow.current = false;
      closedAt.current = performance.now();
      setBubbleOpen(false);
    }
    const reveal = () => {
      pending.current = null;
      bubbleKind.current = next.kind;
      openNow.current = true;
      setBubble(next);
      setBubbleOpen(true);
      if (next.kind !== 'tip') return;
      /* One persistent live region, written into, so a tip is announced once — not as a
         role="status" node created with its content (which some readers skip) and also named as
         the button's description (which repeated it on every focus). */
      setAnnouncement('');
      queueMicrotask(() => setAnnouncement(next.text));
      scheduleDismiss(next.text);
    };
    const wait = closedAt.current + scaledMs(SPRING_MS.fastEffects) - performance.now();
    if (wait > 0) pending.current = { timer: window.setTimeout(reveal, wait), kind: next.kind };
    else reveal();
  }

  /* The hop when it speaks: up on the fast spatial spring, then down on the expressive one, whose
     small overshoot is the landing. Its own box (`.react`), because the pose's CSS transition would
     outrank a WAAPI animation on the same element. After a tap it waits for the squash to let go,
     so the release springs into the hop. The reduced tier's spring substitution removes the
     overshoot and keeps a 6px rise; the off tier keeps the figure still. */
  function leap() {
    const node = reaction.current;
    if (!node || motionTier() === 'off') return;
    for (const running of node.getAnimations()) running.cancel();
    const up = springTiming('fastSpatial');
    const down = springTiming('expressiveFastSpatial');
    const lift = node.animate([{ transform: 'none' }, { transform: 'translateY(-6px) scale(1.05)' }], { duration: up.duration, easing: up.easing, fill: 'forwards' });
    lift.finished
      .then(() => {
        const land = node.animate([{ transform: 'translateY(-6px) scale(1.05)' }, { transform: 'none' }], { duration: down.duration, easing: down.easing });
        lift.cancel();
        return land.finished;
      })
      .catch(() => { /* Cancelled by the next hop, which has already taken over. */ });
  }
  function hop() {
    clearTimeout(hopTimer.current);
    const wait = releaseAt.current - performance.now();
    if (wait > 0) hopTimer.current = window.setTimeout(leap, wait);
    else leap();
  }

  function speak() {
    const tips = config.data?.tips;
    if (!tips?.length) return;
    const now = Date.now();
    if (now - lastTip.current.at < TIP_GAP_MS) return;
    const pool = tips.length > 1 ? tips.filter((tip) => tip !== lastTip.current.text) : tips;
    const text = pool[Math.floor(Math.random() * pool.length)];
    lastTip.current = { at: now, text };
    present({ kind: 'tip', text });
    hop();
  }

  function setCollapsed(value: boolean) {
    writeStored(MASCOT_KEYS.collapsed, String(value));
    window.dispatchEvent(new Event('settings_updated'));
  }
  function collapse() {
    closeBubble();
    setCollapsed(true);
    /* The control is the one focus target left; without this, focus fell to the document. */
    requestAnimationFrame(() => control.current?.focus({ preventScroll: true }));
  }
  function expand() {
    setCollapsed(false);
    lastTip.current = { at: Date.now(), text: '' };
    /* Spoken once the figure has grown back, so the bubble rises out of the full figure — on the
       figure's own transition end, not a fixed delay, which at 缓慢 opened the bubble out of a
       figure still growing. The bound is the wall-clock rule's, for a transition that never
       reports (关闭 runs none). */
    const node = figure.current;
    let spoken = false;
    const greet = () => {
      if (spoken) return;
      spoken = true;
      node?.removeEventListener('transitionend', onEnd);
      window.clearTimeout(bound);
      present({ kind: 'tip', text: '我回来啦！' });
    };
    const onEnd = (event: TransitionEvent) => {
      if (event.target === node && event.propertyName === 'transform') greet();
    };
    node?.addEventListener('transitionend', onEnd);
    const bound = window.setTimeout(greet, motionTier() === 'off' ? 0 : SPRING_MS.defaultSpatial * MOTION_SPEED_SCALE.slow + 50);
  }

  /* ---- The hold: three seconds to 彩彩 AI ---------------------------------------------------- */

  /** `started` is the pressing event's own time stamp, on the clock `performance.now()` reads. */
  function beginHold(pointer: number, x: number, y: number, started: number) {
    endHold();
    swallow.current = false;
    const hint = window.setTimeout(() => {
      if (hold.current) hold.current.hinted = true;
      present({ kind: 'hold', text: '继续按住，打开彩彩 AI' });
    }, HOLD_HINT_MS);
    const timer = window.setTimeout(() => {
      if (hold.current) clearTimeout(hold.current.hint);
      hold.current = null;
      swallow.current = true;
      endPress('cancel');
      closeBubble();
      /* A touch hold never focused the control; give the dialog a stable opener to return to. */
      control.current?.focus({ preventScroll: true });
      onChat();
    }, HOLD_MS);
    hold.current = { pointer, x, y, timer, hint, started, hinted: false };
  }
  function endHold() {
    const current = hold.current;
    if (!current) return;
    clearTimeout(current.timer);
    clearTimeout(current.hint);
    hold.current = null;
    /* Once the countdown has shown, letting go is cancelling it, not a tap: no tip and no hop
       answer a gesture the user abandoned. */
    if (current.hinted) swallow.current = true;
    if (bubbleKind.current === 'hold' || pending.current?.kind === 'hold') closeBubble();
  }

  /* The countdown starts where the hold already is — the hint appears 350ms in — and runs to the
     end of the hold on a linear clock, because it *is* that clock: a determinate meter of elapsed
     time, which every tier shows (AGENTS: under 关闭 a determinate meter still shows its value). */
  useEffect(() => {
    const fill = holdFill.current;
    const current = hold.current;
    if (!fill || !open || bubble?.kind !== 'hold' || !current) return;
    meter.current?.cancel();
    const animation = fill.animate([{ transform: 'translateX(-100%)' }, { transform: 'translateX(0)' }], { duration: HOLD_MS, easing: 'linear', fill: 'forwards' });
    animation.currentTime = Math.min(HOLD_MS, performance.now() - current.started);
    meter.current = animation;
    /* Let go, the meter stays where the hold left it while the bubble fades: cancelled, it snapped
       back to empty under the fade. The next hold replaces it. */
    return () => animation.pause();
  }, [open, bubble]);

  /* ---- Press feedback ----------------------------------------------------------------------- */

  function pressIn() {
    clearTimeout(releaseTimer.current);
    releaseAt.current = 0;
    pressedAt.current = performance.now();
    setPressed(true);
  }
  function letGo() {
    clearTimeout(releaseTimer.current);
    releaseAt.current = 0;
    pressedAt.current = 0;
    setPressed(false);
  }
  /** A finger's press waits for the tap timeout before it shows, as every press in the app does;
      a mouse or a pen presses at once. */
  function beginPress(event: PointerEvent<HTMLElement>) {
    endPress('cancel');
    const touch = event.pointerType === 'touch';
    const current = { pointer: event.pointerId, x: event.clientX, y: event.clientY, timer: 0, shown: !touch };
    if (touch) current.timer = window.setTimeout(() => { current.shown = true; pressIn(); }, TOUCH_PRESS_DELAY_MS);
    else pressIn();
    press.current = current;
  }
  /** Let go once the squash has shown for `MIN_PRESS_MS`, so a tap too quick to have pressed yet
      still squashes and springs back. A press that became a scroll, a drag or 彩彩 AI opening is
      `cancel`led: dropped now, with nothing to play. */
  function endPress(mode: 'release' | 'cancel') {
    const current = press.current;
    press.current = null;
    if (current) clearTimeout(current.timer);
    if (mode === 'cancel') {
      letGo();
      return;
    }
    if (current && !current.shown) pressIn();
    if (!pressedAt.current) return;
    const left = pressedAt.current + scaledMs(MIN_PRESS_MS) - performance.now();
    if (left <= 0) {
      letGo();
      return;
    }
    clearTimeout(releaseTimer.current);
    releaseAt.current = performance.now() + left;
    releaseTimer.current = window.setTimeout(letGo, left);
  }

  function onPointerDown(event: PointerEvent<HTMLElement>) {
    if (!event.isPrimary || event.button !== 0) return;
    swallow.current = false;
    beginPress(event);
    if (!collapsed) beginHold(event.pointerId, event.clientX, event.clientY, event.timeStamp);
  }
  function onPointerMove(event: PointerEvent<HTMLElement>) {
    const origin = press.current ?? hold.current;
    if (!origin || origin.pointer !== event.pointerId) return;
    if (Math.hypot(event.clientX - origin.x, event.clientY - origin.y) > TOUCH_SLOP_PX) {
      swallow.current = true;
      endHold();
      endPress('cancel');
    }
  }
  function onPointerUp() {
    endHold();
    endPress('release');
  }
  /** A mouse that leaves the character with its button held abandons the press. Only a press in
      progress: a finger's `pointerleave` follows its `pointerup`, and cancelling there dropped the
      squash a quick tap had only just put on. */
  function onPointerLeave(event: PointerEvent<HTMLElement>) {
    if (event.pointerType === 'mouse') leftAt.current = performance.now();
    if (press.current?.pointer !== event.pointerId) return;
    endHold();
    endPress('cancel');
  }
  function onPointerCancel() {
    /* The browser took the touch for a scroll: not a tap, so no tip either. */
    swallow.current = true;
    endHold();
    endPress('cancel');
  }
  /** A hover greets — once per visit, and never over what the bubble is already saying: a tip
      still open (or on its way) stays, and coming back across a gap in the outline is the same
      visit. A tap is the way to ask for another. */
  function onPointerEnter(event: PointerEvent<HTMLElement>) {
    if (event.pointerType !== 'mouse' || collapsed) return;
    if (performance.now() - leftAt.current < scaledMs(HOVER_GRACE_MS)) return;
    if (pending.current || (openNow.current && bubbleKind.current === 'tip')) return;
    if (window.matchMedia(`(hover: hover) and ${MEDIA.pointerFine}`).matches) speak();
  }

  function onClick(event: MouseEvent<HTMLButtonElement>) {
    if (event.detail === 0) swallow.current = false;
    if (swallow.current) { swallow.current = false; return; }
    if (collapsed) expand();
    else speak();
  }
  function onKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    if (event.key === 'Enter') swallow.current = false;
    if (event.key === 'Escape') { endHold(); closeBubble(); return; }
    if (event.key === ' ' && !collapsed) {
      event.preventDefault();
      if (event.repeat) return;
      pressIn();
      beginHold(-1, 0, 0, event.timeStamp);
    }
  }
  function onKeyUp(event: KeyboardEvent<HTMLButtonElement>) {
    if (event.key !== ' ' || collapsed) return;
    event.preventDefault();
    /* After `endHold`, which is what marks a hold released past its countdown as cancelled. */
    endHold();
    endPress('release');
    if (!swallow.current) speak();
    swallow.current = false;
  }

  if (!src || failed === src) return null;

  return (
    <div className={cn(styles.dock, 'z-page-chrome')}>
      <div className={styles.lift}>
        <div
          ref={stage}
          data-mascot=""
          data-state={shown ? 'shown' : 'hidden'}
          data-pressed={pressed ? '' : undefined}
          data-speaking={open ? '' : undefined}
          aria-hidden={!shown || undefined}
          inert={!shown || undefined}
          className={cn(styles.stage, collapsed ? styles.collapsed : styles.expanded, instant && styles.instant, 'group')}
          style={{
            '--box-w': `${artW}px`,
            '--box-h': `${artH}px`,
            '--plate': `${PLATE_PX}px`,
            '--art-w': `${artW}px`,
            '--art-h': `${artH}px`,
            '--peek': String(peek),
            '--peek-x': `${peekX}px`,
            '--peek-y': `${peekY}px`,
            '--tools-lift': `${toolsLift}px`,
          } as CSSProperties}
        >
          <div
            ref={bubbleNode}
            data-open={open ? 'true' : 'false'}
            inert={!open || undefined}
            aria-hidden={!open || undefined}
            className={cn(styles.bubble, 'rounded-lg bg-surface-container text-on-surface forced-boundary')}
            onPointerEnter={() => clearTimeout(dismissTimer.current)}
            onPointerLeave={() => { if (bubble?.kind === 'tip' && openNow.current) scheduleDismiss(bubble.text); }}
            onFocus={() => clearTimeout(dismissTimer.current)}
            onBlur={() => { if (bubble?.kind === 'tip' && openNow.current) scheduleDismiss(bubble.text); }}
          >
            {bubble?.kind === 'hold' ? (
              <div className="w-56 max-w-full px-4 py-3">
                <p className="text-body-m">{bubble.text}</p>
                <div className={cn(styles.holdTrack, 'mt-2.5 bg-secondary-container')}>
                  <div ref={holdFill} className={cn(styles.holdFill, 'bg-secondary')} />
                </div>
              </div>
            ) : (
              <div className="flex items-start gap-1 py-2 pl-4 pr-1">
                <p className={cn(styles.bubbleBody, 'popover-scrollbar min-w-0 flex-1 py-1.5 text-body-m wrap-anywhere')}>{bubble?.text}</p>
                <IconButton dismiss size="sm" aria-label="关闭吉祥物对话" onClick={closeBubble} icon={<MdClose />} />
              </div>
            )}
          </div>

          <button
            ref={control}
            type="button"
            data-ripple={collapsed ? 'inner' : undefined}
            /* The ring keeps a band of the page's surface inside it: the figure stands over whatever
               the page shows, a picture included, and the band gives the ring the edge it has
               everywhere else (G1-022; AGENTS → Focus). */
            className={cn(styles.control, 'focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-offset-surface focus-ring')}
            aria-label={collapsed ? '展开吉祥物' : '与彩彩互动，长按或按住空格 3 秒打开彩彩 AI'}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerCancel}
            onPointerLeave={onPointerLeave}
            onPointerEnter={onPointerEnter}
            onContextMenu={(event) => event.preventDefault()}
            onClick={onClick}
            onKeyDown={onKeyDown}
            onKeyUp={onKeyUp}
            onBlur={() => { endHold(); endPress('cancel'); }}
          >
            {/* The plate is the collapsed control's ripple host: a FAB's press. */}
            <span data-ripple-host="" className={cn(styles.plate, 'bg-surface-container-high text-on-surface shadow-e3')} aria-hidden="true" />
            <span
              className={styles.hit}
              style={hitPath && !collapsed ? { clipPath: `path('${hitPath}')` } : undefined}
              aria-hidden="true"
            />
            <span ref={figure} className={styles.figure} aria-hidden="true">
              <span className={styles.pose}>
                <span className={styles.squash}>
                  <span ref={reaction} className={styles.react}>
                    {/* Administrator-configured original art: a native image with no referrer. */}
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      key={src}
                      src={src}
                      alt=""
                      draggable={false}
                      decoding="async"
                      referrerPolicy="no-referrer"
                      className={styles.art}
                      ref={(node) => {
                        if (node?.complete && node.naturalWidth > 0 && art?.src !== src) {
                          const { naturalWidth: w, naturalHeight: h } = node;
                          queueMicrotask(() => setArt({ src, w, h }));
                        }
                      }}
                      onLoad={(event) => {
                        const { naturalWidth: w, naturalHeight: h } = event.currentTarget;
                        if (w > 0 && h > 0) setArt({ src, w, h });
                        else setFailed(src);
                      }}
                      onError={() => setFailed(src)}
                    />
                  </span>
                </span>
              </span>
            </span>
          </button>

          {/* Tucks the figure into its plate: the chevron that collapses a docked player into its mini
              form, on the tonal container an action sitting over content takes. */}
          <div className={cn(styles.tools, 'hover-reveal')} inert={collapsed || undefined}>
            <IconButton variant="tonal" size="sm" aria-label="收起吉祥物" onClick={collapse} icon={<MdExpandMore />} />
          </div>

          <p className="sr-only" role="status" aria-live="polite">{announcement}</p>
        </div>
      </div>
    </div>
  );
}
