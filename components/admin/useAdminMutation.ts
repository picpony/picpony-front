'use client';

import { useEffect, useRef, useState } from 'react';
import { readToken } from '@/lib/hooks';
import { requireAdminSuccess } from '@/lib/adminMutations';
import { showToast } from '@/components/Toast';

type MutationKey = string | number;
const EMPTY_PENDING: ReadonlySet<MutationKey> = new Set();

interface MutationOptions {
  /** Independent records can run together while repeated presses on one record cannot. */
  key?: MutationKey;
  /** Cache maintenance outlives the view, but never the account that made the request. */
  onCommitted?: (data: Record<string, unknown>) => void;
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

  async function run(
    request: (isCurrent: () => boolean) => Promise<Response | null>,
    onSuccess: (data: Record<string, unknown>) => void,
    failure = '操作失败',
    { key = 'default', onCommitted }: MutationOptions = {},
  ) {
    if (!token || locked.current.has(key) || !active.current || readToken() !== token) return;
    locked.current.add(key);
    setPending({ token, keys: new Set(locked.current) });
    const started = generation.current;
    const isCurrent = () => active.current && generation.current === started && readToken() === token;
    try {
      const response = await request(isCurrent);
      if (!response || readToken() !== token) return;
      const data = await requireAdminSuccess(response, failure);
      if (readToken() !== token) return;
      onCommitted?.(data);
      if (!isCurrent()) return;
      onSuccess(data);
    } catch (error) {
      if (isCurrent()) showToast(error instanceof Error ? error.message : failure, 'error');
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
