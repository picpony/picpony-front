import { cache } from 'react';
import { PICPONY_API_BASE, PICPONY_API_ORIGIN, SITE_STATUS_CACHE_TAG } from '@/lib/constants';
import { cacheSeconds } from '@/lib/serverMemo';
import { semanticConfigFrom, UNKNOWN_SEMANTIC_CONFIG, type SemanticSearchConfig, type SemanticStatus } from '@/lib/semanticConfig';
export { semanticConfigFrom } from '@/lib/semanticConfig';
export type { SemanticSearchConfig } from '@/lib/semanticConfig';

/**
 * Whether Chinese / natural-language search is on, and how long a parse takes — read on the
 * server so the screen knows before its first render, with no request of its own.
 *
 * **The same document, the same request** as the route policy and the maintenance switch
 * (`lib/route.server.ts`, `lib/maintenance.server.ts`): one URL and the same options, so the three
 * reads share one Data Cache entry — on a cold load the layout has already fetched it. On a
 * client navigation this page's read is served from that entry.
 *
 * **Fails open to "unknown"**, not "off": a status read that is slow or broken must not switch
 * off the site's headline search; the screen then asks the parse and learns from its answer.
 */

const SERVER_STATUS_TIMEOUT_MS = 1500;
const SERVER_STATUS_REVALIDATE_S = 30;
const UPSTREAM_ORIGIN = process.env.PICPONY_UPSTREAM_ORIGIN || PICPONY_API_ORIGIN;

/** Once per request, however many server components ask. */
export const readSemanticConfig = cache(async (): Promise<SemanticSearchConfig> => {
  try {
    const res = await fetch(`${UPSTREAM_ORIGIN}${PICPONY_API_BASE}?action=get_maintenance_status`, {
      next: { revalidate: cacheSeconds(SERVER_STATUS_REVALIDATE_S), tags: [SITE_STATUS_CACHE_TAG] },
      signal: AbortSignal.timeout(SERVER_STATUS_TIMEOUT_MS),
    });
    if (!res.ok) return UNKNOWN_SEMANTIC_CONFIG;
    const data = (await res.json()) as SemanticStatus;
    if (data?.success !== true) return UNKNOWN_SEMANTIC_CONFIG;
    return semanticConfigFrom(data);
  } catch {
    return UNKNOWN_SEMANTIC_CONFIG;
  }
});
