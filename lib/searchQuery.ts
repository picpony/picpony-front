/**
 * The Derpibooru query string, as a pure function of the browsing settings — no
 * `'use client'`, no imports, and no `localStorage` read. It has to be reachable
 * and produce identical output on the server (which renders the first page of the
 * home feed and recovers the settings from a cookie in `lib/feed.server.ts`) and
 * on the client (`buildSearchQuery` in `lib/api/client.ts`, a one-line wrapper that
 * supplies `getBrowsingSettings()`): one copy of the rules, two input sources.
 */

export interface QuerySettings {
  contentFilter: string;
  banAnthro: boolean;
  onlyPony: boolean;
  /** Already trimmed and lower-cased by the caller. */
  hiddenTags: string[];
}

/**
 * Note what is *not* an input: `banDiscomfort` — part of the browsing fingerprint
 * (so it still partitions the cache) but never part of the query; it is applied
 * elsewhere.
 */
export function buildSearchQueryFrom(s: QuerySettings, search?: string): string {
  let tags = '';

  if (s.contentFilter !== 'developer') {
    switch (s.contentFilter) {
      case 'safe':
        tags = '-suggestive, -explicit, -questionable, -grotesque, -grimdark';
        break;
      case 'spoilers':
        tags = '-explicit, -questionable, -grotesque, -grimdark';
        break;
    }
  }

  if (s.banAnthro) {
    tags = tags ? `${tags}, -anthro, -humanized` : '-anthro, -humanized';
  }

  if (s.onlyPony) {
    tags = tags ? `${tags}, pony` : 'pony';
  }

  const blockNegations = s.hiddenTags.filter(Boolean).map((t) => `-${t}`);
  if (blockNegations.length > 0) {
    tags = tags ? `${tags}, ${blockNegations.join(', ')}` : blockNegations.join(', ');
  }

  if (!tags && s.contentFilter !== 'developer') {
    tags = '-suggestive, -explicit, -questionable, -grotesque, -grimdark, pony';
  }

  if (search) {
    tags = tags ? `${search}, ${tags}` : search;
  }

  /* Developer mode with no extra filter leaves an empty keyword, which Derpibooru
     treats as "unspecified"; `*` (the old frontend's "everything") keeps it explicit. */
  return encodeURIComponent(tags || '*');
}

/**
 * The fingerprint a device with no stored settings produces.
 *
 * **This must equal `browsingFingerprint()`'s output for a fresh browser**, field for field:
 * `contentFilter` defaults to `safe`, `banAnthro` and `onlyPony` to false (`-`), `banDiscomfort`
 * to **true** (`d` — note the odd one out; its `LS_KEYS` read is `!== 'false'`), and no blocked
 * tags. An *absent* cookie and a *default* cookie have to produce the same cache key, or the
 * server keys a first-time visitor's feed on `''` while their browser keys the identical query
 * on `safe|-|d|-|` and the seed does not apply.
 */
export const DEFAULT_BROWSING_FINGERPRINT = 'safe|-|d|-|';

/**
 * The six sort fields the UI offers, and the only ones allowed to reach an upstream
 * URL. The value arrives from a **cookie**, and an unvalidated `sf=${sort}` once let
 * a crafted cookie append two parameters of the attacker's choosing — after the
 * safe-content `q=` — to a request *the server* makes, defeating the content filter.
 * An allowlist rather than escaping, because the set is closed and tiny.
 */
export const SORT_FIELDS = [
  'created_at',
  'updated_at',
  'score',
  'wilson_score',
  'relevance',
  'random',
] as const;

export function parseSortField(raw: string | undefined): string {
  return raw && (SORT_FIELDS as readonly string[]).includes(raw) ? raw : 'created_at';
}

/**
 * Bound a fingerprint cookie before it reaches a cache key. Not about injection
 * (`buildSearchQueryFrom` encodes every field) — about cache hygiene: Next's Data
 * Cache persists to disk, so a client looping a fresh cookie per request evicts every
 * real entry. A real fingerprint is five short fields plus a tag list; 512 characters
 * is far above anything the UI can produce and far below anything worth caching.
 */
const MAX_FINGERPRINT_LENGTH = 512;

export function parseFingerprintCookie(raw: string | undefined): string {
  if (!raw || raw.length > MAX_FINGERPRINT_LENGTH) return DEFAULT_BROWSING_FINGERPRINT;
  return raw;
}

/**
 * The inverse of `browsingFingerprint()` in `lib/resources.ts`: `filter|a|d|p|tag,tag`.
 * The cookie holds exactly what the client's key function produced, so the two can
 * never disagree about the format; an unrecognised or absent cookie yields the
 * defaults — what a visitor who has never opened /settings has anyway.
 */
export function parseBrowsingFingerprint(raw: string | undefined): QuerySettings {
  const [contentFilter = 'safe', anthro = '-', , pony = '-', hidden = ''] = (raw ?? '').split('|');
  return {
    contentFilter,
    banAnthro: anthro === 'a',
    onlyPony: pony === 'p',
    hiddenTags: hidden ? hidden.split(',').filter(Boolean) : [],
  };
}
