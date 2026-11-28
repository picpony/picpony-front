/**
 * Numbered pages over a keyset-paged list.
 *
 * The Rust backend pages its newest-first lists by cursor — `?before=<id>&limit=` answered with
 * `{rows…, next_cursor}` (the id to pass as the next `before`, `null` at the end) — and reports
 * no total. The inbox screens page by number (`Pagination`, a remembered page). This keeps, per
 * list, the cursor each numbered page starts at, learned from the page before it: asking for a
 * page whose start is not known yet reads the pages before it first, in order.
 *
 * What a numbered page cannot know is how many pages there are. `totalPages` is therefore the
 * pages known to exist — this one, plus one more while the backend says there is a next page.
 */

export interface CursorPage<T> {
  rows: T[];
  /** The `before` of the next page, `null` when this one is the last. */
  next: number | null;
}

export type CursorRead<T> = (before: number | undefined, signal?: AbortSignal) => Promise<CursorPage<T>>;

/** Lists whose cursors are remembered, bounded: a token or a conversation is a list of its own. */
const MAX_LISTS = 64;

export function createCursorPager() {
  /** list key → page number → the `before` that page starts at (`undefined` = the newest). */
  const lists = new Map<string, Map<number, number | undefined>>();

  function starts(key: string): Map<number, number | undefined> {
    let known = lists.get(key);
    if (!known) {
      known = new Map([[1, undefined]]);
      lists.set(key, known);
      if (lists.size > MAX_LISTS) lists.delete(lists.keys().next().value as string);
    }
    return known;
  }

  /**
   * Page `page` (1-based) of the list `key`. A page past the last one there is resolves with the
   * last page and its number, so a remembered page that no longer exists lands somewhere real.
   */
  async function read<T>(
    key: string,
    page: number,
    load: CursorRead<T>,
    signal?: AbortSignal,
  ): Promise<{ rows: T[]; page: number; hasMore: boolean; totalPages: number }> {
    const target = Math.max(1, Math.floor(page));
    const known = starts(key);
    let at = target;
    while (at > 1 && !known.has(at)) at -= 1;
    for (;;) {
      const result = await load(known.get(at), signal);
      if (result.next !== null) known.set(at + 1, result.next);
      else for (const n of Array.from(known.keys())) if (n > at) known.delete(n);
      if (at >= target || result.next === null) {
        return {
          rows: result.rows,
          page: at,
          hasMore: result.next !== null,
          totalPages: result.next !== null ? at + 1 : at,
        };
      }
      at += 1;
    }
  }

  return { read };
}
