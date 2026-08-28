/**
 * The Derpibooru query string, as a pure function of the browsing settings.
 *
 * Extracted from `buildSearchQuery` in `lib/api/client.ts`, which reads those settings out of
 * `localStorage` at call time. That is fine on the client and impossible on the server, and the
 * server now needs to build the same query — it renders the first page of the home feed so the
 * HTML arrives with pictures in it.
 *
 * So the *derivation* moved here and the *reading* stayed there: `buildSearchQuery` is now a
 * one-line wrapper that supplies `getBrowsingSettings()`, and `lib/feed.server.ts` supplies the
 * same values recovered from a cookie. One copy of the rules, two sources for the inputs.
 *
 * No imports and no `'use client'`, deliberately: this has to be reachable from both a client
 * bundle and a server module without dragging either one's dependencies into the other.
 */

export interface QuerySettings {
  contentFilter: string;
  banAnthro: boolean;
  onlyPony: boolean;
  /** Already trimmed and lower-cased by the caller. */
  hiddenTags: string[];
}

/**
 * Note what is *not* an input: `banDiscomfort`. It is part of the browsing fingerprint — so it
 * still partitions the cache — but it has never been part of the query; it is applied elsewhere.
 * Worth stating, because a fingerprint field with no corresponding query term looks like an
 * omission when you are reconstructing one from the other.
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

  /* Developer mode with no extra filter leaves an empty keyword, which Derpibooru treats as
     "unspecified"; the old frontend used `*` to mean "everything" and this keeps that. */
  return encodeURIComponent(tags || '*');
}

/**
 * The fingerprint a device with no stored settings produces.
 *
 * **This must equal `browsingFingerprint()`'s output for a fresh browser**, field for field:
 * `contentFilter` defaults to `safe`, `banAnthro` and `onlyPony` to false (`-`), `banDiscomfort`
 * to **true** (`d` — note the odd one out; its `LS_KEYS` read is `!== 'false'`), and no blocked
 * tags.
 *
 * It exists because an *absent* cookie and a *default* cookie have to produce the same cache key.
 * Without it the server keys a first-time visitor's feed on `''` while their browser keys the
 * identical query on `safe|-|d|-|` — the seed then does not apply, and every first load pays an
 * extra request to fetch what the server had already fetched. Measured in `npm run net:audit`
 * as the home feed's own read falling from round 1 to round 2.
 */
export const DEFAULT_BROWSING_FINGERPRINT = 'safe|-|d|-|';

/**
 * The six sort fields the UI offers, and the only ones allowed to reach an upstream URL.
 *
 * This exists because the value arrives from a **cookie** now. `sf=${sort}` was interpolated
 * unvalidated and unencoded, so a cookie of
 * `created_at&filter_id=56027&q=*` appended two parameters of the attacker's choosing to a
 * request *the server* makes — and both landed after the safe-content `q=`, with 56027 being
 * this codebase's own id for "no filter". The result was `/`'s HTML server-rendered with the
 * content filter defeated, reachable by the visitor themselves or by cookie-tossing from any
 * sibling host. An allowlist rather than escaping, because the set is closed and tiny.
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
 * Bound a fingerprint cookie before it reaches a cache key.
 *
 * The value itself is safe in the URL (`buildSearchQueryFrom` encodes every field it parses
 * out), so this is not about injection — it is about the two server caches it *keys*. The memo
 * holds eight entries and Next's Data Cache persists to disk, so a client looping a fresh
 * cookie per request evicts every real entry and turns each `GET /` into its own upstream
 * fetch. A real fingerprint is five short fields plus a tag list; 512 characters is far above
 * anything the UI can produce and far below anything worth caching.
 */
const MAX_FINGERPRINT_LENGTH = 512;

export function parseFingerprintCookie(raw: string | undefined): string {
  if (!raw || raw.length > MAX_FINGERPRINT_LENGTH) return DEFAULT_BROWSING_FINGERPRINT;
  return raw;
}

/**
 * The inverse of `browsingFingerprint()` in `lib/resources.ts`: `filter|a|d|p|tag,tag`.
 *
 * Parsing rather than storing the five fields separately keeps the derivation in one place — the
 * cookie holds exactly what the client's key function produced, so the two can never disagree
 * about the format. An unrecognised or absent cookie yields the defaults, which is what a visitor
 * who has never opened /settings has anyway.
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
