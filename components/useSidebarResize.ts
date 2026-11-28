'use client';

import { useLayoutEffect, useRef, type RefObject } from 'react';
import type { SidebarMode } from '@/lib/sidebarMode';

type Block = { element: HTMLElement; rect: DOMRect };
type Move = { animation: Animation; restore: () => void };
const BLOCK_LIMIT = 32;

/** Read visible surfaces as units; never measure a concealed tab's subtree. */
function captureBlocks(root: HTMLElement, page: HTMLElement): Block[] {
  const view = page.getBoundingClientRect();
  const blocks: Block[] = [];
  const visit = (element: HTMLElement, depth: number) => {
    if (blocks.length >= BLOCK_LIMIT) return;
    if (
      element.hasAttribute('data-tab-pane') &&
      (element.hasAttribute('data-tab-pane-done') ||
        !element.matches('[data-tab-pane-active],[data-tab-pane-leaving],[data-tab-pane-entering]'))
    )
      return;
    const rect = element.getBoundingClientRect();
    const style = getComputedStyle(element);
    if (style.position === 'fixed' || style.position === 'sticky') return;
    if (
      style.display !== 'contents' &&
      (rect.width <= 0 ||
        rect.height <= 0 ||
        rect.bottom < view.top - view.height ||
        rect.top > view.bottom + view.height)
    )
      return;
    const bare =
      (style.backgroundColor === 'transparent' || style.backgroundColor === 'rgba(0, 0, 0, 0)') &&
      style.backgroundImage === 'none' &&
      style.boxShadow === 'none' &&
      ![style.borderTopWidth, style.borderRightWidth, style.borderBottomWidth, style.borderLeftWidth].some(
        (border) => parseFloat(border) > 0,
      ) &&
      style.overflowX === 'visible' &&
      style.overflowY === 'visible';
    const children = Array.from(element.children).filter((child): child is HTMLElement => child instanceof HTMLElement);
    if (
      depth < 12 &&
      children.length &&
      !element.hasAttribute('data-masonry-id') &&
      (style.display === 'contents' || element.hasAttribute('data-tab-pane') || (bare && rect.height > 64))
    ) {
      children.forEach((child) => visit(child, depth + 1));
    } else if (style.display !== 'inline' && style.display !== 'contents') {
      blocks.push({ element, rect });
    }
  };
  Array.from(root.children).forEach((child) => {
    if (child instanceof HTMLElement) visit(child, 0);
  });
  return blocks;
}

function cancelMoves(moves: Move[]) {
  moves.forEach(({ animation, restore }) => {
    animation.cancel();
    restore();
  });
}

/** Reflow once, then move each visible surface from its painted bounds to its new bounds.
 * The wide scrolling window lets outgoing card positions remain visible during narrowing.
 * See docs/design/layout.md#navigation-geometry. */
