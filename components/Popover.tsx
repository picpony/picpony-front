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
import { prefersReducedMotion } from '@/lib/motion';
import { SPRINGS, SPRING_MS, springToLinear } from '@/lib/spring';
import { useEscapeToClose, useExitAnimation, useMounted } from '@/lib/overlay';

const MENU_MARGIN = 8;
const VIEWPORT_PADDING = 12;
/** 18rem — past this the panel scrolls no matter how much room it has. */
export const POPOVER_MAX_HEIGHT = 288;

/**
 * The height a list of `rows` menu rows will come out at, for `estimatedHeight`.
 *
 * A menu row is M3's 40dp item under a pointer and grows to the 48dp touch floor
 * under a finger — `touch-size` on the row itself — so the estimate has to read the
 * same axis or `Popover` picks its side against the wrong number and flips the panel
 * on the way in. `Menu` and `Select` render byte-identical rows and each carried its
 * own pair of constants; this is the one place that arithmetic lives now.
 *
 * The 8px is the container's own `py-2`, on both.
 */
export function estimateMenuHeight(rows: number): number {
  const coarse =
    typeof window !== 'undefined' && window.matchMedia(MEDIA.pointerCoarse).matches;
  return rows * (coarse ? 48 : 40) + 8 * 2;
}

/* Container-transform timings.
 *
 * These were 225ms in and 125ms out, taken from Vuetify 3.7's MD3 menu — and
 * neither number is a step on the M3 duration scale, which the app's own motion
 * rules say is the whole scale. Borrowing an approximation from another library's
 * approximation is how a system ends up with timings that agree with nothing.
 *
 * The **fast** tier, both halves, which is what `Menu.kt` reaches for:
 * `MotionSchemeKeyTokens.FastSpatial` for the container and
 * `MotionSchemeKeyTokens.FastEffects` for what is inside it. This ran on the
 * *default* tier — 194ms and 166ms against the spec's 137ms and 108ms — so every
 * menu in the app opened one step slower than a menu is supposed to. A menu is not
 * a sheet; it is the fastest floating surface in the system precisely because it
 * appears under the pointer that asked for it.
 *
 * The exit is the same `FastEffects` spring, not a curve. It was 150ms on
 * standard-accelerate, described here as "the spec's pairing" — it is not:
 * standard-accelerate pairs with 200ms, and a menu closing is component motion
 * rather than a screen transition. One spring both ways also means the panel cannot
 * arrive and leave on two unrelated clocks, and ζ=1 guarantees it does not bounce
 * back into view on the way out.
 *
 * Spelled out as literals rather than read from the CSS tokens because they are
 * handed to Web Animations as `easing:` strings, where a failed `var()` falls
 * back to `ease` silently — the same documented exception the hero's
 * REVEAL_EASING and the top loader make. `lib/spring.ts` generates them from the
 * same closed form the CSS tables come from, so the two cannot drift. */
const ENTER_MS = SPRING_MS.fastSpatial;
const ENTER_EASING = springToLinear(SPRINGS.fastSpatial);
const ROW_MS = SPRING_MS.fastEffects;
const ROW_EASING = springToLinear(SPRINGS.fastEffects);
const EXIT_MS = SPRING_MS.fastEffects;
const EXIT_EASING = springToLinear(SPRINGS.fastEffects);

export interface PopoverHandle {
  /** The panel element, for callers that need to measure or scroll it. */
  readonly element: HTMLDivElement | null;
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
  /** Panel takes at least the anchor's width. On by default — a menu hanging
   *  off a control narrower than itself reads as detached. */
  matchAnchorWidth?: boolean;
  /** Extra classes on the panel, for width and inner padding. */
  className?: string;
  /** Fade the panel's direct children in behind the container morph. */
  animateChildren?: boolean;
  handleRef?: RefObject<PopoverHandle | null>;
  id?: string;
  role?: string;
  'aria-label'?: string;
}

