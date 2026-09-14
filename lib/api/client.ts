import { LS_KEYS } from '@/lib/constants';
import { buildSearchQueryFrom, parseContentFilter, parseSortField, withDerpiContentFilter } from '@/lib/searchQuery';
import { searchSort } from '@/lib/searchState';
import { currentBlockFilters } from '@/lib/blockFilters';
import { toCurrentImageLine } from '@/lib/imageLoader';
import type { PonyImage } from '@/lib/types/image';
import {
  API_FAILOVER_STATUSES,
  applyApiLineToWrite,
  buildApiLineUrl,
  ensureRoutePolicy,
  isApiForced,
  resolveApiLine,
  stepApiFailover,
} from '@/lib/route';

// Compatibility for existing callers; the decoder itself has no route-policy dependencies.
export { readJson } from './http';

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
  const ls = (k: string, def: string) => {
    try {
      return typeof window === 'undefined' ? def : (localStorage.getItem(k) ?? def);
    } catch {
      return def;
    }
  };
  return {
    contentFilter: parseContentFilter(ls(LS_KEYS.contentFilter, 'safe')),
    banAnthro: ls(LS_KEYS.banAnthro, 'false') === 'true',
    banDiscomfort: ls(LS_KEYS.banDiscomfort, 'true') !== 'false',
    onlyPony: ls(LS_KEYS.onlyPony, 'false') === 'true',
    homeSort: parseSortField(ls(LS_KEYS.homeSort, 'created_at')),
    searchSort: searchSort(ls(LS_KEYS.searchSort, 'created_at')),
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
      banDiscomfort: s.banDiscomfort,
      onlyPony: s.onlyPony,
      hiddenTags,
    },
    search,
    currentBlockFilters(),
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

function sleep(ms: number, signal?: AbortSignal | null): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(signal.reason);
      return;
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', cancel);
      resolve();
    }, ms);
    const cancel = () => {
      clearTimeout(timer);
      reject(signal?.reason);
    };
    signal?.addEventListener('abort', cancel, { once: true });
  });
}

/** One caller leaving must stop waiting without aborting the shared policy read for others. */
function waitForRoutePolicy(signal?: AbortSignal | null): Promise<void> {
  const ready = ensureRoutePolicy();
  if (!signal) return ready;
  return new Promise((resolve, reject) => {
    const cancel = () => reject(signal.reason);
    if (signal.aborted) {
      cancel();
      return;
    }
    signal.addEventListener('abort', cancel, { once: true });
    ready.then(() => {
      signal.removeEventListener('abort', cancel);
      resolve();
    }, (error) => {
      signal.removeEventListener('abort', cancel);
      reject(error);
    });
  });
}

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
export async function proxyFetch(
  url: string,
  options?: RequestInit,
  contentFilter?: string,
): Promise<Response> {
  options?.signal?.throwIfAborted();
  await waitForRoutePolicy(options?.signal);
  options?.signal?.throwIfAborted();

  const method = (options?.method ?? 'GET').toUpperCase();
  if (method !== 'GET' && method !== 'HEAD') {
    /* A body cannot travel through a `?url=` worker; `applyApiLineToWrite` picks between
       the two possibilities a write has. */
    return fetch(applyApiLineToWrite(url), options);
  }

  // A keyed resource supplies its filter snapshot; waiting for policy must not change its answer.
  url = withDerpiContentFilter(url, contentFilter ?? getBrowsingSettings().contentFilter);
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
      /* An unused failure body still owns its upstream connection until it is consumed or
         cancelled. A retry must release it before opening another connection. */
      void res.body?.cancel().catch(() => {});
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
      await sleep(300 * attempts, options?.signal);
      continue;
    }

    if (line === 'direct' && !directRetried) {
      directRetried = true;
      await sleep(300, options?.signal);
      continue;
    }

    if (switches < MAX_SWITCHES && stepApiFailover(status)) {
      switches += 1;
      attempts = 0;
      continue;
    }

    if (attempts >= MAX_ATTEMPTS) throw lastError;
    await sleep(300 * attempts, options?.signal);
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
  signal?: AbortSignal,
): Promise<Response> {
  await waitForRoutePolicy(signal);
  const query = buildSearchQuery(params.query || undefined);
  let sortStr;
  if (params.sortField) {
    sortStr = `sf=${searchSort(params.sortField)}&sd=${params.sortDir === 'asc' ? 'asc' : 'desc'}`;
  } else {
    sortStr = getSortParams(!!params.query || (params.isSearch ?? false));
  }

  return proxyFetch(
    `${baseUrl}/search/images?q=${query}&page=${params.page || 1}&per_page=${params.perPage || 50}&${sortStr}`,
    {
      cache: 'no-store',
      headers: { 'User-Agent': 'PicPony/1.0' },
      signal,
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
