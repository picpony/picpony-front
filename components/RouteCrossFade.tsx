'use client';

import { Component, createRef } from 'react';
import {
  cancelRouteCrossFade,
  captureRouteSnapshot,
  playRouteCrossFade,
} from '@/lib/routeCrossFade';
import type { RouteSnapshot } from '@/lib/pageSnapshot';

interface Props {
  /** The value whose change means "the page underneath was replaced". */
  pathname: string;
  enabled: boolean;
}

/**
 * Holds the layer the outgoing page is cross-faded on, and takes the snapshot
 * at the one moment it still exists.
 *
 * A class component, deliberately: `getSnapshotBeforeUpdate` is the only React
 * lifecycle that runs *before* the DOM mutations of a commit — exactly when the
 * old page is still mounted and laid out. `useLayoutEffect` fires after the
 * mutation phase, too late, and reading the DOM during render is impure.
 *
 * The layer renders with no children; everything inside it is appended
 * imperatively, so React never reconciles it.
 */
export default class RouteCrossFade extends Component<Props> {
  private layerRef = createRef<HTMLDivElement>();

  getSnapshotBeforeUpdate(prev: Props): RouteSnapshot | null {
    if (prev.pathname === this.props.pathname || !this.props.enabled) return null;
    return captureRouteSnapshot(this.layerRef.current);
  }

  componentDidUpdate(prev: Props, _state: unknown, snapshot: RouteSnapshot | null) {
    if (snapshot && this.layerRef.current) {
      playRouteCrossFade(this.layerRef.current, snapshot, prev.pathname, this.props.pathname);
    } else if (prev.pathname !== this.props.pathname) {
      // A cut (motion off, an oversized page, or an unavailable engine) still
      // replaces the old page. Its earlier clone must not linger over the new one.
      cancelRouteCrossFade();
    }
  }

  componentWillUnmount() {
    cancelRouteCrossFade();
  }

  render() {
    return (
      <div
        ref={this.layerRef}
        data-route-crossfade-layer
        aria-hidden="true"
        inert
        /* `pointer-events-none` is load-bearing: without it a wheel or touch
           during the fade is swallowed by a dead frame instead of reaching the
           scroller underneath. Stacks above page content, below the tab pill,
           hero stage and flight layer. */
        className="pointer-events-none absolute inset-0 z-20 overflow-hidden"
      />
    );
  }
}
