'use client';

import {
  combineHeroLeases,
  leaseAttribute,
  leaseHeroRouteSealed,
  leaseHeroVisibility,
  leaseInlineStyles,
  type DomLease,
} from './dom';
import type { HeroPullSurface } from './pull';
import type { HeroRouteRegistration } from './types';

/**
 * A target seal follows `route.target` as the detail media remounts (preview →
 * final swap), so the element the flyer is impersonating stays hidden across
 * the swap without the controller re-sealing.
 */
type RouteTargetSeal = DomLease & {
  refresh: () => void;
};

export type HeroRoute = HeroRouteRegistration & {
  /** Monotonic registration order; disambiguates concurrent detail mounts. */
  epoch: number;
  /** Location this route was registered at. */
  href: string;
  seal: DomLease | null;
  sealOwner: symbol | null;
  interaction: DomLease | null;
  interactionOwner: symbol | null;
  targetSeal: RouteTargetSeal | null;
  pull: HeroPullSurface | null;
};

/**
 * Registry of live detail routes and their visibility ownership.
 *
 * Several detail routes can be mounted at once — a parallel slot that has not
 * unmounted yet, a previous image mid-handoff — so every route is either sealed
 * (invisible, inert) or revealed, and every seal records the symbol that owns
 * it. A session may only reveal what it sealed, which is what keeps two
 * concurrent transactions from stealing each other's surfaces.
 */
export class HeroRouteRegistry {
  /** Seal owner for routes not claimed by any running session. */
  readonly idleOwner = Symbol('hero-route-idle');
  private routes = new Map<string, HeroRoute>();
  private epoch = 0;

  constructor(private readonly notify: () => void) {}

  get currentEpoch() {
    return this.epoch;
  }

  /** Client navigation invalidates routes registered before it. */
  bumpEpoch() {
    this.epoch += 1;
  }

  values() {
    return this.routes.values();
  }

  register(registration: HeroRouteRegistration, href: string): HeroRoute {
    const existing = this.routes.get(registration.surfaceId);
    if (existing) this.unregister(existing);
    const route: HeroRoute = {
      ...registration,
      epoch: ++this.epoch,
      href,
      seal: null,
      sealOwner: null,
      interaction: null,
      interactionOwner: null,
      targetSeal: null,
      pull: null,
    };
    this.routes.set(route.surfaceId, route);
    return route;
  }

  get(surfaceId: string) {
    return this.routes.get(surfaceId) ?? null;
  }

  unregister(route: HeroRoute) {
    if (this.routes.get(route.surfaceId) !== route) return;
    this.routes.delete(route.surfaceId);
    route.pull?.dispose();
    route.pull = null;
    route.targetSeal?.release();
    route.seal?.release();
    route.interaction?.release();
    route.targetSeal = null;
    route.seal = null;
    route.sealOwner = null;
    route.interaction = null;
    route.interactionOwner = null;
    this.notify();
  }

  setTarget(route: HeroRoute, target: HTMLElement | null) {
    route.target = target;
    route.targetSeal?.refresh();
  }

  /**
   * The newest route for this image that matches the expected location.
   * `floor` excludes routes that already existed when the session started,
   * unless the session is explicitly reusing one (a history restore).
   */
  findForSession(
    imageId: number,
    href: string,
    {
      floor,
      requirePreview,
      allowExisting,
    }: {
      floor: number;
      requirePreview: boolean;
      allowExisting: boolean;
    },
  ) {
    let candidate: HeroRoute | null = null;
    for (const route of this.routes.values()) {
      if (
        route.imageId !== imageId ||
        route.href !== href ||
        (!allowExisting && route.epoch <= floor) ||
        !route.overlay.isConnected
      ) {
        continue;
      }
      if (requirePreview && (!route.previewPaintable || !route.target)) continue;
      if (!candidate || route.epoch > candidate.epoch) candidate = route;
    }
    return candidate;
  }

  findByImage(imageId: number, href: string) {
    let candidate: HeroRoute | null = null;
    for (const route of this.routes.values()) {
      if (route.imageId !== imageId || route.href !== href) continue;
      if (!route.overlay.isConnected) continue;
      if (!candidate || route.epoch > candidate.epoch) candidate = route;
    }
    return candidate;
  }

  seal(route: HeroRoute, owner: symbol) {
    if (route.sealOwner === owner && route.seal) return;
    route.interaction?.release();
    route.interaction = null;
    route.interactionOwner = null;
    route.seal?.release();
    route.seal = leaseHeroRouteSealed(route);
    route.sealOwner = owner;
  }

  sealAllExcept(keep: HeroRoute | null, owner: symbol = this.idleOwner) {
    this.routes.forEach((route) => {
      if (route !== keep) this.seal(route, owner);
    });
  }

  /**
   * Make a route visible and interactive. Refuses when another owner holds the
   * seal, so a losing session cannot un-hide a surface it does not control.
   */
  reveal(route: HeroRoute, owner: symbol | null = null) {
    if (route.seal && owner !== null && route.sealOwner !== owner) return false;
    if (route.interaction && owner !== null && route.interactionOwner !== owner) return false;
    route.seal?.release();
    route.seal = null;
    route.sealOwner = null;
    route.interaction?.release();
    route.interaction = null;
    route.interactionOwner = null;
    route.overlay.dataset.imageHeroRouteState = 'active';
    route.overlay.style.opacity = '';
    route.overlay.style.visibility = '';
    route.overlay.style.pointerEvents = '';
    if (route.floatingBack) {
      route.floatingBack.style.opacity = '';
      route.floatingBack.style.visibility = '';
      route.floatingBack.style.pointerEvents = '';
    }
    return true;
  }

  /** Make a route non-interactive while it is still visually present. */
  freeze(route: HeroRoute, owner: symbol): DomLease {
    route.interaction?.release();
    const interaction = leaseAttribute(route.overlay, 'inert', '');
    route.interaction = interaction;
    route.interactionOwner = owner;
    return combineHeroLeases(
      {
        release: () => {
          if (route.interaction !== interaction || route.interactionOwner !== owner) return;
          interaction.release();
          route.interaction = null;
          route.interactionOwner = null;
        },
      },
      leaseInlineStyles(route.overlay, { pointerEvents: 'none' }),
    );
  }

  /** Hide whichever element is currently `route.target`, and keep following it. */
  sealTarget(route: HeroRoute): DomLease {
    route.targetSeal?.release();
    let element: HTMLElement | null = null;
    let visibility: DomLease | null = null;
    let released = false;
    const seal: RouteTargetSeal = {
      refresh: () => {
        if (released || route.targetSeal !== seal || route.target === element) return;
        visibility?.release();
        element = route.target;
        visibility = leaseHeroVisibility(element, false);
      },
      release: () => {
        if (released) return;
        released = true;
        visibility?.release();
        visibility = null;
        element = null;
        if (route.targetSeal === seal) route.targetSeal = null;
      },
    };
    route.targetSeal = seal;
    seal.refresh();
    return seal;
  }
}
