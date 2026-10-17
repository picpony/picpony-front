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
  /**
   * Follow every change of the content's height, not only a commit of this component's: for a
   * box whose content is resized outside React — a tab panel whose panes the motion layer shows
   * and conceals by attribute, a pane whose data lands in a child's own commit. A
   * `ResizeObserver` on an inner box reports the new height after layout and before paint, so the
   * box is pinned back at the height on screen and springs from there in the same frame; nothing
   * ever paints at the new height first. The commit path (`getSnapshotBeforeUpdate`) stands down,
   * since the observer already covers every commit.
   *
   * **It moves once, when the content has settled.** While a switch is in flight (a pane flagged
   * `data-tab-pane-leaving`, both panes stacked in one cell) or a placeholder is on screen
   * (`data-page-loading`), the content's height is not the height it will end at: followed, the box
   * grew to the two panes stacked or to a skeleton's length and then shrank back to the section a
   * moment later — up, then down, on every switch. So the box holds the height it had, the content
   * clipped at its bottom edge, and springs once to where the content lands. A hold never outlasts
   * `HOLD_MAX_MS`: a section still loading after that is followed as it is.
   */
  track?: boolean;
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
/** The longest the box keeps its height for content that has not settled (`track`). */
const HOLD_MAX_MS = 1200;

/** A switch in flight, or a placeholder on screen, inside `root`. */
function unsettled(root: HTMLElement): boolean {
  if (root.querySelector('[data-tab-pane-leaving]')) return true;
  for (const node of root.querySelectorAll<HTMLElement>('[data-page-loading]')) {
    /* A concealed pane keeps its subtree, placeholders included; only one on screen counts. */
    if (typeof node.checkVisibility !== 'function' || node.checkVisibility()) return true;
  }
  return false;
}

export default class FollowHeight extends Component<FollowHeightProps> {
  private node: HTMLDivElement | null = null;
  private readonly setNode = (node: HTMLDivElement | null) => {
    this.node = node;
  };
  private run: Animation | null = null;
  private inner: HTMLDivElement | null = null;
  private readonly setInner = (node: HTMLDivElement | null) => {
    this.inner = node;
  };
  private observer: ResizeObserver | null = null;
  /** The content's height the box last settled on (`track`). */
  private settled: number | null = null;
  /** `track`: the box is holding its height for content that has not settled. */
  private holding = false;
  private holdTimer: ReturnType<typeof setTimeout> | null = null;
  private holdFrame = 0;
  private mutations: MutationObserver | null = null;

  componentDidMount() {
    if (this.props.track) this.observe();
  }

  /**
   * `track`: the content box is observed and the outer box follows it. At rest the outer box is
   * `auto`, so by the time the observer is told the layout already holds the new height; the run
   * starts from the height that was on screen (the running one, mid-run), before that frame paints.
   */
  private observe() {
    const inner = this.inner;
    if (!inner || typeof ResizeObserver === 'undefined') return;
    this.settled = inner.getBoundingClientRect().height;
    const observer = new ResizeObserver((entries) => {
      const entry = entries[entries.length - 1];
      const node = this.node;
      if (!entry || !node) return;
      const to = entry.borderBoxSize?.[0]?.blockSize ?? entry.contentRect.height;
      if (motionTier('list') === 'off') {
        this.settled = to;
        this.endHold();
        return this.stop();
      }
      if (this.holding) {
        if (!unsettled(inner)) this.release();
        return;
      }
      const from = this.run ? node.getBoundingClientRect().height : this.settled;
      this.settled = to;
      if (from === null) return this.stop();
      if (Math.abs(to - from) < 0.5) return;
      if (unsettled(inner)) return this.hold(node, inner, from);
      this.stop();
      /* Pinned inline as well as animated: the observer's own re-layout then lays the page out at
         the old height in this frame, whatever the engine does with an animation created this late. */
      node.style.height = `${from}px`;
      this.animate(node, from, to);
    });
    observer.observe(inner);
    this.observer = observer;
  }

  /**
   * Keep the box at `height` until the content settles. The end of a switch and a placeholder's
   * replacement usually resize the content, which the resize observer reports; one that lands at
   * the same height does not, so the flags and the placeholders are watched as well.
   */
  private hold(node: HTMLDivElement, inner: HTMLDivElement, height: number) {
    this.stop();
    this.holding = true;
    node.style.height = `${height}px`;
    node.style.clipPath = 'inset(-100vmax -100vmax 0 -100vmax)';
    this.holdTimer = setTimeout(() => this.release(), HOLD_MAX_MS);
    if (typeof MutationObserver === 'undefined') return;
    const mutations = new MutationObserver(() => {
      if (this.holdFrame) return;
      this.holdFrame = requestAnimationFrame(() => {
        this.holdFrame = 0;
        if (this.holding && !unsettled(inner)) this.release();
      });
    });
    mutations.observe(inner, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ['data-tab-pane-leaving', 'data-page-loading'],
    });
    this.mutations = mutations;
  }

  /** The content has settled (or the hold ran out): spring from the held height to it. */
  private release() {
    const node = this.node;
    const inner = this.inner;
    const wasHolding = this.holding;
    this.endHold();
    if (!wasHolding || !node || !inner) return;
    const from = node.getBoundingClientRect().height;
    node.style.height = '';
    const to = inner.getBoundingClientRect().height;
    this.settled = to;
    if (Math.abs(to - from) < 0.5) {
      node.style.clipPath = '';
      return;
    }
    node.style.height = `${from}px`;
    this.animate(node, from, to);
  }

  private endHold() {
    this.holding = false;
    if (this.holdTimer) clearTimeout(this.holdTimer);
    this.holdTimer = null;
    if (this.holdFrame) cancelAnimationFrame(this.holdFrame);
    this.holdFrame = 0;
    this.mutations?.disconnect();
    this.mutations = null;
  }

  getSnapshotBeforeUpdate(previous: FollowHeightProps): number | null {
    const node = this.node;
    if (!node || this.props.track || motionTier('list') === 'off') return null;
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
    this.animate(node, from, to);
  }

  private animate(node: HTMLDivElement, from: number, to: number) {
    node.style.clipPath = 'inset(-100vmax -100vmax 0 -100vmax)';
    const run = node.animate([{ height: `${from}px` }, { height: `${to}px` }], springTiming(this.props.spring ?? 'defaultEffects', 'list'));
    const release = () => {
      if (this.run !== run) return;
      this.run = null;
      node.style.clipPath = '';
      if (this.props.track) node.style.height = '';
    };
    run.finished.then(release, release);
    this.run = run;
  }

  componentWillUnmount() {
    this.observer?.disconnect();
    this.observer = null;
    this.endHold();
    this.stop();
  }

  private stop() {
    const run = this.run;
    this.run = null;
    run?.cancel();
    if (this.node) {
      this.node.style.clipPath = '';
      if (this.props.track) this.node.style.height = '';
    }
  }

  render() {
    return (
      <div ref={this.setNode} className={this.props.className}>
        {this.props.track ? <div ref={this.setInner}>{this.props.children}</div> : this.props.children}
      </div>
    );
  }
}
