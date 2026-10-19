/** Public search rules from `GET /api/v1/filters/block-tags`. No account data lives here. */
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

/**
 * The backend's answer — `{tags: [{id, filter, tag}], filters: {<key>: [tag, …]}}`, every one of
 * the five keys present (an empty group is an empty list) — as the five groups, lower-cased. `null`
 * for a body that is not that answer (an error body, an old backend), so the caller keeps the
 * defaults rather than switching every filter off.
 */
export function parseBlockFilters(raw: unknown): BlockFilters | null {
  const filters = (raw as { filters?: unknown } | null)?.filters;
  if (!filters || typeof filters !== 'object' || Array.isArray(filters)) return null;
  const result = emptyFilters();
  for (const key of BLOCK_FILTER_KEYS) {
    const tags = (filters as Record<string, unknown>)[key];
    if (!Array.isArray(tags)) return null;
    for (const tag of tags as string[]) {
      const name = tag.trim().toLowerCase();
      if (name && !result[key].includes(name)) result[key].push(name);
    }
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
 * The site's public image blacklist (`GET /api/v1/image-blocklist`): picture ids an
 * administrator has pulled from every list. Public and anonymous like the filter definitions,
 * so it travels the same way — read on the server, inlined into the document, excluded in the
 * query (`-id:N`) rather than filtered from results, which would leave pages short and break
 * the "a full page means there is a next one" test every list uses.
 */
export type PublicBlacklist = readonly number[];

/** One page of the public blacklist as the backend sends it (anonymous: the ids alone). */
export interface PublicBlacklistPage {
  revision: number;
  blocks: number[];
  page: number;
  limit: number;
  total_count: number;
  has_more: boolean;
}

/** The most ids one page of the public blacklist carries (the backend's cap). */
export const PUBLIC_BLACKLIST_PAGE_LIMIT = 1000;

/**
 * The ids of a page, or `null` for a body that is not one. The backend sends them sorted and
 * unique; the pages of one read are joined by the reader, which sorts the whole.
 */
export function parsePublicBlacklist(raw: unknown): number[] | null {
  const blocks = (raw as { blocks?: unknown } | null)?.blocks;
  return Array.isArray(blocks) ? (blocks as number[]) : null;
}

/**
 * Every page of the public blacklist, read with `fetchPage` (one request per page of
 * `PUBLIC_BLACKLIST_PAGE_LIMIT`), sorted. `null` when any page could not be read: a partial list
 * would un-hide pictures that are pulled.
 */
export async function readWholeBlacklist(
  fetchPage: (page: number) => Promise<unknown>,
): Promise<number[] | null> {
  const ids = new Set<number>();
  for (let page = 1; ; page += 1) {
    const body = await fetchPage(page);
    const blocks = parsePublicBlacklist(body);
    if (!blocks) return null;
    for (const id of blocks) ids.add(id);
    if (!(body as PublicBlacklistPage).has_more) break;
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
