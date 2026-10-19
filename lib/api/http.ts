/**
 * The transport to PicPony's Rust backend (`/api/v1` on api.picpony.top), reached from the browser
 * through this app's own `app/api/v1/[...path]` proxy so the session's `auth_bind` cookie stays
 * first-party.
 *
 * The protocol: resource paths only (no `?action=`); a 2xx answers with the bare JSON DTO (or 204
 * and no body); a failure is a non-2xx with `{"error":{"code","message"}}`. A session is a Bearer
 * token plus the `auth_bind` cookie, and every write also carries `X-CSRF-Token`.
 *
 * `api()` is what adapters call; `apiRequest()` + `readApi()` when the `Response` itself is needed
 * (a stream, a header). `readObject`, `listOf` and `deadlineSignal` also serve the Derpibooru
 * reads (`lib/api/derpi.ts`, `proxyFetch`), which are a third-party API and keep its shapes.
 */
import { clearUserInfo, readUserInfo, updateUserInfo } from '@/lib/hooks';
import { showToast } from '@/lib/toast';
import { ApiError, toApiError } from './errors';

/**
 * A read's ceiling. The only bounds used to be server-side (the proxy handler's 30s), so a
 * wedged upstream held a skeleton — and a scheduler slot — for half a minute before anything
 * could be shown. Generous on purpose: the backend's observed latency under load is ~9s, and
 * turning a slow answer into a failure would only make the retry pay it again.
 */
export const READ_DEADLINE_MS = 15_000;

/**
 * A signal that aborts when the caller's does or when `ms` passes — and a way to tell the two
 * apart, since a timeout is a failure to report while the caller's abort is not.
 *
 * Hand-built rather than `AbortSignal.any` + `AbortSignal.timeout`: both are recent enough
 * (Safari 17.4 and 16) that relying on them would make every read throw on an older phone. The
 * timer is left to run out after a fast answer — the abort it then performs on a finished
 * request is a no-op — and unref'd where the runtime has that, so a test process can exit.
 */
export function deadlineSignal(caller: AbortSignal | null | undefined, ms: number) {
  const controller = new AbortController();
  let timedOut = false;
  const forward = () => controller.abort(caller?.reason);
  if (caller?.aborted) controller.abort(caller.reason);
  else caller?.addEventListener('abort', forward, { once: true });
  const timer = setTimeout(() => {
    timedOut = true;
    caller?.removeEventListener('abort', forward);
    controller.abort(new DOMException('请求超时', 'TimeoutError'));
  }, ms);
  (timer as { unref?: () => void }).unref?.();
  return {
    signal: controller.signal,
    timedOut: () => timedOut,
    dispose() {
      clearTimeout(timer);
      caller?.removeEventListener('abort', forward);
    },
  };
}

// ---------------------------------------------------------------------------
// A dead session
// ---------------------------------------------------------------------------

/** One confirmation per token in flight, so a screenful of 401s costs one check. */
const sessionChecks = new Map<string, Promise<void>>();

function expireSession(token: string) {
  /* Token-checked: a slow request from before a re-login must not sign the new login out.
     `clearUserInfo` answering false also means somebody already did it — so the notice below
     is shown once per dead session, however many requests discover it. */
  if (!clearUserInfo(token)) return;
  showToast('登录已过期，请重新登录', 'warning');
}

// ---------------------------------------------------------------------------
// Decoding
// ---------------------------------------------------------------------------

/** A body read that failed: our own deadline becomes `timeout`; a caller's abort is kept. */
async function readBody(res: Response): Promise<string> {
  try {
    return await res.text();
  } catch (error) {
    if (error instanceof Error && error.name === 'TimeoutError') throw new ApiError('timeout', { cause: error });
    throw error;
  }
}

