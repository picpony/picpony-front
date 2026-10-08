/** PicPony 自有 API 基础路径 (Next.js rewrite to /api.php) */
export const PICPONY_API_BASE = '/api.php';

/**
 * The same endpoint, absolute, for server code: Node's `fetch` rejects a relative
 * URL outright (the relative form is for the browser, which goes through the route
 * handler that rewrites the backend's `Secure` session cookie). Must stay in step
 * with `UPSTREAM_ORIGIN` in that route handler.
 */
export const PICPONY_API_ORIGIN = 'https://picpony.top';

/** Derpibooru (Trixiebooru) API 基础路径 */
export const DERPIBOORU_API_BASE = 'https://trixiebooru.org/api/v1/json';

/**
 * The `api_accel` line: a Cloudflare Worker that fetches a Derpibooru URL for you —
 * one of the four API lines in `lib/route.ts`. It answers `GET`/`HEAD`/`OPTIONS`
 * only, so a POST to Derpibooru can never be wrapped in it. Note the host is
 * `picponyapi.147052.xyz` while the *image* worker at `lib/imageLoader.ts` is the
 * bare `147052.xyz`: two hostnames, two pipelines.
 */
export const PROXY_API_BASE = 'https://picponyapi.147052.xyz/?url=';

/**
 * The `picpony_api` line, and the path our own handler answers on. The upstream
 * enforces an `Origin` allowlist of `picpony.top` / `www.picpony.top` and 403s
 * everything else, so the browser cannot reach it at all — `app/relay/route.ts`
 * calls it server-side with `PICPONY_API_ORIGIN` as the `Origin`, which is why the
 * client-facing value here is a path rather than a host.
 */
export const PICPONY_RELAY_UPSTREAM = 'https://cdn.picpony.top/relay';
export const PICPONY_RELAY_PATH = '/relay';

/**
 * The two non-direct image lines, shared by `lib/route.ts` (which decides which
 * line is in force) and `lib/imageLoader.ts` (where the retry ladder lives).
 * The worker is the bare `147052.xyz` while the API line's worker is
 * `picponyapi.147052.xyz` — `getRawImageUrl` is the one place that knows both.
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
 * Complete, and it has to stay that way: no call site may restate a key
 * literal — new keys go in this table.
 */
/** One backend status document feeds global lines, maintenance and semantic search. */
export const SITE_STATUS_CACHE_TAG = 'site-status';

