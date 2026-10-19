/**
 * Canned upstream answers for `net:audit`.
 *
 * The audit counts how many requests the app *decides* to send and in how many rounds — both
 * properties of the code. The real upstream (reachable but slow, with `proxyFetch`'s retry ladder
 * turning one logical read into one *or three* depending on the day) makes the count itself
 * non-deterministic, so every data request is fulfilled here and only documents, chunks and fonts
 * reach the local `next start`. Cost given up: a stub cannot catch a payload-shape regression or
 * see the retry ladder — run `--live` for that. Every PicPony answer below is the Rust backend's
 * (`/api/v1`) *success* shape, chosen by operation (`scripts/rustRoutes.mjs`); failure paths
 * would want their own fixture set.
 */

import { opOf } from './rustRoutes.mjs';

const ORIGIN = 'https://derpicdn.net/img/2024/1/1';

/** Public `get_block_tags` (`GET /api/v1/filters/block-tags`) wire shape: flat rows plus grouped rows.
 * Keep this fixture independent of the implementation so reading `tags` as a dictionary fails. */
export function blockFiltersEnvelope() {
  const rules = {
    safe: ['explicit', 'questionable', 'suggestive', 'grotesque', 'grimdark', 'spoiler', 'islamic state', 'politics', 'semi-grimdark'],
    spoilers: ['explicit', 'questionable', 'grotesque', 'grimdark', 'islamic state'],
    banAnthro: ['anthro', 'humanized', 'morbidly obese'],
    banDiscomfort: ['overweight', 'obese', 'obesity', 'nightmare fuel', 'politics', 'watersports', 'poofy diaper'],
    onlyPony: ['pony', 'kirin', 'griffon', 'hippogriff', 'changeling', 'zebra'],
  };
  /* The Rust backend's `GET /api/v1/filters/block-tags`: every row, and the five groups as names. */
  let id = 0;
  const tags = Object.entries(rules).flatMap(([filter, names]) => names.map((tag) => ({ id: ++id, filter, tag })));
  const filters = Object.fromEntries(Object.entries(rules).map(([key, names]) => [key, [...names]]));
  return { tags, filters };
}

/** One page of the Rust backend's public blacklist (`GET /api/v1/image-blocklist`). */
export function publicBlacklistPage(ids = []) {
  return { revision: 1, blocks: [...ids].sort((a, b) => a - b), page: 1, limit: 1000, total_count: ids.length, total_pages: ids.length ? 1 : 0, has_more: false };
}

/** One plausible Derpibooru image. Wide by default, so the masonry grid lays out as it would. */
export function image(id, { width = 1600, height = 1200 } = {}) {
  const stem = `${ORIGIN}/${id}`;
  return {
    id,
    width,
    height,
    aspect_ratio: width / height,
    representations: {
      full: `${stem}/full.png`,
      large: `${stem}/large.png`,
      medium: `${stem}/medium.png`,
      small: `${stem}/small.png`,
      tall: `${stem}/tall.png`,
      thumb: `${stem}/thumb.png`,
      thumb_small: `${stem}/thumb_small.png`,
      thumb_tiny: `${stem}/thumb_tiny.png`,
    },
    format: 'png',
    name: `fixture_${id}`,
    view_url: `${stem}/view.png`,
    source_url: null,
    uploader: 'fixture',
    uploader_id: 1,
    created_at: '2024-01-01T00:00:00Z',
    size: 1024,
    score: 42,
    comment_count: 3,
    tags: ['pony', 'safe', 'solo'],
    description: '',
    upvotes: 40,
    downvotes: 2,
  };
}

/** A page of images, sized so `hasMore` reads true at the app's own 50 per page. */
function imagePage(count, seed = 1000) {
  const heights = [1200, 1600, 900, 2000, 1400];
  return {
    total: 5000,
    images: Array.from({ length: count }, (_, i) =>
      image(seed + i, { width: 1600, height: heights[i % heights.length] }),
    ),
  };
}

