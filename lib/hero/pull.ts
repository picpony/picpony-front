'use client';

import {
  BACKGROUND_REVEAL_DISTANCE_PX,
  DISMISS_DISTANCE_PX,
  DRAG_RESISTANCE_PX,
  HERO_REVEAL_SELECTOR,
  HERO_SURFACE_SELECTOR,
  PULL_RELEASE_DURATION_MS,
  PULL_RELEASE_MIN_DURATION_MS,
  PULL_RELEASE_RESPONSE,
  SURFACE_FADE_DISTANCE_PX,
} from './constants';
import { getHeroBackgroundVisual, type DomLease } from './dom';
import { getHeroBackgroundSinkTransform } from './geometry';
import { heroFrameScheduler } from './scheduler';
import { progressAt, relaunch } from './progress';
/* One reader for the app; see the note in `lib/hero/motion.ts`. Only `off` is checked
   below: a drag release is the finger's own momentum being honoured, not an animation
   played at the user, which is the same line M3 draws when it settles a drawer's drag on
   a spring while closing it on an effects curve. */
import { motionScale, motionTier } from '@/lib/appearance';

const PULL_ATTRIBUTE = 'imageHeroPulling';
type PullStyle = { element: HTMLElement; property: 'transform' | 'opacity'; original: string; written: string };

export type HeroPullSample = {
  /** Unresisted finger travel, in px. Drives every derived value. */
  raw: number;
  /** Rubber-banded travel actually applied to the surface. */
  distance: number;
  opacity: number;
  backgroundAmount: number;
};

/** The nodes a dismissible detail surface is made of. */
export type HeroPullNodes = {
  /** Owns the moving content and fading surface/reveal nodes. */
  overlay: HTMLElement;
  /** Rendered outside the overlay; participates in the same veil. */
  floatingBack: HTMLElement | null;
};

export type HeroPullOptions = {
  /** Mirror the drag onto an in-flight flyer's compensator. */
  onOffset?: (distance: number) => void;
  /** Fired once per gesture, after the first pose is ready to take over. */
  onSeize?: () => void;
  /** Held for the duration of the gesture (e.g. the destination thumbnail). */
  acquireLease?: () => DomLease | null;
};

function resistedDistance(raw: number) {
  const positive = Math.max(0, raw);
  // Asymptotic rubber band: the surface never runs away from the finger.
  return positive / (1 + positive / DRAG_RESISTANCE_PX);
}

export function createPullSample(rawDistance: number): HeroPullSample {
  const raw = Math.max(0, rawDistance);
  return {
    raw,
    distance: resistedDistance(raw),
    opacity: Math.max(0, 1 - raw / SURFACE_FADE_DISTANCE_PX),
    backgroundAmount: Math.max(0, 1 - raw / BACKGROUND_REVEAL_DISTANCE_PX),
  };
}

export const PULL_REST = createPullSample(0);


/**
 * The dismiss-drag presentation for one detail surface.
 *
 * The Stage (during an opening flight) and the settled route are the same thing
 * being dragged, so they share this one implementation and are therefore
 * identical by construction rather than by two parallel edits.
 *
 * Cache the few nodes that move/fade and write their non-inherited properties.
 * Inherited custom properties looked like constant work in JS but made the browser
 * recalculate the whole detail subtree on every frame. A child-list observer only
 * refreshes this list when asynchronous content actually replaces those nodes.
 */
export class HeroPullSurface {
  private readonly frameOwner = {};
  private readonly settleOwner = {};
  private lease: DomLease | null = null;
  private active = false;
  private disposed = false;
  private settling = false;
  private settleResolve: (() => void) | null = null;
  private latest: HeroPullSample = PULL_REST;
  private styles: PullStyle[] = [];
  private observer: MutationObserver | null = null;
  private background: HTMLElement | null = null;

  constructor(
    private readonly nodes: HeroPullNodes,
    private readonly options: HeroPullOptions = {},
  ) {}

  get isActive() {
    return this.active;
  }

