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
      className="pointer-events-none fixed top-6 inset-x-4 z-toast mx-auto flex w-fit max-w-140 flex-col items-center"
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
      const enterMs = scaledMs(DURATION.long * 1000);
      const running: Animation[] = [];
      let active = true;

      if (tier !== 'off') {
        /* A short rise from the edge, with the shared 8px travel under reduced
           motion. Only the arrival owns these frames; a delayed exit with a
           backwards fill would replace them before that exit even starts. */
        const enter = card.animate(
          [
            { transform: `translateY(${tier === 'reduced' ? -8 : -16}px)`, opacity: 0 },
            { transform: 'none', opacity: 1 },
          ],
          { duration: enterMs, easing: EASE.decelerate, fill: 'backwards' },
        );
        running.push(enter);
        // The ordinary styles are the resting pose; no layer needs to stay
        // promoted throughout the reading time.
        enter.finished.then(() => enter.cancel(), () => {});
      }

      /* Dwell is reading time, so only the travel goes through `scaledMs`.
         Create the exit when it actually starts: a notification can wrap to more
         lines or the user can change the motion preference while reading it.
         Scheduling all three tracks at mount captured the old height and old
         preference for seconds, then clipped the still-visible message. */
      const timer = setTimeout(() => {
        if (motionTier() === 'off') {
          onClose(toast.id);
          return;
        }

        const wrapHeight = wrap.offsetHeight;
        const pose = getComputedStyle(card);
        const from = { transform: pose.transform, opacity: pose.opacity };
        const exitMs = scaledMs(DURATION.short * 1000);
        running.forEach((animation) => animation.cancel());

        const exit = card.animate(
          [from, { transform: 'translateY(-8px)', opacity: 0 }],
          { duration: exitMs, easing: EASE.accelerate, fill: 'forwards' },
        );
        /* Closing the gap is the same leg as the departing card, on its clock
           and curve. It begins 80ms into the fade so the queue empties smoothly.
           `forwards` leaves the wrapper at its natural height until then. */
        const collapse = wrap.animate(
          [{ height: `${wrapHeight}px` }, { height: '0px' }],
          { duration: exitMs, delay: scaledMs(80), easing: EASE.accelerate, fill: 'forwards' },
        );
        running.push(exit, collapse);
        collapse.finished.then(() => {
          if (active) onClose(toast.id);
        }, () => {});
      }, enterMs + toast.duration);

      return () => {
        active = false;
        clearTimeout(timer);
        running.forEach((animation) => animation.cancel());
      };
    },
    /* Mount only, and legitimately: `ToastItem` is keyed by `toast.id`, `toast`
       is never mutated, and `onClose` is a `useCallback([])`. */
    // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed by toast.id
    [],
  );

  const style = severityStyles[toast.type];

  return (
    <div ref={wrapRef} className="pointer-events-auto max-w-full overflow-hidden">
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
        <span className="text-body-m min-w-0 wrap-anywhere">{toast.message}</span>
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