export const LS_KEYS = {
  userInfo: 'user_info',
  contentFilter: 'trixie_content_filter',
  banAnthro: 'trixie_ban_anthro',
  banDiscomfort: 'trixie_ban_discomfort',
  onlyPony: 'trixie_only_pony',
  /* The four line preferences sit on *two* axes — `lib/route.ts` owns the split:
     `useCdn`/`usePicponyProxy` steer images; `useApiAccel`/`useHongKongRelay`
     steer the Derpibooru API. */
  useCdn: 'trixie_use_cdn',
  usePicponyProxy: 'picpony_use_proxy',
  useApiAccel: 'picpony_api_accel',
  useHongKongRelay: 'picpony_hk_relay',
  homeSort: 'picpony_default_home_sort',
  searchSort: 'picpony_default_search_sort',
  /** /search's recent queries, newest first — the original front end's key, so its history carries over. */
  searchHistory: 'trixie_search_history',
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
  /** 隐藏 IP 属地 — the original front end's key. The backend reads it from the synced settings. */
  hideIpLocation: 'picpony_hide_ip_location',
  emailNotifMessage: 'picpony_email_notif_message',
  emailNotifReply: 'picpony_email_notif_reply',
  /* Favourites (`lib/settingsSync.ts` syncs them as the account's): a tap on 收藏 fills the default
     folder, or opens 收藏到…; the folders shown on the profile (absent: every one); the privacy
     space — shown, auto-privacy, and how long it stays unlocked after leaving it. The original
     front end's keys. */
  defaultFaveToMain: 'picpony_default_fave_main',
  defaultFaveFolderId: 'picpony_default_fave_folder_id',
  defaultFaveFolderName: 'picpony_default_fave_folder_name',
  publicFaveFolderIds: 'picpony_public_fave_folder_ids',
  showPrivacyFaves: 'picpony_show_privacy_faves',
  autoPrivacyFaves: 'picpony_auto_privacy_faves',
  privacyUnlockSeconds: 'picpony_privacy_unlock_seconds',
  /**
   * Settings changed on this device that the account has not confirmed yet, and whose account
   * they belong to — `lib/settingsSync.ts`'s record, so a change made offline or in a tab that
   * closed before its write landed is still newer than the cloud copy on the next load.
   */
  settingsSyncPending: 'picpony_settings_sync_pending',
  activeHiddenTags: 'trixie_active_hidden_tags',
  /** The tag list whose pictures wear a cover. */
  activeSpoileredTags: 'trixie_active_spoilered_tags',
  /**
   * 待定标签库: tags set aside to add to a group later — the original front end's key, so a
   * library collected there carries over. Device-local (`lib/pendingTags.ts`).
   */
  pendingTags: 'pending_tags',
  palette: 'picpony_palette',
  /**
   * The custom palette as a spec — its seed hex and, unless 自动, its 副色相 (`#e06c9f`,
   * `#e06c9f/triadic`, `#e06c9f/272`; `lib/paletteSpec.ts`) — when `palette` is `custom`. A spec
   * rather than the resolved declarations: the recipe is shared (`lib/paletteRule.ts`) and a
   * stored *output* would go stale the moment the rule moves. A bare seed is what earlier builds
   * wrote, and still reads.
   */
  paletteCustom: 'picpony_palette_custom',
  /** 配色方案: `mono` for 单色; anything else, or nothing, is 多色. */
  paletteHues: 'picpony_palette_hues',
  motion: 'picpony_motion',
  motionSpeed: 'picpony_motion_speed',
  entranceMotion: 'picpony_entrance_motion',
  mascotVisible: 'picpony_show_mascot',
  mascotId: 'picpony_mascot_id',
  mascotSizeDesktop: 'picpony_mascot_size_desktop',
  mascotSizeMobile: 'picpony_mascot_size_mobile',
  mascotCollapsed: 'picpony_mascot_collapsed',
  legacyIntroAnimation: 'picpony_intro_animation_enabled',
  legacyMascotId: 'picpony_selected_mascot_id',
  legacyMascotSize: 'picpony_mascot_size',
  assistantStoragePrefix: 'picpony_assistant',
  adminImportPrefix: 'picpony_admin_import',
  /**
   * A forum post being written: the prefix of one key per account and per post
   * (`lib/forumDraft.ts`). The bare key is the original front end's single draft, adopted
   * once by the first account that opens the composer.
   */
  forumDraft: 'forum_post_draft',
  /**
   * 金币商店的购物车，每账号一份：`{ [account]: [{ id, quantity, name }] }`. The original front
   * end kept the cart in memory only, so it emptied on reload and — because `handleLogout` did not
   * clear it — carried one account's items into the next. Stored per account instead, so a reload
   * keeps your cart and a sign-out cannot hand it to somebody else. Ids, quantities and each
   * line's name (`components/shop/cartStore.ts`): a price or a stock is the shop's answer, never
   * ours to remember.
   */
  shopCart: 'picpony_shop_cart',
  /**
   * 访客标识 — the original front end's key, so an id already stored by it is kept. An anonymous
   * random id (`lib/visitor.ts`), read only by `track_visitor`.
   */
  visitorId: 'picpony_visitor_id',
} as const;

/**
 * Cookie names, for the preferences the server has to know before first paint:
 * they are mirrored into a cookie so `app/layout.tsx` can put them on `<html>` at
 * SSR — without that, the first paint is the wrong theme, a visible flash of the
 * wrong brand on every cold load (plus the sidebar's collapsed state, for the
 * same reason). This is a table rather than a derivation from `LS_KEYS` because
 * the cookie name and the storage key do not always match.
 */