const STAMP = '2024-01-01T00:00:00Z';

const author = (id = 1) => ({ id, username: 'fixture', avatar: null, role: 'user', experience: 1350, equipped_badges: [] });

/** A forum post as `GET /forum/posts` and `GET /forum/posts/{id}` answer it (`WirePost`). */
const forumPost = (id) => ({
  id,
  user_id: 1,
  title: `帖子 ${id}`,
  excerpt: '正文',
  content: { type: 'discussion', html: '<p>正文</p>' },
  cover_image: null,
  category: 'discussion',
  is_pinned: false,
  views: 10,
  revision: 1,
  created_at: STAMP,
  updated_at: STAMP,
  author: author(),
  reply_count: 2,
  like_count: 0,
  is_liked: false,
});

/** `GET /me`'s `user` (`auth::me`, `MeUser`). */
const me = () => ({
  id: 1,
  username: 'fixture',
  email: null,
  email_verified: false,
  role: 'user',
  coins: 100,
  experience: 1350,
  avatar: null,
  banner: null,
  bio: '',
  gender: '',
  race: '',
  birthday: null,
  created_at: STAMP,
  profile_revision: 1,
  settings: {
    videoPreview: true,
    showTagCounts: true,
    banAnthro: false,
    onlyPony: false,
    useCdn: false,
    contentFilter: 'safe',
    theme: 'default',
  },
  settings_revision: 1,
  upstream_identity: null,
  developer_access: {
    user_id: 1, revision: 1, enabled: false, active: false, banned: false, source: null,
    maintenance_generation: 0, maintenance_expires_at: null, inactive_reason: null, attempts: 0,
  },
});

/**
 * A public profile (`GET /users/{id}`, `WireProfile`) with a bound Derpibooru account: a
 * profile's uploads tab is that account's Derpibooru uploads (`userUploads` in lib/resources.ts).
 * PicPony has no uploads resource.
 */
const profile = (id) => ({
  id: Number(id) || 1,
  username: 'fixture',
  avatar: null,
  banner: null,
  role: 'user',
  bio: '',
  gender: '',
  race: '',
  experience: 1350,
  level: 14,
  created_on: STAMP,
  last_online: STAMP,
  ip_location: '',
  visibility: { showUploads: true, showFaves: true, showPosts: true, showComments: true },
  badges: [],
  equipped_badges: [],
  upstream_identity: { id: 1, name: 'fixture' },
});

const folder = (id, name, isMain, count, latest) => ({ id, name, is_main: isMain, created_at: STAMP, image_count: count, latest_image_id: latest });

/** The last path segment as a number — the `{id}` of a resource path. */
const lastId = (url) => Number(url.pathname.split('/').filter(Boolean).at(-1)) || 1;

const task = (name, period, progress, required, coins) => ({
  task: name, period, progress, required, claimed: false, reward: { coins, experience: 10 },
});

/**
 * Operation id (`scripts/rustRoutes.mjs`, the old action names) → the Rust backend's 200 body,
 * as each adapter in `lib/api/` reads it: a bare DTO, no `success`. An operation with no fixture
 * answers 404 `{"error":{"code":"NO_FIXTURE"}}` — the transport's typed failure — so a new
 * screen's request is still visible in the ledger.
 */
