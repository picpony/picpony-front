// 图片分层加载的"梯子"：某张图失败后下一次试什么、隔多久再试。线路策略/健康状态/CDN-直连
// 竞速归 lib/route.ts（强制策略必须能压过梯子，且同一健康状态也决定 API 线路）。
//
// Two kinds of rung, in order:
//
// 1. **The optimizer** (`/_next/image`), handed the picture's *raw* Derpibooru URL. The server
//    fetches it on the server's network, where the visitor's image line means nothing — so the
//    line is not applied to it at all. That is also what keeps the optimizer from being an open
//    proxy (R8-026): it used to be handed `https://147052.xyz/?url=…` and `wsrv.nl` URLs, both
//    open `?url=` services, and `next.config.ts` had to allow both hosts — which let anyone make
//    this server fetch, re-encode and cache any image on the internet. One attempt only: an
//    `<img>` cannot see a status, and a 4xx from the optimizer is deterministic, so retrying the
//    same URL is three identical failures (R4-026).
// 2. **The visitor's line, browser-direct** (unoptimized): PicPony worker → CDN → direct, the
//    ladder the original front end had. It is the whole ladder in development (where
//    `images.unoptimized` is on) and the way out when the optimizer fails in production — an
//    optimizer outage used to take out every thumbnail, although each was one direct request
//    away (R12-007).
//
// Every retry waits: a worker/CDN retry a beat, the direct rung an exponential backoff with
// jitter. The old ladder spent all six attempts in ~120ms, so a one-second CDN hiccup broke the
// card for the rest of the session.

import type { ImageLine } from '@/lib/route';
import { IMAGE_CDN_BASE, IMAGE_WORKER_BASE, MEDIA } from '@/lib/constants';
import {
  isImageForced,
  recordCdnFailure,
  raceImageLines,
  recordWorkerFailure,
  resolveImageFallbackLine,
  resolveImageLine,
} from '@/lib/route';

export type ImageTier = 0 | 1 | 2;

export interface LoadAttempt {
  /** The URL `next/image` is handed: raw for the optimizer, line-wrapped when browser-direct. */
  url: string;
  /** Whether this attempt goes through the server's optimizer. */
  optimized: boolean;
  /** The line of a browser-direct attempt (0 worker, 1 CDN, 2 direct). */
  tier: ImageTier;
  /** Retries already spent on this tier. */
  retries: number;
  /** Every rung failed: the caller shows its failure plate. */
  giveUp: boolean;
  /** How long to wait before this attempt starts — the backoff; 0 for the first attempt. */
  delayMs: number;
}

/**
 * Whether `/_next/image` is live. Mirrors `images.unoptimized` in `next.config.ts`, which is on
 * in development — there `next/image` renders the source as it is, so an "optimized" rung would
 * be a browser-direct request that ignored the visitor's line.
 */
export const OPTIMIZER_ACTIVE = process.env.NODE_ENV !== 'development';

/** Direct-line retries before giving up, and their backoff (0.5s·2ⁿ ±25%, capped). */
const DIRECT_MAX_RETRIES = 4;
const BACKOFF_BASE_MS = 500;
const BACKOFF_CAP_MS = 8_000;
/** The worker's or CDN's one in-place retry waits this long (±25%). */
const LINE_RETRY_MS = 400;
export const LOAD_TIMEOUT_MS = 15_000; // 单次加载超时（ms），超时视同失败

function jitter(ms: number): number {
  return Math.round(ms * (0.75 + Math.random() * 0.5));
}

/** The wait before direct retry number `n` (1-based). */
export function backoffDelay(n: number): number {
  return jitter(Math.min(BACKOFF_CAP_MS, BACKOFF_BASE_MS * 2 ** Math.max(0, n - 1)));
}

/**
 * Whether the user asked the browser to save data (Data Saver / `Save-Data`). A decorative
 * download — a video banner's autoplay, a card's hover preview — stands down; a picture the
 * user is looking at does not.
 */
export function saveDataRequested(): boolean {
  if (typeof navigator === 'undefined') return false;
  const connection = (navigator as Navigator & { connection?: { saveData?: boolean } }).connection;
  if (connection?.saveData) return true;
  return typeof window !== 'undefined' && window.matchMedia?.(MEDIA.reducedData).matches === true;
}

