'use client';

import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { focusLanding } from '@/lib/focusLanding';
import { springTiming } from '@/lib/springTiming';

/** A control that takes the focus as itself; anything else is focused as a landing. */
const CONTROL = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * One block that leaves where it stood — the single-block twin of `PresenceList`, for the empty
 * state under a list that has just gained its first row, and for a list that has just lost its
 * last one. It arrives with its own entrance (an `EmptyState` brings `StatusView`'s); while `show`
 * is false it keeps its last content, taken out of the flow at the top of its container (which
 * must be positioned) and faded on FastEffects while what replaces it arrives, then unmounts. It
 * used to vanish in the frame the first row was created, visible through the scrim of the dialog
 * that created it. Under 关闭 the fade has no length: the block is gone in the same frame, out of
 * the flow, and drops out of the tree on the next.
 *
 * **A focus inside it leaves with it**, to `fallbackFocus`, in the commit that starts the exit —
 * the block is inert from that commit, and the browser would otherwise drop the focus on the
 * document a frame later (the cart's last line removed by its own ✕). Asked at that moment, so an
 * element arriving in the same commit can be the answer; a control is focused, anything else is a
 * landing (`focusLanding`). A focus anywhere else is never touched.
 */
export default function PresenceBlock({
  show,
  children,
  fallbackFocus,
}: {
  show: boolean;
  children: ReactNode;
  fallbackFocus?: () => HTMLElement | null;
}) {
  const [held, setHeld] = useState<ReactNode>(show ? children : null);
  const [leaving, setLeaving] = useState(false);
  if (show && (held !== children || leaving)) {
    setHeld(children);
    setLeaving(false);
  } else if (!show && held !== null && !leaving) {
    setLeaving(true);
  }

  const fallback = useRef(fallbackFocus);
  useLayoutEffect(() => {
    fallback.current = fallbackFocus;
  });

  const block = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const node = block.current;
    if (!leaving || !node) return;
    const active = document.activeElement;
    if (active instanceof HTMLElement && node.contains(active)) {
      const target = fallback.current?.();
      if (target) {
        if (target.matches(CONTROL) && target.tabIndex >= 0) target.focus({ preventScroll: true });
        else focusLanding(target);
      }
    }
    const fade = node.animate([{ opacity: 1 }, { opacity: 0 }], { ...springTiming('fastEffects'), fill: 'forwards' });
    fade.finished.then(
      () => {
        setHeld(null);
        setLeaving(false);
      },
      () => { /* Shown again before it had gone: it stays. */ },
    );
    return () => fade.cancel();
  }, [leaving]);

  if (held === null) return null;
  return (
    <div
      ref={block}
      inert={leaving || undefined}
      aria-hidden={leaving || undefined}
      className={leaving ? 'pointer-events-none absolute inset-x-0 top-0' : undefined}
    >
      {held}
    </div>
  );
}
