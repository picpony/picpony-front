import { PROXY_API_BASE, LS_KEYS } from '@/lib/constants';

// ---------------------------------------------------------------------------
// 浏览设置类型
// ---------------------------------------------------------------------------

export interface BrowsingSettings {
  contentFilter: 'safe' | 'spoilers' | 'developer';
  banAnthro: boolean;
  banDiscomfort: boolean;
  onlyPony: boolean;
  useCdn: boolean;
  usePicponyProxy: boolean;
  useApiAccel: boolean;
  homeSort: string;
  searchSort: string;
}

// ---------------------------------------------------------------------------
// 浏览设置（来自 localStorage）
// ---------------------------------------------------------------------------

export function getBrowsingSettings(): BrowsingSettings {
  const ls = (k: string, def: string) => localStorage.getItem(k) ?? def;
  return {
    contentFilter: ls(LS_KEYS.contentFilter, 'safe') as 'safe' | 'spoilers' | 'developer',
    banAnthro: ls(LS_KEYS.banAnthro, 'false') === 'true',
    banDiscomfort: ls(LS_KEYS.banDiscomfort, 'true') !== 'false',
    onlyPony: ls(LS_KEYS.onlyPony, 'false') === 'true',
    useCdn: ls(LS_KEYS.useCdn, 'false') === 'true',
    usePicponyProxy: ls(LS_KEYS.usePicponyProxy, 'true') !== 'false',
    useApiAccel: ls(LS_KEYS.useApiAccel, 'true') !== 'false',
    homeSort: ls(LS_KEYS.homeSort, 'created_at'),
    searchSort: ls(LS_KEYS.searchSort, 'created_at'),
  };
}

// ---------------------------------------------------------------------------
// CDN / 代理 URL 处理
// ---------------------------------------------------------------------------

export function applyCdn(url: string): string {
  if (getBrowsingSettings().useCdn && url) {
    return `https://wsrv.nl/?url=${encodeURIComponent(url)}`;
  }
  return url;
}

function buildProxyUrl(originalUrl: string): string {
  const derpiUrl = originalUrl.replace('trixiebooru.org', 'derpibooru.org');
  return PROXY_API_BASE + encodeURIComponent(derpiUrl);
}

// ---------------------------------------------------------------------------
// 搜索查询构建
// ---------------------------------------------------------------------------

export function buildSearchQuery(search?: string): string {
  const s = getBrowsingSettings();
  let tags = '';

  if (s.contentFilter !== 'developer') {
    switch (s.contentFilter) {
      case 'safe':
        tags = '-explicit, -questionable, -suggestive, -grotesque, -grimdark, -spoiler';
        break;
      case 'spoilers':
        tags = '-explicit, -questionable, -grotesque, -grimdark';
        break;
    }
  }

  if (s.banAnthro) {
    tags = tags ? `${tags}, -anthro, -humanized` : '-anthro, -humanized';
  }

  if (s.onlyPony) {
    tags = tags ? `${tags}, pony` : 'pony';
  }

  try {
    const activeHidden: string[] = JSON.parse(localStorage.getItem('trixie_active_hidden_tags') || '[]');
    const blockNegations = activeHidden
      .filter(t => t && typeof t === 'string')
      .map(t => `-${t.trim().toLowerCase()}`);
    if (blockNegations.length > 0) {
      tags = tags ? `${tags}, ${blockNegations.join(', ')}` : blockNegations.join(', ');
    }
  } catch { /* ignore */ }

  if (!tags && s.contentFilter !== 'developer') {
    tags = '-explicit, -questionable, -suggestive, -grotesque, -grimdark, -spoiler, pony';
  }

  if (search) {
    tags = tags ? `${search}, ${tags}` : search;
  }

  return encodeURIComponent(tags);
}

function getSortParams(isSearch: boolean): string {
  const s = getBrowsingSettings();
  const sort = isSearch ? s.searchSort : s.homeSort;
  const dir = sort === 'random' ? '' : '&sd=desc';
  return `sf=${sort}${dir}`;
}

// ---------------------------------------------------------------------------
// 代理请求 (三级回退策略)
// ---------------------------------------------------------------------------

interface ProxyFetchOptions extends RequestInit {
  directOnly?: boolean;
}

export async function proxyFetch(url: string, options?: ProxyFetchOptions): Promise<Response> {
  const s = getBrowsingSettings();

  if (options?.directOnly) {
    return fetch(url, options);
  }

  if (s.usePicponyProxy) {
    const proxyUrl = buildProxyUrl(url);
    try {
      const res = await fetch(proxyUrl, options);
      if (res.ok) return res;
      console.warn('[Proxy] 加速服务器响应异常', res.status, '回退直连');
    } catch {
      console.warn('[Proxy] 加速服务器请求失败，回退直连');
    }
  }

  let directError: Error | null = null;
  try {
    const res = await fetch(url, options);
    if (res.ok) return res;
    directError = new Error(`HTTP ${res.status}`);
    (directError as any).status = res.status;
  } catch (err) {
    directError = err as Error;
  }

  if (s.useApiAccel && !s.usePicponyProxy) {
    const proxyUrl = buildProxyUrl(url);
    try {
      const res = await fetch(proxyUrl, options);
      if (res.ok) return res;
    } catch {
      // ignore
    }
  }

  throw directError;
}

// ---------------------------------------------------------------------------
// Derpibooru 搜索请求 (用于 getImages / searchImagesByIds)
// ---------------------------------------------------------------------------

export interface DerpiSearchParams {
  query: string;
  page?: number;
  perPage?: number;
  sortField?: string;
  sortDir?: 'desc' | 'asc';
  isSearch?: boolean;
}

export async function fetchDerpiImages(
  baseUrl: string,
  params: DerpiSearchParams,
): Promise<Response> {
  const query = buildSearchQuery(params.query || undefined);
  let sortStr;
  if (params.sortField) {
    sortStr = `sf=${params.sortField}&sd=${params.sortDir || 'desc'}`;
  } else {
    sortStr = getSortParams(!!params.query || (params.isSearch ?? false));
  }

  return proxyFetch(
    `${baseUrl}/search/images?q=${query}&page=${params.page || 1}&per_page=${params.perPage || 50}&${sortStr}`,
    {
      cache: 'no-store',
      headers: { 'User-Agent': 'PicPony/1.0' },
    },
  );
}

// ---------------------------------------------------------------------------
// 通用错误处理
// ---------------------------------------------------------------------------

export async function handleDerpiError(res: Response): Promise<never> {
  let errorText = await res.text().catch(() => 'No error text');
  if (res.status === 429) {
    errorText = 'Too Many Requests';
  }
  console.error(`API Error: ${res.status} ${res.statusText}`, errorText);
  const error = new Error(errorText || res.statusText || 'Failed to fetch');
  (error as Error & { status?: number }).status = res.status;
  throw error;
}
