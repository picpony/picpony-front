import { PICPONY_API_BASE, PICPONY_API_ORIGIN } from '@/lib/constants';
import type { TeamMember } from '@/lib/resources';
import { cacheSeconds, createServerMemo } from '@/lib/serverMemo';

/**
 * /about's roster, read on the server so the page arrives with its content in it; the island
 * takes it as `initial` and seeds it into `teamMembers` via `resource.seed()`. The smallest
 * instance of the pattern: a public, tokenless read on a long TTL, identical for every visitor,
 * so there is no cache-partitioning question and no way for one visitor's answer to reach
 * another.
 *
 * Named `.server.ts` and never imported from a client component, per the `lib/route.server.ts`
 * convention (`server-only` is not a dependency here). Its rules apply verbatim:
 *
 * - **It may not slow the document down.** Bounded by a timeout, and `null` rather than a throw:
 *   no data is a state the island already handles by fetching it itself.
 * - **It goes direct to the origin.** `PICPONY_API_BASE` is relative so the *browser* routes
 *   through the API route handler, which rewrites the backend's `Secure` session cookie; Node's
 *   `fetch` rejects a relative URL, and there is no cookie to rewrite on an anonymous read.
 *
 * It also does **not** go through `proxyFetch`: that awaits the client-side `ensureRoutePolicy()`
 * and then runs a retry ladder across line switches — a document that can hang for a minute on a
 * slow upstream. The API lines route around the visitor's network; the server goes direct.
 */

/**
 * How long the document may wait. Longer than `lib/route.server.ts`'s 1500ms — a missing roster
 * falls back to a skeleton plus a client fetch, which is more visible than a missing route
 * policy — but short enough that a wedged upstream cannot hold the document; the cache below
 * means only the first request in each window can ever pay it.
 */
const TIMEOUT_MS = 2500;

/**
 * How long a fetched roster is reused across visitors. Matched to `teamMembers`' own TTL in
 * `lib/resources.ts` so both sides of the handoff share one clock: `seed` stamps the entry with
 * the server's `generatedAt`, so a cache hit that is already 29 minutes old goes stale on the
 * client a minute later, exactly as a client-side read of the same age would.
 */
const REVALIDATE_S = 30 * 60;

const UPSTREAM_ORIGIN = process.env.PICPONY_UPSTREAM_ORIGIN || PICPONY_API_ORIGIN;

export interface TeamSeed {
  key: string;
  data: TeamMember[];
  generatedAt: number;
}

/**
 * A process-local memo in front of Next's Data Cache. Explicit `next: { revalidate }` retains
 * responses despite upstream `no-store`; the memo also joins concurrent reads and keeps the
 * original generatedAt timestamp when the same seed is handed to another visitor. The footer
 * links to /about from every route, and prefetching that RSC payload runs this read too.
 *
 * Deliberately one entry, no invalidation: it holds a public list that changes when somebody
 * joins the team, and the worst case of a stale one is a name appearing half an hour late.
 */
export const readTeamMembers = createServerMemo({
  ttlMs: REVALIDATE_S * 1000,
  keyOf: () => 'all',
  load: async (): Promise<TeamSeed | null> => {
    try {
      /* No `&_t=${Date.now()}` cache-buster, unlike the client's `getTeamMembers`: that parameter
         defeats the *browser's* HTTP cache; here it would defeat Next's Data Cache, which is the
         entire point of this function. */
      const res = await fetch(`${UPSTREAM_ORIGIN}${PICPONY_API_BASE}?action=get_team_members`, {
        next: { revalidate: cacheSeconds(REVALIDATE_S) },
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      if (!res.ok) return null;
      const data = (await res.json()) as { success?: boolean; members?: TeamMember[] };
      if (!data?.success || !Array.isArray(data.members)) return null;
      /* `'all'` is `teamMembers.keyOf({})`, spelled rather than imported: importing
         `lib/resources` would pull the whole client catalogue — and every `lib/api` module it
         reaches — into the server bundle for one constant string. If the key changes, this stops
         matching and the page falls back to a client fetch: a silent loss of the optimisation,
         not a wrong answer. */
      return { key: 'all', data: data.members, generatedAt: Date.now() };
    } catch {
      /* A timeout, an offline upstream, an HTML error page — all mean "no seed", which the island
         already handles by reading it itself. Swallowed rather than logged: it would log on every
         hit. */
      return null;
    }
  },
});
