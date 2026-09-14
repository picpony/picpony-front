'use client';

import { useEffect, useRef, useState } from 'react';
import { readToken } from '@/lib/hooks';
import { readJson } from '@/lib/api/client';
import { showToast } from '@/components/Toast';

type MutationResult = { success?: boolean; error?: string; message?: string; [key: string]: unknown };

/** Synchronous exclusion for repeated presses, plus an account/unmount guard for every
 * continuation. A request already accepted by the backend is never silently retried. */
export function useAdminMutation(token: string) {
  const generation = useRef(0);
  const active = useRef(true);
  const locked = useRef(false);
  const [pendingToken, setPendingToken] = useState<string | null>(null);

  useEffect(() => {
    active.current = true;
    locked.current = false;
    return () => {
      active.current = false;
      generation.current += 1;
    };
  }, [token]);

  async function run(
    request: (isCurrent: () => boolean) => Promise<Response | null>,
    onSuccess: (data: MutationResult) => void,
    failure = '操作失败',
  ) {
    if (locked.current || !active.current || readToken() !== token) return;
    locked.current = true;
    setPendingToken(token);
    const started = generation.current;
    const isCurrent = () => active.current && generation.current === started && readToken() === token;
    try {
      const response = await request(isCurrent);
      if (!isCurrent() || !response) return;
      const data = await readJson<MutationResult>(response);
      if (!isCurrent()) return;
      if (!response.ok || data.success !== true) throw new Error(data.error || data.message || failure);
      onSuccess(data);
    } catch (error) {
      if (isCurrent()) showToast(error instanceof Error ? error.message : failure, 'error');
    } finally {
      if (generation.current === started) locked.current = false;
      if (isCurrent()) setPendingToken(null);
    }
  }

  return { busy: pendingToken === token, run };
}
