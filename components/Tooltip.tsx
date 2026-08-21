'use client';

import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type RefObject,
} from 'react';
import { createPortal } from 'react-dom';
import { cn } from '@/lib/utils';
import { SPRING_MS } from '@/lib/spring';
import { useExitAnimation, useMounted } from '@/lib/overlay';

/** Gap between the anchor and the bubble, per M3. */
const OFFSET = 4;
/** Keep the bubble this far from the viewport edge. */
const VIEWPORT_PADDING = 8;
/**
 * How long a pointer must rest before the bubble appears. Material's own figure.
 * Without a delay a tooltip fires on every pointer that crosses a toolbar, which
 * is how a helpful label becomes a flicker.
 */
const HOVER_DELAY_MS = 500;
/**
 * How long the bubble stays mounted after `open` goes false. Read from the spring
 * itself rather than hand-typed beside it: the fade runs on `fast-effects`, and a
 * literal here is a second copy of that number waiting to drift.
 */
const EXIT_MS = SPRING_MS.fastEffects;

/**
 * M3 plain tooltip.
 *
 * The app had none, so every icon-only control fell back to the browser's own
 * `title` bubble: the OS font at the OS size, no token in it, a delay the page
 * cannot set, no way to reach it on a touch screen, and — the part that matters
 * most — nothing a screen reader ties to the control, because `title` is a
 * last-resort accessible *name*, not a description.
 *
 * By its own tokens (`PlainTooltipTokens`): `inverse-surface` container,
 * `inverse-on-surface` text at `body-small`, `corner-extra-small`, and **no
 * elevation** — a plain tooltip is a label, not a surface that floats.
 *
 * `inverse-surface` here is not the mistake the snackbar's note warns about. That
 * role flips between schemes, which is wrong for a *severity* — the same message
 * must not arrive as a dark chip in one theme and a light one in the other. A
 * tooltip carries no severity; its whole job is to contrast with whatever surface
 * it is over, and flipping is exactly how it keeps doing that.
 *
 * It shows on hover after a delay and on **focus immediately**, because a keyboard
 * user has already committed to the control by the time it is focused. It hides on
 * leave, on blur, on Escape and on a press — a bubble still up while its button is
 * being pressed is describing a decision that has already been made.
 *
 * `aria-describedby`, not `aria-label`: the control already has a name (an
 * icon-only control cannot ship without one), and the tooltip repeats it for the
 * eye. Announcing it as the name as well would read it twice.
 */
export function Tooltip({
  label,
  anchorRef,
  open,
  id,
}: {
  label: string;
  anchorRef: RefObject<HTMLElement | null>;
  open: boolean;
  id: string;
}) {
  const mounted = useMounted();
  const bubbleRef = useRef<HTMLDivElement>(null);
  /* Held past `open` so the exit has something to play on, and false until the
     first open so a page of forty icon buttons costs forty nulls rather than
     forty portals. `lib/overlay.ts` already owns this — `Modal`, `Sheet` and
     `Popover` all hold themselves open the same way. */
  const rendering = useExitAnimation(open, EXIT_MS);
  const [place, setPlace] = useState({ top: 0, left: 0, above: false });

  /* Measure before the first paint, or the bubble shows at 0,0 for a frame. Two
     passes by construction: the first places it from the anchor's box alone, the
     second — once the bubble exists and its own width is known — centres and
     clamps it. The condition is false after the second, so there is no loop. */
  const measure = useCallback(() => {
    const anchor = anchorRef.current;
    if (!anchor) return;
    const a = anchor.getBoundingClientRect();
    const bubble = bubbleRef.current?.getBoundingClientRect();
    const width = bubble?.width ?? 0;
    const height = bubble?.height ?? 0;
    const below = a.bottom + OFFSET;
    const above = window.innerHeight - a.top + OFFSET;
    /* Above only when it does not fit below: a tooltip belongs under its control
       so it does not cover the thing you are pointing at. */
    const flip = below + height + VIEWPORT_PADDING > window.innerHeight && a.top > height + OFFSET;
    const centred = a.left + a.width / 2 - width / 2;
    const left = Math.max(
      VIEWPORT_PADDING,
      Math.min(centred, window.innerWidth - VIEWPORT_PADDING - width),
    );
    const next = { top: flip ? above : below, left, above: flip };
    setPlace((prev) =>
      Math.abs(prev.top - next.top) < 0.5 &&
      Math.abs(prev.left - next.left) < 0.5 &&
      prev.above === next.above
        ? prev
        : next,
    );
  }, [anchorRef]);

  useLayoutEffect(() => {
    if (!open || !rendering) return;
    measure();
  }, [open, rendering, measure, place.top, place.left]);

  /* The bubble is `position: fixed`, so it does not move with its anchor. Without
     this, opening one by keyboard focus and then scrolling the app scroller — arrow
     keys, space, a wheel over a sibling — left the bubble at its old viewport
     coordinate while the control it describes moved out from under it. `capture` so
     it hears the app scroller rather than only the window, and `passive` because it
     never calls `preventDefault`. `Popover` solves the same problem. */
  useEffect(() => {
    if (!open || !rendering) return;
    const onReflow = () => measure();
    window.addEventListener('scroll', onReflow, { capture: true, passive: true });
    window.addEventListener('resize', onReflow, { passive: true });
    return () => {
      window.removeEventListener('scroll', onReflow, { capture: true });
      window.removeEventListener('resize', onReflow);
    };
  }, [open, rendering, measure]);

  if (!mounted || !rendering) return null;

  return createPortal(
    <div
      ref={bubbleRef}
      id={id}
      role="tooltip"
      style={{
        position: 'fixed',
        left: place.left,
        [place.above ? 'bottom' : 'top']: place.top,
        maxWidth: `calc(100vw - ${VIEWPORT_PADDING * 2}px)`,
      }}
      className={cn(
        /* 4dp corner, 8dp/4dp padding and a 24dp floor — M3's plain tooltip. No
           shadow: the inverse container is the whole separation. */
        'bg-inverse-surface text-inverse-on-surface text-body-s z-tooltip',
        'pointer-events-none flex min-h-6 items-center rounded-xs px-2 py-1',
        /* `FastEffects` in **both** directions, which is what `Tooltip.kt` does
           (`MotionSchemeKeyTokens.FastEffects` alongside `FastSpatial`). The exit
           used to be a 100ms `standard-accelerate` curve described as "the
           leaves-the-screen pairing" — it is not: M3 pairs standard-accelerate
           with 200ms, 100ms is the press row, and a tooltip is component motion
           rather than a screen transition. One spring both ways also means the
           bubble cannot arrive and leave on two different clocks.

           Only opacity moves. AOSP's tooltip also scales, which is why it reaches
           for `FastSpatial` too; this one does not, so there is nothing for the
           spatial spring to drive and adding a scale would be a new behaviour
           rather than an alignment. */
        'spring-fast-effects transition-opacity',
        open ? 'opacity-100' : 'opacity-0',
      )}
    >
      {label}
    </div>,
    document.body,
  );
}

