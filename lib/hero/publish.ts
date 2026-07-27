'use client';

import { imageHeroController } from './controller';

/**
 * Bounded idle wait. Long enough to yield a slice to an in-progress gesture,
 * short enough that content never visibly lands late on a busy main thread.
 */
const IDLE_TIMEOUT_MS = 240;

export type PublishOptions = {
  /** Yield an idle slice before publishing. Skip for cheap, latency-sensitive work. */
  idle?: boolean;
  /** Additional gate on top of "no transition is running". */
  canPublish?: () => boolean;
};

/**
 * Run `callback` once the Hero system can absorb the work.
 *
 * Mounting detail content is the single most expensive thing on this page, so it
 * must not land inside a flight's frame budget or steal the first event of a
 * newly started wheel/touch stream. This re-arms from the controller's runtime
 * signal and from visibility changes rather than polling, and publishes on the
 * first frame after the transition settles.
 */
export function publishWhenHeroSettled(
  callback: () => void,
  { idle = true, canPublish }: PublishOptions = {},
) {
  const gate = canPublish ?? (() => imageHeroController.isPublicationQuiet());
  const blocked = () => document.visibilityState !== 'visible' || !gate();

  let cancelled = false;
  let fired = false;
  let firstFrame = 0;
  let secondFrame = 0;
  let idleCallback = 0;

  const clearScheduled = () => {
    if (firstFrame) cancelAnimationFrame(firstFrame);
    if (secondFrame) cancelAnimationFrame(secondFrame);
    if (idleCallback) window.cancelIdleCallback(idleCallback);
    firstFrame = 0;
    secondFrame = 0;
    idleCallback = 0;
  };

  const finish = () => {
    idleCallback = 0;
    if (cancelled || fired || blocked()) return;
    fired = true;
    releaseRuntime();
    document.removeEventListener('visibilitychange', schedule);
    callback();
  };

  function schedule() {
    clearScheduled();
    if (cancelled || fired || blocked()) return;
    // Two frames: let the transition's own frame commit and paint first.
    firstFrame = requestAnimationFrame(() => {
      firstFrame = 0;
      secondFrame = requestAnimationFrame(() => {
        secondFrame = 0;
        if (cancelled || fired || blocked()) return;
        if (idle && 'requestIdleCallback' in window) {
          idleCallback = window.requestIdleCallback(finish, { timeout: IDLE_TIMEOUT_MS });
        } else {
          finish();
        }
      });
    });
  }

  const releaseRuntime = imageHeroController.subscribeRuntime(schedule);
  document.addEventListener('visibilitychange', schedule);
  schedule();

  return () => {
    cancelled = true;
    clearScheduled();
    releaseRuntime();
    document.removeEventListener('visibilitychange', schedule);
  };
}
