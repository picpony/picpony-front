import { LS_KEYS } from '@/lib/constants';
import { buildSearchQueryFrom } from '@/lib/searchQuery';
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

/**
 * What the user asked to *see*. The four line preferences are not here — `lib/route.ts`
 * owns those; which host answers is a different question from what the answer contains.
 */
export interface BrowsingSettings {
  contentFilter: 'safe' | 'spoilers' | 'developer';
  banAnthro: boolean;
  banDiscomfort: boolean;
  onlyPony: boolean;
  homeSort: string;
  searchSort: string;
}

/**
 * Device browsing settings, with defaults on the server.
 *
 * The guarded `localStorage` is a crash fix, not defensiveness: resource-cache keys read this
 * during render, and Next renders client components on the server too — an unguarded read
 * there took whole routes into client-only rendering. The server has no device to ask.
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

/**
 * Put a whole search result on the current image line.
 *
 * Applied centrally in `lib/api/derpi.ts` so it reaches every image consumer — the featured
 * banner, the opened picture and the profile grids render URLs directly and would otherwise
 * miss the policy. Idempotent (`toCurrentImageLine` strips before it wraps), so screens that
 * also map are no-ops.
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

/** The search query, from this device's current settings (server callers use `lib/feed.server.ts`). */
export function buildSearchQuery(search?: string): string {
  const s = getBrowsingSettings();
  let hiddenTags: string[] = [];
  try {
    const active: unknown = JSON.parse(localStorage.getItem(LS_KEYS.activeHiddenTags) || '[]');
    if (Array.isArray(active)) {
      hiddenTags = active
        .filter((t): t is string => typeof t === 'string' && Boolean(t))
        .map((t) => t.trim().toLowerCase());
    }
  } catch {
    /* A corrupt list is an empty one. */
  }
  return buildSearchQueryFrom(
    {
      contentFilter: s.contentFilter,
      banAnthro: s.banAnthro,
      onlyPony: s.onlyPony,
      hiddenTags,
    },
    search,
  );
}

function getSortParams(isSearch: boolean): string {
  const s = getBrowsingSettings();
  const sort = isSearch ? s.searchSort : s.homeSort;
  const dir = sort === 'random' ? '' : '&sd=desc';
  return `sf=${sort}${dir}`;
}

/** In-place retries per line, and how many times the line itself may change. */
const MAX_ATTEMPTS = 3;
const MAX_SWITCHES = 3;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Send a Derpibooru request on whichever line is in force, after awaiting the route policy —
 * resolved, that await costs a microtask; before then it is what keeps the first request of a
 * cold load off the default host while an administrator has the site pinned elsewhere.
 *
 * Failover is asymmetric by design: under a forced policy or on the PicPony relay, retry in
 * place and never change line — an admin's choice is not ours to leave, and the relay exists
 * for the visitor whose direct connection does not work. On `auto` over direct or accel, one
 * plain retry then `stepApiFailover` (the reachable cascade is direct → accel → direct with
 * cooldown; the relay step is unreachable because the relay is the default preference).
 * 429 never fails over: a rate limit is counted against the caller, so moving lines spreads
 * one visitor's limit onto everyone who shares the next one. Cancellation is not a failure:
 * retrying would re-fetch an aborted signal and announce two line switches on the `auto`
 * cascade. A 403 that carried a key is about the key — no other line answers it differently,
 * so failing over spends six requests and two snackbars on a revoked credential. 404/400 are
 * answers, not broken lines. `readJson` turns a dead line into `{ success: false }`, so the
 * decision is made on `res.ok` and the status here.
 */
export async function proxyFetch(url: string, options?: RequestInit): Promise<Response> {
  await ensureRoutePolicy();

  const method = (options?.method ?? 'GET').toUpperCase();
  if (method !== 'GET' && method !== 'HEAD') {
    /* A body cannot travel through a `?url=` worker; `applyApiLineToWrite` picks between
       the two possibilities a write has. */
    return fetch(applyApiLineToWrite(url), options);
  }

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
 * `Response.json()` that survives an empty or non-JSON body: a dropped session, PHP fatal or
 * proxy hiccup answers `200` with an empty body or HTML page, and a bare `res.json()` threw
 * from inside a background unread-count poll on every tick. Callers branch on `data.success`,
 * so a parse failure is reported as the API's own logical failure, not an exception.
 */
/* `T = any` mirrors `Response.json()`'s own signature; narrowing to `unknown` would demand
   an annotation at all 29 call sites. */
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
