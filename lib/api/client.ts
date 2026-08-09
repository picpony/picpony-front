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
        tags = '-suggestive, -explicit, -questionable, -grotesque, -grimdark';
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
    const activeHidden: string[] = JSON.parse(
      localStorage.getItem('trixie_active_hidden_tags') || '[]',
    );
    const blockNegations = activeHidden
      .filter((t) => t && typeof t === 'string')
      .map((t) => `-${t.trim().toLowerCase()}`);
    if (blockNegations.length > 0) {
      tags = tags ? `${tags}, ${blockNegations.join(', ')}` : blockNegations.join(', ');
    }
  } catch {
    /* ignore */
  }

  if (!tags && s.contentFilter !== 'developer') {
    tags = '-suggestive, -explicit, -questionable, -grotesque, -grimdark, pony';
  }

  if (search) {
    tags = tags ? `${search}, ${tags}` : search;
  }

  // 开发者模式无附加过滤时，空关键词会请求 `q=`（Derpibooru 视为未指定）——
  // 旧前端以 '*' 表示"全部内容"，此处保持一致
  return encodeURIComponent(tags || '*');
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
    const httpError = new Error(`HTTP ${res.status}`) as Error & { status?: number };
    httpError.status = res.status;
    directError = httpError;
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

/**
 * `Response.json()` that survives an empty or non-JSON body.
 *
 * The PicPony endpoints answer `200` with a JSON envelope on the happy path,
 * but a dropped session, a PHP fatal or a proxy hiccup can return an empty body
 * or an HTML error page. `res.json()` then throws `Unexpected end of JSON
 * input` from inside whatever called it — which is how a background unread-count
 * poll ended up throwing on every tick.
 *
 * Callers all branch on `data.success`, so a parse failure is reported the same
 * way the API reports a logical failure rather than as an exception.
 */
/* `T = any` mirrors `Response.json()`'s own signature. Narrowing it to
   `unknown` would be more correct in isolation but would demand an annotation
   at all 29 call sites, and the point of this change is to fix a crash without
   touching their shapes. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function readJson<T = any>(res: Response): Promise<T> {
  const text = await res.text();
  if (!text) {
    return { success: false, message: res.statusText || '空响应' } as T;
  }
  try {
    return JSON.parse(text) as T;
  } catch {
    return {
      success: false,
      message: `响应不是合法 JSON (HTTP ${res.status})`,
    } as T;
  }
}
