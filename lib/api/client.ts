import { LS_KEYS } from '@/lib/constants';
import { buildSearchQueryFrom, parseContentFilter, parseSortField, withDerpiContentFilter } from '@/lib/searchQuery';
import { defaultSearchSort, searchSort } from '@/lib/searchState';
import { currentBlockFilters, currentPublicBlacklist } from '@/lib/blockFilters';
import { toCurrentImageLine } from '@/lib/imageLoader';
import type { PonyImage } from '@/lib/types/image';
import { ApiError, toApiError } from './errors';
import { deadlineSignal } from './http';
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
    searchSort: defaultSearchSort(ls(LS_KEYS.searchSort, 'created_at')),
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
  /* Tolerant of a partial row: a merged duplicate can arrive with no representations or a
     null URL, and one such row must not take the whole page down with it. */
  const representations = image.representations && typeof image.representations === 'object'
    ? image.representations
    : {};
  return {
    ...image,
    representations: Object.fromEntries(
      Object.entries(representations).map(([k, v]) => [k, typeof v === 'string' ? toCurrentImageLine(v) : v]),
    ) as unknown as PonyImage['representations'],
    view_url: typeof image.view_url === 'string' ? toCurrentImageLine(image.view_url) : image.view_url,
  };
}

/** This device's blocked-tag list, trimmed and lower-cased; a corrupt or blocked list is empty. */
export function readHiddenTags(): string[] {
  try {
    if (typeof window === 'undefined') return [];
    const active: unknown = JSON.parse(localStorage.getItem(LS_KEYS.activeHiddenTags) || '[]');
    if (!Array.isArray(active)) return [];
    return active
      .filter((t): t is string => typeof t === 'string' && Boolean(t.trim()))
      .map((t) => t.trim().toLowerCase());
  } catch {
    return [];
  }
}

/**
 * The search query, from this device's current settings (server callers use `lib/feed.server.ts`).
 *
 * `contentFilter` pins the filter a keyed resource was read under, so a preference changed while
 * the request waited for the route policy cannot put another mode's pictures under its key.
 */
export function buildSearchQuery(search?: string, contentFilter?: string): string {
  const s = getBrowsingSettings();
  return buildSearchQueryFrom(
    {
      contentFilter: contentFilter ?? s.contentFilter,
      banAnthro: s.banAnthro,
      banDiscomfort: s.banDiscomfort,
      onlyPony: s.onlyPony,
      hiddenTags: readHiddenTags(),
    },
    search,
    currentBlockFilters(),
    currentPublicBlacklist(),
  );
}

/**
 * The random sort's seed, one per document.
 *
 * Philomena reshuffles `sf=random` on every request, so an unseeded random sort gave page 2
 * pictures page 1 had already shown (and omitted others), and every background revalidation
 * replaced what was on screen with a different random page. `random:<seed>` is a stable
 * shuffle. Per document rather than per session: paging and refreshes keep the order, a reload
 * reshuffles — which is what reloading a random view is for. Never used on the server (the
 * home seed skips the random sort, see `lib/feed.server.ts`).
 */
let randomSeed = 0;

export function randomSortParam(): string {
  if (!randomSeed) {
    const cell = new Uint32Array(1);
    if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
      crypto.getRandomValues(cell);
    } else {
      cell[0] = Math.floor(Math.random() * 0xffffffff);
    }
    randomSeed = cell[0] || 1;
  }
  return `random:${randomSeed}`;
}

/** `sf=…&sd=…` for a validated sort field; the random sort takes the document's seed and no direction. */
export function sortQuery(field: string, direction: 'asc' | 'desc' = 'desc'): string {
  return field === 'random' ? `sf=${randomSortParam()}` : `sf=${field}&sd=${direction === 'asc' ? 'asc' : 'desc'}`;
}

function getSortParams(isSearch: boolean): string {
  const s = getBrowsingSettings();
  return sortQuery(isSearch ? s.searchSort : s.homeSort);
}

/** In-place retries per line, and how many times the line itself may change. */
const MAX_ATTEMPTS = 3;
const MAX_SWITCHES = 3;

/**
 * One attempt's ceiling, and the whole request's. There were none: the only bounds were the
 * route handlers' 30s, so the relay line's three in-place attempts could hold a skeleton — and a
 * scheduler slot — for ~91s, and a blocked direct connection hung for the OS's TCP timeout. An
 * attempt that times out is treated like a network failure (retried, or failed over on `auto`);
 * the budget stops the ladder from spending more than this in total, pauses included.
 */
export const DERPI_ATTEMPT_DEADLINE_MS = 12_000;
export const DERPI_TOTAL_BUDGET_MS = 25_000;

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
 * answers, not broken lines.
 *
 * A GET resolves only with an OK response. Every failure is an `ApiError` carrying the last
 * status, including when the ladder runs out — so a screen can tell a rate limit from an outage
 * from a missing record. The caller's own abort is rethrown as it came.
 */
