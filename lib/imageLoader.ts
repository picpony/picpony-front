// 图片分层加载：PicPony 加速代理(0) → CDN(1) → 直连(2)，失败自动降级重试
// 参考官方前端 main.js 的 retryImage / getProxyUrl / 全局熔断逻辑移植

import { getBrowsingSettings } from '@/lib/api/client';

export type ImageTier = 0 | 1 | 2;

export interface LoadAttempt {
  url: string; // 当前实际加载的 URL
  tier: ImageTier;
  retries: number; // 当前层已重试次数
  giveUp: boolean; // 重试次数耗尽，放弃
}

const PROXY_WORKER_URL = 'https://147052.xyz/?url=';
const CDN_URL = 'https://wsrv.nl/?url=';

const WORKER_DEGRADE_WINDOW = 30_000; // 故障记录窗口（ms）
const WORKER_DEGRADE_COUNT = 3; // 窗口内达此数触发全局降级
const RECOVERY_MS = 60_000; // 降级后多久探测恢复（ms）
const DIRECT_MAX_RETRIES = 5; // 直连最大重试次数
export const LOAD_TIMEOUT_MS = 15_000; // 单次加载超时（ms），与官方一致

// 全局代理健康状态，跨所有图片实例共享
const proxyState = {
  workerAvailable: true,
  cdnAvailable: true,
  workerRecovering: false,
  cdnRecovering: false,
  workerFailures: [] as { time: number; url: string }[],
};

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
    url = `${PROXY_WORKER_URL}${encodeURIComponent(rawUrl)}${thumb ? '&_thumb=1' : ''}`;
  } else if (tier === 1) {
    url = `${CDN_URL}${encodeURIComponent(rawUrl)}`;
  } else {
    url = rawUrl;
  }
  if (bust) url += (url.includes('?') ? '&' : '?') + 'retry=' + Date.now();
  return url;
}

// 首次尝试：按当前设置与健康状态决定起始层
export function createInitialAttempt(rawUrl: string, thumb = false): LoadAttempt {
  const s = getBrowsingSettings();
  let tier: ImageTier;
  if (s.usePicponyProxy && proxyState.workerAvailable) tier = 0;
  else if (s.useCdn && proxyState.cdnAvailable) tier = 1;
  else tier = 2;
  return { url: buildImageUrl(rawUrl, tier, false, thumb), tier, retries: 0, giveUp: false };
}

// 记录代理故障；窗口内同一 URL 只计一次
function recordWorkerFailure(rawUrl: string) {
  const now = Date.now();
  const clean = rawUrl.replace(/[&?]retry=\d+/g, '');
  proxyState.workerFailures = proxyState.workerFailures.filter(
    (f) => now - f.time < WORKER_DEGRADE_WINDOW,
  );
  if (!proxyState.workerFailures.some((f) => f.url === clean)) {
    proxyState.workerFailures.push({ time: now, url: clean });
  }
  if (proxyState.workerFailures.length >= WORKER_DEGRADE_COUNT) {
    proxyState.workerAvailable = false;
    proxyState.workerFailures = [];
    startWorkerRecovery();
  }
}

function startWorkerRecovery() {
  if (proxyState.workerRecovering) return;
  proxyState.workerRecovering = true;
  window.setTimeout(probeWorker, RECOVERY_MS);
}

// 探测代理是否恢复，成功后重新启用
function probeWorker() {
  const testUrl = `${PROXY_WORKER_URL}${encodeURIComponent('https://derpicdn.net/img/2017/12/27/1617129/thumb.png')}&_t=${Date.now()}`;
  fetch(testUrl, { method: 'HEAD', mode: 'no-cors' })
    .then(() => {
      proxyState.workerAvailable = true;
      proxyState.workerRecovering = false;
    })
    .catch(() => {
      window.setTimeout(probeWorker, RECOVERY_MS);
    });
}

function startCdnRecovery() {
  if (proxyState.cdnRecovering) return;
  proxyState.cdnRecovering = true;
  window.setTimeout(probeCdn, RECOVERY_MS);
}

function probeCdn() {
  const testUrl = `${CDN_URL}${encodeURIComponent('https://derpicdn.net/img/2017/12/27/1617129/thumb.png')}&_t=${Date.now()}`;
  fetch(testUrl, { method: 'HEAD', mode: 'no-cors' })
    .then(() => {
      proxyState.cdnAvailable = true;
      proxyState.cdnRecovering = false;
    })
    .catch(() => {
      window.setTimeout(probeCdn, RECOVERY_MS);
    });
}

// 失败后决策下一次尝试：同层重试 1 次 → 降级下一层 → 直连最多 DIRECT_MAX_RETRIES 次
export function resolveNextAttempt(
  rawUrl: string,
  attempt: LoadAttempt,
  thumb = false,
): LoadAttempt {
  if (attempt.giveUp) return attempt;
  // 代理/CDN 层先原地重试一次（带防缓存参数）
  if (attempt.retries === 0 && attempt.tier < 2) {
    return { ...attempt, retries: 1, url: buildImageUrl(rawUrl, attempt.tier, true, thumb) };
  }
  if (attempt.tier === 0) {
    recordWorkerFailure(rawUrl);
    const s = getBrowsingSettings();
    if (s.useCdn && proxyState.cdnAvailable) {
      return { url: buildImageUrl(rawUrl, 1, false, thumb), tier: 1, retries: 0, giveUp: false };
    }
    return { url: buildImageUrl(rawUrl, 2, true, thumb), tier: 2, retries: 1, giveUp: false };
  }
  if (attempt.tier === 1) {
    proxyState.cdnAvailable = false;
    startCdnRecovery();
    return { url: buildImageUrl(rawUrl, 2, true, thumb), tier: 2, retries: 1, giveUp: false };
  }
  // 直连：退避重试，防止无限触发 onerror 死循环
  if (attempt.retries >= DIRECT_MAX_RETRIES) return { ...attempt, giveUp: true };
  return {
    url: buildImageUrl(rawUrl, 2, true, thumb),
    tier: 2,
    retries: attempt.retries + 1,
    giveUp: false,
  };
}