  /** Batched drag update. Safe to call at pointer rate. */
  apply(sample: HeroPullSample) {
    if (this.disposed) return;
    this.begin(sample);
    this.endSettle();
    this.latest = sample;
    heroFrameScheduler.request(this.frameOwner, {
      read: () => this.latest,
      write: (value) => this.write(value),
    });
  }

  /** Write a live pose immediately, bypassing the frame queue. */
  applyImmediate(sample: HeroPullSample) {
    if (this.disposed) return;
    this.begin(sample);
    this.endSettle();
    this.latest = sample;
    heroFrameScheduler.cancel(this.frameOwner);
    this.write(sample);
  }

  /** Write the release pose immediately, bypassing the frame queue. */
  commit(sample: HeroPullSample) {
    this.applyImmediate(sample);
  }

  /**
   * Spring home from the release pose, carrying the fling speed.
   *
   * A fast flick returns decisively while a slow release sinks home; a fixed
   * curve gave both the same lethargic tail. Because the spring is evaluated
   * analytically each frame, a new drag simply retargets it — there is no
   * animation to cancel and no epoch to guard.
   *
   * Always settles, even if the surface is torn down mid-spring, so an awaiting
   * caller can never be stranded.
   */
  settle(sample: HeroPullSample, releaseVelocity = 0) {
    if (this.disposed || !this.active) {
      this.reset();
      return Promise.resolve();
    }
    const start = Math.max(0, sample.raw);
    if (start < 0.5 || motionTier() === 'off') {
      this.reset();
      return Promise.resolve();
    }

    /* Shorter pulls snap back proportionally faster, and the whole range rides the speed
       preference — the release is evaluated in JS, so neither `--motion-scale` nor GSAP's `timeScale`
       reaches it and the multiplication has to be here. The floor is scaled with it rather
       than left absolute: it exists to stop a flick from a near-closed position reading as a
       cut, which is a proportion of the gesture rather than a wall-clock minimum. */
    const scale = motionScale();
    const duration = Math.max(
      PULL_RELEASE_MIN_DURATION_MS * scale,
      Math.min(
        PULL_RELEASE_DURATION_MS * scale,
        PULL_RELEASE_DURATION_MS * scale * Math.sqrt(start / DISMISS_DISTANCE_PX),
      ),
    );
    // Travel runs start → 0, so a finger still moving away is negative progress
    // speed: the surface overshoots slightly before returning, as it should.
    /* `relaunch` owns the spread that keeps the *whole* response, damping included —
       rebuilt field by field it silently dropped ζ back to the default. One function that
       can make that mistake instead of three call sites. The release is always a spring:
       it continues a speed the hand supplied. */
    const model = relaunch(PULL_RELEASE_RESPONSE, -releaseVelocity, start, duration);

    this.endSettle();
    this.settling = true;
    heroFrameScheduler.cancel(this.frameOwner);
    const startedAt = performance.now();

    return new Promise<void>((resolve) => {
      this.settleResolve = resolve;
      const step = () => {
        if (this.disposed || !this.settling) {
          this.endSettle();
          return;
        }
        const elapsed = performance.now() - startedAt;
        if (elapsed >= duration) {
          this.reset();
          return;
        }
        const progress = progressAt(model, elapsed / duration);
        this.write(createPullSample(start * (1 - progress)));
        heroFrameScheduler.request(this.settleOwner, { read: () => undefined, write: step });
      };
      heroFrameScheduler.request(this.settleOwner, { read: () => undefined, write: step });
    });
  }

  /** Stop the spring and release whoever is awaiting it. */
  private endSettle() {
    this.settling = false;
    heroFrameScheduler.cancel(this.settleOwner);
    const resolve = this.settleResolve;
    this.settleResolve = null;
    resolve?.();
  }

