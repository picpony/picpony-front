'use client';

/**
 * The footer is held back while the page is still a placeholder — decided by script, one
 * attribute on the footer, rather than by a `:has()` rule in the stylesheet.
 *
 * The footer sits at the bottom of the page column (`mt-auto`), so under a placeholder shorter
 * than the window it was painted at the bottom of the screen and thrown off it when the content
 * landed — the most repeated layout shift in the app. A placeholder that stands in for a page's
 * first load carries `data-page-loading`; while one is in the page (and not inside a tab pane
 * that is not the one on screen), the footer carries `data-page-held` and globals.css keeps its
 * box but does not show it.
 *
 * **Why not the stylesheet.** It was `[data-page-content]:has([data-page-loading]…) .page-chrome`,
 * and Blink invalidates the whole page for that rule: every flip of a tab pane's active flag
 * restyled both panes' subtrees (2,092 elements, 50–90ms on a desktop, measured with the rule
 * alone stripped: 0.1ms), and every insertion or removal in the page — a grid chunk, a
 * placeholder leaving, an image remounting — was a full-page recalc (150–330ms on a throttled
 * phone). Every rewrite that kept `:has()` measured the same. One `querySelector` per batch of
 * mutations costs a fraction of a millisecond.
 *
 * The server paints the footer held (the attribute is in the markup), so the first byte never
 * shows it under a placeholder; the ref below releases it as soon as the page is known to have
 * none, before the first client paint. Without script the stylesheet shows it (`scripting: none`).
 */

import { registerPageFooter } from '@/lib/pageTransit';

const HELD = 'data-page-held';
/** A first-load placeholder that is not inside a concealed tab pane. */
const PLACEHOLDER =
  '[data-page-loading]:not([data-tab-pane]:not([data-tab-pane-active]) [data-page-loading])';

/**
 * A ref callback for the page footer: watches the page it sits in for as long as it is mounted,
 * and registers the footer for the tab switch's own hold (`beginPageTransit`). The page column
 * is keyed on the pathname, so each route gets its own watcher.
 */
export function holdFooterWhileLoading(footer: HTMLElement | null): (() => void) | undefined {
  if (!footer) return undefined;
  const unregister = registerPageFooter(footer);
  const page = footer.closest<HTMLElement>('[data-page-content]');
  if (!page) {
    footer.removeAttribute(HELD);
    return unregister;
  }
  const update = () => {
    footer.toggleAttribute(HELD, page.querySelector(PLACEHOLDER) !== null);
  };
  update();
  const observer = new MutationObserver(update);
  observer.observe(page, {
    subtree: true,
    childList: true,
    attributes: true,
    attributeFilter: ['data-page-loading', 'data-tab-pane-active'],
  });
  return () => {
    observer.disconnect();
    unregister();
  };
}
