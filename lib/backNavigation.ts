'use client';

import { useCallback } from 'react';
import { useRouter } from 'next/navigation';

/**
 * The in-page back affordance and Esc, for screens reached from somewhere else in the app.
 *
 * `router.back()` alone is only right when the previous history entry is this app's. On a cold
 * entry — a shared link, a new tab, a bookmark — it left the app (or, in a fresh tab, did
 * nothing at all), and arriving from another site it returned to that site: the app's own
 * arrow was the way *out*. So the back action asks first, and with no in-app entry behind it
 * goes **up** instead, to the screen's parent, replacing the current entry — "back" on a
 * screen you did not come to from anywhere means "to where this screen lives".
 */

/** The Navigation API surface this needs; TypeScript's DOM lib does not have it yet. */
type NavigationLike = {
  canGoBack?: boolean;
  currentEntry?: { index?: number } | null;
};

/* The fallback for engines without the Navigation API: whether this document has seen a
   client-side route change. Coarser than the API (it cannot tell that a traversal has since
   walked back to the first entry), and only ever consulted where the API is missing. */
let sawInAppNavigation = false;

/** Called by the shell's route-scroll owner on every client-side pathname change. */
export function noteInAppNavigation(): void {
  sawInAppNavigation = true;
}

/**
 * Whether the entry behind this one belongs to the app. `navigation.entries()` lists only the
 * same-origin run around the current entry, so a previous entry in it is by construction this
 * app's — including one from an earlier document load, which a module flag cannot see.
 */
export function canGoBackInApp(): boolean {
  if (typeof window === 'undefined') return false;
  const nav = (window as unknown as { navigation?: NavigationLike }).navigation;
  if (nav && typeof nav.canGoBack === 'boolean') return nav.canGoBack;
  if (nav?.currentEntry && typeof nav.currentEntry.index === 'number') {
    return nav.currentEntry.index > 0;
  }
  return sawInAppNavigation;
}

/**
 * The back action for a screen whose parent is `parentHref`: back through history when the
 * entry behind is the app's, otherwise up to the parent in place of this entry. Stable across
 * renders for a given parent, so it can be handed to `useEscapeBack` and `PageBack` alike.
 */
export function useBackOrParent(parentHref: string): () => void {
  const router = useRouter();
  return useCallback(() => {
    if (canGoBackInApp()) router.back();
    else router.replace(parentHref, { scroll: false });
  }, [router, parentHref]);
}
