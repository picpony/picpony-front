'use client';

import {
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from 'react';
import { createPortal } from 'react-dom';
import { cn, clamp } from '@/lib/utils';
import { MEDIA } from '@/lib/constants';
import { motionTier, scaledMs } from '@/lib/appearance';
import { MENU_TRANSITION } from '@/lib/motionTokens';
import { SPRING_MS } from '@/lib/spring';
import { springTiming } from '@/lib/springTiming';
import { observeAnchorReflow } from '@/lib/anchorReflow';
import { OverlayLayerContext, useOverlayLayer, useExitAnimation, useMounted } from '@/lib/overlay';

const MENU_MARGIN = 8;
const VIEWPORT_PADDING = 12;
/** 18rem — past this the panel scrolls no matter how much room it has. */
export const POPOVER_MAX_HEIGHT = 288;
/**
 * Below this share of its trigger still on screen, a panel has lost the thing it hangs
 * off and closes. Half, not "any": a trigger half under the app bar is still the control
 * you pressed; a sliver is not, and an upward panel above it would be over the bar.
 */
const DETACH_BELOW = 0.5;

/**
 * Every ancestor that clips the anchor — the region it has to stay visible in. The
 * app scroller is one (it starts below the app bar, so "scrolled under the bar" is
 * "clipped"), and so is a dialog's scrolling body. A fixed ancestor pins everything
 * below it to the viewport, so the walk stops there.
 */
function clippingAncestors(element: HTMLElement): HTMLElement[] {
  const found: HTMLElement[] = [];
  for (let node = element.parentElement; node && node !== document.body; node = node.parentElement) {
    const style = getComputedStyle(node);
    if (style.overflowX !== 'visible' || style.overflowY !== 'visible') found.push(node);
    if (style.position === 'fixed') break;
  }
  return found;
}

/** How much of `element`'s box is inside the viewport and every one of `clippers`. */
function visibleFraction(element: HTMLElement, clippers: HTMLElement[]): number {
  const rect = element.getBoundingClientRect();
  const area = rect.width * rect.height;
  if (area <= 0) return 0;
  let left = Math.max(rect.left, 0);
  let top = Math.max(rect.top, 0);
  let right = Math.min(rect.right, window.innerWidth);
  let bottom = Math.min(rect.bottom, window.innerHeight);
  for (const clipper of clippers) {
    const box = clipper.getBoundingClientRect();
    left = Math.max(left, box.left);
    top = Math.max(top, box.top);
    right = Math.min(right, box.right);
    bottom = Math.min(bottom, box.bottom);
  }
  return (Math.max(0, right - left) * Math.max(0, bottom - top)) / area;
}

/**
 * The height a list of `rows` menu rows will come out at, for `estimatedHeight`.
 *
 * A menu row has a 40dp minimum under a fine pointer and 48dp under a coarse one,
 * so the estimate has to read the same density axis or
 * `Popover` picks its side against the wrong number and flips the panel on the way in.
 * Include the 2dp row gaps and the 8dp padding at each end of the container — the
 * panel's own inset now, so that term is true for every caller of this (the one
 * panel that stands the inset down states its own estimate instead).
 *
 * Pass `suggestionRow`'s `height` rather than a literal, so the number the row lays
 * out at and the number the side is chosen against cannot be two different numbers.
 */
export function estimateMenuHeight(rows: number, rowHeight?: number): number {
  const coarse =
    typeof window !== 'undefined' && window.matchMedia(MEDIA.pointerCoarse).matches;
  return rows * (rowHeight ?? (coarse ? 48 : 40)) + Math.max(0, rows - 1) * 2 + 8 * 2;
}

/**
 * `py-1` at every size, because the min-height is what decides each of these rows: the
 * tallest content any of them holds is a `body-l` line over a `body-s` one (28 + 18 = 46px)
 * and that still clears 56 with 8px of padding, so the padding only governs a line that
 * *wraps* — the people search's failure sentence, the one row here that can.
 */
const ROW_BASE = 'flex w-full items-center gap-3 py-1 text-left select-none touch-manipulation';

export interface SuggestionRow {
  /** Spread with `useCombobox`'s `optionClassName(index)`, which adds the row's state. */
  className: string;
  /** For `estimateMenuHeight`; absent where the row takes the pointer-density default. */
  height: number | undefined;
}

/**
 * One row of a list a field suggests — `useCombobox`'s five screens: /search, 订阅标签, a
 * block or tag group's tag field, the glossary's Derpibooru lookup, /messages' people search.
 *
 * It lives here because it is *derived* from the panel's own geometry rather than chosen:
 * a row's corner is the panel's less the 8dp inset — 16 − 8 = 8dp under a menu, 28 − 8 = 20dp
 * under a search bar — and `height` is the figure `estimateMenuHeight` must be handed. Five
 * hand-copied strings had drifted to three geometries, two of each number that matters (8 and
 * 20dp corners, 8 and 12dp inline padding, 12 and 16dp gaps, 40/48 and 56dp rows), and one of
 * them disagreed with its own estimate: a two-line row declared the 40dp dense floor,
 * estimated 48 and laid out at 50.
 *
 * `variant` has to match the `Popover`'s, since the corner is the panel's arithmetic:
 *
 * - **`search`** — M3's 56dp suggestion row, whatever it holds, with 12dp of inline padding,
 *   which is what puts the row on the search bar's own columns: 8 + 12 = 20px is where
 *   `.m3-field[data-size='lg'] > .m3-field-lead` draws the field's glyph, and + 24 + 12 = 56px
 *   is `--field-lead`, where the text you typed starts. A 24dp leading slot and `gap-3` are
 *   therefore not free numbers — they are the two that make both columns land.
 * - **`menu`** — the ordinary density step, 40dp under a pointer and 48 under a finger, with
 *   `Select`'s own 8dp inline padding, which with the panel's inset lands on the field's 16dp
 *   text inset. `lines: 2` raises it to 56dp: a 20dp label over an 18dp supporting line does
 *   not fit a dense row, and 56 is the next step the scale offers.
 */
export function suggestionRow({
  variant = 'menu',
  lines = 1,
}: { variant?: 'menu' | 'search'; lines?: 1 | 2 } = {}): SuggestionRow {
  if (variant === 'search') return { className: `${ROW_BASE} min-h-14 rounded-xl px-3`, height: 56 };
  if (lines === 2) return { className: `${ROW_BASE} min-h-14 rounded-sm px-2`, height: 56 };
  return { className: `${ROW_BASE} min-h-10 pointer-coarse:min-h-12 rounded-sm px-2`, height: undefined };
}

/* A **menu** opens out of its trigger, like Vuetify's VMenu, on the shared short step: 200ms on
 * the standard decelerate, with the user's speed scale. The arrangement is borrowed; the literal
 * durations are not. The **search view** is a collapsible panel rather than an anchored menu, so
 * it arrives on DefaultSpatial with its height (see the height effect below). Both leave as every
 * small surface does, on FastEffects — the toast, the tooltip: a dismissal answers a
 * press, and starts on the frame after it (the 150ms standard accelerate it left on was 3% of the
 * way after a frame).
 *
 * Reduced motion removes the travel. The exit hold uses the unscaled duration because
 * useExitAnimation applies the maximum speed itself. */
const EXIT_MS = SPRING_MS.fastEffects;

export interface PopoverHandle {
  /** The panel element, for a caller that needs its box or its subtree. */
  readonly element: HTMLDivElement | null;
  /** The box the rows scroll in — not the panel, which is the frame around it. */
  readonly scroller: HTMLDivElement | null;
}

interface PopoverProps {
  open: boolean;
  /** Called on Escape, on an outside press, or on a scroll that dismisses. */
  onClose: (refocus: boolean) => void;
  /** The control the panel hangs off. Its rect decides side, width and origin. */
  anchorRef: RefObject<HTMLElement | null>;
  children: ReactNode;
  /**
   * Height guess used to pick a side *before* the panel has been laid out.
   * Must track the real geometry: when it undershoots, the panel is judged to
   * fit below when it does not, and a scrollbar appears in a panel that had
   * room to open upwards instead.
   */
  estimatedHeight?: number;
  /** Cap on the panel's height. */
  maxHeight?: number;
  /** Match the anchor exactly. Intrinsically sized panels are centred on it. */
  matchAnchorWidth?: boolean;
  /** Extra classes on the panel, for its width. The 8dp inset is the panel's own. */
  className?: string;
  /**
   * The 8dp inset its rows sit inside, on by default — one half of the concentric
   * arithmetic `suggestionRow` does. Off for a panel that is *not* a list of rows and
   * supplies its own padding (the emoji picker, which wants none at its foot): a
   * `className` cannot stand it down, because `cn` is a plain join and `p-2` beside
   * `pt-2` leaves Tailwind's output order to decide the other three sides.
   */
  inset?: boolean;
  /** Search suggestions extend the search bar's material and 28dp silhouette. */
  variant?: 'menu' | 'search';
  handleRef?: RefObject<PopoverHandle | null>;
  id?: string;
  role?: string;
  'aria-label'?: string;
}

/**
 * A floating panel anchored to a control.
 *
 * Menu surfaces use a 16dp corner, `surface-container` and level 2. The search
 * variant extends the search bar's 28dp corner and highest container tone,
 * keeping a restrained level 1 shadow only to explain its overlap with the page.
 * Both carry the 8dp inset their rows sit inside. Both recipes live here so
 * width, material, inset and motion cannot drift at call sites — and so does the
 * row's own geometry (`suggestionRow`), which is derived from the panel's.
 *
 * **What this owns**: the surface, where it goes, how it arrives and leaves, and how
 * it is dismissed. **What it does not own**: the content, or any roving focus inside
 * it — see `Menu` for that.
 */
export default function Popover({
  open,
  onClose,
  anchorRef,
  children,
  estimatedHeight,
  maxHeight = POPOVER_MAX_HEIGHT,
  matchAnchorWidth = true,
  className = '',
  inset = true,
  variant = 'menu',
  handleRef,
  id,
  role,
  'aria-label': ariaLabel,
}: PopoverProps) {
  const mounted = useMounted();
  const panelRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  /* Kept in the tree past `open` so the exit has something to play on. The
     shared hook rather than a hand-rolled flag; `Modal` and `Sheet` hold
     themselves open the same way. */
  const rendering = useExitAnimation(open, variant === 'search' ? SPRING_MS.fastEffects : EXIT_MS);
  const placedPanel = useRef<HTMLDivElement | null>(null);
  /* The content box the search view's height runs on, the height it last had on screen (a
     layout effect can only read the new one), and the run itself with where it is heading. */
  const heightBox = useRef<HTMLDivElement | null>(null);
  const heightSeen = useRef<number | null>(null);
  const heightRun = useRef<{ animation: Animation; to: number } | null>(null);
  // measure() runs before placement's state update commits. The entrance needs
  // that freshly chosen side even on the first upward opening.
  const opensUp = useRef(false);
  const [placement, setPlacement] = useState({
    top: 0,
    left: 0,
    width: 0,
    up: false,
    available: maxHeight,
    viewportHeight: 0,
  });

  /* A live getter rather than a snapshot, so a caller reading `.element` always
     sees the current node without this having to re-run on every mount. */
  useImperativeHandle(
    handleRef,
    () => ({
      get element() {
        return panelRef.current;
      },
      get scroller() {
        return scrollRef.current;
      },
    }),
    [],
  );

  const measure = useCallback(() => {
    const anchor = anchorRef.current;
    if (!anchor) return;
    const rect = anchor.getBoundingClientRect();
    const estimate = Math.min(estimatedHeight ?? maxHeight, maxHeight);
    const spaceBelow = window.innerHeight - rect.bottom - MENU_MARGIN - VIEWPORT_PADDING;
    const spaceAbove = rect.top - MENU_MARGIN - VIEWPORT_PADDING;
    /* Upwards only when it does not fit below AND there is more room above.
       Testing the space below alone left a six-row panel clamped to two rows
       with a scrollbar over an empty upper half. */
    const up = estimate > spaceBelow && spaceAbove > spaceBelow;
    opensUp.current = up;
    const panelWidth = panelRef.current?.offsetWidth;
    const aligned = !matchAnchorWidth && panelWidth
      ? rect.left + (rect.width - panelWidth) / 2
      : rect.left;
    // Preserve the horizontal clamp while scrolling, rather than undoing it and
    // asking the next layout effect for a second state update and geometry pass.
    const left = panelWidth
      ? clamp(aligned, VIEWPORT_PADDING, window.innerWidth - VIEWPORT_PADDING - panelWidth)
      : aligned;
    const next = {
      top: up ? rect.top - MENU_MARGIN : rect.bottom + MENU_MARGIN,
      left,
      width: rect.width,
      up,
      available: clamp(up ? spaceAbove : spaceBelow, 0, maxHeight),
      viewportHeight: window.innerHeight,
    };
    setPlacement((prev) =>
      prev.top === next.top && prev.left === next.left && prev.width === next.width &&
      prev.up === next.up && prev.available === next.available &&
      prev.viewportHeight === next.viewportHeight ? prev : next,
    );
  }, [anchorRef, estimatedHeight, maxHeight, matchAnchorWidth]);

  /* Measure before the first paint of an opening panel, never after. Writing
     layout back as state from a layout effect is the documented React pattern
     for measure-then-position; after paint would show the panel at 0,0 for a
     frame. */
  useLayoutEffect(() => {
    if (!open) return;
    measure();
  }, [open, measure]);

  /* Then clamp horizontally, which `measure` cannot do on its own: it runs
     before the panel exists and the panel's width is not the anchor's whenever
     `matchAnchorWidth` is off (a menu is as wide as its longest label) — a menu
     near the right edge ran past the viewport, unreachable because the panel is
     fixed-positioned. Pre-paint, settles in one pass: once clamped the
     condition is false, so there is no loop. */
  useLayoutEffect(() => {
    if (!open || !rendering) return;
    const panel = panelRef.current;
    const anchor = anchorRef.current;
    if (!panel || !anchor) return;
    const width = panel.offsetWidth;
    const rightLimit = window.innerWidth - VIEWPORT_PADDING - width;
    const rect = anchor.getBoundingClientRect();
    const aligned = matchAnchorWidth ? rect.left : rect.left + (rect.width - width) / 2;
    const clamped = clamp(aligned, VIEWPORT_PADDING, rightLimit);
    if (Math.abs(clamped - placement.left) > 0.5) {
      setPlacement((prev) => ({ ...prev, left: clamped }));
    }
  }, [open, rendering, placement.left, placement.width, anchorRef, matchAnchorWidth]);

  /* One layout effect owns both directions. Cancelling the
     entrance in a layout cleanup and starting the exit in a passive effect
     exposed the full-sized panel for a frame. Commit the current pose before
     cancellation so an interrupted morph and its content keep their place.

     The transform is resolved from real trigger and panel geometry. Content
     becomes visible once the expanding surface is nearly full size and finishes
     on the same clock; it does not trail after the container. Reduced/search
     keep one fade, with no independent content animation. */
  useLayoutEffect(() => {
    if (!mounted || !rendering) {
      placedPanel.current = null;
      return;
    }
    const panel = panelRef.current;
    const content = contentRef.current;
    const anchor = anchorRef.current;
    if (!panel || !content || !anchor) return;
    // Padding gives an unmeasured width: 0 panel a nonzero offsetWidth. Wait
    // for the anchor width before seeding the first collapsed pose.
    if (matchAnchorWidth && placement.width <= 0) return;

    const width = panel.offsetWidth;
    const height = panel.offsetHeight;
    if (width === 0 || height === 0) return;
    const tier = motionTier('overlay');
    const morph = variant === 'menu' && tier === 'standard';
    let collapsed = 'none';
    if (morph) {
      const target = anchor.getBoundingClientRect();
      const rawX = target.width / width;
      const rawY = target.height / height;
      const normalization = Math.max(1, rawX, rawY);
      const sx = rawX / normalization;
      const sy = rawY / normalization;
      const aligned = matchAnchorWidth ? target.left : target.left + (target.width - width) / 2;
      const left = clamp(aligned, VIEWPORT_PADDING, window.innerWidth - VIEWPORT_PADDING - width);
      const x = target.left + target.width / 2 - left - width * sx / 2;
      const y = opensUp.current ? height + MENU_MARGIN - height * sy : -MENU_MARGIN;
      collapsed = `translate(${x}px, ${y}px) scale(${sx}, ${sy})`;
    }
    const firstPlacement = placedPanel.current !== panel;
    placedPanel.current = panel;
    const panelStyle = getComputedStyle(panel);
    const fromTransform = firstPlacement && open ? collapsed : panelStyle.transform;
    const fromOpacity = firstPlacement && open ? '0' : panelStyle.opacity;
    const fromContentOpacity = firstPlacement && open && morph ? '0' : getComputedStyle(content).opacity;
    const transform = open ? 'none' : collapsed;
    const opacity = open ? '1' : '0';
    panel.style.transform = transform;
    panel.style.opacity = opacity;
    // One stable origin also makes an in-flight above/below flip continuous.
    panel.style.transformOrigin = '0 0';
    content.style.opacity = morph && !open ? '0' : '1';

    if (tier === 'off') return;

    if (fromOpacity === opacity && fromTransform === transform && fromContentOpacity === content.style.opacity) return;
    /* One clock per direction, shared with the search view's height below, because a gesture's
       parts must agree. An anchored menu *grows out of its trigger* and keeps the measured
       transform's own 200ms step. The search view is something else: a **collapsible panel**,
       both ends of its travel on screen, which this app answers with the collapsible-panel pair of
       springs rather than a one-sided curve — `default-spatial` open, `fast-effects` closed. It
       arrived on FastEffects with no travel at all: 108ms of opacity for a panel that comes
       to 462px at eight rows, which is the whole of what read as a pop. */
    const timing = !open
      ? springTiming('fastEffects', 'overlay')
      : variant === 'search'
        ? springTiming('defaultSpatial', 'overlay')
        : { duration: scaledMs(MENU_TRANSITION.enter.duration, 'overlay'), easing: MENU_TRANSITION.enter.easing };
    const from: Keyframe = { opacity: fromOpacity };
    const to: Keyframe = { opacity };
    if (fromTransform !== transform) {
      from.transform = fromTransform;
      to.transform = transform;
    }
    const running = [panel.animate([from, to], { ...timing, fill: 'both' })];
    if (morph) {
      const effects = springTiming('fastEffects', 'overlay');
      // Only hidden content waits for the surface to expand. A reversal with
      // visible text picks up its opacity immediately from the current frame.
      const delay = open && Number(fromContentOpacity) < 0.05
        ? Math.max(0, timing.duration - effects.duration)
        : 0;
      running.push(content.animate(
        [{ opacity: fromContentOpacity }, { opacity: content.style.opacity }],
        { ...effects, delay, fill: 'both' },
      ));
    }

    let active = true;
    Promise.all(running.map((animation) => animation.finished)).then(() => {
      if (!active) return;
      running.forEach((animation) => animation.cancel());
    }, () => {});

    return () => {
      active = false;
      for (const animation of running) {
        if (animation.playState !== 'idle') {
          try {
            animation.commitStyles();
          } catch {
            // A detached panel has no pose to preserve.
          }
        }
        animation.cancel();
      }
    };
  }, [open, mounted, rendering, placement.up, placement.width, anchorRef, variant, matchAnchorWidth]);

  /* The search view's second track: its height.
   *
   * M3's docked search bar expands and shrinks its suggestion view vertically along with the
   * fade — `DockedEnterTransition` is `fadeIn + expandVertically`, `DockedExitTransition` is
   * `fadeOut + shrinkVertically`, both on one spec — where this panel only faded, so a list
   * that comes to 462px at eight rows simply appeared over the page. The arrangement is
   * borrowed; the literal durations are not (M3's are 600ms in and 350ms out, each behind a
   * 100ms delay, and shared with its full-screen variant). It rides the clock above, both
   * directions.
   *
   * **The box that moves is the content wrapper, never the scroller.** The rows are laid out
   * at their final size and revealed by the wrapper's bottom edge, so the scroller's own box
   * always fits exactly what is inside it and no scrollbar flickers through the run — which is
   * the whole reason the height is not simply animated on the panel.
   *
   * One effect owns all three of its changes — arriving, leaving, and following the rows when
   * a lookup replaces them (`keepPrevious` hands this panel a new list on nearly every
   * keystroke, and it used to jump from five rows to two). Each starts from the height on
   * screen, so they interrupt one another instead of fighting. Its dependency is the content
   * itself: `children` is the same element while the panel merely repositions — this component
   * re-renders on every scroll frame — so a scroll reads no layout here.
   */
  useLayoutEffect(() => {
    const panel = panelRef.current;
    const box = contentRef.current;
    const scroller = scrollRef.current;
    if (!mounted || !rendering || variant !== 'search' || !panel || !box || !scroller) return;
    /* Already out, or on its way: a parent that re-renders mid-exit must not restart the
       shrink, and one that re-renders after it must not let the box spring back to its
       content behind the fading panel — which would also cost the next opening its
       expansion, since the height it starts from is the height it is holding. */
    if (!open && (heightRun.current?.to === 0 || heightSeen.current === 0)) return;

    const first = heightBox.current !== box;
    heightBox.current = box;
    /* The height on screen. A run in flight *is* that height, and reading it before the run
       is let go is what makes an interruption continuous. With nothing running, the commit has
       already replaced the layout, so the only honest source is the height remembered from the
       last pass — this is the one thing a layout effect cannot read, and the reason
       `FollowHeight` reaches for `getSnapshotBeforeUpdate` instead. */
    const live = heightRun.current ? box.getBoundingClientRect().height : heightSeen.current ?? 0;
    heightRun.current?.animation.cancel();
    heightRun.current = null;
    box.style.height = '';
    box.style.clipPath = '';

    const natural = box.getBoundingClientRect().height;
    heightSeen.current = natural;
    if (motionTier('overlay') === 'off') return;
    if (Math.abs((open ? natural : 0) - live) < 0.5) return;

    /* Both ends are clamped to what the panel can actually show, because height above that
       belongs to the scroller: a shrink from eight rows to two would otherwise spend its
       first 58% invisible and then fall off a cliff. The frame is the panel's own padding,
       measured rather than assumed, since a caller may set its own. */
    const cap = Math.max(0, placement.available - (panel.offsetHeight - scroller.offsetHeight));
    const from = first ? 0 : Math.min(live, cap);
    const to = open ? Math.min(natural, cap) : 0;
    if (Math.abs(to - from) < 0.5) return;

    // Only the bottom edge, so a row's ring or its wave stays whole on the other three.
    box.style.clipPath = 'inset(-100vmax -100vmax 0 -100vmax)';
    /* The first placement of an opening panel is the arrival and takes the clock above;
       anything after it — a list replaced underneath, or a re-aim once the measured space
       below arrives — takes `FollowHeight`'s response, critically damped, because a box
       settling onto its content must not overshoot it. A leaving panel takes the dismissal. */
    const timing = springTiming(open ? (first ? 'defaultSpatial' : 'defaultEffects') : 'fastEffects', 'overlay');
    const animation = box.animate([{ height: `${from}px` }, { height: `${to}px` }], { ...timing, fill: 'both' });
    heightRun.current = { animation, to };
    const release = () => {
      if (heightRun.current?.animation !== animation) return;
      heightRun.current = null;
      animation.cancel();
      box.style.clipPath = '';
      if (to === 0) {
        /* Gone: hold the box closed rather than letting it spring back to its content behind
           the fading panel, so a re-open inside the exit window starts from nothing. */
        box.style.height = '0px';
        heightSeen.current = 0;
      }
    };
    animation.finished.then(release, release);
  }, [open, mounted, rendering, variant, children, placement.available]);

  /* The latest close handler, for listeners that must not re-subscribe on every
     render of a caller passing an inline function. */
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  });

  /* Reposition against scroll and resize rather than trapping the page: a
     popover is not modal, the page behind it stays live — until the trigger it
     hangs off scrolls out from under it. Then it closes, as a native menu does:
     it used to keep repositioning against a trigger that had gone under the app
     bar, a panel painted over the chrome and attached to nothing. Closing moves
     focus that was inside the panel back to the trigger *without scrolling to it*,
     so the page stays where the user put it and the keyboard is not dropped.

     The shared listener is passive and coalesced to one frame. It ignores scrolls
     outside the anchor's ancestor chain, including this panel's own options. */
  useEffect(() => {
    if (!open) return;
    const anchor = anchorRef.current;
    if (!anchor) return;
    const clippers = clippingAncestors(anchor);
    return observeAnchorReflow(anchor, () => {
      if (visibleFraction(anchor, clippers) < DETACH_BELOW) {
        const panel = panelRef.current;
        if (panel && panel.contains(document.activeElement)) anchor.focus({ preventScroll: true });
        onCloseRef.current(false);
        return;
      }
      measure();
    });
  }, [open, measure, anchorRef]);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (panelRef.current?.contains(target) || anchorRef.current?.contains(target)) return;
      // `false` — a press elsewhere is the user moving on, so yanking focus
      // back to the trigger would fight what they just did.
      onClose(false);
    };
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [open, onClose, anchorRef]);

  const closeAndRefocus = useCallback(() => onClose(true), [onClose]);
  const layer = useOverlayLayer(open && mounted && rendering, panelRef, { onClose: closeAndRefocus, modal: false });

  if (!mounted || !rendering) return null;

  return createPortal(
    <OverlayLayerContext.Provider value={layer}>
    <div
      ref={panelRef}
      id={id}
      role={role}
      aria-label={ariaLabel}
      /* `inert` while leaving, not `pointer-events: none`. The panel is held in
       * the tree for the exit, and for those milliseconds it was still a focusable
       * subtree in the accessibility tree — a Tab after commit could land inside a
       * menu that was visibly going away. `pointer-events` only stops the pointer;
       * `inert` (React 19) takes a subtree out of the tab order and the
       * accessibility tree together. Declarative rather than set in the exit
       * effect, so re-opening inside the exit window cannot leave a live panel
       * inert. */
      inert={!open}
      style={{
        zIndex: layer.depth ? `calc(var(--z-popover) + ${layer.depth})` : undefined,
        position: 'fixed',
        top: placement.up ? undefined : placement.top,
        bottom: placement.up ? placement.viewportHeight - placement.top : undefined,
        left: placement.left,
        width: matchAnchorWidth ? placement.width : undefined,
        /* A panel wider than the screen has to shrink, not merely be pushed
           inward — the clamp above can only move it. */
        maxWidth: `calc(100vw - ${VIEWPORT_PADDING * 2}px)`,
        maxHeight: `${placement.available}px`,
      }}
      /* **The panel is the frame; the rows scroll inside its inset.**
         It used to be the scroller itself, and a padded scroll container gives its
         padding away the moment it scrolls: at any offset the content's top is above
         the padding box, so a row sat flush against the panel's top edge and ran
         under its 28dp corners (screenshotted) — the list read as bleeding out of
         the surface rather than sitting in it. The frame keeps the inset at both
         ends, puts the scrollbar 8dp inside the corner instead of across it, and
         cuts a half-scrolled row at a straight edge. The emoji picker's caption
         wants this too: it is `sticky bottom-0` against "whichever surface scrolls
         the picker", and that is now the inner box, still flush with the panel's
         own bottom edge (measured).

         `overflow: clip` on the frame, not hidden: it is no scroll container, so
         nothing can scroll it to a stray offset, and it still holds the rows inside
         its silhouette. The panel was already clipping on both axes, since
         `overflow-y: auto` beside an `overflow-x: visible` computes to `auto`.

         **The 8dp inset is the panel's, not the caller's.** Rows sit 8dp inside
         the outer corner — that inset is one half of the concentric arithmetic
         `suggestionRow` does (row corner = panel corner − inset), so a call site
         that forgot it got 8dp rows flush against a 16dp panel and a crescent of
         surface at each corner (/messages' people search did). Five of the seven
         menu panels passed `p-2`, one forgot it, and one wants its own asymmetric
         padding — the emoji picker, which says so with `inset={false}`.

         Both variants lay out at final dimensions before animating. Menu content
         fades in as its surface expands; the search view fades and expands. */
      className={cn(
        /* `forced-boundary`: forced colors flattens the surface tone and drops the
           shadow, the panel's only two separations from the page under it. */
        'text-on-surface z-popover flex flex-col overflow-clip forced-boundary',
        inset && 'p-2',
        variant === 'search'
          ? 'rounded-2xl bg-surface-container-highest shadow-e1'
          : 'rounded-lg bg-surface-container shadow-e2',
        className,
      )}
    >
      {/* `popover-scrollbar`, not `main-scrollbar`: the latter reserves its gutter
          permanently, right for a page column and wrong for a short menu, where it
          leaves every row short of the right edge.

          `overflow-y: auto` unconditionally, never a conditional hidden — the
          condition it replaced used an *estimated* content height, so a panel a few
          pixels past the estimate was judged to fit and clipped its last row. `auto`
          already means "a scrollbar only when one is needed". `overflow-x: hidden`
          beside it, spelled out: left `visible` it would compute to `auto` and make
          the box a horizontal scroller too, and `clip` is *used* as hidden next to a
          scrolling axis anyway (measured), so hidden is what applies either way.

          Its corner is the rows' own — the same `outer − inset` arithmetic — so the
          edge that cuts a half-scrolled row is the shape the rows already have, and
          `relative` makes it the rows' offset parent, which is what lets `revealRow`
          place the cursor from layout offsets rather than from a transformed rect. */}
      <div
        ref={scrollRef}
        data-popover-scroller=""
        className={cn(
          'popover-scrollbar relative min-h-0 overflow-x-hidden overflow-y-auto',
          inset && (variant === 'search' ? 'rounded-xl' : 'rounded-sm'),
        )}
      >
        <div ref={contentRef} role="presentation" className="space-y-0.5">
          {children}
        </div>
      </div>
    </div>
    </OverlayLayerContext.Provider>,
    document.body,
  );
}