// 是否值得启用分层加载（Derpibooru 系或已被代理/CDN 包装的图片）
export function isResilientImageUrl(url: string): boolean {
  if (!url) return false;
  return /147052\.xyz|wsrv\.nl|derpicdn\.net|trixiebooru\.org|derpibooru\.org/i.test(url);
}

// 还原原始图片 URL（剥掉代理/CDN 包装与防缓存参数）
export function getRawImageUrl(url: string): string {
  if (!url) return '';
  let raw = url;
  const wsrv = raw.match(/^https:\/\/wsrv\.nl\/\?url=([^&]+)/);
  if (wsrv) raw = decodeURIComponent(wsrv[1]);
  const proxy = raw.match(/^https:\/\/(?:picponyapi\.)?147052\.xyz\/\?url=([^&]+)/);
  if (proxy) raw = decodeURIComponent(proxy[1]);
  return raw.replace(/[&?]retry=\d+/g, '');
}

// 按层级构建图片 URL；bust 时追加防缓存参数
export function buildImageUrl(rawUrl: string, tier: ImageTier, bust = false, thumb = false): string {
  let url: string;
  if (tier === 0) {
    url = `${IMAGE_WORKER_BASE}${encodeURIComponent(rawUrl)}${thumb ? '&_thumb=1' : ''}`;
  } else if (tier === 1) {
    url = `${IMAGE_CDN_BASE}${encodeURIComponent(rawUrl)}`;
  } else {
    url = rawUrl;
  }
  if (bust) url += (url.includes('?') ? '&' : '?') + 'retry=' + Date.now();
  return url;
}

const TIER_OF = { picpony: 0, cdn: 1, direct: 2 } as const;

/**
 * Put one already-built URL on the current image line, idempotently: strips the
 * wrapper it is already wearing, then re-applies the current line — safe to call
 * at the data layer and re-derive from, and lets a forced policy unwrap a URL
 * the response arrived pre-wrapped in.
 */
export function toCurrentImageLine(url: string, thumb = false): string {
  if (!url) return url;
  return buildImageUrl(getRawImageUrl(url), TIER_OF[resolveImageLine()], false, thumb);
}

function tierAttempt(
  rawUrl: string,
  tier: ImageTier,
  { bust = false, thumb = false, retries = 0, delayMs = 0 }: {
    bust?: boolean;
    thumb?: boolean;
    retries?: number;
    delayMs?: number;
  } = {},
): LoadAttempt {
  return {
    url: buildImageUrl(rawUrl, tier, bust, thumb),
    optimized: false,
    tier,
    retries,
    giveUp: false,
    delayMs,
  };
}

export interface InitialAttemptOptions {
  /** Append the worker's thumbnail marker (`_thumb=1`) on the PicPony line. */
  thumb?: boolean;
  /**
   * The line the *server* rendered with (`useSsrImageLine`), for the first attempt only: the
   * live answer reads `localStorage` and the fetched policy, which Node sees neither of, so the
   * hydrating render must ask the server's question. The ladder reads the live answer after.
   */
  line?: ImageLine | null;
  /** Start at the optimizer. False for a caller rendering `unoptimized` (an animated picture). */
  optimize?: boolean;
}

/**
 * The first attempt: the optimizer on the raw URL when it is live (the same URL on the server
 * and in the browser, so it cannot mismatch at hydration), else the resolved line.
 */
export function createInitialAttempt(rawUrl: string, options: InitialAttemptOptions = {}): LoadAttempt {
  const { thumb = false, line, optimize = true } = options;
  const tier = TIER_OF[line ?? resolveImageLine()];
  if (optimize && OPTIMIZER_ACTIVE) {
    return { url: rawUrl, optimized: true, tier, retries: 0, giveUp: false, delayMs: 0 };
  }
  return tierAttempt(rawUrl, tier, { thumb });
}

