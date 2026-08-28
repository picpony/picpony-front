'use client';

/**
 * When the app first painted something real.
 *
 * The splash (`components/LoadingOverlay.tsx`) used to dismiss on a *timer* — the length of
 * the wordmark's draw-on, plus the budget for the Lottie chunk that draws it, plus a hold.
 * That is ~1.8s of opaque `bg-surface` over content that was, on a warm load, ready in a
 * fraction of it. The overlay was the slowest thing on a cold start and it was covering an
 * app that had nothing left to wait for.
 *
 * So the dismissal is driven by the app instead of by the animation. One module-scope flag
 * and a listener set, deliberately not a React context: the producer is the shell's first
 * committed frame and the consumer is a sibling of the whole tree, so a context would put a
 * provider above both and re-render everything to deliver a boolean that flips once.
 *
 * The flag is monotonic — it never goes back to false — which is what lets a late subscriber
 * read it synchronously and skip the overlay entirely rather than fading one in to fade it
 * back out.
 */

let painted = false;
const listeners = new Set<() => void>();

/** True once the app has committed a frame with real content in it. */
export function isAppPainted() {
  return painted;
}

/**
 * Called once, from the shell, after the first commit has actually been presented.
 *
 * Idempotent, because the shell may remount in development's strict double-invoke and
 * because a second call must not re-notify a listener that has already torn down.
 */
export function markAppPainted() {
  if (painted) return;
  painted = true;
  for (const listener of listeners) listener();
  listeners.clear();
}

/** Subscribe until the flag flips. Returns the usual unsubscribe. */
export function subscribeAppPainted(listener: () => void) {
  if (painted) {
    listener();
    return () => {};
  }
  listeners.add(listener);
  return () => listeners.delete(listener);
}
