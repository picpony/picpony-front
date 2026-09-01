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
import { progressAt, relaunch } from './progress';
/* One reader for the app; see the note in `lib/hero/motion.ts`. Only `off` is checked
   below: a drag release is the finger's own momentum being honoured, not an animation
   played at the user, which is the same line M3 draws when it settles a drawer's drag on
   a spring while closing it on an effects curve. */
import { motionScale, motionTier } from '@/lib/appearance';

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
    if (start < 0.5 || motionTier() === 'off') {
      this.reset();
      return Promise.resolve();
    }

    /* Shorter pulls snap back proportionally faster, and the whole range rides the speed
       preference — the release is WAAPI, so neither `--motion-scale` nor GSAP's `timeScale`
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
