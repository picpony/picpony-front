'use client';

/**
 * The app's reads, as resources.
 *
 * One entry per thing the app asks the server for. `lib/resource.ts` is the primitive; this is
 * the catalogue, and keeping them apart is what lets a screen say `useResource(forumThread,
 * { id })` without knowing anything about queues, TTLs or publication.
 *
 * Every fetch here goes through a strict adapter (`lib/api/*`), so a failure is always an
 * `ApiError` in the snapshot's `error` — never an empty list standing in for one. Its message is
 * the sentence a screen prints; `isRetryable` / `isNotFound` (`lib/api/errors.ts`) decide
 * whether it offers 重试 or a not-found state.
 *
 * ## Reading a TTL
 *
 * Not "how long the data is correct for" — a cached value past its TTL is still shown — but
 * **how long before it is worth asking again while somebody is looking at it**. Short for
 * anything another person can change, long for anything only you can change, longest for
 * effectively immutable content.
 *
 * ## Lanes
 *
 * Each resource names the upstream it waits on (`lane`), and each upstream has its own slots: a
 * slow or rate-limited Derpibooru must not leave the forum, the profile header or the unread
 * badge sitting on skeletons with nothing in flight. A fetch that awaits another resource must
 * await one in a *different* lane, or a full lane could wait on itself.
 *
 * ## What is not here
 *
 * Writes (a mutation still goes through `lib/api/*` directly; `resource.write(...)` only
 * corrects an answer in place) and the opened picture (`lib/detail.ts`, with its own publication
 * gate — it shares the Derpibooru lane's slots).
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

import { useSyncExternalStore } from 'react';
import * as derpi from '@/lib/api/derpi';
import * as picpony from '@/lib/api/picpony';
import * as favorites from '@/lib/api/favorites';
import * as messaging from '@/lib/api/messages';
import * as semantic from '@/lib/api/semantic';
import * as gallery from '@/lib/api/gallery';
import * as translate from '@/lib/api/translate';
import { getBrowsingSettings, readHiddenTags } from '@/lib/api/client';
import { isWithheldBy } from '@/lib/imageFilters';
import { featuredKey, homeFeedKey } from '@/lib/feedKeys';
import { ApiError } from '@/lib/api/errors';
import { defineResource } from '@/lib/resource';
import type { ApiResponse, Comment, PonyImage } from '@/lib/types/image';
import type { ForumPostDetailResponse, ForumPostsResponse } from '@/lib/types/forum';
import * as forum from '@/lib/api/forum';
import type { ForumListQuery } from '@/lib/api/forum';
import { forumListKey } from '@/lib/forumKeys';
import type {
  AnnouncementPage,
  ChatUser,
  Contact,
  ConversationPage,
  NotificationPage,
} from '@/lib/types/message';
import type {
  DerpiProfileUser,
  ProfileFaveFolder,
  ProfileUser,
  UserComment,
  UserPost,
  UserUpload,
  UserUploadsResponse,
} from '@/lib/types/user';
import { hiddenFromVisitors, uploaderTerm } from '@/lib/profiles';
import type { EquippedBadge, HeldBadge } from '@/lib/userBadges';
import type { TeamMember } from '@/lib/types/site';
import * as historyApi from '@/lib/api/history';
import * as taskApi from '@/lib/api/tasks';
import * as blockGroupApi from '@/lib/api/blockGroups';
import type { BlockGroup } from '@/lib/api/blockGroups';
import * as tagGroupApi from '@/lib/api/tagGroups';
import { mirrorBlockGroups } from '@/lib/blockGroupMirror';
import { COOKIE_KEYS, LS_KEYS } from '@/lib/constants';
import { readUserInfo } from '@/lib/hooks';
import {
  currentBlockFilters,
  currentPublicBlacklist,
  withBlockFiltersFingerprint,
} from '@/lib/blockFilters';
import { DEFAULT_BROWSING_FINGERPRINT, UNMIRRORABLE_FINGERPRINT } from '@/lib/searchQuery';
import { adoptCloudSettings, type SettingsSyncBridge } from '@/lib/settingsSync';
import * as shop from '@/lib/api/shop';
import * as subscriptions from '@/lib/api/tagSubscriptions';

export type { ProfileUser, TeamMember, BlockGroup };
export type HistoryItem = historyApi.HistoryEntry;

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
 * The site's rules — the filter definitions and the public blacklist — join it, so an
 * administrator's change is a new key too.
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
        .filter((t): t is string => typeof t === 'string' && t.trim() !== '')
        .map((t) => t.trim().toLowerCase())
        .sort()
        .join(',');
    }
  } catch {
    /* A corrupt list is an empty one, which is what `buildSearchQuery` does with it too. */
  }
  const preferences = [
    s.contentFilter,
    s.banAnthro ? 'a' : '-',
    s.banDiscomfort ? 'd' : '-',
    s.onlyPony ? 'p' : '-',
    hidden,
  ].join('|');
  return withBlockFiltersFingerprint(preferences, currentBlockFilters(), currentPublicBlacklist());
}

function subscribeBrowsing(listener: () => void) {
  const onStorage = (event: StorageEvent) => {
    if (event.key === null || event.key.startsWith('trixie_') || event.key.startsWith('picpony_')) listener();
  };
  window.addEventListener('settings_updated', listener);
  window.addEventListener('storage', onStorage);
  return () => {
    window.removeEventListener('settings_updated', listener);
    window.removeEventListener('storage', onStorage);
  };
}

const serverFingerprint = () => DEFAULT_BROWSING_FINGERPRINT;

/**
 * The fingerprint as a value a component re-renders on — the settings writer, another tab and a
 * rule change all move it. Pass it in a resource's arguments so the key stays pure. The server
 * snapshot is the default fingerprint, which is what a first visit computes anyway.
 */
