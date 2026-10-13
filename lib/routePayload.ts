'use client';

/**
 * A route's whole payload — its page as well as its layouts — warmed on intent, for a screen a
 * list row opens with a container transform: a forum thread, a picture over 浏览历史.
 *
 * A `<Link>` prefetches a dynamic route only down to its nearest `loading.tsx`, which here is the
 * root's, so the press itself paid the round trip for the page: a picture opened from a history row
 * waited for it with nothing moving, and a thread came back in two commits, the route's silhouette
 * and then the page. Warmed with the page, the route commits the page in one piece, as soon as the
 * press lands. The payloads are the server's render of a client page — nothing they hold is read
 * from the backend, so warming one counts no view and reads nothing a data warm would
 * (`lib/prefetchRoute.ts` is that, and keeps a thread's read to the press). Kept for the router's
 * static period (`staleTimes.static`), so a row the pointer comes back to is not asked for again.
 *
 * The shell hands its router over once: a component rendered per row must not subscribe to the
 * router to reach it (`useHeroLink` says why).
 */

let prefetch: ((href: string) => void) | null = null;

export function setRoutePayloadPrefetch(next: ((href: string) => void) | null) {
  prefetch = next;
}

/** Warms `href`'s page as well as its layouts. Safe to repeat; nothing before the shell mounts. */
export function prefetchRoutePayload(href: string) {
  prefetch?.(href);
}