const PICPONY = {
  get_block_tags: blockFiltersEnvelope,
  /* The live shape; empty, so no journey's feed query changes. */
  get_public_blacklist: () => publicBlacklistPage([]),
  /* `auto` on both axes — what an administrator who has pinned nothing leaves. */
  get_website_routing_policy: () => ({
    policy: { api_policy: 'auto', media_policy: 'auto', third_party_url: null, third_party_pass_api_key: false },
    revision: 1,
  }),
  get_public_maintenance_status: () => ({ maintenance_mode: false, maintenance_message: '' }),
  get_maintenance_status: () => ({ maintenance_mode: false, maintenance_message: '' }),
  get_translation_settings: () => ({ translate_enabled: true }),
  get_semantic_search_settings: () => ({
    semantic_search_enabled: false,
    semantic_search_mode: 'off',
    semantic_cloud_enabled: false,
    semantic_cloud_has_key: false,
    semantic_cloud_configured: false,
    semantic_cloud_timeout_ms: 8000,
    semantic_search_estimate_ms: null,
  }),
  get_tag_translations: () => ({ translations: {}, categories: {} }),
  /* No announcement, so the modal stays shut and does not add a paint to every journey. */
  get_announcement: () => ({ announcement: null }),
  get_announcement_history: () => ({ announcements: [], next_cursor: null }),
  /* The empty /search screen's own first read, and what a `<Link>` to it warms (`prefetchRoute`).
     With no fixture here the warm failed, and a failure is not a cached answer — the screen read
     again and the step cost two requests, which the ledger read as speculation adding one. */
  get_quick_tags: () => ({ tags: {
    rating: [{ en: 'safe', cn: '安全', category: 'rating' }, { en: 'suggestive', cn: '性暗示', category: 'rating' }],
    species: [{ en: 'pony', cn: '小马', category: 'species' }, { en: 'human', cn: '人类', category: 'species' }],
    character: [{ en: 'twilight sparkle', cn: '暮光闪闪', category: 'character' }, { en: 'rainbow dash', cn: '云宝黛西', category: 'character' }],
    general: [{ en: 'solo', cn: '单人', category: 'general' }, { en: 'cute', cn: '可爱', category: 'general' }],
  } }),
  /* The shared journeys have no decorative companion or selected pony. Successful empty
     reads keep a disabled feature cached; the dedicated runtime probes exercise real media. */
  get_mascots_list: () => ({ enabled: false, revision: 1, tips: [], mascots: [] }),
  get_available_ponies: () => ({ enabled: true, ponies: [] }),
  get_my_ponies: () => ({ ponies: [] }),
  get_pony_configs: () => ({ configs: [] }),
  assistant_config: () => ({ model_configured: true, quota: assistantQuota() }),
  assistant_quota: () => assistantQuota(),
  assistant_permission: () => ({ mode: 'default', revision: 1 }),
  get_user: () => ({ user: me() }),
  get_user_profile: (url) => ({ user: profile(lastId(url)) }),
  get_unread_counts: () => ({ messages: 0, notifications: 0, interactions: 0, forum: 0 }),
  /* PicPony's own comment counts for one grid page (decision 15) — a read that travels as a POST,
     its ids in the body, which the stub does not read. No picture has on-site comments, the live
     answer for most. Without it the read failed, and a failed read is not kept, so every grid
     remount re-asked: the ledger charged a Back with a request the app does not make. */
  get_batch_comment_counts: () => ({ counts: {} }),
  get_forum_posts: () => ({
    posts: Array.from({ length: 15 }, (_, i) => forumPost(i + 1)),
    total: 60,
    page: 1,
    total_pages: 4,
  }),
  get_forum_post_detail: (url) => ({ post: forumPost(lastId(url)) }),
  get_forum_post_comments: () => ({ comments: [], total: 0, total_pages: 1 }),
  get_shared_faves: () => ({ image_ids: Array.from({ length: 30 }, (_, i) => 2000 + i), total: 30 }),
  get_user_posts: () => ({
    posts: Array.from({ length: 12 }, (_, i) => ({
      id: 100 + i, title: `帖子 ${100 + i}`, cover_image: null, created_at: STAMP, reply_count: 2, like_count: 0,
    })),
    total_pages: 2,
  }),
  get_user_comments: () => ({
    comments: Array.from({ length: 12 }, (_, i) => ({
      id: i + 1, target_id: 1000 + i, content: '评论', created_at: STAMP, kind: 'image',
    })),
    total_pages: 2,
  }),
  /* Two real rows rather than an empty list: the roster is server-rendered, and an empty fixture
     would make the one journey that proves it indistinguishable from a broken one. */
  get_team_members: () => ({
    revision: 1,
    members: [
      { id: 1, name: 'FixtureDev', role: '开发', category: 'developer', avatar_url: '', account_avatar: null, link_url: '', order_num: 1, user_id: null },
      { id: 2, name: 'FixtureEditor', role: '编辑', category: 'editor', avatar_url: '', account_avatar: null, link_url: '', order_num: 2, user_id: null },
    ],
    total_pages: 1,
  }),
  get_faves: () => ({
    items: Array.from({ length: 30 }, (_, i) => ({ image_id: 2000 + i, created_at: STAMP, folder_ids: [1] })),
    total: 30,
  }),
  get_fave_folders: () => ({
    folders: [folder(1, '主收藏夹', true, 30, 2029), folder(2, '收藏夹', false, 8, 2014)],
    privacy_space: {
      owner_id: 1, has_password: false, unlock_seconds: 0, active: false, unlocked: false, expires_at: null,
      visible: false, image_count: null,
    },
  }),
  get_profile_fave_folders: () => ({ folders: [folder(1, '主收藏夹', true, 30, 2029)] }),
  get_browsing_history: () => ({
    revision: 1,
    entries: Array.from({ length: 12 }, (_, i) => ({
      image_id: 4000 + i,
      preview_url: image(4000 + i).representations.thumb,
      uploader: 'fixture',
      viewed_at: STAMP,
      previous_viewed_at: null,
    })),
    total_pages: 3,
  }),
  get_tasks: () => ({
    coins: 100,
    experience: 1350,
    level: 14,
    tasks: [
      task('novice_bind_api', 'once', 1, 1, 50),
      task('novice_verify_api', 'once', 1, 1, 50),
      task('novice_set_bg', 'once', 0, 1, 50),
      task('login', 'daily', 1, 1, 5),
      task('fav', 'daily', 2, 3, 5),
      task('share', 'daily', 1, 1, 5),
      task('comment', 'daily', 0, 1, 5),
      task('weekly_upload', 'weekly', 2, 5, 30),
    ],
  }),
  get_block_groups: () => ({ groups: [] }),
  get_tag_groups: () => ({ groups: [] }),
  get_tag_subscriptions: () => ({ subscriptions: [] }),
  get_shop_items: () => ({
    items: [{ id: 4, name: '钥匙扣', description: '现场领取', image_url: null, price: 8, stock: 3, active: true, revision: 1, created_at: STAMP }],
    next_cursor: null,
  }),
  get_coin_transactions: () => ({
    transactions: [{ id: 1, amount: 10, balance_after: 100, reason: '每日登录', source_type: 'task', source_id: 'login', created_at: STAMP }],
    next_cursor: null,
  }),
  get_recent_contacts: () => ({ contacts: [], next_cursor: null }),
  get_notifications: () => ({ notifications: [], next_cursor: null }),
  get_dictionary: () => ({ tags: [], total_matches: 0, stats: { total: 0, translated: 0, leaderboard: [] } }),
  get_comments: () => ({ comments: [], total: 0, total_pages: 1 }),
};

