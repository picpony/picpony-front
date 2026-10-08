/**
 * One error type for every read the app makes, and one place that turns a failure into words.
 *
 * Before this, a failure was whatever the throwing line happened to construct: a bare `Error`
 * with an English sentence (`Failed to fetch forum posts`), `HTTP 429`, a decoder's
 * `响应不是合法 JSON (HTTP 404)`, or a retry ladder's fresh `Error` with no status at all — so no
 * screen could tell "this thread does not exist" from "the network dropped", a rate limit
 * arrived as a developer string, and a 重试 button was offered for answers no retry can change.
 *
 * The rule now: **every adapter in `lib/api/` throws `ApiError`** (a caller's own cancellation
 * excepted — that stays the caller's `AbortError`, because an abort is not a failure of
 * anything). Its `message` is already the one Chinese sentence a screen may print under its
 * `{X}加载失败` title; the technical detail travels in `cause`, never in the message. Screens
 * decide two things from it and nothing else: whether to offer 重试 (`isRetryable`) and whether
 * to show a not-found state instead of an error (`isNotFound`).
 *
 * No imports and no `'use client'`: the server reads, the route handlers and the tests all reach
 * this module.
 */

/**
 * What went wrong, by where it went wrong — not by status code, which only one kind has.
 *
 * - `network`: no answer at all (offline, DNS, refused, a CORS rejection, a dropped socket).
 * - `timeout`: our own deadline fired first (see `lib/api/http.ts`).
 * - `http`: an answer with a non-2xx status.
 * - `envelope`: a 2xx whose PicPony envelope said `success: false`.
 * - `invalid`: a 2xx whose body is not the shape the adapter needs (an HTML error page served
 *   as 200, a list field that is not a list).
 * - `syntax`: the upstream rejected the *query itself* — Derpibooru's 400 on a search. Retrying
 *   the same text cannot succeed, so a screen shows the message and no 重试.
 * - `aborted`: the caller cancelled. Adapters rethrow the caller's own `AbortError` rather than
 *   constructing one of these; the kind exists so `isAborted` has one answer for both.
 */
export type ApiErrorKind = 'network' | 'timeout' | 'http' | 'envelope' | 'invalid' | 'syntax' | 'aborted';

export interface ApiErrorInit {
  status?: number;
  /** The backend's own words, when it sent any. PicPony's are Chinese already. */
  serverMessage?: string;
  /** Overrides the derived sentence — for an adapter that knows better (a named list). */
  message?: string;
  /** Overrides the default: a 404 is not found; an adapter may say a 400 means the same. */
  notFound?: boolean;
  /** Overrides the default derived from kind and status. */
  retryable?: boolean;
  cause?: unknown;
}

export class ApiError extends Error {
  override readonly name = 'ApiError';
  readonly kind: ApiErrorKind;
  readonly status?: number;
  readonly serverMessage?: string;
  /** The thing asked for does not exist — a screen shows a not-found state, never 重试. */
  readonly notFound: boolean;
  /** Whether pressing 重试 could plausibly produce a different answer. */
  readonly retryable: boolean;

  constructor(kind: ApiErrorKind, init: ApiErrorInit = {}) {
    const status = init.status;
    const serverMessage = usableServerMessage(init.serverMessage);
    const notFound = init.notFound ?? (kind === 'http' && status === 404);
    super(init.message ?? describeFailure(kind, status, serverMessage, notFound), { cause: init.cause });
    this.kind = kind;
    this.status = status;
    this.serverMessage = serverMessage;
    this.notFound = notFound;
    this.retryable = init.retryable ?? defaultRetryable(kind, status, notFound);
  }
}

/** A server sentence is shown only if it is one: a non-empty string with no markup in it. */
function usableServerMessage(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const text = value.trim();
  if (!text || text.length > 200 || /[<>]/.test(text)) return undefined;
  return text;
}

function defaultRetryable(kind: ApiErrorKind, status: number | undefined, notFound: boolean): boolean {
  if (notFound || kind === 'syntax' || kind === 'aborted') return false;
  /* A refusal about *this* request or *this* credential answers the same every time: a bad
     request, a dead session (the shell signs out on it) and a permission refusal. */
  if (kind === 'http' && (status === 400 || status === 401 || status === 403)) return false;
  return true;
}

/**
 * The one table of failure sentences. One wording per condition — the app once said "network
 * error" six different ways across 24 sites. Status words stand in for a server sentence only
 * where the status is the more useful fact (a rate limit, an outage); for a refusal the
 * backend's own words say more than any status can.
 */
