import { PICPONY_API_BASE, PICPONY_API_ORIGIN } from '@/lib/constants';
import { cacheSeconds, createServerMemo } from '@/lib/serverMemo';
import { parseBlockFilters, DEFAULT_BLOCK_FILTERS, type BlockFilters } from '@/lib/blockFilters';

const REVALIDATE_SECONDS = 30 * 60;
const UPSTREAM = process.env.PICPONY_UPSTREAM_ORIGIN || PICPONY_API_ORIGIN;
export const BLOCK_FILTERS_CACHE_TAG = 'picpony-block-filters';
let generation = 0;

/** Public definitions shared by the layout policy and home feed. In-flight coalescing is
 * essential: the layout and page render concurrently, and both need the same rule version. */
const read = createServerMemo({
  ttlMs: REVALIDATE_SECONDS * 1000,
  keyOf: () => 'public-filters',
  load: async (): Promise<BlockFilters | null> => {
    try {
      const response = await fetch(`${UPSTREAM}${PICPONY_API_BASE}?action=get_block_tags`, {
        signal: AbortSignal.timeout(1500),
        next: { revalidate: cacheSeconds(REVALIDATE_SECONDS), tags: [BLOCK_FILTERS_CACHE_TAG] },
      });
      if (!response.ok) return null;
      return parseBlockFilters(await response.json());
    } catch {
      return null;
    }
  },
});

export async function readBlockFilters(): Promise<BlockFilters> {
  const started = generation;
  const result = await read();
  /* A read begun before a successful edit cannot seed the old rules after the edit. */
  return started === generation ? result ?? DEFAULT_BLOCK_FILTERS : readBlockFilters();
}

export function clearBlockFiltersMemo(): void {
  generation += 1;
  read.clear();
}
