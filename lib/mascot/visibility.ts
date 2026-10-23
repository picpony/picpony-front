'use client';
import { useSyncExternalStore } from 'react';
import { usePathname } from 'next/navigation';
import { hasModalLayer, subscribeModalLayers } from '@/lib/overlay';
import { getImageHeroRuntime, subscribeImageHeroRuntime } from '@/lib/hero/runtime';

function subscribeVisible(listener: () => void) {
  document.addEventListener('visibilitychange', listener);
  return () => document.removeEventListener('visibilitychange', listener);
}
export const useDocumentVisible = () => useSyncExternalStore(subscribeVisible, () => !document.hidden, () => false);
/* The keyboard inset and the lightbox's presence are cached and refreshed only by their own
   events. `useSyncExternalStore` calls `getSnapshot` on every render of every subscriber (and
   again after each commit), and reading `innerHeight`/`visualViewport` there forced a layout
   inside React's render: ~70ms at 4× CPU across a hero open, traced, all of it in the commits
   that mount the detail route. */
function viewportBottom() {
  const viewport = window.visualViewport;
  return viewport ? Math.max(0, Math.round(window.innerHeight - viewport.height - viewport.offsetTop)) : 0;
}
let keyboardInset = 0;
const viewportListeners = new Set<() => void>();
const updateKeyboardInset = () => {
  const next = viewportBottom();
  if (next === keyboardInset) return;
  keyboardInset = next;
  viewportListeners.forEach((listener) => listener());
};
function subscribeViewport(listener: () => void) {
  if (viewportListeners.size === 0) {
    keyboardInset = viewportBottom();
    window.visualViewport?.addEventListener('resize', updateKeyboardInset);
    window.visualViewport?.addEventListener('scroll', updateKeyboardInset);
    window.addEventListener('resize', updateKeyboardInset);
  }
  viewportListeners.add(listener);
  return () => {
    viewportListeners.delete(listener);
    if (viewportListeners.size > 0) return;
    window.visualViewport?.removeEventListener('resize', updateKeyboardInset);
    window.visualViewport?.removeEventListener('scroll', updateKeyboardInset);
    window.removeEventListener('resize', updateKeyboardInset);
  };
}
export const useKeyboardInset = () => useSyncExternalStore(subscribeViewport, () => keyboardInset, () => 0);
let lightboxOpen = false;
const mediaListeners = new Set<() => void>();
let mediaObserver: MutationObserver | null = null;
function subscribeMedia(listener: () => void) {
  if (!mediaObserver) {
    lightboxOpen = !!document.querySelector('.yarl__portal');
    mediaObserver = new MutationObserver(() => {
      const next = !!document.querySelector('.yarl__portal');
      if (next === lightboxOpen) return;
      lightboxOpen = next;
      mediaListeners.forEach((notify) => notify());
    });
    mediaObserver.observe(document.body, { childList: true });
  }
  mediaListeners.add(listener);
  return () => {
    mediaListeners.delete(listener);
    if (mediaListeners.size > 0 || !mediaObserver) return;
    mediaObserver.disconnect();
    mediaObserver = null;
  };
}
/**
 * Whether the companions exist (`present`: the document is on screen) and whether something has the
 * screen instead of them (`away`: a modal layer, a picture, the lightbox, the on-screen keyboard, a
 * picture's own page, the admin console). Away, the mascot fades and the ponies pause in place.
 *
 * **A route change and a flight are neither.** The companions are shell chrome present on both sides
 * of a navigation; this was `isScreenQuiet`, which is false for every route transit and hero
 * transition, so the mascot blinked out and back on each navigation and the ponies' frame was torn
 * down and rebuilt (M1-034 / M1-038). That predicate is for the app's own interruptions, which wait
 * for the user to be between tasks — not for hiding chrome.
 */
export function useCompanionPresence(): { present: boolean; away: boolean } {
  const pathname = usePathname();
  const present = useDocumentVisible();
  const modal = useSyncExternalStore(subscribeModalLayers, hasModalLayer, () => false);
  const media = useSyncExternalStore(subscribeImageHeroRuntime, () => getImageHeroRuntime().imageId !== null, () => false);
  const lightbox = useSyncExternalStore(subscribeMedia, () => lightboxOpen, () => false);
  const keyboard = useKeyboardInset() > 80;
  const away = modal || media || lightbox || keyboard || pathname.startsWith('/pic/') || pathname.startsWith('/admin');
  return { present, away };
}
