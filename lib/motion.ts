'use client';

import { useEffect, useLayoutEffect, useRef, useSyncExternalStore, type RefObject } from 'react';
import gsap from 'gsap';
import { useGSAP } from '@gsap/react';
import { CustomEase } from 'gsap/CustomEase';
import { Flip } from 'gsap/Flip';
import { Observer } from 'gsap/Observer';
import { ScrollToPlugin } from 'gsap/ScrollToPlugin';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { BREAKPOINTS } from '@/lib/constants';

gsap.registerPlugin(useGSAP, CustomEase, Flip, Observer, ScrollToPlugin, ScrollTrigger);

/**
 * Motion tokens for GSAP-driven animation. The same curves live in
 * globals.css (`--ease-*` in @theme) for CSS transitions/keyframes — keep the
 * two in sync so scripted and declarative motion feel identical.
 * CustomEase registers by name, so `ease: 'decelerate'` works in any tween.
 */
export const eases = {
  standard: CustomEase.create('standard', '0.2, 0, 0, 1'),
  decelerate: CustomEase.create('decelerate', '0.05, 0.7, 0.1, 1'),
  accelerate: CustomEase.create('accelerate', '0.3, 0, 0.8, 0.15'),
  /**
   * M3's emphasized curve — two cubic segments, so unlike the three above it
   * cannot be written as four numbers. CustomEase takes the spec path as-is.
   *
   * It hangs back for the first sixth, snaps through at 2.5x `standard`'s peak
   * speed, then takes a long tail into rest. That is what the spec reserves for
   * a large container transform, and what stops a full-window slide reading as
   * a rigid plate being pushed across at a constant clip.
   */
  emphasized: CustomEase.create(
    'emphasized',
    'M0,0 C0.05,0 0.133333,0.06 0.166666,0.4 C0.208333,0.82 0.25,1 1,1',
  ),
  spring: 'back.out(1.55)',
  /**
   * Long-distance scrolling. Starts and ends at rest, so it needs to ease at
   * both ends — the M3 curves above are one-sided (`accelerate` is for content
   * leaving the screen and lands at full speed, which reads as the page being
   * yanked into place).
   */
  scroll: CustomEase.create('scroll', '0.33, 0, 0, 1'),
} as const;

gsap.defaults({ ease: eases.standard, duration: 0.4, overwrite: 'auto' });

/* Never let a stalled frame be charged to an animation.
 *
 * GSAP advances tweens by real elapsed time, so work that blocks the main
 * thread is paid for out of the animation rather than delaying it. Measured on
 * the home tab switch: the route push and React commit stall painting for
 * ~84ms, and the first frame the user actually sees is already 25% into the
 * tween with the panes two thirds of the way across. It reads as a snap
 * followed by a crawl — not as a slow animation, which is why it was hard to
 * place by eye.
 *
 * `lagSmoothing` is GSAP's own answer: past the threshold, pretend the frame
 * took `adjustedLag` instead. The default 500ms is far above anything a React
 * commit costs, so it never engaged. 100ms is above a normal dropped frame and
 * below the stalls this app actually produces. */
gsap.ticker.lagSmoothing(100, 33);

/**
 * The M3 duration scale, in seconds (GSAP's unit).
 *
 * These existed only as prose in globals.css and as ~10 different inline
 * literals across this file, so nothing in the app shared a timing. Pair them
 * with the curve the spec prescribes:
 *
 *   entering the screen → `long` + `decelerate`
 *   leaving the screen  → `short` + `accelerate`
 *   begins and ends on screen → `medium` + `standard`
 *   large container transform → `emphasized` + `standard`
 *
 * `press` is below the scale on purpose: a press-down must feel like contact,
 * not like an animation. CSS twins are the `duration-*` utilities — 200/300/400
 * exist in Tailwind by default, so no theme entry is needed.
 *
 * `state` is below it again, and is the one value here that this file does not
 * own: it is the `state-layer` utility's own `transition: opacity 150ms` in
 * globals.css. It is listed because a state layer is the most frequent piece of
 * motion in the app and it was the only timing with no entry here — which is
 * how `ToggleSwitch`, whose switch track cannot use the utility's `::before`,
 * ended up hand-typing `duration-150` with nothing to point at. Change one and
 * change the other.
 */
export const DURATION = {
  state: 0.15,
  press: 0.12,
  short: 0.2,
  medium: 0.3,
  long: 0.4,
  emphasized: 0.5,
} as const;

export const prefersReducedMotion = () =>
  typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

const REDUCED_QUERY = '(prefers-reduced-motion: reduce)';

/**
 * Reactive counterpart to `prefersReducedMotion()`.
 *
 * The plain function is a point-in-time read, which is right inside a tween
 * setup but wrong in a component: flipping the OS setting left already-mounted
 * components animating until something else happened to re-render them. This
 * subscribes, so the switch takes effect immediately.
 */
export function useReducedMotion(): boolean {
  return useSyncExternalStore(
    (onChange) => {
      const mql = window.matchMedia(REDUCED_QUERY);
      mql.addEventListener('change', onChange);
      return () => mql.removeEventListener('change', onChange);
    },
    () => window.matchMedia(REDUCED_QUERY).matches,
    // Server default is "animations on": it matches the CSS, which only opts
    // out inside a media query, so the first paint cannot disagree.
    () => false,
  );
}

/**
 * Paints one Material press wave inside `host`, centred on (`x`, `y`) given in
 * the host's own coordinates. The span cleans itself up.
 *
 * Normally you never call this — `<RippleLayer />` delegates it to anything
 * carrying `data-ripple`. It is exported for the one case delegation cannot
 * reach: a control whose ripple target is not an ancestor of what the pointer
 * actually hits, such as the switch, where the press lands on a full-size
 * input overlay but the wave belongs to the 40dp circle around the handle.
 */
export function spawnRipple(host: HTMLElement, x: number, y: number) {
  if (prefersReducedMotion()) return;
  // Radius reaching the farthest corner keeps the wave circular.
  const { width, height } = host.getBoundingClientRect();
  const radius = Math.hypot(Math.max(x, width - x), Math.max(y, height - y));

  const ripple = document.createElement('span');
  ripple.className = 'ripple';
  const size = radius * 2;
  ripple.style.width = `${size}px`;
  ripple.style.height = `${size}px`;
  ripple.style.left = `${x - radius}px`;
  ripple.style.top = `${y - radius}px`;
  host.appendChild(ripple);

  gsap
    .timeline({ onComplete: () => ripple.remove() })
    .fromTo(
      ripple,
      { scale: 0.25, opacity: 0.18 },
      { scale: 1, opacity: 0.12, duration: 0.45, ease: 'decelerate' },
    )
    .to(ripple, { opacity: 0, duration: 0.3, ease: 'none' }, '-=0.12');
}

/**
 * The element that actually scrolls the page.
 *
 * `<body>` is `overflow: hidden` and the scroller is the `<main>` inside the
 * app shell, so every `window.scrollTo({ top: 0 })` in the app was a no-op —
 * which is why paginating never returned you to the top of the list. There
 * were ~25 of those calls across the pages.
 */
export function getAppScroller(): HTMLElement | null {
  if (typeof document === 'undefined') return null;
  return document.querySelector<HTMLElement>('[data-image-hero-gallery-scroll]');
}

/**
 * Flags the app scroller for the length of any page-to-page move.
 *
 * The footer lives inside `[data-page-content]`, so the outgoing copy travels
 * with the page as part of the clone. This covers the *incoming* one, which is
 * a live node that would otherwise simply be there from the first frame — the
 * mark appearing before the page it belongs to has arrived. Held out for the
 * length of the move and faded in at settle. See `[data-page-transit]` in
 * globals.css.
 *
 * Armed for tab switches and route changes alike: the footer is below the
 * panes in a tab switch and inside the page in a route change, and in neither
 * case should it arrive ahead of the content.
 *
 * Reference-counted: two moves can be armed in the same tick, and the first to
 * settle must not un-flag the other.
 */
let transitDepth = 0;
export function beginPageTransit(): () => void {
  transitDepth += 1;
  getAppScroller()?.setAttribute('data-page-transit', '');
  let released = false;
  return () => {
    if (released) return;
    released = true;
    transitDepth = Math.max(0, transitDepth - 1);
    if (transitDepth === 0) getAppScroller()?.removeAttribute('data-page-transit');
  };
}

/**
 * Scrolls the app's real scroll container back to the top.
 *
 * Uses a GSAP tween rather than `scrollTo({ behavior: 'smooth' })`: native
 * smooth scrolling over a long masonry list janks while thumbnails decode, and
 * this way the easing matches the rest of the app's motion.
 *
 * Falls back to the window for any surface rendered outside the shell.
 */
export function scrollAppToTop({ smooth = true }: { smooth?: boolean } = {}) {
  const scroller = getAppScroller();
  const jump = !smooth || prefersReducedMotion();

  if (!scroller) {
    window.scrollTo(jump ? { top: 0 } : { top: 0, behavior: 'smooth' });
    return;
  }

  if (scroller.scrollTop === 0) return;
  runScroll(scroller, 0, jump);
}

