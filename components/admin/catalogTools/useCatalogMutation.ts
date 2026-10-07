'use client';

import { useEffect, useRef, useState } from 'react';
import { readToken } from '@/lib/hooks';
import { apiErrorMessage } from '@/lib/api/errors';
import { CatalogOutcomeUnknown } from '@/lib/api/adminCatalogTools';

/** The element holding focus, if any: the document's own body is nowhere. */
function focusedElement(): HTMLElement | null {
  if (typeof document === 'undefined') return null;
  const active = document.activeElement as HTMLElement | null;
  return active && active !== document.body ? active : null;
}

/**
 * The request and its outcome, outside the hook: the React Compiler cannot lower a `try` that holds
 * a conditional or a `finally`, and the whole hook went uncompiled for one. A callback that throws
 * is a failure of the write, as it was when both lived in the hook's own `try`.
 */
async function attempt<T>(request: () => Promise<T>, done: (result: T) => void, failed: (failure: unknown) => void) {
  try {
    done(await request());
  } catch (failure) {
    failed(failure);
  }
}

/**
 * Catalogue writes retain an uncertain outcome in the form instead of offering a blind retry.
 * `origin` is where focus was when the outcome turned out unknown — the press, or where a confirm
 * gave it back — read before the commit that disables the press, so `MutationResult` can return it
 * there once the operator has acknowledged the result.
 */
export function useCatalogMutation(token: string) {
  const origin = useRef<HTMLElement | null>(null);
  const lifetime = useRef(0);
  const active = useRef(true);
  const lock = useRef(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [uncertain, setUncertain] = useState(false);
  useEffect(() => { active.current = true; const version = lifetime.current; return () => { active.current = false; lifetime.current = version + 1; lock.current = false; }; }, [token]);
  async function run<T>(request: () => Promise<T>, success: (data: T) => void, committed?: (data: T) => void) {
    if (lock.current || uncertain || !token || readToken() !== token) return;
    lock.current = true; setBusy(true); setError('');
    const version = lifetime.current;
    const current = () => active.current && lifetime.current === version && readToken() === token;
    await attempt(request, (result) => {
      if (readToken() === token) committed?.(result);
      if (current()) success(result);
    }, (failure) => {
      if (!current()) return;
      const unknown = failure instanceof CatalogOutcomeUnknown;
      if (unknown) origin.current = focusedElement();
      setError(apiErrorMessage(failure)); setUncertain(unknown);
    });
    if (current()) { lock.current = false; setBusy(false); }
  }
  return { busy, error, uncertain, origin, run, report: setError, acknowledge: () => { setUncertain(false); setError(''); } };
}