export const COOKIE_KEYS = {
  darkMode: 'darkMode',
  /**
   * The active spoiler tags, so the server can draw the cover. A spoiler is a
   * per-tag cover, not a query exclusion, so the server must know it before it
   * renders the `<img>` tags. Same shape as `browsing`/`imageLine`: the device
   * mirrors its preference into a cookie and the first render asks the same
   * question the client-side effect will.
   */
  spoilerTags: 'spoilerTags',
  sidebarCollapsed: 'sidebarCollapsed',
  palette: 'palette',
  /**
   * The custom palette's spec (seed and 副色相, the storage key's format), so the server can
   * derive its declarations and put them in `<head>` before the first paint instead of
   * flashing the default brand on every cold load.
   */
  paletteCustom: 'paletteCustom',
  /** 配色方案 (`multi` / `mono`), so the server can put `data-palette-hues` on `<html>`. */
  paletteHues: 'paletteHues',
  /**
   * 显示隐私空间, so the server draws /favorites' placeholder tab row with the tabs the screen will
   * have: read through `useSyncedSetting`, whose server value is the fallback, it drew two and the
   * hydrated row three (FX-F9). Mirrored by the settings sync wherever the setting is installed.
   */
  showPrivacyFaves: 'showPrivacyFaves',
  motion: 'motion',
  motionSpeed: 'motionSpeed',
  entranceMotion: 'entranceMotion',
  /**
   * The browsing fingerprint, for the server to compute the same feed key the client
   * will. It holds `browsingFingerprint()`'s output — the content filter, the three
   * toggles and the sorted blocked-tag list, already joined — rather than the five
   * inputs, so the derivation stays in `lib/resources.ts` and there is no second
   * copy of it to drift. The sort is *not* in it: `homeSort` and `searchSort` change
   * independently of the filter, and folding them in would make every sort change
   * look like a filter change to the cache.
   */
  browsing: 'browsing',
  homeSort: 'homeSort',
  /**
   * Which image line this device is on: `picpony` / `cdn` / `direct`. The line is
   * chosen by `resolveImageLine()` from `localStorage` and the fetched route policy,
   * neither of which the server can see — without the cookie the server falls back
   * to the defaults and a visitor's preference is ignored, as a hydration mismatch
   * React does not patch (it keeps the server's attributes). Mirrored rather than
   * derived, like `browsing`: the decision has one owner (`lib/route.ts`) and the
   * cookie is its output, so there is no second copy of the ladder to drift.
   */
  imageLine: 'imageLine',
  /**
   * The dev banner's dismissal, so the server can leave the banner out of — or put it
   * into — the first byte. Rendered only after mount, it pushed the whole shell down 44px
   * on every cold load. `LS_KEYS.devBannerDismissed` stays the authority; this mirrors it.
   */
  devBannerDismissed: 'devBannerDismissed',
  /**
   * `1` when the backend last said this device's session may use the site during
   * maintenance (`is_admin` on the status document, read with the session's token). The
   * server cannot see the token, so during maintenance it renders the app rather than the
   * maintenance screen only for a device carrying this hint. A hint, not a credential: the
   * backend still decides what each request may do, and the client re-asks and corrects it
   * (`components/MaintenanceScreen.tsx`).
   */
  maintenanceStaff: 'maintenanceStaff',
} as const;

/**
 * Breakpoints, in px, matching Tailwind's default scale (Tailwind's, not M3's
 * window classes). Anything that branches on width in JS reads from here so JS
 * breakpoints cannot drift from Tailwind's responsive utilities.
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
  /* The density axis, not derived from a width: a 1024px tablet is coarse and a
     600px desktop window is not. Mirrors the pointer variants and the touch floor
     in globals.css so anything branching in JS cannot drift from the CSS. */
  pointerCoarse: '(pointer: coarse)',
  pointerFine: '(pointer: fine)',
  /* The two user-preference queries. These matchMedia strings fail silently when
     hand-typed — a typo never matches — so every copy lives here. */
  dark: '(prefers-color-scheme: dark)',
  reducedMotion: '(prefers-reduced-motion: reduce)',
  /* Data Saver, where the engine exposes it as a query (the `Save-Data` hint is the other
     half; see `saveDataRequested` in lib/imageLoader.ts). */
  reducedData: '(prefers-reduced-data: reduce)',
} as const;
