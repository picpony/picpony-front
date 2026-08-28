'use client';

/**
 * The app's reads, as resources.
 *
 * One entry per thing the app asks the server for. `lib/resource.ts` is the primitive; this is the
 * catalogue, and keeping them apart is what lets a screen say `useResource(forumThread, { id })`
 * without knowing anything about queues, TTLs or publication.
 *
 * ## Reading a TTL
 *
 * The TTL is not "how long the data is correct for" — a cached value past its TTL is still shown.
 * It is **how long before it is worth asking again while somebody is looking at it**. So the
 * question to ask of a number here is "if this changed one second after I loaded it, how long
 * should I be allowed not to know?", and the answer is short for anything another person can
 * change (a message, an unread count), long for anything only you can change (your own session,
 * your tasks), and longest for content that is effectively immutable (an image's metadata).
 *
 * ## What is not here
 *
 * Writes. A mutation still goes through `lib/api/*` directly; what this layer adds is
 * `resource.write(...)` so the answer can be corrected in place afterwards rather than re-read.
 *
 * And the opened picture. `lib/detail.ts` holds that one, with the hero flight's own publication
 * gate — see its docstring for why it is not folded in here.
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
 * This is the sharp edge of caching functions that read their own inputs. `getImages` calls
 * `buildSearchQuery`, which reads the content filter, the anthro and pony toggles and the active
 * blocked-tag list straight out of `localStorage` at call time — so two calls with identical
 * arguments are two different questions if a setting moved between them. Without this, turning the
 * content filter from 完全安全 to 中等限制 would be answered from the cache with the safe results,
 * and the screen would look like the setting had not applied. Uncached code got away with it only
 * because it re-asked every time.
 *
 * A fingerprint rather than the settings object, because the key is a string and this keeps every
 * dependency in one place instead of spread across four resource definitions. Blocked tags are
 * sorted and joined so a reorder is not a new key.
 */
