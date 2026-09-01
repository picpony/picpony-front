// 图片分层加载：PicPony 加速代理(0) → CDN(1) → 直连(2)，失败自动降级重试。
// 本模块只负责"梯子"——某张图失败后下一层试什么；线路策略/健康状态/CDN-直连
// 竞速归 lib/route.ts（强制策略必须能压过梯子，且同一健康状态也决定 API 线路）。

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
  bust: boolean,
  thumb: boolean,
  retries = 0,
): LoadAttempt {
  return { url: buildImageUrl(rawUrl, tier, bust, thumb), tier, retries, giveUp: false };
}

/**
 * 首次尝试：线路策略优先，其次是用户开关与健康状态。
 *
 * `line` 仅覆盖首次尝试：resolveImageLine() 读 localStorage 与策略，在 Node 与
 * 浏览器中答案不同，服务端渲染的 img 会因存储偏好产生 hydration 不匹配；传入
 * 服务端（cookie）假设的线路让首帧两侧一致。梯子不受影响，后续仍读实时答案。
 */
export function createInitialAttempt(
  rawUrl: string,
  thumb = false,
  line?: ImageLine | null,
): LoadAttempt {
  return tierAttempt(rawUrl, TIER_OF[line ?? resolveImageLine()], false, thumb);
}

/**
 * 失败后决策下一次尝试：同层重试 1 次 → 降级下一层 → 直连最多 DIRECT_MAX_RETRIES 次。
 *
 * 强制策略没有梯子——收敛到管理员指定的线路，包括从错误层级跳回（pageCache 恢复
 * 的网格首帧可能就画在策略生效前的层级上，原地重试永远到不了目标线路）。
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
    // worker 存疑时顺带测量剩下两条线路，让下一张图直接走真正可用的那条。
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

