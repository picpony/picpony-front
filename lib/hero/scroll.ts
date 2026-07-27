'use client';

import { noteHeroInteraction } from './input';
import { heroFrameScheduler } from './scheduler';

const SCROLL_EPSILON_PX = 0.25;
const WHEEL_RESIDUAL_RESPONSE_MS = 24;
const WHEEL_SOURCE_SUPPRESSION_MS = 240;

type ScrollListener = {
  element: HTMLElement;
  listener: () => void;
};

type DeltaListener = ScrollListener & {
  left: number;
  top: number;
  suppressScrollUntil: number;
  wheelListener: (event: WheelEvent) => void;
};

type ResidualMeasurement = {
  target: HTMLElement;
  left: number;
  top: number;
  maxLeft: number;
  maxTop: number;
  at: number;
};

/**
 * Keeps equivalent Hero scrollers in lockstep and carries residual movement
 * from a browser-latched, outgoing scroller into the current native owner.
 */
export class HeroScrollContinuity {
  private peers = new Map<HTMLElement, ScrollListener>();
  private deltaSources = new Map<HTMLElement, DeltaListener>();
  /** Last position this instance wrote, per scroller, to attribute scrolls. */
  private written = new WeakMap<HTMLElement, { left: number; top: number }>();
  private primary: HTMLElement | null = null;
  private released = false;
  private readonly residualFrameOwner = {};
  private pendingResidualLeft = 0;
  private pendingResidualTop = 0;
  private residualTargetLeft: number | null = null;
  private residualTargetTop: number | null = null;
  private residualSampleAt = 0;

  constructor(primary: HTMLElement) {
    this.replacePeers(primary);
  }

  addPeer(element: HTMLElement) {
    if (this.released || this.peers.has(element)) return;
    this.removeDeltaSource(element);
    const listener = () => {
      // A scroll on the destination that we did not write is the user taking
      // over. That is the signal the transfer is complete: anything still
      // arriving from an outgoing scroller is now stale.
      if (element === this.primary && this.isForeignScroll(element)) {
        this.releaseDeltaSources();
      }
      this.syncFrom(element);
    };
    this.peers.set(element, { element, listener });
    element.addEventListener('scroll', listener, { passive: true });

    const source = this.primary;
    if (source && source !== element) {
      this.writePosition(element, source.scrollLeft, source.scrollTop);
    } else {
      this.primary = element;
      // Baseline the destination so a forwarded delta is not mistaken for the
      // user's own scroll on the very first event.
      this.recordWrite(element);
    }
  }

  replacePeers(element: HTMLElement) {
    if (this.released) return;
    this.resetWheelResidual();
    this.clearPeers();
    this.primary = element;
    this.addPeer(element);
  }

  removePeer(element: HTMLElement) {
    const state = this.peers.get(element);
    if (!state) return;
    element.removeEventListener('scroll', state.listener);
    this.peers.delete(element);
    if (this.primary === element) {
      this.primary = this.peers.keys().next().value ?? null;
    }
  }

  addDeltaSource(element: HTMLElement) {
    if (this.released || this.peers.has(element) || this.deltaSources.has(element)) return;
    const computedLineHeight = Number.parseFloat(getComputedStyle(element).lineHeight);
    const lineHeight = Number.isFinite(computedLineHeight) ? computedLineHeight : 16;
    const pageHeight = Math.max(1, element.clientHeight);
    const state: DeltaListener = {
      element,
      left: element.scrollLeft,
      top: element.scrollTop,
      suppressScrollUntil: 0,
      wheelListener: (event) => {
        if (this.released || event.ctrlKey) return;
        const unit = event.deltaMode === WheelEvent.DOM_DELTA_LINE
          ? lineHeight
          : event.deltaMode === WheelEvent.DOM_DELTA_PAGE
            ? pageHeight
            : 1;
        // A wheel stream may remain latched to the outgoing scroller after it
        // stops owning the screen. Claim only that stale receiver and carry its
        // residual through the shared frame scheduler; direct scrollTop jumps
        // bypass the browser's wheel curve and feel stepped until a new stream.
        if (event.cancelable) event.preventDefault();
        if (!element.isConnected) noteHeroInteraction();
        state.suppressScrollUntil = performance.now() + WHEEL_SOURCE_SUPPRESSION_MS;
        this.queueWheelResidual(event.deltaX * unit, event.deltaY * unit);
      },
      listener: () => {
        if (this.released) return;
        const nextLeft = element.scrollLeft;
        const nextTop = element.scrollTop;
        const deltaLeft = nextLeft - state.left;
        const deltaTop = nextTop - state.top;
        state.left = nextLeft;
        state.top = nextTop;
        if (performance.now() <= state.suppressScrollUntil) return;
        if (
          Math.abs(deltaLeft) < SCROLL_EPSILON_PX &&
          Math.abs(deltaTop) < SCROLL_EPSILON_PX
        ) return;
        this.applyDelta(deltaLeft, deltaTop);
      },
    };
    this.deltaSources.set(element, state);
    element.addEventListener('wheel', state.wheelListener, { passive: false });
    element.addEventListener('scroll', state.listener, { passive: true });
  }

