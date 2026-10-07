'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { legacySharedImageHref, legacySharedSearchHref } from '@/lib/searchState';
import { legacyFavoritesHref } from '@/lib/favorites';

/**
 * Renders nothing. The original front end shared a search as `/#mode=shared_search&user=&q=`
 * on the site's root — and its short links lead there too — so a link from before the move
 * lands on the home page with the search in a fragment the server never sees. This sends it on
 * to the search, with the sharer named the way this app's own links name them.
 *
 * Its picture links (`/#q=id:N`) go to the picture's own page, as a document load: a shared link
 * opens as a page, the way this app's own `/pic/N` links do, not as a viewer over a gallery the
 * recipient never opened. Its favourites links — a shared folder (`#mode=shared_faves`), a shared
 * privacy space (`#shared_privacy:`), its own favourites (`#mode=cloud_faves`) — go to the
 * favourites routes (`legacyFavoritesHref`).
 *
 * Mounted once in the root layout, where every cold load passes; it acts on the first load only,
 * since a fragment like that is only ever arrived at, never navigated to inside the app.
 */
export default function LegacySharedSearch() {
  const router = useRouter();
  useEffect(() => {
    if (window.location.pathname !== '/') return;
    const picture = legacySharedImageHref(window.location.hash);
    if (picture) {
      window.location.replace(picture);
      return;
    }
    const href = legacySharedSearchHref(window.location.hash) ?? legacyFavoritesHref(window.location.hash);
    if (href) router.replace(href, { scroll: false });
  }, [router]);
  return null;
}
