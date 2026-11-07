'use client';

import { noteHeroInteraction } from './input';
import { heroFrameScheduler } from './scheduler';
import { takeOverHeroReturnInput, type HeroReturnInput } from './returnInput';
import { clamp } from '@/lib/utils';

const SCROLL_EPSILON_PX = 0.25;
const WHEEL_RESIDUAL_RESPONSE_MS = 24;
const WHEEL_SOURCE_SUPPRESSION_MS = 240;

export type HeroScrollOffset = { left: number; top: number };

type ScrollListener = {
  element: HTMLElement;
  listener: () => void;
  inputListener?: (event: Event) => void;
};

type DeltaListener = ScrollListener & {
  left: number;
  top: number;
  suppressScrollUntil: number;
  wheelListener: (event: WheelEvent) => void;
  lineHeight: number;
  pageHeight: number;
};

type InputSource = Pick<DeltaListener, 'element' | 'lineHeight' | 'pageHeight'>;

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
  private inputTarget: HTMLElement | null = null;
  private nativeInput = false;
  private transferListeners = new Set<() => void>();
  private released = false;
  private readonly residualFrameOwner = {};
  private pendingResidualLeft = 0;
  private pendingResidualTop = 0;
  private residualTargetLeft: number | null = null;
  private residualTargetTop: number | null = null;
  private residualSampleAt = 0;
  private wheelRemainderLeft = 0;
  private wheelRemainderTop = 0;
  private pendingTouchLeft = 0;
  private pendingTouchTop = 0;
  private touchTargetLeft: number | null = null;
  private touchTargetTop: number | null = null;
  private returnInput: HeroReturnInput | null = null;
  private inputSource: InputSource | null = null;
  private returnManaged = false;
  private retired: (() => void) | null = null;

  constructor(primary: HTMLElement) {
    this.replacePeers(primary);
  }

  /** The visible receiver, as distinct from the last peer that happened to scroll. */
  setInputTarget(element: HTMLElement, initial?: HeroScrollOffset) {
    // A final input on the outgoing peer may have removed this pending receiver while
    // the controller waited for the reveal frame. Reattach before declaring it live.
    if (!this.peers.has(element)) this.addPeer(element, initial);
    if (this.inputTarget === element) return;
    this.inputTarget = element;
    this.nativeInput = false;
  }

  get hasNativeInput() {
    return this.nativeInput;
  }

  /** A latched stream is already being carried safely, so visual/history teardown can proceed. */
  get canCompleteReturn() {
    return this.returnManaged;
  }

  takeOverReturnInput(source: HTMLElement) {
    if (this.released || this.returnInput || !this.primary) return;
    const dimensions = this.deltaSources.get(source);
    if (!dimensions) return;
    const input = takeOverHeroReturnInput({
      source, destination: this.primary,
      lineHeight: dimensions.lineHeight, pageHeight: dimensions.pageHeight,
      onWheel: (left, top) => this.queueWheelResidual(left, top),
      onTouch: (left, top) => {
        this.pendingTouchLeft += left;
        this.pendingTouchTop += top;
        if (Math.abs(this.pendingTouchLeft) >= SCROLL_EPSILON_PX || Math.abs(this.pendingTouchTop) >= SCROLL_EPSILON_PX) this.scheduleWheelResidual();
      },
      onEnd: (reason) => {
        if (this.returnInput !== input) return;
        this.returnInput = null;
        this.inputSource = null;
        if (reason === 'superseded') this.resetWheelResidual();
        this.finishRetired();
      },
    });
    this.returnInput = input;
    if (input) {
      this.inputSource = dimensions;
      this.returnManaged = true;
      this.clearDeltaSources();
    }
  }

  /** A close can follow an opening handoff before its original wheel stream has ended. */
  transferInputTo(next: HeroScrollContinuity) {
    const source = this.inputSource;
    this.release();
    if (!source) return;
    next.addDeltaSource(source.element, source);
    next.takeOverReturnInput(source.element);
  }

  /** Keep only the current input lease alive after its visual session has closed. */
  retire(onReleased: () => void) {
    if (this.released) { onReleased(); return; }
    this.retired = onReleased;
    this.clearDeltaSources();
    this.finishRetired();
  }

  stopReturnInput() {
    this.returnInput?.release();
  }

  private finishRetired() {
    if (this.retired && !this.returnInput && !this.hasWheelResidual()) this.release();
  }

  waitForNativeInput(signal: AbortSignal) {
    if (signal.aborted || this.released) return Promise.resolve(false);
    if (this.nativeInput) return Promise.resolve(true);
    return new Promise<boolean>((resolve) => {
      const finish = () => {
        this.transferListeners.delete(finish);
        signal.removeEventListener('abort', finish);
        resolve(this.nativeInput && !signal.aborted && !this.released);
      };
      this.transferListeners.add(finish);
      signal.addEventListener('abort', finish, { once: true });
    });
  }

  private claimNativeInput(element: HTMLElement) {
    if (this.released || element !== this.inputTarget || this.nativeInput) return;
    // Claim on input, BEFORE its first scroll event. A queued residual write can otherwise
    // cancel the browser's new wheel/touch scroll before there is a foreign scroll to detect.
    this.nativeInput = true;
    this.stopReturnInput();
    if (this.released) return;
    this.releaseDeltaSources();
    this.primary = element;
    for (const peer of this.peers.keys()) {
      if (peer !== element) this.removePeer(peer);
    }
    this.transferListeners.forEach((notify) => notify());
  }

  addPeer(element: HTMLElement, initial?: HeroScrollOffset) {
    if (this.released || this.peers.has(element)) return;
    this.removeDeltaSource(element);
    const listener = () => {
      // A scroll on the destination that we did not write is the user taking
      // over. That is the signal the transfer is complete: anything still
      // arriving from an outgoing scroller is now stale.
      if (element === this.inputTarget && this.isForeignScroll(element)) {
        this.claimNativeInput(element);
      }
      this.syncFrom(element);
    };
    const inputListener = (event: Event) => {
      if (event instanceof WheelEvent && event.ctrlKey) return;
      if (event instanceof WheelEvent && this.returnInput?.ownsWheel(event)) return;
      this.claimNativeInput(element);
    };
    this.peers.set(element, { element, listener, inputListener });
    element.addEventListener('scroll', listener, { passive: true });
    element.addEventListener('wheel', inputListener, { passive: true, capture: true });
    element.addEventListener('pointerdown', inputListener, { passive: true, capture: true });
    element.addEventListener('touchstart', inputListener, { passive: true, capture: true });

    const source = this.primary;
    if (source && source !== element) {
      this.writePosition(element, source.scrollLeft, source.scrollTop);
    } else {
      this.primary = element;
      // Baseline the destination so a forwarded delta is not mistaken for the
      // user's own scroll on the very first event.
      this.recordWrite(element, initial);
    }
  }

  replacePeers(element: HTMLElement, initial?: HeroScrollOffset) {
    if (this.released) return;
    this.stopReturnInput();
    if (this.released) return;
    this.returnManaged = false;
    this.resetWheelResidual();
    this.clearPeers();
    this.primary = element;
    this.inputTarget = null;
    this.setInputTarget(element, initial);
  }

  removePeer(element: HTMLElement) {
    const state = this.peers.get(element);
    if (!state) return;
    element.removeEventListener('scroll', state.listener);
    if (state.inputListener) {
      element.removeEventListener('wheel', state.inputListener, true);
      element.removeEventListener('pointerdown', state.inputListener, true);
      element.removeEventListener('touchstart', state.inputListener, true);
    }
    this.peers.delete(element);
    if (this.primary === element) {
      this.primary = this.peers.keys().next().value ?? null;
    }
  }

  addDeltaSource(element: HTMLElement, initial?: Pick<InputSource, 'lineHeight' | 'pageHeight'>) {
    if (this.released || this.returnInput || this.peers.has(element) || this.deltaSources.has(element)) return;
    const computedLineHeight = initial?.lineHeight ?? Number.parseFloat(getComputedStyle(element).lineHeight);
    const lineHeight = Number.isFinite(computedLineHeight) ? computedLineHeight : 16;
    const pageHeight = initial?.pageHeight ?? Math.max(1, element.clientHeight);
    const state: DeltaListener = {
      element,
      left: element.scrollLeft,
      top: element.scrollTop,
      suppressScrollUntil: 0,
      lineHeight,
      pageHeight,
      wheelListener: (event) => {
        if (this.released || event.ctrlKey) return;
        const unit =
          event.deltaMode === WheelEvent.DOM_DELTA_LINE
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
        if (Math.abs(deltaLeft) < SCROLL_EPSILON_PX && Math.abs(deltaTop) < SCROLL_EPSILON_PX)
          return;
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
    if (this.deltaSources.size === 0 && !this.hasWheelResidual() && !this.wheelRemainderLeft && !this.wheelRemainderTop) return;
    this.resetWheelResidual();
    this.clearDeltaSources();
  }

  private clearDeltaSources() {
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
    this.returnInput?.release();
    this.returnInput = null;
    this.inputSource = null;
    this.resetWheelResidual();
    this.clearPeers();
    this.deltaSources.forEach(({ element, listener, wheelListener }) => {
      element.removeEventListener('wheel', wheelListener);
      element.removeEventListener('scroll', listener);
    });
    this.deltaSources.clear();
    this.primary = null;
    this.inputTarget = null;
    this.transferListeners.forEach((notify) => notify());
    this.transferListeners.clear();
    const retired = this.retired;
    this.retired = null;
    retired?.();
  };

  private clearPeers() {
    for (const element of this.peers.keys()) this.removePeer(element);
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
   * browser clamps to the scrollable range. An adoption may pass the offset it measured and
   * clamped before its DOM writes, avoiding a synchronous layout in the reveal frame.
   */
  private recordWrite(element: HTMLElement, initial?: HeroScrollOffset) {
    this.written.set(element, initial ?? { left: element.scrollLeft, top: element.scrollTop });
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
    if (Math.abs(left) < SCROLL_EPSILON_PX && Math.abs(top) < SCROLL_EPSILON_PX) return;
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
    this.writePosition(target, target.scrollLeft + left, target.scrollTop + top);
    this.syncFrom(target);
  }

  private queueWheelResidual(left: number, top: number) {
    if (left === 0 && top === 0) return;
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
    if (this.released || !measurement || measurement.target !== this.primary) {
      this.resetWheelResidual();
      return;
    }

    // A DOM wheel target is not a compositor handoff. An offset changed by another owner is.
    if (this.returnManaged && measurement.target === this.inputTarget && this.isForeignScroll(measurement.target)) {
      this.claimNativeInput(measurement.target);
      return;
    }
    if (Math.abs(this.pendingTouchLeft) >= SCROLL_EPSILON_PX || Math.abs(this.pendingTouchTop) >= SCROLL_EPSILON_PX) {
      const left = clamp((this.touchTargetLeft ?? measurement.left) + this.pendingTouchLeft, 0, measurement.maxLeft);
      const top = clamp((this.touchTargetTop ?? measurement.top) + this.pendingTouchTop, 0, measurement.maxTop);
      // Keep fractional drag distance even when the browser quantizes its scroll offset.
      this.touchTargetLeft = left;
      this.touchTargetTop = top;
      this.pendingTouchLeft = 0;
      this.pendingTouchTop = 0;
      this.writeResidual(measurement, left, top);
      this.finishRetired();
      return;
    }

    const startLeft = this.residualTargetLeft ?? measurement.left;
    const startTop = this.residualTargetTop ?? measurement.top;
    this.residualTargetLeft = clamp(startLeft + this.pendingResidualLeft + this.wheelRemainderLeft, 0, measurement.maxLeft);
    this.residualTargetTop = clamp(startTop + this.pendingResidualTop + this.wheelRemainderTop, 0, measurement.maxTop);
    this.wheelRemainderLeft = 0;
    this.wheelRemainderTop = 0;
    this.pendingResidualLeft = 0;
    this.pendingResidualTop = 0;

    const elapsed = clamp(measurement.at - (this.residualSampleAt || measurement.at), 1, 48);
    this.residualSampleAt = measurement.at;
    const amount = 1 - Math.exp(-elapsed / WHEEL_RESIDUAL_RESPONSE_MS);
    let nextLeft = measurement.left + (this.residualTargetLeft - measurement.left) * amount;
    let nextTop = measurement.top + (this.residualTargetTop - measurement.top) * amount;

    if (Math.abs(this.residualTargetLeft - nextLeft) < SCROLL_EPSILON_PX) {
      nextLeft = this.residualTargetLeft;
    }
    if (Math.abs(this.residualTargetTop - nextTop) < SCROLL_EPSILON_PX) {
      nextTop = this.residualTargetTop;
    }

    this.writeResidual(measurement, nextLeft, nextTop);

    if (
      Math.abs(this.residualTargetLeft - nextLeft) >= SCROLL_EPSILON_PX ||
      Math.abs(this.residualTargetTop - nextTop) >= SCROLL_EPSILON_PX ||
      Math.abs(this.pendingResidualLeft) >= SCROLL_EPSILON_PX ||
      Math.abs(this.pendingResidualTop) >= SCROLL_EPSILON_PX
    ) {
      this.scheduleWheelResidual();
      return;
    }
    // Native scroll offsets can round below one device pixel. Preserve that remainder for
    // the next packet instead of filtering out a slow high-resolution wheel stream.
    const written = this.written.get(measurement.target)!;
    const remainderLeft = this.residualTargetLeft - written.left;
    const remainderTop = this.residualTargetTop - written.top;
    this.resetWheelResidual();
    this.wheelRemainderLeft = remainderLeft;
    this.wheelRemainderTop = remainderTop;
    this.finishRetired();
  }

  private writeResidual(measurement: ResidualMeasurement, nextLeft: number, nextTop: number) {
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
  }

  private hasWheelResidual() {
    return (
      this.residualTargetLeft !== null ||
      Math.abs(this.pendingResidualLeft) >= SCROLL_EPSILON_PX ||
      Math.abs(this.pendingResidualTop) >= SCROLL_EPSILON_PX ||
      Math.abs(this.pendingTouchLeft) >= SCROLL_EPSILON_PX ||
      Math.abs(this.pendingTouchTop) >= SCROLL_EPSILON_PX
    );
  }

  private resetWheelResidual() {
    heroFrameScheduler.cancel(this.residualFrameOwner);
    this.pendingResidualLeft = 0;
    this.pendingResidualTop = 0;
    this.pendingTouchLeft = 0;
    this.pendingTouchTop = 0;
    this.touchTargetLeft = null;
    this.touchTargetTop = null;
    this.residualTargetLeft = null;
    this.residualTargetTop = null;
    this.residualSampleAt = 0;
    this.wheelRemainderLeft = 0;
    this.wheelRemainderTop = 0;
  }
}
