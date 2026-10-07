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
 * signature lives only in memory keys; cookies contain the five actual device preferences.
 * The public blacklist joins it when non-empty, so an administrator's change is a new key
 * rather than a cached page still showing the picture. */
export function withBlockFiltersFingerprint(
  preferences: string,
  filters: BlockFilters,
  blacklist: PublicBlacklist = [],
): string {
  const stable = BLOCK_FILTER_KEYS.map((key) => [...filters[key]].sort());
  const excluded = blacklist.length ? `|${[...blacklist].sort((a, b) => a - b).join(',')}` : '';
  return `${preferences.split('|').slice(0, 5).join('|')}|${JSON.stringify(stable)}${excluded}`;
}

// ---------------------------------------------------------------------------
// The public blacklist
// ---------------------------------------------------------------------------

/**
 * The site's public image blacklist (`api.php?action=get_public_blacklist`): picture ids an
 * administrator has pulled from every list. Public and anonymous like the filter definitions,
 * so it travels the same way — read on the server, inlined into the document, excluded in the
 * query (`-id:N`) rather than filtered from results, which would leave pages short and break
 * the "a full page means there is a next one" test every list uses.
 */
export type PublicBlacklist = readonly number[];

/** Sorted, de-duplicated positive ids; anything else in the payload is dropped. */
export function parsePublicBlacklist(raw: unknown): number[] | null {
  if (!raw || typeof raw !== 'object' || (raw as { success?: unknown }).success !== true) return null;
  const list = (raw as { blacklist?: unknown }).blacklist;
  if (!Array.isArray(list)) return null;
  const ids = new Set<number>();
  for (const value of list) {
    const id = typeof value === 'number' ? value : Number.parseInt(String(value), 10);
    if (Number.isSafeInteger(id) && id > 0) ids.add(id);
  }
  return [...ids].sort((a, b) => a - b);
}

let installedBlacklist: number[] | undefined;

export function installPublicBlacklist(ids: PublicBlacklist): void {
  if (typeof window === 'undefined') return;
  const previous = currentPublicBlacklist();
  installedBlacklist = [...ids];
  if (previous.join(',') !== installedBlacklist.join(',')) {
    window.dispatchEvent(new Event('settings_updated'));
  }
}

/** Read the inline answer before effects run, so the first client key matches the server seed. */
export function currentPublicBlacklist(): PublicBlacklist {
  if (typeof window !== 'undefined') {
    if (installedBlacklist) return installedBlacklist;
    const inline = window.__picponyRoutePolicy?.blacklist;
    if (Array.isArray(inline)) return inline;
  }
  return [];
}
