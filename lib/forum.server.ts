import { cacheSeconds, createServerMemo } from '@/lib/serverMemo';
import { DEFAULT_FORUM_LIST, forumListKey } from '@/lib/forumKeys';
import { forumListParams, forumPostsOf, sortOf, type WirePostPage } from '@/lib/forumModel';
import type { ForumPostsResponse } from '@/lib/types/forum';
import { upstreamOrigin } from '@/lib/upstream.server';

/**
 * The forum's first page, read on the server so a cold `/?tab=forum` — and the `/forum` redirect,
 * which lands there — arrives with its rows in the first byte (R12-006); the pane takes it as
 * `initial` and seeds it into `forumPosts`. Only the default list: every visitor lands on it (the
 * pane's filters are screen state, never in the address), so there is one key and nothing to
 * partition. A visitor's list, anonymous — a signed-in reader's unread marks come from their own
 * read, which replaces this one quietly once the session is known.
 *
 * `/` alone does not read it: there the forum is the hidden pane, mounted on an idle callback, and
 * its first read is the client's (AGENTS "the forum pane is already `api: 0` on tap").
 *
 * The `lib/route.server.ts` rules: bounded, `null` rather than a throw (no seed is a state the pane
 * already handles), direct to the backend's `/api/v1` (the browser's relative base goes through
 * this app's proxy, which a server read has no cookie for), no `proxyFetch`.
 *
 * **Never the thread.** A thread read counts a view on the server (every `GET /forum/posts/{id}`
 * adds one), so a server read for a thread's title or its first paint
 * would count every visit twice. The list read counts nothing.
 */

/** How long the document may wait for the list. The same bound as the other seeds. */
const TIMEOUT_MS = 2500;

/** Matches `forumPosts`' own TTL in `lib/resources.ts`, so both sides of the handoff share a clock. */
const REVALIDATE_S = 60;

/** The harness points this at a fixture server (see `lib/profile.server.ts`). */
const UPSTREAM_ORIGIN = upstreamOrigin();

export interface ForumListSeed {
  key: string;
  data: ForumPostsResponse;
  generatedAt: number;
}

/**
 * A process-local memo, because every visible link to `/?tab=forum` has its RSC payload
 * prefetched and rendering that payload runs this read (`lib/serverMemo.ts`). One slot.
 */
export const readForumFirstPage = createServerMemo({
  ttlMs: REVALIDATE_S * 1000,
  keyOf: () => 'default',
  load: async (): Promise<ForumListSeed | null> => {
    try {
      const params = forumListParams({
        page: DEFAULT_FORUM_LIST.page,
        category: 'all',
        sort: sortOf(DEFAULT_FORUM_LIST.sort),
      });
      const query = new URLSearchParams();
      for (const [name, value] of Object.entries(params)) if (value !== undefined) query.set(name, String(value));
      const res = await fetch(`${UPSTREAM_ORIGIN}/api/v1/forum/posts?${query}`, {
        next: { revalidate: cacheSeconds(REVALIDATE_S) },
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      if (!res.ok) return null;
      const data = (await res.json()) as WirePostPage;
      return {
        key: forumListKey(DEFAULT_FORUM_LIST),
        data: forumPostsOf(data, false),
        generatedAt: Date.now(),
      };
    } catch {
      /* A timeout, an offline upstream, an unreadable body — all mean "no seed", which the pane
         handles by reading it itself. */
      return null;
    }
  },
});
