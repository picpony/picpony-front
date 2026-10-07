import { PICPONY_API_BASE, PICPONY_API_ORIGIN } from '@/lib/constants';
import type { ProfileUser } from '@/lib/resources';
import { isProfileId } from '@/lib/profiles';
import { cacheSeconds, createServerMemo } from '@/lib/serverMemo';

/**
 * A user's public profile, read on the server; the island takes it as `initial` and seeds it into
 * `userProfile` via `resource.seed()`. One read serves two callers per request — the layout's
 * `<title>` metadata and the page's profile header.
 *
 * Anonymous: `get_user_profile` takes a `user_id` and no token and returns what any visitor sees,
 * so it is shareable and the cache needs no partitioning beyond the id. Only the *header* moves —
 * the tabs underneath are client reads, keyed on what differs for the owner (see `userUploads`).
 *
 * Three answers. The record; `'missing'` when the backend says the user does not exist (its 404,
 * or an id that cannot be one) — the page then renders the route's not-found state, and the
 * layout names it; and `null` for anything else (a timeout, an outage), when the island falls
 * back to the client read, which reports the failure itself. Bounded by a timeout, and direct to
 * the origin rather than through `proxyFetch`, whose retry ladder and `ensureRoutePolicy()` await
 * are written for the browser — the rules `lib/route.server.ts` states.
 */

const TIMEOUT_MS = 2500;
/** Matches `userProfile`'s own TTL in `lib/resources.ts`, so both sides share one clock. */
const REVALIDATE_S = 300;

/**
 * The upstream origin, overridable: the harness stubs the backend by pointing
 * `PICPONY_UPSTREAM_ORIGIN` at a fixture server, and a hardcoded origin would reach past it — a
 * server read the net audit cannot see is one it cannot hold to a number.
 */
const UPSTREAM_ORIGIN = process.env.PICPONY_UPSTREAM_ORIGIN || PICPONY_API_ORIGIN;

export interface ProfileSeed {
  key: string;
  data: ProfileUser;
  generatedAt: number;
}

/** The backend's answer that the user does not exist. */
export const PROFILE_MISSING = 'missing';

/**
 * A process-local memo, and this is the read that needed the *promise* form: `generateMetadata`
 * and the page render concurrently, so a memo that only records a resolved value lets both miss
 * and both fetch. `createServerMemo` coalesces them (see `lib/serverMemo.ts`). Capped, because
 * unlike the team roster there is one of these per user. A not-found is retained like a record
 * (for the TTL); a failure is not retained at all.
 */
export const readUserProfile = createServerMemo({
  ttlMs: REVALIDATE_S * 1000,
  max: 16,
  keyOf: (id: string) => id,
  load: async (id: string): Promise<ProfileSeed | typeof PROFILE_MISSING | null> => {
    if (!isProfileId(id)) return PROFILE_MISSING;
    try {
      const res = await fetch(
        `${UPSTREAM_ORIGIN}${PICPONY_API_BASE}?action=get_user_profile&user_id=${encodeURIComponent(id)}`,
        { next: { revalidate: cacheSeconds(REVALIDATE_S) }, signal: AbortSignal.timeout(TIMEOUT_MS) },
      );
      /* The backend answers an unknown id with its HTML 404 page; that is its answer, not a
         fault. */
      if (res.status === 404) {
        void res.body?.cancel().catch(() => {});
        return PROFILE_MISSING;
      }
      if (!res.ok) return null;
      const data = (await res.json()) as { success?: boolean; user?: ProfileUser };
      if (!data?.success || !data.user) return null;

      /* The key is `userProfile.keyOf({ id })`, the bare id, spelled rather than imported:
         importing `lib/resources` would pull the whole client catalogue into the server bundle
         for one expression. If the key ever changes, this stops matching and the page falls back
         to a client read — the right direction to fail in. */
      return { key: id, data: data.user, generatedAt: Date.now() };
    } catch {
      return null;
    }
  },
});
