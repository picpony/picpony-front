'use client';

/**
 * When the app first painted something real.
 *
 * Dismissal is driven by the app, not by the splash animation's length: one module-scope
 * flag and a listener set, deliberately not a React context — the producer is the shell's
 * first committed frame and the consumer is a sibling of the whole tree, so a context would
 * re-render everything to deliver a boolean that flips once. The flag is monotonic (never
 * false again), which lets a late subscriber skip the overlay entirely.
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
