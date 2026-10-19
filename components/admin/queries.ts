'use client';

import { defineResource, SKIP, useResource, type Resource } from '@/lib/resource';
import { readToken } from '@/lib/hooks';
import { apiErrorMessage, isRetryable } from '@/lib/api/errors';

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

/**
 * A panel's read. `loading` is the first load only (nothing to show yet — the list's skeleton);
 * `refreshing` is a re-read under rows already on screen (the header's refresh spinner). `error` is
 * the sentence to print; `retryable` says whether 重试 is worth offering (a refusal is not).
 */
export function useAdminQuery<T>(resource: Resource<string, T>, token: string) {
  const result = useResource(resource, token || SKIP);
  return {
    data: result.data,
    loading: Boolean(token) && result.data === undefined && !result.error,
    refreshing: result.isLoading && result.data !== undefined,
    error: result.error ? apiErrorMessage(result.error) : undefined,
    retryable: result.error ? isRetryable(result.error) : false,
    refresh: result.refresh,
  };
}

/**
 * A pure view of a read, computed once per answer. `derived(fn)` remembers what `fn` returned — or
 * threw — for each source object, so a view keeps its identity for exactly as long as the answer it
 * was computed from (G2-019: several panels read one response and each shapes its own rows).
 *
 * The identity is load-bearing, not an optimisation: `ConfigEditor` tells a just-saved draft from a
 * newer answer by comparing `initial` **by reference**, so a view rebuilt on every render would throw
 * the saved draft away in the next render and show the pre-save values until the re-read landed.
 */
export function derived<S extends object, T>(fn: (source: S) => T): (source: S) => T {
  const memo = new WeakMap<S, { value: T } | { error: unknown }>();
  return (source) => {
    let hit = memo.get(source);
    if (!hit) {
      try {
        hit = { value: fn(source) };
      } catch (error) {
        hit = { error };
      }
      memo.set(source, hit);
    }
    if ('error' in hit) throw hit.error;
    return hit.value;
  };
}

function attempt<S, T>(select: (source: S) => T, source: S): { ok: true; value: T } | { ok: false; error: unknown } {
  try {
    return { ok: true, value: select(source) };
  } catch (error) {
    return { ok: false, error };
  }
}

/**
 * `useAdminQuery` over a view of a shared read: one request, one cache entry, one invalidation —
 * and each panel's own shape of it. Pass a view whose result is stable per answer (`derived`, or a
 * plain property of it); a view that throws (a malformed field only this panel reads) fails this
 * panel alone, exactly as that panel's own read used to.
 */
export function useAdminSelect<S extends object, T>(resource: Resource<string, S>, token: string, select: (source: S) => T) {
  const result = useResource(resource, token || SKIP);
  const view = result.data === undefined ? undefined : attempt(select, result.data);
  const data = view?.ok ? view.value : undefined;
  const failure = result.error ?? (view && !view.ok ? view.error : undefined);
  return {
    data,
    loading: Boolean(token) && data === undefined && !failure,
    refreshing: result.isLoading && data !== undefined,
    error: failure ? apiErrorMessage(failure) : undefined,
    retryable: failure ? isRetryable(failure) : false,
    refresh: result.refresh,
  };
}

/**
 * `ErrorRetry`'s failure props for a read that is not a table (a form's value, a status card): the
 * `{X}加载失败` title and, under it, the error's own sentence — left out when it would only repeat
 * the title. One rule with `tableError`, so a panel spells it once rather than as an inline ternary
 * per literal (G4-011: four copies, two places to change per noun, which is how one panel came to
 * print two nouns).
 */
export function retryError(title: string, message: string | undefined): { title: string; message?: string } {
  return { title, message: message && message !== title ? message : undefined };
}

/**
 * `DataTable`'s failure props: the `{X}加载失败` title and, under it, the error's own sentence — left
 * out when it would only repeat the title (a malformed list already says `{X}加载失败`).
 */
export function tableError(title: string, message: string | undefined): { error?: string; errorDetail?: string } {
  if (!message) return {};
  const { message: detail } = retryError(title, message);
  return { error: title, errorDetail: detail };
}
