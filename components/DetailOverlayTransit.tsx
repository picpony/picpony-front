'use client';

import { Component, type ReactNode } from 'react';
import { captureDetailExit, forgetDetailExit, playDetailExit, type DetailExitSnapshot } from '@/lib/detailTransit';
import { getImageHeroRuntime, subscribeImageHeroRuntime } from '@/lib/hero/runtime';

interface Props {
  /** Whether the intercepted picture overlay is what the slot renders. */
  open: boolean;
  children: ReactNode;
}

/**
 * Around the picture overlay's slot: takes a copy of the overlay as it closes, so a close that
 * nothing flies home still leaves (`lib/detailTransit.ts`) — back into the history row it came
 * from, or faded out — instead of vanishing in one frame.
 *
 * **As soon as the close starts, not when the overlay unmounts.** A flightless close goes straight
 * from `detail-idle` to `gallery-idle`, and the hero seals the overlay in that step — but the
 * router may still have a round trip to make before it commits the list, and for all of it the
 * bare list showed, after which the copy popped back full size to shrink (M1-041). So the exit is
 * played at that phase change; the commit that later removes the overlay finds it played. When the
 * commit comes first (the router answered from its cache), the copy is taken in it, as before.
 *
 * A class component for the reason `RouteCrossFade` is one: `getSnapshotBeforeUpdate` is the only
 * lifecycle that runs before the commit's DOM mutations, while the overlay is still laid out. It
 * renders its children and no element of its own.
 */
export default class DetailOverlayTransit extends Component<Props> {
  private phase = getImageHeroRuntime().phase;
  private stop: (() => void) | null = null;

  componentDidMount() {
    this.phase = getImageHeroRuntime().phase;
    this.stop = subscribeImageHeroRuntime(this.onRuntime);
  }

  componentWillUnmount() {
    this.stop?.();
    this.stop = null;
  }

  private onRuntime = () => {
    const previous = this.phase;
    const { phase } = getImageHeroRuntime();
    this.phase = phase;
    if (phase === 'detail-idle' && previous !== 'detail-idle') forgetDetailExit();
    if (previous !== 'detail-idle' || phase !== 'gallery-idle' || !this.props.open) return;
    const exit = captureDetailExit();
    if (exit) playDetailExit(exit);
  };

  getSnapshotBeforeUpdate(prev: Props): DetailExitSnapshot | null {
    return prev.open && !this.props.open ? captureDetailExit() : null;
  }

  componentDidUpdate(_prev: Props, _state: unknown, snapshot: DetailExitSnapshot | null) {
    if (snapshot) playDetailExit(snapshot);
  }

  render() {
    return this.props.children;
  }
}
