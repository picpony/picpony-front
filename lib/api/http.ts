import { PICPONY_API_BASE } from '@/lib/constants';
import { clearUserInfo } from '@/lib/hooks';
import { ApiError, FAILURE_MESSAGES, statusMessage, toApiError } from './errors';

type QueryValue = string | number | boolean | undefined;

export interface PicponyRequestOptions extends RequestInit {
  token?: string;
  query?: Record<string, QueryValue> & { action?: never };
  /**
   * How long this request may take, headers and body together, in ms — or `false` for no limit.
   * Reads (GET/HEAD) default to `READ_DEADLINE_MS`; writes default to none, because aborting a
   * POST does not stop the server acting on it, and reporting a failure the server then turns
   * into a success is worse than waiting.
   */
  timeoutMs?: number | false;
}

/**
 * A read's ceiling. The only bounds used to be server-side (the api.php handler's 30s), so a
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
  void import('@/components/Toast')
    .then(({ showToast }) => showToast('登录已过期，请重新登录', 'warning'))
    .catch(() => {});
}

/**
 * A 401 on a request that carried the session token.
 *
 * Only `get_user` is taken at its word. Any other action's 401 is confirmed against `get_user`
 * first: an action may one day answer 401 for a wrong *password* while the session itself is
 * fine, and signing somebody out over a typo would be the worse bug. The confirmation is a raw
 * `fetch`, so it cannot recurse into this handler.
 */
/**
 * For a request that does not go through `picponyRequest` — the import proxy's own route, which is
 * a bare `fetch` to `/admin/import-tools/*`, and the upload's staging XHR (`lib/api/upload.ts`). Without it that one surface let a dead session die
 * silently: AGENTS' rule is that a 401 ends a session **once, here, not per screen**.
 */
export function noteUnauthorized(token: string) {
  onUnauthorized('import_tools', token);
}

function onUnauthorized(action: string, token: string) {
  if (typeof window === 'undefined' || !token) return;
  if (action === 'get_user') {
    expireSession(token);
    return;
  }
  if (sessionChecks.has(token)) return;
  /* Bounded like any read (review P1-F9): a confirmation that never settles would keep this
     token's slot taken, and every later 401 for it would be ignored — a half-signed-in UI. */
  const deadline = deadlineSignal(undefined, READ_DEADLINE_MS);
  const check = fetch(`${PICPONY_API_BASE}?action=get_user&_t=${Date.now()}`, {
    headers: { Authorization: `Bearer ${token}` },
    cache: 'no-store',
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
 * PicPony's browser endpoint, with one URL/authorization policy. Cache options and
 * cancellation belong to the caller; this boundary never retries a mutation. Keep the relative
 * URL so captcha cookies use our proxy.
 *
 * Three things every call gets: a transport failure arrives as an `ApiError` (`network` or
 * `timeout`; a caller's own abort stays its `AbortError`), a read is bounded by
 * `READ_DEADLINE_MS`, and a 401 on a request that carried the token ends the session once, with
 * one notice — before this only `get_user` noticed, so an expired token left a half-signed-in
 * UI whose every retry failed.
 */
export async function picponyRequest(
  action: string,
  { token, query, timeoutMs, ...options }: PicponyRequestOptions = {},
): Promise<Response> {
  const params = new URLSearchParams({ action });
  for (const [name, value] of Object.entries(query ?? {})) {
    if (value !== undefined) params.set(name, String(value));
  }
  const headers = new Headers(options.headers);
  if (token !== undefined) headers.set('Authorization', `Bearer ${token}`);
  const method = (options.method ?? 'GET').toUpperCase();
  const limit = timeoutMs ?? (method === 'GET' || method === 'HEAD' ? READ_DEADLINE_MS : false);
  const deadline = limit === false ? null : deadlineSignal(options.signal, limit);

  let response: Response;
  try {
    response = await fetch(`${PICPONY_API_BASE}?${params}`, {
      ...options,
      headers,
      ...(deadline ? { signal: deadline.signal } : {}),
    });
  } catch (error) {
    deadline?.dispose();
    throw toApiError(error, deadline?.timedOut() ?? false);
  }
  if (response.status === 401 && token) onUnauthorized(action, token);
  return response;
}

/** JSON posts opt into their content type; FormData and bodyless posts use picponyRequest. */
export function picponyPostJson(
  action: string,
  body: Record<string, unknown>,
  options: Omit<PicponyRequestOptions, 'method' | 'body'> = {},
): Promise<Response> {
  const headers = new Headers(options.headers);
  headers.set('Content-Type', 'application/json');
  return picponyRequest(action, {
    ...options,
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
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

/** The backend's own sentence: PicPony uses `error` and `message` interchangeably. */
export function envelopeMessage(data: unknown): string | undefined {
  if (!data || typeof data !== 'object') return undefined;
  const { error, message } = data as { error?: unknown; message?: unknown };
  for (const value of [error, message]) {
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return undefined;
}

/**
 * Decode the API's object envelope, for callers that branch on `success` themselves (every
 * mutation). Empty bodies, PHP error pages and non-object JSON become `{ success: false,
 * status, message }` with a Chinese message for the status; a transport/body-read failure
 * still rejects, so a cancelled request cannot be published as a successful read.
 */
/* The legacy untyped endpoints retain Response.json()'s default. Typed adapters
   supply T; this checks the envelope, not each endpoint's payload shape. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function readJson<T = any>(res: Response): Promise<T> {
  const text = await readBody(res);
  const data = parseObject(text);
  if (data) return data as T;
  return {
    success: false,
    status: res.status,
    message: res.ok ? FAILURE_MESSAGES.invalid : statusMessage(res.status),
  } as T;
}

/**
 * Decode a read that must succeed. A non-2xx status, an unreadable body and `success: false`
 * all throw `ApiError` — the typed adapters' decoder, so a failure can never be flattened into
 * an empty list by a caller that forgot to look.
 *
 * `notFoundStatuses` lets an adapter say what "does not exist" looks like for its action — a
 * forum thread answers an unknown id with 404 but a malformed one with 400.
 */
export async function readEnvelope<T extends object>(
  res: Response,
  options: { notFoundStatuses?: readonly number[] } = {},
): Promise<T & { success: true }> {
  const data = parseObject(await readBody(res));
  const serverMessage = envelopeMessage(data);
  if (!res.ok) {
    throw new ApiError('http', {
      status: res.status,
      serverMessage,
      notFound: options.notFoundStatuses?.includes(res.status) || undefined,
    });
  }
  if (!data) throw new ApiError('invalid', { status: res.status });
  if (data.success !== true) throw new ApiError('envelope', { status: res.status, serverMessage });
  return data as T & { success: true };
}

/**
 * Read a JSON object from a non-envelope API (Derpibooru), throwing `invalid` for anything
 * else. The status has already been checked by `proxyFetch`.
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

/** A page count, normalised: at least 1, an integer, whatever the wire sent. */
export function pageCount(value: unknown): number {
  const n = Math.floor(Number(value));
  return Number.isFinite(n) && n > 1 ? n : 1;
}
