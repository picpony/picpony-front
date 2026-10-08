'use client';

/**
 * A still frame of a DOM subtree, for cross-fading a page out after React has already
 * deleted it. The alternative — keeping the outgoing React tree mounted in a second slot —
 * remounts it (a different tree position is a different component instance, so every page's
 * `useEffect` would re-run and re-fetch just to animate its exit); an inert clone costs one
 * `cloneNode` and has no React attached at all.
 *
 * Four things make the clone safe to put on the page:
 *
 * - pruned to what was visible, so a 50-card gallery does not decode fifty images twice;
 * - it fetches nothing: an image the page had not finished loading is disarmed in the copy,
 *   not re-pointed, so leaving a page does not download what the user never scrolled to;
 * - every query hook stripped (`id`, `data-image-hero-*`, `data-tab-*`), so
 *   `document.querySelector` and `getElementById` cannot resolve into it;
 * - `inert` and `pointer-events: none`, so it is invisible to the accessibility tree, to tab
 *   order and to hit-testing.
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
  /**
   * The page's back affordance, copied — it lives outside the page (a portal into the back
   * slot), so the page's clone cannot carry it. `null` when the page had none; absent when the
   * snapshot did not look.
   */
  chrome?: HTMLElement | null;
  /**
   * Scrollers inside the source and where they were — the image detail's own column. A clone
   * opens every scroller at its top, and a detached one has no range to set, so these are
   * applied once the clone is in the document (`restoreSnapshotScroll`).
   */
  scroll?: { node: Element; top: number; left: number }[];
}