export function browsingFingerprint(): string {
  const s = getBrowsingSettings();
  let hidden = '';
  try {
    /* Guarded rather than left to the `catch`: this runs during render, and Next renders client
       components on the server too, so an unguarded read would throw a `ReferenceError` on every
       SSR pass and be swallowed below. Same reason `getBrowsingSettings` carries the guard. */
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
 * The same mechanism `lib/appearance.ts` uses for the five appearance preferences and for the
 * same reason: the settings live in `localStorage`, which the server cannot read, and without a
 * mirror the server would have to render the *default* feed and the client would immediately
 * replace it — one visible content swap on every load for anyone who has changed a setting.
 *
 * It writes the fingerprint *string* rather than the five inputs, so the derivation above stays
 * the only copy. It writes nothing when the value has not changed, because `document.cookie` is
 * a parse-and-serialise on every assignment and this is called from a mount effect on a hot path.
 *
 * Called from three places, and the redundancy is deliberate: the settings page's `lsSet` and
 * /block-groups' tag writer, so a change takes effect on the very next load; and the home
 * island's mount effect, which is the self-healing catch-all — a cookie cleared by the browser,
 * or a setting written by some future call site that forgets the first two, costs one load and
 * then corrects itself.
 */
export function syncBrowsingCookie() {
  if (typeof document === 'undefined') return;
  const write = (name: string, value: string) => {
    /* Compared **encoded**, because that is what the next line writes. A fingerprint always
       contains a `|`, which serialises as `%7C`, so comparing the raw value could never match:
       the guard never fired once and the cookie was re-serialised on every call. */
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
 * wants caching like one — a rejected promise would be retried on every navigation. It is also the
 * shape `readJson` already imposes on this endpoint, which answers 200 with an empty body when the
 * PHP session has gone.
 *
 * **Five minutes**, where the shell used to re-read this on *every navigation*. Nothing here can
 * change without the user doing it: their own name, avatar, role and level. The measured cost of
 * getting that wrong was two `get_user` requests per cold load and one more per navigation, because
 * the effect that sent it was keyed on the pathname and called `setUserInfo` twice per run.
 */
export const sessionUser = defineResource<{ token: string }, SessionResult>({
  name: 'session-user',
  key: ({ token }) => token,
  ttl: 5 * MINUTES,
  /* Two: the current token and at most one it just replaced. */
  maxEntries: 2,
  fetch: async ({ token }) => {
    const res = await picpony.getUser(token);
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
 * One minute, because somebody else puts messages there.
 *
 * **The breakdown is here rather than only the total**, and that is the whole reason this endpoint
 * is now read once instead of three times. The shell wants the total for the app bar; `/messages`
 * wants the per-tab split — and because they were separate reads of the same endpoint, opening
 * `/messages` sent `get_unread_counts` three times: the shell's, the page's own, and a third from
 * the page dispatching an event the shell listened to. One resource, two consumers, one request.
 *
 * That event is gone with it. The resource *is* the seam now: `/messages` force-reads after marking
 * a tab read, and the shell is subscribed to the same entry, so its badge follows in the same
 * publish — where the event round trip cost a second request to learn the same number.
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
 * Keyed on the page, the sort **and** `browsingFingerprint()`, because `getImages` reads all three
 * out of `localStorage` itself — so without them in the key, changing the sort or the content
 * filter in /settings would be answered from the cache with the previous results. That is the
 * general hazard with the `lib/api` functions that read browsing settings at call time: whatever
 * they read has to be in the key.
 *
 * Two minutes, matching what `pageCache` treated as the point at which a snapshot was worth
 * refreshing. A feed changes, but not in the ninety seconds it takes to look at a picture and come
 * back.
 */
export const homeFeed = defineResource<{ page: number; sort: string; fp: string }, ApiResponse>({
  name: 'home-feed',
  /* The fingerprint is an *argument* now, not something the key function reads for itself.
     A key that reads its own inputs can only be computed in the browser, and the server has to be
     able to compute this one — it renders page 1 and hands the client a seed, which lands under
     this key or under none. The docstring at the top of this file calls that "the sharp edge of
     caching functions that read their own inputs"; this is that edge closed for the one resource
     that needed it. */
  key: ({ page, sort, fp }) => `${sort}:${page}:${fp}`,
  ttl: 2 * MINUTES,
  /* A page of 50 images is a large object, so fewer keys than the default. Eight pages is more
     back-and-forth than a paged gallery sees in one session. */
  maxEntries: 8,
  fetch: ({ page }) => derpi.getImages(undefined, page),
});

/**
 * A page of search results. Same shape as the feed; the query joins the key.
 *
 * `sortDir` is in both the key and the fetch, and it was in neither. That is the same class
 * of bug `forumThread` had — an argument the underlying API function accepts, dropped on the
 * way through, so ascending and descending would have shared one cache entry and the fetcher
 * could only ever have returned descending. It went unnoticed because this resource had no
 * consumer at all until /search was wired onto it.
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
 * Ten minutes: the featured picture is chosen upstream once a day, so this is the one read in the
 * app where the TTL is about not looking silly rather than about being right. Keyed on whether a
 * key was sent, since the answer differs for a signed-in Derpibooru account.
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
 * Thirty seconds, the shortest TTL in the catalogue: a thread is where a reply appears while you
 * are reading it, and the whole value of a short TTL here is that coming back from a tab lands on
 * the replies rather than on what was there when you left.
 */
export const forumThread = defineResource<{ id: string; page: number }, ForumPostDetailResponse>({
  name: 'forum-thread',
  /* The page is in the key *and* in the fetch. It was in neither: the resource took only an
     `id`, so page 2 of a thread would have been answered from page 1's cache — and the
     fetcher dropped the argument `picpony.getForumPostDetail` accepts, so it could only ever
     have returned page 1 anyway. Invisible until now because nothing read this resource;
     `lib/prefetchRoute.ts` warmed it and the screen fetched independently. */
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
 * Keyed on the username because that is what the endpoint takes, which is also why this read is
 * the second hop of the profile page's waterfall: the id is in the URL and the username only
 * arrives with the profile. That is a property of the API rather than of the screen, so the fix is
 * not to parallelise it but to *not send it* until the favourites tab is opened — which is what
 * `SKIP` is for, and what this screen was failing to do for two whole requests.
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
 * The one read in the catalogue that builds its own URL, because there is no `lib/api` function
 * for it — the profile page had this `fetch` written inline, and it is the endpoint AGENTS.md
 * records as having once been reached through a hard-coded `https://picpony.top/api.php` rather
 * than the relative base. It goes through `PICPONY_API_BASE` here for the same reason: the route
 * handler is what rewrites the backend's `Secure` session cookie.
 *
 * The token is in the key rather than merely in the header, because the answer depends on it — a
 * signed-in owner sees uploads a visitor does not.
 */
export const userUploads = defineResource<
  { id: string; page: number; perPage: number; token: string | null },
  { uploads: UploadItem[]; totalPages: number }
>({
  name: 'user-uploads',
  key: ({ id, page, perPage, token }) => `${id}:${page}/${perPage}:${token ? 'auth' : 'anon'}`,
  ttl: 2 * MINUTES,
  maxEntries: 12,
  fetch: async ({ id, page, perPage, token }, signal) => {
    const res = await fetch(
      `${PICPONY_API_BASE}?action=get_user_uploads&user_id=${encodeURIComponent(id)}` +
        `&page=${page}&per_page=${perPage}${token ? `&token=${encodeURIComponent(token)}` : ''}`,
      { signal },
    );
    const data = await readJson(res);
    if (!data?.success) return { uploads: [], totalPages: 1 };
    return { uploads: data.uploads ?? [], totalPages: Math.max(1, data.total_pages || 1) };
  },
});

// ---------------------------------------------------------------------------
// The signed-in screens
// ---------------------------------------------------------------------------

/** PicPony's own favourites list — ids, looked up as images through `imagesByIds`. */
export const faveIds = defineResource<{ token: string }, number[]>({
  name: 'fave-ids',
  key: ({ token }) => token,
  ttl: 1 * MINUTES,
  maxEntries: 2,
  fetch: async ({ token }) => {
    const res = await picpony.getFaves(token);
    /* Thrown, not flattened to `[]`. A failed read and an empty favourites list are different
       answers, and returning the empty one for both makes a server error render as 暂无收藏 with no
       way to retry — which is what the call site's own `throw` used to prevent. */
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
  /* Short, because the screen's own buttons change the answer. A claim writes through with
     `tasks.write(...)`, and this is the backstop for a claim made in another tab. */
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
 * The signed-in user's 屏蔽组.
 *
 * Typed rather than `unknown`, because it now has a consumer. It was warmed by
 * `lib/prefetchRoute.ts` on a sidebar hover and read by nobody — `/block-groups` called
 * `api.getBlockGroups` in an effect of its own — so the hover sent a request whose answer
 * was thrown away. That is the one thing this app's speculation rule forbids: a prefetch
 * may move a request earlier, never add one.
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
  /* /about's roster. Half an hour, because it changes when somebody joins the team. */
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