  /**
   * Drop the gesture presentation immediately and hand styling back to CSS.
   *
   * `restoreBackground` is false when a newer session has already taken over the
   * gallery sink — clearing it there would fight the incoming animation.
   */
  reset(restoreBackground = true) {
    heroFrameScheduler.cancel(this.frameOwner);
    this.endSettle();
    this.latest = PULL_REST;
    if (!this.active) return;
    this.active = false;

    const { overlay, floatingBack } = this.nodes;
    this.observer?.disconnect();
    this.observer = null;
    delete overlay.dataset[PULL_ATTRIBUTE];
    if (floatingBack) {
      delete floatingBack.dataset[PULL_ATTRIBUTE];
    }
    this.styles.forEach(({ element, property, original, written }) => {
      if (element.style[property] === written) element.style[property] = original;
    });
    this.styles = [];

    const background = restoreBackground ? getHeroBackgroundVisual() : null;
    if (background) {
      background.style.transform = '';
      background.style.transformOrigin = '';
      background.style.willChange = '';
    }
    this.background = null;
    this.options.onOffset?.(0);

    this.lease?.release();
    this.lease = null;
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.reset();
  }

  /**
   * Claim the surface, writing the first real sample synchronously.
   *
   * The write must land before the caller cancels the flight's WAAPI reveal
   * animations: cancelling first would drop those elements back to full opacity
   * for one frame before the gesture value arrives.
   */
  private begin(sample: HeroPullSample) {
    if (this.active) return;
    this.background = getHeroBackgroundVisual();
    const scroller = this.background?.parentElement;
    // Keep the sink's pivot when taking over from a flight; changing it at s<1
    // translates the gallery even though the user's hand has only moved vertically.
    const origin = this.background?.style.transformOrigin ||
      `center ${scroller ? scroller.scrollTop + scroller.clientHeight / 2 : 0}px`;
    this.active = true;
    this.refreshTargets();
    // Marking the surfaces themselves — rather than the document — keeps the
    // rules from reaching a Stage that happens to be mounted alongside.
    this.nodes.overlay.dataset[PULL_ATTRIBUTE] = '';
    if (this.nodes.floatingBack) this.nodes.floatingBack.dataset[PULL_ATTRIBUTE] = '';
    this.write(sample);
    this.lease = this.options.acquireLease?.() ?? null;
    this.options.onSeize?.();
    if (this.background) {
      this.background.style.transformOrigin = origin;
      this.background.style.willChange = 'transform';
    }
    this.observer = new MutationObserver(() => {
      if (!this.active || this.disposed) return;
      this.refreshTargets();
      this.write(this.latest);
    });
    this.observer.observe(this.nodes.overlay, { childList: true, subtree: true });
  }

  private refreshTargets() {
    const { overlay, floatingBack } = this.nodes;
    const remember = (element: HTMLElement, property: PullStyle['property']) => {
      if (this.styles.some((style) => style.element === element && style.property === property)) return;
      this.styles.push({ element, property, original: element.style[property], written: '' });
    };
    const content = overlay.querySelector<HTMLElement>('.image-detail-overlay-content');
    if (content) remember(content, 'transform');
    overlay.querySelectorAll<HTMLElement>(`${HERO_SURFACE_SELECTOR}, ${HERO_REVEAL_SELECTOR}`)
      .forEach((element) => remember(element, 'opacity'));
    if (floatingBack) remember(floatingBack, 'opacity');
  }

  private write(sample: HeroPullSample) {
    if (this.disposed) return;
    this.latest = sample;
    const transform = `translate3d(0px, ${sample.distance}px, 0px)`;
    const veil = String(sample.opacity);
    this.styles.forEach((style) => {
      if (!style.element.isConnected) return;
      const value = style.property === 'transform' ? transform : veil;
      if (style.written === value) return;
      style.element.style[style.property] = value;
      // Read CSSOM serialization (e.g. translate3d's px zero) for ownership-safe restore.
      style.written = style.element.style[style.property];
    });

    const background = this.background;
    if (background) {
      background.style.transform = getHeroBackgroundSinkTransform(sample.backgroundAmount);
    }

    this.options.onOffset?.(sample.distance);
  }
}
