/** Public search rules from api.php?action=get_block_tags. No account data lives here. */
export const BLOCK_FILTER_KEYS = ['safe', 'spoilers', 'banAnthro', 'banDiscomfort', 'onlyPony'] as const;
export type BlockFilterKey = typeof BLOCK_FILTER_KEYS[number];
export type BlockFilters = Record<BlockFilterKey, string[]>;

/** Offline fallback transcribed from the public, unauthenticated backend response on
 * 2026-09-12. These are the site's existing definitions, not a new moderation policy.
 * A successful server response replaces all five groups, including deliberately empty ones. */
export const DEFAULT_BLOCK_FILTERS: BlockFilters = {
  safe: ['explicit', 'questionable', 'suggestive', 'grotesque', 'grimdark', 'spoiler', 'islamic state', 'politics', 'semi-grimdark'],
  spoilers: ['explicit', 'questionable', 'grotesque', 'grimdark', 'islamic state'],
  banAnthro: ['anthro', 'humanized', 'morbidly obese'],
  banDiscomfort: ['overweight', 'obese', 'obesity', 'nightmare fuel', 'politics', 'watersports', 'poofy diaper'],
  onlyPony: ['pony', 'kirin', 'griffon', 'hippogriff', 'changeling', 'zebra'],
};

function emptyFilters(): BlockFilters {
  return { safe: [], spoilers: [], banAnthro: [], banDiscomfort: [], onlyPony: [] };
}

/** The API returns both a flat `tags` array and a `grouped` object. Accept either shape. */
export function parseBlockFilters(raw: unknown): BlockFilters | null {
  if (!raw || typeof raw !== 'object') return null;
  const payload = raw as Record<string, unknown>;
  if (payload.success !== true) return null;
  const result = emptyFilters();
  const add = (key: BlockFilterKey, value: unknown) => {
    if (typeof value !== 'string' || !value.trim()) return;
    const tag = value.trim().toLowerCase();
    if (!result[key].includes(tag)) result[key].push(tag);
  };
  if (Array.isArray(payload.tags)) {
    for (const row of payload.tags) {
      if (!row || typeof row !== 'object' || !BLOCK_FILTER_KEYS.includes(row.filter_key)) continue;
      add(row.filter_key, row.tag_name);
    }
    return result;
  }
  if (!payload.grouped || typeof payload.grouped !== 'object' || Array.isArray(payload.grouped)) return null;
  const grouped = payload.grouped as Record<string, unknown>;
  for (const key of BLOCK_FILTER_KEYS) {
    const rows = grouped[key];
    if (rows === undefined) continue;
    if (!Array.isArray(rows)) return null;
    for (const row of rows) add(key, typeof row === 'string' ? row : row?.tag_name);
  }
  return result;
}

let installed: BlockFilters | undefined;

export function installBlockFilters(filters: BlockFilters): void {
  if (typeof window === 'undefined') return;
  const previous = currentBlockFilters();
  installed = filters;
  if (withBlockFiltersFingerprint('', previous) !== withBlockFiltersFingerprint('', filters)) {
    window.dispatchEvent(new Event('settings_updated'));
  }
}

/** Read the inline answer before effects run, so the first client key matches the server seed. */
export function currentBlockFilters(): BlockFilters {
  if (typeof window !== 'undefined') {
    if (installed) return installed;
    const inline = window.__picponyRoutePolicy?.blockFilters;
    if (inline) return inline;
  }
  return DEFAULT_BLOCK_FILTERS;
}

/** Exact stable signature, not a hash: rule order cannot create a second cache entry. The
 * signature lives only in memory keys; cookies contain the five actual device preferences. */
export function withBlockFiltersFingerprint(preferences: string, filters: BlockFilters): string {
  const stable = BLOCK_FILTER_KEYS.map((key) => [...filters[key]].sort());
  return `${preferences.split('|').slice(0, 5).join('|')}|${JSON.stringify(stable)}`;
}
