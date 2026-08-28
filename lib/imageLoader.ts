// 图片分层加载：PicPony 加速代理(0) → CDN(1) → 直连(2)，失败自动降级重试
//
// This module owns the *ladder* — which tier one `<img>` tries next after it failed —
// and nothing else. Which line is in force, whether a host is healthy, and the CDN /
// direct race all belong to `lib/route.ts`, because a forced policy has to beat the
// ladder and because the same health state decides API lines too.

import type { ImageLine } from '@/lib/route';
import { IMAGE_CDN_BASE, IMAGE_WORKER_BASE } from '@/lib/constants';
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
  url: string; // 当前实际加载的 URL
  tier: ImageTier;
  retries: number; // 当前层已重试次数
  giveUp: boolean; // 重试次数耗尽，放弃
}

const DIRECT_MAX_RETRIES = 5; // 直连最大重试次数
export const LOAD_TIMEOUT_MS = 15_000; // 单次加载超时（ms），与官方一致

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
 * Put one already-built URL on the current image line, idempotently.
 *
 * Strips whatever wrapper it is already wearing before applying the current one, so it is safe
 * to call at the data layer *and* have the ladder re-derive a tier from the result — and so a
 * forced `direct` policy unwraps a URL the response arrived pre-wrapped in.
 */
export function toCurrentImageLine(url: string, thumb = false): string {
  if (!url) return url;
  return buildImageUrl(getRawImageUrl(url), TIER_OF[resolveImageLine()], false, thumb);
}

function tierAttempt(
  rawUrl: string,
  tier: ImageTier,
  bust: boolean,
  thumb: boolean,
  retries = 0,
): LoadAttempt {
  return { url: buildImageUrl(rawUrl, tier, bust, thumb), tier, retries, giveUp: false };
}

/**
 * 首次尝试：线路策略优先，其次是用户开关与健康状态。
 *
 * `line` overrides that resolution for the **first** attempt only, and exists for one reason:
 * `resolveImageLine()` reads `localStorage` and the fetched policy, so it answers differently in
 * Node than in the browser and every server-rendered `<img>` was a hydration mismatch for anyone
 * whose stored preference was not the default. `app/layout.tsx` passes the line the server
 * assumed (from a cookie) down through `ImageLineProvider`, so the first render on both sides
 * asks the same question. The ladder is untouched — `resolveNextAttempt` still reads the live
 * answer, so a stale cookie costs one corrected attempt rather than the wrong line.
 */
export function createInitialAttempt(
  rawUrl: string,
  thumb = false,
  line?: ImageLine | null,
): LoadAttempt {
  return tierAttempt(rawUrl, TIER_OF[line ?? resolveImageLine()], false, thumb);
}

/**
 * 失败后决策下一次尝试：同层重试 1 次 → 降级下一层 → 直连最多 DIRECT_MAX_RETRIES 次
 *
 * A forced policy has no ladder — it converges on the line the administrator named. That
 * includes snapping back to it: an `<img>` whose first attempt was built before the policy
 * landed (a grid restored from `lib/pageCache` paints in the first commit) starts on the
 * wrong tier, and retrying that tier in place would never reach the forced one. Which is
 * the case that matters, because a policy forcing `direct` usually means the other lines
 * are the broken ones.
 */
export function resolveNextAttempt(
  rawUrl: string,
  attempt: LoadAttempt,
  thumb = false,
): LoadAttempt {
  if (attempt.giveUp) return attempt;

  if (isImageForced()) {
    const forcedTier = TIER_OF[resolveImageLine()];
    if (forcedTier !== attempt.tier) return tierAttempt(rawUrl, forcedTier, true, thumb);
    if (attempt.retries >= DIRECT_MAX_RETRIES) return { ...attempt, giveUp: true };
    return {
      ...attempt,
      retries: attempt.retries + 1,
      url: buildImageUrl(rawUrl, attempt.tier, true, thumb),
    };
  }

  // 代理/CDN 层先原地重试一次（带防缓存参数）
  if (attempt.retries === 0 && attempt.tier < 2) {
    return { ...attempt, retries: 1, url: buildImageUrl(rawUrl, attempt.tier, true, thumb) };
  }

  if (attempt.tier === 0) {
    recordWorkerFailure(rawUrl);
    /* Measure the two remaining lines while the worker is in doubt, so the next image
       starts on whichever of them is actually answering. */
    raceImageLines();
    return resolveImageFallbackLine() === 'cdn'
      ? tierAttempt(rawUrl, 1, false, thumb)
      : tierAttempt(rawUrl, 2, true, thumb, 1);
  }

  if (attempt.tier === 1) {
    recordCdnFailure(rawUrl);
    return tierAttempt(rawUrl, 2, true, thumb, 1);
  }

  // 直连：退避重试，防止无限触发 onerror 死循环
  if (attempt.retries >= DIRECT_MAX_RETRIES) return { ...attempt, giveUp: true };
  return tierAttempt(rawUrl, 2, true, thumb, attempt.retries + 1);
}

/* `upgradedVariant` was here: a middle rung that asked the optimizer for an in-between variant of
   the card's bitmap, to bridge the gap between the ~300px thumbnail the flight paints and the
   detail's own picture. It is gone, because the gap it bridged was self-inflicted — the detail's
   picture was slow *because* it was going through the optimizer too, and 3–4 seconds of re-encode
   is what the middle rung was racing. `shouldBypassImageOptimization` (components/DetailImage.tsx)
   removed the cause; a middle rung built out of the same re-encode could only ever have been
   slower and softer than the thing it was standing in for.

   Two measurements worth keeping from it. The upscale it was fixing was real — 384px in a 944px
   box at 1920, 2.46x — and the trap it fell into is general: it multiplied a *constant* 1280 by
   the device pixel ratio, so on any 2x screen it asked for the 3840 bucket and never landed at
   all. A fix that measures perfectly at DPR 1 and is inert on every real phone. Measure image work
   at DPR 2. */
