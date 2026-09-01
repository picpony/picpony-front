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
  /* `auto` on both axes — what an administrator who has pinned nothing leaves. */
  get_maintenance_status: () => ({
    success: true,
    maintenance_mode: false,
    maintenance_message: '',
    global_api_route_policy: 'auto',
    global_image_route_policy: 'auto',
    global_api_third_party_url: '',
    global_api_third_party_pass_api_key: false,
  }),
  /* No announcement, so the modal stays shut and does not add a paint to every journey. */
  get_announcement: () => ({ success: false }),
  get_announcement_history: () => ({ success: true, announcements: [] }),
  get_user: () => ({ success: true, user: user(1) }),
  get_user_profile: (params) => ({ success: true, user: user(params.get('user_id')) }),
  get_unread_counts: () => ({ success: true, total_unread: 0, counts: {} }),
  get_forum_posts: () => ({
    success: true,
    posts: Array.from({ length: 15 }, (_, i) => forumPost(i + 1)),
    total_pages: 4,
  }),
  get_shared_faves: () => ({
    success: true,
    username: 'fixture',
    faves: Array.from({ length: 30 }, (_, i) => 2000 + i),
  }),
  get_user_uploads: () => ({
    success: true,
    uploads: Array.from({ length: 12 }, (_, i) => ({
      ...image(3000 + i),
      name: `上传 ${i}`,
    })),
    total_pages: 2,
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
  get_browsing_history: () => ({
    success: true,
    history: Array.from({ length: 12 }, (_, i) => ({
      image_id: 4000 + i,
      viewed_at: '2024-01-01T00:00:00Z',
      ...image(4000 + i),
    })),
    total_pages: 3,
  }),
  get_tasks: () => ({ success: true, tasks: [], signed_today: false }),
  get_block_groups: () => ({ success: true, groups: [] }),
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
    (params) =>
      imagePage(Number(params.get('per_page')) || 50, 1000 + (Number(params.get('page')) || 1) * 1000),
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
