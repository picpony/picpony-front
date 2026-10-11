'use client';

import { motionTier, subscribeAppearance } from '@/lib/appearance';
import { getImageHeroRuntime, subscribeImageHeroRuntime } from '@/lib/hero/runtime';
import { saveDataRequested } from '@/lib/imageLoader';

/** A hover preview belongs only to the visible, active gallery. No geometry reads needed. */
function canPreview(video: HTMLVideoElement): boolean {
  return (
    video.isConnected &&
    document.visibilityState !== 'hidden' &&
    motionTier('image') === 'standard' &&
    !saveDataRequested() &&
    getImageHeroRuntime().imageId === null &&
    !video.closest('[inert], [hidden], [data-tab-pane]:not([data-tab-pane-active])')
  );
}

/**
 * A video's one hover, including a pending `play()`. The observers and subscriptions exist
 * only for this hover, never for every card in a gallery. Hiding the page/pane or reducing
 * motion ends it; becoming visible again cannot restart a preview the pointer has left.
 */
export function startCardVideoPreview(video: HTMLVideoElement): () => void {
  if (!canPreview(video)) return () => {};

  let stopped = false;
  const release: (() => void)[] = [];
  const stop = () => {
    if (stopped) return;
    stopped = true;
    for (const dispose of release) dispose();
    /* `pause` also cancels a pending play request, even before its promise has resolved. */
    video.pause();
    if (video.readyState >= 2) video.currentTime = 0.1;
  };
  const check = () => {
    if (!canPreview(video)) stop();
  };
  const onPause = () => {
    /* A previous hover's queued pause event can arrive after a new hover has played. */
    if (video.paused) stop();
  };

  release.push(subscribeAppearance(check), subscribeImageHeroRuntime(check));
  document.addEventListener('visibilitychange', check);
  release.push(() => document.removeEventListener('visibilitychange', check));
  video.addEventListener('pause', onPause);
  video.addEventListener('error', stop);
  release.push(() => {
    video.removeEventListener('pause', onPause);
    video.removeEventListener('error', stop);
  });

  /* A tab is kept mounted, and an overlay makes its background inert. Watch just these
     ancestor flags: observing an entire gallery's subtree would hear every image decode. */
  const ancestors = new MutationObserver(check);
  for (let element = video.parentElement; element; element = element.parentElement) {
    ancestors.observe(element, {
      attributes: true,
      attributeFilter: ['inert', 'hidden', 'data-tab-pane-active'],
    });
  }
  release.push(() => ancestors.disconnect());

  /* Scrolling need not move the pointer, and need not dispatch pointerleave. Only the playing
     card is watched here; its permanent near observer still owns loading the first frame. */
  if (typeof IntersectionObserver !== 'undefined') {
    const intersection = new IntersectionObserver((entries) => {
      if (entries.some((entry) => !entry.isIntersecting)) stop();
    });
    intersection.observe(video);
    release.push(() => intersection.disconnect());
  }

  const connection = (navigator as Navigator & { connection?: EventTarget }).connection;
  if (typeof connection?.addEventListener === 'function') {
    connection.addEventListener('change', check);
    release.push(() => connection.removeEventListener('change', check));
  }

  video.loop = true;
  void video.play().catch(stop);
  return stop;
}
