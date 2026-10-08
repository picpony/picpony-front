/**
 * The device's content settings as a test on one picture's tags — for a picture that did not
 * come out of a search, where the exclusions could not ride in the query.
 *
 * Every list in the app is a Derpibooru search, and `buildSearchQueryFrom` (lib/searchQuery.ts)
 * writes the settings into it as `-tag` terms, so a filtered picture never arrives. The 近日推荐
 * banner is not a search — `images/featured` returns whatever was featured — and it used to put
 * a picture carrying the user's hidden tags at the top of the home page, above a grid that had
 * filtered the same tags out (R4-025). This applies the same rules to the tags it did bring.
 *
 * **The same rules, from the same derivation**, so the two cannot disagree: the excluded set is
 * `excludedTagsFrom` — the one the query's `-tag` terms are written from (the content filter's
 * own list, none in developer mode; the two ban toggles; the hidden tags) — and then the
 * only-pony requirement, as the query adds it. The public blacklist is deliberately absent — see
 * AGENTS.md: the banner is not a search and the site's list is applied to searches. Plain
 * module: the server renders the same decision the client hydrates.
 */
import type { BlockFilters } from '@/lib/blockFilters';
import { excludedTagsFrom, type QuerySettings } from '@/lib/searchQuery';

/** Whether a picture with `tags` is one the device's settings exclude. */
export function isWithheldBy(
  tags: readonly string[] | undefined,
  settings: QuerySettings,
  filters: BlockFilters,
): boolean {
  const own = new Set((tags ?? []).filter((t) => typeof t === 'string').map((t) => t.trim().toLowerCase()));
  for (const tag of excludedTagsFrom(settings, filters)) if (own.has(tag.trim().toLowerCase())) return true;
  if (settings.onlyPony && filters.onlyPony.length > 0) {
    return !filters.onlyPony.some((tag) => own.has(tag));
  }
  return false;
}