export const FAILURE_MESSAGES = {
  network: '网络连接失败，请检查网络后再试',
  timeout: '请求超时，请稍后再试',
  rateLimited: '请求过于频繁，请稍后再试',
  unavailable: '服务暂时不可用，请稍后再试',
  notFound: '内容不存在或已被删除',
  unauthorized: '登录已过期，请重新登录',
  forbidden: '没有权限查看此内容',
  badRequest: '请求无效',
  syntax: '搜索语法有误，请检查括号和运算符',
  invalid: '服务器返回了无法识别的数据',
  generic: '请求失败，请稍后再试',
  aborted: '请求已取消',
} as const;

/** Words for an HTTP status alone — also what `readJson` synthesises for a body it cannot read. */
export function statusMessage(status: number | undefined): string {
  if (status === undefined) return FAILURE_MESSAGES.generic;
  if (status === 429) return FAILURE_MESSAGES.rateLimited;
  if (status === 404) return FAILURE_MESSAGES.notFound;
  if (status === 401) return FAILURE_MESSAGES.unauthorized;
  if (status === 403) return FAILURE_MESSAGES.forbidden;
  if (status === 400) return FAILURE_MESSAGES.badRequest;
  if (status === 408) return FAILURE_MESSAGES.timeout;
  if (status >= 500) return FAILURE_MESSAGES.unavailable;
  return FAILURE_MESSAGES.generic;
}

function describeFailure(
  kind: ApiErrorKind,
  status: number | undefined,
  serverMessage: string | undefined,
  notFound: boolean,
): string {
  switch (kind) {
    case 'network': return FAILURE_MESSAGES.network;
    case 'timeout': return FAILURE_MESSAGES.timeout;
    case 'syntax': return FAILURE_MESSAGES.syntax;
    case 'aborted': return FAILURE_MESSAGES.aborted;
    case 'invalid': return FAILURE_MESSAGES.invalid;
    case 'envelope': return serverMessage ?? (notFound ? FAILURE_MESSAGES.notFound : FAILURE_MESSAGES.generic);
    case 'http':
      if (notFound) return FAILURE_MESSAGES.notFound;
      /* A rate limit and an outage are facts about the service, whatever the body says; a
         refusal (400/403) is best described by the backend's own sentence. */
      if (status === 429 || (status !== undefined && status >= 500)) return statusMessage(status);
      return serverMessage ?? statusMessage(status);
  }
}

// ---------------------------------------------------------------------------
// Reading any thrown value
// ---------------------------------------------------------------------------

export function isApiError(error: unknown): error is ApiError {
  return error instanceof ApiError;
}

/** A cancellation, whichever shape it arrived in. Never shown, never retried, never logged. */
export function isAborted(error: unknown): boolean {
  if (error instanceof ApiError) return error.kind === 'aborted';
  return error instanceof Error && error.name === 'AbortError';
}

/** The HTTP status behind a failure, including the legacy `{ status }` shape. */
export function apiErrorStatus(error: unknown): number | undefined {
  if (error instanceof ApiError) return error.status;
  const status = (error as { status?: unknown } | null)?.status;
  return typeof status === 'number' ? status : undefined;
}

export function isNotFound(error: unknown): boolean {
  if (error instanceof ApiError) return error.notFound;
  return apiErrorStatus(error) === 404;
}

/** False for answers a retry cannot change — the screen then offers no 重试. */
export function isRetryable(error: unknown): boolean {
  if (error instanceof ApiError) return error.retryable;
  return !isAborted(error) && !isNotFound(error);
}

const HAN = /[㐀-鿿]/;

/**
 * The sentence a screen prints for any thrown value — the one status→message helper.
 *
 * An `ApiError` already carries it. Anything else is legacy: a Chinese `Error` message is kept
 * (it was written for a screen), while an engine error (`TypeError: Failed to fetch`, a
 * `SyntaxError` from a JSON parse) never reaches the UI — those become the network sentence
 * or `fallback`.
 */
export function apiErrorMessage(error: unknown, fallback: string = FAILURE_MESSAGES.generic): string {
  if (error instanceof ApiError) return error.message;
  if (isAborted(error)) return FAILURE_MESSAGES.aborted;
  if (error instanceof TypeError) return FAILURE_MESSAGES.network;
  if (error instanceof Error && HAN.test(error.message)) return error.message;
  if (typeof error === 'string' && HAN.test(error)) return error;
  const status = apiErrorStatus(error);
  return status !== undefined ? statusMessage(status) : fallback;
}

/**
 * Normalise anything a transport threw into an `ApiError`, keeping a cancellation as it is.
 *
 * `timedOut` is the transport's own knowledge that *its* deadline fired — the abort reason
 * alone cannot say whose it was.
 */
export function toApiError(error: unknown, timedOut = false): unknown {
  if (error instanceof ApiError) return error;
  if (timedOut) return new ApiError('timeout', { cause: error });
  if (isAborted(error)) return error;
  if (error instanceof Error && error.name === 'TimeoutError') return new ApiError('timeout', { cause: error });
  return new ApiError('network', { cause: error });
}
