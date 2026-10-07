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
function subscribeViewport(listener: () => void) {
  window.visualViewport?.addEventListener('resize', listener);
  window.visualViewport?.addEventListener('scroll', listener);
  window.addEventListener('resize', listener);
  return () => {
    window.visualViewport?.removeEventListener('resize', listener);
    window.visualViewport?.removeEventListener('scroll', listener);
    window.removeEventListener('resize', listener);
  };
}
function viewportBottom() {
  const viewport = window.visualViewport;
  return viewport ? Math.max(0, Math.round(window.innerHeight - viewport.height - viewport.offsetTop)) : 0;
}
export const useKeyboardInset = () => useSyncExternalStore(subscribeViewport, viewportBottom, () => 0);
function subscribeMedia(listener: () => void) {
  const observer = new MutationObserver(listener);
  observer.observe(document.body, { childList: true });
  return () => observer.disconnect();
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
  const lightbox = useSyncExternalStore(subscribeMedia, () => !!document.querySelector('.yarl__portal'), () => false);
  const keyboard = useKeyboardInset() > 80;
  const away = modal || media || lightbox || keyboard || pathname.startsWith('/pic/') || pathname.startsWith('/admin');
  return { present, away };
}