export function useSidebarResize(
  sidebarRef: RefObject<HTMLElement | null>,
  pageRef: RefObject<HTMLElement | null>,
  mode: SidebarMode,
  overlay: boolean,
) {
  const previous = useRef(mode);
  const moves = useRef<Move[]>([]);
  const finish = useRef<() => void>(() => {});

  useLayoutEffect(() => {
    const changed = previous.current !== mode;
    previous.current = mode;
    const sidebar = sidebarRef.current;
    const page = pageRef.current;
    const slot = page?.parentElement;
    const content = page?.querySelector<HTMLElement>('[data-image-detail-background-visual]');
    if (!sidebar || !page || !slot || !content) return;
    if (overlay || !changed) {
      finish.current();
      return;
    }

    const transitions = () =>
      sidebar
        .getAnimations()
        .filter(
          (animation): animation is CSSTransition =>
            animation instanceof CSSTransition && animation.playState === 'running',
        );
    const running = transitions();
    if (!running.length) {
      finish.current();
      return;
    }

    // Read the CSS transition endpoints, including reversals, rather than duplicate
    // the drawer's breakpoint widths or assume a fixed root font size.
    const style = getComputedStyle(sidebar);
    const width = parseFloat(style.width);
    const margin = parseFloat(style.marginRight);
    const endpoint = (property: string, fallback: number) => {
      const animation = running.find((item) => item.transitionProperty === property);
      const frame = (animation?.effect as KeyframeEffect | null)?.getKeyframes().at(-1);
      const value = frame?.[property === 'margin-right' ? 'marginRight' : property];
      return value === undefined ? fallback : parseFloat(String(value));
    };
    const targetSpace = endpoint('width', width) + endpoint('margin-right', margin);
    const targetWidth = slot.getBoundingClientRect().width + width + margin - targetSpace;
    // Capture any interrupted transforms before cancelling them. All geometry reads
    // precede the width commit, and all destination reads precede animation writes.
    const before = captureBlocks(content, page);
    cancelMoves(moves.current);
    moves.current = [];
    page.style.minWidth = `${Math.max(page.getBoundingClientRect().width, targetWidth)}px`;
    content.style.width = `${targetWidth}px`;
    page.setAttribute('data-sidebar-resizing', '');

    const view = page.getBoundingClientRect();
    const after = before.map((block) => {
      const next = block.element.getBoundingClientRect();
      const computed = getComputedStyle(block.element);
      return {
        ...block,
        next,
        base: computed.transform === 'none' ? '' : computed.transform,
        position: computed.position,
        zIndex: computed.zIndex,
      };
    });
    // The drawer already owns the overlay layout spring, including shortened CSS
    // reversals and category speed. Its exact clock also drives the content tracks.
    const leader = running.find((animation) => animation.transitionProperty === 'width') ?? running[0];
    const timing = leader.effect!.getTiming();
    for (const { element, rect, next, base, position: computedPosition, zIndex: computedZIndex } of after) {
      if (
        next.width <= 0 ||
        next.height <= 0 ||
        Math.max(rect.bottom, next.bottom) < view.top ||
        Math.min(rect.top, next.top) > view.bottom
      )
        continue;
      const x = rect.left - next.left;
      const y = rect.top - next.top;
      const sx = rect.width / next.width;
      const sy = rect.height / next.height;
      if (
        Math.abs(x) < 0.5 &&
        Math.abs(y) < 0.5 &&
        Math.abs(rect.width - next.width) < 0.5 &&
        Math.abs(rect.height - next.height) < 0.5
      )
        continue;
      const position = element.style.position;
      const zIndex = element.style.zIndex;
      if (computedZIndex === 'auto') {
        if (computedPosition === 'static') element.style.position = 'relative';
        element.style.zIndex = '1';
      }
      const animation = element.animate(
        [
          {
            transform: `translate(${x}px, ${y}px) scale(${sx}, ${sy}) ${base}`,
            transformOrigin: '0 0',
          },
          { transform: base || 'none', transformOrigin: '0 0' },
        ],
        { duration: timing.duration, easing: timing.easing, fill: 'both' },
      );
      if (leader.startTime !== null) animation.startTime = leader.startTime;
      moves.current.push({
        animation,
        restore: () => {
          element.style.position = position;
          element.style.zIndex = zIndex;
        },
      });
    }

    let active = true;
    const release = () => {
      active = false;
      cancelMoves(moves.current);
      moves.current = [];
      content.style.removeProperty('width');
      page.style.removeProperty('min-width');
      page.removeAttribute('data-sidebar-resizing');
    };
    finish.current = release;
    const settle = () => {
      if (!active) return;
      const pending = transitions();
      if (!pending.length) {
        release();
        return;
      }
      // Cancellation and a speed/tier change both settle the old promises. Recheck
      // for replacement tracks before releasing the page's width.
      void Promise.allSettled(pending.map((animation) => animation.finished)).then(settle);
    };
    settle();
    // A new mode captures the current transforms and retains the scrolling window.
    return () => {
      active = false;
    };
  }, [sidebarRef, pageRef, mode, overlay]);

  useLayoutEffect(() => {
    const page = pageRef.current;
    const release = () => finish.current();
    window.addEventListener('resize', release);
    page?.addEventListener('pointerdown', release, true);
    page?.addEventListener('wheel', release, { passive: true });
    return () => {
      window.removeEventListener('resize', release);
      page?.removeEventListener('pointerdown', release, true);
      page?.removeEventListener('wheel', release);
      release();
    };
  }, [pageRef]);
}
