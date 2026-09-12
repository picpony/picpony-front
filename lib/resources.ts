'use client';

/**
 * The app's reads, as resources.
 *
 * One entry per thing the app asks the server for. `lib/resource.ts` is the primitive; this is
 * the catalogue, and keeping them apart is what lets a screen say `useResource(forumThread,
 * { id })` without knowing anything about queues, TTLs or publication.
 *
 * ## Reading a TTL
 *
 * Not "how long the data is correct for" — a cached value past its TTL is still shown — but
 * **how long before it is worth asking again while somebody is looking at it**. Short for
 * anything another person can change, long for anything only you can change, longest for
 * effectively immutable content.
 *
 * ## What is not here
 *
 * Writes (a mutation still goes through `lib/api/*` directly; `resource.write(...)` only
 * corrects an answer in place) and the opened picture (`lib/detail.ts`, with its own publication
 * gate).
 *
 * ## What does not move to the server
 *
 * `featuredImage` stays a client read: `getFeatured` puts the user's Derpibooru API key in the
 * URL, and a shared server cache would leak it. The token-gated screens (favourites, history,
 * tasks, messages, block-groups) keep their token in `localStorage`, which the server cannot
 * read — moving auth into a cookie is a security decision, not a performance one. /search keys
 * on searchParams, so its reads stay client-side too. Everything else follows the `.server.ts`
 * pattern: the server awaits the first read and hands it down as `initial`, and the island seeds
 * it via `resource.seed()`.
 */

import * as derpi from '@/lib/api/derpi';
import * as picpony from '@/lib/api/picpony';
import { getBrowsingSettings, readJson } from '@/lib/api/client';
import { defineResource } from '@/lib/resource';
import type { ApiResponse, PonyImage } from '@/lib/types/image';
import type { ForumPost, ForumPostDetailResponse } from '@/lib/types/forum';
import type { UserComment, UserPost } from '@/lib/types/user';
import { COOKIE_KEYS, LS_KEYS, PICPONY_API_BASE } from '@/lib/constants';

/** Minutes, spelled out so the numbers below read as durations rather than as magic. */
const SECONDS = 1000;
const MINUTES = 60 * SECONDS;

/**
 * Everything a Derpibooru search silently depends on, as one string for the key.
 *
 * `getImages` reads the content filter, the toggles and the blocked-tag list out of
 * `localStorage` at call time, so two calls with identical arguments can be two different
 * questions — without this in the key, changing the content filter would be answered from the
 * cache with the previous results. A fingerprint (not the settings object) keeps every
 * dependency in one place; blocked tags are sorted and joined so a reorder is not a new key.
 */
export function browsingFingerprint(): string {
  const s = getBrowsingSettings();
  let hidden = '';
  try {
    /* Guarded rather than left to the `catch`: this runs during render, and Next renders client
       components on the server too — an unguarded read would throw on every SSR pass. Same
       reason `getBrowsingSettings` carries the guard. */
    const raw = typeof window === 'undefined' ? '[]' : localStorage.getItem(LS_KEYS.activeHiddenTags);
    const active: unknown = JSON.parse(raw || '[]');
    if (Array.isArray(active)) {
      hidden = active
        .filter((t): t is string => typeof t === 'string' && t !== '')
        .map((t) => t.trim().toLowerCase())
        .sort()
        .join(',');
    }
  } catch {
    /* A corrupt list is an empty one, which is what `buildSearchQuery` does with it too. */
  }
  return [
    s.contentFilter,
    s.banAnthro ? 'a' : '-',
    s.banDiscomfort ? 'd' : '-',
    s.onlyPony ? 'p' : '-',
    hidden,
  ].join('|');
}

