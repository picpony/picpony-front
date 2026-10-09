/**
 * The Derpibooru query string, as a pure function of the browsing settings — no
 * `'use client'`, no imports, and no `localStorage` read. It has to be reachable
 * and produce identical output on the server (which renders the first page of the
 * home feed and recovers the settings from a cookie in `lib/feed.server.ts`) and
 * on the client (`buildSearchQuery` in `lib/api/client.ts`, a one-line wrapper that
 * supplies `getBrowsingSettings()`): one copy of the rules, two input sources.
 *
 * The second half is the grammar /search reads the user's text with — its top-level
 * terms, the advanced filters it can show as controls, whether it is a natural-language
 * question for the semantic parse — and the same exclusion rules applied to a list of
 * pictures that did not come from a query (以图搜图). Pure for the same reason: the
 * rules are the query's, wherever the pictures come from.
 */

import {
  DEFAULT_BLOCK_FILTERS,
  withBlockFiltersFingerprint,
  type BlockFilters,
  type PublicBlacklist,
} from '@/lib/blockFilters';

export interface QuerySettings {
  contentFilter: string;
  banAnthro: boolean;
  banDiscomfort?: boolean;
  onlyPony: boolean;
  /** Already trimmed and lower-cased by the caller. */
  hiddenTags: string[];
}

/** Damaged preferences and unrecognised cookie values must keep the safe filter. */
export function parseContentFilter(raw: unknown): 'safe' | 'spoilers' | 'developer' {
  return raw === 'spoilers' || raw === 'developer' ? raw : 'safe';
}

/**
 * Removing the local exclusions does not disable Derpibooru's default filter.
 * Developer image reads use its Everything preset (56027), as the original frontend does.
 * Shared by SSR and the client, before a proxy wraps the URL; other endpoints are unchanged.
 */
export function withDerpiContentFilter(url: string, contentFilter: unknown): string {
  if (parseContentFilter(contentFilter) !== 'developer') return url;
  const target = new URL(url);
  if (!/\/(?:search\/images|images(?:\/(?:\d+|featured))?)$/.test(target.pathname)) return url;
  target.searchParams.set('filter_id', '56027');
  return target.toString();
}

/**
 * Escape a backend/admin tag before embedding it in Philomena's query grammar.
 *
 * The comma is escaped too (review P6-F7): Philomena reads a bare `,` as AND, so a rule's tag that
 * held one — `a, b`, typed into 屏蔽标签 as two tags at once — split into `-a AND \ b` inside every
 * visitor's search, the second half a required term. `\,` is the literal character; a real tag has
 * none, so nothing that worked changes.
 */
