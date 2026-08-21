/** PicPony 自有 API 基础路径 (Next.js rewrite to /api.php) */
export const PICPONY_API_BASE = '/api.php';

/**
 * The same endpoint, absolute, for code that runs on the server.
 *
 * `PICPONY_API_BASE` is relative because the browser needs it to go through
 * `app/api.php/[[...path]]/route.ts` (which rewrites the backend's `Secure`
 * session cookie). Node's `fetch` rejects a relative URL outright, so a server
 * component reaching for the relative form throws `Failed to parse URL` — which
 * is what left `app/user/[id]/layout.tsx`'s `generateMetadata` returning its
 * fallback title on every request since it was written. Must stay in step with
 * `UPSTREAM_ORIGIN` in that route handler.
 */
export const PICPONY_API_ORIGIN = 'https://picpony.top';

/** Derpibooru (Trixiebooru) API 基础路径 */
export const DERPIBOORU_API_BASE = 'https://trixiebooru.org/api/v1/json';

/** PicPony 图片代理加速服务器 */
export const PROXY_API_BASE = 'https://picponyapi.147052.xyz/?url=';

/** 搜索引擎图片搜索 API (Next.js rewrite to picpony.top/search-api) */
export const SEARCH_IMAGE_API = '/search-api/api/upload-search';

/**
 * 浏览器 localStorage 中使用的键
 *
 * Complete, and it has to stay that way: it covered 9 of the 27 keys the app
 * actually writes, so 32 call sites restated a literal that *was* in here — 25 of
 * them in `app/settings/page.tsx`, the one module whose entire job is settings
 * persistence and the one that did not import the table.
 */
export const LS_KEYS = {
  userInfo: 'user_info',
  contentFilter: 'trixie_content_filter',
  banAnthro: 'trixie_ban_anthro',
  banDiscomfort: 'trixie_ban_discomfort',
  onlyPony: 'trixie_only_pony',
  useCdn: 'trixie_use_cdn',
  usePicponyProxy: 'picpony_use_proxy',
  useApiAccel: 'picpony_api_accel',
  homeSort: 'picpony_default_home_sort',
  searchSort: 'picpony_default_search_sort',
  devBannerDismissed: 'picpony_dev_banner_dismissed',
  darkMode: 'darkMode',
  followSystemScheme: 'followSystemPrefersColorScheme',
  sidebarCollapsed: 'sidebar_collapsed',
  derpiApiKey: 'derpi_api_key',
  developer: 'picpony_developer',
  readAnnouncementVersion: 'read_announcement_version',
  itemsPerPage: 'picpony_items_per_page',
  showTagCounts: 'trixie_show_tag_counts',
  showChineseTags: 'picpony_show_chinese_tags',
  showUploads: 'picpony_show_uploads',
  showFaves: 'picpony_show_faves',
  showPosts: 'picpony_show_posts',
  showComments: 'picpony_show_comments',
  emailNotifMessage: 'picpony_email_notif_message',
  emailNotifReply: 'picpony_email_notif_reply',
  activeHiddenTags: 'trixie_active_hidden_tags',
  activeSpoileredTags: 'trixie_active_spoilered_tags',
} as const;

/**
 * Breakpoints, in px, matching Tailwind's defaults.
 *
 * These were previously restated in five places that did not agree with one
 * another: `useDisplay` split at 640/1024, `useMasonryColumns` at 768/1024,
 * `lib/hero/constants.ts` at 640, `ImageCard`'s `sizes` attribute at 767/1023,
 * and the CSS at Tailwind's own values. Anything that has to branch on width in
 * JS reads from here so it stays in step with the `sm:`/`md:`/`lg:` classes.
 */
export const BREAKPOINTS = {
  sm: 640,
  md: 768,
  lg: 1024,
  xl: 1280,
} as const;

/** Media queries derived from the above, for `matchMedia` subscriptions. */
export const MEDIA = {
  sm: `(min-width: ${BREAKPOINTS.sm}px)`,
  md: `(min-width: ${BREAKPOINTS.md}px)`,
  lg: `(min-width: ${BREAKPOINTS.lg}px)`,
  xl: `(min-width: ${BREAKPOINTS.xl}px)`,
  /* The density axis. Not derived from a width: a 1024px tablet is a finger and a
     600px desktop window is not, which is the mistake `Pagination` made when it
     keyed its two sizes on `sm:`. The CSS side is `--touch-floor` plus the
     `pointer-coarse:`/`pointer-fine:` variants in globals.css; these two exist so
     anything branching in JS cannot drift from them, exactly as the four above
     keep JS in step with `sm:`/`md:`. */
  pointerCoarse: '(pointer: coarse)',
  pointerFine: '(pointer: fine)',
} as const;
