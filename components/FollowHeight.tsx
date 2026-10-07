'use client';

import { Component, type ReactNode } from 'react';
import { motionTier } from '@/lib/appearance';
import type { SpringName } from '@/lib/spring';
import { springTiming } from '@/lib/springTiming';

interface FollowHeightProps {
  children: ReactNode;
  className?: string;
  /**
   * The response a change of height takes, one for both directions. `defaultEffects` by default:
   * the response `PresenceList` gives a list's rows and what follows them, so a box around such a
   * list keeps its edge on the content it holds; and critically damped, so a box that two
   * regions resize together (a dialog's body and its action row) never overshoots in one.
   */
  spring?: SpringName;
  /**
   * When given, only a commit that changes this value is followed: for a box whose parent also
   * re-renders for reasons that cannot change its height (a gallery's page turn under a
   * heading), so those commits read no layout here.
   */
  watch?: string | number | boolean | null;
}

/**
 * A box whose height follows what it holds instead of jumping to it — Compose's
 * `animateContentSize`, for a surface whose content changes in place: the docked cart's card and
 * the cart sheet as lines come and go (M1-015), the tag dialog as its entry lands and its two
 * views swap (M1-019, M1-020), a subscription's heading as the line it held for a name goes.
 * Nothing inside is scaled or faded here; that is the content's own business (`PresenceList`,
 * `PresenceBlock`, the pane-swap keyframe).
 *
 * **The old height is held across the commit.** Before React mutates the DOM
 * (`getSnapshotBeforeUpdate`, the one lifecycle that sees the old layout — so a class) the box is
 * pinned at the height it has on screen, a running change included; the children's layout
 * effects then measure against the box as it was. That is what keeps a `PresenceList` inside a
 * bottom-anchored sheet honest: released at once, the sheet's top edge would drop by a removed
 * line in the commit and every row's FLIP would be measured against the wrong box. Then the box
 * is released, its natural height read, and it springs from one to the other, its bottom edge
 * clipped for the run so content laid out at its final size is revealed by the moving edge rather
 * than painted past it — the only edge clipped, so a focus ring or an overhanging control on the
 * other three sides stays whole (`SizeSwap`'s arrangement, `app/upload/SizeSwap.tsx`).
 *
 * Interruptible: a change during a run starts from the height on screen. Under 关闭 it is a cut;
 * under 减弱 it keeps its travel (a box fitting its content is basic motion) on the critically
 * damped shape `springTiming` substitutes.
 *
 * Its sibling for a box that swaps what it shows, rather than changing it in place, is `SizeSwap`
 * (`AnimatedContent`, which also fades the arriving content and knows about the page's end).
 */
export default class FollowHeight extends Component<FollowHeightProps> {
  private node: HTMLDivElement | null = null;
  private readonly setNode = (node: HTMLDivElement | null) => {
    this.node = node;
  };
  private run: Animation | null = null;

  getSnapshotBeforeUpdate(previous: FollowHeightProps): number | null {
    const node = this.node;
    if (!node || motionTier() === 'off') return null;
    if (this.props.watch !== undefined && Object.is(previous.watch, this.props.watch)) return null;
    /* Read with a running change included, then hold it in place of the animation. */
    const from = node.getBoundingClientRect().height;
    this.stop();
    node.style.height = `${from}px`;
    return from;
  }

  componentDidUpdate(_previous: FollowHeightProps, _state: unknown, from: number | null) {
    const node = this.node;
    if (from === null || !node) return;
    node.style.height = '';
    const to = node.getBoundingClientRect().height;
    if (Math.abs(to - from) < 0.5) return;
    node.style.clipPath = 'inset(-100vmax -100vmax 0 -100vmax)';
    const run = node.animate([{ height: `${from}px` }, { height: `${to}px` }], springTiming(this.props.spring ?? 'defaultEffects'));
    const release = () => {
      if (this.run !== run) return;
      this.run = null;
      node.style.clipPath = '';
    };
    run.finished.then(release, release);
    this.run = run;
  }

  componentWillUnmount() {
    this.stop();
  }

  private stop() {
    const run = this.run;
    this.run = null;
    run?.cancel();
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
