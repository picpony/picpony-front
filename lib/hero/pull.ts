'use client';

import {
  BACKGROUND_REVEAL_DISTANCE_PX,
  DISMISS_DISTANCE_PX,
  DRAG_RESISTANCE_PX,
  HERO_CHROME_SELECTOR,
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
import { clamp } from '@/lib/utils';
import { heroProbeMark } from './probe';

const PULL_ATTRIBUTE = 'imageHeroPulling';
const PULL_READY_ATTRIBUTE = 'imageHeroPullReady';
type PullStyle = { element: HTMLElement; property: 'transform' | 'opacity'; original: string; written: string };

export type HeroPullSample = {
  /** Downward finger travel past the touch slop, in px. Drives every derived value. */
  raw: number;
  /** Rubber-banded travel actually applied to the surface. */
  distance: number;
  /** Horizontal travel applied once the drag is claimed, at the vertical band's ratio. */
  x: number;
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
  /**
   * Further surfaces the gesture moves with its own — the routed detail an opening revealed
   * early in the Stage's place (`HeroMotion.attachMirror`). Read when a pull begins and whenever
   * the surface's tree changes, so a mirror that arrives mid-drag is picked up.
   */
  mirrors?: () => readonly HTMLElement[];
  /** Mirror the drag onto an in-flight flyer's compensator. */
  onOffset?: (distance: number, x: number) => void;
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

/* The vertical travel keeps its rubber band (an owner decision: it does not cost the feel). The
   horizontal follow, once the drag is claimed, takes the *same* ratio, so the surface moves
   along the finger's own direction instead of sliding sideways faster than it sinks. */
export function createPullSample(rawDistance: number, x = 0): HeroPullSample {
  const raw = Math.max(0, rawDistance);
  const distance = resistedDistance(raw);
  return {
    raw,
    distance,
    x: raw > 0 ? x * (distance / raw) : 0,
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
  /**
   * The flyer's compensator is the pull's until a reversal takes the flyer over: the reverse
   * folds the drag into the leg's start and clears the compensator, so a later write from here —
   * the tree observer re-applying the last pose when the Stage re-renders for the new phase —
   * would offset the flyer a second time (measured: a 149px jump on the first reversed frame).
   */
  private offsetOwned = true;
  /** The mirror overlays this pull marked, so `reset` unmarks exactly those. */
  private markedMirrors: HTMLElement[] = [];

  constructor(
    private readonly nodes: HeroPullNodes,
    private readonly options: HeroPullOptions = {},
  ) {}

  get isActive() {
    return this.active;
  }

  /**
   * A finger is down where a pull could start. The pull's layers are promoted now, a frame or
   * two before the slop is crossed, so the first dragged frame moves layers instead of creating
   * (and rasterizing) them — which made the first moves of every pull the slowest (~45ms to
   * screen against ~30 for the rest, 1× CPU). Undone when the candidate ends without a pull.
   */
  prime(ready: boolean) {
    if (this.disposed) return;
    const { overlay, floatingBack } = this.nodes;
    if (ready) {
      overlay.dataset[PULL_READY_ATTRIBUTE] = '';
      if (floatingBack) floatingBack.dataset[PULL_READY_ATTRIBUTE] = '';
    } else {
      delete overlay.dataset[PULL_READY_ATTRIBUTE];
      if (floatingBack) delete floatingBack.dataset[PULL_READY_ATTRIBUTE];
    }
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
    const startX = sample.x;
    if (start < 0.5 || motionTier('image') === 'off') {
      this.reset();
      return Promise.resolve();
    }

    /* Shorter pulls snap back proportionally faster, and the whole range rides the speed
       preference — the release is evaluated in JS, so neither `--motion-scale` nor GSAP's `timeScale`
       reaches it and the multiplication has to be here. The floor is scaled with it rather
       than left absolute: it exists to stop a flick from a near-closed position reading as a
       cut, which is a proportion of the gesture rather than a wall-clock minimum. */
    const scale = motionScale('image');
    const duration = clamp(
      PULL_RELEASE_DURATION_MS * scale * Math.sqrt(start / DISMISS_DISTANCE_PX),
      PULL_RELEASE_MIN_DURATION_MS * scale,
      PULL_RELEASE_DURATION_MS * scale,
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
        this.write(createPullSample(start * (1 - progress), startX * (1 - progress)));
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
    this.markedMirrors.forEach((mirror) => delete mirror.dataset[PULL_ATTRIBUTE]);
    this.markedMirrors = [];
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
    if (this.offsetOwned) this.options.onOffset?.(0, 0);

    this.lease?.release();
    this.lease = null;
  }

  /** Stop driving the flyer's offset — a reversal now owns it (`offsetOwned`). */
  releaseOffset() {
    this.offsetOwned = false;
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
    this.options.mirrors?.().forEach((mirror) =>
      this.observer?.observe(mirror, { childList: true, subtree: true }),
    );
  }

  private refreshTargets() {
    const { overlay, floatingBack } = this.nodes;
    const remember = (element: HTMLElement, property: PullStyle['property']) => {
      if (this.styles.some((style) => style.element === element && style.property === property)) return;
      this.styles.push({ element, property, original: element.style[property], written: '' });
    };
    const surfaces = [overlay, ...(this.options.mirrors?.() ?? [])];
    surfaces.forEach((surface) => {
      const content = surface.querySelector<HTMLElement>('.image-detail-overlay-content');
      if (content) remember(content, 'transform');
      surface.querySelectorAll<HTMLElement>(
        `${HERO_SURFACE_SELECTOR}, ${HERO_REVEAL_SELECTOR}, ${HERO_CHROME_SELECTOR}`,
      ).forEach((element) => remember(element, 'opacity'));
      if (surface !== overlay && !this.markedMirrors.includes(surface)) {
        surface.dataset[PULL_ATTRIBUTE] = '';
        this.markedMirrors.push(surface);
      }
    });
    if (floatingBack) remember(floatingBack, 'opacity');
  }

  private write(sample: HeroPullSample) {
    if (this.disposed) return;
    this.latest = sample;
    const transform = `translate3d(${sample.x}px, ${sample.distance}px, 0px)`;
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

    heroProbeMark('hx:pull-write');
    if (this.offsetOwned) this.options.onOffset?.(sample.distance, sample.x);
  }
}