  removeDeltaSource(element: HTMLElement) {
    const state = this.deltaSources.get(element);
    if (!state) return;
    element.removeEventListener('wheel', state.wheelListener);
    element.removeEventListener('scroll', state.listener);
    this.deltaSources.delete(element);
  }

  /**
   * Stop carrying anything from outgoing scrollers.
   *
   * A dismissed detail view keeps decelerating for as long as a second after the
   * finger leaves. Forwarding that momentum writes the gallery's scroll position
   * from script, which cancels whatever native scroll the user has meanwhile
   * started — the page feels stuck until the invisible scroller finally stops.
   * Once the user is driving the destination directly there is nothing left to
   * rescue, so every source is dropped along with any queued residual.
   */
  releaseDeltaSources() {
    if (this.deltaSources.size === 0 && !this.hasWheelResidual()) return;
    this.resetWheelResidual();
    this.deltaSources.forEach(({ element, listener, wheelListener }) => {
      element.removeEventListener('wheel', wheelListener);
      element.removeEventListener('scroll', listener);
    });
    this.deltaSources.clear();
  }

  sync() {
    if (this.primary) this.syncFrom(this.primary);
  }

  syncFrom(source: HTMLElement) {
    if (this.released || !this.peers.has(source) || !source.isConnected) return;
    this.primary = source;
    const left = source.scrollLeft;
    const top = source.scrollTop;
    this.peers.forEach(({ element }) => {
      if (element !== source && element.isConnected) {
        this.writePosition(element, left, top);
      }
    });
  }

  release = () => {
    if (this.released) return;
    this.released = true;
    this.resetWheelResidual();
    this.clearPeers();
    this.deltaSources.forEach(({ element, listener, wheelListener }) => {
      element.removeEventListener('wheel', wheelListener);
      element.removeEventListener('scroll', listener);
    });
    this.deltaSources.clear();
    this.primary = null;
  };

  private clearPeers() {
    this.peers.forEach(({ element, listener }) => {
      element.removeEventListener('scroll', listener);
    });
    this.peers.clear();
  }

  private writePosition(element: HTMLElement, left: number, top: number) {
    if (Math.abs(element.scrollLeft - left) >= SCROLL_EPSILON_PX) {
      element.scrollLeft = Math.max(0, left);
    }
    if (Math.abs(element.scrollTop - top) >= SCROLL_EPSILON_PX) {
      element.scrollTop = Math.max(0, top);
    }
    this.recordWrite(element);
  }

  /**
   * Remember where we left a scroller so its next scroll event can be
   * attributed. Read back rather than stored from the requested value, since the
   * browser clamps to the scrollable range.
   */
  private recordWrite(element: HTMLElement) {
    this.written.set(element, { left: element.scrollLeft, top: element.scrollTop });
  }

  /** True while any delta source recently saw a real wheel event. */
  private wheelActive() {
    const now = performance.now();
    for (const state of this.deltaSources.values()) {
      if (now <= state.suppressScrollUntil) return true;
    }
    return false;
  }

  /** True when this scroller moved by something other than one of our writes. */
  private isForeignScroll(element: HTMLElement) {
    const written = this.written.get(element);
    if (!written) return true;
    return (
      Math.abs(element.scrollLeft - written.left) >= SCROLL_EPSILON_PX ||
      Math.abs(element.scrollTop - written.top) >= SCROLL_EPSILON_PX
    );
  }

  private applyDelta(left: number, top: number) {
    if (
      Math.abs(left) < SCROLL_EPSILON_PX &&
      Math.abs(top) < SCROLL_EPSILON_PX
    ) return;
    // Touch momentum on an outgoing scroller decays for up to a second. Only a
    // wheel stream is genuinely latched and worth rescuing; forwarding inertial
    // touch deltas would keep overwriting the user's own fresh scroll.
    if (!this.hasWheelResidual() && !this.wheelActive()) {
      this.releaseDeltaSources();
      return;
    }
    if (this.hasWheelResidual()) {
      this.queueWheelResidual(left, top);
      return;
    }
    const target = this.primary;
    if (!target?.isConnected) return;
    this.writePosition(
      target,
      target.scrollLeft + left,
      target.scrollTop + top,
    );
    this.syncFrom(target);
  }