/**
 * Scrolls so that `target`'s top edge sits at the top of the viewport.
 *
 * Paginating a gallery should land on the first row of the new page, not back
 * above the featured banner — you already chose to move past that, and
 * replaying it on every page turn just adds a scroll.
 *
 * `scroller` overrides which element is moved. It exists because not everything
 * that scrolls is the app scroller: an image-detail overlay brings its own, and
 * the two calls that used to reach for `element.scrollIntoView({ behavior:
 * 'smooth' })` did so precisely because they could not name it. That got them the
 * browser's own smooth curve — symmetric, ~variable duration, and the one
 * scrolling motion in the app that did not match the rest — so a "reply to this
 * comment" jump felt different depending on whether you had opened the picture
 * from the gallery or navigated to it directly.
 */
export function scrollAppToElement(
  target: Element | null,
  {
    smooth = true,
    offset = 8,
    scroller: override,
  }: { smooth?: boolean; offset?: number; scroller?: HTMLElement | null } = {},
) {
  if (!target) return;
  const scroller = override ?? getAppScroller();
  const jump = !smooth || prefersReducedMotion();

  if (!scroller) {
    const top = window.scrollY + target.getBoundingClientRect().top - offset;
    window.scrollTo(jump ? { top } : { top, behavior: 'smooth' });
    return;
  }

  const delta = target.getBoundingClientRect().top - scroller.getBoundingClientRect().top;
  const next = Math.max(0, scroller.scrollTop + delta - offset);
  // Already within a few pixels — moving would read as a twitch.
  if (Math.abs(next - scroller.scrollTop) < 4) return;
  runScroll(scroller, next, jump);
}

function runScroll(scroller: HTMLElement, to: number, jump: boolean) {
  if (jump) {
    scroller.scrollTop = to;
    return;
  }
  const distance = Math.abs(scroller.scrollTop - to);
  // Scroll anchoring is normally welcome here — it keeps the gallery steady as
  // thumbnails decode above the viewport. During a deliberate programmatic
  // scroll it fights us: the incoming page re-lays out mid-tween, the browser
  // "corrects" scrollTop to preserve the anchored element, and the result is a
  // visible lurch before the glide. Suspended for the length of the tween only.
  scroller.style.overflowAnchor = 'none';
  gsap.to(scroller, {
    scrollTo: { y: to },
    // Duration follows the square root of the distance, not the distance
    // itself: perceived travel speed scales sub-linearly, so a linear map makes
    // short hops feel sluggish and long ones feel frantic. The band keeps even
    // a whole-page jump under about a second.
    duration: gsap.utils.clamp(0.36, 1.1, 0.28 * Math.sqrt(distance / 300)),
    ease: 'scroll',
    overwrite: true,
    onComplete: () => {
      scroller.style.overflowAnchor = '';
    },
    onInterrupt: () => {
      scroller.style.overflowAnchor = '';
    },
  });
}

/**
 * Sliding active-indicator for tab groups. The indicator element (absolutely
 * positioned inside the container) glides to whichever child carries
 * `data-tab={active}`; the first placement is instant so nothing flies in
 * from x=0 on mount. Pass `extraDeps` when the tab list mounts late (e.g.
 * after data loads) so the initial measurement re-runs.
 */
export function useSlidingIndicator<
  C extends HTMLElement = HTMLDivElement,
  I extends HTMLElement = HTMLSpanElement,
>(
  active: string,
  extraDeps: unknown[] = [],
): { containerRef: RefObject<C | null>; indicatorRef: RefObject<I | null> } {
  const containerRef = useRef<C>(null);
  const indicatorRef = useRef<I>(null);
  const placed = useRef(false);

  useGSAP(
    () => {
      const indicator = indicatorRef.current;
      const target = containerRef.current?.querySelector<HTMLElement>(`[data-tab="${active}"]`);
      if (!indicator || !target) return;
      const place = { x: target.offsetLeft, width: target.offsetWidth };
      if (!placed.current || prefersReducedMotion()) {
        placed.current = true;
        gsap.set(indicator, place);
        return;
      }
      gsap.to(indicator, { ...place, duration: DURATION.long, ease: 'spring' });
    },
    // No `revertOnUpdate` here, deliberately — unlike every other hook in this
    // file. The callback's lasting effect is the `gsap.set` above, and
    // reverting it on each `active` change would drop the pill back to x=0
    // before every glide. Nothing accumulates either: the only thing it leaves
    // behind is a tween, and `gsap.defaults({ overwrite: 'auto' })` kills the
    // conflicting one for us.
    { scope: containerRef, dependencies: [active, ...extraDeps] },
  );

  return { containerRef, indicatorRef };
}

type ViewTransitionDocument = Document & {
  startViewTransition: (update: () => void | Promise<void>) => {
    ready: Promise<void>;
    updateCallbackDone: Promise<void>;
    finished: Promise<void>;
    skipTransition: () => void;
  };
};

type ThemeViewTransition = ReturnType<ViewTransitionDocument['startViewTransition']>;

interface ActiveThemeTransition {
  id: string;
  style: HTMLStyleElement;
  transition: ThemeViewTransition;
}

let activeThemeTransition: ActiveThemeTransition | null = null;
let themeTransitionId = 0;

/**
 * Geometry of the box the `::view-transition` pseudo-elements are painted into.
 *
 * That box is the *snapshot containing block*, and two things about it bite on
 * phones:
 *
 * - Its units are not reliably CSS pixels. Some mobile engines size it at
 *   device resolution, so a circle written in `px` lands compressed towards the
 *   top-left by roughly the device pixel ratio. Everything below is therefore
 *   expressed as a *fraction* of this box and emitted as percentages, which the
 *   engine resolves against the box itself — correct under any uniform scale.
 * - It spans the **large** viewport (browser UI retracted). Where the layout
 *   viewport is genuinely shorter, that extra band sits above the origin of
 *   client coordinates, and everything placed by `getBoundingClientRect()`
 *   renders that much too high.
 *
 * `lv*` units measure the box; the `v*` pair in front of them is the fallback
 * for engines that discard the large-viewport units as invalid.
 */
function measureSnapshotBox() {
  const root = document.documentElement;
  const probe = document.createElement('div');
  probe.style.cssText =
    'position:fixed;top:0;left:0;margin:0;padding:0;border:0;' +
    'visibility:hidden;pointer-events:none;' +
    'width:100vw;height:100vh;width:100lvw;height:100lvh;';
  root.appendChild(probe);
  const probed = probe.getBoundingClientRect();
  probe.remove();

  const layoutWidth = root.clientWidth || window.innerWidth || probed.width;
  const layoutHeight = root.clientHeight || window.innerHeight || probed.height;
  const width = Math.max(probed.width, layoutWidth, window.innerWidth || 0);
  const height = Math.max(probed.height, layoutHeight, window.innerHeight || 0);
  // Compared against the layout viewport specifically, not the visual one:
  // Chrome and Safari keep the ICB at the large size and only shrink the visual
  // viewport, so for them this stays 0 and no correction is applied. It fires
  // only where the layout viewport really is the short one — the case where the
  // snapshot cannot line up with client coordinates.
  const topInset = Math.max(0, probed.height - layoutHeight);

  return { width, height, topInset };
}

/**
 * Circular reveal for theme changes, growing from `origin` (viewport
 * coordinates — pass the icon's centre) out to the farthest corner.
 *
 * View Transitions are assumed present — every current engine ships them — so
 * the only branch left is reduced motion, which is a stated preference rather
 * than a capability.
 */