function assistantQuota() {
  return {
    enabled: true, user_enabled: true, revision: 1, config_revision: 1, daily_points: 50, points_per_coin: 2,
    daily_remaining: 50, purchased_remaining: 0, remaining: 50, reserved: 0, coins: 100,
  };
}

/** Derpibooru path → envelope. Matched on the path with the `/api/v1/json` prefix removed. */
const DERPI = [
  /* Seeded on the page number, so page 2's ids differ from page 1's — otherwise every page is
     byte-identical and a probe cannot tell a cache hit from a re-fetch. */
  [
    /^\/search\/images$/,
    (params) => {
      const ids = [...(params.get('q') ?? '').matchAll(/(?<![-\w])id:(\d+)/g)].map((match) => Number(match[1]));
      if (ids.length) {
        const unique = [...new Set(ids)];
        return { images: unique.slice(0, Number(params.get('per_page')) || 50).map((id) => image(id)), total: unique.length };
      }
      return imagePage(Number(params.get('per_page')) || 50, 1000 + (Number(params.get('page')) || 1) * 1000);
    },
  ],
  [/^\/images\/featured$/, () => ({ image: image(9001, { width: 1920, height: 1080 }), interactions: [] })],
  [/^\/images\/\d+$/, (_params, pathname) => ({ image: image(Number(pathname.split('/').pop())) })],
  [/^\/search\/tags$/, () => ({ tags: [], total: 0 })],
  [/^\/profiles\/.+$/, () => ({ user: { id: 1, name: 'fixture', slug: 'fixture', awards: [] } })],
];

