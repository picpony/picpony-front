/**
 * The forum list's cache key, in one place for both sides of the server seed: `lib/forum.server.ts`
 * keys the first page it renders with it, and `forumPosts` (`lib/resources.ts`) keys every read.
 * A seed applies only when the two agree (`useResource`'s `initial`), so they must be computed by
 * the same function — the rule `lib/feedKeys.ts` states for the home feed. No imports: the server
 * reaches it without pulling in the client catalogue.
 */

export interface ForumListKeyArgs {
  page: number;
  category?: string;
  sort?: string;
  search?: string;
  /** A signed-in read carries the viewer's like and unread state, so it is a different answer. */
  token?: string | null;
}

export function forumListKey({ page, category, sort, search, token }: ForumListKeyArgs): string {
  return JSON.stringify([page, category || 'all', sort || 'updated_at', (search ?? '').trim(), token || null]);
}

/** The list a visitor lands on: the first page, every category, the default order, no search. */
export const DEFAULT_FORUM_LIST = { page: 1, category: 'all', sort: 'updated_at', search: '', token: null } as const;