export function circularReveal(applyChange: () => void, origin?: { x: number; y: number }) {
  /* A flight owns these pixels; the wipe would snapshot the flyer mid-air and
     then let it teleport. Apply the theme with no animation and stand down. */
  if (heroOwnsScreen()) {
    applyChange();
    return;
  }

  /* Settle anything else that is moving before the snapshot.
     `startViewTransition` freezes CSS *transitions* for its duration (see
     globals.css) but not GSAP tweens or CSS animations, so a tab cross-fade or
     a route clone caught mid-flight would be baked into the outgoing frame. */
  finishTabTransition();
  onThemeWipeStart?.();

  const doc = document as ViewTransitionDocument;
  const root = document.documentElement;

  if (prefersReducedMotion()) {
    applyChange();
    return;
  }

  const box = measureSnapshotBox();
  const x = origin?.x ?? box.width / 2;
  const y = (origin?.y ?? box.height / 2) + box.topInset;
  // Position as a fraction of the snapshot box, so the wipe starts on the icon
  // whatever units that box is measured in.
  const fx = box.width > 0 ? x / box.width : 0.5;
  const fy = box.height > 0 ? y / box.height : 0.5;
  // Reach of the farthest corner, not the full viewport diagonal: the diagonal
  // overshoots for any off-centre origin — a header icon needs about 90% of it —
  // so the sweep used to finish well before the animation did.
  const reachX = Math.max(fx, 1 - fx) * box.width;
  // Slack for the vertical correction above: if this engine turns out to anchor
  // the snapshot elsewhere, the circle still covers the corner it can't see.
  const reachY = Math.max(fy, 1 - fy) * box.height + box.topInset;
  // A percentage radius resolves against sqrt((w² + h²) / 2), so scale by √2
  // over the diagonal to turn a length back into that percentage.
  const radiusPercent =
    (Math.hypot(reachX, reachY) / Math.hypot(box.width, box.height)) * Math.SQRT2 * 100 + 1;
  const at = `at ${(fx * 100).toFixed(3)}% ${(fy * 100).toFixed(3)}%`;
  const id = String(++themeTransitionId);
  const animationName = `theme-circular-reveal-${id}`;
  const style = document.createElement('style');
  style.dataset.themeTransitionStyle = id;
  // `html:root[…]` outweighs the `html[data-theme-vt]` base rule in globals.css
  // regardless of which stylesheet the browser sees last — matching on
  // specificity alone left this animation one stylesheet re-injection away from
  // losing to `animation: none`.
  /* The one curve in the app that is deliberately not an M3 token, for the same
   * class of reason as `.m3-progress-arc` in globals.css.
   *
   * Every M3 easing is one-sided: they are shaped for a small element travelling
   * a fixed distance, so they spend most of their travel immediately and take a
   * long tail into rest. What is animated here is a *radius*, and what the eye
   * reads is the area it sweeps — which goes as its square. That squares the
   * front-loading. Measured as the fraction of the screen already flipped at
   * 150ms of 550: this curve 3%, `emphasized` 65%, `decelerate` 87%. The M3
   * curves do not read as a fast wipe, they read as no wipe at all.
   *
   * So the radius wants a curve that is slow at BOTH ends. That curve is a
   * token — `--ease-loop`, added for repeating motion, which is symmetric for
   * the same reason — and it is nonetheless spelled out here: the rule lands in
   * the view-transition pseudo tree, where a `var()` that failed to resolve
   * would silently fall back to `ease`. Same documented exception the hero's
   * REVEAL_EASING and the top loader make. The value IS `--ease-loop`'s; keep
   * the two in sync. */
  style.textContent = `
    @keyframes ${animationName} {
      from { clip-path: circle(0% ${at}); }
      to { clip-path: circle(${radiusPercent.toFixed(3)}% ${at}); }
    }
    html:root[data-theme-vt="${id}"]::view-transition-new(root) {
      animation: ${animationName} 550ms cubic-bezier(0.4, 0, 0.6, 1) both;
    }
  `;

  activeThemeTransition?.transition.skipTransition();
  activeThemeTransition?.style.remove();
  document.head.append(style);
  root.dataset.themeVt = id;

  const transition = doc.startViewTransition(applyChange);
  const active = { id, style, transition };
  activeThemeTransition = active;

  const cleanup = () => {
    if (activeThemeTransition !== active) return;
    activeThemeTransition = null;
    style.remove();
    if (root.dataset.themeVt === id) delete root.dataset.themeVt;
  };
  void transition.finished.then(cleanup, cleanup);
}

/**
 * Set by whatever owns a transient overlay that must not be captured by the
 * theme wipe. Kept as a setter rather than an import so `lib/routeCrossFade`
 * can depend on this module without a cycle.
 */
let onThemeWipeStart: (() => void) | null = null;
export function setThemeWipeGuard(fn: (() => void) | null) {
  onThemeWipeStart = fn;
}

/**
 * True while a shared-element image flight owns the screen.
 *
 * AGENTS.md: "The hero owns the same pixels. Every other transition stands down
 * while a flight is in progress." Two things in this module could still start on
 * top of one and had no way to know:
 *
 *   - the theme wipe, whose `startViewTransition` freezes rendering to capture
 *     the old frame — a static image of the flyer mid-air — while the flight's
 *     own WAAPI animations keep advancing underneath, so the flyer teleports on
 *     completion. It is reachable with no user input at all, from the
 *     system-scheme listener.
 *   - the tab shared axis, which sets `data-axis-running` and thereby
 *     `overflow-x: clip` on the very scroller that hosts the flight layer,
 *     clipping the flyer for the whole 500ms.
 *
 * A registered predicate rather than an import: `lib/hero` is a large module and
 * `lib/motion` is imported nearly everywhere, so importing it here would pull the
 * hero controller into every bundle that wanted a duration constant. Same
 * reasoning as `setThemeWipeGuard` above.
 */
let isHeroBusy: (() => boolean) | null = null;
export function setHeroBusyCheck(fn: (() => boolean) | null) {
  isHeroBusy = fn;
}
function heroOwnsScreen(): boolean {
  return isHeroBusy?.() ?? false;
}

interface DrawerSwipeOptions {
  /** The sliding panel. Assumed to sit at `translateX(-width)` when closed. */
  drawerRef: RefObject<HTMLElement | null>;
  /** The dimming layer behind it; its opacity tracks the drag. */
  scrimRef: RefObject<HTMLElement | null>;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Turn the whole gesture off — e.g. on desktop, where the drawer is docked. */
  enabled?: boolean;
}

/** Fraction of the drawer's width you must cross for a slow drag to commit. */
const DRAWER_COMMIT_RATIO = 0.4;
/** px/s past which a flick commits regardless of how far it travelled. */
const DRAWER_FLICK_VELOCITY = 450;

/**
 * Swipe an open navigation drawer closed.
 *
 * Opening by edge-swipe was removed. A left-edge gesture is claimed by the
 * browser's own back-navigation on both iOS and Android, and every screen here
 * that you might swipe on — the image detail, a zoomed photo, a horizontally
 * scrolled chip row — sits under that same edge, so the drawer kept peeking out
 * mid-gesture. The menu button is the way in; this is only the way out.
 *
 * The drawer tracks the finger for the whole gesture rather than waiting for a
 * flick to complete: a drawer that only responds on release gives you no way to
 * change your mind halfway. On release it commits past 40% of its width, or on
 * a fast flick at any distance.
 *
 * During a drag the panel and scrim are driven inline with their CSS
 * transitions suppressed — the shell styles them with `transition-all` and a
 * `-translate-x-full` class, and leaving that in place would put 300ms of lag
 * between the finger and the panel. Both are handed back to CSS once the settle
 * tween lands, at which point the inline and class positions agree, so the
 * handoff is invisible.
 */
export function useDrawerSwipe({
  drawerRef,
  scrimRef,
  open,
  onOpenChange,
  enabled = true,
}: DrawerSwipeOptions) {
  /* `open` and `onOpenChange` are read through refs rather than declared as
     dependencies.

     `useGSAP` only tears its context down on unmount unless `revertOnUpdate` is
     set (see @gsap/react: `deferCleanup = dependencies.length && !revertOnUpdate`,
     and the effect returns a cleanup only when that is false). So a dependency
     that flips on every drawer toggle added a *second* Observer to
     `document.body` while the first stayed alive — holding a captured
     `open === true` forever. Those survivors then read `pending = open && startX
     <= drawer().offsetWidth` as true for any horizontal drag beginning within
     288px of the left edge — three quarters of a phone screen — computed
     `startOffset = 0`, and dragged the *closed* drawer into view. That is the
     "sidebar randomly flies out" report; the gesture itself can only close.

     With refs the dependency list is just `enabled`, so exactly one Observer
     exists at a time, and `revertOnUpdate` disposes it when that flips. */
  const openRef = useRef(open);
  const onOpenChangeRef = useRef(onOpenChange);
  useEffect(() => {
    openRef.current = open;
    onOpenChangeRef.current = onOpenChange;
  });

  useGSAP(
    (_context, contextSafe) => {
      if (!enabled) return;

      // `width` is read per gesture: the panel is `w-72` open and auto-width
      // closed, and either can change with the viewport.
      let width = 0;
      let startOffset = 0;
      let active = false;
      // Set at press when the start point qualifies, cleared once the axis is
      // known: `onDragStart` fires before `lockAxis` has decided, so a vertical
      // scroll that happens to begin at the screen edge must be able to back out.
      let pending = false;

      const drawer = () => drawerRef.current;
      const scrim = () => scrimRef.current;

      /** Places the panel at `x` ∈ [-width, 0] and fades the scrim to match.
       *  `contextSafe` throughout this hook: every one of these writes happens
       *  from an Observer callback, i.e. after useGSAP's own callback returned,
       *  so without it the inline transforms are invisible to `revert()` and a
       *  drag interrupted by an unmount would strand the panel mid-slide. */
      const place = contextSafe!((x: number) => {
        const d = drawer();
        if (d) gsap.set(d, { x });
        const s = scrim();
        if (s) gsap.set(s, { opacity: width > 0 ? (x + width) / width : 0 });
      });

      const begin = () => {
        const d = drawer();
        if (!d) return false;
        width = d.offsetWidth;
        if (width <= 0) return false;
        startOffset = openRef.current ? 0 : -width;
        active = true;
        // Suppress the class-level transitions for the duration of the drag.
        d.style.transition = 'none';
        const s = scrim();
        if (s) {
          s.style.transition = 'none';
          // The scrim is `pointer-events-none` while closed; it must not start
          // swallowing taps just because it became visible mid-drag.
          s.style.pointerEvents = 'none';
        }
        place(startOffset);
        return true;
      };

      const settle = contextSafe!((toOpen: boolean) => {
        active = false;
        pending = false;
        const d = drawer();
        const s = scrim();

        const release = () => {
          onOpenChangeRef.current(toOpen);
          if (d) {
            gsap.set(d, { clearProps: 'transform' });
            d.style.transition = '';
          }
          if (s) {
            gsap.set(s, { clearProps: 'opacity' });
            s.style.transition = '';
            s.style.pointerEvents = '';
          }
        };

        if (!d || prefersReducedMotion()) {
          release();
          return;
        }

        const target = toOpen ? 0 : -width;
        const remaining = Math.abs(target - (gsap.getProperty(d, 'x') as number));
        const duration = gsap.utils.clamp(0.16, 0.34, remaining / 1200);

        if (s)
          gsap.to(s, { opacity: toOpen ? 1 : 0, duration, ease: 'decelerate', overwrite: true });
        gsap.to(d, {
          x: target,
          duration,
          ease: 'decelerate',
          overwrite: true,
          onComplete: release,
        });
      });

      const observer = Observer.create({
        target: document.body,
        // Touch only. Hijacking a left-drag from a desktop pointer would break
        // text selection near the window edge, and those users have the header
        // button anyway.
        type: 'touch',
        dragMinimum: 8,
        lockAxis: true,
        tolerance: 4,
        ignore: '[data-no-drawer-swipe]',
        onDragStart: (self) => {
          const startX = self.startX ?? 0;
          // Opening is anchored to the screen edge; closing can start anywhere on
          // the panel, which is the only thing under the finger while it is open.
          // Only a drag that starts on the open panel counts.
          pending = openRef.current && startX <= (drawer()?.offsetWidth ?? 0);
        },
        onDrag: (self) => {
          if (pending) {
            if (self.axis === 'y') {
              pending = false;
              return;
            }
            if (self.axis !== 'x' || !begin()) return;
            pending = false;
          }
          if (!active) return;
          place(gsap.utils.clamp(-width, 0, startOffset + (self.x ?? 0) - (self.startX ?? 0)));
        },
        onDragEnd: (self) => {
          pending = false;
          if (!active) return;
          const d = drawer();
          const x = d ? (gsap.getProperty(d, 'x') as number) : startOffset;
          const flick = Math.abs(self.velocityX) > DRAWER_FLICK_VELOCITY;
          settle(flick ? self.velocityX > 0 : (x + width) / width > DRAWER_COMMIT_RATIO);
        },
      });

      return () => observer.kill();
    },
    { dependencies: [enabled], revertOnUpdate: true },
  );
}

