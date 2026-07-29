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
  startViewTransition: (update: () => void | Promise<void>) => {
    ready: Promise<void>;
    updateCallbackDone: Promise<void>;
    finished: Promise<void>;
    skipTransition: () => void;
  };
};

type ThemeViewTransition = ReturnType<
  ViewTransitionDocument['startViewTransition']
>;

interface ActiveThemeTransition {
  id: string;
  style: HTMLStyleElement;
  transition: ThemeViewTransition;
}

let activeThemeTransition: ActiveThemeTransition | null = null;
let themeTransitionId = 0;

/**
 * Geometry of the box the `::view-transition` pseudo-elements are painted into.
 *
 * That box is the *snapshot containing block*, and two things about it bite on
 * phones:
 *
 * - Its units are not reliably CSS pixels. Some mobile engines size it at
 *   device resolution, so a circle written in `px` lands compressed towards the
 *   top-left by roughly the device pixel ratio. Everything below is therefore
 *   expressed as a *fraction* of this box and emitted as percentages, which the
 *   engine resolves against the box itself — correct under any uniform scale.
 * - It spans the **large** viewport (browser UI retracted). Where the layout
 *   viewport is genuinely shorter, that extra band sits above the origin of
 *   client coordinates, and everything placed by `getBoundingClientRect()`
 *   renders that much too high.
 *
 * `lv*` units measure the box; the `v*` pair in front of them is the fallback
 * for engines that discard the large-viewport units as invalid.
 */
function measureSnapshotBox() {
  const root = document.documentElement;
  const probe = document.createElement('div');
  probe.style.cssText =
    'position:fixed;top:0;left:0;margin:0;padding:0;border:0;' +
    'visibility:hidden;pointer-events:none;' +
    'width:100vw;height:100vh;width:100lvw;height:100lvh;';
  root.appendChild(probe);
  const probed = probe.getBoundingClientRect();
  probe.remove();

  const layoutWidth = root.clientWidth || window.innerWidth || probed.width;
  const layoutHeight = root.clientHeight || window.innerHeight || probed.height;
  const width = Math.max(probed.width, layoutWidth, window.innerWidth || 0);
  const height = Math.max(probed.height, layoutHeight, window.innerHeight || 0);
  // Compared against the layout viewport specifically, not the visual one:
  // Chrome and Safari keep the ICB at the large size and only shrink the visual
  // viewport, so for them this stays 0 and no correction is applied. It fires
  // only where the layout viewport really is the short one — the case where the
  // snapshot cannot line up with client coordinates.
  const topInset = Math.max(0, probed.height - layoutHeight);

  return { width, height, topInset };
}

/**
 * Circular reveal for theme changes, growing from `origin` (viewport
 * coordinates — pass the icon's centre) out to the farthest corner.
 *
 * View Transitions are assumed present — every current engine ships them — so
 * the only branch left is reduced motion, which is a stated preference rather
 * than a capability.
 */
export function circularReveal(
  applyChange: () => void,
  origin?: { x: number; y: number },
) {
  const doc = document as ViewTransitionDocument;
  const root = document.documentElement;

  if (prefersReducedMotion()) {
    applyChange();
    return;
  }

  const box = measureSnapshotBox();
  const x = origin?.x ?? box.width / 2;
  const y = (origin?.y ?? box.height / 2) + box.topInset;
  // Position as a fraction of the snapshot box, so the wipe starts on the icon
  // whatever units that box is measured in.
  const fx = box.width > 0 ? x / box.width : 0.5;
  const fy = box.height > 0 ? y / box.height : 0.5;
  // Reach of the farthest corner, not the full viewport diagonal: the diagonal
  // overshoots for any off-centre origin — a header icon needs about 90% of it —
  // so the sweep used to finish well before the animation did.
  const reachX = Math.max(fx, 1 - fx) * box.width;
  // Slack for the vertical correction above: if this engine turns out to anchor
  // the snapshot elsewhere, the circle still covers the corner it can't see.
  const reachY = Math.max(fy, 1 - fy) * box.height + box.topInset;
  // A percentage radius resolves against sqrt((w² + h²) / 2), so scale by √2
  // over the diagonal to turn a length back into that percentage.
  const radiusPercent =
    (Math.hypot(reachX, reachY) / Math.hypot(box.width, box.height)) *
      Math.SQRT2 *
      100 +
    1;
  const at = `at ${(fx * 100).toFixed(3)}% ${(fy * 100).toFixed(3)}%`;
  const id = String(++themeTransitionId);
  const animationName = `theme-circular-reveal-${id}`;
  const style = document.createElement('style');
  style.dataset.themeTransitionStyle = id;
  // `html:root[…]` outweighs the `html[data-theme-vt]` base rule in globals.css
  // regardless of which stylesheet the browser sees last — matching on
  // specificity alone left this animation one stylesheet re-injection away from
  // losing to `animation: none`.
  style.textContent = `
    @keyframes ${animationName} {
      from { clip-path: circle(0% ${at}); }
      to { clip-path: circle(${radiusPercent.toFixed(3)}% ${at}); }
    }
    html:root[data-theme-vt="${id}"]::view-transition-new(root) {
      animation: ${animationName} 550ms cubic-bezier(0.4, 0, 0.6, 1) both;
    }
  `;

  activeThemeTransition?.transition.skipTransition();
  activeThemeTransition?.style.remove();
  document.head.append(style);
  root.dataset.themeVt = id;

  const transition = doc.startViewTransition(applyChange);
  const active = { id, style, transition };
  activeThemeTransition = active;

  const cleanup = () => {
    if (activeThemeTransition !== active) return;
    activeThemeTransition = null;
    style.remove();
    if (root.dataset.themeVt === id) delete root.dataset.themeVt;
  };
  void transition.finished.then(cleanup, cleanup);
}

export { gsap, useGSAP };
