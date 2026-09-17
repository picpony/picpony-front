'use client';

import { useEffect, useLayoutEffect, useRef, type ReactNode } from 'react';
import { flushSync } from 'react-dom';
import { Flip, gsap, spring, useGSAP } from '@/lib/motion';
import { useMotionTier } from '@/lib/appearance';

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

  Flip.killFlipsOf(targets, false);
  // getState also completes old flips by default; capture an interrupted
  // close exactly where it is instead of resetting the following rows.
  // The runtime supports `kill`, but the bundled FlipStateVars omits it.
  const captureOptions: Flip.FlipStateVars & { kill: false } = { simple: true, kill: false };
  return Flip.getState(targets, captureOptions);
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
  const initializedRef = useRef(false);
  const layoutTargetsRef = useRef<HTMLElement[]>([]);
  const layoutStylesRef = useRef(new Map<HTMLElement, {
    transform: string;
    transition: string;
    willChange: string;
  }>());
  const tier = useMotionTier();

  useEffect(() => {
    onExitCompleteRef.current = onExitComplete;
  }, [onExitComplete]);

  /* Keep one context for unmount cleanup. A direction change only kills its
     tweens: reverting that context first restores the fully open panel and
     rows, so a half-open editor flashes before its close can start. */
  const { contextSafe } = useGSAP(
    () => () => {
      // Interrupted tweens remember intermediate start values. Restore the
      // rows' original inline styles after the context has reverted them all.
      for (const [target, style] of layoutStylesRef.current) Object.assign(target.style, style);
      layoutStylesRef.current.clear();
      initializedRef.current = false;
      layoutTargetsRef.current = [];
    },
    { scope: panelRef },
  );

  useLayoutEffect(
    () => contextSafe(() => {
      const panel = panelRef.current;
      if (!panel) return;

      const pendingState = pendingLayoutState;
      pendingLayoutState = null;
      const initial = !initializedRef.current;
      initializedRef.current = true;
      const content = Array.from(panel.children);
      const layoutTargets = Array.from(new Set([
        ...layoutTargetsRef.current,
        ...getFollowingLayoutTargets(panel),
        ...(pendingState?.targets ?? []).filter((target): target is HTMLElement =>
          target instanceof HTMLElement,
        ),
      ])).filter((target) => target !== panel && target.isConnected);
      layoutTargetsRef.current = layoutTargets;
      for (const target of layoutTargets) {
        if (!layoutStylesRef.current.has(target)) layoutStylesRef.current.set(target, {
          transform: target.style.transform,
          transition: target.style.transition,
          willChange: target.style.willChange,
        });
      }

      const clearLayoutProps = () => {
        gsap.set(layoutTargets, { clearProps: 'transform,willChange' });
        layoutTargets[0]?.getBoundingClientRect();
        gsap.set(layoutTargets, { clearProps: 'transition' });
      };
      const clearSpatialProps = () => {
        gsap.set(panel, { clearProps: 'clipPath,willChange' });
        gsap.set(content, { clearProps: 'opacity,visibility,transform,willChange' });
        clearLayoutProps();
      };

      /* Reduced cross-fades the panel and leaves its box alone: the clip-path
         expand and the `Flip` reflow are a container changing size, which is
         what the tier removes. Off keeps appearing outright. */
      if (tier !== 'standard') clearSpatialProps();
      if (tier === 'reduced') {
        if (initial && !isClosing) gsap.set(panel, { autoAlpha: 0 });
        const fade = isClosing
          ? gsap.to(panel, {
              autoAlpha: 0,
              ...spring('fastEffects'),
              onComplete: () => onExitCompleteRef.current(),
            })
          : gsap.to(panel, {
              autoAlpha: 1,
              ...spring('fastEffects'),
              clearProps: 'opacity,visibility',
            });
        return () => fade.kill();
      }
      if (tier === 'off') {
        gsap.set(panel, { clearProps: 'opacity,visibility' });
        let cancelled = false;
        if (isClosing) queueMicrotask(() => {
          if (!cancelled) onExitCompleteRef.current();
        });
        return () => { cancelled = true; };
      }

      const clearMotionProps = () => {
        clearSpatialProps();
        gsap.set(panel, { clearProps: 'opacity,visibility' });
      };

      gsap.set(panel, { clearProps: 'opacity,visibility' });
      gsap.set(panel, { willChange: 'clip-path' });
      gsap.set(content, { willChange: 'opacity,transform' });
      if (initial && !isClosing) {
        gsap.set(panel, { clipPath: 'inset(0 0 100% 0)' });
        gsap.set(content, { autoAlpha: 0, y: -8 });
      }

      if (layoutTargets.length > 0) {
        Flip.killFlipsOf(layoutTargets, false);
        // Prevent CSS's transform transition from trailing the same GSAP move.
        gsap.set(layoutTargets, { transition: 'none', willChange: 'transform' });
      }

      const layoutAnimation =
        initial && !isClosing && pendingState
          ? Flip.from(pendingState, {
              ...spring('defaultSpatial'),
              simple: true,
              prune: true,
            })
          : null;

      const closingDistance =
        panel.getBoundingClientRect().height + (parseFloat(getComputedStyle(panel).marginTop) || 0);

      const finishClose = () => {
        // Clear the temporary translate while CSS transitions are still
        // suppressed, then remove the panel in the same frame. The layout
        // shift replaces the translate exactly, so the rows stay at the
        // coordinates where the tween ended.
        clearLayoutProps();
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
            { autoAlpha: 0, y: -8, ...spring('fastEffects') },
            0,
          )
          .to(
            panel,
            { clipPath: 'inset(0 0 100% 0)', ...spring('fastEffects') },
            0,
          );

        if (layoutTargets.length > 0) {
          /* The rows below close on the panel's own clock and curve — one
             gesture, one clock, or the gap outlives the panel. */
          animation.to(layoutTargets, { y: -closingDistance, ...spring('fastEffects') }, 0);
        }
      } else {
        animation = gsap
          .timeline({ onComplete: clearMotionProps })
          .to(
            panel,
            { clipPath: 'inset(0 0 0% 0)', ...spring('defaultSpatial') },
            0,
          )
          /* Content arrives on the panel's clock too, offset rather than shortened:
             it was 300ms inside the panel's 400ms, which is a second clock for the
             same arrival. The 40ms offset is what makes the content read as arriving
             *behind* the opening panel. A reversal resumes immediately from the
             visible pose rather than putting that initial delay in its way. */
          .to(
            content,
            { autoAlpha: 1, y: 0, ...spring('defaultSpatial') },
            initial ? 0.04 : 0,
          );

        if (!initial && layoutTargets.length > 0) {
          animation.to(layoutTargets, { y: 0, ...spring('defaultSpatial') }, 0);
        }
      }

      return () => {
        animation.kill();
        layoutAnimation?.kill();
      };
    })(),
    [contextSafe, isClosing, tier],
  );

  return (
    <section
      ref={panelRef}
      id={id}
      /* `inert` for the ~200ms the close animation holds it on screen. `autoAlpha`
         sets `visibility: hidden` only at the end of the tween, so until then a
         panel that is clipped away — and full of `Input`s and `Button`s — was still
         focusable. Every other overlay in the app already covers this window; this
         was the one that did not. */
      inert={isClosing}
      className="m3-row overflow-hidden bg-surface-container px-4 py-5"
      aria-label={label}
    >
      {children}
    </section>
  );
}