export function useBrowsingFingerprint(): string {
  return useSyncExternalStore(subscribeBrowsing, browsingFingerprint, serverFingerprint);
}

/**
 * The most a mirrored fingerprint may take once encoded. A browser drops a cookie over 4096
 * bytes whole — and a CJK tag costs nine bytes per character encoded — so past this the write is
 * replaced by the marker rather than attempted.
 */
const MAX_MIRRORED_COOKIE_BYTES = 3500;

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
 * A fingerprint that cannot be mirrored — too long once encoded, or dropped by the browser — is
 * written as `UNMIRRORABLE_FINGERPRINT`, and the server then renders no seed at all: rendering the
 * *default* feed instead put pictures carrying the user's hidden tags into the server HTML.
 *
 * Called from the settings writer, /block-groups' tag writer, and the home island's mount effect
 * as the self-healing catch-all (a cleared browser cookie costs one load, then corrects itself).
 */
export function syncBrowsingCookie() {
  if (typeof document === 'undefined') return;
  const write = (name: string, value: string): boolean => {
    /* Compared **encoded**: a fingerprint always contains a `|`, which serialises as `%7C`, so
       comparing the raw value could never match and the cookie was re-serialised on every call. */
    const cookie = `${name}=${encodeURIComponent(value)}`;
    try {
      const present = () => document.cookie.split(';').some((part) => part.trim() === cookie);
      if (present()) return true;
      document.cookie = `${cookie};path=/;max-age=${60 * 60 * 24 * 365};samesite=lax`;
      return present();
    } catch {
      /* SSR may use its default feed when cookies are blocked; browsing must still work. */
      return false;
    }
  };
  const fingerprint = browsingFingerprint().split('|').slice(0, 5).join('|');
  const fits = encodeURIComponent(fingerprint).length <= MAX_MIRRORED_COOKIE_BYTES;
  if (!fits || !write(COOKIE_KEYS.browsing, fingerprint)) write(COOKIE_KEYS.browsing, UNMIRRORABLE_FINGERPRINT);
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
 * shape this endpoint imposes: it answers 200 with an empty body when the PHP session has died.
 * Five minutes: nothing here changes without the user's own action.
 *
 * Every answer carries the account's synced settings, and this is where they arrive — at sign-in,
 * on each load and on each return to the tab — so the cloud sync (`lib/settingsSync.ts`) adopts
 * them here, told when the read was sent.
 */
export const sessionUser = defineResource<{ token: string }, SessionResult>({
  name: 'session-user',
  key: ({ token }) => token,
  ttl: 5 * MINUTES,
  /* Two: the current token and at most one it just replaced. */
  maxEntries: 2,
  fetch: async ({ token }, signal) => {
    const startedAt = Date.now();
    const res = await picpony.getUser(token, signal);
    if (res.status === 401) {
      void res.body?.cancel().catch(() => {});
      return { kind: 'unauthorized' };
    }
    const data = await picpony.readSessionUser(res);
    if (data && !signal.aborted) {
      adoptCloudSettings(token, data, startedAt);
    }
    return data ? { kind: 'ok', user: data } : { kind: 'unreadable' };
  },
});

/**
 * What the settings sync reaches through this module: it re-reads the account through this
 * resource, corrects it after its own write and re-mirrors the browsing cookie. Bound by the
 * shell's `SettingsSync` once it mounts, never here — evaluating this module must not touch
 * `window` (the Node suites import it under stubbed globals).
 */
export const settingsSyncBridge: SettingsSyncBridge = {
  refreshSession: (token) => sessionUser.read({ token }, { force: true }),
  writeSession: (token, settings) => {
    const current = sessionUser.peek({ token }).data;
    if (current?.kind !== 'ok') return;
    sessionUser.write({ token }, { kind: 'ok', user: { ...current.user, settings } });
  },
  afterBrowsingChange: syncBrowsingCookie,
};

export interface UnreadBreakdown {
  total: number;
  messages: number;
  notifications: number;
  interactions: number;
}

/**
 * The unread badge, and the three numbers behind it.
 *
 * One minute, because somebody else puts messages there — and a TTL alone never moves a badge
 * that stays mounted, so the shell reads it with `refetchInterval` (see `useResource`). The
 * breakdown is here rather than only the total because there are two consumers — the shell's
 * badge and /messages' per-tab split — and one shared entry serves both with one request.
 * `/messages` force-reads after marking a tab read, and the shell is subscribed to the same
 * entry, so its badge follows in the same publish.
 */
export const unreadCounts = defineResource<{ token: string }, UnreadBreakdown>({
  name: 'unread-counts',
  key: ({ token }) => token,
  ttl: 1 * MINUTES,
  maxEntries: 2,
  fetch: async ({ token }, signal) => {
    const data = await picpony.getUnreadCounts(token, signal);
    return {
      total: data.total_unread,
      messages: data.unread_messages,
      notifications: data.unread_notifications,
      interactions: data.unread_interactions,
    };
  },
});

// ---------------------------------------------------------------------------
// Messages
// ---------------------------------------------------------------------------

/** 公告, one page. Public (no token) and changed only by an administrator: five minutes. */
export const announcementHistory = defineResource<{ page: number }, AnnouncementPage>({
  name: 'announcement-history',
  key: ({ page }) => String(page),
  ttl: 5 * MINUTES,
  maxEntries: 6,
  fetch: ({ page }, signal) => messaging.readAnnouncementHistory(page, signal),
});

/**
 * 系统 or 互动, one page. `token: null` is a signed-out visitor, who reads the public system
 * list; the interaction list is only ever read with a token. A minute: other people's actions
 * put rows here, and the screen re-reads underneath whenever its tab is selected again.
 */
export const notificationPage = defineResource<
  { token: string | null; type: 'system' | 'interaction'; page: number },
  NotificationPage
>({
  name: 'notifications',
  key: ({ token, type, page }) => `${token ?? 'guest'}:${type}:${page}`,
  ttl: 1 * MINUTES,
  maxEntries: 12,
  fetch: ({ token, type, page }, signal) => messaging.readNotifications(token, type, page, signal),
});

/**
 * 私信's contact list. Thirty seconds, and the screen polls it at that rate while the tab is on
 * screen (owner decision 13); the share dialog reads the same entry.
 */
export const recentContacts = defineResource<{ token: string }, Contact[]>({
  name: 'recent-contacts',
  key: ({ token }) => token,
  ttl: 30 * SECONDS,
  maxEntries: 2,
  fetch: ({ token }, signal) => messaging.readRecentContacts(token, signal),
});

/**
 * One page of a conversation, oldest first. Page 1 — the newest messages — is polled every ten
 * seconds while the conversation is open (decision 13); older pages are read as the thread is
 * scrolled back. Every argument is in the key: a page of one conversation is its own record.
 */
export const conversationPage = defineResource<
  { token: string; withUserId: number; page: number },
  ConversationPage
>({
  name: 'conversation',
  key: ({ token, withUserId, page }) => `${token}:${withUserId}:${page}`,
  ttl: 10 * SECONDS,
  maxEntries: 24,
  fetch: ({ token, withUserId, page }, signal) => messaging.readConversation(token, withUserId, page, signal),
});

/** `search_users`, for starting a conversation — the contact search and the share dialog. */
export const userSearch = defineResource<{ token: string; keyword: string }, ChatUser[]>({
  name: 'user-search',
  key: ({ token, keyword }) => JSON.stringify([token, keyword]),
  ttl: 1 * MINUTES,
  maxEntries: 16,
  fetch: ({ token, keyword }, signal) => messaging.searchUsers(token, keyword, signal),
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
  lane: 'derpi',
  /* The fingerprint is an *argument*, not something the key function reads for itself: a key that
     reads its own inputs can only be computed in the browser, and the server has to compute this
     one to render page 1 and land the seed under this key (or none). Keys must stay pure. */
  key: ({ page, sort, fp }) => homeFeedKey(page, sort, fp),
  ttl: 2 * MINUTES,
  /* A page of 50 images is a large object, so fewer keys than the default: eight pages is more
     back-and-forth than a paged gallery sees in one session. */
  maxEntries: 8,
  fetch: ({ page, sort }, signal) => derpi.getImages(undefined, page, sort, 'desc', signal),
});

/**
 * A page of search results. Same shape as the feed; the query joins the key (which keys on
 * searchParams, so the read stays client-side). Every argument the fetch consumes — including
 * `sortDir` — must be in the key, or ascending and descending would share one cache entry.
 * `fp` makes the key pure when the screen passes it (`useBrowsingFingerprint`); without it the
 * key reads the fingerprint itself, which is right only because this read is never seeded.
 */
export const searchFeed = defineResource<
  { query: string; page: number; sortField?: string; sortDir: 'asc' | 'desc'; fp?: string },
  ApiResponse
>({
  name: 'search-feed',
  lane: 'derpi',
  key: ({ query, page, sortField, sortDir, fp }) =>
    `${query}\n${sortField ?? 'default'}:${sortDir}:${page}:${fp ?? browsingFingerprint()}`,
  ttl: 2 * MINUTES,
  maxEntries: 8,
  fetch: ({ query, page, sortField, sortDir }, signal) =>
    derpi.getImages(query, page, sortField, sortDir, signal),
});

/**
 * What Chinese or natural-language words became — the backend's semantic parse
 * (`lib/api/semantic.ts`), keyed on the words. Half an hour: the answer is the model's reading
 * of fixed text, and every ask costs a model call, so a search you come back to must not ask
 * again. Never prefetched, for the same reason. `timeoutMs` is how long this client waits, not
 * part of the answer, so it is not in the key. A superseded query's parse is released with its
 * key (`release`), which is what cancels it when the query is edited.
 */
export const semanticQuery = defineResource<{ text: string; timeoutMs: number }, semantic.SemanticParse>({
  name: 'semantic-query',
  key: ({ text }) => text,
  ttl: 30 * MINUTES,
  maxEntries: 16,
  fetch: ({ text, timeoutMs }, signal) => semantic.parseSemanticQuery(text, { signal, timeoutMs }),
});

/** /search's quick tags, by category. Changed only by an administrator. */
export const quickTags = defineResource<Record<string, never>, Record<semantic.QuickTagGroup, semantic.QuickTag[]>>({
  name: 'quick-tags',
  key: () => 'all',
  ttl: 30 * MINUTES,
  maxEntries: 1,
  fetch: (_, signal) => semantic.getQuickTags(signal),
});

/**
 * Suggestions for the term being typed, keyed on the term exactly as sent. Many small entries:
 * typing and deleting walks back over keys it has already read, and those answers are instant.
 */
export const tagSuggestions = defineResource<{ keyword: string }, semantic.TagSuggestion[]>({
  name: 'tag-suggestions',
  key: ({ keyword }) => keyword,
  ttl: 10 * MINUTES,
  maxEntries: 48,
  fetch: ({ keyword }, signal) => semantic.suggestTags(keyword, signal),
});

/** The dictionary entry for one tag (its Chinese name and category), or `null` if it has none. */
export const tagEntry = defineResource<{ tag: string }, semantic.TagSuggestion | null>({
  name: 'tag-entry',
  key: ({ tag }) => tag,
  ttl: 10 * MINUTES,
  maxEntries: 24,
  fetch: ({ tag }, signal) => semantic.lookupTag(tag, signal),
});

/**
 * 近日推荐.
 *
 * Ten minutes: the featured picture is chosen upstream once a day, so this TTL is about not
 * looking silly rather than about being right. Keyed on whether a key was sent, since the answer
 * differs for a signed-in Derpibooru account. The *keyed* read stays client-side: `getFeatured`
 * puts the user's API key in the URL, and a shared server cache would leak it. The anonymous one
 * is also read by the server (`readFeatured` in lib/feed.server.ts) and seeded, so the banner —
 * the phone's LCP — is in the first byte. A failure stays a failure (the banner shows its failure
 * state and the next refresh retries) rather than a `null` cached for ten minutes.
 *
 * `contentFilter` is an argument so the key can be computed on the server, which renders with
 * the filter from the fingerprint cookie; callers that omit it get the device's own.
 */
export const featuredImage = defineResource<{ apiKey?: string; contentFilter?: string }, PonyImage | null>({
  name: 'featured',
  lane: 'derpi',
  /* The upstream image filter changes in developer mode, including for the featured read. */
  key: ({ apiKey, contentFilter }) => featuredKey(apiKey, contentFilter ?? getBrowsingSettings().contentFilter),
  ttl: 10 * MINUTES,
  maxEntries: 2,
  fetch: async ({ apiKey }, signal) => (await derpi.getFeatured(apiKey, signal))?.image ?? null,
});

/** A page of 本站讨论, ready for the grid. */
export interface DiscussedResult {
  /** The pictures the device's settings allow, most recently discussed first. */
  images: PonyImage[];
  /** PicPony's own comment count per picture — the cards' `+n` without a second request. */
  comments: Record<number, number>;
  total: number;
  totalPages: number;
  /** Pictures on this page the device's content settings withheld. */
  filtered: number;
  /** Pictures on this page Derpibooru no longer returns (deleted, or pulled from the site). */
  missing: number;
}

/**
 * 本站讨论 (decision 15): the pictures PicPony users have commented on, most recently discussed
 * first — a page of ids from PicPony, then one Derpibooru read for the rows (`id:A OR id:B …`,
 * `per_page` the page's length), put back in PicPony's order.
 *
 * The device's content settings apply here as to every other list (C11), but after the read
 * rather than in the query: filtering client-side is what lets the page say how many it
 * withheld and how many no longer exist, instead of simply coming up short. Keyed on the
 * browsing fingerprint for that reason. Derpibooru's lane: the slot is spent waiting on its read.
 */
export const discussedImages = defineResource<{ page: number; fp: string }, DiscussedResult>({
  name: 'discussed-images',
  lane: 'derpi',
  key: ({ page, fp }) => `${page}:${fp}`,
  ttl: 2 * MINUTES,
  maxEntries: 6,
  fetch: async ({ page }, signal) => {
    const discussed = await gallery.getDiscussedImages(page, signal);
    const ids = discussed.images.map((row) => row.imageId);
    const comments: Record<number, number> = {};
    for (const row of discussed.images) if (row.comments > 0) comments[row.imageId] = row.comments;
    const base = { comments, total: discussed.total, totalPages: discussed.totalPages };
    if (ids.length === 0) return { ...base, images: [], filtered: 0, missing: 0 };
    const found = await derpi.searchImagesByIds(ids, 1, ids.length, signal);
    const rank = new Map(ids.map((id, index) => [id, index]));
    const ordered = [...found.images].sort(
      (a, b) => (rank.get(a.id) ?? Number.MAX_SAFE_INTEGER) - (rank.get(b.id) ?? Number.MAX_SAFE_INTEGER),
    );
    const settings = { ...getBrowsingSettings(), hiddenTags: readHiddenTags() };
    const filters = currentBlockFilters();
    const images = ordered.filter((image) => !isWithheldBy(image.tags, settings, filters));
    return {
      ...base,
      images,
      filtered: ordered.length - images.length,
      missing: Math.max(0, ids.length - ordered.length),
    };
  },
});

/**
 * PicPony's own comment counts for one grid page — the `+n` beside Derpibooru's count on every
 * card (decision 15). A decoration: the grid never waits for it, and a failure shows the
 * Derpibooru count alone.
 */
export const siteCommentCounts = defineResource<{ ids: readonly number[] }, Record<number, number>>({
  name: 'site-comment-counts',
  key: ({ ids }) => ids.join(','),
  ttl: 2 * MINUTES,
  maxEntries: 12,
  fetch: ({ ids }, signal) => gallery.getBatchCommentCounts(ids, signal),
});

// ---------------------------------------------------------------------------
// The image detail (the picture's own record is `lib/detail.ts`'s)
// ---------------------------------------------------------------------------

/**
 * The comments written on PicPony, newest first — the whole thread in one answer. A minute:
 * somebody else may be writing. A post or a delete corrects it in place (`write`) or re-reads it
 * under what is shown (`invalidate`).
 */
export const siteComments = defineResource<{ imageId: number }, Comment[]>({
  name: 'site-comments',
  key: ({ imageId }) => String(imageId),
  ttl: 1 * MINUTES,
  maxEntries: 16,
  fetch: ({ imageId }, signal) => picpony.getSiteComments(imageId, signal),
});

/** One page of the comments Derpibooru holds for a picture, newest first, with the total. */
export const derpiComments = defineResource<
  { imageId: number; page: number },
  { comments: Comment[]; total: number }
>({
  name: 'derpi-comments',
  lane: 'derpi',
  key: ({ imageId, page }) => `${imageId}:${page}`,
  ttl: 2 * MINUTES,
  maxEntries: 24,
  fetch: ({ imageId, page }, signal) => derpi.getImageComments(imageId, page, signal),
});

/**
 * Whether the one-click image translation is switched on (`translate_enabled`). Ten minutes: an
 * administrator's switch, read once per visit rather than per picture.
 */
export const translateSwitch = defineResource<Record<string, never>, boolean>({
  name: 'translate-switch',
  key: () => 'translate',
  ttl: 10 * MINUTES,
  maxEntries: 1,
  fetch: (_args, signal) => translate.readTranslateEnabled(signal),
});

// ---------------------------------------------------------------------------
// The forum
// ---------------------------------------------------------------------------

/**
 * One page of the forum list, in a category and an order, optionally searched. Every argument is
 * in the key (`lib/forumKeys.ts`, shared with the server seed of the first page). A signed-in read
 * carries the token — the rows then say what this viewer has liked and not yet read — and so is a
 * different answer from a visitor's.
 */
export const forumPosts = defineResource<ForumListQuery, ForumPostsResponse>({
  name: 'forum-posts',
  key: (args) => forumListKey(args),
  ttl: 1 * MINUTES,
  maxEntries: 12,
  fetch: (args, signal) => forum.getForumPosts(args, signal),
});

/**
 * One thread.
 *
 * Thirty seconds, the shortest TTL in the catalogue: a reply can appear while you are reading,
 * and a short TTL is what makes returning from a tab land on the replies rather than on what was
 * there when you left. A missing or malformed id is a `notFound` error.
 */
export const forumThread = defineResource<{ id: string; page: number; token?: string | null }, ForumPostDetailResponse>({
  name: 'forum-thread',
  /* The page is in the key *and* in the fetch. Keys must be complete, not merely unique: a flat
     id-only key would carry page 4 of one thread into page 2 (unique is not the same as
     sufficient — each page is its own record). The token too: the viewer's like is in it. */
  key: ({ id, page, token }) => `${id}:${page}:${token || 'guest'}`,
  ttl: 30 * SECONDS,
  maxEntries: 12,
  fetch: ({ id, page, token }, signal) => forum.getForumPostDetail(id, page, signal, token),
});

/** The viewer's own tag groups and block groups, for a 标签组分享 post. A minute: they change here. */
export const shareableGroups = defineResource<
  { token: string },
  { tagGroups: forum.ShareableTagGroup[]; blockGroups: forum.ShareableBlockGroup[] }
>({
  name: 'forum-shareable-groups',
  key: ({ token }) => token,
  ttl: 1 * MINUTES,
  maxEntries: 2,
  fetch: ({ token }, signal) => forum.getMyShareableGroups(token, signal),
});

// ---------------------------------------------------------------------------
// Profiles
// ---------------------------------------------------------------------------

export const derpiUserProfile = defineResource<{ id: string }, DerpiProfileUser>({
  name: 'derpi-user-profile',
  lane: 'derpi',
  key: ({ id }) => id,
  ttl: 5 * MINUTES,
  maxEntries: 12,
  fetch: async ({ id }, signal) => (await derpi.getDerpiProfile(id, signal)).user,
});

/**
 * A Derpibooru account's uploads, with the viewer's exclusions around the query. The content
 * filter is a snapshot (a preference changed while the request waits cannot put another mode's
 * pictures under this key); `fp` carries the rest of the exclusions into the key.
 */
export const derpiUserUploads = defineResource<
  { id: number; page: number; perPage: number; contentFilter: string; fp?: string },
  ApiResponse
>({
  name: 'derpi-user-uploads',
  lane: 'derpi',
  key: ({ id, page, perPage, contentFilter, fp }) =>
    `${id}:${page}/${perPage}:${contentFilter}:${fp ?? ''}`,
  ttl: 2 * MINUTES,
  maxEntries: 8,
  fetch: ({ id, page, perPage, contentFilter }, signal) =>
    derpi.searchDerpiImages(`uploader_id:${id}`, page, perPage, signal, contentFilter),
});

/** A public profile. An unknown id is a `notFound` error (the backend answers an HTML 404). */
export const userProfile = defineResource<{ id: string }, ProfileUser | null>({
  name: 'user-profile',
  key: ({ id }) => id,
  ttl: 5 * MINUTES,
  maxEntries: 12,
  fetch: async ({ id }, signal) => (await picpony.getUserProfile(id, signal)).user,
});

/** A folder of somebody's favourites: whose, the folder's name as the backend gave it, its ids. */
export interface SharedFolder {
  username: string;
  folderName: string | null;
  ids: number[];
}

/**
 * A folder of somebody's favourites, by username — the *ids*, which are then looked up as pictures
 * a page at a time (`favePictures`). `folderId` 0, or none, is their main folder: the original
 * front end's `#mode=shared_faves` link without a folder. The route `/favorites/shared/…` reads
 * it, and so does every change to your own favourites (expired, for your own username).
 *
 * Keyed on the username because that is what the endpoint takes. A refusal carries the server's
 * sentence and is not retryable (an owner's privacy choice); an unknown username is not found. A
 * folder id that does not exist answers like an empty main folder, so the route checks the folder
 * against the owner's public list (`profileFaveFolders`).
 */
export const sharedFaveIds = defineResource<{ username: string; folderId?: number }, SharedFolder>({
  name: 'shared-fave-ids',
  key: ({ username, folderId }) => `${username}
${folderId ?? 0}`,
  ttl: 2 * MINUTES,
  maxEntries: 8,
  fetch: async ({ username, folderId }, signal) => {
    const data = await favorites.getSharedFaves(username, folderId ?? 0, signal);
    return { username: data.username, folderName: data.folder_name?.trim() || null, ids: data.faves };
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
  fetch: async ({ id, page }, signal) => {
    const res = await picpony.getUserPosts(id, page, signal);
    return { posts: res.posts, totalPages: res.total_pages };
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
  fetch: async ({ id, page }, signal) => {
    const res = await picpony.getUserComments(id, page, signal);
    return { comments: res.comments, totalPages: res.total_pages };
  },
});

export type UploadItem = UserUpload;

/**
 * Wait for another resource's read, but stop waiting when `signal` aborts. The other read is
 * left to land in its own cache — it is somebody's profile header — while this one gives up.
 */
function untilAborted<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(signal.reason);
  return new Promise((resolve, reject) => {
    const onAbort = () => reject(signal.reason);
    signal.addEventListener('abort', onAbort, { once: true });
    promise.then(
      (value) => { signal.removeEventListener('abort', onAbort); resolve(value); },
      (error) => { signal.removeEventListener('abort', onAbort); reject(error); },
    );
  });
}

/**
 * A profile's uploads: its bound Derpibooru account's pictures.
 *
 * PicPony never had an uploads action — `get_user_uploads` answered an HTML 404 for every user,
 * so every profile landed on a permanent error with a 重试 that re-sent the same 404. The
 * original front end searched Derpibooru by the profile's bound account, inside the viewer's
 * exclusions and the public blacklist; so does this. The profile comes from `userProfile`
 * (usually already cached or seeded — a different lane, see the module note), and two answers
 * are not lists at all: `binding: 'unbound'` (no account bound) and `binding: 'hidden'` (the
 * owner hides the tab and the viewer is not the owner) — the screen shows each as its own empty
 * state. The token is in the key because the owner sees what visitors do not; `fp` carries the
 * exclusions (it falls back to reading the fingerprint for callers that do not pass it yet).
 */
export const userUploads = defineResource<
  { id: string; page: number; perPage: number; token: string | null; fp?: string },
  UserUploadsResponse
>({
  name: 'user-uploads',
  lane: 'derpi',
  key: ({ id, page, perPage, token, fp }) =>
    `${id}:${page}/${perPage}:${token ?? 'anon'}:${fp ?? browsingFingerprint()}`,
  ttl: 2 * MINUTES,
  maxEntries: 12,
  fetch: async ({ id, page, perPage, token }, signal) => {
    const profile = userProfile.peek({ id }).data ?? await untilAborted(userProfile.read({ id }), signal);
    if (!profile) throw new ApiError('invalid');
    const viewer = token && readUserInfo()?.token === token ? Number(readUserInfo()?.id) : NaN;
    const own = Number.isFinite(viewer) && viewer === Number(profile.id);
    if (!own && hiddenFromVisitors(profile, 'uploads')) {
      return { uploads: [], totalPages: 1, total: 0, binding: 'hidden' };
    }
    const term = uploaderTerm(profile);
    if (!term) return { uploads: [], totalPages: 1, total: 0, binding: 'unbound' };
    const result = await derpi.searchDerpiImages(term, page, perPage, signal);
    return {
      uploads: result.images,
      total: result.total,
      totalPages: Math.max(1, Math.ceil(result.total / perPage)),
      binding: 'bound',
    };
  },
});

/**
 * A profile's public favourite folders — the 收藏夹 tab (decision 15). Keyed on the username
 * because that is what the endpoint takes; not sent until the tab is opened. Each folder opens
 * its own page (`/favorites/shared/<username>/<folderId>`), which reads the folder's pictures.
 */
export const profileFaveFolders = defineResource<{ username: string }, ProfileFaveFolder[]>({
  name: 'profile-fave-folders',
  key: ({ username }) => username,
  ttl: 2 * MINUTES,
  maxEntries: 8,
  fetch: ({ username }, signal) => favorites.getProfileFaveFolders(username, signal),
});

/**
 * The folder covers — each folder's newest picture — in one search, inside the viewer's
 * exclusions and the public blacklist like every other picture list: a cover the viewer's settings
 * withhold is simply absent, and its folder shows the plain face. `fp` carries those rules into
 * the key. At most fifty ids a request (Derpibooru's page size); a longer list reads in chunks.
 */
export const folderCovers = defineResource<{ ids: readonly number[]; fp: string }, Record<number, PonyImage>>({
  name: 'folder-covers',
  lane: 'derpi',
  key: ({ ids, fp }) => `${ids.join(',')}\n${fp}`,
  ttl: 5 * MINUTES,
  maxEntries: 8,
  fetch: async ({ ids }, signal) => {
    const covers: Record<number, PonyImage> = {};
    for (let start = 0; start < ids.length; start += 50) {
      const chunk = ids.slice(start, start + 50);
      const result = await derpi.searchDerpiImages(chunk.map((id) => `id:${id}`).join(' OR '), 1, chunk.length, signal);
      for (const image of result.images) covers[image.id] = image;
    }
    return covers;
  },
});

/**
 * Every badge's description, by name — the badge wall's 简介. Public and rarely edited: one read
 * serves the session, warmed when a pointer or focus reaches the wall.
 */
export const badgeDictionary = defineResource<Record<string, never>, Record<string, string>>({
  name: 'badge-dictionary',
  key: () => 'all',
  ttl: 30 * MINUTES,
  maxEntries: 1,
  fetch: (_args, signal) => picpony.getBadgeDictionary(signal),
});

/**
 * The signed-in user's own badges and worn set — what 管理佩戴 edits. Token-keyed; read when the
 * dialog opens, written in place when a save lands.
 */
export const myBadges = defineResource<{ token: string }, { badges: HeldBadge[]; equipped: EquippedBadge[] }>({
  name: 'my-badges',
  key: ({ token }) => token,
  ttl: 1 * MINUTES,
  maxEntries: 2,
  fetch: ({ token }, signal) => picpony.getMyBadges(token, signal),
});

export interface DictionaryEntry {
  id: number;
  en: string;
  cn: string;
  cat: string;
  count: number;
  description: string;
  aliases: string[];
}

// ---------------------------------------------------------------------------
// The signed-in screens
// ---------------------------------------------------------------------------

/**
 * PicPony's own favourites. Without `folderId` (or 0) it is every folder's — the "is it
 * favourited" list the detail's 收藏 reads, with when each was saved and the folders each is in;
 * with one, that folder's. Token-gated: stays client-side. A failed read throws rather than
 * becoming 暂无收藏. After a change the screens write what they know and `expire()` the rest, so
 * every mounted key is re-read underneath what it shows (`lib/favoritesActions.ts`).
 */
export const faveIds = defineResource<{ token: string; folderId?: number }, favorites.FaveIndex>({
  name: 'fave-ids',
  key: ({ token, folderId }) => `${token}
${folderId ?? 0}`,
  ttl: 1 * MINUTES,
  maxEntries: 8,
  fetch: ({ token, folderId }, signal) => favorites.getFaves(token, folderId ?? 0, signal),
});

/** The account's favourite folders (`get_fave_folders`), and the privacy space's card when the list has one. */
export const faveFolders = defineResource<{ token: string }, favorites.FaveFolderList>({
  name: 'fave-folders',
  key: ({ token }) => token,
  ttl: 1 * MINUTES,
  maxEntries: 2,
  fetch: ({ token }, signal) => favorites.getFaveFolders(token, signal),
});

/**
 * One page of a favourites grid — at most fifty ids, your own or somebody's — as pictures, in
 * Derpibooru's order, through its Everything filter: nothing that exists is left out of the
 * answer, so the screen can apply the device's settings itself and say how many it withheld and,
 * separately, how many no longer exist (C11, `withholdFromDevice` in `lib/favorites.ts`). The
 * request depends on the ids alone, and so does the key. The answer carries the ids it was asked
 * for: a page held over a turn (`keepPrevious`) is withheld against its own ids, not the next
 * page's. Derpibooru's lane.
 */
export const favePictures = defineResource<{ ids: readonly number[] }, { ids: readonly number[]; images: PonyImage[] }>({
  name: 'fave-pictures',
  lane: 'derpi',
  key: ({ ids }) => ids.join(','),
  ttl: 5 * MINUTES,
  maxEntries: 16,
  fetch: async ({ ids }, signal) => ({ ids, images: await favorites.lookupImagesByIds(ids, signal) }),
});

/**
 * The account's Derpibooru favourites, a page at a time (`my:faves`, which needs the account's
 * own API key — in the key, and in memory only, like every token-keyed resource). Read through the
 * Everything filter; the screen applies the device's settings and says what it withheld (C11).
 */
export const derpiFaves = defineResource<{ apiKey: string; page: number }, favorites.DerpiFavesPage>({
  name: 'derpi-faves',
  lane: 'derpi',
  key: ({ apiKey, page }) => `${apiKey}
${page}`,
  ttl: 2 * MINUTES,
  maxEntries: 8,
  fetch: ({ apiKey, page }, signal) => favorites.getDerpiFaves(apiKey, page, favorites.LOOKUP_LIMIT, signal),
});

/**
 * Somebody's privacy space (`get_shared_privacy_faves`): open with its pictures, behind its
 * password, or without one. Signed in only; in memory only, like every resource (signing out
 * clears them all). After the password is accepted the screen reads it again with `force`.
 */
export const sharedPrivacyFaves = defineResource<{ token: string; ownerId: number }, favorites.SharedPrivacyAnswer>({
  name: 'shared-privacy-faves',
  key: ({ token, ownerId }) => `${token}
${ownerId}`,
  ttl: 30 * SECONDS,
  maxEntries: 4,
  fetch: ({ token, ownerId }, signal) => favorites.getSharedPrivacyFaves(token, ownerId, signal),
});

/**
 * 浏览历史, one page — or one page of one calendar day, `YYYY-MM-DD` (the original's 按日期筛选).
 * Token-gated: stays client-side. A minute: opening any picture adds a row.
 */
export const browsingHistory = defineResource<
  { token: string; page: number; date?: string | null },
  historyApi.HistoryPage
>({
  name: 'browsing-history',
  key: ({ token, page, date }) => `${token}:${date || '*'}:${page}`,
  ttl: 1 * MINUTES,
  maxEntries: 8,
  fetch: ({ token, page, date }, signal) => historyApi.getBrowsingHistory(token, { page, date }, signal),
});

/**
 * 等级与任务's document. Short, because a claim changes the answer: the screen re-reads after
 * one, and the TTL is the backstop for a claim in another tab. A checkout and a badge change
 * expire it.
 */
export const tasks = defineResource<{ token: string }, taskApi.TaskDocument>({
  name: 'tasks',
  key: ({ token }) => token,
  ttl: 30 * SECONDS,
  maxEntries: 2,
  fetch: ({ token }, signal) => taskApi.getTasks(token, signal),
});

/**
 * 金币明细, one page (the whole ledger when the backend does not page it — `totalPages: null`).
 * A claim and a checkout add rows, so both expire it.
 */
export const coinTransactions = defineResource<{ token: string; page: number }, taskApi.CoinLedgerPage>({
  name: 'coin-transactions',
  key: ({ token, page }) => `${token}:${page}`,
  ttl: 1 * MINUTES,
  maxEntries: 8,
  fetch: ({ token, page }, signal) => taskApi.getCoinTransactions(token, page, signal),
});

/**
 * The signed-in user's 屏蔽组. Token-gated: stays client-side. A refusal is an error, never an
 * empty list — the empty one invited the user to recreate groups they already had.
 *
 * **Every answer is put in force on this device** (`lib/blockGroupMirror.ts`): the switched-on
 * groups' tags become the lists every image read obeys. The session read starts this one, so a
 * sign-in on a new device applies the account's groups without a visit to /block-groups — the
 * original front end read them at every load. An answer for a session that has since changed is
 * not mirrored.
 */
export const blockGroups = defineResource<{ token: string }, BlockGroup[]>({
  name: 'block-groups',
  key: ({ token }) => token,
  ttl: 5 * MINUTES,
  maxEntries: 2,
  fetch: async ({ token }, signal) => {
    const { groups } = await blockGroupApi.getBlockGroups(token, signal);
    if (!signal.aborted && readUserInfo()?.token === token && mirrorBlockGroups(groups)) syncBrowsingCookie();
    return groups;
  },
});

/** The signed-in user's 标签组. Token-gated. The forum's import and this screen's edits invalidate it. */
export const tagGroups = defineResource<{ token: string }, tagGroupApi.TagGroup[]>({
  name: 'tag-groups',
  key: ({ token }) => token,
  ttl: 5 * MINUTES,
  maxEntries: 2,
  fetch: ({ token }, signal) => tagGroupApi.getTagGroups(token, signal),
});

/**
 * The Derpibooru filters an API key's own account made — what 从 Derpibooru 导入 offers. Keyed by
 * the key, which only ever lives in memory here; read when the dialog opens.
 */
export const derpiFilters = defineResource<{ apiKey: string }, blockGroupApi.DerpiFilterSummary[]>({
  name: 'derpi-filters',
  lane: 'derpi',
  key: ({ apiKey }) => apiKey,
  ttl: 1 * MINUTES,
  maxEntries: 2,
  fetch: ({ apiKey }, signal) => blockGroupApi.getDerpiUserFilters(apiKey, signal),
});

export const teamMembers = defineResource<Record<string, never>, TeamMember[]>({
  name: 'team-members',
  key: () => 'all',
  /* /about's roster; read on the server and handed down as a seed. Half an hour, because it
     changes when somebody joins the team. */
  ttl: 30 * MINUTES,
  maxEntries: 1,
  fetch: async (_, signal) => (await picpony.getTeamMembers(signal)).members,
});

// ---------------------------------------------------------------------------
// The shop and tag subscriptions (D4)
// ---------------------------------------------------------------------------

/**
 * 金币商店's items on sale. Public — `get_shop_items` answers without a token — but the token is
 * sent when there is one, as the original front end sent it, so it is in the key. A minute:
 * other people's purchases move the stock. A checkout invalidates it.
 */
export const shopItems = defineResource<{ token: string | null }, shop.ShopItem[]>({
  name: 'shop-items',
  key: ({ token }) => token ?? 'guest',
  ttl: 1 * MINUTES,
  maxEntries: 2,
  fetch: ({ token }, signal) => shop.getShopItems(token, signal),
});

/**
 * The signed-in user's tag subscriptions: /subscriptions, and the drawer row's count of new
 * pictures (Σ `newCount`), which the drawer reads on every signed-in document as the shell reads
 * the unread badge. Two minutes. A sync, a subscribe, a removal and a 'seen' correct it in place
 * (`components/subscriptions/actions.ts`), so none of them costs a re-read.
 */
export const tagSubscriptions = defineResource<{ token: string }, subscriptions.TagSubscription[]>({
  name: 'tag-subscriptions',
  key: ({ token }) => token,
  ttl: 2 * MINUTES,
  maxEntries: 2,
  fetch: ({ token }, signal) => subscriptions.getTagSubscriptions(token, signal),
});

/**
 * A tag's live Derpibooru count and the name to subscribe under — the subscribe step's lookup
 * (an alias is followed to its tag). Derpibooru's lane: capped with every other Derpibooru read
 * and cancellable. Thirty seconds, because a live count is the point.
 */
export const derpiTagCount = defineResource<{ tag: string }, subscriptions.DerpiTagCount>({
  name: 'derpi-tag-count',
  lane: 'derpi',
  key: ({ tag }) => subscriptions.normaliseTagName(tag),
  ttl: 30 * SECONDS,
  maxEntries: 16,
  fetch: ({ tag }, signal) => subscriptions.lookupDerpiTag(tag, signal),
});

/**
 * One sync batch's live counts — at most fifty names, keyed lower-case, a name Derpibooru does
 * not have simply absent. Derpibooru's lane; the sync reads it at background priority, which can
 * never take a lane's last slot from a screen.
 */
export const derpiTagCounts = defineResource<{ tags: readonly string[] }, Record<string, number>>({
  name: 'derpi-tag-counts',
  lane: 'derpi',
  key: ({ tags }) => tags.join('\n'),
  ttl: 30 * SECONDS,
  maxEntries: 4,
  fetch: ({ tags }, signal) => derpi.getDerpiTagCounts([...tags], signal),
});

/**
 * One page of a subscribed tag's pictures, newest first, inside the viewer's exclusions and the
 * public blacklist — a profile's uploads are read the same way. The content filter is a
 * snapshot (a preference changed while the request waits cannot put another mode's pictures under
 * this key); `fp` carries the rest of the exclusions.
 */
export const tagGallery = defineResource<
  { tag: string; page: number; perPage: number; contentFilter: string; fp: string },
  ApiResponse
>({
  name: 'tag-gallery',
  lane: 'derpi',
  key: ({ tag, page, perPage, contentFilter, fp }) =>
    `${subscriptions.normaliseTagName(tag)}\n${page}/${perPage}:${contentFilter}:${fp}`,
  ttl: 2 * MINUTES,
  maxEntries: 8,
  fetch: ({ tag, page, perPage, contentFilter }, signal) =>
    subscriptions.searchTagImages(tag, page, perPage, signal, contentFilter),
});