function parseObject(text: string): Record<string, unknown> | null {
  if (!text) return null;
  try {
    const data: unknown = JSON.parse(text);
    return data !== null && typeof data === 'object' && !Array.isArray(data)
      ? (data as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

/**
 * Read a JSON object from a third-party API (Derpibooru, the image-search service), throwing
 * `invalid` for anything else. The status has already been checked by the caller (`proxyFetch`).
 * Not for `/api/v1`: that is `readApi`.
 */
export async function readObject<T extends object>(res: Response): Promise<T> {
  const data = parseObject(await readBody(res));
  if (!data) throw new ApiError('invalid', { status: res.status });
  return data as T;
}

/**
 * A list field, normalised at the boundary: anything that is not an array is an empty one.
 * The page setters downstream then cannot receive `undefined` — one partial response once took
 * every tab of /messages down with `.length` of undefined.
 */
export function listOf<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

// ===========================================================================
// /api/v1 — the Rust backend (api.picpony.top), reached through this app's own
// `app/api/v1/[...path]` proxy so the session's `auth_bind` cookie stays first-party.
// ===========================================================================

/** The browser-relative prefix every new-backend call goes through. */
export const API_V1 = '/api/v1';

type ApiQueryValue = string | number | boolean | undefined | null;

export interface ApiOptions extends Omit<RequestInit, 'method' | 'body'> {
  /** The session token; `undefined` sends no Authorization header. */
  token?: string | null;
  query?: Record<string, ApiQueryValue | readonly ApiQueryValue[]>;
  /** A JSON body (sets the content type). */
  json?: unknown;
  /** Any other body (FormData, Blob). Mutually exclusive with `json`. */
  body?: BodyInit;
  timeoutMs?: number | false;
  /** For writes the UI may retry (posts, replies, messages): the backend dedupes on it. */
  idempotencyKey?: string;
  /** Statuses that mean "does not exist" for this resource (404 always does). */
  notFoundStatuses?: readonly number[];
}

/** The backend's error body: `{"error":{"code","message"}}`. */
export function apiErrorBody(data: unknown): { code?: string; message?: string } {
  const error = (data as { error?: unknown } | null)?.error;
  if (!error || typeof error !== 'object') return {};
  const { code, message } = error as { code?: unknown; message?: unknown };
  return {
    code: typeof code === 'string' ? code : undefined,
    message: typeof message === 'string' && message.trim() ? message.trim() : undefined,
  };
}

/** The CSRF token issued with the session (`csrf_token` on login), kept beside the token. */
function storedCsrf(token: string): string | null {
  const user = readUserInfo();
  return user && user.token === token && typeof user.csrfToken === 'string' ? user.csrfToken : null;
}

/** One refresh per token in flight. */
const csrfRefreshes = new Map<string, Promise<string | null>>();

function refreshCsrf(token: string): Promise<string | null> {
  let pending = csrfRefreshes.get(token);
  if (!pending) {
    pending = fetch(`${API_V1}/auth/csrf`, {
      headers: { Authorization: `Bearer ${token}` },
      cache: 'no-store',
      credentials: 'same-origin',
    })
      .then(async (res) => {
        if (!res.ok) return null;
        const data = (await res.json()) as { csrf_token?: unknown };
        const csrf = typeof data.csrf_token === 'string' ? data.csrf_token : null;
        if (csrf) updateUserInfo(token, { csrfToken: csrf });
        return csrf;
      })
      .catch(() => null)
      .finally(() => csrfRefreshes.delete(token));
    csrfRefreshes.set(token, pending);
  }
  return pending;
}

function apiUrl(path: string, query: ApiOptions['query']): string {
  const params = new URLSearchParams();
  for (const [name, value] of Object.entries(query ?? {})) {
    const values = Array.isArray(value) ? value : [value];
    for (const v of values) if (v !== undefined && v !== null) params.append(name, String(v));
  }
  const search = params.toString();
  return `${API_V1}${path}${search ? `?${search}` : ''}`;
}

/**
 * A 401 on a request that carried the token ends the session once, with one notice.
 *
 * Only `GET /me` is taken at its word. Any other 401 is confirmed against `GET /me` first: a
 * resource may answer 401 for a wrong *password* while the session itself is fine, and signing
 * somebody out over a typo would be the worse bug. The confirmation is a raw `fetch`, so it cannot
 * recurse into this handler, and it is bounded like any read (review P1-F9) — one that never
 * settled would keep this token's slot taken and every later 401 for it would be ignored.
 */
function onApiUnauthorized(path: string, token: string) {
  if (typeof window === 'undefined' || !token) return;
  if (path === '/me') {
    expireSession(token);
    return;
  }
  if (sessionChecks.has(token)) return;
  const deadline = deadlineSignal(undefined, READ_DEADLINE_MS);
  const check = fetch(`${API_V1}/me`, {
    headers: { Authorization: `Bearer ${token}` },
    cache: 'no-store',
    credentials: 'same-origin',
    signal: deadline.signal,
  })
    .then((response) => {
      void response.body?.cancel().catch(() => {});
      if (response.status === 401) expireSession(token);
    })
    .catch(() => {})
    .finally(() => {
      deadline.dispose();
      sessionChecks.delete(token);
    });
  sessionChecks.set(token, check);
}

/**
 * One new-backend request. Writes carry `X-CSRF-Token`; a `CSRF_MISMATCH` refusal (the backend
 * rejects it before the handler runs, so nothing happened) refreshes the token and is sent once
 * more. Reads are bounded by `READ_DEADLINE_MS`; writes are not, and are never retried otherwise.
 */
export async function apiRequest(method: string, path: string, options: ApiOptions = {}): Promise<Response> {
  const { token, query, json, body, timeoutMs, idempotencyKey, notFoundStatuses: _nf, ...init } = options;
  void _nf;
  const verb = method.toUpperCase();
  const write = verb !== 'GET' && verb !== 'HEAD';
  const url = apiUrl(path, query);
  const send = async (csrf: string | null): Promise<Response> => {
    const headers = new Headers(init.headers);
    if (token) headers.set('Authorization', `Bearer ${token}`);
    if (write && token && csrf) headers.set('X-CSRF-Token', csrf);
    if (idempotencyKey) headers.set('Idempotency-Key', idempotencyKey);
    if (json !== undefined) headers.set('Content-Type', 'application/json');
    const limit = timeoutMs ?? (write ? false : READ_DEADLINE_MS);
    const deadline = limit === false ? null : deadlineSignal(init.signal, limit);
    try {
      return await fetch(url, {
        ...init,
        method: verb,
        headers,
        credentials: 'same-origin',
        body: json !== undefined ? JSON.stringify(json) : body,
        ...(deadline ? { signal: deadline.signal } : {}),
      });
    } catch (error) {
      deadline?.dispose();
      throw toApiError(error, deadline?.timedOut() ?? false);
    }
  };
  let response = await send(token ? storedCsrf(token) : null);
  if (write && token && response.status === 403) {
    const { code } = apiErrorBody(await response.clone().json().catch(() => null));
    if (code === 'CSRF_MISMATCH') {
      const fresh = await refreshCsrf(token);
      if (fresh) response = await send(fresh);
    }
  }
  if (response.status === 401 && token) onApiUnauthorized(path, token);
  return response;
}

/**
 * Decode a new-backend answer. 2xx → the JSON body (`undefined` for 204 / an empty body);
 * anything else → `ApiError` carrying the backend's `error.code` and `error.message`.
 */
export async function readApi<T>(res: Response, options: { notFoundStatuses?: readonly number[] } = {}): Promise<T> {
  const text = await readBody(res);
  let data: unknown = undefined;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      if (res.ok) throw new ApiError('invalid', { status: res.status });
    }
  }
  if (!res.ok) {
    const { code, message } = apiErrorBody(data);
    throw new ApiError('http', {
      status: res.status,
      code,
      serverMessage: message,
      notFound: res.status === 404 || options.notFoundStatuses?.includes(res.status) || undefined,
    });
  }
  return data as T;
}

/** `apiRequest` + `readApi`. */
export async function api<T>(method: string, path: string, options: ApiOptions = {}): Promise<T> {
  return readApi<T>(await apiRequest(method, path, options), { notFoundStatuses: options.notFoundStatuses });
}

/** A path segment, encoded. */
export const seg = (value: string | number) => encodeURIComponent(String(value));
