'use client';

import { useCallback, useEffect, useState } from 'react';
import { usePathname } from 'next/navigation';
import { useBackgroundSearchParams } from '@/components/BackgroundLocation';
import { pageParam } from '@/lib/favorites';

/**
 * The entry's own history state minus Next's two markers: passed through, they tell Next's
 * patched `replaceState` the write is its own and it skips updating `useSearchParams`; dropped,
 * Next copies its tree back in, and the entry keeps any marker another layer put on it (the
 * home gallery's writer, `replaceHomeUrl`, does the same).
 */
function entryState(): Record<string, unknown> {
  const own: Record<string, unknown> = {};
  const state = window.history.state as Record<string, unknown> | null;
  for (const [key, value] of Object.entries(state ?? {})) {
    if (key !== '__NA' && key !== '_N' && key !== '__PRIVATE_NEXTJS_INTERNALS_TREE') own[key] = value;
  }
  return own;
}

interface PageNav {
  /** The page on screen. */
  page: number;
  /** The address's page as last seen. */
  seen: number;
  /** The page the address holds because this screen wrote it (or adopted it). */
  written: number;
}

/**
 * A paged route's page, in its address and on screen (C1: `?page=` keeps a reload and a shared
 * link on the page, and a turn **replaces** the entry, so Back leaves the list).
 *
 * - **An address the screen did not write is adopted** — Back or Forward onto the entry, a link —
 *   compared with the one last seen, so a page the screen turned in the background (a return
 *   flight turning the list to its card while the picture's address is current) is not undone.
 * - **What is on screen is written back** once the route's own entry is current, a task later,
 *   and not while `hold` is set: a selection mode owns a history entry above the route's, and a
 *   write under it would replace that entry rather than the route's.
 */
export function useAddressPage(route: string, hold: boolean): [number, (page: number) => void] {
  const params = useBackgroundSearchParams();
  const pathname = usePathname();
  const urlPage = pageParam(params.get('page'));
  const [nav, setNav] = useState<PageNav>({ page: urlPage, seen: urlPage, written: urlPage });
  if (urlPage !== nav.seen) {
    setNav(urlPage === nav.written ? { ...nav, seen: urlPage } : { page: urlPage, seen: urlPage, written: urlPage });
  }

  const own = pathname === route;
  const { page, written } = nav;
  useEffect(() => {
    if (!own || hold || page === written) return;
    const timer = window.setTimeout(() => {
      if (window.location.pathname !== route) return;
      const search = new URLSearchParams(window.location.search);
      if (page > 1) search.set('page', String(page));
      else search.delete('page');
      const query = search.toString();
      setNav((current) => ({ ...current, written: page }));
      window.history.replaceState(entryState(), '', query ? `${route}?${query}` : route);
    }, 0);
    return () => window.clearTimeout(timer);
  }, [own, hold, page, written, route]);

  const setPage = useCallback((next: number) => setNav((current) => ({ ...current, page: Math.max(1, next) })), []);
  return [page, setPage];
}
