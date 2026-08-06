'use client';

/**
 * A still frame of a DOM subtree, for cross-fading a page out after React has
 * already deleted it.
 *
 * The alternative — keeping the outgoing React tree mounted in a second slot —
 * remounts it: a different position in the tree is a different component
 * instance, so every page's `useEffect` would re-run and re-fetch just to
 * animate something on its way out. An inert clone has no React attached at
 * all, so it costs one `cloneNode` and nothing else.
 *
 * Three things make the clone safe to put on the page:
 *
 * - it is pruned to what was visible, so a 50-card gallery does not decode
 *   fifty images a second time;
 * - every query hook is stripped (`id`, `data-image-hero-*`, `data-tab-*`),
 *   so `document.querySelector` and `getElementById` cannot resolve into it;
 * - it is `inert` and `pointer-events: none`, so it is invisible to the
 *   accessibility tree, to tab order and to hit-testing.
 */

/** Above this the clone's own layout costs more than the fade is worth. */
const MAX_CLONE_NODES = 2000;
/** How many rect reads to spend finding off-screen subtrees. */
const PRUNE_BUDGET = 600;
/** How deep to descend looking for prunable subtrees. */
const PRUNE_DEPTH = 10;
/** Keep this much beyond the scrollport, so an in-flight lazy row survives. */
const PRUNE_MARGIN_PX = 200;

/** Attributes that must never resolve inside a clone. */
const STRIP_ATTRS = [
  'id',
  'data-page-content',
  'data-tab-panel',
  'data-tab-pane',
  'data-tab-pane-active',
  'data-tab-pane-leaving',
  'data-tab-pane-entering',
  'data-pagination-anchor',
  'data-ripple',
  'data-autofocus',
];
const STRIP_PREFIXES = ['data-image-hero-', 'data-image-detail-'];

/** Cloned and then reloaded, blank, or autoplaying. Replaced by a sized box. */
const REPLACE_TAGS = new Set(['VIDEO', 'IFRAME', 'CANVAS', 'SCRIPT', 'AUDIO', 'OBJECT']);

export interface RouteSnapshot {
  node: HTMLElement;
}

function spacer(rect: { width: number; height: number }) {
  const box = document.createElement('div');
  box.style.width = `${rect.width}px`;
  box.style.height = `${rect.height}px`;
  box.setAttribute('aria-hidden', 'true');
  return box;
}

/** Index path from `root` to `node`, so the same node can be found in a clone. */
function pathTo(root: Element, node: Element): number[] | null {
  const path: number[] = [];
  let current: Element | null = node;
  while (current && current !== root) {
    const parent: Element | null = current.parentElement;
    if (!parent) return null;
    path.unshift([...parent.children].indexOf(current));
    current = parent;
  }
  return current === root ? path : null;
}

function nodeAt(root: Element, path: number[]): Element | null {
  let current: Element = root;
  for (const index of path) {
    const next = current.children[index];
    if (!next) return null;
    current = next;
  }
  return current;
}

/**
 * Finds subtrees that are entirely outside the scrollport, so the clone can
 * replace them with same-size spacers. All reads happen before any write, so
 * this costs one forced layout rather than one per node.
 */
function offscreenPaths(source: HTMLElement, viewTop: number, viewBottom: number): number[][] {
  const paths: number[][] = [];
  let budget = PRUNE_BUDGET;
  const walk = (element: Element, depth: number) => {
    if (depth > PRUNE_DEPTH || budget <= 0) return;
    for (const child of element.children) {
      if (budget-- <= 0) return;
      const rect = child.getBoundingClientRect();
      if (rect.height === 0 && rect.width === 0) continue;
      if (rect.bottom < viewTop || rect.top > viewBottom) {
        const path = pathTo(source, child);
        if (path) paths.push(path);
        continue;
      }
      walk(child, depth + 1);
    }
  };
  walk(source, 0);
  return paths;
}

/**
 * Clones `source` into a detached, sanitised, viewport-pinned element.
 * Returns `null` when the subtree is too large to be worth cloning.
 */
