'use client';

import {
  useState,
  useEffect,
  useLayoutEffect,
  useCallback,
  useRef,
  useSyncExternalStore,
} from 'react';
import { createPortal } from 'react-dom';
import { MdCheckCircle, MdError, MdInfo, MdWarning } from 'react-icons/md';
import { DURATION, EASE } from '@/lib/motionTokens';
import { motionTier, scaledMs } from '@/lib/appearance';
import { ICON } from '@/lib/icons';

export type ToastType = 'success' | 'error' | 'info' | 'warning';

interface ToastMessage {
  id: number;
  message: string;
  type: ToastType;
  duration: number;
}

type ToastListener = (toast: ToastMessage) => void;
const listeners: ToastListener[] = [];

let toastId = 0;

export const showToast = (
  message: string,
  type: ToastType = 'success',
  duration: number = 3000,
) => {
  const id = ++toastId;
  const toast = { id, message, type, duration };
  listeners.forEach((listener) => listener(toast));
};

/* The four severities keep the colours this app has always used — green, red,
   blue, amber — but from the scheme-independent `*-fill` tokens rather than
   Tailwind's palette, so a toast is the same colour in both themes and its white
   label is guaranteed 4.5:1. (`inverse-surface` is textbook M3 for a snackbar and
   wrong here: that token flips with the theme, so the same message arrived as a
   dark chip or a light one depending on the scheme.) */
const severityStyles: Record<ToastType, { bg: string; icon: React.ReactNode }> = {
  success: {
    bg: 'bg-success-fill',
    icon: <MdCheckCircle size={ICON.control} />,
  },
  error: {
    bg: 'bg-error-fill',
    icon: <MdError size={ICON.control} />,
  },
  info: {
    bg: 'bg-info-fill',
    icon: <MdInfo size={ICON.control} />,
  },
  warning: {
    bg: 'bg-warning-fill',
    icon: <MdWarning size={ICON.control} />,
  },
};