/**
 * Mirror the fingerprint and the home sort into cookies, so the server can compute the same feed
 * key the client will.
 *
 * The settings live in `localStorage`, which the server cannot read; without a mirror the server
 * would render the default feed and the client would immediately replace it — a visible content
 * swap on every load for anyone who has changed a setting. The fingerprint *string* is written
 * rather than the five inputs, so the derivation above stays the only copy. Writes nothing when
 * the value has not changed (`document.cookie` is a parse-and-serialise per assignment, and this
 * runs on a hot mount effect).
 *
 * Called from the settings writer, /block-groups' tag writer, and the home island's mount effect
 * as the self-healing catch-all (a cleared browser cookie costs one load, then corrects itself).
 */
export function syncBrowsingCookie() {
  if (typeof document === 'undefined') return;
  const write = (name: string, value: string) => {
    /* Compared **encoded**: a fingerprint always contains a `|`, which serialises as `%7C`, so
       comparing the raw value could never match and the cookie was re-serialised on every call. */
    if (document.cookie.includes(`${name}=${encodeURIComponent(value)}`)) return;
    document.cookie = `${name}=${encodeURIComponent(value)};path=/;max-age=${60 * 60 * 24 * 365};samesite=lax`;
  };
  write(COOKIE_KEYS.browsing, browsingFingerprint());
  write(COOKIE_KEYS.homeSort, getBrowsingSettings().homeSort);
}

// ---------------------------------------------------------------------------
// The shell
// ---------------------------------------------------------------------------

export type SessionResult =
  | { kind: 'ok'; user: Record<string, unknown> }
  | { kind: 'unauthorized' }
  | { kind: 'unreadable' };

/**
 * The signed-in user, as the server currently has them.
 *
 * A discriminated result rather than a throw, because "this token is dead" is an *answer* and
 * wants caching like one — a rejected promise would be retried on every navigation. Also the
 * shape `readJson` imposes on this endpoint, which answers 200 with an empty body when the PHP
 * session has died. Five minutes: nothing here changes without the user's own action.
 */
export const sessionUser = defineResource<{ token: string }, SessionResult>({
  name: 'session-user',
  key: ({ token }) => token,
  ttl: 5 * MINUTES,
  /* Two: the current token and at most one it just replaced. */
  maxEntries: 2,
  fetch: async ({ token }, signal) => {
    const res = await picpony.getUser(token, signal);
    if (res.status === 401) return { kind: 'unauthorized' };
    const data = await readJson(res);
    if (data?.success && data.user) return { kind: 'ok', user: data.user };
    return { kind: 'unreadable' };
  },
});

export interface UnreadBreakdown {
  total: number;
  messages: number;
  notifications: number;
  interactions: number;
}

/**
 * The unread badge, and the three numbers behind it.
 *
 * One minute, because somebody else puts messages there. The breakdown is here rather than only
 * the total because there are two consumers — the shell's badge and /messages' per-tab split —
 * and one shared entry serves both with one request. `/messages` force-reads after marking a tab
 * read, and the shell is subscribed to the same entry, so its badge follows in the same publish.
 */
export const unreadCounts = defineResource<{ token: string }, UnreadBreakdown>({
  name: 'unread-counts',
  key: ({ token }) => token,
  ttl: 1 * MINUTES,
  maxEntries: 2,
  fetch: async ({ token }) => {
    const data = await picpony.getUnreadCounts(token);
    if (!data.success) return { total: 0, messages: 0, notifications: 0, interactions: 0 };
    return {
      total: data.total_unread ?? 0,
      messages: data.unread_messages ?? 0,
      notifications: data.unread_notifications ?? 0,
      interactions: data.unread_interactions ?? 0,
    };
  },
});

// ---------------------------------------------------------------------------
// The gallery and the feed
// ---------------------------------------------------------------------------

/**
 * A page of the home feed.
 *
 * Keyed on the page, the sort **and** `browsingFingerprint()`: `getImages` reads all three out of
 * `localStorage` itself, so whatever it reads has to be in the key or /settings changes would be
 * answered from the cache with the previous results. Two minutes — a feed changes, but not while
 * you look at a picture and come back.
 */