  private queueWheelResidual(left: number, top: number) {
    if (
      Math.abs(left) < SCROLL_EPSILON_PX &&
      Math.abs(top) < SCROLL_EPSILON_PX
    ) return;
    this.pendingResidualLeft += left;
    this.pendingResidualTop += top;
    if (!this.residualSampleAt) this.residualSampleAt = performance.now();
    this.scheduleWheelResidual();
  }

  private scheduleWheelResidual() {
    if (this.released) return;
    heroFrameScheduler.request(this.residualFrameOwner, {
      read: (): ResidualMeasurement | null => {
        const target = this.primary;
        if (!target?.isConnected) return null;
        return {
          target,
          left: target.scrollLeft,
          top: target.scrollTop,
          maxLeft: Math.max(0, target.scrollWidth - target.clientWidth),
          maxTop: Math.max(0, target.scrollHeight - target.clientHeight),
          at: performance.now(),
        };
      },
      write: (measurement) => this.stepWheelResidual(measurement),
    });
  }

  private stepWheelResidual(measurement: ResidualMeasurement | null) {
    if (
      this.released ||
      !measurement ||
      measurement.target !== this.primary
    ) {
      this.resetWheelResidual();
      return;
    }

    const startLeft = this.residualTargetLeft ?? measurement.left;
    const startTop = this.residualTargetTop ?? measurement.top;
    this.residualTargetLeft = Math.min(
      measurement.maxLeft,
      Math.max(0, startLeft + this.pendingResidualLeft),
    );
    this.residualTargetTop = Math.min(
      measurement.maxTop,
      Math.max(0, startTop + this.pendingResidualTop),
    );
    this.pendingResidualLeft = 0;
    this.pendingResidualTop = 0;

    const elapsed = Math.min(
      48,
      Math.max(1, measurement.at - (this.residualSampleAt || measurement.at)),
    );
    this.residualSampleAt = measurement.at;
    const amount = 1 - Math.exp(-elapsed / WHEEL_RESIDUAL_RESPONSE_MS);
    let nextLeft = measurement.left +
      (this.residualTargetLeft - measurement.left) * amount;
    let nextTop = measurement.top +
      (this.residualTargetTop - measurement.top) * amount;

    if (Math.abs(this.residualTargetLeft - nextLeft) < SCROLL_EPSILON_PX) {
      nextLeft = this.residualTargetLeft;
    }
    if (Math.abs(this.residualTargetTop - nextTop) < SCROLL_EPSILON_PX) {
      nextTop = this.residualTargetTop;
    }

    if (Math.abs(nextLeft - measurement.left) >= SCROLL_EPSILON_PX) {
      measurement.target.scrollLeft = nextLeft;
    }
    if (Math.abs(nextTop - measurement.top) >= SCROLL_EPSILON_PX) {
      measurement.target.scrollTop = nextTop;
    }
    // Attribute this frame's write, or the resulting scroll event reads as the
    // user taking over and cuts the residual short.
    this.recordWrite(measurement.target);
    this.peers.forEach(({ element }) => {
      if (element === measurement.target || !element.isConnected) return;
      element.scrollLeft = nextLeft;
      element.scrollTop = nextTop;
      this.recordWrite(element);
    });

    if (
      Math.abs(this.residualTargetLeft - nextLeft) >= SCROLL_EPSILON_PX ||
      Math.abs(this.residualTargetTop - nextTop) >= SCROLL_EPSILON_PX ||
      Math.abs(this.pendingResidualLeft) >= SCROLL_EPSILON_PX ||
      Math.abs(this.pendingResidualTop) >= SCROLL_EPSILON_PX
    ) {
      this.scheduleWheelResidual();
      return;
    }
    this.resetWheelResidual();
  }

  private hasWheelResidual() {
    return this.residualTargetLeft !== null ||
      Math.abs(this.pendingResidualLeft) >= SCROLL_EPSILON_PX ||
      Math.abs(this.pendingResidualTop) >= SCROLL_EPSILON_PX;
  }

  private resetWheelResidual() {
    heroFrameScheduler.cancel(this.residualFrameOwner);
    this.pendingResidualLeft = 0;
    this.pendingResidualTop = 0;
    this.residualTargetLeft = null;
    this.residualTargetTop = null;
    this.residualSampleAt = 0;
  }
}
