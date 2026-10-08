/**
 * The sort fields /search offers — every one a real Philomena field, since an unknown field is
 * silently answered in `created_at` order and the control then lies about what it did (two of
 * ten once did: `relevance` and `hotness`).
 *
 * `_score` is 相关性, and it only means something when the query gives Derpibooru something to
 * rank by — see `queryHasRanking`. The list is also the allowlist a URL's `sort=` passes.
 */
export const SEARCH_SORT_FIELDS = [
  'created_at', 'updated_at', 'score', '_score', 'wilson_score',
  'width', 'height', 'size', 'random',
] as const;

/**
 * Values this app wrote before, and what they mean now: `relevance` was always meant to be
 * `_score`; `hotness` had no Philomena equivalent and is simply gone.
 */
const LEGACY_SORTS: Record<string, string | undefined> = { relevance: '_score', hotness: undefined };

export function searchSort(value: string | null | undefined, fallback = 'created_at'): string {
  if (!value) return fallback;
  const mapped = value in LEGACY_SORTS ? LEGACY_SORTS[value] : value;
  return mapped && (SEARCH_SORT_FIELDS as readonly string[]).includes(mapped) ? mapped : fallback;
}

/**
 * The *default* search sort (a setting), which never resolves to 相关性: a default cannot know
 * whether the query it will meet gives anything to rank by.
 */
export function defaultSearchSort(value: string | null | undefined): string {
  const sort = searchSort(value);
  return sort === '_score' ? 'created_at' : sort;
}

/**
 * Whether a query gives Derpibooru anything to rank by. Without it every match scores the same
 * and `_score` is the newest-first order in disguise — measured: `fluttershy, safe` returns the
 * identical `created_at` order, while an `OR` of alternatives (a picture matching more of them
 * ranks higher), a boost (`^2`), a fuzzy term (`~`) and a text field (`description:`) each
 * reorder the results. Operators are matched as Philomena spells them (`OR` and `||`
 * case-sensitively, since lower-case `or` is a tag).
 */