/* ---------------------------------------------------------------------------
 * Entrance / list motion
 *
 * These four cover every animation the app was missing, and all of them take
 * the app's own scroller (`getAppScroller()`) rather than the window — a
 * ScrollTrigger left on its default would never fire here, for the same reason
 * `window.scrollTo` never did.
 * ------------------------------------------------------------------------ */

/** Distance an entering element travels, px. Small on purpose: a long throw
 *  reads as decoration, a short one reads as the content settling. */
const REVEAL_SHIFT = 18;

interface ScrollRevealOptions {
  /** Children matching this selector animate individually; omit to reveal the container. */
  selector?: string;
  /** Seconds between successive children. */
  stagger?: number;
  /** Re-run when this changes (e.g. a page of results was replaced). */
  deps?: unknown[];
  enabled?: boolean;
}

/* No `refreshPriority`, deliberately.
 *
 * It exists to fix refresh *order* when one ScrollTrigger's recalculation moves
 * another's measurements — which in practice means pinning, since a pin inserts
 * a spacer and shifts everything below it. Nothing here pins: a reveal sets
 * `autoAlpha` and a transform, neither of which takes the element out of flow
 * or changes the height of anything. So the triggers are mutually independent
 * and any order gives the same answer.
 *
 * Worth stating rather than leaving out, because "several reveal roots on one
 * page, created in React's mount order" reads like exactly the case the option
 * was made for. It is not, and `ScrollTrigger.batch` has no way to pass it
 * anyway. */

/** How many elements may share one reveal batch.
 *
 * A function, not the constant this used to be: `batchMax` is re-evaluated on
 * every refresh, which is what it exists for. At a flat 12 a phone — where at
 * most three or four blocks are on screen at once — put everything visible into
 * a single batch and the stagger had nothing left to stagger, so the whole
 * screen arrived as one block. That is precisely the failure the cascade is
 * there to avoid, and it only showed on the viewport most people use. */
const revealBatchMax = () => (window.innerWidth < BREAKPOINTS.sm ? 4 : 12);

/** Debounce for the content-growth refresh below. Long enough that a run of
 *  images decoding in sequence costs one recalculation rather than twenty. */
const REVEAL_REFRESH_DEBOUNCE_MS = 150;

/**
 * Reveals elements as they enter the viewport, in batches.
 *
 * The below-the-fold counterpart to `<Reveal>`: that one plays on mount, which
 * is right for content the route commits with already on screen and wrong for a
 * long page, where everything would have "revealed" before you scrolled to it.
 *
 * **Currently unused, by decision.** An entrance cascade is for *picture*
 * content, where the wait is real and the reveal is the picture arriving. On
 * text — a settings form, a forum list, a team roster — it makes rows the user
 * came to read behave like an animation, and on the forum tab it landed on top
 * of the shared axis so the list arrived twice. The gallery has its own cascade
 * in `useStaggerGrid`, ordered by visual position rather than DOM order.
 *
 * Kept rather than deleted because the tool is right for the job it names, and
 * because the two constraints below are the expensive part to rediscover: never
 * above a gallery card, since it parks targets at a `y` offset and the hero
 * flight reads `getBoundingClientRect` on press; and never inside a tab pane
 * whose content swaps, since the pane transition already animates the same
 * nodes' `autoAlpha` and `y`.
 */
export function useScrollReveal<T extends HTMLElement = HTMLElement>({
  selector,
  stagger = 0.06,
  deps = [],
  enabled = true,
}: ScrollRevealOptions = {}): RefObject<T | null> {
  const ref = useRef<T>(null);
  /* The reactive read, not the one-shot.
     This hook keeps firing for the whole session — every block below the fold
     waits for a scroll that may be minutes away — so it is one of the two
     places where a preference changed mid-session genuinely has something left
     to affect. Subscribing means turning reduced motion ON tears the batch down
     (and `clearProps` restores anything still hidden), and turning it OFF
     builds one without waiting for an unrelated re-render. */
  const reduced = useReducedMotion();

  useGSAP(
    () => {
      const root = ref.current;
      if (!root || !enabled || reduced) return;

      const targets = selector
        ? gsap.utils.toArray<HTMLElement>(root.querySelectorAll(selector))
        : [root];
      if (targets.length === 0) return;

      gsap.set(targets, { autoAlpha: 0, y: REVEAL_SHIFT });

      const triggers = ScrollTrigger.batch(targets, {
        scroller: getAppScroller() ?? undefined,
        start: 'top 92%',
        once: true,
        batchMax: revealBatchMax,
        onEnter: (batch) =>
          gsap.to(batch, {
            autoAlpha: 1,
            y: 0,
            duration: DURATION.emphasized,
            ease: 'decelerate',
            stagger,
            overwrite: true,
          }),
      });

      /* Trigger positions are computed once, from the layout as it stands at
       * creation. Everything that arrives afterwards — an image decoding, a web
       * font swapping in, a lazy list appending — pushes the blocks below it
       * down, and the start lines stay where they were. The symptom is a block
       * that reveals while still well under the fold, or never reveals at all
       * because its line ended up above the current scroll position.
       *
       * ScrollTrigger auto-refreshes on resize and on `load`, and on nothing
       * else; dynamic content is explicitly not covered. A `ResizeObserver` on
       * the root is the general answer — it fires for images, fonts and content
       * alike — debounced, because a gallery of images decoding in sequence
       * would otherwise request one full recalculation per image. */
      let refreshTimer: ReturnType<typeof setTimeout> | undefined;
      const observer = new ResizeObserver(() => {
        clearTimeout(refreshTimer);
        refreshTimer = setTimeout(() => ScrollTrigger.refresh(), REVEAL_REFRESH_DEBOUNCE_MS);
      });
      observer.observe(root);

      return () => {
        clearTimeout(refreshTimer);
        observer.disconnect();
        triggers.forEach((t) => t.kill());
        // Anything still hidden when the effect tears down must be restored,
        // or a fast unmount/remount leaves permanently invisible content.
        gsap.set(targets, { clearProps: 'opacity,visibility,transform' });
      };
    },
    // `revertOnUpdate`: without it the cleanup above never runs on a dependency
    // change (only on unmount), so every change stacked another batch of
    // ScrollTriggers on the same targets.
    {
      scope: ref,
      dependencies: [selector, stagger, enabled, reduced, ...deps],
      revertOnUpdate: true,
    },
  );

  return ref;
}

/**
 * Cascade for grid/masonry children, played on mount rather than on scroll.
 *
 * The masonry grid faded in as one block, so 40 cards arrived as a single
 * rectangle. Staggering reads as the grid filling in instead.
 *
 * Order is by *visual* position, not DOM order. A masonry layout is built
 * column by column — each card goes to whichever column is shortest — so the
 * DOM sequence is "all of column 1, then all of column 2". Staggering over that
 * sweeps the grid one column at a time, which is not how anyone reads it.
 * Sorting by row band and then by x makes the cards arrive one after another
 * left to right, top to bottom.
 */
/** Rows are banded before sorting: masonry cards on the same visual row rarely
 *  share an exact `top`, and comparing raw values would zig-zag between them. */
const ROW_BAND_PX = 48;