/** 1x1 transparent PNG, for anything that would otherwise fetch a picture. */
export const PIXEL_PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/58BAwAI/AL+4d0hFQAAAABJRU5ErkJggg==';

/**
 * The inner URL of a line wrapper, or the URL itself. The accel worker and the relay both carry
 * their target in `?url=`, so dispatching on the outer URL would answer every Derpibooru read
 * with one envelope — and unwrapping keeps the fixtures independent of the chosen line.
 */
export function unwrapLine(url) {
  const inner = url.searchParams.get('url');
  if (!inner) return url;
  try {
    return new URL(inner);
  } catch {
    return url;
  }
}

/**
 * PicPony's Rust backend: `/api/v1/…` on any host (this app's proxy in the browser, the fixture
 * port on the server). Derpibooru's API is `/api/v1/json/…` too, and is never this.
 */
export function isPicponyApi(url) {
  return /^\/api\/v1(\/|$)/.test(url.pathname) && !/^\/api\/v1\/json(\/|$)/.test(url.pathname);
}

/**
 * A stub for one request, or `null` to let it through to the local server. Returns
 * `{ body, contentType }`, plus `status` for the one non-200 answer (a PicPony operation with no
 * fixture, 404). `method` is the request's; callers that only have the URL may leave it out.
 */
export function stubFor(rawUrl, method) {
  let url;
  try {
    url = new URL(rawUrl);
  } catch {
    return null;
  }

  const target = unwrapLine(url);
  if (/(^|\.)(derpibooru\.org|trixiebooru\.org)$/.test(target.hostname)) {
    const pathname = target.pathname.replace('/api/v1/json', '');
    for (const [pattern, build] of DERPI) {
      if (pattern.test(pathname)) {
        return { body: JSON.stringify(build(target.searchParams, pathname)), contentType: 'application/json' };
      }
    }
    return { body: JSON.stringify({ images: [], total: 0 }), contentType: 'application/json' };
  }

  if (isPicponyApi(url)) {
    /* Without a method (a caller that only has the URL), a read is assumed; the two reads that
       travel as a POST (`get_batch_comment_counts`, `get_pony_configs`) are found either way. */
    const op = method ? opOf(method, url.href) : (opOf('GET', url.href) ?? opOf('POST', url.href));
    const build = op ? PICPONY[op] : undefined;
    if (!build) {
      return {
        status: 404,
        body: JSON.stringify({ error: { code: 'NO_FIXTURE', message: `no fixture for ${op ?? url.pathname}` } }),
        contentType: 'application/json',
      };
    }
    return { body: JSON.stringify(build(url)), contentType: 'application/json' };
  }

  if (
    /(^|\.)derpicdn\.net$/.test(target.hostname) ||
    target.hostname === 'wsrv.nl' ||
    target.hostname === '147052.xyz' ||
    url.pathname === '/_next/image' ||
    (/(^|\.)picpony\.top$/.test(url.hostname) && !isPicponyApi(url))
  ) {
    return { body: PIXEL_PNG_BASE64, contentType: 'image/png', binary: true };
  }

  if (url.pathname === '/search-api/api/upload-search') {
    return { body: JSON.stringify({ results: [] }), contentType: 'application/json' };
  }

  return null;
}
