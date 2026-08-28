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

/**
 * The `api_accel` line: a Cloudflare Worker that fetches a Derpibooru URL for you.
 *
 * One of the four API lines in `lib/route.ts` — not "the proxy". It answers
 * `GET`/`HEAD`/`OPTIONS` only, so a POST to Derpibooru can never be wrapped in it.
 * Note the host is `picponyapi.147052.xyz` while the *image* worker at
 * `lib/imageLoader.ts` is the bare `147052.xyz`: two hostnames, two pipelines.
 */
export const PROXY_API_BASE = 'https://picponyapi.147052.xyz/?url=';

/**
 * The `picpony_api` line, and the path our own handler answers on.
 *
 * The upstream enforces an `Origin` allowlist of `picpony.top` / `www.picpony.top`
 * and 403s everything else, so the browser cannot reach it from this app's origin
 * at all. `app/relay/route.ts` calls it server-side with `PICPONY_API_ORIGIN` as the
 * `Origin`, which is why the client-facing value here is a path rather than a host.
 */
export const PICPONY_RELAY_UPSTREAM = 'https://cdn.picpony.top/relay';
export const PICPONY_RELAY_PATH = '/relay';

/**
 * The two non-direct image lines.
 *
 * They were private to `lib/imageLoader.ts`, which is where the retry ladder lives;
 * they moved here when `lib/route.ts` became the one module that decides *which*
 * line is in force, because both modules now need to name them. Note the worker is
 * the bare `147052.xyz` while the API line's worker is `picponyapi.147052.xyz` —
 * `getRawImageUrl` is the one place that has to know about both.
 */
export const IMAGE_WORKER_BASE = 'https://147052.xyz/?url=';
export const IMAGE_CDN_BASE = 'https://wsrv.nl/?url=';

/** The fixed thumbnail every image-line probe and the CDN/direct race fetches. */
export const IMAGE_PROBE_URL = 'https://derpicdn.net/img/2017/12/27/1617129/thumb.png';

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
  /* The four line preferences, and they sit on *two* axes — `lib/route.ts` owns the
     split. `useCdn` and `usePicponyProxy` steer images; `useApiAccel` and
     `useHongKongRelay` steer the Derpibooru API. `usePicponyProxy` used to gate the
     API proxy as well, which is how one toggle came to gate both pipelines. */
  useCdn: 'trixie_use_cdn',
  usePicponyProxy: 'picpony_use_proxy',
  useApiAccel: 'picpony_api_accel',
  useHongKongRelay: 'picpony_hk_relay',
  homeSort: 'picpony_default_home_sort',
  /** The tag list whose pictures wear a cover. Was a bare literal at its one call site. */
  spoilerTags: 'trixie_active_spoilered_tags',
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
  palette: 'picpony_palette',
  motion: 'picpony_motion',
  motionSpeed: 'picpony_motion_speed',
  entranceMotion: 'picpony_entrance_motion',
} as const;

/**
 * Cookie names, for the preferences the server has to know before first paint.
 *
 * All five appearance preferences are mirrored into a cookie so `app/layout.tsx`
 * can put them on `<html>` at SSR: without that, the first paint is the default
 * theme and the pre-paint script corrects it, which is a visible flash of the
 * wrong brand on every cold load. The sixth is the sidebar's collapsed state, for
 * the same reason. The names deliberately do *not* all match their `LS_KEYS`
 * counterparts — `darkMode` does and `sidebarCollapsed` does not — which is the
 * reason this table exists rather than the cookie name being derived from the
 * storage key.
 */
export const COOKIE_KEYS = {
  darkMode: 'darkMode',
  /**
   * The active spoiler tags, so the server can draw the cover.
   *
   * `ImageCard` computed `isSpoilered` in an effect from `localStorage`, which was invisible
   * while `/` rendered a skeleton and fetched after hydration. Now the server emits fifty
   * `<img>` tags and the browser paints them *before* that effect runs — so a user who had
   * spoilered a tag saw those pictures uncovered for the whole hydration window on every cold
   * load, which is the one thing the feature exists to prevent. The `q=` filter does not help:
   * a spoiler is a per-tag cover, not a query exclusion.
   *
   * Same shape as `browsing` and `imageLine`: the device mirrors its own preference into a
   * cookie, the layout reads it, and the first render asks the same question the effect will.
   */
  spoilerTags: 'spoilerTags',
  sidebarCollapsed: 'sidebarCollapsed',
  palette: 'palette',
  motion: 'motion',
  motionSpeed: 'motionSpeed',
  entranceMotion: 'entranceMotion',
  /**
   * The browsing fingerprint, for the server to compute the same feed key the client will.
   *
   * The seventh entry and the first that is not about first paint. It holds
   * `browsingFingerprint()`'s output — the content filter, the three toggles and the sorted
   * blocked-tag list, already joined — rather than the five inputs, so the derivation stays in
   * `lib/resources.ts` and there is no second copy of it to drift.
   *
   * The sort is *not* in it. `homeSort` and `searchSort` are separate settings that change
   * independently of the filter, and folding them in would make every sort change look like a
   * filter change to the cache.
   */
  browsing: 'browsing',
  homeSort: 'homeSort',
  /**
   * Which image line this device is on: `picpony` / `cdn` / `direct`.
   *
   * The eighth entry, and it exists because the home page now server-renders fifty `<img>` tags.
   * The line is chosen by `resolveImageLine()`, which reads `localStorage` and the fetched route
   * policy — neither of which the server can see — so it fell back to the *defaults* and emitted
   * the proxy line for everybody. A visitor who had turned the image proxy off got a hydration
   * mismatch on every card, and React does not patch attributes: their browser kept the server's
   * URL and their preference was ignored for the whole first screen.
   *
   * Mirrored rather than derived, for the same reason `browsing` holds the joined fingerprint:
   * the decision has one owner (`lib/route.ts`) and the cookie is its output, so there is no
   * second copy of the ladder to drift.
   */
  imageLine: 'imageLine',
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
  /* The two user-preference queries. Neither was in here, so
     `(prefers-color-scheme: dark)` was hand-typed at three sites in `AppLayout`
     and `(prefers-reduced-motion: reduce)` at two in `lib/motion` plus two more
     that bypass it (`lib/hero/media.ts`, `components/LoadingOverlay.tsx`) — seven
     copies of two strings, in the two places where a typo fails silently by
     never matching. */
  dark: '(prefers-color-scheme: dark)',
  reducedMotion: '(prefers-reduced-motion: reduce)',
} as const;