export const homeFeed = defineResource<{ page: number; sort: string; fp: string }, ApiResponse>({
  name: 'home-feed',
  /* The fingerprint is an *argument*, not something the key function reads for itself: a key that
     reads its own inputs can only be computed in the browser, and the server has to compute this
     one to render page 1 and land the seed under this key (or none). Keys must stay pure. */
  key: ({ page, sort, fp }) => `${sort}:${page}:${fp}`,
  ttl: 2 * MINUTES,
  /* A page of 50 images is a large object, so fewer keys than the default: eight pages is more
     back-and-forth than a paged gallery sees in one session. */
  maxEntries: 8,
  fetch: ({ page }) => derpi.getImages(undefined, page),
});

/**
 * A page of search results. Same shape as the feed; the query joins the key (which keys on
 * searchParams, so the read stays client-side). Every argument the fetch consumes — including
 * `sortDir` — must be in the key, or ascending and descending would share one cache entry.
 */
export const searchFeed = defineResource<
  { query: string; page: number; sortField?: string; sortDir: 'asc' | 'desc' },
  ApiResponse
>({
  name: 'search-feed',
  key: ({ query, page, sortField, sortDir }) =>
    `${query}\n${sortField ?? 'random'}:${sortDir}:${page}:${browsingFingerprint()}`,
  ttl: 2 * MINUTES,
  maxEntries: 8,
  fetch: ({ query, page, sortField, sortDir }) =>
    derpi.getImages(query, page, sortField, sortDir),
});

/**
 * 近日推荐.
 *
 * Ten minutes: the featured picture is chosen upstream once a day, so this TTL is about not
 * looking silly rather than about being right. Keyed on whether a key was sent, since the answer
 * differs for a signed-in Derpibooru account. Stays client-side: `getFeatured` puts the user's
 * API key in the URL, and a shared server cache would leak it.
 */
export const featuredImage = defineResource<{ apiKey?: string }, PonyImage | null>({
  name: 'featured',
  /* The content filter is in here because `getFeatured` adds `filter_id` in developer mode. */
  key: ({ apiKey }) => `${apiKey ? 'keyed' : 'anon'}:${getBrowsingSettings().contentFilter}`,
  ttl: 10 * MINUTES,
  maxEntries: 2,
  fetch: async ({ apiKey }) => (await derpi.getFeatured(apiKey))?.image ?? null,
});

/** Images by id, for a favourites list — one page's worth. */
export const imagesByIds = defineResource<{ ids: number[]; page: number; perPage: number }, ApiResponse>({
  name: 'images-by-ids',
  /* The ids are the query, so they are the key. Joined rather than hashed: a fave list is tens of
     ids, and a readable key is worth more than the bytes. */
  key: ({ ids, page, perPage }) => `${ids.join(',')}\n${page}/${perPage}`,
  ttl: 5 * MINUTES,
  maxEntries: 8,
  fetch: ({ ids, page, perPage }) => derpi.searchImagesByIds(ids, page, perPage),
});

// ---------------------------------------------------------------------------
// The forum
// ---------------------------------------------------------------------------

export const forumPosts = defineResource<{ page: number }, { posts: ForumPost[]; totalPages: number }>({
  name: 'forum-posts',
  key: ({ page }) => String(page),
  ttl: 1 * MINUTES,
  maxEntries: 8,
  fetch: async ({ page }) => {
    const res = await picpony.getForumPosts(page);
    return { posts: res.posts ?? [], totalPages: res.total_pages ?? 1 };
  },
});

/**
 * One thread.
 *
 * Thirty seconds, the shortest TTL in the catalogue: a reply can appear while you are reading,
 * and a short TTL is what makes returning from a tab land on the replies rather than on what was
 * there when you left.
 */