export function queryHasRanking(query: string | null | undefined): boolean {
  if (!query) return false;
  return /(?:^|[\s(,])(?:OR|\|\|)(?=[\s(]|$)/.test(query) ||
    /\^\s*\d/.test(query) ||
    /~/.test(query) ||
    /(?:^|[\s(,!-])(?:description|source_url)\s*:/i.test(query);
}

/**
 * The sort a search actually runs with: `_score` only where the query can be ranked, otherwise
 * `fallback` (itself never `_score`). A URL carrying `sort=_score` for a plain tag query then
 * shows and runs the default order, rather than 相关性 that means 最新.
 */
export function effectiveSearchSort(value: string | null | undefined, fallback: string, query: string): string {
  const safeFallback = defaultSearchSort(fallback);
  const sort = searchSort(value, safeFallback);
  return sort === '_score' && !queryHasRanking(query) ? safeFallback : sort;
}

export function searchPage(value: string | null): number {
  if (!value || !/^\d+$/.test(value)) return 1;
  const page = Number(value);
  return Number.isSafeInteger(page) && page > 0 ? page : 1;
}

/** The most tags a URL may pin for one semantic search; the parse itself returns a handful. */
const MAX_PINNED_TAGS = 24;

/** The parameter a shared search's link names its sharer in (`from=<username>`). */
export const SHARED_BY_PARAM = 'from';
/** PicPony usernames are far shorter; this only keeps a hand-made link from filling the row. */
const MAX_SHARED_BY_LENGTH = 32;

function sharerName(value: string | null | undefined): string | null {
  if (!value) return null;
  const printable = [...value].filter((char) => {
    const code = char.charCodeAt(0);
    return code > 0x1f && code !== 0x7f;
  });
  const name = printable.join('').trim().slice(0, MAX_SHARED_BY_LENGTH).trim();
  return name || null;
}

/**
 * Everything /search shows, as its URL says it — the URL is the whole state, so reload, share,
 * Back and Forward all reproduce the same screen.
 *
 * - `q` is the text **as typed**: for a Chinese / natural-language search that is the original
 *   words, never the tags they became.
 * - `tags` pins the tags a semantic search runs with — the parse's own answer once it lands, or
 *   the subset the user kept. With it the search runs at once on reload or from a shared link,
 *   without waiting for (or depending on the mood of) the model.
 * - `raw=1` runs a semantic search's words as typed instead.
 * - `image` names a 以图搜图 result set held for this session (`app/search/imageSearchStore.ts`);
 *   the pictures came from an upload, so there is nothing for a URL to carry but the key.
 * - `from` names who shared the search (分享搜索结果). It stays through refinements of that
 *   search and goes with a new query or when its notice is dismissed.
 */
export interface SearchLocation {
  query: string;
  /** The `sort` parameter as written; `effectiveSearchSort` decides what runs. */
  sort: string;
  direction: 'asc' | 'desc';
  page: number;
  literal: boolean;
  tags: string[] | null;
  image: string | null;
  sharedBy: string | null;
}

export function readSearchLocation(params: URLSearchParams): SearchLocation {
  const image = params.get('image');
  const pinned = params.get('tags');
  const tags = pinned === null ? null : [...new Set(
    pinned.split(',').map((tag) => tag.trim()).filter(Boolean),
  )].slice(0, MAX_PINNED_TAGS);
  return {
    query: (params.get('q') ?? '').trim(),
    sort: params.get('sort') ?? '',
    direction: params.get('dir') === 'asc' ? 'asc' : 'desc',
    page: searchPage(params.get('page')),
    literal: params.get('raw') === '1',
    tags: tags && tags.length > 0 ? tags : null,
    image: image && /^[a-z0-9]{4,32}$/.test(image) ? image : null,
    sharedBy: sharerName(params.get(SHARED_BY_PARAM)),
  };
}

/** Keep every committed search reproducible when opened again or restored by Back. */
export function searchHref(
  query: string,
  sort: string,
  direction: 'asc' | 'desc',
  page = 1,
  {
    literal = false,
    tags = null,
    sharedBy = null,
  }: { literal?: boolean; tags?: readonly string[] | null; sharedBy?: string | null } = {},
): string {
  const params = new URLSearchParams({ q: query, sort: searchSort(sort), dir: direction });
  if (literal) params.set('raw', '1');
  else if (tags && tags.length > 0) params.set('tags', tags.slice(0, MAX_PINNED_TAGS).join(','));
  if (page > 1) params.set('page', String(page));
  const sharer = sharerName(sharedBy);
  if (sharer) params.set(SHARED_BY_PARAM, sharer);
  return `/search?${params.toString()}`;
}

/**
 * The original front end's shared-search link, `#mode=shared_search&user=<name>&q=<query>` on
 * the site's root, as this app's own — for a link somebody saved or sent before the move. Its
 * short links (`share.php?id=`) lead to the same form, so both arrive here. A shared tag group,
 * `#mode=shared_tag_group&user=<name>&q=<tags>`, is the same thing — the group's tags as a
 * search, from the person who shared it. `null` for any other fragment.
 */
export function legacySharedSearchHref(hash: string): string | null {
  const fragment = hash.replace(/^#/, '');
  if (!fragment.startsWith('mode=shared_search') && !fragment.startsWith('mode=shared_tag_group')) return null;
  const params = new URLSearchParams(fragment);
  const query = (params.get('q') ?? '').trim();
  if (!query || query === '*') return '/search';
  /* No `sort`: the old link carried none, so the recipient's own default order applies. */
  const next = new URLSearchParams({ q: query });
  const sharer = sharerName(params.get('user'));
  if (sharer) next.set(SHARED_BY_PARAM, sharer);
  return `/search?${next.toString()}`;
}

/**
 * The original front end's link to one picture — `#q=id:<N>` on the site's root, a search for
 * that id, which is what its 复制链接 copied and its short links still lead to — as this app's
 * own detail page. `null` for any other fragment.
 */
export function legacySharedImageHref(hash: string): string | null {
  const fragment = hash.replace(/^#/, '');
  if (!fragment.startsWith('q=')) return null;
  const match = /^id:(\d{1,10})$/i.exec((new URLSearchParams(fragment).get('q') ?? '').trim());
  const id = match ? Number(match[1]) : 0;
  return Number.isSafeInteger(id) && id > 0 ? `/pic/${id}` : null;
}

/** A 以图搜图 result set's own entry: an image search is a new search, so it gets one. */
export function imageSearchHref(key: string): string {
  return `/search?${new URLSearchParams({ image: key }).toString()}`;
}
