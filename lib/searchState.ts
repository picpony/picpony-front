/** The fields offered by /search, including the dimension and hotness sorts. */
export const SEARCH_SORT_FIELDS = [
  'created_at', 'updated_at', 'score', 'relevance', 'wilson_score', 'hotness',
  'width', 'height', 'size', 'random',
] as const;

export function searchSort(value: string | null | undefined, fallback = 'created_at'): string {
  return value && (SEARCH_SORT_FIELDS as readonly string[]).includes(value) ? value : fallback;
}

export function searchPage(value: string | null): number {
  if (!value || !/^\d+$/.test(value)) return 1;
  const page = Number(value);
  return Number.isSafeInteger(page) && page > 0 ? page : 1;
}

/** Keep every committed search reproducible when opened again or restored by Back. */
export function searchHref(query: string, sort: string, direction: 'asc' | 'desc', page = 1): string {
  const params = new URLSearchParams({ q: query, sort: searchSort(sort), dir: direction });
  if (page > 1) params.set('page', String(page));
  return `/search?${params.toString()}`;
}