export const forumThread = defineResource<{ id: string; page: number }, ForumPostDetailResponse>({
  name: 'forum-thread',
  /* The page is in the key *and* in the fetch. Keys must be complete, not merely unique: a flat
     id-only key would carry page 4 of one thread into page 2 (unique is not the same as
     sufficient — each page is its own record). */
  key: ({ id, page }) => `${id}:${page}`,
  ttl: 30 * SECONDS,
  maxEntries: 12,
  fetch: ({ id, page }) => picpony.getForumPostDetail(id, page),
});

// ---------------------------------------------------------------------------
// Profiles
// ---------------------------------------------------------------------------

export interface ProfileUser {
  id: number;
  username: string;
  [key: string]: unknown;
}

export const userProfile = defineResource<{ id: string }, ProfileUser | null>({
  name: 'user-profile',
  key: ({ id }) => id,
  ttl: 5 * MINUTES,
  maxEntries: 12,
  fetch: async ({ id }) => {
    const res = await picpony.getUserProfile(id);
    if (!res?.success || !res.user) throw new Error(res?.message || '获取用户资料失败');
    return res.user as ProfileUser;
  },
});

/**
 * A profile's shared favourites — the *ids*, which are then looked up as images.
 *
 * Keyed on the username because that is what the endpoint takes, which is also why this is the
 * second hop of the profile page's waterfall: the id is in the URL and the username only arrives
 * with the profile. So the read is simply not sent until the favourites tab is opened (`SKIP`) —
 * it must not cost a request before then.
 */
export const sharedFaveIds = defineResource<{ username: string }, number[]>({
  name: 'shared-fave-ids',
  key: ({ username }) => username,
  ttl: 2 * MINUTES,
  maxEntries: 8,
  fetch: async ({ username }) => {
    const res = await picpony.getSharedFaves(username);
    if (!res.success) throw new Error('收藏夹加载失败');
    return res.faves ?? [];
  },
});

export const userPosts = defineResource<
  { id: string; page: number },
  { posts: UserPost[]; totalPages: number }
>({
  name: 'user-posts',
  key: ({ id, page }) => `${id}:${page}`,
  ttl: 2 * MINUTES,
  maxEntries: 12,
  fetch: async ({ id, page }) => {
    const res = await picpony.getUserPosts(id, page);
    if (!res.success) throw new Error('获取用户帖子失败');
    return { posts: res.posts ?? [], totalPages: res.total_pages ?? 1 };
  },
});

export const userComments = defineResource<
  { id: string; page: number },
  { comments: UserComment[]; totalPages: number }
>({
  name: 'user-comments',
  key: ({ id, page }) => `${id}:${page}`,
  ttl: 2 * MINUTES,
  maxEntries: 12,
  fetch: async ({ id, page }) => {
    const res = await picpony.getUserComments(id, page);
    if (!res.success) throw new Error('获取用户评论失败');
    return { comments: res.comments ?? [], totalPages: res.total_pages ?? 1 };
  },
});

export interface UploadItem {
  id: number;
  name: string;
  representations: PonyImage['representations'];
  view_url: string;
  width: number;
  height: number;
}

/**
 * A profile's uploads.
 *
 * The one read that builds its own URL (no `lib/api` function exists). It goes through the
 * relative `PICPONY_API_BASE` because the route handler is what rewrites the backend's `Secure`
 * session cookie. The token is in the key, not merely the header, because the answer depends on
 * it — a signed-in owner sees uploads a visitor does not. Stays client-side: the token lives in
 * `localStorage`, which the server cannot read.
 */
export const userUploads = defineResource<
  { id: string; page: number; perPage: number; token: string | null },
  { uploads: UploadItem[]; totalPages: number }
>({
  name: 'user-uploads',
  key: ({ id, page, perPage, token }) => `${id}:${page}/${perPage}:${token ?? 'anon'}`,
  ttl: 2 * MINUTES,
  maxEntries: 12,
  fetch: async ({ id, page, perPage, token }, signal) => {
    const res = await fetch(
      `${PICPONY_API_BASE}?action=get_user_uploads&user_id=${encodeURIComponent(id)}` +
        `&page=${page}&per_page=${perPage}${token ? `&token=${encodeURIComponent(token)}` : ''}`,
      { signal },
    );
    const data = await readJson(res);
    if (!res.ok || !data?.success) throw new Error(data?.message || '获取用户上传记录失败');
    return { uploads: data.uploads ?? [], totalPages: Math.max(1, data.total_pages || 1) };
  },
});