export function captureVisualClone(source: HTMLElement, host: HTMLElement): RouteSnapshot | null {
  if (source.getElementsByTagName('*').length > MAX_CLONE_NODES) return null;

  const sourceRect = source.getBoundingClientRect();
  if (sourceRect.width === 0 || sourceRect.height === 0) return null;
  const hostRect = host.getBoundingClientRect();

  // --- reads ---------------------------------------------------------------
  // Everything measured here comes from the LIVE source, before any mutation.
  // A detached clone has no layout, so `getBoundingClientRect()` on one returns
  // zeroes — sizing the media spacers from the clone collapsed every video and
  // canvas to 0×0 and shifted the whole frame.
  const prune = offscreenPaths(
    source,
    hostRect.top - PRUNE_MARGIN_PX,
    hostRect.bottom + PRUNE_MARGIN_PX,
  );
  const pruneSizes = prune.map((path) => {
    const node = nodeAt(source, path) as HTMLElement | null;
    const rect = node?.getBoundingClientRect();
    return { width: rect?.width ?? 0, height: rect?.height ?? 0 };
  });
  const sourceOpacity = getComputedStyle(source).opacity;

  /* Which tab panes are actually on screen.
   *
   * `STRIP_ATTRS` removes `data-tab-panel` and every `data-tab-pane*` marker, so
   * that a query cannot resolve into the clone — and in doing so it removes the
   * only thing that was hiding the inactive pane. The panel stops being a grid,
   * the two panes stop sharing a cell, and the clone stacks them as ordinary
   * blocks with nothing hidden. `clip-path` then keeps whatever band was on
   * screen, which is now always the first pane in document order: leave the
   * forum tab for /search and the clone that slides out is the *gallery*.
   *
   * So the state is baked in before the markers go. Computed `display` off the
   * live source rather than re-deriving the CSS here: the rule has four
   * conditions across two selectors and a duplicate would drift the first time
   * either is touched. Read in the read phase, applied after the prune, which
   * is one-for-one and leaves these paths valid.
   */
  const hiddenPanePaths: number[][] = [];
  for (const panel of source.querySelectorAll<HTMLElement>('[data-tab-panel]')) {
    for (const pane of panel.querySelectorAll<HTMLElement>(':scope > [data-tab-pane]')) {
      if (getComputedStyle(pane).display === 'none') {
        const path = pathTo(source, pane);
        if (path) hiddenPanePaths.push(path);
      }
    }
  }

  /* Indexed against `getElementsByTagName('*')` on the untouched source. The
     clone is an exact copy at that moment, so the same index identifies the
     same node — but ONLY before anything is replaced. Both fix-ups below
     therefore run before the prune, which is what the first version got wrong:
     it read image sources from the source by index and applied them to the
     already-pruned clone, so every image after the first pruned one received
     its neighbour's picture. */
  const sourceAll = source.getElementsByTagName('*');
  const imgSrcByIndex = new Map<number, string>();
  const mediaSizeByIndex = new Map<number, { width: number; height: number }>();
  for (let i = 0; i < sourceAll.length; i += 1) {
    const element = sourceAll[i];
    if (REPLACE_TAGS.has(element.tagName)) {
      const rect = element.getBoundingClientRect();
      mediaSizeByIndex.set(i, { width: rect.width, height: rect.height });
    } else if (element.tagName === 'IMG') {
      imgSrcByIndex.set(i, (element as HTMLImageElement).currentSrc);
    }
  }

  // --- writes --------------------------------------------------------------
  const clone = source.cloneNode(true) as HTMLElement;

  // Snapshot the collection: it is live, and the loop replaces nodes.
  const cloneAll = [...clone.getElementsByTagName('*')];
  for (let i = 0; i < cloneAll.length; i += 1) {
    const element = cloneAll[i];
    const mediaSize = mediaSizeByIndex.get(i);
    if (mediaSize) {
      // Cloned and then reloaded / blank / autoplaying — a sized box instead.
      element.replaceWith(spacer(mediaSize));
      continue;
    }
    const src = imgSrcByIndex.get(i);
    if (src === undefined) continue;
    const img = element as HTMLImageElement;
    // Point at the exact resource the browser already decoded, so the clone
    // paints from cache instead of re-running srcset selection at a slightly
    // different layout width.
    if (src) img.setAttribute('src', src);
    img.removeAttribute('srcset');
    img.removeAttribute('sizes');
    img.setAttribute('loading', 'eager');
    img.setAttribute('decoding', 'sync');
  }

  // Paths still align: every replacement above was one-for-one.
  prune.forEach((path, i) => {
    const node = nodeAt(clone, path);
    node?.replaceWith(spacer(pruneSizes[i]));
  });

  // Carry the panel's own hiding forward as an inline style, before the markers
  // that produced it are stripped below. A path landing inside an already-pruned
  // subtree resolves to null, which is correct — that pane is a spacer now.
  hiddenPanePaths.forEach((path) => {
    const pane = nodeAt(clone, path) as HTMLElement | null;
    if (pane) pane.style.display = 'none';
  });

  /* A ripple mid-press must not be carried into the clone.
   *
   * The wave is sized to reach its host's farthest corner and is kept inside it
   * by the `overflow: hidden` that `[data-ripple]` supplies — but that attribute
   * is stripped below (it must be: a clone may not answer a press). The clip
   * goes with it, and a wave that had been growing invisibly inside a 254px card
   * lands as an 853px disc across the page on the frame the clone appears. That
   * is the block seen when opening a forum post and on the detail page's back
   * button, whose ripple is always still running when the route changes.
   *
   * Removing it is right rather than merely expedient: the press belongs to the
   * page being left, its wave is 120ms from the fade that erases it, and the
   * live element keeps its own ripple regardless. */
  clone.querySelectorAll('.ripple').forEach((wave) => wave.remove());

  const walker = document.createTreeWalker(clone, NodeFilter.SHOW_ELEMENT);
  let node = walker.currentNode as Element | null;
  while (node) {
    for (const attr of STRIP_ATTRS) node.removeAttribute(attr);
    for (const attr of [...node.attributes]) {
      if (STRIP_PREFIXES.some((prefix) => attr.name.startsWith(prefix))) {
        node.removeAttribute(attr.name);
      }
    }
    node = walker.nextNode() as Element | null;
  }

  // The page container carries the entry keyframe; without this the clone would
  // replay it from opacity 0 — the exact blank this mechanism exists to remove.
  clone.classList.remove('animate-page-transition');
  clone.style.opacity = sourceOpacity;

  /* Pin the clone where the content visually was. `getBoundingClientRect`
     already includes the scroll offset, so a page scrolled to 2000px yields
     `top: -2000px` and the clone shows exactly the pixels the user was looking
     at. Width comes from the source's own rect, not from the host box, so
     whatever `scrollbar-gutter` was reserving is already accounted for. */
  clone.style.position = 'absolute';
  clone.style.top = `${sourceRect.top - hostRect.top}px`;
  clone.style.left = `${sourceRect.left - hostRect.left}px`;
  clone.style.width = `${sourceRect.width}px`;
  clone.style.height = `${sourceRect.height}px`;
  clone.style.margin = '0';
  // Out of its flex parent it would otherwise shrink to its content.
  clone.style.flex = 'none';

  /* Crop it to the band that was actually on screen.
   *
   * The clone is the page's full height — a messages page 2248px tall inside a
   * 790px window — and the host layer only clips it where it currently sits.
   * The moment a shared-axis run slides it a whole window upwards, the strip
   * that was below the fold is dragged through the viewport: the 200px of real
   * content `PRUNE_MARGIN_PX` deliberately keeps, followed by blank spacers.
   * That is the "a bit of the messages page lingers after switching back".
   *
   * `clip-path` rather than a wrapper with `overflow: hidden`, because it is
   * expressed in the element's own border box and therefore travels with the
   * transform. The band stays exactly the pixels the user was looking at for
   * the whole flight, wherever the flight takes it.
   *
   * Horizontal needs no crop — the page is never wider than its window — but
   * the same inset covers it for free if that ever changes.
   */
  const visibleTop = Math.max(0, hostRect.top - sourceRect.top);
  const visibleBottom = Math.min(sourceRect.height, hostRect.bottom - sourceRect.top);
  clone.style.clipPath = `inset(${visibleTop}px 0px ${Math.max(0, sourceRect.height - visibleBottom)}px 0px)`;

  return { node: clone };
}