/**
 * The attempt after a failure (an `error` event or the load timeout).
 *
 * - The optimizer → the visitor's line, browser-direct.
 * - A forced policy has no ladder: it converges on the administrator's line — including
 *   *snapping to* it, since an `<img>` built before the policy landed starts on the wrong tier —
 *   and retries there with the direct backoff.
 * - Otherwise the worker and the CDN each get one in-place retry after a beat, then step down
 *   (the worker's failure also races the other two lines, so the next picture starts on the one
 *   that works); the direct rung backs off exponentially, then gives up.
 */
export function resolveNextAttempt(
  rawUrl: string,
  attempt: LoadAttempt,
  thumb = false,
): LoadAttempt {
  if (attempt.giveUp) return attempt;

  if (attempt.optimized) {
    return tierAttempt(rawUrl, TIER_OF[resolveImageLine()], { thumb });
  }

  if (isImageForced()) {
    const forcedTier = TIER_OF[resolveImageLine()];
    if (forcedTier !== attempt.tier) return tierAttempt(rawUrl, forcedTier, { bust: true, thumb });
    if (attempt.retries >= DIRECT_MAX_RETRIES) return { ...attempt, giveUp: true };
    const retries = attempt.retries + 1;
    return tierAttempt(rawUrl, attempt.tier, { bust: true, thumb, retries, delayMs: backoffDelay(retries) });
  }

  // 代理/CDN 层先原地重试一次（带防缓存参数，稍候再试）
  if (attempt.retries === 0 && attempt.tier < 2) {
    return tierAttempt(rawUrl, attempt.tier, { bust: true, thumb, retries: 1, delayMs: jitter(LINE_RETRY_MS) });
  }

  if (attempt.tier === 0) {
    recordWorkerFailure(rawUrl);
    // worker 存疑时顺带测量剩下两条线路，让下一张图直接走真正可用的那条。
    raceImageLines();
    return resolveImageFallbackLine() === 'cdn'
      ? tierAttempt(rawUrl, 1, { thumb })
      : tierAttempt(rawUrl, 2, { bust: true, thumb });
  }

  if (attempt.tier === 1) {
    recordCdnFailure(rawUrl);
    return tierAttempt(rawUrl, 2, { bust: true, thumb });
  }

  // 直连：指数退避重试，耗尽后放弃
  if (attempt.retries >= DIRECT_MAX_RETRIES) return { ...attempt, giveUp: true };
  const retries = attempt.retries + 1;
  return tierAttempt(rawUrl, 2, { bust: true, thumb, retries, delayMs: backoffDelay(retries) });
}

// ---------------------------------------------------------------------------
// Derpibooru renditions, for a picture the optimizer cannot resize
// ---------------------------------------------------------------------------

/**
 * Derpibooru's renditions and the box each is fitted into (never upscaled past the original).
 * `tall` is left out: it is a long-strip format, not a thumbnail.
 */
const RENDITION_BOXES = [
  ['thumb_small', 150, 150],
  ['thumb', 250, 250],
  ['small', 320, 240],
  ['medium', 800, 600],
  ['large', 1280, 1024],
] as const;

export type RenditionName = (typeof RENDITION_BOXES)[number][0];

/** The width a rendition comes out at for a `width` × `height` original. */
export function renditionWidth(name: RenditionName, width: number, height: number): number {
  const box = RENDITION_BOXES.find(([n]) => n === name);
  if (!box || !(width > 0) || !(height > 0)) return 0;
  const scale = Math.min(1, box[1] / width, box[2] / height);
  return Math.round(width * scale);
}

/**
 * The smallest rendition at least `targetWidth` wide (10% short still counts — a slightly soft
 * frame does not read in motion), from those the row carries; the largest available if none is
 * wide enough. For an animated picture: the optimizer passes animations through unresized, so a
 * card that asked it for the 800px `medium.gif` downloaded all of it (3.4MB for a 256px card,
 * R12-001).
 */
export function pickRendition(
  representations: Partial<Record<string, string>> | undefined,
  width: number,
  height: number,
  targetWidth: number,
): string {
  let best = '';
  for (const [name] of RENDITION_BOXES) {
    const url = representations?.[name];
    if (typeof url !== 'string' || !url) continue;
    best = url;
    if (renditionWidth(name, width, height) >= targetWidth * 0.9) return url;
  }
  return best;
}