export function escapeTag(tag: string): string {
  return tag.replace(/([+\-=&|><!(){}[\]^"~*?:\\/\s,])/g, '\\$1');
}

/**
 * Make the user's text safe to wrap in the parentheses that scope the device filters to it.
 *
 * The grouping `(<text>), -explicit, …` is what makes an `OR` in the text belong to the text —
 * and one stray `)` broke out of it: `suggestive) OR (suggestive` built
 * `(suggestive) OR (suggestive), -suggestive, …` and returned fifty suggestive pictures in safe
 * mode, escaping every app-level exclusion; a plain typo (`twilight)`) failed with a 400 and a
 * 重试 that could never work. Three things can end the group early, and each is neutralised by
 * escaping it — Philomena reads `\(`, `\)` and `\"` as literal characters of a term:
 *
 * - an unterminated quote, which would swallow everything after it into one quoted term —
 *   including the exclusions. Escaped first, and the text rescanned: characters it had hidden
 *   are bare parentheses again;
 * - an unmatched parenthesis, either way round (outside quotes, not already escaped);
 * - a trailing lone backslash, which would escape the closing parenthesis. Doubled.
 *
 * **Quotes are read the way Philomena's lexer reads them** (review P4-F1). A `"` opens a quoted
 * term only where a term *starts* — at the beginning, after `,` `(` `)`, a negation (`-` `!`
 * `NOT `), an operator (` AND ` ` OR ` ` && ` ` || `) or a closed quoted term. Anywhere else it is
 * an ordinary character of the term (`x"y` is one tag), and the parentheses after it are live.
 * Treating every quote as a quote let `-x"), explicit OR (y"` through unchanged: the scan saw one
 * quoted run hiding both parentheses, Philomena saw `(-x") AND explicit OR (y" AND -explicit …)`
 * — explicit pictures in safe mode, and the public blacklist's `-id:N` bypassed, from a link
 * anyone can share. A mid-term quote is now escaped (it means the same literal character either
 * way), so no quote the scan skips over can be one Philomena does not.
 *
 * Balanced text is returned unchanged, so a valid advanced query means what it always meant.
 */
export function balanceUserQuery(text: string): string {
  let chars = Array.from(text);
  /* Rescanned after each quote it escapes (one per round, so this ends): an escaped quote turns
     what followed it back into term text, which can change what the next quote is. */
  for (;;) {
    const scan = scanQueryText(chars);
    if (scan.badQuote === -1) {
      const out = chars.map((ch, i) => (scan.unmatched.has(i) ? `\\${ch}` : ch)).join('');
      /* An odd run of backslashes at the very end escapes whatever follows — our `)`. */
      const trailing = /\\+$/.exec(out)?.[0].length ?? 0;
      return trailing % 2 === 1 ? `${out}\\` : out;
    }
    chars = [...chars.slice(0, scan.badQuote), '\\"', ...chars.slice(scan.badQuote + 1)];
  }
}

/** Philomena's operators between terms, each with the whitespace its lexer requires around it. */
const QUERY_OPERATOR = /^\s+(?:AND|OR|&&|\|\|)\s+/;
const QUERY_NOT = /^NOT\s+/;

/**
 * One pass over the user's text, after Philomena's lexer (`PhilomenaQuery.Parse.Lexer`): the
 * first quote that is not a terminated quoted term at a term start (`badQuote`, or -1), and the
 * parentheses — outside quoted terms, not escaped — that have no partner. `chars` holds single
 * characters, plus the `\"` pairs a previous round wrote.
 */
function scanQueryText(chars: readonly string[]): { badQuote: number; unmatched: Set<number> } {
  const unmatched = new Set<number>();
  /* Each open parenthesis, and whether it opened at a term start (a group for certain). */
  const open: { at: number; group: boolean }[] = [];
  const rest = (i: number) => chars.slice(i, i + 16).join('');
  let termStart = true;
  for (let i = 0; i < chars.length; i += 1) {
    const ch = chars[i];
    if (ch === '\\"') {
      termStart = false;
      continue;
    }
    if (termStart) {
      if (/\s/.test(ch) || ch === ',' || ch === '-' || ch === '!') continue;
      const not = QUERY_NOT.exec(rest(i));
      if (not) {
        i += not[0].length - 1;
        continue;
      }
      if (ch === '"') {
        let close = -1;
        for (let j = i + 1; j < chars.length; j += 1) {
          if (chars[j] === '\\') j += 1;
          else if (chars[j] === '"') {
            close = j;
            break;
          }
        }
        if (close === -1) return { badQuote: i, unmatched };
        i = close;
        continue;
      }
      if (ch === '(') {
        open.push({ at: i, group: true });
        continue;
      }
      if (ch === ')') {
        if (open.length) open.pop();
        else unmatched.add(i);
        continue;
      }
      termStart = false;
    }
    /* Inside a term: its text runs until a separator, an operator or a closing parenthesis. */
    if (ch === '\\') {
      i += 1;
      continue;
    }
    if (ch === '"') return { badQuote: i, unmatched };
    if (ch === ',') {
      termStart = true;
      continue;
    }
    const operator = QUERY_OPERATOR.exec(rest(i));
    if (operator) {
      i += operator[0].length - 1;
      termStart = true;
      continue;
    }
    if (ch === '(') {
      /* Mid-term: a nested part of the term (`a(b)`), or a group if it never closes. Counted
         either way; a quote after it is treated as term text, which is safe in both readings. */
      open.push({ at: i, group: false });
      continue;
    }
    if (ch === ')') {
      const opened = open.pop();
      if (!opened) unmatched.add(i);
      /* A group's end starts a new term; a nested part's end continues the term it is in. */
      termStart = !opened || opened.group;
    }
  }
  for (const { at } of open) unmatched.add(at);
  return { badQuote: -1, unmatched };
}

/**
 * How many blacklisted ids go into one query. Each costs ~25 characters once a proxy line has
 * encoded the URL twice; a hundred keeps the request line well inside the 8KB a proxy commonly
 * allows. The newest are kept — a feed is overwhelmingly recent pictures. The live list is 15.
 */
export const MAX_BLACKLIST_TERMS = 100;

/**
 * The blacklisted ids a query could not carry — everything older than its newest
 * `MAX_BLACKLIST_TERMS` (review P3-O3 / P1-F16). Past a hundred entries those pictures came back
 * in the feed and the searches while `searchImagesByIds` filtered all of them; the results are now
 * filtered against this rest, so the blacklist means the same thing everywhere. A page may come
 * back a few pictures short, which is the price of not growing the request line.
 */
export function blacklistBeyondQuery(blacklist: PublicBlacklist): Set<number> {
  if (blacklist.length <= MAX_BLACKLIST_TERMS) return new Set();
  return new Set([...blacklist].sort((a, b) => a - b).slice(0, -MAX_BLACKLIST_TERMS));
}

/** `images` without the blacklisted ids the query could not carry. Same array when none apply. */
export function withoutOverflowBlacklisted<T extends { id: number }>(images: T[], blacklist: PublicBlacklist): T[] {
  const rest = blacklistBeyondQuery(blacklist);
  return rest.size ? images.filter((image) => !rest.has(image.id)) : images;
}

/**
 * Every tag this device's settings exclude: the content filter's group (none in developer
 * mode), the two ban toggles and the hidden tags. One definition for the query's `-tag`
 * terms, the image-search results' client-side check and /search's quick tags, so a tag the
 * feed hides can never be offered or shown somewhere else.
 */
export function excludedTagsFrom(s: QuerySettings, filters: BlockFilters = DEFAULT_BLOCK_FILTERS): Set<string> {
  const contentFilter = parseContentFilter(s.contentFilter);
  const excluded = new Set<string>(contentFilter === 'developer' ? [] : filters[contentFilter]);
  if (s.banAnthro) for (const tag of filters.banAnthro) excluded.add(tag);
  if (s.banDiscomfort !== false) for (const tag of filters.banDiscomfort) excluded.add(tag);
  for (const tag of s.hiddenTags) if (tag) excluded.add(tag);
  return excluded;
}

export function buildSearchQueryFrom(
  s: QuerySettings,
  search?: string,
  filters: BlockFilters = DEFAULT_BLOCK_FILTERS,
  blacklist: PublicBlacklist = [],
): string {
  const excluded = excludedTagsFrom(s, filters);
  const constraints = [...excluded].map((tag) => `-${escapeTag(tag)}`);
  if (s.onlyPony && filters.onlyPony.length) {
    constraints.push(`(${filters.onlyPony.map(escapeTag).join(' OR ')})`);
  }
  /* The public blacklist applies in every mode, developer included — it is the site's rule,
     not a viewing preference. */
  for (const id of [...blacklist].sort((a, b) => a - b).slice(-MAX_BLACKLIST_TERMS)) {
    constraints.push(`-id:${id}`);
  }
  let tags = constraints.join(', ');

  if (search) {
    /* OR belongs to the user's query, while the device filters apply to the whole query.
       Without grouping, `a OR b, -explicit` only constrains the right-hand branch — and the
       grouping only holds if the text cannot close it early (`balanceUserQuery`). */
    const scoped = balanceUserQuery(search);
    tags = tags ? `(${scoped}), ${tags}` : scoped;
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
export const DEFAULT_BROWSING_FINGERPRINT = withBlockFiltersFingerprint('safe|-|d|-|', DEFAULT_BLOCK_FILTERS);

/**
 * The home feed's sort fields, and the only ones allowed to reach an upstream URL. The value
 * arrives from a **cookie**, and an unvalidated `sf=${sort}` once let a crafted cookie append two
 * parameters of the attacker's choosing — after the safe-content `q=` — to a request *the
 * server* makes, defeating the content filter. An allowlist rather than escaping, because the
 * set is closed and tiny.
 *
 * `relevance` is gone: it is not a Philomena sort field, so it silently returned the newest
 * pictures while claiming 相关度 — and a feed has no query to be relevant *to*. A stored legacy
 * value falls back to the default here, like any other unknown one.
 */
export const SORT_FIELDS = [
  'created_at',
  'updated_at',
  'score',
  'wilson_score',
  'random',
] as const;

export function parseSortField(raw: string | undefined | null): string {
  return raw && (SORT_FIELDS as readonly string[]).includes(raw) ? raw : 'created_at';
}

/**
 * The cookie value that says "this device's fingerprint could not be mirrored": its encoded
 * form was over the cookie budget, or the browser dropped the write. The server then renders
 * no seed rather than the *default* feed — which, for a device with a long hidden-tag list,
 * put pictures the user had hidden into the server HTML and kept them on screen until the
 * browser's own read replaced them.
 */
export const UNMIRRORABLE_FINGERPRINT = 'unmirrorable';

/**
 * Bound a fingerprint cookie before it reaches a cache key. Not about injection
 * (`buildSearchQueryFrom` encodes every field) — the home feed's only server cache is a
 * process memo of a few slots (`lib/feed.server.ts`), so the bound is about what a cookie can
 * carry at all: a browser drops a cookie over 4096 bytes, so a longer value cannot be real.
 */
const MAX_FINGERPRINT_LENGTH = 4096;

export function parseFingerprintCookie(raw: string | undefined): string {
  if (raw === UNMIRRORABLE_FINGERPRINT) return UNMIRRORABLE_FINGERPRINT;
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
  const [contentFilter = 'safe', anthro = '-', discomfort = 'd', pony = '-', hidden = ''] = (raw ?? '').split('|');
  return {
    contentFilter: parseContentFilter(contentFilter),
    banAnthro: anthro === 'a',
    banDiscomfort: discomfort === 'd',
    onlyPony: pony === 'p',
    hiddenTags: hidden ? hidden.split(',').filter(Boolean) : [],
  };
}

// ---------------------------------------------------------------------------
// The user's text, as /search reads it
// ---------------------------------------------------------------------------

/** Han ideographs: the original front end's test for "this needs the semantic parse". */
const CJK = /[㐀-鿿]/;

export function hasCjk(text: string): boolean {
  return CJK.test(text);
}

/**
 * Syntax the semantic parse must not rewrite — a boolean operator, a group, or a negation /
 * fuzzy / boost mark at the start of a term. Verbatim from the original front end, so a query
 * one of them sends to the model the other does too.
 */
const ADVANCED_SYNTAX = /(?:\bAND\b|\bOR\b|\|\||&&|\([^)]*\)|(?:^|[,\s])[-!~][^\s,]+)/i;

export function isAdvancedSyntax(text: string): boolean {
  return ADVANCED_SYNTAX.test(text);
}

/** Whether the text is a question for the semantic parse: Chinese words and no query syntax. */
export function isSemanticText(text: string): boolean {
  return hasCjk(text) && !isAdvancedSyntax(text);
}

/**
 * What a submitted field commits: trimmed, full-width commas made ASCII, no trailing separator.
 * An empty result means there is nothing to search for.
 */
export function normalizeSearchText(text: string): string {
  return text.trim().replace(/，/g, ',').replace(/[,\s]+$/, '').trim();
}

/**
 * The top-level terms of a query: split at commas (ASCII or full-width) outside parentheses and
 * quotes, trimmed, empties dropped. An `AND` / `OR` inside a term is left to the grammar — the
 * comma is the separator a person types between tags, and the only one this reads.
 */
export function splitQueryTerms(query: string): string[] {
  const terms: string[] = [];
  let depth = 0;
  let quoted = false;
  let escaped = false;
  let start = 0;
  for (let i = 0; i < query.length; i += 1) {
    const ch = query[i];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (ch === '\\') {
      escaped = true;
      continue;
    }
    if (ch === '"') {
      quoted = !quoted;
      continue;
    }
    if (quoted) continue;
    if (ch === '(') depth += 1;
    else if (ch === ')') depth = Math.max(0, depth - 1);
    else if ((ch === ',' || ch === '，') && depth === 0) {
      terms.push(query.slice(start, i));
      start = i + 1;
    }
  }
  terms.push(query.slice(start));
  return terms.map((term) => term.trim()).filter(Boolean);
}

const sameTerm = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

/** Whether `term` is one of the query's top-level terms (case-insensitive, as tags are). */
export function queryHasTerm(query: string, term: string): boolean {
  return splitQueryTerms(query).some((existing) => sameTerm(existing, term));
}

/** Adds `term` as a top-level term, or removes it if it is one — a quick tag's tap. */
export function toggleQueryTerm(query: string, term: string): string {
  const terms = splitQueryTerms(query);
  const kept = terms.filter((existing) => !sameTerm(existing, term));
  return (kept.length === terms.length ? [...terms, term.trim()] : kept).join(', ');
}

/* ----- the advanced filters /search shows as controls ----- */

export type FilterComparison = 'gte' | 'lt';
export type AspectFilter = 'portrait' | 'square' | 'landscape' | 'ultrawide';
export type MediaFilter = 'animated' | 'still' | 'video';
export type SinceFilter = 'day' | 'week' | 'month' | 'year';

/**
 * The five conditions the advanced panel offers, as *state*: parsed out of the committed query
 * and written back in place of whatever the query held for them. They were string-appended —
 * applying twice duplicated them, 重置 left them in the query, and a URL that carried them
 * opened an empty panel.
 */
export interface SearchFilters {
  upvotes: { op: FilterComparison; value: number } | null;
  score: { op: FilterComparison; value: number } | null;
  aspect: AspectFilter | null;
  media: MediaFilter | null;
  since: SinceFilter | null;
}

export const NO_SEARCH_FILTERS: SearchFilters = Object.freeze({
  upvotes: null,
  score: null,
  aspect: null,
  media: null,
  since: null,
});

/** Each value's canonical term — what the panel writes, and all it recognises when reading. */
export const ASPECT_TERMS: Record<AspectFilter, string> = {
  portrait: 'aspect_ratio.lt:1',
  square: 'aspect_ratio:1',
  landscape: 'aspect_ratio.gt:1',
  ultrawide: 'aspect_ratio.gt:1.5',
};
export const MEDIA_TERMS: Record<MediaFilter, string> = {
  animated: 'animated:true',
  still: 'animated:false',
  video: '(mime_type:video/webm OR mime_type:video/mp4)',
};
export const SINCE_TERMS: Record<SinceFilter, string> = {
  day: 'created_at.gte:1 days ago',
  week: 'created_at.gte:1 weeks ago',
  month: 'created_at.gte:1 months ago',
  year: 'created_at.gte:1 years ago',
};

/** Case and the spacing around `:` and parentheses do not change what a term means. */
function canonicalTerm(term: string): string {
  return term.toLowerCase().replace(/\s+/g, ' ').replace(/\s*([:()])\s*/g, '$1').trim();
}

function lookupTerm<K extends string>(table: Record<K, string>, canonical: string): K | null {
  for (const [key, value] of Object.entries(table) as [K, string][]) {
    if (canonicalTerm(value) === canonical) return key;
  }
  return null;
}

/**
 * Split a query into the terms that are the user's own and the conditions the panel owns. A
 * condition the panel cannot express (`upvotes.gt:5`, a negated one, one inside a group) stays
 * an ordinary term, so applying the panel never rewrites syntax the user typed. A condition
 * given twice is read as its last value and written back once.
 */
export function parseSearchFilters(query: string): { terms: string[]; filters: SearchFilters } {
  const filters: SearchFilters = { ...NO_SEARCH_FILTERS };
  const terms: string[] = [];
  for (const term of splitQueryTerms(query)) {
    const canonical = canonicalTerm(term);
    const count = /^(upvotes|score)\.(gte|lt):(-?\d{1,9})$/.exec(canonical);
    if (count) {
      filters[count[1] as 'upvotes' | 'score'] = { op: count[2] as FilterComparison, value: Number(count[3]) };
      continue;
    }
    const aspect = lookupTerm(ASPECT_TERMS, canonical);
    if (aspect) {
      filters.aspect = aspect;
      continue;
    }
    const media = lookupTerm(MEDIA_TERMS, canonical) ??
      (canonical === '(mime_type:video/mp4 or mime_type:video/webm)' ? 'video' : null);
    if (media) {
      filters.media = media;
      continue;
    }
    const since = lookupTerm(SINCE_TERMS, canonical);
    if (since) {
      filters.since = since;
      continue;
    }
    terms.push(term);
  }
  return { terms, filters };
}

/** The panel's conditions as query terms, in the panel's own order. */
export function searchFilterTerms(filters: SearchFilters): string[] {
  const out: string[] = [];
  if (filters.upvotes) out.push(`upvotes.${filters.upvotes.op}:${filters.upvotes.value}`);
  if (filters.score) out.push(`score.${filters.score.op}:${filters.score.value}`);
  if (filters.aspect) out.push(ASPECT_TERMS[filters.aspect]);
  if (filters.media) out.push(MEDIA_TERMS[filters.media]);
  if (filters.since) out.push(SINCE_TERMS[filters.since]);
  return out;
}

export function countSearchFilters(filters: SearchFilters): number {
  return searchFilterTerms(filters).length;
}

/** The user's terms followed by the panel's conditions — the one way a query is rebuilt. */
export function composeQuery(terms: readonly string[], filters: SearchFilters): string {
  return [...terms, ...searchFilterTerms(filters)].join(', ');
}

/* ----- single tags and excluded terms ----- */

/**
 * Philomena's image fields. `field:value` on one of these is a condition; any other `a:b` is a
 * namespaced tag (`artist:…`, `oc:…`, `spoiler:…`).
 */
const IMAGE_FIELDS = new Set([
  'id', 'score', 'upvotes', 'downvotes', 'faves', 'width', 'height', 'aspect_ratio', 'pixels', 'size',
  'duration', 'animated', 'mime_type', 'original_format', 'created_at', 'updated_at', 'first_seen_at',
  'comment_count', 'tag_count', 'source_count', 'source_url', 'description', 'uploader', 'uploader_id',
  'true_uploader', 'true_uploader_id', 'faved_by', 'faved_by_id', 'gallery_id', 'gallery_position',
  'sha512_hash', 'orig_sha512_hash', 'wilson_score', 'my', 'processed', 'thumbnails_generated',
]);

/**
 * Whether the query is exactly one plain tag — the case /search can describe with the
 * dictionary's entry. Not a negation, a wildcard, a group, an operator, a field condition, or
 * Chinese text (the dictionary is keyed on the English name).
 */
export function isSingleTagQuery(query: string): boolean {
  const terms = splitQueryTerms(query);
  if (terms.length !== 1) return false;
  const term = terms[0];
  if (/^[-!]/.test(term) || /^not\s/i.test(term) || hasCjk(term)) return false;
  if (/[*?"()^~]|\|\||&&|\s(?:AND|OR)\s/.test(term)) return false;
  const colon = term.indexOf(':');
  if (colon !== -1) {
    const field = term.slice(0, colon).trim().toLowerCase().replace(/\.(?:gte|gt|lte|lt)$/, '');
    if (IMAGE_FIELDS.has(field)) return false;
  }
  return true;
}

/**
 * The query's required plain terms that this device's settings exclude — why a search can
 * only come back empty (`explicit` in safe mode, a hidden tag). Nothing for a query with an
 * alternative in it: one branch may still be satisfiable.
 */
export function excludedTermsIn(query: string, excluded: ReadonlySet<string>): string[] {
  if (/(?:^|[\s(,])(?:OR|\|\|)(?=[\s(]|$)/.test(query)) return [];
  return splitQueryTerms(query).filter(
    (term) => !/^[-!(]/.test(term) && !/^not\s/i.test(term) && excluded.has(term.trim().toLowerCase()),
  );
}

/**
 * The exclusions, applied to pictures that did not come from a query — 以图搜图's results come
 * from a separate service that knows nothing of this device's settings. The same rules as the
 * query's `-tag` terms: the public blacklist, every excluded tag, and (with 只看小马) at least one
 * pony tag. An untagged record passes, as it did in the original front end: a partial row is no
 * evidence either way.
 */
export function imageFilterFor(
  s: QuerySettings,
  filters: BlockFilters = DEFAULT_BLOCK_FILTERS,
  blacklist: PublicBlacklist = [],
): (image: { id: number; tags?: readonly string[] | null }) => boolean {
  const excluded = excludedTagsFrom(s, filters);
  const blocked = new Set(blacklist);
  const pony = new Set(s.onlyPony ? filters.onlyPony : []);
  return (image) => {
    if (blocked.has(image.id)) return false;
    const tags = (image.tags ?? []).map((tag) => String(tag).trim().toLowerCase()).filter(Boolean);
    if (tags.length === 0) return true;
    if (tags.some((tag) => excluded.has(tag))) return false;
    return pony.size === 0 || tags.some((tag) => pony.has(tag));
  };
}