export function useStaggerGrid<T extends HTMLElement = HTMLElement>(
  selector: string,
  deps: unknown[] = [],
): RefObject<T | null> {
  const ref = useRef<T>(null);
  // Reactive for the same reason as `useScrollReveal`: this re-runs on every
  // page of results, so a preference changed mid-session still has work to skip.
  const reduced = useReducedMotion();

  useGSAP(
    () => {
      const root = ref.current;
      if (!root || reduced) return;
      const items = gsap.utils.toArray<HTMLElement>(root.querySelectorAll(selector));
      if (items.length === 0) return;

      const rootTop = root.getBoundingClientRect().top;
      const ordered = items
        .map((el) => {
          const r = el.getBoundingClientRect();
          return { el, band: Math.round((r.top - rootTop) / ROW_BAND_PX), x: r.left };
        })
        .sort((a, b) => a.band - b.band || a.x - b.x)
        .map((m) => m.el);

      const tween = gsap.fromTo(
        ordered,
        { autoAlpha: 0, y: 14, scale: 0.985 },
        {
          autoAlpha: 1,
          y: 0,
          scale: 1,
          duration: DURATION.long,
          ease: 'decelerate',
          // Capped: with 100 cards a linear stagger would still be arriving
          // several seconds after the images finished decoding.
          stagger: { each: 0.035, from: 'start', amount: Math.min(items.length * 0.035, 0.9) },
          clearProps: 'opacity,visibility,transform',
        },
      );

      // A transform on an ancestor shifts `getBoundingClientRect` for
      // everything under it, and the hero flight reads exactly that off a card
      // the moment you press it. Snapping to the end state on pointerdown means
      // a card can never be measured mid-cascade — and a press during the
      // cascade feels answered rather than ignored.
      const settle = () => tween.progress(1);
      root.addEventListener('pointerdown', settle, { capture: true });
      return () => root.removeEventListener('pointerdown', settle, { capture: true });
    },
    // `revertOnUpdate`: the `pointerdown` listener below is removed by the
    // returned cleanup, which useGSAP otherwise defers to unmount. Every page
    // turn was therefore leaving another capture-phase listener on the grid,
    // each one calling `progress(1)` on a long-dead tween on every card press.
    { scope: ref, dependencies: [selector, reduced, ...deps], revertOnUpdate: true },
  );

  return ref;
}

/* ---------------------------------------------------------------------------
 * Shared axis — Material 3, and one plane rather than two layers
 *
 * The old model was sequential and therefore had a hole in it: the tab bar
 * played a 200ms exit, waited for it, *then* pushed the route, and only once
 * that committed did the incoming panel start its own 500ms enter from
 * `autoAlpha: 0`. Between the two the outgoing panel was already transparent
 * and the incoming one had not begun — at least 200ms of empty page, plus
 * whatever the commit cost. That gap is the "blank flash when switching between
 * the gallery and the forum".
 *
 * **The two sides are laid end to end and the strip is what moves.** The
 * incoming side starts a whole window-width away — not the spec's 30dp — so at
 * every instant the two are exactly adjacent: outgoing at `-d·p`, incoming at
 * `d·(1-p)`, always `d` apart, which is the width of the window they are
 * sliding past. Neither is ever painted over the other, because there is
 * nowhere for them to be painted over each other; the window clips whatever is
 * outside it. When half the outgoing card has left, exactly half the incoming
 * card has arrived.
 *
 * That is why there is no cross-fade here any more. M3's shared axis pairs a
 * 30dp nudge with an opacity handoff, and an opacity handoff *is* two layers
 * stacked — for the length of the fade both sides occupy the same pixels, which
 * is precisely what read as "a layer sliding up from the right". A 30dp nudge
 * cannot carry the movement on its own, so the two go together: full travel,
 * no fade. This is a deliberate divergence from the spec's numbers in service
 * of the thing the spec is describing.
 *
 * **The cascade is a lean, not a queue.** A block's delay is a continuous
 * function of its height on screen, identical on both sides, so at any given
 * height the block leaving and the block arriving are on the same beat and the
 * pair is exactly one window apart there. What the eye reads is the seam
 * between the two pages leaning over, top leading, and sweeping across.
 *
 * The delay has to be small, and it has to be continuous. Small, because at a
 * full window of travel peak velocity is an order of magnitude higher than at
 * the spec's 30dp, so ten milliseconds of lag is already a hundred pixels of
 * shear — the same 50ms-per-band that read as a gentle ripple under a nudge
 * tears the page into strips under a slide. Continuous, because a stepped
 * delay puts two cards two pixels apart vertically a whole step out of phase,
 * which is a visible rip through content that belongs together; with a
 * continuous one, anything close enough to overlap is close enough to be in
 * phase, and anything far enough out of phase is too far apart to overlap.
 *
 * The stagger axis must stay *perpendicular* to the motion axis, though. Blocks
 * translating sideways may be delayed by height, because a horizontal band is
 * rigid whatever its neighbours do. Blocks translating vertically may not: that
 * stretches the column instead of shearing it. `axis: 'y'` therefore moves as
 * one block.
 *
 * And nothing waits for the router: both panes are already mounted, so the
 * transition only needs the *attribute* that gives the incoming one a box —
 * which this owns. The route commit that follows is a visual no-op.
 * ------------------------------------------------------------------------ */

/**
 * How far the bottom of the window lags the top, as a fraction of the span.
 *
 * Read it as a shear, not as a wait: the lean the eye sees is the lag times the
 * curve's peak slope, so this number only means something paired with a curve.
 * `emphasized` peaks at 10.06 against `standard`'s 4.05 — 2.49x — so carrying
 * the old 0.07 across to it would have leaned the seam by 0.7 of a whole window
 * and torn the page in half. 0.032 lands the peak lean at about 0.32 of a
 * window, a touch more than the 0.283 the previous pairing gave: measurably
 * more wave, from a curve that is also faster through the middle.
 *
 * That is the whole budget. Doubling it does not double the sense of a wave; it
 * starts to look like two pages moving independently, and by the time the lean
 * approaches a full window the top of the page has finished before the bottom
 * has started, which is a shredded page rather than a dragged one.
 */
const AXIS_LAG = 0.032;
/**
 * Extra plate between the two pages, px, on top of whatever the layout gives.
 *
 * The window the pages slide past is the scroller — sidebar edge to screen
 * edge — and the content column is centred inside it, so the two side margins
 * are already empty space between the outgoing page and the incoming one. That
 * is most of the answer, and it is the right answer: the pages sit one window
 * apart on the strip and their content is centred in its own window, exactly as
 * a paged carousel does it. This is the floor under it, for the phone layout
 * where the column fills the window and those margins are nearly nothing.
 *
 * Setting it to 0 makes the two pages touch, which is what the first version
 * did by using the *column's* width as the travel. Edge to edge with no plate
 * between them reads as one page shoving the other rather than as two pages on
 * a strip.
 *
 * 24 was the floor and read as crowded: at 1280px the visible plate was 136px,
 * about a tenth of the window, so the two pages still passed each other close
 * enough to feel like one shoving the other. 96 puts it at roughly 208px — a
 * plate you can see rather than a seam — and costs 7% more travel, which is
 * inside the noise of a 400ms move.
 *
 * A delay on the incoming side would also open a gap, and was considered. It is
 * the wrong mechanism: the plate would then stretch and close over the run, so
 * the strip reads as elastic instead of rigid. A paged carousel's pages are a
 * fixed distance apart, and that fixity is what sells them as one surface.
 */
const AXIS_GAP = 96;
/** Heights within this of each other share a beat. See `planWave`. */
const AXIS_ROW_BAND = 64;
/** How far outside the viewport still counts as worth a compositor layer. */
const AXIS_NEAR_MARGIN = 240;
/** Runaway guard on the descent; nothing legitimate nests a row this deep. */
const PANE_DESCEND_LIMIT = 6;

export interface SharedAxisHandle {
  /** Jump to the end state and run the settle callback. Idempotent. */
  finish(): void;
}

/**
 * A complete partition of the pane into blocks that will be moved.
 *
 * "Complete" is the load-bearing word. This used to be
 * `querySelectorAll('[data-tab-row]')`, which moves the featured banner, the
 * cards and the forum posts and leaves *everything else* — the masonry
 * container, the pagination anchor, the loading skeletons, an error block, the
 * forum list's "暂无帖子" — sitting at rest for the whole slide, only to be
 * hidden when the pane is finally taken out of layout. That is the sliver of
 * the old page you could see hanging around after a switch. Under a 30dp nudge
 * an unmoved element is indistinguishable from a moved one; under a
 * window-width slide it is the only thing still on screen.
 *
 * So: descend only through elements that *contain* a marked row, and take
 * everything else whole. Every element in the pane then ends up inside exactly
 * one block, marked or not, and the markers only decide how finely the wave is
 * sampled — they can never decide whether something moves at all.
 */
function paneBlocks(pane: HTMLElement): HTMLElement[] {
  const blocks: HTMLElement[] = [];
  const walk = (node: Element, depth: number) => {
    for (const child of node.children) {
      if (!(child instanceof HTMLElement)) continue;
      if (!child.hasAttribute('data-tab-row') && depth < PANE_DESCEND_LIMIT) {
        if (child.querySelector('[data-tab-row]')) {
          walk(child, depth + 1);
          continue;
        }
      }
      blocks.push(child);
    }
  };
  walk(pane, 0);
  return blocks.length > 0 ? blocks : [pane];
}

