'use client';

import { Component, type ReactNode } from 'react';
import { getAppScroller } from '@/lib/appScroller';
import { motionTier, scaledMs } from '@/lib/appearance';
import { EASE, PAGE_FADE_TIMING } from '@/lib/motionTokens';
import type { SpringName } from '@/lib/spring';
import { springTiming } from '@/lib/springTiming';
import { clamp } from '@/lib/utils';

interface SizeSwapProps {
  /** What the box is showing. A new key is a new content: the box resizes to it and it fades in. */
  contentKey: string;
  /** One element: the one that fades in. */
  children: ReactNode;
  /**
   * The responses per direction — by default the drawer's pair, a panel opening and closing in
   * place. A box whose change is a whole screen's takes a slower one for the shrink: still an
   * effects spring, since overshoot would bounce everything under it, but what it brings into view
   * (the page's own end) should arrive, not appear.
   */
  grow?: SpringName;
  shrink?: SpringName;
  /**
   * The box is the last thing on its page. A page shorter than the view keeps its end — the
   * footer — at the bottom of the screen, so a shrink under the height where the two meet moves
   * nothing, and the box springs only down to there.
   */
  endsPage?: boolean;
  className?: string;
}

/**
 * A box that changes what it shows without the page jumping: Compose's `AnimatedContent` with its
 * size transform, for /upload's two swaps — the drop zone's prompt for a picked file's preview
 * (M1-025, where the form under it jumped 381px in a frame), and the form for its result (M1-026).
 *
 * **Its height travels and its content fades; nothing is scaled.** Before the commit the box's
 * height is read (`getSnapshotBeforeUpdate`, the one lifecycle that sees the old DOM — so a
 * class, as `PresenceList`); after it the box springs from that height to its new one — across
 * the part of the change on screen (`visibleTravel`) — and everything after it on the page moves
 * with its edge because it is in the flow. By default it
 * grows on `DefaultSpatial` and shrinks on `FastEffects`, the drawer's pair per direction (a panel
 * opening and closing in place). The new content is laid out at its final size from the first
 * frame and revealed by the moving bottom edge, which is the only edge clipped — a remove control
 * hanging off a preview's corner stays whole. It fades in on the page fade's split (a pane swap's,
 * as `AuthModal` swaps its steps), so the old content is gone at once and the new arrives as the
 * box opens.
 *
 * Interruptible: the height read before a commit includes a running move, so a second swap starts
 * from where the box is on screen. Under 关闭 the swap is a cut; under 减弱 the springs lose their
 * overshoot (`springTiming`) and the fade stays.
 */
export default class SizeSwap extends Component<SizeSwapProps> {
  private node: HTMLDivElement | null = null;
  private readonly setNode = (node: HTMLDivElement | null) => {
    this.node = node;
  };
  private resize: Animation | null = null;
  private fade: Animation | null = null;

  getSnapshotBeforeUpdate(previous: SizeSwapProps): number | null {
    if (previous.contentKey === this.props.contentKey || !this.node || motionTier() === 'off') return null;
    return this.node.getBoundingClientRect().height;
  }

  componentDidUpdate(_previous: SizeSwapProps, _state: unknown, from: number | null) {
    const node = this.node;
    if (from === null || !node) return;
    this.stop();
    /* The cancel above dropped any running height, so this is the new content's own. */
    const to = node.getBoundingClientRect().height;
    const [start, end] = this.visibleTravel(node, from, to);
    if (Math.abs(end - start) >= 1) {
      node.style.clipPath = 'inset(-100vmax -100vmax 0 -100vmax)';
      const { grow = 'defaultSpatial', shrink = 'fastEffects' } = this.props;
      const resize = node.animate([{ height: `${start}px` }, { height: `${end}px` }], springTiming(to > from ? grow : shrink));
      const release = () => {
        if (this.resize !== resize) return;
        this.resize = null;
        node.style.clipPath = '';
      };
      resize.finished.then(release, release);
      this.resize = resize;
    }
    const content = node.firstElementChild;
    if (content instanceof HTMLElement) {
      this.fade = content.animate([{ opacity: 0 }, { opacity: 1 }], {
        delay: scaledMs(PAGE_FADE_TIMING.delay * 1000),
        duration: scaledMs(PAGE_FADE_TIMING.duration * 1000),
        easing: EASE.decelerate,
        fill: 'backwards',
      });
    }
  }

  componentWillUnmount() {
    this.stop();
  }

  /**
   * The part of a resize anyone can see, as the pair of heights the box springs between. Below
   * the bottom of the scroller's view the box's edge moves nothing on screen, and neither does a
   * shrink under the page's floor (`endsPage`). Springing the whole difference spent the visible
   * part at the spring's peak speed — the success swap brought the footer 220px into view in one
   * frame and stopped it dead at its floor — so the box springs across this range alone, from
   * rest to rest, and takes its own height when the move ends, where nothing on screen changes.
   */
  private visibleTravel(node: HTMLElement, from: number, to: number): [number, number] {
    const scroller = getAppScroller();
    if (!scroller) return [from, to];
    const top = node.getBoundingClientRect().top;
    const view = Math.max(0, scroller.getBoundingClientRect().top + scroller.clientHeight - top);
    let floor = 0;
    const column = this.props.endsPage && to < from ? node.closest('[data-page-content] > *') : null;
    if (column) {
      /* The free space under the page's content once the box has its new height: what the shell's
         column stretches by to keep the footer at the bottom of the screen. */
      const content = Math.max(...Array.from(column.children, (child) => child.getBoundingClientRect().bottom));
      floor = Math.min(view, to + Math.max(0, column.getBoundingClientRect().bottom - content));
    }
    return [clamp(from, floor, view), clamp(to, floor, view)];
  }

  private stop() {
    this.resize?.cancel();
    this.fade?.cancel();
    this.resize = null;
    this.fade = null;
    if (this.node) this.node.style.clipPath = '';
  }

  render() {
    return (
      <div ref={this.setNode} className={this.props.className}>
        {this.props.children}
      </div>
    );
  }
}
