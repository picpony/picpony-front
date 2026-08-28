import { PICPONY_API_BASE, PICPONY_API_ORIGIN } from '@/lib/constants';
import type { TeamMember } from '@/lib/resources';
import { cacheSeconds, createServerMemo } from '@/lib/serverMemo';

/**
 * /about's roster, read on the server so the page arrives with its content in it.
 *
 * The smallest possible instance of the pattern, which is why it is the first: the roster is a
 * public, tokenless read on a 30-minute TTL, identical for every visitor, and nothing about it
 * depends on a cookie, a session or a URL. So there is no cache-partitioning question and no way
 * for one visitor's answer to reach another — the two things that make server-side reads of the
 * *other* resources delicate.
 *
 * Named `.server.ts` and never imported from a client component, which is the convention
 * `lib/route.server.ts` already establishes here (the `server-only` package is not a dependency
 * of this repo). Shaped after that file, whose rules apply verbatim:
 *
 * - **It may not slow the document down.** `app/about/page.tsx` awaits this, and the upstream is
 *   reachable but slow (measured ~9s under load on the machine this was written on). Hence the
 *   timeout, and hence returning `null` rather than throwing: no data is a state the client
 *   already handles, because the island falls back to fetching it itself.
 * - **It goes direct to the origin.** `PICPONY_API_BASE` is relative so the *browser* routes
 *   through `app/api.php/[[...path]]/route.ts`, which rewrites the backend's `Secure` session
 *   cookie; Node's `fetch` rejects a relative URL outright, and there is no cookie to rewrite on
 *   an anonymous read anyway. This is the trap `app/user/[id]/layout.tsx` documents falling into.
 *
 * It also does **not** go through `proxyFetch`. That awaits `ensureRoutePolicy()` — a client-side
 * one-shot whose whole purpose is to gate the browser's first request — and then runs up to three
 * attempts across three line switches with a linear backoff between them. Against a slow upstream
 * that is a document that can hang for a minute. The API lines exist to route around *the
 * visitor's* network; the server has no such problem and takes the direct path.
 */

/**
 * How long the document may wait.
 *
 * Longer than `lib/route.server.ts`'s 1500ms because a missing roster is more visible than a
 * missing route policy — the page falls back to a skeleton and a client fetch — but still short
 * enough that a wedged upstream cannot hold the document. The cache below means only the first
 * request in each window can ever pay it.
 */
const TIMEOUT_MS = 2500;

/**
 * How long a fetched roster is reused across visitors.
 *
 * Matched to `teamMembers`' own TTL in `lib/resources.ts` so the two sides of the handoff share
 * one clock: `seed` stamps the entry with the server's `generatedAt`, so a cache hit that is
 * already 29 minutes old seeds an entry that goes stale on the client a minute later, exactly as
 * a client-side read of the same age would.
 */
const REVALIDATE_S = 30 * 60;

const UPSTREAM_ORIGIN = process.env.PICPONY_UPSTREAM_ORIGIN || PICPONY_API_ORIGIN;

export interface TeamSeed {
  key: string;
  data: TeamMember[];
  generatedAt: number;
}

/**
 * A process-local memo in front of Next's Data Cache, and it is not redundant.
 *
 * `next: { revalidate }` asks Next to cache the response, and Next honours an upstream
 * `Cache-Control: no-store` by declining to. This backend's headers are not ours to guarantee —
 * several of its actions already send `no-store` — so the `revalidate` below is a request, not a
 * promise.
 *
 * That distinction became load-bearing the moment this read moved to the server. The footer links
 * to /about from **every** route, Next prefetches the RSC payload of every visible `<Link>`, and
 * rendering that payload calls this function. So without a cache that cannot be overruled from
 * outside, one page view anywhere in the app becomes one upstream fetch of the team roster —
 * measured in `npm run net:audit`, which showed `get_team_members` leaving the server on `/policy`,
 * a screen that reads nothing.
 *
 * Deliberately one entry, no invalidation. It holds a public list that changes when somebody joins
 * the team, and the worst case for a stale one is a name appearing half an hour late.
 */
export const readTeamMembers = createServerMemo({
  ttlMs: REVALIDATE_S * 1000,
  keyOf: () => 'all',
  load: async (): Promise<TeamSeed | null> => {
    try {
      /* No `&_t=${Date.now()}` cache-buster, unlike the client's `getTeamMembers`. That parameter
         exists to defeat the *browser's* HTTP cache; here it would defeat Next's Data Cache, which
         is the entire point of this function — every request would be a fresh upstream round trip
         and the `revalidate` below would never hit. */
      const res = await fetch(`${UPSTREAM_ORIGIN}${PICPONY_API_BASE}?action=get_team_members`, {
        next: { revalidate: cacheSeconds(REVALIDATE_S) },
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      if (!res.ok) return null;
      const data = (await res.json()) as { success?: boolean; members?: TeamMember[] };
      if (!data?.success || !Array.isArray(data.members)) return null;
      /* `'all'` is `teamMembers.keyOf({})`. Spelled here rather than imported, because importing
         `lib/resources` would pull the whole client catalogue — and every `lib/api` module it
         reaches — into the server bundle for one constant string. If that key ever changes, this
         stops matching and the page falls back to a client fetch: a silent loss of the
         optimisation rather than a wrong answer, which is the right direction for it to fail in. */
      return { key: 'all', data: data.members, generatedAt: Date.now() };
    } catch {
      /* A timeout, an offline upstream, an HTML error page, a renamed action — all mean "no seed",
         which the island already handles by reading it itself. Swallowed rather than logged: it
         would log on every request of a site whose backend is briefly unhappy. */
      return null;
    }
  },
});