/**
 * Delay per block, as a continuous function of its height on screen.
 *
 * One map for both panes — that is the whole mechanism. Because the delay
 * depends only on `top`, a block leaving at y=400 and a block arriving at y=400
 * are on the same beat; give them the same curve and the same distance and the
 * pair sits exactly one window apart for the whole run. Any input other than
 * height decouples them and the switch stops being one surface.
 *
 * Two earlier versions got this wrong in opposite directions. The first
 * measured each pane separately and then *ranked* the bands that pane happened
 * to occupy, so a 350px gallery card and a 112px forum row at the same height
 * were ranked 1 and 3 and set off 100ms apart — a layer sliding up from the
 * right, not a plane. The second shared the map but kept the banding, so
 * neighbours either side of a 140px boundary tore apart by a whole step.
 * Height, continuously, is the only input that has neither failure.
 *
 * Measured against the viewport rather than the pane: a pane scrolled to its
 * middle would otherwise have every visible block deep in the count and already
 * capped, flattening the wave to nothing exactly when there is most to show.
 * Capped at one viewport for the same reason in the other direction — below the
 * fold the lag is invisible and would only stretch the timeline. Measured once,
 * up front, so every tween agrees and nothing depends on when GSAP happens to
 * evaluate the stagger.
 *
 * The height is quantised to `AXIS_ROW_BAND` first, which is not a return to
 * banding — the quantum is on the *input* and it is small. A masonry column
 * places each card under the shortest neighbour, so cards that read as one row
 * have tops tens of pixels apart and, under a purely continuous delay, set off
 * at visibly different moments; the row stops looking like a row. Rounding to
 * 64px puts them on one beat, and the worst case at a boundary is 64/viewport
 * of the lag — about 17px of shear where the old 140px steps were worth 50ms.
 *
 * Returns the near-viewport subset alongside, because that is the only place
 * worth spending a compositor layer: promoting all seventy blocks of a gallery
 * cost more in setup than the wave is worth, and the fifty-odd below the fold
 * are never seen moving.
 */
function planWave(
  /** One entry per pane. `shiftY` is where that pane is about to be moved to
   *  vertically, applied arithmetically so nothing has to be written to the DOM
   *  before these reads — see the note at the call site. */
  groups: { blocks: HTMLElement[]; shiftY: number }[],
  span: number,
  lean: boolean,
) {
  const scroller = getAppScroller();
  const view = scroller?.getBoundingClientRect();
  const origin = view?.top ?? 0;
  const height = view?.height || window.innerHeight || 1;
  const delayOf = new Map<Element, number>();
  const near: HTMLElement[] = [];
  for (const { blocks, shiftY } of groups) {
    for (const block of blocks) {
      const rect = block.getBoundingClientRect();
      const top = rect.top + shiftY;
      const offset = top - origin;
      const row = Math.round(offset / AXIS_ROW_BAND) * AXIS_ROW_BAND;
      delayOf.set(block, lean ? gsap.utils.clamp(0, 1, row / height) * span * AXIS_LAG : 0);
      if (
        rect.bottom + shiftY > origin - AXIS_NEAR_MARGIN &&
        top < origin + height + AXIS_NEAR_MARGIN
      ) {
        near.push(block);
      }
    }
  }
  const delay: (index: number, target: Element) => number = (_index, target) =>
    delayOf.get(target) ?? 0;
  return { delay, near };
}

/**
 * Slides `leaving` out and `entering` in along one axis as a single plane, band
 * by band.
 *
 * Both elements must already have a box — see the grid rules for
 * `[data-tab-panel]` in globals.css, which stack the panes in one cell so the
 * row height is `max(outgoing, incoming)` and the scroller's height can only
 * grow while the transition runs.
 */
export function playSharedAxis(opts: {
  leaving: HTMLElement;
  entering: HTMLElement;
  /** Which way the strip travels. `y` moves as one block; see the note above. */
  axis?: 'x' | 'y';
  /** +1 = moving forward; the outgoing side exits towards the negative end. */
  direction: 1 | -1;
  /** Width (or height) of the window the strip slides past. Defaults to the
   *  incoming side's own box, which is what the tab panes want. */
  distance?: number;
  /** Vertical compensation for a scroll restore, applied to the whole pane. */
  leavingOffsetY?: number;
  /**
   * Sample the wave over the pane's own blocks. Requires that those blocks
   * survive the run — true of the tab panes, which are mounted once and only
   * marked, and false of a route change, where React is replacing the whole
   * subtree behind us.
   */
  lean?: boolean;
  onSettle?: () => void;
}): SharedAxisHandle {
  const { leaving, entering, axis = 'x', direction, leavingOffsetY = 0, onSettle } = opts;

  /* No lean on the vertical axis (it would stretch the column rather than shear
     it), and no lean where the blocks are not stable — a route's incoming page
     re-renders as soon as its data lands, which detaches every block GSAP is
     holding and leaves the new ones sitting at rest. Measured: the outgoing
     clone slid the whole way while the incoming page simply appeared. Without a
     lean there is nothing to sample, so the whole side moves as one element,
     which is also the only node a re-render is guaranteed not to replace. */
  const lean = (opts.lean ?? true) && axis === 'x';
  const outAll = lean ? paneBlocks(leaving) : [leaving];
  const inAll = lean ? paneBlocks(entering) : [entering];
  /** The travel, as a vars object on whichever axis this run is using. */
  const travel = (value: number) => (axis === 'x' ? { x: value } : { y: value });

  /* The window the strip slides past is the *scroller*, not the pane.
   *
   * That distinction is the whole of how this reads. The pane is the centred
   * `max-w-7xl` column; the scroller runs from the sidebar's edge to the screen's.
   * Travelling one column width put the incoming page's leading edge at the
   * column's own boundary, so it appeared out of the middle of the page rather
   * than in from the side — and made the travel exactly equal to the column's
   * width, which laid the two pages edge to edge with no plate between them.
   * Travelling one *window* width fixes both at once: the pages enter and leave
   * at the edges of the content area, and because each one is centred in its own
   * window, the side margins become the gap. */
  const view = getAppScroller();
  const box = entering.getBoundingClientRect();
  const window_ = axis === 'x' ? view?.clientWidth || box.width : view?.clientHeight || box.height;
  const distance = opts.distance ?? window_ + AXIS_GAP;

  /* Only what can be seen actually moves.
   *
   * A gallery pane is 3300px of masonry and the window shows 900 of it, so of
   * the seventy blocks a complete partition produces, some fifty-five are below
   * the fold for the whole run. Animating them bought nothing and cost a great
   * deal: seventy compositor layers and seventy inline transforms rewritten
   * every frame, all of it inside the tap handler — measured as a 62ms long
   * task before the first frame could paint.
   *
   * Leaving them at rest is not a residue, which is the trap the other
   * direction of this fell into. A residue is something *visible* that fails to
   * move; a block a thousand pixels below the viewport is neither seen at rest
   * nor seen moving, and it ends where it began, which is exactly where the
   * settle would have put it. The margin covers a scroll landing slightly
   * differently than measured.
   *
   * The partition still has to be complete, though — `near` is filtered out of
   * it rather than gathered independently, so anything on screen is in it by
   * construction rather than by having been marked. */
  /* `emphasized` wants room for its tail — it spends the last two thirds of the
     clock covering the last few per cent of the distance, and squeezed into the
     400ms `long` that read as an abrupt stop rather than a settle. 500ms is
     also what the spec gives a large container transform. */
  const span = DURATION.emphasized;

  let settled = false;
  /* Declared before `finish` closes over it: the reduced-motion path returns
     before a timeline is ever built, so a `const` declared afterwards would be
     in the temporal dead zone when the queued microtask fired. */
  let timeline: gsap.core.Timeline | null = null;

  const finish = () => {
    if (settled) return;
    settled = true;
    timeline?.kill();
    view?.removeAttribute('data-axis-running');
    /* Nothing may keep a transform. `lib/hero/dom.ts` only compensates for a
       transform on `[data-image-detail-background-visual]`, so a residual one
       on a row — an ancestor of every gallery card — would silently corrupt the
       rect the hero flight reads on press. `clearProps`, never
       `translate3d(0,0,0)`: the latter still leaves `transform !== 'none'`.
       Over every block, not just the animated ones: a run interrupted by
       another may have left an offset on a block this run decided to skip. */
    gsap.set([leaving, entering, ...outAll, ...inAll], {
      clearProps: 'transform,opacity,visibility,willChange',
    });
    onSettle?.();
  };

  if (prefersReducedMotion() || distance <= 0) {
    queueMicrotask(finish);
    return { finish };
  }

  /* Turn the scroller into that window for the length of the run. Set before
     anything is offset, so no frame can paint a page hanging outside it or, on
     the horizontal axis, hand the scroller something to scroll sideways.
     Callers always settle the previous run before starting the next, so the
     attribute cannot be cleared out from under a live one. */
  view?.setAttribute('data-axis-running', axis);

  /* The outgoing pane's compensating offset is accounted for BEFORE anything is
     measured — arithmetically, not by writing it first.
     `runTabTransition` restores the destination tab's own scroll position while
     both panes are still in place, then hands us `leavingOffsetY` to hold the
     outgoing pane over the pixels the user was actually looking at. Measure
     without it and every rect on that side is wrong by the whole jump: leave a
     gallery scrolled to 1200 for a forum remembered at 0 and the scroller is
     already back at the top, so the wave sees the gallery's first screen as the
     visible one and the cards actually under the user's eyes as 1200px below the
     fold — outside `near`, and therefore left at rest for the entire slide. That
     was the "scroll down, switch, and the pictures don't move" report; it did
     not show on the way back because the pane returning to a remembered offset
     is the one being measured correctly.
     Passing the shift to `planWave` rather than writing the transform and
     re-reading keeps this to a single forced layout: every read below happens
     before the first write. */
  const { delay, near } = planWave(
    [
      { blocks: outAll, shiftY: leavingOffsetY },
      { blocks: inAll, shiftY: 0 },
    ],
    span,
    lean,
  );
  const onScreen = new Set(near);
  const pick = (all: HTMLElement[], pane: HTMLElement) => {
    if (!lean) return all;
    const visible = all.filter((block) => onScreen.has(block));
    return visible.length > 0 ? visible : [pane];
  };
  const outRows = pick(outAll, leaving);
  const inRows = pick(inAll, entering);

  /* The start state is written SYNCHRONOUSLY, before the timeline exists.
     A `.set()` inside a timeline is rendered on GSAP's next rAF tick, but the
     caller has just flipped `data-tab-pane-entering`, which gives the incoming
     pane a box immediately — so there was a window of one frame in which it
     painted on top of the outgoing one. That is the flash. Nothing needs an
     opacity guard: at `direction * distance` the incoming rows are a whole
     window away and the clip has already hidden them. */
  gsap.set(leaving, { y: leavingOffsetY });
  gsap.set([...outRows, ...inRows], { willChange: 'transform' });
  gsap.set(inRows, { ...travel(direction * distance), force3D: true });

  /* `overwrite: false` — the default is `'auto'`, which makes tweens that share
     a target and a property kill each other. Every tween below is deliberate
     and non-conflicting, and an earlier version of this that relied on a
     `fromTo` for the incoming pane's start offset had that offset silently
     killed by the `to` beside it, so the incoming rows never moved at all.

     `paused` — see the `play()` below. */
  timeline = gsap.timeline({ paused: true, defaults: { overwrite: false, force3D: true } });

  /* One clock, one curve, one delay function, two tweens.
   *
   * `delay` is measured across BOTH sides' blocks at once, so a block leaving
   * and a block arriving at the same height are on the same beat. Everything
   * else is already symmetric — same duration, same curve, equal and opposite
   * offsets — so at every height the pair stays exactly one window apart. Give
   * the two sides separate delay functions and it degenerates into a layer
   * arriving on top of another layer, which is what it used to do.
   *
   * `emphasized`, not `spring`. A back-eased overshoot would carry the incoming
   * side past its resting place, and since the two are adjacent rather than
   * stacked, "past" means a strip of bare panel appearing at the trailing edge.
   * Overshoot is only free when something else is underneath — emphasized gets
   * the same sense of thrown weight from its front loading instead, and never
   * leaves the plate. It replaced `standard`, whose near-constant middle was
   * what made the switch read as a rigid plate being pushed rather than
   * released. */
  timeline
    .to(
      outRows,
      { ...travel(-direction * distance), duration: span, ease: 'emphasized', stagger: delay },
      0,
    )
    .to(inRows, { ...travel(0), duration: span, ease: 'emphasized', stagger: delay }, 0);

  timeline.eventCallback('onComplete', finish);

  /* Started here, in the tap handler, not on the next animation frame.
   *
   * The rAF deferral this replaces was there because `router.push` used to run
   * on the very next line, and its commit blocked the main thread for ~80ms —
   * a timeline already running is charged for that, so the first frame the user
   * saw was a quarter of the way in. The push is now held back past the end of
   * the slide (`TAB_PUSH_COALESCE_MS`), so there is no stall left to defer past,
   * and `lagSmoothing` above still covers anything unexpected.
   *
   * What the deferral cost, meanwhile, was a whole frame every time. GSAP's own
   * ticker rAF is registered long before ours, so it runs first: `play()` landed
   * after the tick for the current frame and the first rendered progress was the
   * frame after that. Playing synchronously dates the timeline from the previous
   * tick instead, so the very next frame already carries a few percent of the
   * travel. Measured tap-to-first-visible-movement over 20 switches: median
   * 40ms before, 28ms after.
   */
  if (!settled) timeline.play();

  return { finish };
}