export async function proxyFetch(
  url: string,
  options?: RequestInit,
  contentFilter?: string,
): Promise<Response> {
  const callerSignal = options?.signal;
  callerSignal?.throwIfAborted();
  await waitForRoutePolicy(callerSignal);
  callerSignal?.throwIfAborted();

  const method = (options?.method ?? 'GET').toUpperCase();
  if (method !== 'GET' && method !== 'HEAD') {
    /* A body cannot travel through a `?url=` worker; `applyApiLineToWrite` picks between
       the two possibilities a write has. No deadline: aborting an upload does not stop the
       server accepting it. */
    try {
      return await fetch(applyApiLineToWrite(url), options);
    } catch (error) {
      if (callerSignal?.aborted) throw error;
      throw toApiError(error);
    }
  }

  // A keyed resource supplies its filter snapshot; waiting for policy must not change its answer.
  url = withDerpiContentFilter(url, contentFilter ?? getBrowsingSettings().contentFilter);
  const carriesKey = /[?&]key=/.test(url);
  const startedAt = Date.now();

  let attempts = 0;
  let switches = 0;
  let directRetried = false;
  let lastError: ApiError = new ApiError('network');

  const remaining = () => DERPI_TOTAL_BUDGET_MS - (Date.now() - startedAt);
  /* Waits before the next attempt, unless the budget cannot afford the wait plus a useful
     attempt — then the last failure is the answer. */
  const pause = async (ms: number) => {
    if (remaining() - ms < 1_000) throw lastError;
    await sleep(ms, callerSignal);
  };

  for (;;) {
    const line = resolveApiLine();
    const forced = isApiForced();
    const target = buildApiLineUrl(url, line);
    const deadline = deadlineSignal(
      callerSignal,
      Math.min(DERPI_ATTEMPT_DEADLINE_MS, Math.max(remaining(), 1_000)),
    );

    let status: number | undefined;
    try {
      const res = await fetch(target, { ...options, signal: deadline.signal });
      /* The deadline stays armed for the body: a stalled body read is as stuck as a stalled
         connection, and the adapter's decoder turns our abort into a `timeout`. */
      if (res.ok) return res;
      deadline.dispose();
      status = res.status;
      lastError = new ApiError('http', { status: res.status });
      /* An unused failure body still owns its upstream connection until it is consumed or
         cancelled. A retry must release it before opening another connection. */
      void res.body?.cancel().catch(() => {});
    } catch (err) {
      deadline.dispose();
      /* A cancellation is not a failure of anything. Retrying re-`fetch`es an already-aborted
         signal, so the loop just burns its budget and then throws something that is no longer
         an `AbortError` — and on the `auto` cascade it would announce two line switches
         because the pointer left a gallery card. */
      if (callerSignal?.aborted) throw err;
      const failure = toApiError(err, deadline.timedOut());
      if (!(failure instanceof ApiError)) throw failure;
      lastError = failure;
    }

    /* A 404 or a 400 is an answer, not a broken line. Only a network throw, our own timeout
       and the statuses a proxy emits when it cannot reach its upstream are worth another go. */
    if (status !== undefined && !API_FAILOVER_STATUSES.includes(status)) throw lastError;
    if (status === 403 && carriesKey) throw lastError;

    attempts += 1;

    if (forced || line === 'picpony_api') {
      if (attempts >= MAX_ATTEMPTS) throw lastError;
      await pause(300 * attempts);
      continue;
    }

    if (line === 'direct' && !directRetried) {
      directRetried = true;
      await pause(300);
      continue;
    }

    if (switches < MAX_SWITCHES && remaining() > 1_000 && stepApiFailover(status)) {
      switches += 1;
      attempts = 0;
      continue;
    }

    if (attempts >= MAX_ATTEMPTS) throw lastError;
    await pause(300 * attempts);
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
  contentFilter?: string,
): Promise<Response> {
  await waitForRoutePolicy(signal);
  const query = buildSearchQuery(params.query || undefined, contentFilter);
  const sortStr = params.sortField
    ? sortQuery(searchSort(params.sortField), params.sortDir)
    : getSortParams(!!params.query || (params.isSearch ?? false));

  try {
    return await proxyFetch(
      `${baseUrl}/search/images?q=${query}&page=${params.page || 1}&per_page=${params.perPage || 50}&${sortStr}`,
      { cache: 'no-store', signal },
      contentFilter,
    );
  } catch (error) {
    /* A 400 on a search that carried the user's own text is the text's fault — Derpibooru could
       not parse it — so it becomes a `syntax` error: no 重试, and a message about the query
       rather than the network. Unbalanced parentheses never get this far (see
       `balanceUserQuery`); this covers whatever else the grammar rejects. */
    if (params.query && error instanceof ApiError && error.kind === 'http' && error.status === 400) {
      throw new ApiError('syntax', { status: 400, cause: error });
    }
    throw error;
  }
}
