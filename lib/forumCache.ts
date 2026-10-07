'use client';

import { forumPosts, forumThread } from '@/lib/resources';
import type { ForumListQuery } from '@/lib/api/forum';
import type { ForumPost, ForumPostDetailResponse } from '@/lib/types/forum';

/**
 * Keeping the forum's cached answers true after the reader changes something — a like, a reply,
 * a deleted post or reply — so the list and the thread update in place instead of reloading.
 *
 * The list the reader came from is the one they will see again, so the pane records its query
 * (`rememberForumList`) and a change is written into that page directly; every other cached
 * page is marked stale (`expire`), re-read quietly the next time it is shown.
 */

let lastList: ForumListQuery | null = null;

/** The list on screen, recorded by the pane on each render. */
export function rememberForumList(query: ForumListQuery) {
  lastList = query;
}

/** Applies a change to one post in the list page the reader came from (`null` removes it). */
export function patchListedPost(id: number, patch: Partial<ForumPost> | null) {
  const query = lastList;
  if (query && forumPosts.peek(query).data) {
    forumPosts.write(query, (previous) => {
      if (!previous) return previous as never;
      if (patch === null) {
        const posts = previous.posts.filter((post) => post.id !== id);
        return { ...previous, posts, total: Math.max(0, previous.total - (previous.posts.length - posts.length)) };
      }
      return { ...previous, posts: previous.posts.map((post) => (post.id === id ? { ...post, ...patch } : post)) };
    });
  }
  forumPosts.expire();
}

/** Applies a change to a cached thread page, if it is cached. */
export function patchThreadPage(
  args: { id: string; page: number; token?: string | null },
  update: (previous: ForumPostDetailResponse) => ForumPostDetailResponse,
) {
  if (!forumThread.peek(args).data) return;
  forumThread.write(args, (previous) => (previous ? update(previous) : (previous as never)));
}
