'use client';
import { useLayoutEffect, useRef } from 'react';
import Button from '@/components/Button';
import ErrorRetry from '@/components/ErrorRetry';
import type { useCatalogMutation } from './useCatalogMutation';

/**
 * Focus is nowhere a keyboard can act from: on the document, inside a subtree that went inert (a
 * confirm leaving), or on a control that was just disabled — Chrome keeps reporting that control as
 * `activeElement` until its focus fix-up runs later in the frame, so in this commit it still looks
 * placed while it is about to fall onto the document.
 */
function focusIsLost(): boolean {
  const active = document.activeElement;
  return !active || active === document.body || active.matches(':disabled') || Boolean(active.closest('[inert]'));
}

/**
 * A write's outcome: 操作未完成 for a refusal, 操作结果待确认 for one nobody heard the answer to,
 * which holds the press until 我已核对记录.
 *
 * **It is announced, once** (`role="alert"`, inserted with its content): `ErrorRetry` is a status
 * block with no live region, so a held result arrived in silence. **And focus has somewhere to be.**
 * The press a held result blocks is natively `disabled`, which drops a focused button's focus onto
 * the document — so when focus is lost there, it moves to 我已核对记录, the one thing left to do; and
 * when that button goes with the block, it moves to `returnFocus` (the press it released) when the
 * caller names one, else to where focus was when the outcome arrived (`mutation.origin`), if that
 * is still there to take it. A focus the operator has put somewhere else is never taken.
 */
export default function MutationResult({ mutation, returnFocus }: { mutation: ReturnType<typeof useCatalogMutation>; returnFocus?: () => HTMLElement | null }) {
  const acknowledge = useRef<HTMLButtonElement>(null);
  const held = useRef(false);
  useLayoutEffect(() => {
    /* A layout effect: the press's `disabled` flips in this same commit, so this runs after focus
       has fallen and before the frame shows it fallen. */
    if (mutation.uncertain && !held.current && focusIsLost()) acknowledge.current?.focus({ preventScroll: true });
    if (!mutation.uncertain && held.current && focusIsLost()) {
      const target = returnFocus?.() ?? mutation.origin.current;
      if (target?.isConnected && !target.matches(':disabled') && !target.closest('[inert]')) target.focus({ preventScroll: true });
    }
    held.current = mutation.uncertain;
  }, [mutation.uncertain, mutation.origin, returnFocus]);
  if (!mutation.error) return null;
  return <div role="alert">
    <ErrorRetry size="inline" title={mutation.uncertain ? '操作结果待确认' : '操作未完成'} message={mutation.error}
      action={mutation.uncertain ? <Button ref={acknowledge} type="button" variant="text" onClick={mutation.acknowledge}>我已核对记录</Button> : undefined} />
  </div>;
}