/**
 * A floating panel anchored to a control.
 *
 * There was no such thing, so every floating surface in the app invented one —
 * five recipes for the same object. Measured before this existed:
 *
 *   Select's menu       4dp corner, e2, no border,  surface-container
 *   the share menu      8dp corner, e3, a border,   surface-container
 *   the emoji picker    8dp corner, e3, no border,  surface-container
 *   two autocompletes   8dp corner, e3, a border,   surface-container
 *   a third autocomplete 8dp corner, e3, a border,  surface-container-LOWEST
 *
 * Two of those carried comments arguing *opposite* corner values, which is the
 * tell that nobody was choosing — one said "a menu is 8dp" and the other said
 * "4dp, not the 8dp I first guessed". The M3 shape scale settles it: `small`
 * (8dp) is specified for "text fields, menus", and 4dp `extra-small` is for
 * chips and snackbars. Elevation likewise — level 2 is "menus, nav bar", level
 * 3 is "FAB, dialogs, search" — so four of the five were also a step too high,
 * which is why the share menu floated above `Modal`.
 *
 * No border. The tonal step plus the elevation is the whole M3 separation
 * recipe; an outline on top of both is a fourth signal for one edge.
 *
 * **What this owns**: the surface, where it goes, how it arrives and leaves, and
 * how it is dismissed. **What it does not own**: the content, or any roving
 * focus inside it — see `Menu` for that.
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
  animateChildren = true,
  handleRef,
  id,
  role,
  'aria-label': ariaLabel,
}: PopoverProps) {
  const mounted = useMounted();
  const panelRef = useRef<HTMLDivElement>(null);
  /* Kept in the tree past `open` so the exit has something to play on. The
     shared hook rather than a hand-rolled flag: `EXIT_MS` is a constant, which
     is exactly the case it was written for, and `Modal` and `Sheet` already
     hold themselves open the same way. */
  const rendering = useExitAnimation(open, EXIT_MS);
  const closingRef = useRef(false);
  const [placement, setPlacement] = useState({
    top: 0,
    left: 0,
    width: 0,
    up: false,
    available: maxHeight,
  });

  /* A live getter rather than a snapshot, so a caller reading `.element` always
     sees the current node without this having to re-run on every mount. */
  useImperativeHandle(
    handleRef,
    () => ({
      get element() {
        return panelRef.current;
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
       Testing `spaceBelow` alone left a control halfway down a long page with
       `up === false`, the max-height clamped to whatever was underneath, and a
       six-row panel two rows tall with a scrollbar over an empty upper half. */
    const up = estimate > spaceBelow && spaceAbove > spaceBelow;
    setPlacement({
      top: up ? rect.top - MENU_MARGIN : rect.bottom + MENU_MARGIN,
      left: rect.left,
      width: rect.width,
      up,
      available: clamp(up ? spaceAbove : spaceBelow, 0, maxHeight),
    });
  }, [anchorRef, estimatedHeight, maxHeight]);

  /* Measure before the first paint of an opening panel, never after. Writing
     layout back as state from a layout effect is the documented React pattern
     for measure-then-position: there is no way to know where a portalled panel
     goes without first reading the anchor's box, and doing it after paint would
     show the panel at 0,0 for a frame. */
  useLayoutEffect(() => {
    if (!open) return;
    closingRef.current = false;
    measure();
  }, [open, measure]);

  /* Then clamp horizontally, which `measure` cannot do on its own: it runs
     before the panel exists and the panel's width is not the anchor's whenever
     `matchAnchorWidth` is off — a `Menu` is as wide as its longest label. So a
     menu hanging off an icon button near the right edge was positioned at the
     anchor's `left` and simply ran past the viewport, with no scrollbar to
     reach it because the panel is `position: fixed`.
     Runs pre-paint and settles in one pass: once clamped the condition is
     false, so there is no loop. */
  useLayoutEffect(() => {
    if (!open || !rendering) return;
    const panel = panelRef.current;
    if (!panel) return;
    const width = panel.offsetWidth;
    const rightLimit = window.innerWidth - VIEWPORT_PADDING - width;
    const clamped = clamp(placement.left, VIEWPORT_PADDING, rightLimit);
    if (Math.abs(clamped - placement.left) > 0.5) {
      setPlacement((prev) => ({ ...prev, left: clamped }));
    }
  }, [open, rendering, placement.left]);

  /* Exit: the reverse container transform, shrinking back into the anchor
     rather than blinking out. `closingRef` guards it because Escape, an outside
     press and a commit can all land in one gesture, and each would otherwise
     start another exit on a panel already leaving. */
  useEffect(() => {
    if (open || !rendering || closingRef.current) return;
    const panel = panelRef.current;
    const anchor = anchorRef.current;
    if (!panel || !anchor || prefersReducedMotion()) return;

    const anchorRect = anchor.getBoundingClientRect();
    const panelRect = panel.getBoundingClientRect();
    if (panelRect.width === 0 || panelRect.height === 0) return;

    closingRef.current = true;
    /* `useExitAnimation` already holds the panel for `EXIT_MS` and then drops
       it, so this only has to draw those milliseconds — it does not have to
       report when it is done.

       It does have to be cancellable, though, and that is what the cleanup is for.
       `fill: 'forwards'` keeps the last keyframe applied after the animation ends,
       and `useExitAnimation` reuses the same node when the panel is reopened inside
       `EXIT_MS`: without this, that still-live forwards fill would reassert
       `opacity: 0` and the shrunken transform on a panel that is now open, so a
       fast close-then-open left an invisible menu holding the focus trap. */
    const exit = panel.animate(
      [
        {},
        {
          transform: `scale(${Math.min(1, anchorRect.width / panelRect.width)}, ${Math.min(
            1,
            anchorRect.height / panelRect.height,
          )})`,
          opacity: 0,
        },
      ],
      { duration: EXIT_MS, easing: EXIT_EASING, fill: 'forwards' },
    );
    return () => exit.cancel();
  }, [open, rendering, anchorRef]);

  /* Enter: an M3 container transform. The panel starts at the anchor's own box
     — scaled down to it and transparent — and grows into place, while its rows
     stay invisible for the first third and then fade in behind the morph. That
     "container morphs, then content arrives" split is the character of an MD3
     menu opening, and a plain fade throws it away.

     Web Animations rather than GSAP: this starts from a measured box, and
     WAAPI's `fill: 'backwards'` guarantees the first painted frame is already
     the scaled one. A tween beginning on the next rAF tick flashes the panel at
     full size for a frame. */
  useLayoutEffect(() => {
    const panel = panelRef.current;
    const anchor = anchorRef.current;
    if (!open || !rendering || !panel || !anchor) return;
    if (prefersReducedMotion()) return;

    const anchorRect = anchor.getBoundingClientRect();
    const panelRect = panel.getBoundingClientRect();
    if (panelRect.width === 0 || panelRect.height === 0) return;

    // Never scale up — the panel is at least as wide as its anchor.
    const sx = Math.min(1, anchorRect.width / panelRect.width);
    const sy = Math.min(1, anchorRect.height / panelRect.height);

    // Already anchored to the trigger's edge, so scaling about that edge
    // reproduces the translate half of the reference for free.
    panel.style.transformOrigin = placement.up ? 'bottom left' : 'top left';

    const container = panel.animate(
      [{ transform: `scale(${sx}, ${sy})`, opacity: 0 }, { transform: 'none', opacity: 1 }],
      { duration: ENTER_MS, easing: ENTER_EASING, fill: 'backwards' },
    );

    /* The rows wait out the container's morph and then fade on their **own**
       clock — `ROW_MS`, the effects spring's settle time — rather than being
       stretched over `ENTER_MS * 2`. A spring's shape and its duration are one
       object: replayed over a longer span the same ζ=1 curve is not a slower fade,
       it is a different one, and this file's own header says the two must never be
       split at a call site. The wait is a `delay` because that is what a delay is
       for; it used to be an `offset: 0.33` keyframe inside a doubled duration,
       which is the same idea expressed as a number nobody could check. */
    const rows = animateChildren
      ? [...panel.children].map((row) =>
          row.animate([{ opacity: 0 }, { opacity: 1 }], {
            duration: ROW_MS,
            delay: ENTER_MS * 0.5,
            easing: ROW_EASING,
            fill: 'backwards',
          }),
        )
      : [];

    return () => {
      container.cancel();
      rows.forEach((row) => row.cancel());
    };
  }, [open, rendering, placement.up, anchorRef, animateChildren]);

  // Reposition against scroll and resize rather than trapping the page. A
  // popover is not modal: the page behind it stays live.
  useEffect(() => {
    if (!open) return;
    const onScroll = () => measure();
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', onScroll);
    return () => {
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', onScroll);
    };
  }, [open, measure]);

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
  useEscapeToClose(open, closeAndRefocus);

  if (!mounted || !rendering) return null;

  return createPortal(
    <div
      ref={panelRef}
      id={id}
      role={role}
      aria-label={ariaLabel}
      /* `inert` while leaving, not `pointer-events: none`.
       *
       * The panel is held in the tree for `EXIT_MS` so its exit has something to
       * play on, and for those milliseconds it was still a focusable subtree in
       * the accessibility tree — so a Tab right after a commit could land inside
       * a menu that was visibly going away, and a screen reader could still be
       * walked through its items. `pointer-events` only stops the pointer.
       * `inert` (React 19) is the one attribute that takes a subtree out of the
       * tab order and the accessibility tree together, which is the rule
       * AGENTS.md states for exactly this case. Declarative rather than set in
       * the exit effect, so re-opening inside the exit window cannot leave a live
       * panel inert. */
      inert={!open}
      style={{
        position: 'fixed',
        top: placement.up ? undefined : placement.top,
        bottom: placement.up ? window.innerHeight - placement.top : undefined,
        left: placement.left,
        minWidth: matchAnchorWidth ? placement.width : undefined,
        /* A panel wider than the screen has to shrink, not merely be pushed
           inward — the clamp above can only move it. */
        maxWidth: `calc(100vw - ${VIEWPORT_PADDING * 2}px)`,
        maxHeight: `${placement.available}px`,
      }}
      /* `popover-scrollbar`, not `main-scrollbar`: the latter reserves its
         gutter permanently, which is right for a page column and wrong for a
         160px menu, where it leaves every row 8px short of the right edge.

         `overflow-y: auto` unconditionally, never a conditional `hidden`. The
         condition it replaced used an *estimated* content height, so a panel
         whose real content ran a few pixels past the estimate was judged to fit,
         got `hidden`, and clipped its last row with no way to reach it. `auto`
         already means "a scrollbar only when one is needed".

         **4dp**, from `MenuTokens.ContainerShape = CornerExtraSmall`. This has
         been wrong in both directions: `Select` originally drew 4dp with a comment
         arguing for it while the emoji picker drew 8dp arguing the opposite, and
         the previous pass "settled" it at 8dp by reading a summary table that says
         `small` (8dp) covers "text fields, menus". The token file disagrees with
         the summary, and it is the token file that generates the components — menus
         are 4dp and so are text fields. `surface-container` and `shadow-e2` are
         `MenuTokens.ContainerColor` / `ContainerElevation` and were already right. */
      className={cn(
        'popover-scrollbar bg-surface-container text-on-surface z-popover overflow-y-auto rounded-xs shadow-e2',
        className,
      )}
    >
      {children}
    </div>,
    document.body,
  );
}
