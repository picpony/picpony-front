import type { SiteStats } from '@/lib/api/stats';
import { cacheSeconds, createServerMemo } from '@/lib/serverMemo';
import { upstreamOrigin } from '@/lib/upstream.server';

/**
 * /stats's first paint, read on the server so the default seven-day window arrives with its
 * numbers instead of a full set of skeletons; the island seeds it through `resource.seed()` and
 * reads every other range itself.
 *
 * Public and anonymous, identical for every visitor, so there is no cache to partition — the
 * same contract as `lib/team.server.ts`: a bounded wait, `null` rather than a throw, and the
 * origin read directly, because the browser's `/api/v1` proxy exists for the session cookie an
 * anonymous read does not carry.
 */

/** Short: the last bucket is a count of records other people are still creating. */
const REVALIDATE_S = 60;

/** A missing seed falls back to the island's own read, so this must never hold the document. */
const TIMEOUT_MS = 2500;

/** The range the page opens on, and therefore the only key warmed here. */
const DEFAULT_RANGE = '7';

const UPSTREAM_ORIGIN = upstreamOrigin();

export interface StatsSeed {
  key: string;
  data: SiteStats;
  generatedAt: number;
}

export const readStatsSeed = createServerMemo({
  ttlMs: REVALIDATE_S * 1000,
  keyOf: () => DEFAULT_RANGE,
  load: async (): Promise<StatsSeed | null> => {
    try {
      const res = await fetch(`${UPSTREAM_ORIGIN}/api/v1/stats?range=${DEFAULT_RANGE}`, {
        next: { revalidate: cacheSeconds(REVALIDATE_S) },
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      if (!res.ok) return null;
      const data = (await res.json()) as SiteStats;
      /* Spelled rather than imported from `lib/resources`: the catalogue's key function is the
         fact this has to match, and importing it would pull the whole client catalogue into the
         server bundle for one string. A drift falls back to a client read, not a wrong answer. */
      return { key: DEFAULT_RANGE, data, generatedAt: Date.now() };
    } catch {
      return null;
    }
  },
});
