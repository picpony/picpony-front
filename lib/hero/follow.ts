'use client';

/**
 * One scroll position, two surfaces — on the compositor.
 *
 * While a picture opens, the browser delivers the reader's scroll to whichever scroller it
 * latched when the touch or wheel stream began: the Stage's. Once the routed detail is what the
 * reader sees, it has to move with that stream. Mirroring `scrollTop` from the Stage's scroll
 * events does that on the **main thread**, at the event rate, in exactly the window where the
 * main thread is busiest (the route committing, its body publishing, the final image decoding):
 * a 60–200ms task there is 4–12 frames in which the picture under the finger does not move — the
 * "scrolling drops frames until the detail has loaded" of an open.
 *
 * A scroll-driven animation does not need the main thread at all. Its timeline is the Stage
 * scroller's own offset, so the compositor that scrolls the Stage translates the route's content
 * by the same amount in the same frame: `translateY(base − offset)`, with the route scroller
 * itself parked at `base`. Committing (`commit`) folds the translate back into a real scroll
 * position in one task, so there is no frame in which both or neither apply.
 *
 * Where `ScrollTimeline` is missing the caller falls back to the event-rate bridge.
 */

export type HeroScrollFollow = {
  /** Re-read the source's range; call after anything changes its scroll height. */
  refresh: () => void;
  /** Turn the translate into a real scroll position (one task) and stop following. */
  commit: () => void;
  /** Stop following without touching the target's scroll position. */
  release: () => void;
};

type ScrollTimelineCtor = new (options: { source: Element; axis?: 'block' | 'inline' | 'x' | 'y' }) => AnimationTimeline;

function scrollTimelineCtor(): ScrollTimelineCtor | null {
  if (typeof window === 'undefined') return null;
  const ctor = (window as unknown as { ScrollTimeline?: ScrollTimelineCtor }).ScrollTimeline;
  return typeof ctor === 'function' ? ctor : null;
}

export function canFollowHeroScroll() {
  return scrollTimelineCtor() !== null;
}

/**
 * @param source  The scroller the input is latched to (the Stage's).
 * @param target  The scroller whose content must look scrolled with it (the route's).
 * @param node    What carries the translate: a child of `target` with no transform of its own for
 *   the duration (the cross-fade block — the pull owns the content node's transform).
 */
export function followHeroScroll(
  source: HTMLElement,
  target: HTMLElement,
  node: HTMLElement,
): HeroScrollFollow | null {
  const Ctor = scrollTimelineCtor();
  if (!Ctor) return null;
  const base = source.scrollTop;
  target.scrollTop = base;
  /* The browser clamps; the translate has to start from where the target really is, or the
     first frame is off by the clamp. */
  const parked = target.scrollTop;
  let range = -1;
  let animation: Animation | null = null;
  let done = false;

  const keyframes = (max: number): Keyframe[] => [
    { transform: `translate3d(0, ${(parked - 0).toFixed(3)}px, 0)` },
    { transform: `translate3d(0, ${(parked - max).toFixed(3)}px, 0)` },
  ];

  try {
    const timeline = new Ctor({ source, axis: 'block' });
    range = Math.max(0, source.scrollHeight - source.clientHeight);
    animation = node.animate(keyframes(range), { timeline, fill: 'both', easing: 'linear' } as KeyframeAnimationOptions);
  } catch {
    animation?.cancel();
    target.scrollTop = base;
    return null;
  }

  const stop = () => {
    if (done) return;
    done = true;
    try {
      animation?.cancel();
    } catch {
      // Already cancelled with its node.
    }
    animation = null;
  };

  return {
    refresh: () => {
      if (done || !animation) return;
      const next = Math.max(0, source.scrollHeight - source.clientHeight);
      if (next === range) return;
      range = next;
      try {
        (animation.effect as KeyframeEffect | null)?.setKeyframes(keyframes(next));
      } catch {
        // A detached effect has nothing on screen to keep in step.
      }
    },
    commit: () => {
      if (done) return;
      const offset = source.scrollTop;
      target.scrollTop = offset;
      stop();
    },
    release: stop,
  };
}