/** Put the source's inner scroll offsets back on its clone; call once the clone is attached. */
export function restoreSnapshotScroll(snapshot: RouteSnapshot) {
  for (const { node, top, left } of snapshot.scroll ?? []) {
    node.scrollTop = top;
    node.scrollLeft = left;
  }
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
 * Finds subtrees entirely outside the scrollport so the clone can replace them with
 * same-size spacers. All reads happen before any write: one forced layout, not one per node.
 */
function offscreenPaths(
  source: HTMLElement,
  viewTop: number,
  viewBottom: number,
  /* Concealed tab panes, pruned whole by the caller. A rect read inside one would make the
     engine lay out the subtree it is keeping skipped. */
  skip: ReadonlySet<Element>,
): number[][] {
  const paths: number[][] = [];
  let budget = PRUNE_BUDGET;
  const walk = (element: Element, depth: number) => {
    if (depth > PRUNE_DEPTH || budget <= 0) return;
    for (const child of element.children) {
      if (skip.has(child)) continue;
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
  /* Which tab panes are concealed, found before the budget below.
    *
    * `STRIP_ATTRS` removes the tab markers so a query cannot resolve into the clone — and
    * with them the only thing concealing the inactive pane. The panel no longer holds the
    * panes in one cell, so the clone stacks them as ordinary blocks with none concealed;
    * `clip-path` then keeps whatever band was on screen, now always the first pane in
    * document order (leave the forum tab for /search and the clone that slides out is the
    * *gallery*). So which pane is concealed must be baked in before the markers go.
    *
    * Pruned to 0×0 spacers rather than carried as inline `display: none`: a concealed pane
    * contributes nothing to layout either way, but this way it is not *cloned* — the home
    * route mounts its forum pane ahead of the tap, so `cloneNode` was copying a whole second
    * page, counting against `MAX_CLONE_NODES`, and going over the budget is a cliff (capture
    * returns `null`, no transition at all).
    *
    * Computed style off the live source rather than re-deriving the CSS here: the rule
    * has four conditions across two selectors, and a duplicate would drift.
    */
  const hiddenPanes: HTMLElement[] = [];
  for (const panel of source.querySelectorAll<HTMLElement>('[data-tab-panel]')) {
    for (const pane of panel.querySelectorAll<HTMLElement>(':scope > [data-tab-pane]')) {
      /* Concealed is `content-visibility: hidden` (the pane keeps its layout for the next
         switch), or `display: none` in an engine without the property. */
      const style = getComputedStyle(pane);
      if (style.display !== 'none' && style.contentVisibility !== 'hidden') continue;
      /* Nested groups exist (the admin console has a `TabPanes` inside one of its own panes),
         and a pane inside a concealed pane computes `display: none` from the same rule — both
         would be collected and the discount below would subtract the inner subtree twice,
         under-reporting the count the cap enforces. The outer one already accounts for
         everything under it. */
      if (hiddenPanes.some((outer) => outer.contains(pane))) continue;
      hiddenPanes.push(pane);
    }
  }
  let nodeCount = source.getElementsByTagName('*').length;
  /* Descendants only: the pane element itself survives the prune as a 0×0 spacer, so it is
     still a node in the clone and counting it as saved is the same under-report. */
  for (const pane of hiddenPanes) nodeCount -= pane.getElementsByTagName('*').length;
  if (nodeCount > MAX_CLONE_NODES) return null;

  const sourceRect = source.getBoundingClientRect();
  if (sourceRect.width === 0 || sourceRect.height === 0) return null;
  const hostRect = host.getBoundingClientRect();

  // --- reads ---------------------------------------------------------------
  // Everything measured here comes from the LIVE source, before any mutation:
  // a detached clone has no layout, so rect reads on one return zeroes, and
  // sizing media spacers from it collapsed every video and canvas to 0×0.
  const prune = offscreenPaths(
    source,
    hostRect.top - PRUNE_MARGIN_PX,
    hostRect.bottom + PRUNE_MARGIN_PX,
    new Set(hiddenPanes),
  );
  /* Appended to the same list, so both kinds of removal go through one pass and a concealed
     pane inside an already-pruned ancestor resolves to null, which is correct. */
  for (const pane of hiddenPanes) {
    const path = pathTo(source, pane);
    if (path) prune.push(path);
  }
  const pruneSizes = prune.map((path) => {
    const node = nodeAt(source, path) as HTMLElement | null;
    const rect = node?.getBoundingClientRect();
    return { width: rect?.width ?? 0, height: rect?.height ?? 0 };
  });
  const sourceStyle = getComputedStyle(source);
  const sourceOpacity = sourceStyle.opacity;
  /* The page column is a size container by an attribute the strip below removes, and what is
     inside it queries it (the back affordance's reserved room). Kept on the clone, which has the
     source's width, so those queries answer as they did — without it the room came back and the
     leaving page dropped by it in the frame its clone appeared. */
  const containerType = sourceStyle.containerType;
  const containerName = sourceStyle.containerName;

  /* Indexed against `getElementsByTagName('*')` on the untouched source: the clone is an
     exact copy at that moment, so the same index identifies the same node. The clone's side
     is turned into references before anything is replaced, which is what keeps the pairing
     good through the prune.

     An image is recorded with the resource it is showing, or `null` when it is not showing
     one yet — `complete && naturalWidth > 0`, since `complete` alone is also true of a
     failed image. */
  const sourceAll = source.getElementsByTagName('*');
  const imgSrcByIndex = new Map<number, string | null>();
  const mediaSizeByIndex = new Map<number, { width: number; height: number }>();
  const scrolledByIndex = new Map<number, { top: number; left: number }>();
  for (let i = 0; i < sourceAll.length; i += 1) {
    const element = sourceAll[i];
    /* Layout is already clean from the rect reads above, so these are plain reads. */
    if (element.scrollTop || element.scrollLeft) {
      scrolledByIndex.set(i, { top: element.scrollTop, left: element.scrollLeft });
    }
    if (REPLACE_TAGS.has(element.tagName)) {
      const rect = element.getBoundingClientRect();
      mediaSizeByIndex.set(i, { width: rect.width, height: rect.height });
    } else if (element.tagName === 'IMG') {
      const img = element as HTMLImageElement;
      imgSrcByIndex.set(i, img.complete && img.naturalWidth > 0 ? img.currentSrc : null);
    }
  }

  // --- writes --------------------------------------------------------------
  const clone = source.cloneNode(true) as HTMLElement;
  /* References, not indices: taken before anything is replaced, they stay good however the
     tree changes below. */
  const cloneAll = [...clone.getElementsByTagName('*')];

  // Paths still align: nothing has been replaced yet.
  prune.forEach((path, i) => {
    const node = nodeAt(clone, path);
    node?.replaceWith(spacer(pruneSizes[i]));
  });

  /* Disarm every copy of an image that was not showing anything, pruned or not, before this
     task ends. `cloneNode` copies each `src`, and a copy outside the document is not gated on
     being seen: an eager one queues its fetch for the next microtask, and the fix-up below
     used to turn every lazy one eager as well — leaving the gallery for /search fetched 44
     pictures the user had never scrolled to, 18 of them in the forum pane nobody had
     opened. Removing the sources in the
     same task replaces that queued load with one that has nothing to fetch; pruning alone
     does not, since a detached copy still loads. The empty `alt` keeps a source-less image
     from painting its text: the live one was showing a placeholder, and so does the clone. */
  for (const [i, src] of imgSrcByIndex) {
    if (src !== null) continue;
    const img = cloneAll[i] as HTMLElement;
    img.removeAttribute('srcset');
    img.removeAttribute('sizes');
    img.removeAttribute('src');
    img.setAttribute('alt', '');
    /* An image whose source is taken away is in the *broken* state, not the empty one, and a
       sized broken image paints the engine's broken-picture glyph at its corner (measured: a
       copy of the detail's still-loading picture showed it through a whole container transform).
       The live one was showing nothing, so the copy shows nothing. */
    img.style.visibility = 'hidden';
  }

  for (const [i, size] of mediaSizeByIndex) {
    const media = cloneAll[i];
    // A copied video with a source runs its own load; take the sources before discarding it.
    media.removeAttribute('src');
    media.removeAttribute('poster');
    media.replaceChildren();
    // Cloned and then reloaded / blank / autoplaying — a sized box instead.
    if (clone.contains(media)) media.replaceWith(spacer(size));
  }

  for (const [i, src] of imgSrcByIndex) {
    if (!src) continue;
    const img = cloneAll[i] as HTMLImageElement;
    // Inside a pruned subtree: nothing left to point.
    if (!clone.contains(img)) continue;
    // Point at the exact resource the browser already decoded, so the clone
    // paints from cache instead of re-running srcset selection at a slightly
    // different layout width.
    img.setAttribute('src', src);
    img.removeAttribute('srcset');
    img.removeAttribute('sizes');
    img.setAttribute('loading', 'eager');
    /* `async`, not `sync`. This runs inside `RouteCrossFade`'s `componentDidUpdate`, i.e.
       the same commit as the incoming page's first paint, and `sync` made every surviving
       thumbnail decode on that frame — a 50-card gallery's worth of blocking decodes at
       the one moment the main thread has none to spare. The bitmap is already in the
       decode cache at the width the clone asks for, because `src` is the source's own
       `currentSrc` with `srcset` stripped and the clone is laid out at the source's width,
       so what `sync` was buying was a guarantee the cache already provides. The outgoing
       leg is a 100ms opacity fade; a first frame that is one image short of complete is
       cheaper than a long task. */
    img.setAttribute('decoding', 'async');
  }

  /* A ripple mid-press must not be carried into the clone: the wave is sized to reach its
    * host's farthest corner and kept inside it by the clipping the ripple host supplies —
    * but that attribute is stripped below (it must be: a clone may not answer a press), and
    * a wave that had been growing invisibly inside a 254px card lands as an 853px disc
    * across the page on the frame the clone appears. Removing it is right rather than
    * merely expedient: the press belongs to the page being left, its wave is 120ms from the
    * fade that erases it, and the live element keeps its own ripple. */
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
  // replay it from opacity 0 — the exact blank this mechanism exists to remove. The image
  // detail's root has one too under the lower motion tiers (its arrive keyframe).
  clone.classList.remove('animate-page-transition');
  clone.style.animation = 'none';
  clone.style.opacity = sourceOpacity;
  if (containerType && containerType !== 'normal') {
    clone.style.containerType = containerType;
    if (containerName && containerName !== 'none') clone.style.containerName = containerName;
  }

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
  /* The rect already includes an in-flight route's root transform. Carrying
     that inline transform into the pinned clone applies the same travel twice
     on a rapid second navigation. Descendant poses stay intact; only this
     root's position and dimensions have been baked into the box above. */
  clone.style.transform = 'none';
  clone.style.translate = 'none';
  clone.style.scale = 'none';
  clone.style.rotate = 'none';
  // Its parent would otherwise shrink it to its content size.
  clone.style.flex = 'none';

  /* Crop it to the band that was actually on screen. The clone is the page's full height and
    * the host layer only clips it where it currently sits; the moment a shared-axis run
    * slides it a whole window upwards, the strip below the fold (the 200px of real content
    * `PRUNE_MARGIN_PX` deliberately keeps, then blank spacers) is dragged through the
    * viewport. `clip-path` rather than a wrapper that clips, because it is expressed in the
    * element's own box edges and therefore travels with the transform — the band stays
    * exactly the pixels the user was looking at for the whole flight. Horizontal needs no
    * crop — the page is never wider than its window — but the same edge offsets cover it
    * for free if that ever changes.
    */
  const visibleTop = Math.max(0, hostRect.top - sourceRect.top);
  const visibleBottom = Math.min(sourceRect.height, hostRect.bottom - sourceRect.top);
  clone.style.clipPath = `inset(${visibleTop}px 0px ${Math.max(0, sourceRect.height - visibleBottom)}px 0px)`;

  /* A pruned subtree took its scrollers with it; a spacer keeps the height, so an offset on a
     surviving scroller still lands on the same pixels. */
  const scroll = [...scrolledByIndex]
    .map(([i, offset]) => ({ node: cloneAll[i], ...offset }))
    .filter(({ node }) => clone.contains(node));

  return { node: clone, scroll };
}