export function ToastContainer() {
  const [toasts, setToasts] = useState<ToastMessage[]>([]);
  const mounted = useSyncExternalStore(
    () => () => {},
    () => true,
    () => false,
  );

  useEffect(() => {
    const listener = (toast: ToastMessage) => {
      setToasts((prev) => [...prev, toast]);
    };
    listeners.push(listener);
    return () => {
      const index = listeners.indexOf(listener);
      if (index > -1) listeners.splice(index, 1);
    };
  }, []);

  const handleClose = useCallback((id: number) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  if (!mounted) return null;

  /* An error interrupts; everything else waits its turn. Politeness follows the
     most severe message currently on screen rather than being split into two
     regions, because the region has to be in the DOM before its contents change
     for the announcement to be reliable, and two stacked regions would have to
     share one column of pixels. */
  const urgent = toasts.some((toast) => toast.type === 'error');

  return createPortal(
    <div
      className="pointer-events-none fixed top-6 left-1/2 z-toast flex -translate-x-1/2 flex-col items-center"
      role="status"
      aria-live={urgent ? 'assertive' : 'polite'}
      aria-atomic="false"
    >
      {toasts.map((toast) => (
        <ToastItem key={toast.id} toast={toast} onClose={handleClose} />
      ))}
    </div>,
    document.body,
  );
}

function ToastItem({ toast, onClose }: { toast: ToastMessage; onClose: (id: number) => void }) {
  const wrapRef = useRef<HTMLDivElement>(null);

  /* A plain effect, not `useGSAP`: nothing here is a GSAP tween, and that import
     would pull the engine into the root layout's chunk for three `animate()`
     calls. Empty deps: `ToastItem` is keyed by `toast.id` at its call site, so a
     different message is a different component rather than a re-run of this one. */
  /* A **layout** effect, because `enter` carries a backwards fill: created in a
     passive effect the browser paints the card at its CSS resting position first
     and only then snaps it back to the start of the slide — one frame of the
     settled toast. `components/Reveal.tsx` records the same choice. */
  useLayoutEffect(
    () => {
      const wrap = wrapRef.current;
      if (!wrap) return;
      const card = wrap.firstElementChild as HTMLElement;

      const tier = motionTier();
      if (tier === 'off') {
        const timer = setTimeout(() => onClose(toast.id), toast.duration);
        return () => clearTimeout(timer);
      }

      /* Reduced halves the slide rather than removing it. A snackbar docked to the
         top edge that fades in place has nothing to say about where it came from,
         and 8px is the distance every other entrance takes under this tier. The
         height collapse is not travel of the *message* — it is the gap under it
         closing. */
      const reduced = tier === 'reduced';
      const slide = reduced ? -8 : -16;
      const slideOut = reduced ? -4 : -8;

      /* A snackbar's own motion is a fade plus a short slide from the edge it is
         docked to. No scale and no overshoot: a spring on scale made a message
         about a saved form bounce, and the bounce is the loudest thing in the
         frame for something the user did not ask to see.

         In on `decelerate` because it is arriving, out on `accelerate` because it
         is leaving. The height collapse is the *same* leg as the fade — the card
         going and the gap closing are one dismissal — so it shares the exit's
         clock and curve. The small negative offset stays: the gap starts closing
         just before the card is fully gone, so the queue reads as emptying rather
         than as jumping. */

      /* The dwell is wall-clock and the two legs are not. A snackbar's duration is
       * how long there is to *read* it, not how long it takes to arrive, so the
       * speed preference must not touch it — under the GSAP timeline that needed
       * dividing back out of the global timeScale, and a 3000ms message was on
       * screen for 1500ms at 快速: the tier a motion-sensitive reader is most likely
       * to pick was the one that took half the message away. On WAAPI there is no
       * global scale to fight, so the split is simply stated: the two travel legs
       * go through `scaledMs`, the dwell does not. */
      const enterMs = scaledMs(DURATION.long * 1000);
      const exitMs = scaledMs(DURATION.short * 1000);
      /* The gap starts closing 80ms after the card starts leaving, so the queue
         reads as emptying rather than as jumping. */
      const collapseDelay = toast.duration + scaledMs(80);

      /* The height has to be a number for WAAPI to interpolate it — `auto` is not
         a value it can animate from. Read once, before anything is written. */
      const wrapHeight = wrap.offsetHeight;

      const enter = card.animate(
        [
          { transform: `translateY(${slide}px)`, opacity: 0 },
          { transform: 'translateY(0px)', opacity: 1 },
        ],
        { duration: enterMs, easing: EASE.decelerate, fill: 'both' },
      );

      const exit = card.animate(
        [
          { transform: 'translateY(0px)', opacity: 1 },
          { transform: `translateY(${slideOut}px)`, opacity: 0 },
        ],
        /* `forwards`, never `both`. A backwards fill puts an animation in effect
           during its *delay* phase, and script-created animations resolve in
           creation order — so this one's 0% keyframe replaced `enter`'s animated
           values from the first frame and the entrance never appeared. Same
           mechanism `lib/ripple.ts` documents from the other side. */
        { duration: exitMs, delay: toast.duration, easing: EASE.accelerate, fill: 'forwards' },
      );

      const collapse = wrap.animate(
        [{ height: `${wrapHeight}px` }, { height: '0px' }],
        /* `forwards` for the same reason, and here it costs something extra: a
           backwards fill would pin the wrapper to its mount-time height for the
           whole dwell, so a late font swap or a reflow to two lines overflowed
           the box. */
        { duration: exitMs, delay: collapseDelay, easing: EASE.accelerate, fill: 'forwards' },
      );

      /* The collapse is the last thing to finish, so it owns the dismissal.
         `finished` rejects on `cancel()` — what the cleanup does on unmount — so
         the rejection handler must be a no-op rather than a second `onClose`. */
      collapse.finished.then(
        () => onClose(toast.id),
        () => {},
      );

      return () => {
        enter.cancel();
        exit.cancel();
        collapse.cancel();
      };
    },
    /* Mount only, and legitimately: `ToastItem` is keyed by `toast.id`, `toast`
       is never mutated, and `onClose` is a `useCallback([])`. */
    // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed by toast.id
    [],
  );

  const style = severityStyles[toast.type];

  return (
    <div ref={wrapRef} className="pointer-events-auto overflow-hidden">
      <div
        /* M3's snackbar, by its own tokens: extra-small corner (4dp), `body-medium`
           for the message, elevation level 3, and a cap so a long sentence wraps.
           The container stays a `*-fill` tone rather than the spec's
           `inverse-surface` — the documented divergence at the top of this file:
           that role flips between schemes, so the same message would arrive as a
           dark chip or a light one depending on the theme. */
        className={`${style.bg} text-on-fill mb-3 flex max-w-140 min-h-12 items-center gap-3 rounded-xs px-4 py-2 shadow-e3`}
      >
        <span className="shrink-0 [&>svg]:block" aria-hidden="true">
          {style.icon}
        </span>
        <span className="text-body-m">{toast.message}</span>
      </div>
    </div>
  );
}

interface ToastProps {
  message: string;
  type?: ToastType;
  duration?: number;
  onClose?: () => void;
}

export default function Toast({ message, type = 'success', duration = 3000, onClose }: ToastProps) {
  useEffect(() => {
    showToast(message, type, duration);
    const timer = setTimeout(() => {
      if (onClose) onClose();
    }, duration);
    return () => clearTimeout(timer);
  }, [message, type, duration, onClose]);

  return null;
}
