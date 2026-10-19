import { cache } from 'react';
import { SITE_STATUS_CACHE_TAG } from '@/lib/constants';
import { cacheSeconds } from '@/lib/serverMemo';
import { semanticConfigFrom, UNKNOWN_SEMANTIC_CONFIG, type SemanticSearchConfig, type SemanticSearchSettings } from '@/lib/semanticConfig';
import { upstreamOrigin } from '@/lib/upstream.server';
export { semanticConfigFrom } from '@/lib/semanticConfig';
export type { SemanticSearchConfig } from '@/lib/semanticConfig';

/**
 * Whether Chinese / natural-language search is on, and how long a parse takes — read on the
 * server so the screen knows before its first render, with no request of its own.
 *
 * `GET /api/v1/semantic-searches/settings` is the backend's public projection of the switch and
 * the cloud model's timing (`semantic_search_mode`, `semantic_search_enabled`,
 * `semantic_cloud_enabled`, `semantic_cloud_has_key`, `semantic_cloud_timeout_ms`,
 * `semantic_search_estimate_ms` — the last `null` until the backend has timed a parse). It is
 * tagged with the site-status tag, so the proxy's revalidation after an administrator saves
 * `/admin/semantic-search` or `/admin/semantic-cloud` reaches it too.
 *
 * **Fails open to "unknown"**, not "off": a status read that is slow or broken must not switch
 * off the site's headline search; the screen then asks the parse and learns from its answer.
 */

const SERVER_STATUS_TIMEOUT_MS = 1500;
const SERVER_STATUS_REVALIDATE_S = 30;
const UPSTREAM_ORIGIN = upstreamOrigin();

/** Once per request, however many server components ask. */
export const readSemanticConfig = cache(async (): Promise<SemanticSearchConfig> => {
  try {
    const res = await fetch(`${UPSTREAM_ORIGIN}/api/v1/semantic-searches/settings`, {
      next: { revalidate: cacheSeconds(SERVER_STATUS_REVALIDATE_S), tags: [SITE_STATUS_CACHE_TAG] },
      signal: AbortSignal.timeout(SERVER_STATUS_TIMEOUT_MS),
    });
    if (!res.ok) return UNKNOWN_SEMANTIC_CONFIG;
    return semanticConfigFrom((await res.json()) as SemanticSearchSettings);
  } catch {
    return UNKNOWN_SEMANTIC_CONFIG;
  }
});
