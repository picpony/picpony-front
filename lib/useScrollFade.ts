'use client';

import { useLayoutEffect, type RefObject } from 'react';

/**
 * Which edges of a horizontally scrolling row hide content, as the two attributes the
 * `scroll-fade-x` mask reads (`data-overflow-start` / `data-overflow-end`). One implementation for
 * every row that wears the mask: `Tabs`' own row, and /search's one-line chip rows (the tags a
 * query became, the quick tags) — one line rather than wrapping on purpose, since those rows sit
 * above the results and a row that grew a second line when its chips arrived would push the grid
 * down after it had painted. There were two copies, and they had already drifted (G0-003).
 *
 * **It watches the row's children itself**, so a caller says nothing about its content: a resize
 * of the row or of any child, a scroll, and a child arriving or leaving (which re-observes the new
 * set) each re-measure. It used to take the caller's own dependency array and spread it into the
 * effect's, which the React Compiler cannot see through. `active` turns it off for a row that never
 * scrolls (the pill tabs).
 *
 * Written to the DOM directly: a scroll is not a render.
 */
export function useScrollFade(ref: RefObject<HTMLElement | null>, active = true) {
  useLayoutEffect(() => {
    const row = ref.current;
    if (!row || !active) return;
    const update = () => {
      const max = row.scrollWidth - row.clientWidth;
      row.toggleAttribute('data-overflow-start', row.scrollLeft > 1);
      row.toggleAttribute('data-overflow-end', row.scrollLeft < max - 1);
    };
    const sizes = new ResizeObserver(update);
    const watch = () => {
      sizes.disconnect();
      sizes.observe(row);
      for (const child of Array.from(row.children)) sizes.observe(child);
      update();
    };
    watch();
    const children = new MutationObserver(watch);
    children.observe(row, { childList: true });
    row.addEventListener('scroll', update, { passive: true });
    return () => {
      row.removeEventListener('scroll', update);
      children.disconnect();
      sizes.disconnect();
    };
  }, [ref, active]);
}
