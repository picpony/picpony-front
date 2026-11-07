'use client';

import { HERO_INPUT_TRANSFER_QUIET_MS, noteDetachedHeroInput, observeHeroTouchTarget, readHeroScrollInput, subscribeHeroInteraction } from './input';

type EndReason = 'ended' | 'superseded';

export type HeroReturnInput = {
  /** The same wheel stream can hit the gallery in the DOM while still latched elsewhere. */
  ownsWheel: (event: Event) => boolean;
  release: () => void;
};

/**
 * Carry an already-running native stream across removal of its old scroll node. This lease
 * outlives the visual return, but leaves on a fresh gesture, navigation or confirmed native
 * gallery scroll. See docs/hero.md#closing-and-pull.
 */
export function takeOverHeroReturnInput({
  source, destination, lineHeight, pageHeight, onWheel, onTouch, onEnd,
}: {
  source: HTMLElement;
  destination: HTMLElement;
  lineHeight: number;
  pageHeight: number;
  onWheel: (left: number, top: number) => void;
  onTouch: (left: number, top: number) => void;
  onEnd: (reason: EndReason) => void;
}): HeroReturnInput | null {
  const snapshot = readHeroScrollInput();
  const inside = (target: EventTarget | null) => target instanceof Node && source.contains(target);
  const touch = snapshot.touches.length === 1 && inside(snapshot.touches[0].target)
    ? snapshot.touches[0] : null;
  const wheel = snapshot.touches.length === 0 && inside(snapshot.wheel?.target ?? null)
    ? snapshot.wheel : null;
  if (!touch && !wheel) return null;

  let active = true;
  let wheelIdle = 0;
  let x = touch?.clientX ?? 0;
  let y = touch?.clientY ?? 0;
  const handled = new WeakSet<Event>();
  const cleanups: Array<() => void> = [];
  const finish = (reason: EndReason) => {
    if (!active) return;
    active = false;
    if (wheelIdle) window.clearTimeout(wheelIdle);
    cleanups.splice(0).forEach((cleanup) => cleanup());
    onEnd(reason);
  };
  const waitWheelEnd = () => {
    if (wheelIdle) window.clearTimeout(wheelIdle);
    const remaining = HERO_INPUT_TRANSFER_QUIET_MS - (performance.now() - (wheel?.seenAt ?? 0));
    wheelIdle = window.setTimeout(() => {
      wheelIdle = 0;
      if (readHeroScrollInput().wheel?.id === wheel?.id) waitWheelEnd();
      else finish('ended');
    }, Math.max(1, Math.ceil(remaining) + 1));
  };
  const forwardWheel = (event: WheelEvent) => {
    if (!active || !wheel || handled.has(event)) return handled.has(event);
    if (event.target instanceof Node && !event.target.isConnected) noteDetachedHeroInput(event);
    if (event.ctrlKey || !destination.isConnected || readHeroScrollInput().wheel?.id !== wheel.id) {
      finish('superseded');
      return false;
    }
    handled.add(event);
    if (event.cancelable) event.preventDefault();
    const unit = event.deltaMode === WheelEvent.DOM_DELTA_LINE ? lineHeight
      : event.deltaMode === WheelEvent.DOM_DELTA_PAGE ? pageHeight : 1;
    onWheel(event.deltaX * unit, event.deltaY * unit);
    waitWheelEnd();
    return true;
  };
  const wheelListener = (event: WheelEvent) => { forwardWheel(event); };
  if (wheel) {
    window.addEventListener('wheel', wheelListener, { capture: true, passive: false });
    cleanups.push(() => window.removeEventListener('wheel', wheelListener, true));
    if (wheel.target) {
      wheel.target.addEventListener('wheel', wheelListener as EventListener, { passive: false });
      cleanups.push(() => wheel.target?.removeEventListener('wheel', wheelListener as EventListener));
    }
    waitWheelEnd();
  }
  if (touch) {
    observeHeroTouchTarget(touch.target);
    const touchListener = (raw: Event) => {
      const event = raw as TouchEvent;
      if (!active) return;
      if (!destination.isConnected || event.type === 'touchcancel' || event.touches.length > 1) {
        finish('superseded');
        return;
      }
      const moved = Array.from(event.changedTouches).find((entry) => entry.identifier === touch.identifier);
      if (moved) {
        onTouch(x - moved.clientX, y - moved.clientY);
        x = moved.clientX;
        y = moved.clientY;
      }
      if (!Array.from(event.touches).some((entry) => entry.identifier === touch.identifier)) finish('ended');
    };
    for (const type of ['touchmove', 'touchend', 'touchcancel']) {
      touch.target.addEventListener(type, touchListener, { passive: true });
      cleanups.push(() => touch.target.removeEventListener(type, touchListener));
    }
    const newWheel = () => finish('superseded');
    window.addEventListener('wheel', newWheel, { capture: true, passive: true });
    cleanups.push(() => window.removeEventListener('wheel', newWheel, true));
    cleanups.push(subscribeHeroInteraction(() => {
      // A real end is handled above. Losing the shared contact through blur or its safety
      // timeout cancels pending movement, even if a background tab cannot drain its frame.
      if (!readHeroScrollInput().touches.some((entry) => entry.identifier === touch.identifier)) finish('superseded');
    }));
  }
  const supersede = () => finish('superseded');
  for (const type of ['pointerdown', 'touchstart']) {
    window.addEventListener(type, supersede, { capture: true, passive: true });
    cleanups.push(() => window.removeEventListener(type, supersede, true));
  }
  const leaveWindow = (event: Event) => {
    if (event.target === window) supersede();
  };
  for (const type of ['blur', 'pagehide']) {
    window.addEventListener(type, leaveWindow);
    cleanups.push(() => window.removeEventListener(type, leaveWindow));
  }
  return {
    ownsWheel: (event) => handled.has(event),
    release: supersede,
  };
}