/**
 * The whole tooltip, as two things to spread.
 *
 * A hook rather than a wrapper component, because a wrapper has to either clone
 * its child — which breaks on any component that does not forward a ref — or
 * introduce a box of its own, which changes the layout of every row it lands in.
 * A control that wants a tooltip already owns its own element and its own ref, so
 * handing it the props is both simpler and layout-neutral.
 *
 *     const { anchorRef, anchorProps, tooltip } = useTooltip(label);
 *     return <>{<button ref={anchorRef} {...anchorProps} />}{tooltip}</>;
 *
 * Pass `undefined` to opt out and the hook costs nothing: no element, no
 * listeners, no `aria-describedby`.
 */
export function useTooltip(label?: string) {
  const id = useId();
  const anchorRef = useRef<HTMLElement | null>(null);
  const [open, setOpen] = useState(false);
  const timer = useRef<number | null>(null);

  const cancel = useCallback(() => {
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = null;
  }, []);

  const hide = useCallback(() => {
    cancel();
    setOpen(false);
  }, [cancel]);

  useEffect(() => cancel, [cancel]);

  /* Escape dismisses it, which WCAG 1.4.13 requires of any content that appears on
     hover: it has to go away without moving the pointer.
     A second copy of `lib/overlay.ts`'s `useEscapeToClose` is deliberately *not*
     used, and this is the one place that call is right: that hook calls
     `stopPropagation` so the innermost overlay consumes the key, which is correct for
     a dialog and wrong here — a tooltip open over a dialog must dismiss *and* let the
     key reach the dialog behind it. A tooltip is not a layer you are inside. */
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') hide();
    };
    document.addEventListener('keydown', onKeyDown, true);
    return () => document.removeEventListener('keydown', onKeyDown, true);
  }, [open, hide]);

  if (!label) {
    return { anchorRef, anchorProps: {} as Record<string, unknown>, tooltip: null };
  }

  return {
    anchorRef,
    anchorProps: {
      'aria-describedby': open ? id : undefined,
      onPointerEnter: (event: React.PointerEvent) => {
        /* Touch is a press, not a hover: a finger arriving is the user activating
           the control, and a bubble on the way in would sit over the thing they
           just tapped. */
        if (event.pointerType === 'touch') return;
        cancel();
        /* The rest delay is not animation, so it does not read the motion
           preference. It used to, and zeroing it made every pointer that merely
           *crossed* a toolbar fire a bubble per icon — which is the flicker the
           delay exists to prevent, delivered specifically to the users who asked
           for less movement. M3 specifies the delay as a behaviour of the tooltip,
           not as part of its animation; only the fade below branches. */
        timer.current = window.setTimeout(() => setOpen(true), HOVER_DELAY_MS);
      },
      onPointerLeave: hide,
      onPointerDown: hide,
      onFocus: (event: React.FocusEvent) => {
        // Keyboard focus only. A click focuses too, and the pointer path has
        // already decided what to do about that.
        if (event.target instanceof HTMLElement && event.target.matches(':focus-visible')) {
          setOpen(true);
        }
      },
      onBlur: hide,
    },
    tooltip: <Tooltip label={label} anchorRef={anchorRef} open={open} id={id} />,
  };
}

export default Tooltip;