/* --- tab wiring ---------------------------------------------------------- */

type TabRun = { panel: HTMLElement; to: string; finish(): void };
let activeTabRun: TabRun | null = null;

/** Per-tab scroll offset, so switching back lands where you left that tab. */
const tabScrollMemory = new Map<string, number>();

/* The tab a panel has already been animated to.
 *
 * The switch is optimistic: it plays on the tap, well before `router.push`
 * resolves. If the destination's data is slow the commit can land *after* the
 * run has settled, and at that point `activeTabRun` is null — so the effect
 * below saw a plain `from -> active` change and played the whole thing a second
 * time. That is the "it animates again once loading finishes" replay. */
const lastTabTarget = new WeakMap<HTMLElement, string>();

/* The tab the tab bar is optimistically showing, for as long as the URL has not
 * caught up with it — see `setTabIntent`. */
let pendingTabIntent: string | null = null;

/**
 * Tells the panes which tab the user is actually on while the URL catches up.
 *
 * The tab bar and the panes are in different components and share nothing but
 * the URL, and the URL is the one thing that lags: the switch plays on the tap,
 * the push is coalesced behind it, and a burst of taps therefore drags the
 * address bar through tabs the user has already left. `useTabPanes` cannot tell
 * one of those from a real destination — a sidebar link or the back button
 * arrive looking exactly the same — so it chased them, and each one restarted
 * the transition in the opposite direction.
 *
 * Measured on two taps 520ms apart, 图库 -> 论坛 -> 图库: the panes ran three
 * animations, the middle one backwards, and the switch visibly sprang back to
 * 论坛 before completing. This is that "还是有概率会回弹".
 *
 * Pass the optimistic tab while one is outstanding and `null` once the URL
 * agrees. The tab bar unmounts when the route leaves home, so its cleanup is
 * also what guarantees a stale intent cannot outlive the page it belongs to.
 */
export function setTabIntent(to: string | null): void {
  pendingTabIntent = to;
}

const paneOf = (panel: HTMLElement, name: string) =>
  panel.querySelector<HTMLElement>(`[data-tab-pane="${CSS.escape(name)}"]`);

const MOTION_FLAGS = [
  'data-tab-pane-leaving',
  'data-tab-pane-entering',
  'data-tab-pane-done',
  'data-tab-pane-animating',
];

function clearPaneFlags(panel: HTMLElement) {
  panel.querySelectorAll<HTMLElement>('[data-tab-pane]').forEach((pane) => {
    for (const flag of MOTION_FLAGS) pane.removeAttribute(flag);
  });
}

