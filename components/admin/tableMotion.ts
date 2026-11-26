/**
 * The motion the console's two table primitives share — `DataTable`'s row presence and
 * `InlineEditorPanel`'s opening and closing: which elements follow a moving block, and one move
 * per element across both, so a second gesture starts from where the first left the element.
 *
 * Plain DOM and Web Animations: each move is one composited `transform` on an element (no style
 * written per frame, no animated `clip-path`), cancelled to land. A gesture's *own* tracks — the
 * editor's clip, a row's fade — use other properties (`translate`, `opacity`), so a move composes
 * with them instead of replacing them.
 */

import { insideConcealedPane } from '@/lib/tabPaneVisibility';

/** One running move per element, across the table's presence and the inline editor. */
const moves = new WeakMap<Element, Animation>();
/** Pending cleanup frame for `data-layout-owned` markers (`markLayoutOwned`). */
const ownedFrames = new WeakMap<Element, number>();

/**
 * Signals an enclosing `FollowHeight track` that a table or inline editor already owns this
 * commit's height transition via compositor FLIP. Kept across two animation frames so it covers
 * the same-frame `ResizeObserver` delivery without outliving the gesture.
 */
export function markLayoutOwned(el: Element | null | undefined) {
  if (!el || typeof el.setAttribute !== 'function') return;
  const previous = ownedFrames.get(el);
  if (previous !== undefined && typeof cancelAnimationFrame === 'function') cancelAnimationFrame(previous);
  el.setAttribute('data-layout-owned', '');
  if (typeof requestAnimationFrame !== 'function') return;
  const clear = () => {
    ownedFrames.delete(el);
    el.removeAttribute('data-layout-owned');
  };
  const first = requestAnimationFrame(() => {
    const second = requestAnimationFrame(clear);
    ownedFrames.set(el, second);
  });
  ownedFrames.set(el, first);
}

/** The move running on `el`, if any. */
export function runningMove(el: Element): Animation | undefined {
  const animation = moves.get(el);
  return animation && animation.playState !== 'idle' && animation.playState !== 'finished' ? animation : undefined;
}

/**
 * Replaces `el`'s move. The previous one is cancelled, so the caller reads the pose to start from
 * (`drawnOffsetY`, a rect) before calling this.
 */
export function startMove(el: HTMLElement, keyframes: Keyframe[], timing: KeyframeAnimationOptions): Animation {
  moves.get(el)?.cancel();
  const animation = el.animate(keyframes, timing);
  moves.set(el, animation);
  const forget = () => {
    if (moves.get(el) === animation) moves.delete(el);
  };
  animation.finished.then(forget, forget);
  return animation;
}

/**
 * Drops `el`'s move, landing it where the layout has it — only when that move is still `animation`
 * when one is named: a gesture landing its own moves must not cancel the one a later gesture
 * started on the same row.
 */
export function dropMove(el: Element, animation?: Animation) {
  const current = moves.get(el);
  if (!current || (animation && current !== animation)) return;
  moves.delete(el);
  current.cancel();
}

/** Stops at the page column or an overlay's scroll body so modal tables never move dialog chrome. */
function isMotionBoundary(el: Element): boolean {
  return el.hasAttribute('data-page-content') || el.hasAttribute('data-app-scroll-container');
}

/**
 * What follows `node` in its scroll column and lies within `band` (viewport coordinates): the later
 * siblings of `node` and of each of its ancestors, up to the page content or overlay scroller —
 * rows after a row, the pager after a table, the sections after a panel, the shell's footer. A
 * block that grows or shrinks moves all of it; animated, it travels with the block instead of
 * jumping to where the block will end. A concealed tab pane, a box out of the flow and a box with
 * no height are left out.
 */
export function followersOf(node: Element, band: { top: number; bottom: number }): HTMLElement[] {
  const result: HTMLElement[] = [];
  for (let current: Element | null = node; current && !isMotionBoundary(current); current = current.parentElement) {
    for (let sibling = current.nextElementSibling; sibling; sibling = sibling.nextElementSibling) {
      if (!(sibling instanceof HTMLElement)) continue;
      if (sibling.hasAttribute('data-tab-pane') && insideConcealedPane(sibling)) continue;
      const rect = sibling.getBoundingClientRect();
      if (rect.height === 0 || rect.bottom < band.top || rect.top > band.bottom) continue;
      const position = getComputedStyle(sibling).position;
      if (position === 'absolute' || position === 'fixed') continue;
      result.push(sibling);
    }
  }
  return result;
}

/**
 * What precedes `node` in its scroll column and lies within `band`: the earlier siblings of `node`
 * and of each of its ancestors, up to the page content or overlay scroller — the rows above a row,
 * the heading and forms above a table, the console's rail. They move when a shrinking block makes
 * the browser clamp the scroll offset (the page scrolled to its end): everything above it drops by
 * the clamp. A sticky box is left out with the rest, since it does not move with the page.
 */
export function precedersOf(node: Element, band: { top: number; bottom: number }): HTMLElement[] {
  const result: HTMLElement[] = [];
  for (let current: Element | null = node; current && !isMotionBoundary(current); current = current.parentElement) {
    for (let sibling = current.previousElementSibling; sibling; sibling = sibling.previousElementSibling) {
      if (!(sibling instanceof HTMLElement)) continue;
      if (sibling.hasAttribute('data-tab-pane') && insideConcealedPane(sibling)) continue;
      const rect = sibling.getBoundingClientRect();
      if (rect.height === 0 || rect.bottom < band.top || rect.top > band.bottom) continue;
      const position = getComputedStyle(sibling).position;
      if (position === 'absolute' || position === 'fixed' || position === 'sticky') continue;
      result.push(sibling);
    }
  }
  return result;
}

/** The vertical offset an element is drawn at by its `transform` — a running move (0 without one). */
export function drawnOffsetY(el: Element): number {
  const transform = getComputedStyle(el).transform;
  return transform && transform !== 'none' ? new DOMMatrixReadOnly(transform).m42 : 0;
}
