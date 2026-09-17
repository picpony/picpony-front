'use client';

import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type HTMLAttributes,
  type ReactElement,
  type RefObject,
} from 'react';
import { createPortal } from 'react-dom';
import { clamp, cn } from '@/lib/utils';
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
 * By its own tokens (`PlainTooltipTokens`): `inverse-surface` container,
 * `inverse-on-surface` text at `body-small`, extra-small corner, and **no
 * elevation** — a plain tooltip is a label, not a surface that floats.
 *
 * `inverse-surface` here is not the mistake the snackbar's note warns about. That
 * role flips between schemes, which is wrong for a *severity*; a tooltip carries
 * no severity — its whole job is to contrast with whatever surface it is over,
 * and flipping is exactly how it keeps doing that.
 *
 * Shows on hover after a delay and on **focus immediately** (a keyboard user has
 * already committed to the control). Hides on leave, blur, Escape and press.
 *
 * `aria-describedby`, not `aria-label`: the control already has a name, and the
 * tooltip repeats it for the eye — announcing it as the name too would read it
 * twice.
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
    const left = clamp(centred, VIEWPORT_PADDING, window.innerWidth - VIEWPORT_PADDING - width);
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
    /* Match Popover's one read per frame. Scroll events can arrive faster than
       paint; measuring the anchor and bubble on each one only blocks that same
       scroll without producing an extra visible position. */
    let frame = 0;
    const onReflow = () => {
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        measure();
      });
    };
    window.addEventListener('scroll', onReflow, { capture: true, passive: true });
    window.addEventListener('resize', onReflow, { passive: true });
    return () => {
      if (frame) cancelAnimationFrame(frame);
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
      data-open={open ? 'true' : 'false'}
      inert={!open}
      style={{
        position: 'fixed',
        left: place.left,
        [place.above ? 'bottom' : 'top']: place.top,
        maxWidth: `calc(100vw - ${VIEWPORT_PADDING * 2}px)`,
      }}
      className={cn(
        /* 4dp corner, 8dp/4dp padding and a 24dp floor — M3's plain tooltip. No
           shadow: the inverse container is the whole separation. */
        'm3-tooltip bg-inverse-surface text-inverse-on-surface text-body-s z-tooltip',
        'pointer-events-none flex min-h-6 items-center rounded-xs px-2 py-1 wrap-anywhere',
        /* `FastEffects` in **both** directions, which is what `Tooltip.kt` does.
           One spring both ways means the bubble cannot arrive and leave on two
           different clocks.

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
 * An optional external target binds the same behaviour to a third-party-owned
 * button, such as an editor toolbar. It preserves other description IDs.
 * Pass `undefined` to opt out: no element, listeners or `aria-describedby`.
 */
type TooltipAnchorProps = Pick<
  HTMLAttributes<HTMLElement>,
  'aria-describedby' | 'onPointerEnter' | 'onPointerLeave' | 'onPointerDown' | 'onFocus' | 'onBlur'
>;

export function useTooltip(label?: string, externalTarget?: HTMLElement | null): {
  anchorRef: RefObject<HTMLElement | null>;
  anchorProps: TooltipAnchorProps;
  tooltip: ReactElement | null;
} {
  const id = useId();
  const anchorRef = useRef<HTMLElement | null>(null);
  const [open, setOpen] = useState(false);
  const [lastLabel, setLastLabel] = useState(label);
  const [lastTarget, setLastTarget] = useState(externalTarget);
  const timer = useRef<number | null>(null);

  // Disabled controls temporarily remove their label and event handlers. A
  // later re-enable must start a fresh hover, not resurrect the old bubble.
  if (lastLabel !== label || lastTarget !== externalTarget) {
    setLastLabel(label);
    setLastTarget(externalTarget);
    setOpen(false);
  }

  const cancel = useCallback(() => {
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = null;
  }, []);

  const hide = useCallback(() => {
    cancel();
    setOpen(false);
  }, [cancel]);

  const showForPointer = useCallback((event: { pointerType: string }) => {
    if (event.pointerType === 'touch') return;
    cancel();
    // Rest delay describes intent, so only the fade reads the motion preference.
    timer.current = window.setTimeout(() => setOpen(true), HOVER_DELAY_MS);
  }, [cancel]);

  const showForFocus = useCallback((event: { target: EventTarget | null }) => {
    if (event.target instanceof HTMLElement && event.target.matches(':focus-visible')) {
      setOpen(true);
    }
  }, []);

  // Third-party toolbars own their buttons. Bind the same behaviour directly
  // instead of adding another tooltip recipe or a wrapper around their DOM.
  useLayoutEffect(() => {
    if (!externalTarget || !label) return;
    anchorRef.current = externalTarget;
    externalTarget.addEventListener('pointerenter', showForPointer);
    externalTarget.addEventListener('pointerleave', hide);
    externalTarget.addEventListener('pointerdown', hide);
    externalTarget.addEventListener('focus', showForFocus);
    externalTarget.addEventListener('blur', hide);
    return () => {
      cancel();
      externalTarget.removeEventListener('pointerenter', showForPointer);
      externalTarget.removeEventListener('pointerleave', hide);
      externalTarget.removeEventListener('pointerdown', hide);
      externalTarget.removeEventListener('focus', showForFocus);
      externalTarget.removeEventListener('blur', hide);
      if (anchorRef.current === externalTarget) anchorRef.current = null;
    };
  }, [externalTarget, label, showForPointer, showForFocus, hide, cancel]);

  useLayoutEffect(() => {
    if (!externalTarget || !label || !open) return;
    const ids = new Set(externalTarget.getAttribute('aria-describedby')?.split(/\s+/).filter(Boolean));
    ids.add(id);
    externalTarget.setAttribute('aria-describedby', [...ids].join(' '));
    return () => {
      const remaining = externalTarget.getAttribute('aria-describedby')?.split(/\s+/)
        .filter((value) => value && value !== id).join(' ');
      if (remaining) externalTarget.setAttribute('aria-describedby', remaining);
      else externalTarget.removeAttribute('aria-describedby');
    };
  }, [externalTarget, label, open, id]);

  useEffect(() => cancel, [cancel, label]);

  /* Escape dismisses it, which WCAG 1.4.13 requires of any content that appears on
     hover: it has to go away without moving the pointer.
     A second copy of `lib/overlay.ts`'s `useOverlayLayer` is deliberately *not*
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
    return { anchorRef, anchorProps: {}, tooltip: null };
  }

  return {
    anchorRef,
    anchorProps: {
      'aria-describedby': open ? id : undefined,
      onPointerEnter: showForPointer,
      onPointerLeave: hide,
      onPointerDown: hide,
      onFocus: showForFocus,
      onBlur: hide,
    },
    tooltip: <Tooltip label={label} anchorRef={anchorRef} open={open} id={id} />,
  };
}

export default Tooltip;
