'use client';

import { useRef, type RefObject } from 'react';
import gsap from 'gsap';
import { useGSAP } from '@gsap/react';
import { CustomEase } from 'gsap/CustomEase';

gsap.registerPlugin(useGSAP, CustomEase);

/**
 * Motion tokens for GSAP-driven animation. The same curves live in
 * globals.css (`--ease-*` in @theme) for CSS transitions/keyframes — keep the
 * two in sync so scripted and declarative motion feel identical.
 * CustomEase registers by name, so `ease: 'decelerate'` works in any tween.
 */
export const eases = {
  standard: CustomEase.create('standard', '0.2, 0, 0, 1'),
  decelerate: CustomEase.create('decelerate', '0.05, 0.7, 0.1, 1'),
  accelerate: CustomEase.create('accelerate', '0.3, 0, 0.8, 0.15'),
  spring: 'back.out(1.55)',
} as const;

gsap.defaults({ ease: eases.standard, duration: 0.4, overwrite: 'auto' });

export const prefersReducedMotion = () =>
  typeof window !== 'undefined' &&
  window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/**
 * Sliding active-indicator for tab groups. The indicator element (absolutely
 * positioned inside the container) glides to whichever child carries
 * `data-tab={active}`; the first placement is instant so nothing flies in
 * from x=0 on mount. Pass `extraDeps` when the tab list mounts late (e.g.
 * after data loads) so the initial measurement re-runs.
 */
export function useSlidingIndicator<
  C extends HTMLElement = HTMLDivElement,
  I extends HTMLElement = HTMLSpanElement,
>(
  active: string,
  extraDeps: unknown[] = [],
): { containerRef: RefObject<C | null>; indicatorRef: RefObject<I | null> } {
  const containerRef = useRef<C>(null);
  const indicatorRef = useRef<I>(null);
  const placed = useRef(false);

  useGSAP(() => {
    const indicator = indicatorRef.current;
    const target = containerRef.current?.querySelector<HTMLElement>(
      `[data-tab="${active}"]`,
    );
    if (!indicator || !target) return;
    const place = { x: target.offsetLeft, width: target.offsetWidth };
    if (!placed.current || prefersReducedMotion()) {
      placed.current = true;
      gsap.set(indicator, place);
      return;
    }
    gsap.to(indicator, { ...place, duration: 0.4, ease: 'spring' });
  }, { scope: containerRef, dependencies: [active, ...extraDeps] });

  return { containerRef, indicatorRef };
}

type ViewTransitionDocument = Document & {
  startViewTransition?: (update: () => void) => {
    ready: Promise<void>;
    finished: Promise<void>;
  };
};

/**
 * Circular reveal for theme changes: snapshots the page, applies the change,
 * then wipes the new frame in from `origin` (e.g. the toggle button). Falls
 * back to an instant swap without the View Transitions API or with reduced
 * motion. The `data-theme-vt` flag scopes the CSS overrides in globals.css.
 */
export function circularReveal(
  applyChange: () => void,
  origin?: { x: number; y: number },
) {
  const doc = document as ViewTransitionDocument;
  if (!doc.startViewTransition || prefersReducedMotion()) {
    applyChange();
    return;
  }
  const x = origin?.x ?? window.innerWidth / 2;
  const y = origin?.y ?? 0;
  const radius = Math.hypot(
    Math.max(x, window.innerWidth - x),
    Math.max(y, window.innerHeight - y),
  );
  document.documentElement.dataset.themeVt = '';
  const transition = doc.startViewTransition(applyChange);
  transition.ready
    .then(() => {
      document.documentElement.animate(
        {
          clipPath: [
            `circle(0px at ${x}px ${y}px)`,
            `circle(${radius}px at ${x}px ${y}px)`,
          ],
        },
        {
          duration: 550,
          easing: 'cubic-bezier(0.2, 0, 0, 1)',
          pseudoElement: '::view-transition-new(root)',
        },
      );
    })
    .catch(() => {});
  void transition.finished.finally(() => {
    delete document.documentElement.dataset.themeVt;
  });
}

export { gsap, useGSAP };
