'use client';

import {
  BACKGROUND_REVEAL_DISTANCE_PX,
  DISMISS_DISTANCE_PX,
  DRAG_RESISTANCE_PX,
  PULL_RELEASE_DURATION_MS,
  PULL_RELEASE_MIN_DURATION_MS,
  PULL_RELEASE_RESPONSE,
  SURFACE_FADE_DISTANCE_PX,
} from './constants';
import { getHeroBackgroundVisual, type DomLease } from './dom';
import { getHeroBackgroundSinkTransform } from './geometry';
import { heroFrameScheduler } from './scheduler';
import { springProgress, springVelocityFromSpeed } from './spring';
/* One `prefersReducedMotion` for the app, and it is the reactive form —
   `lib/motion`'s reads a live `matchMedia` listener, where the private copies
   these two files carried could not pick up a mid-session change. */
import { prefersReducedMotion } from '@/lib/motion';

const PULL_ATTRIBUTE = 'imageHeroPulling';
const VAR_OFFSET = '--hero-pull-y';
const VAR_VEIL = '--hero-veil';

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
  /** Scoping root for the CSS variables; also owns the reveal subtree. */
  overlay: HTMLElement;
  /** Rendered outside the overlay, so it carries its own copy of the vars. */
  floatingBack: HTMLElement | null;
};

export type HeroPullOptions = {
  /** Mirror the drag onto an in-flight flyer's compensator. */
  onOffset?: (distance: number) => void;
  /** Fired once per gesture, before any variable is written. */
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
 * Per frame it writes at most five values — two CSS variables on the overlay,
 * two on the floating back button, and one transform on the gallery layer —
 * regardless of how many elements react to them. CSS fans the variables out to
 * the whole reveal subtree, so the cost does not grow with page content.
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

  /** Write the release pose immediately, bypassing the frame queue. */
  commit(sample: HeroPullSample) {
    if (this.disposed) return;
    this.begin(sample);
    this.endSettle();
    this.latest = sample;
    heroFrameScheduler.cancel(this.frameOwner);
    this.write(sample);
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
    if (start < 0.5 || prefersReducedMotion()) {
      this.reset();
      return Promise.resolve();
    }

    // Shorter pulls snap back proportionally faster.
    const duration = Math.max(
      PULL_RELEASE_MIN_DURATION_MS,
      Math.min(
        PULL_RELEASE_DURATION_MS,
        PULL_RELEASE_DURATION_MS * Math.sqrt(start / DISMISS_DISTANCE_PX),
      ),
    );
    // Travel runs start → 0, so a finger still moving away is negative progress
    // speed: the surface overshoots slightly before returning, as it should.
    /* Spread, so the release keeps the *whole* response — damping included. Rebuilt
       field by field it silently dropped ζ back to the default and the dismiss ran a
       critically damped curve while claiming the spatial one. */
    const response = {
      ...PULL_RELEASE_RESPONSE,
      velocity: springVelocityFromSpeed(
        -releaseVelocity,
        start,
        duration,
        PULL_RELEASE_RESPONSE,
      ),
    };

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
        const progress = springProgress(elapsed / duration, response);
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
    delete overlay.dataset[PULL_ATTRIBUTE];
    overlay.style.removeProperty(VAR_OFFSET);
    overlay.style.removeProperty(VAR_VEIL);
    if (floatingBack) {
      delete floatingBack.dataset[PULL_ATTRIBUTE];
      floatingBack.style.removeProperty(VAR_OFFSET);
      floatingBack.style.removeProperty(VAR_VEIL);
    }

    const background = restoreBackground ? getHeroBackgroundVisual() : null;
    if (background) {
      background.style.transform = '';
      background.style.transformOrigin = '';
      background.style.willChange = '';
    }
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
    this.active = true;
    // Marking the surfaces themselves — rather than the document — keeps the
    // rules from reaching a Stage that happens to be mounted alongside.
    this.nodes.overlay.dataset[PULL_ATTRIBUTE] = '';
    if (this.nodes.floatingBack) this.nodes.floatingBack.dataset[PULL_ATTRIBUTE] = '';
    this.write(sample);
    this.lease = this.options.acquireLease?.() ?? null;
    this.options.onSeize?.();
  }

  private write(sample: HeroPullSample) {
    if (this.disposed) return;
    const { overlay, floatingBack } = this.nodes;
    const offset = `${sample.distance}px`;
    const veil = String(sample.opacity);

    overlay.style.setProperty(VAR_OFFSET, offset);
    overlay.style.setProperty(VAR_VEIL, veil);
    if (floatingBack) {
      floatingBack.style.setProperty(VAR_OFFSET, offset);
      floatingBack.style.setProperty(VAR_VEIL, veil);
    }

    const background = getHeroBackgroundVisual();
    if (background) {
      background.style.transformOrigin = 'center top';
      background.style.willChange = 'transform';
      background.style.transform = getHeroBackgroundSinkTransform(sample.backgroundAmount);
    }

    this.options.onOffset?.(sample.distance);
  }
}
