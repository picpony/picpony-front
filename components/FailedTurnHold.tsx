'use client';

import { Component, type RefObject } from 'react';
import { getAppScroller, heroOwnsScreen } from '@/lib/appScroller';

/**
 * **A failed page turn's message must be seen, and must not move what is under the viewer.** A
 * paged list shows that message above its rows the moment a turn fails (`isPrevious && error`:
 * the rows are the page before it), and what inserting it does depends on where the viewer is.
 *
 * At the list's top — where the pager's glide lands — scroll anchoring holds the rows still and so
 * puts the message out of sight above them. There the message is what to see: step back to it.
 *
 * Inside a masonry grid, anchoring holds nothing — the cards are absolutely placed, and once the
 * grid's top has scrolled away the browser finds no anchor in it — so the insertion pushed every
 * card under the viewer down by its height. There the rows are what to keep: scroll by however far
 * they moved, which is zero wherever the browser did anchor.
 *
 * A class for `getSnapshotBeforeUpdate`, the one phase that runs before React inserts the message:
 * the rows are measured there once, and again in `componentDidUpdate`, after any anchoring
 * adjustment, so the correction lands before the frame is painted. Render it as a sibling after
 * the rows. (The home feed's `PagedImages` carries the first copy of this; the two are one rule.)
 */
export default class FailedTurnHold extends Component<{
  failed: boolean;
  rows: HTMLElement | null;
  failure: RefObject<HTMLElement | null>;
}> {
  getSnapshotBeforeUpdate(previous: { failed: boolean }): { before: number } | null {
    const { failed, rows } = this.props;
    if (previous.failed || !failed || !rows || heroOwnsScreen()) return null;
    const scroller = rows.closest<HTMLElement>('[data-app-scroll-container]') ?? getAppScroller();
    if (!scroller) return null;
    return { before: rows.getBoundingClientRect().top - scroller.getBoundingClientRect().top };
  }

  componentDidUpdate(_previous: unknown, _state: unknown, snapshot: { before: number } | null) {
    const rows = this.props.rows;
    const failure = this.props.failure.current;
    if (!snapshot || !rows || !failure) return;
    const scroller = rows.closest<HTMLElement>('[data-app-scroll-container]') ?? getAppScroller();
    if (!scroller) return;
    const view = scroller.getBoundingClientRect();
    const { before } = snapshot;
    if (before > -24 && before < view.height) {
      /* The list's top was on screen: show the message, 8px under the edge like the glide. */
      const top = failure.getBoundingClientRect().top - view.top;
      if (top < 0) scroller.scrollTop -= 8 - top;
      return;
    }
    if (before > 0) return;
    const moved = rows.getBoundingClientRect().top - view.top - before;
    if (Math.abs(moved) > 1) scroller.scrollTop += moved;
  }

  render() {
    return null;
  }
}
