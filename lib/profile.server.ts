import { PICPONY_API_BASE, PICPONY_API_ORIGIN } from '@/lib/constants';
import type { ProfileUser } from '@/lib/resources';
import { cacheSeconds, createServerMemo } from '@/lib/serverMemo';

/**
 * A user's public profile, read on the server.
 *
 * Two callers, and folding them together is half the point. `app/user/[id]/layout.tsx` already
 * fetched this — for the `<title>` alone, discarding the rest — and `app/user/[id]/page.tsx` then
 * fetched it again from the browser to render the same name, avatar and level bar. One read now
 * serves both: the metadata takes the username and the page takes the whole record as a seed, so
 * the profile header arrives in the HTML and the browser's copy of that request disappears.
 *
 * Anonymous, like the home feed: `get_user_profile` takes a `user_id` and no token, and returns
 * what any visitor would see. So it is shareable across visitors and there is nothing to
 * partition the cache on beyond the id itself. The tabs underneath are a different matter —
 * `userUploads` is keyed on a token and differs for the owner — which is why only the *header*
 * moves to the server.
 *
 * The rules from `lib/route.server.ts` apply verbatim: bounded by a timeout, `null` on any
 * failure (the island falls back to the client read it has always done), and direct to the
 * origin rather than through `proxyFetch`, whose retry ladder and `ensureRoutePolicy()` await
 * are written for the browser.
 */

const TIMEOUT_MS = 2500;
/** Matches `userProfile`'s own TTL in `lib/resources.ts`, so both sides share one clock. */
const REVALIDATE_S = 300;

/**
 * `PICPONY_UPSTREAM_ORIGIN` rather than the constant alone.
 *
 * `app/user/[id]/layout.tsx` hardcoded `PICPONY_API_ORIGIN` here, which is why this read was
 * invisible to `npm run net:audit`: the harness stubs the upstream by pointing that variable at a
 * fixture server, and a hardcoded origin reaches past it to the real backend. A server read the
 * ledger cannot see is one that cannot be held to a number.
 */
const UPSTREAM_ORIGIN = process.env.PICPONY_UPSTREAM_ORIGIN || PICPONY_API_ORIGIN;

export interface ProfileSeed {
  key: string;
  data: ProfileUser;
  generatedAt: number;
}

/**
 * A process-local memo, and this is the read that needed the *promise* form of it.
 *
 * There are two callers per request — `generateMetadata` and the page — and Next renders them
 * concurrently, so a memo that only records a resolved value has both of them miss and both of
 * them fetch. `npm run net:audit` measured exactly that: the profile's server reads went from one
 * to two the moment the page started reading this as well. `createServerMemo` coalesces them, and
 * carries the rest of the reasoning (`lib/serverMemo.ts`).
 *
 * Capped, because unlike the team roster there is one of these per user.
 */
export const readUserProfile = createServerMemo({
  ttlMs: REVALIDATE_S * 1000,
  max: 16,
  keyOf: (id: string) => id,
  load: async (id: string): Promise<ProfileSeed | null> => {
    try {
      const res = await fetch(
        `${UPSTREAM_ORIGIN}${PICPONY_API_BASE}?action=get_user_profile&user_id=${encodeURIComponent(id)}`,
        { next: { revalidate: cacheSeconds(REVALIDATE_S) }, signal: AbortSignal.timeout(TIMEOUT_MS) },
      );
      if (!res.ok) return null;
      const data = (await res.json()) as { success?: boolean; user?: ProfileUser };
      if (!data?.success || !data.user) return null;

      /* The key is `userProfile.keyOf({ id })`, which is the bare id. Spelled rather than
         imported, because importing `lib/resources` would pull the whole client catalogue into
         the server bundle for one expression — and if that key ever changes, this stops matching
         and the page falls back to a client read, which is the right direction to fail in. */
      return { key: id, data: data.user, generatedAt: Date.now() };
    } catch {
      return null;
    }
  },
});
