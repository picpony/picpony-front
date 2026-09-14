import { PICPONY_API_BASE } from '@/lib/constants';

type QueryValue = string | number | boolean | undefined;

interface PicponyRequestOptions extends RequestInit {
  token?: string;
  query?: Record<string, QueryValue> & { action?: never };
}

/**
 * PicPony's browser endpoint, with one URL/authorization policy. Cache options and
 * cancellation belong to the caller; this boundary never retries a mutation or
 * reads the session itself. Keep the relative URL so captcha cookies use our proxy.
 */
export function picponyRequest(
  action: string,
  { token, query, ...options }: PicponyRequestOptions = {},
): Promise<Response> {
  const params = new URLSearchParams({ action });
  for (const [name, value] of Object.entries(query ?? {})) {
    if (value !== undefined) params.set(name, String(value));
  }
  const headers = new Headers(options.headers);
  if (token !== undefined) headers.set('Authorization', `Bearer ${token}`);
  return fetch(`${PICPONY_API_BASE}?${params}`, { ...options, headers });
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

/**
 * Decode the API's object envelope. Empty bodies, PHP error pages and non-object
 * JSON become logical failures; a transport/body-read failure still rejects so a
 * cancelled request cannot be published as a successful read.
 */
/* The legacy untyped endpoints retain Response.json()'s default. Typed adapters
   supply T; this checks the envelope, not each endpoint's payload shape. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function readJson<T = any>(res: Response): Promise<T> {
  const text = await res.text();
  if (!text) {
    return { success: false, message: res.statusText || '空响应' } as T;
  }
  try {
    const data: unknown = JSON.parse(text);
    if (data !== null && typeof data === 'object' && !Array.isArray(data)) return data as T;
    return { success: false, message: `响应不是合法 API 数据 (HTTP ${res.status})` } as T;
  } catch {
    return {
      success: false,
      message: `响应不是合法 JSON (HTTP ${res.status})`,
    } as T;
  }
}
