'use client';

import { defineResource, SKIP, useResource, type Resource } from '@/lib/resource';
import { readToken } from '@/lib/hooks';

/** Admin reads use the same cancellation, account isolation and refresh rules as public
 * resources. This factory stays in the lazy admin chunks, never the public catalogue. */
export function defineAdminQuery<T>(name: string, fetcher: (token: string, signal: AbortSignal) => Promise<T>) {
  return defineResource<string, T>({
    name: `admin-${name}`,
    key: (token) => token,
    ttl: 60_000,
    maxEntries: 2,
    fetch: (token, signal) => {
      if (readToken() !== token) throw new Error('登录状态已失效，请重新登录');
      return fetcher(token, signal);
    },
  });
}

/** A failed envelope is never an empty collection. */
export function adminData<T>(envelope: { success?: unknown; error?: unknown; message?: unknown }, value: T): T {
  if (envelope.success !== true) {
    const message = [envelope.error, envelope.message].find((value) => typeof value === 'string' && value);
    throw new Error(typeof message === 'string' ? message : '加载失败，请稍后重试');
  }
  return value;
}

export function useAdminQuery<T>(resource: Resource<string, T>, token: string) {
  const result = useResource(resource, token || SKIP);
  return {
    data: result.data,
    loading: Boolean(token) && result.data === undefined && !result.error,
    error: result.error ? (result.error instanceof Error ? result.error.message : '加载失败') : undefined,
    refresh: result.refresh,
  };
}
