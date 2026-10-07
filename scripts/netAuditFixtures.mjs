/**
 * Canned upstream answers for `net:audit`.
 *
 * The audit counts how many requests the app *decides* to send and in how many rounds — both
 * properties of the code. The real upstream (reachable but slow, with `proxyFetch`'s retry ladder
 * turning one logical read into one *or three* depending on the day) makes the count itself
 * non-deterministic, so every data request is fulfilled here and only documents, chunks and fonts
 * reach the local `next start`. Cost given up: a stub cannot catch a payload-shape regression or
 * see the retry ladder — run `--live` for that. Every envelope below is the *success* shape;
 * failure paths would want their own fixture set.
 */

const ORIGIN = 'https://derpicdn.net/img/2024/1/1';

/** Public get_block_tags wire shape verified 2026-09-12: flat rows plus grouped rows.
 * Keep this fixture independent of the implementation so reading `tags` as a dictionary fails. */
export function blockFiltersEnvelope() {
  const rules = {
    safe: ['explicit', 'questionable', 'suggestive', 'grotesque', 'grimdark', 'spoiler', 'islamic state', 'politics', 'semi-grimdark'],
    spoilers: ['explicit', 'questionable', 'grotesque', 'grimdark', 'islamic state'],
    banAnthro: ['anthro', 'humanized', 'morbidly obese'],
    banDiscomfort: ['overweight', 'obese', 'obesity', 'nightmare fuel', 'politics', 'watersports', 'poofy diaper'],
    onlyPony: ['pony', 'kirin', 'griffon', 'hippogriff', 'changeling', 'zebra'],
  };
  let id = 0;
  const tags = Object.entries(rules).flatMap(([filter_key, names]) => names.map((tag_name) => ({
    id: ++id, filter_key, tag_name, created_at: '2026-09-12 00:00:00',
  })));
  const grouped = Object.fromEntries(Object.keys(rules).map((key) => [key, tags.filter((tag) => tag.filter_key === key)]));
  return { success: true, tags, grouped };
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

const forumPost = (id) => ({
  id,
  title: `帖子 ${id}`,
  content: '正文',
  username: 'fixture',
  user_id: 1,
  avatar: null,
  created_at: '2024-01-01T00:00:00Z',
  comment_count: 2,
  view_count: 10,
  is_pinned: 0,
  cover_image: null,
});

const user = (id) => ({
  id: Number(id) || 1,
  username: 'fixture',
  avatar: '',
  banner: '',
  role: 'user',
  bio: '',
  gender: '',
  birthday: '',
  created_at: '2024-01-01T00:00:00Z',
  derpi_username: '',
  derpi_user_id: '',
  experience: 1350,
  equipped_badges: [],
  last_online: '2024-01-01T00:00:00Z',
  has_api_key: false,
  settings: {
    videoPreview: true,
    showTagCounts: true,
    banAnthro: false,
    onlyPony: false,
    useCdn: false,
    contentFilter: 'safe',
    theme: 'default',
  },
});

/**
 * `action` → envelope, for PicPony's single endpoint. A missing action falls through to
 * `{ success: false }` rather than a 404: the app branches on `success` everywhere, and a
 * non-error shape keeps a new screen's request visible in the ledger.
 */
const PICPONY = {
  get_block_tags: blockFiltersEnvelope,
  /* The live shape; empty, so no journey's feed query changes. */
  get_public_blacklist: () => ({ success: true, blacklist: [] }),
  /* `auto` on both axes — what an administrator who has pinned nothing leaves. */
  get_maintenance_status: () => ({
    success: true,
    maintenance_mode: false,
    maintenance_message: '',
    translate_enabled: true,
    global_api_route_policy: 'auto',
    global_image_route_policy: 'auto',
    global_api_third_party_url: '',
    global_api_third_party_pass_api_key: false,
  }),
  /* No announcement, so the modal stays shut and does not add a paint to every journey. */
  get_announcement: () => ({ success: false }),
  get_announcement_history: () => ({ success: true, announcements: [] }),
  /* The empty /search screen's own first read, and what a `<Link>` to it warms (`prefetchRoute`).
     With no fixture here the warm failed, and a failure is not a cached answer — the screen read
     again and the step cost two requests, which the ledger read as speculation adding one. */
  get_quick_tags: () => ({ success: true, tags: {
    rating: [{ en: 'safe', cn: '安全' }, { en: 'suggestive', cn: '性暗示' }],
    species: [{ en: 'pony', cn: '小马' }, { en: 'human', cn: '人类' }],
    character: [{ en: 'twilight sparkle', cn: '暮光闪闪' }, { en: 'rainbow dash', cn: '云宝黛西' }],
    general: [{ en: 'solo', cn: '单人' }, { en: 'cute', cn: '可爱' }],
  } }),
  /* The shared journeys have no decorative companion or selected pony. Successful empty
     reads keep a disabled feature cached; the dedicated runtime probes exercise real media. */
  get_mascot_config: () => ({ success: true, enabled: false, id: '', name: '', mascot_image: '', tips: [], mascots: [] }),
  get_available_ponies: () => ({ success: true, enabled: true, ponies: [] }),
  get_my_ponies: () => ({ success: true, ponies: [] }),
  get_pony_configs: () => ({ success: true, configs: [] }),
  assistant_quota: () => ({ success: true, quota: { enabled: true, user_enabled: true, remaining: 50,
    daily_remaining: 50, purchased_remaining: 0, reserved: 0, daily_points: 50, points_per_coin: 2, coins: 100 } }),
  assistant_permission: () => ({ success: true, permission: { mode: 'default' } }),
  get_user: () => ({ success: true, user: user(1) }),
  /* A bound Derpibooru account: a profile's uploads tab is that account's Derpibooru uploads
     (`userUploads` in lib/resources.ts). PicPony has no uploads action. */
  get_user_profile: (params) => ({
    success: true,
    user: { ...user(params.get('user_id')), derpi_user_id: 1, derpi_username: 'fixture', has_api_key: true },
  }),
  get_unread_counts: () => ({ success: true, total_unread: 0, counts: {} }),
  /* PicPony's own comment counts for one grid page (decision 15) — a read that travels as a POST,
     its ids in the body, which the stub does not read. No picture has on-site comments, the live
     answer for most. Without it the envelope failed, and a failed read is not kept, so every
     grid remount re-asked: the ledger charged a Back with a request the app does not make. */
  get_batch_comment_counts: () => ({ success: true, counts: {} }),
  get_forum_posts: () => ({
    success: true,
    posts: Array.from({ length: 15 }, (_, i) => forumPost(i + 1)),
    total_pages: 4,
  }),
  get_forum_post_detail: (params) => ({
    success: true,
    post: forumPost(Number(params.get('id') ?? params.get('post_id')) || 1),
    comments: [],
    total_pages: 1,
  }),
  get_shared_faves: () => ({
    success: true,
    username: 'fixture',
    folder_name: '主收藏夹',
    faves: Array.from({ length: 30 }, (_, i) => 2000 + i),
  }),
  get_user_posts: () => ({
    success: true,
    posts: Array.from({ length: 12 }, (_, i) => forumPost(100 + i)),
    total_pages: 2,
  }),
  get_user_comments: () => ({
    success: true,
    comments: Array.from({ length: 12 }, (_, i) => ({
      id: i + 1,
      body: '评论',
      created_at: '2024-01-01T00:00:00Z',
      type: 'image',
      target_id: 1000 + i,
      target_title: '图片',
    })),
    total_pages: 2,
  }),
  /* Two real rows rather than an empty list: the roster is server-rendered, and an empty fixture
     would make the one journey that proves it indistinguishable from a broken one. */
  get_team_members: () => ({
    success: true,
    members: [
      { id: 1, name: 'FixtureDev', role: '开发', category: 'developer', avatar_url: null, account_avatar: null, link_url: null, order_num: 1 },
      { id: 2, name: 'FixtureEditor', role: '编辑', category: 'editor', avatar_url: null, account_avatar: null, link_url: null, order_num: 2 },
    ],
  }),
  get_faves: () => ({ success: true, faves: Array.from({ length: 30 }, (_, i) => 2000 + i) }),
  get_fave_folders: () => ({
    success: true,
    folders: [
      { id: 1, name: '主收藏夹', is_main: 1, item_count: 30, latest_image_id: 2029 },
      { id: 2, name: '收藏夹', is_main: 0, item_count: 8, latest_image_id: 2014 },
    ],
  }),
  get_profile_fave_folders: () => ({
    success: true,
    folders: [{ id: 1, name: '主收藏夹', is_main: 1, item_count: 30, latest_image_id: 2029 }],
  }),
  get_browsing_history: () => ({
    success: true,
    history: Array.from({ length: 12 }, (_, i) => ({
      image_id: 4000 + i,
      view_time: '2024-01-01 00:00:00',
      preview_url: image(4000 + i).representations.thumb,
      ...image(4000 + i),
    })),
    total_pages: 3,
  }),
  get_tasks: () => ({
    success: true,
    level: 5,
    experience: 1350,
    coins: 100,
    equipped_badges: [],
    novice_tasks: {
      bind_api: { progress: 1, claimed: 0 },
      verify_api: { progress: 1, claimed: 0 },
      set_bg: { progress: 0, claimed: 0 },
    },
    tasks: {
      login_progress: 1, login_claimed: 0,
      fav_progress: 2, fav_claimed: 0,
      share_progress: 1, share_claimed: 0,
      comment_progress: 0, comment_claimed: 0,
    },
    weekly_tasks: { upload_progress: 2, upload_claimed: 0 },
  }),
  get_block_groups: () => ({ success: true, groups: [] }),
  get_tag_groups: () => ({ success: true, groups: [] }),
  get_tag_subscriptions: () => ({ success: true, subscriptions: [] }),
  get_shop_items: () => ({
    success: true,
    items: [{ id: 4, name: '钥匙扣', description: '现场领取', image_url: '', price: 8, stock: 3, active: 1 }],
  }),
  get_coin_transactions: () => ({
    success: true,
    transactions: [{ amount: 10, reason: '每日登录', created_at: '2024-01-01 08:00:00' }],
  }),
  get_recent_contacts: () => ({ success: true, contacts: [] }),
  get_notifications: () => ({ success: true, notifications: [] }),
  get_interaction_notifications: () => ({
    success: true,
    notifications: [],
    total_pages: 1,
  }),
  get_dictionary: () => ({ success: true, items: [] }),
  get_comments: () => ({ success: true, comments: [] }),
};

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
 * A stub for one request, or `null` to let it through to the local server. Returns
 * `{ body, contentType }`, never a status: every fixture here is a 200.
 */
export function stubFor(rawUrl) {
  let url;
  try {
    url = new URL(rawUrl);
  } catch {
    return null;
  }

  if (url.pathname === '/api.php' || url.pathname.startsWith('/api.php/')) {
    const action = url.searchParams.get('action') ?? '';
    const build = PICPONY[action];
    return {
      body: JSON.stringify(build ? build(url.searchParams) : { success: false, message: `no fixture for ${action}` }),
      contentType: 'application/json',
    };
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

  if (
    /(^|\.)derpicdn\.net$/.test(target.hostname) ||
    target.hostname === 'wsrv.nl' ||
    target.hostname === '147052.xyz' ||
    url.pathname === '/_next/image' ||
    (/(^|\.)picpony\.top$/.test(url.hostname) && url.pathname !== '/api.php')
  ) {
    return { body: PIXEL_PNG_BASE64, contentType: 'image/png', binary: true };
  }

  if (url.pathname === '/search-api/api/upload-search') {
    return { body: JSON.stringify({ success: true, results: [] }), contentType: 'application/json' };
  }

  return null;
}
