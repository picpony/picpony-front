import { LS_KEYS } from '@/lib/constants';
import { toCurrentImageLine } from '@/lib/imageLoader';
import type { PonyImage } from '@/lib/types/image';
import {
  API_FAILOVER_STATUSES,
  applyApiLineToWrite,
  buildApiLineUrl,
  ensureRoutePolicy,
  isApiForced,
  resolveApiLine,
  resolveImageLine,
  stepApiFailover,
} from '@/lib/route';

// ---------------------------------------------------------------------------
// 浏览设置类型
// ---------------------------------------------------------------------------

/**
 * What the user has asked to *see*. The four line preferences are not in here —
 * `lib/route.ts` owns those, because which host answers is a different question from
 * what the answer should contain.
 */
export interface BrowsingSettings {
  contentFilter: 'safe' | 'spoilers' | 'developer';
  banAnthro: boolean;
  banDiscomfort: boolean;
  onlyPony: boolean;
  homeSort: string;
  searchSort: string;
}

// ---------------------------------------------------------------------------
// 浏览设置（来自 localStorage）
// ---------------------------------------------------------------------------

/**
 * `localStorage` is guarded, and that is not defensiveness — it is a crash this function caused.
 *
 * These are device preferences, so the natural assumption is that only client code reads them. That
 * stopped being true when the resource cache started folding them into its **keys**:
 * `useResource` computes a key during render, Next renders client components on the server too, and
 * an unguarded `localStorage` there is a `ReferenceError` that takes the whole route into client-only
 * rendering. The defaults are the right answer for the server — it has no device to ask — and the
 * first client render reads the real values.
 */
export function getBrowsingSettings(): BrowsingSettings {
  const ls = (k: string, def: string) =>
    typeof window === 'undefined' ? def : (localStorage.getItem(k) ?? def);
  return {
    contentFilter: ls(LS_KEYS.contentFilter, 'safe') as 'safe' | 'spoilers' | 'developer',
    banAnthro: ls(LS_KEYS.banAnthro, 'false') === 'true',
    banDiscomfort: ls(LS_KEYS.banDiscomfort, 'true') !== 'false',
    onlyPony: ls(LS_KEYS.onlyPony, 'false') === 'true',
    homeSort: ls(LS_KEYS.homeSort, 'created_at'),
    searchSort: ls(LS_KEYS.searchSort, 'created_at'),
  };
}

// ---------------------------------------------------------------------------
// 图片线路
// ---------------------------------------------------------------------------

/**
 * Put a whole search result on the current image line.
 *
 * Applied centrally in `lib/api/derpi.ts` so it reaches every consumer of an image, not only
 * the three grids that used to do it themselves — the featured banner, the opened picture and
 * both profile grids render their URLs directly and so ignored the policy entirely. It is
 * idempotent (`toCurrentImageLine` strips before it wraps), which is what makes applying it in
 * both places safe.
 *
 * Three screens had this map written out beside a hand-typed read of the CDN storage key — the
 * key restated at three call sites, guarding a function that checked the same thing itself.
 * Spelled in prose rather than quoted, so a grep for that literal still proves it is gone.
 */
export function applyImageLine<T extends PonyImage>(image: T): T {
  if (resolveImageLine() === 'direct') return image;
  return {
    ...image,
    representations: Object.fromEntries(
      Object.entries(image.representations).map(([k, v]) => [k, toCurrentImageLine(v as string)]),
    ) as unknown as PonyImage['representations'],
    view_url: toCurrentImageLine(image.view_url),
  };
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
      localStorage.getItem(LS_KEYS.activeHiddenTags) || '[]',
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
// 按线路发请求
// ---------------------------------------------------------------------------

/** In-place retries on one line, and how many times the line itself may change. */
const MAX_ATTEMPTS = 3;
const MAX_SWITCHES = 3;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Send a Derpibooru request on whichever line is in force.
 *
 * The policy is awaited first, every time. That await is the whole reason a line can
 * be trusted: resolved once it costs a microtask, and before then it is what stops the
 * first request of a cold load from going out on the default host while an
 * administrator has the site pinned somewhere else.
 *
 * Failover is asymmetric by design:
 *
 * - **Forced, or on the PicPony relay** — retry in place, never change line. An
 *   administrator's choice is not ours to leave, and the relay exists precisely for
 *   the visitor whose direct connection does not work, so dropping them back to it
 *   would undo the only thing that line is for.
 * - **`auto`, on direct or the accel line** — one plain retry, then hand over to
 *   `stepApiFailover`. Since the relay is the default preference, the cascade that is
 *   actually reachable is direct → accel → direct-with-cooldown.
 *
 * Not ported: the old frontend's request queue, its exponential backoff and its
 * concurrency shrink. Those hang off a rate limiter this app has never had; the short
 * linear delay below is the proportionate stand-in.
 */
export async function proxyFetch(url: string, options?: RequestInit): Promise<Response> {
  await ensureRoutePolicy();

  const method = (options?.method ?? 'GET').toUpperCase();
  if (method !== 'GET' && method !== 'HEAD') {
    /* A body cannot travel through a `?url=` worker, so a write has only two
       possibilities and `applyApiLineToWrite` picks between them. */
    return fetch(applyApiLineToWrite(url), options);
  }

  /* A 403 on a request that carried a key is about the key, not about the host: no other
     line will answer it differently, so failing over spends six requests and two snackbars
     on a revoked credential. */
  const carriesKey = /[?&]key=/.test(url);

  let attempts = 0;
  let switches = 0;
  let directRetried = false;
  let lastError: Error = new Error('请求失败');

  for (;;) {
    const line = resolveApiLine();
    const forced = isApiForced();
    const target = buildApiLineUrl(url, line);

    let status: number | undefined;
    try {
      const res = await fetch(target, options);
      if (res.ok) return res;
      status = res.status;
      const httpError = new Error(`HTTP ${res.status}`) as Error & { status?: number };
      httpError.status = res.status;
      lastError = httpError;
    } catch (err) {
      lastError = err as Error;
    }

    /* A cancellation is not a failure of anything. Retrying re-`fetch`es an already-aborted
       signal, so the loop just burns its budget and then throws something that is no longer
       an `AbortError` — and on the `auto` cascade it would announce two line switches
       because the pointer left a gallery card. */
    if (options?.signal?.aborted || lastError.name === 'AbortError') throw lastError;

    /* A 404 or a 400 is an answer, not a broken line. Only a network throw and the
       statuses a proxy emits when it cannot reach its upstream are worth another go. */
    if (status !== undefined && !API_FAILOVER_STATUSES.includes(status)) throw lastError;
    if (status === 403 && carriesKey) throw lastError;

    attempts += 1;

    if (forced || line === 'picpony_api') {
      if (attempts >= MAX_ATTEMPTS) {
        throw new Error(
          forced
            ? '强制 API 线路已重试多次仍不可用'
            : 'PicPony API 线路已重试多次仍不可用',
        );
      }
      await sleep(300 * attempts);
      continue;
    }

    if (line === 'direct' && !directRetried) {
      directRetried = true;
      await sleep(300);
      continue;
    }

    if (switches < MAX_SWITCHES && stepApiFailover(status)) {
      switches += 1;
      attempts = 0;
      continue;
    }

    if (attempts >= MAX_ATTEMPTS) throw lastError;
    await sleep(300 * attempts);
  }
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