function runTabTransition(
  panel: HTMLElement,
  from: string,
  to: string,
  direction: 1 | -1,
  lean = true,
) {
  const leaving = paneOf(panel, from);
  const entering = paneOf(panel, to);
  if (!leaving || !entering || leaving === entering) return false;

  /* A flight is mid-air: the axis run would set `data-axis-running` on the
     gallery scroller, which globals.css turns into `overflow-x: clip` — and a
     clip is a clip context for the absolutely-positioned flight layer inside it,
     so the flyer would be cut off for the whole run. Reachable from a history
     restore or a deep link committing during a slide; the tab pill's `inert` only
     covers the tap path. */
  if (heroOwnsScreen()) return false;

  activeTabRun?.finish();
  clearPaneFlags(panel);

  /* 1. Give both panes a box. They share one grid cell, so the row is now as
        tall as the taller of the two and can only shrink again at settle.
        `-animating` is separate from those two on purpose: it is the flag that
        freezes CSS transitions inside a pane, and it is cleared at settle,
        where `-entering` has to survive until the route commit lands. Fused
        into one flag, an incoming pane whose data was slow kept the freeze for
        as long as it took to load, so every hover inside it changed colour and
        elevation with no transition at all — the "hover effect but no hover
        animation" on a forum list that had not finished loading. */
  leaving.setAttribute('data-tab-pane-leaving', '');
  entering.setAttribute('data-tab-pane-entering', '');
  leaving.setAttribute('data-tab-pane-animating', '');
  entering.setAttribute('data-tab-pane-animating', '');

  /* 2. Restore the destination tab's own offset while the incoming pane is
        still invisible, and 3. pin the outgoing pane to the pixels the user was
        actually looking at, so step 2 is invisible on that side. */
  const scroller = getAppScroller();
  let offsetY = 0;
  if (scroller) {
    const before = scroller.scrollTop;
    /* Saved here rather than only in `startTabTransition`, so that the memory is
       kept by *every* way of changing tab. The tab bar saved it; a sidebar
       `<Link href="/?tab=forum">`, the back button and the `/forum` redirect all
       arrive through `useTabPanes` instead and used to restore the destination's
       offset without ever recording the one they were leaving. Switching with
       the tab bar therefore came back to where you were and switching with the
       sidebar came back to the top — the same control, two behaviours. */
    tabScrollMemory.set(from, before);
    // Reading scrollHeight here forces the reflow step 1 needs.
    const max = Math.max(0, scroller.scrollHeight - scroller.clientHeight);
    /* …but `max` is the height with BOTH panes mounted, and the row is a grid
       cell as tall as the taller of the two. At settle the leaving pane is
       taken out of layout, the page shrinks to the entering pane's height, and
       the browser clamps `scrollTop` to whatever is left — with no animation,
       in one frame, right at the end of the switch. Leave a tall gallery for a
       forum that is still loading and it clamped 44 to 0: the page visibly
       snapped backwards just as the slide finished. That is the "switching
       between gallery and forum still jumps back".
       So the target is clamped against the *shortest* height the page will have
       at any point in the run. Both panes share one cell, so that is today's
       height less the difference between them — in either direction, because
       the box below morphs from one height to the other and therefore passes
       through the smaller of the two whichever way it is going. */
    const settledMax = Math.max(0, max - Math.abs(leaving.offsetHeight - entering.offsetHeight));
    /* No memory for the destination means stay exactly where you are. This used
       to scroll to put the tab bar at the top of the scrollport, which is fine
       on the home page — the bar is near the top of the document — and wrong on
       a profile, where it sits below a tall header card, so a first visit to a
       tab jumped *down* to find it. Worse, a short destination pane makes
       `settledMax` small, so that downward target clamped straight to the
       bottom of the page: switching to 上传记录 or 收藏夹 landed at the end of
       the list. Holding the offset is also simply the least surprising rule —
       the panes share a tab bar, so the page under them has not changed. */
    const remembered = tabScrollMemory.get(to);
    const next = Math.min(remembered ?? before, settledMax);
    // Scroll anchoring would "correct" a deliberate jump; same guard as runScroll.
    scroller.style.overflowAnchor = 'none';
    scroller.scrollTop = next;
    offsetY = next - before;
  }

  const settle = () => activeTabRun?.finish();

  /* 4. Morph the pane box itself, so the page's height changes over the same
        500ms as the slide instead of in one frame at the end of it.
     Both panes share a grid cell, so the row is the taller of the two for the
     whole run and then becomes the entering pane's height the instant the
     leaving one drops out of layout. Every profile tab has a different amount
     in it — eight uploaded pictures against two forum posts — so that last
     frame moved everything below the panes, footer included, by hundreds of
     pixels, and did it *after* the motion had visibly finished. The switch
     read as a slide followed by an unrelated jolt.
     Driving `height` (not `min-height`) because the row's own height is the
     max of the two panes and a floor under that has nothing to do. `overflow`
     comes with it: whichever pane is taller than the current box has to be
     clipped, which is what a container transform looks like anyway. Both are
     cleared by `releaseBox`, on the settle path *and* on the interrupt path —
     a residual inline height on an ancestor of a gallery card would freeze the
     page at whatever it happened to be mid-run. */
  const fromHeight = leaving.offsetHeight;
  const toHeight = entering.offsetHeight;
  let boxTween: gsap.core.Tween | null = null;
  const releaseBox = () => {
    boxTween?.kill();
    boxTween = null;
    panel.style.height = '';
    panel.style.overflow = '';
  };
  if (fromHeight > 0 && toHeight > 0 && Math.abs(fromHeight - toHeight) > 1) {
    panel.style.height = `${fromHeight}px`;
    panel.style.overflow = 'hidden';
    boxTween = gsap.to(panel, {
      height: toHeight,
      duration: DURATION.emphasized,
      ease: 'emphasized',
    });
  }

  /* The footer rides inside `[data-page-content]` and so travels with every
     route change on its own. A tab switch is the exception — the panes that
     slide are *inside* the page, above it — so this is the one caller that
     still has to ask it to step aside. */
  const endTransit = beginPageTransit();

  /* Belt and braces on the scroll-anchoring guard: `onSettle` restores it, but
     a run whose panes are unmounted mid-flight would never reach that, and
     leaving `overflow-anchor: none` on the app scroller silently disables
     anchoring for the rest of the session. */
  const restoreAnchor = () => {
    releaseBox();
    if (scroller) scroller.style.overflowAnchor = '';
    endTransit();
  };

  const handle = playSharedAxis({
    leaving,
    entering,
    direction,
    lean,
    leavingOffsetY: offsetY,
    onSettle: () => {
      /* The route may still not have committed, in which case React is *also*
         still marking the outgoing pane active — and `clearProps` has just
         restored it to full opacity. `-done` holds it out of layout until the
         commit lands and `useTabPanes` clears every flag. Without this the old
         page reappears on top of the new one at the end of the transition. */
      leaving.setAttribute('data-tab-pane-done', '');
      leaving.removeAttribute('data-tab-pane-leaving');
      /* GSAP is no longer driving either pane, so the transition freeze comes
         off now — not at the next React commit, which may be a whole data fetch
         away. */
      leaving.removeAttribute('data-tab-pane-animating');
      entering.removeAttribute('data-tab-pane-animating');
      restoreAnchor();
      panel.removeEventListener('pointerdown', settle, { capture: true });
      if (activeTabRun?.panel === panel) activeTabRun = null;
    },
  });

  /* Same reason as the masonry cascade: these rows are ancestors of every
     gallery card, and `useHeroLink` measures a card during the click that
     follows this press. Snap to rest rather than be measured mid-slide. */
  panel.addEventListener('pointerdown', settle, { capture: true });
  lastTabTarget.set(panel, to);
  activeTabRun = {
    panel,
    to,
    finish: () => {
      handle.finish();
      restoreAnchor();
    },
  };
  return true;
}

/**
 * Starts the switch on the tap, before the route.
 *
 * Call `router.push` on the very next line — there is nothing to wait for. Both
 * panes are mounted, so this hands the incoming one a box directly and the
 * commit that follows only has to agree with what is already on screen.
 */
export function startTabTransition(from: string, to: string, direction: 1 | -1): void {
  if (from === to) return;
  const scroller = getAppScroller();
  if (scroller) tabScrollMemory.set(from, scroller.scrollTop);
  if (prefersReducedMotion()) return;
  const panel = document.querySelector<HTMLElement>('[data-tab-panel]');
  if (panel) runTabTransition(panel, from, to, direction);
}

/**
 * Reactive fallback, and the owner of the motion flags' lifetime.
 *
 * Covers every way of reaching a tab that does not go through the tab bar:
 * back/forward, a sidebar `<Link href="/?tab=forum">`, the `/forum` redirect, a
 * deep link. If the tap already started this exact transition it adopts it
 * rather than restarting.
 *
 * `lean` samples the wave over the pane's own blocks, and requires that those
 * blocks survive the run — see `playSharedAxis`. It holds for the gallery/forum
 * and profile panes, which are static once mounted, and **fails for any pane
 * whose content is replaced when its tab is selected**: the messages tabs fetch
 * on arrival, so within ~70ms of the switch starting both panes' subtrees had
 * been swapped for loading skeletons and GSAP was animating detached nodes while
 * the new ones sat still. Measured: pane height collapsing 1887 -> 288 inside the
 * first frames, and zero transformed descendants for the whole run.
 *
 * Pass `false` there. Nothing is lost but the shear — the pane element itself is
 * the one node React will not replace, so the whole side moves as one plate,
 * which is exactly what the route cross-fade already does for the same reason.
 *
 * Attach the returned ref to the element carrying `data-tab-panel`.
 */
export function useTabPanes<T extends HTMLElement = HTMLElement>(
  active: string,
  { lean = true }: { lean?: boolean } = {},
): RefObject<T | null> {
  const ref = useRef<T>(null);
  const previous = useRef(active);
  /* Read through a ref so it never widens the dependency list: this effect must
     run on `active` and nothing else, or a parent re-render that happens to
     change the option would restart a live transition. */
  const leanRef = useRef(lean);
  useEffect(() => {
    leanRef.current = lean;
  });

  useLayoutEffect(() => {
    const panel = ref.current;
    if (!panel) return;

    /* The URL is still travelling towards a tab the user has already left.
       Ignore it — it is not a destination, it is a stale waypoint, and the push
       that supersedes it is already queued.

       This has to return before `clearPaneFlags`: at this commit React has
       moved `data-tab-pane-active` onto the tab the URL is passing through, so
       the motion flags are the only thing still holding the right pane on
       screen. Clearing them here would swap the panes with no animation at all,
       which is the same bounce arriving instantly instead of over 500ms. */
    if (pendingTabIntent !== null && pendingTabIntent !== active) return;

    /* Where the panes actually are, which is not necessarily where the URL says.
       `lastTabTarget` is written by every run, optimistic or reactive, whereas
       `previous` has only ever seen commits — so it is the fallback, for a panel
       that has not animated yet and therefore cannot be out of step. */
    const from = lastTabTarget.get(panel) ?? previous.current;
    previous.current = active;

    const live = activeTabRun?.panel === panel;

    // Nothing is animating, so React's `data-tab-pane-active` is the only
    // truth and every motion flag is stale.
    if (!live) clearPaneFlags(panel);

    if (from === active) return;
    if (live && activeTabRun?.to === active) return; // adopted, still in flight
    // Already animated to this tab optimistically; the commit is only catching
    // up. Flags were cleared above, so React's own `-active` now holds it.
    if (lastTabTarget.get(panel) === active) return;
    if (prefersReducedMotion()) return;

    const order = [...panel.querySelectorAll<HTMLElement>('[data-tab-pane]')].map(
      (pane) => pane.dataset.tabPane,
    );
    const direction: 1 | -1 = order.indexOf(active) > order.indexOf(from) ? 1 : -1;
    runTabTransition(panel, from, active, direction, leanRef.current);
  }, [active]);

  return ref;
}

/** Ends any in-flight tab transition immediately. */
export function finishTabTransition() {
  activeTabRun?.finish();
}

/* Re-exported so a component never registers a plugin itself. Registration is a
   global, one-time side effect, and a second `registerPlugin` call from a
   lazily-loaded component is how a plugin ends up half-initialised. `Observer`
   joined this list for `Sheet`'s drag-to-dismiss, which is the same gesture
   mechanism `useDrawerSwipe` above uses. */
export { Flip, gsap, useGSAP, Observer, ScrollTrigger };
