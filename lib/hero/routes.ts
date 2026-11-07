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
import type { HeroScrollPlane } from './plane';
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
      /* A route that has resolved without media has nothing to preview and nothing to hand
         off to, and that is a final answer rather than a not-yet — so it satisfies the wait.
         `handoffOpening` never reads `route.target`; the closing path does, and already
         falls back to a plain history collapse when it is null. */
      if (requirePreview && !route.resolvedWithoutMedia && (!route.previewPaintable || !route.target))
        continue;
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
    // `visibility` only, matching `leaseHeroRouteSealed`: clearing an inline
    // `opacity` here is what made the back affordance fade over 200ms instead of
    // revealing in a frame, because that property is transitioned by `IconButton`.
    // Nothing sets it now.
    route.overlay.style.visibility = '';
    route.overlay.style.pointerEvents = '';
    if (route.floatingBack) {
      route.floatingBack.style.visibility = '';
      route.floatingBack.style.pointerEvents = '';
    }
    return true;
  }

  /**
   * Make a route non-interactive while it is still visually present.
   *
   * `deferInert` keeps the leaving route's inherited input-style changes behind the flight's
   * first presented frame. A transparent shield in the gallery scroller blocks commands while
   * preserving native scrolling; `applyInert` replaces it once the flight is on the compositor.
   * The gallery plane is measured before the close writes to the tree.
   */
  freeze(
    route: HeroRoute,
    owner: symbol,
    { deferInert = false, scrollPlane, onShieldTap }: {
      deferInert?: boolean;
      scrollPlane?: HeroScrollPlane;
      onShieldTap?: (x: number, y: number) => void;
    } = {},
  ): DomLease & { applyInert: () => void } {
    route.interaction?.release();
    let lock: DomLease | null = null;
    let shield: HTMLElement | null = null;
    let released = false;
    const removeShield = () => {
      shield?.remove();
      shield = null;
    };
    const interaction: DomLease = {
      release: () => {
        released = true;
        removeShield();
        lock?.release();
        lock = null;
      },
    };
    const applyInert = () => {
      if (released || lock || route.interaction !== interaction) return;
      /* A close's leaving route is cut with `aria-hidden` + `pointer-events`, never `inert`:
         `inert` is a subtree style change, so Blink re-resolved every node of the leaving detail
         (traced at ~780 nodes with comments, the longest frame of a close on an E5 desktop and an
         Iris Xe laptop alike). `pointer-events` is an independent inherited property, which
         Blink pushes down without re-resolving the subtree; the few descendants that take the
         pointer back are named by the `[data-image-hero-leaving]` rule. Focus still inside the
         leaving detail is dropped, as `inert` would have. An open's freeze keeps `inert`. */
      const light = deferInert;
      if (light) {
        const active = typeof document !== 'undefined' ? document.activeElement : null;
        if (
          active instanceof HTMLElement &&
          (route.overlay.contains(active) || route.floatingBack?.contains(active))
        ) {
          active.blur();
        }
      }
      const cut = light ? 'aria-hidden' : 'inert';
      const cutValue = light ? 'true' : '';
      lock = combineHeroLeases(
        leaseAttribute(route.overlay, cut, cutValue),
        route.floatingBack ? leaseAttribute(route.floatingBack, cut, cutValue) : null,
        leaseInlineStyles(route.overlay, { pointerEvents: 'none' }),
        route.floatingBack ? leaseInlineStyles(route.floatingBack, { pointerEvents: 'none' }) : null,
      );
      removeShield();
    };
    route.interaction = interaction;
    route.interactionOwner = owner;
    if (deferInert && scrollPlane?.scroller.isConnected) {
      shield = document.createElement('div');
      shield.setAttribute('data-image-hero-close-shield', '');
      shield.setAttribute('aria-hidden', 'true');
      // Keep the first gesture in the gallery's native scroll space. A fixed shield on body
      // latched touch to the non-scrolling document; removing it cannot retarget that gesture.
      // The full, premeasured scroll range keeps controls covered as the gallery moves.
      // See docs/hero.md#closing-and-pull.
      shield.style.cssText =
        `position:absolute;top:0;left:0;width:${scrollPlane.viewportWidth}px;` +
        `height:${scrollPlane.viewportHeight + scrollPlane.maxScrollTop}px;` +
        'z-index:var(--z-hero-back);background:transparent;pointer-events:auto;touch-action:pan-y pinch-zoom';
      scrollPlane.scroller.appendChild(shield);
      /* Followed past the shield's own life: the release may land after it is gone. */
      if (onShieldTap) watchShieldTap(shield, onShieldTap);
    } else {
      applyInert();
    }
    return {
      release: () => {
        if (route.interaction !== interaction || route.interactionOwner !== owner) {
          // A newer owner took the route over; still never leave this shield behind.
          removeShield();
          return;
        }
        interaction.release();
        route.interaction = null;
        route.interactionOwner = null;
      },
      applyInert,
    };
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


/** How long a press that began on a close's shield may take to count as a tap. */
const SHIELD_TAP_MAX_MS = 600;
const SHIELD_TAP_SLOP_PX = 10;

/**
 * Replay a tap caught before `applyInert` lets the gallery accept commands. If the shield leaves
 * before pointerup, the native click need not reach the card. Follow the release on the window
 * and let the controller deliver the tap once the gallery is exposed.
 */
function watchShieldTap(shield: HTMLElement, onTap: (x: number, y: number) => void) {
  let start: { id: number; x: number; y: number; at: number } | null = null;
  const onDown = (event: PointerEvent) => {
    if (event.button !== 0 || !event.isPrimary) return;
    start = { id: event.pointerId, x: event.clientX, y: event.clientY, at: event.timeStamp };
  };
  const onUp = (event: PointerEvent) => {
    const press = start;
    if (!press || event.pointerId !== press.id) return;
    start = null;
    stop();
    if (event.timeStamp - press.at > SHIELD_TAP_MAX_MS) return;
    if (Math.hypot(event.clientX - press.x, event.clientY - press.y) > SHIELD_TAP_SLOP_PX) return;
    onTap(event.clientX, event.clientY);
  };
  const onCancel = (event: PointerEvent) => {
    if (start && event.pointerId === start.id) {
      start = null;
      stop();
    }
  };
  let timer = 0;
  const stop = () => {
    shield.removeEventListener('pointerdown', onDown);
    window.removeEventListener('pointerup', onUp, true);
    window.removeEventListener('pointercancel', onCancel, true);
    if (timer) window.clearTimeout(timer);
    timer = 0;
  };
  shield.addEventListener('pointerdown', onDown);
  window.addEventListener('pointerup', onUp, true);
  window.addEventListener('pointercancel', onCancel, true);
  /* The shield lives one or two frames (250ms at the outside); a press on it is over well inside
     this. Nothing is left listening after. */
  timer = window.setTimeout(stop, 1500 + SHIELD_TAP_MAX_MS);
  return stop;
}
