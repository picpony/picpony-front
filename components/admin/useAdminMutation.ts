'use client';

import { useEffect, useRef, useState } from 'react';
import { readToken } from '@/lib/hooks';
import type { AdminRow } from '@/lib/adminMutations';
import { apiErrorMessage } from '@/lib/api/errors';
import { showToast } from '@/components/Toast';

type MutationKey = string | number;
const EMPTY_PENDING: ReadonlySet<MutationKey> = new Set();

interface MutationOptions<T> {
  /** Independent records can run together while repeated presses on one record cannot. */
  key?: MutationKey;
  /** Cache maintenance outlives the view, but never the account that made the request. */
  onCommitted?: (data: T) => void;
}

/** A write has an account lifetime; its form and toast have a view lifetime.
 * A request already accepted by the backend is never silently retried. */
export function useAdminMutation(token: string) {
  const generation = useRef(0);
  const active = useRef(true);
  const locked = useRef(new Set<MutationKey>());
  const [pending, setPending] = useState({ token, keys: new Set<MutationKey>() });

  // Account changes discard the old operation's UI state, including A → B → A.
  if (pending.token !== token) setPending({ token, keys: new Set() });

  useEffect(() => {
    active.current = true;
    locked.current.clear();
    return () => {
      active.current = false;
      generation.current += 1;
    };
  }, [token]);

  async function run<T extends object = AdminRow>(
    /* An adapter's answer (the `/api/v1` adapters resolve with the backend's DTO, or nothing for a
       204, and throw on a refusal), or `null` for a request the caller decided not to send. */
    request: (isCurrent: () => boolean) => Promise<T | null | void>,
    onSuccess: (data: T) => void,
    failure = '操作失败',
    { key = 'default', onCommitted }: MutationOptions<T> = {},
  ) {
    if (!token || locked.current.has(key) || !active.current || readToken() !== token) return;
    locked.current.add(key);
    setPending({ token, keys: new Set(locked.current) });
    const started = generation.current;
    const isCurrent = () => active.current && generation.current === started && readToken() === token;
    try {
      const answer = await request(isCurrent);
      if (answer === null || readToken() !== token) return;
      /* A 204 (or an adapter that answers nothing) is a write that happened. */
      const data = (answer ?? {}) as T;
      onCommitted?.(data);
      if (!isCurrent()) return;
      onSuccess(data);
    } catch (error) {
      /* The backend's own sentence when it gave one, a transport failure's Chinese sentence
         otherwise — never an engine's English (`apiErrorMessage`). */
      if (isCurrent()) showToast(apiErrorMessage(error, failure), 'error');
    } finally {
      if (generation.current === started) locked.current.delete(key);
      if (isCurrent()) setPending({ token, keys: new Set(locked.current) });
    }
  }

  const pendingKeys: ReadonlySet<MutationKey> = pending.token === token ? pending.keys : EMPTY_PENDING;
  return {
    busy: pendingKeys.size > 0,
    pendingKeys,
    // Event handlers must see a press accepted before React renders `busy`.
    isPending: (key: MutationKey = 'default') => locked.current.has(key),
    run,
  };
}
