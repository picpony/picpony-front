'use client';

import { useEffect, useRef, type ReactNode } from 'react';
import { flushSync } from 'react-dom';
import { DURATION, Flip, gsap, prefersReducedMotion, useGSAP } from '@/lib/motion';

interface InlineEditorPanelProps {
  id: string;
  label: string;
  isClosing: boolean;
  onExitComplete: () => void;
  children: ReactNode;
}

let pendingLayoutState: Flip.FlipState | null = null;

function getFollowingLayoutTargets(anchor: Element): HTMLElement[] {
  const table = anchor.parentElement;
  if (!table) return [];

  const siblings = Array.from(table.children);
  const anchorIndex = siblings.indexOf(anchor);
  if (anchorIndex < 0) return [];

  const rows = siblings
    .slice(anchorIndex + 1)
    .filter(
      (element): element is HTMLElement =>
        element instanceof HTMLElement && element.classList.contains('m3-row'),
    );
  const tableParent = table.parentElement;
  const tableSiblings = tableParent ? Array.from(tableParent.children) : [];
  const tableIndex = tableSiblings.indexOf(table);
  const sections = tableSiblings
    .slice(tableIndex + 1)
    .filter((element): element is HTMLElement => element instanceof HTMLElement);

  const viewportBottom =
    window.innerHeight + (anchor instanceof HTMLElement ? anchor.offsetHeight : 0);
  return [...rows, ...sections].filter((element) => {
    const rect = element.getBoundingClientRect();
    return rect.bottom >= 0 && rect.top <= viewportBottom;
  });
}

function getFollowingLayoutState(anchor: Element): Flip.FlipState | null {
  const targets = getFollowingLayoutTargets(anchor);
  if (targets.length === 0) return null;

  Flip.killFlipsOf(targets, true);
  return Flip.getState(targets, { simple: true });
}

/** Capture table rows before React inserts an inline editor above them. */
export function captureInlineEditorLayout(trigger: Element) {
  const row = trigger.closest('.m3-row');
  pendingLayoutState = row ? getFollowingLayoutState(row) : null;
}

/** Shared expanding row used by admin tables for in-place editing. */
export default function InlineEditorPanel({
  id,
  label,
  isClosing,
  onExitComplete,
  children,
}: InlineEditorPanelProps) {
  const panelRef = useRef<HTMLElement>(null);
  const onExitCompleteRef = useRef(onExitComplete);

  useEffect(() => {
    onExitCompleteRef.current = onExitComplete;
  }, [onExitComplete]);

  useGSAP(
    () => {
      const panel = panelRef.current;
      if (!panel) return;

      const pendingState = pendingLayoutState;
      pendingLayoutState = null;

      if (prefersReducedMotion()) {
        if (isClosing) queueMicrotask(() => onExitCompleteRef.current());
        return;
      }

      const content = Array.from(panel.children);
      const clearMotionProps = () => {
        gsap.set(panel, { clearProps: 'clipPath,willChange' });
        gsap.set(content, { clearProps: 'opacity,visibility,transform,willChange' });
      };

      gsap.set(panel, { willChange: 'clip-path' });
      gsap.set(content, { willChange: 'opacity,transform' });

      const layoutAnimation =
        !isClosing && pendingState
          ? Flip.from(pendingState, {
              duration: DURATION.long,
              ease: 'decelerate',
              simple: true,
              prune: true,
            })
          : null;

      const closingTargets = isClosing ? getFollowingLayoutTargets(panel) : [];
      if (closingTargets.length > 0) {
        Flip.killFlipsOf(closingTargets, true);
        // DataTable rows use `transition-ui`, which includes transform. Letting
        // that CSS transition trail GSAP produces a second movement when the
        // temporary translate is removed at the end of the close animation.
        gsap.set(closingTargets, { transition: 'none', willChange: 'transform' });
      }
      const closingDistance =
        panel.getBoundingClientRect().height + (parseFloat(getComputedStyle(panel).marginTop) || 0);

      const finishClose = () => {
        // Clear the temporary translate while CSS transitions are still
        // suppressed, then remove the panel in the same frame. The layout
        // shift replaces the translate exactly, so the rows stay at the
        // coordinates where the tween ended.
        gsap.set(closingTargets, { clearProps: 'transform,willChange' });
        closingTargets[0]?.getBoundingClientRect();
        flushSync(() => {
          onExitCompleteRef.current();
        });
      };

      let animation: gsap.core.Timeline;
      if (isClosing) {
        animation = gsap
          .timeline({ onComplete: finishClose })
          .to(
            content,
            {
              autoAlpha: 0,
              y: -8,
              duration: DURATION.short,
              ease: 'accelerate',
            },
            0,
          )
          .to(
            panel,
            {
              clipPath: 'inset(0 0 100% 0)',
              duration: DURATION.short,
              ease: 'accelerate',
            },
            0,
          );

        if (closingTargets.length > 0) {
          animation.to(
            closingTargets,
            {
              y: -closingDistance,
              duration: DURATION.medium,
              ease: 'standard',
            },
            0,
          );
        }
      } else {
        animation = gsap
          .timeline({ onComplete: clearMotionProps })
          .fromTo(
            panel,
            { clipPath: 'inset(0 0 100% 0)' },
            {
              clipPath: 'inset(0 0 0% 0)',
              duration: DURATION.long,
              ease: 'decelerate',
            },
            0,
          )
          .fromTo(
            content,
            { autoAlpha: 0, y: -8 },
            {
              autoAlpha: 1,
              y: 0,
              duration: DURATION.medium,
              ease: 'decelerate',
            },
            0.04,
          );
      }

      return () => {
        animation.kill();
        layoutAnimation?.kill();
      };
    },
    { scope: panelRef, dependencies: [isClosing], revertOnUpdate: true },
  );

  return (
    <section
      ref={panelRef}
      id={id}
      className="m3-row overflow-hidden bg-surface-container px-4 py-5"
      aria-label={label}
    >
      {children}
    </section>
  );
}