// ---------------------------------------------------------------------------
// The signed-in screens
// ---------------------------------------------------------------------------

/** PicPony's own favourites list — ids, looked up as images through `imagesByIds`. Token-gated:
 *  stays client-side. */
export const faveIds = defineResource<{ token: string }, number[]>({
  name: 'fave-ids',
  key: ({ token }) => token,
  ttl: 1 * MINUTES,
  maxEntries: 2,
  fetch: async ({ token }) => {
    const res = await picpony.getFaves(token);
    /* Thrown, not flattened to `[]`: a failed read and an empty list are different answers, and
       the empty one for both would render a server error as 暂无收藏 with no way to retry. */
    if (!res.success || !res.faves) throw new Error(res.message || '收藏列表读取失败');
    return res.faves;
  },
});

export interface HistoryItem {
  id: number;
  preview_url: string | null;
  uploader: string | null;
  last_view_time: string;
}

export const browsingHistory = defineResource<
  { token: string; page: number },
  { history: HistoryItem[]; totalPages: number }
>({
  name: 'browsing-history',
  key: ({ token, page }) => `${token}:${page}`,
  ttl: 1 * MINUTES,
  maxEntries: 8,
  fetch: async ({ token, page }) => {
    const data = (await picpony.getBrowsingHistory(token, page)) as {
      success?: boolean;
      history?: HistoryItem[];
      total_pages?: number;
    };
    if (!data?.success) throw new Error('获取浏览历史失败');
    return { history: data.history ?? [], totalPages: data.total_pages ?? 1 };
  },
});

export const tasks = defineResource<{ token: string }, unknown>({
  name: 'tasks',
  key: ({ token }) => token,
  /* Short, because the screen's own buttons change the answer: a claim writes through with
     `tasks.write(...)`, and this TTL is the backstop for a claim made in another tab. */
  ttl: 30 * SECONDS,
  maxEntries: 2,
  fetch: ({ token }) => picpony.getTasks(token),
});

export interface BlockGroup {
  id: number;
  name: string;
  tags: string[];
  hidden_tags: string[];
  spoilered_tags: string[];
  is_active: number;
}

export interface BlockGroupsResult {
  success?: boolean;
  error?: string;
  groups?: BlockGroup[];
}

/**
 * The signed-in user's 屏蔽组. Token-gated: stays client-side.
 *
 * Typed rather than `unknown`, because it has a consumer. Prefetch may move a request earlier,
 * never add one — warming a resource nobody reads would violate that rule, so this resource is
 * read by its screen.
 */
export const blockGroups = defineResource<{ token: string }, BlockGroupsResult>({
  name: 'block-groups',
  key: ({ token }) => token,
  ttl: 5 * MINUTES,
  maxEntries: 2,
  fetch: ({ token }) => picpony.getBlockGroups(token),
});

export interface TeamMember {
  id: number;
  name: string;
  role: string;
  category: 'developer' | 'manager' | 'editor' | 'special';
  avatar_url: string | null;
  account_avatar: string | null;
  link_url: string | null;
  order_num: number;
}

export const teamMembers = defineResource<Record<string, never>, TeamMember[]>({
  name: 'team-members',
  key: () => 'all',
  /* /about's roster; read on the server and handed down as a seed. Half an hour, because it
     changes when somebody joins the team. */
  ttl: 30 * MINUTES,
  maxEntries: 1,
  fetch: async () => {
    const data = (await picpony.getTeamMembers()) as {
      success?: boolean;
      members?: TeamMember[];
    };
    if (!data?.success || !Array.isArray(data.members)) throw new Error('团队成员加载失败');
    return data.members;
  },
});
