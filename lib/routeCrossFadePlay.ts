'use client';

import { gsap, playSharedAxis, SPRING, supportsEdgeMask } from '@/lib/motion';
import { DURATION, EASE, PAGE_FADE_TIMING, TRAVEL_PX } from '@/lib/motionTokens';
import { motionRatio, motionScale, motionTier, scaledMs } from '@/lib/appearance';
import { SPRINGS, SPRING_MS, springToLinear } from '@/lib/spring';
import { getAppScroller } from '@/lib/appScroller';
import { setRouteTransit, takeRouteContainerExpectation } from '@/lib/pageTransit';
import { arm, cancelRouteCrossFade, routeMove, settleEntryAnimations } from '@/lib/routeCrossFade';
import { restoreSnapshotScroll, type RouteSnapshot } from '@/lib/pageSnapshot';
import { columnWindow } from '@/lib/tabStrip';
import { FORUM_TRANSFORM_MS } from '@/lib/forumContainer';

/**
 * **On a wide screen a route move slides past the pages' columns and a faded margin**, as a tab
 * switch does (`columnWindow`): the window is both pages' columns together, and as far again as a
 * tab's on either side. The leaving page is a clone in the cross-fade's layer and the arriving one
 * sits in the scroller's plane; both of those are wider than the window already, so each is masked
 * to it where it lies rather than widened. Returns the window's width, the strip's travel, and
 * what gives the two their masks back — or null where the scroller stays the window.
 */
function maskRouteWindow(layer: HTMLElement, clone: HTMLElement, page: HTMLElement) {
  const scroller = getAppScroller();
  const plane = page.parentElement;
  /* A page's column is its root, inside the content wrapper; the clone has the same structure. */
  const column = (root: HTMLElement) => root.firstElementChild?.firstElementChild?.getBoundingClientRect() ?? null;
  const leaving = column(clone);
  const arriving = column(page);
  if (!scroller || !plane || !leaving || !arriving) return null;
  const view = scroller.getBoundingClientRect();
  const inner = view.left + scroller.clientLeft;
  const left = Math.min(leaving.left, arriving.left);
  const span = columnWindow(
    { left, right: Math.max(leaving.right, arriving.right) },
    { left: inner, right: inner + scroller.clientWidth },
  );
  if (!span) return null;
  const from = left - span.reach;
  const image = `linear-gradient(to right, transparent, black ${span.fade}px, black calc(100% - ${span.fade}px), transparent)`;
  const masked = [layer, plane].map((node) => {
    const style = node.style;
    const before = [style.maskImage, style.maskSize, style.maskPosition, style.maskRepeat] as const;
    const offset = from - node.getBoundingClientRect().left;
    return { style, before, offset };
  });
  for (const { style, offset } of masked) {
    style.maskImage = image;
    style.maskSize = `${span.width}px 100%`;
    style.maskPosition = `${offset}px 0`;
    style.maskRepeat = 'no-repeat';
  }
  return {
    distance: span.width,
    restore: () => {
      for (const { style, before } of masked) {
        [style.maskImage, style.maskSize, style.maskPosition, style.maskRepeat] = before;
      }
    },
  };
}

/**
 * How long a route change a container transform rides waits for its page past the route's
 * fallback (`takeRouteContainerExpectation`): the rest of a round trip and the page's render.
 * Past it the page fades in as any other does — onto the fallback, which says the wait is a wait.
 */
const CONTAINER_HOLD_MS = 600;

/**
 * Calls `arrived` once `page` holds more than the route's fallback (`data-route-fallback`), or
 * after `bound` ms. Returns what calls it off. The commit that replaces the fallback is the one
 * that mounts what the container lands on, which asks for its first frame from its ref, inside
 * the commit; this answers after the commit, so its frame comes after the container's in the same
 * frame — the list's still frame is still whole when the container takes its row from it.
 */
function whenPageArrives(page: HTMLElement, arrived: () => void, bound: number): () => void {
  let done = false;
  const stop = () => {
    done = true;
    observer.disconnect();
    window.clearTimeout(timer);
  };
  const go = () => {
    if (done) return;
    stop();
    arrived();
  };
  const observer = new MutationObserver(() => {
    if (!page.querySelector('[data-route-fallback]')) go();
  });
  observer.observe(page, { childList: true, subtree: true });
  const timer = window.setTimeout(go, bound);
  return stop;
}

/**
 * The animated half of the route cross-fade, loaded on demand — the sanctioned GSAP half. The
 * split is about *when*: the front half is mounted on every route, so a static `gsap` import
 * here would put the engine and its plugins into the root shell of every route's first
 * document, and nothing on a cold document has navigated yet. `warmRouteCrossFade()` pulls it
 * in after first paint; if it is absent, `captureRouteSnapshot` declines to clone and the
 * navigation is a cut.
 */
export function playRouteCrossFade(
  layer: HTMLElement,
  snapshot: RouteSnapshot,
  from: string,
  to: string,
) {
  /* A second navigation mid-fade drops the older frame rather than stacking two stale layers;
     the snapshot just taken is of whatever was on screen a moment ago, the truer thing to fade. */
  cancelRouteCrossFade();
  setRouteTransit(true);
  /* Read once, by this route change, whichever way it plays. */
  const containerExpected = takeRouteContainerExpectation(to);

  /* Before the clone goes in, so this cannot resolve into it — belt and braces beside the
     attribute strip in `pageSnapshot`. */
  const page = document.querySelector<HTMLElement>('[data-page-content]');
  layer.appendChild(snapshot.node);
  /* In the document now, so its scrollers have a range: the detail leaves where it was read. */
  restoreSnapshotScroll(snapshot);

  /* **The back affordance leaves and arrives with its page.** It is chrome outside the page (a
     portal into the slot), so it used to vanish in the frame the route changed and to appear a
     frame ahead of the page that brings it. Now the leaving page's copy fades out on the page's
     own clock, and an arriving one fades in on the incoming page's. Between two pages that both
     have one it stays put, as it always did (`PageBack`): the copy is dropped and the live one
     is not faded. */
  const slot = document.querySelector<HTMLElement>('[data-page-back-slot]');
  const incomingBack = slot !== null && slot.childElementCount > 0;
  const backLeaves = snapshot.chrome && !incomingBack ? snapshot.chrome : null;
  const backArrives = snapshot.chrome === null && incomingBack ? slot : null;
  if (backLeaves) layer.appendChild(backLeaves);

  /* An image detail leaves on a plain fade, never the shared axis: the axis is a move *within*
     the app's plane, but the pathnames handed here are the background's — while the overlay is
     open that is `/`, so closing an image into /search would read as the gallery sliding with
     the picture pasted on top. A detail is a layer above the plane, not a cell in it. */
  const fadeOnly = snapshot.node.dataset.routeFadeOnly !== undefined;
  const move = from === to || fadeOnly ? null : routeMove(from, to);
  /* The footer is already inside `page`, so it travels and fades on this same
     clock. Only a tab switch needs to hide it separately: there the moving
     panes sit above the footer, and their final height changes at settlement. */
  if (move && page) {
    /* The entry keyframe has to go: it is an opacity fade under a `both` fill, and left in place
       it would fade the page in on a clock of its own while the strip slides it. Never restore
       it either — the node is keyed on the pathname and discarded at the
       next navigation, and clearing the animation at settle would re-arm its fill and replay
       the whole fade. */
    page.style.animation = 'none';
    settleEntryAnimations(page);
    const edge =
      move.axis === 'x' && motionTier('tabs') === 'standard' && supportsEdgeMask()
        ? maskRouteWindow(layer, snapshot.node, page)
        : null;
    const handle = playSharedAxis({
      leaving: snapshot.node,
      entering: page,
      axis: move.axis,
      direction: move.direction,
      distance: edge?.distance,
      /* The page moves as one piece — the only kind of run there is: a route change swaps the
         page's whole subtree the moment its data lands, and only `[data-page-content]` itself
         is guaranteed to survive. */
      onSettle: () => {
        edge?.restore();
        cancelRouteCrossFade();
      },
    });
    /* Nothing may leave a residual transform on an ancestor of a gallery card — the hero flight
       reads a plain `getBoundingClientRect` on press. This node is such an ancestor, and the
       strip starts it a full viewport off, so the pointerdown fast-finishes the move
       rather than letting cards sit pressable-but-offset; `arm()` covers the rest. No removal:
       `handle.finish` is idempotent and the node is discarded at the next navigation. */
    page.addEventListener('pointerdown', () => handle.finish(), { capture: true });
    backLeaves?.animate([{ opacity: 1 }, { opacity: 0 }], {
      duration: SPRING_MS.fastEffects * motionScale('page'),
      easing: LEAVE_EASING,
      fill: 'forwards',
    });
    backArrives?.animate([{ opacity: 0 }, { opacity: 1 }], {
      delay: PAGE_FADE_TIMING.delay * 1000 * motionScale('page'),
      duration: PAGE_FADE_TIMING.duration * 1000 * motionScale('page'),
      easing: EASE.decelerate,
      fill: 'backwards',
    });
    arm(layer, handle.finish);
    return;
  }

  if (containerExpected) {
    playUnderContainer(layer, snapshot.node, page, snapshot.chrome ?? null, slot);
    return;
  }

  /* Paused until the first frame after the commit (below). */
  const timeline = gsap.timeline({ paused: true, onComplete: () => cancelRouteCrossFade() });
  /* On the page tier's own speed. GSAP's global clock carries only feedback's, so without this
     a custom page speed reached the WAAPI legs of this fade (the back affordance, the container
     path) and not the page itself — the two halves of one navigation on two clocks. */
  const pageRatio = motionRatio('page');
  if (pageRatio > 0) timeline.timeScale(1 / pageRatio);
  /* Reduced halves the outgoing leg's rise rather than removing it — the travel was never the
     performative part (the clone is), and a screen that leaves without moving at all reads as
     a cut with a fade on it. The shared entrance travel, mirrored: 16px, 8px reduced. */
  const rise = -(motionTier('page') === 'reduced' ? TRAVEL_PX.small : TRAVEL_PX.standard);
  timeline
    .set(snapshot.node, { willChange: 'transform, opacity' })
    /* The outgoing leg is the mirror of `pageIn`: it leaves upward over the full duration
       while its opacity is spent early, so the incoming page takes over inside the overlap.
       The fade is FastEffects, as every exit is: by the 80ms the incoming page waits it is 4%
       opaque. On 100ms of the emphasized accelerate it was still 52% opaque then, and the two
       pages showed through each other. The back affordance's copy fades with it and does not
       rise: chrome is where it is. */
    .to(backLeaves ? [snapshot.node, backLeaves] : snapshot.node, { opacity: 0, duration: SPRING.fastEffects, ease: 'spring-fastEffects' }, 0)
    .to(snapshot.node, { y: rise, duration: DURATION.long, ease: 'standard' }, 0);
  if (backArrives) {
    timeline.fromTo(
      backArrives,
      { autoAlpha: 0 },
      { autoAlpha: 1, duration: PAGE_FADE_TIMING.duration, ease: 'decelerate', clearProps: 'opacity,visibility' },
      PAGE_FADE_TIMING.delay,
    );
  }

  /* The incoming page's entrance is driven here, on opacity alone, instead of `pageIn`, so
     it runs on the same clock as the outgoing leg. It must never carry a transform:
     `[data-page-content]` is an ancestor of every gallery card, and the hero flight measures
     the pressed card with a plain `getBoundingClientRect`, so a residual offset there launches
     the flyer from a box above the thumbnail (the reason `pageIn` itself is opacity-only).
     Settle uses clearProps, never a zero translate. */
  if (page) {
    page.style.animation = 'none';
    settleEntryAnimations(page);
    timeline.fromTo(
      page,
      { autoAlpha: 0 },
      {
        autoAlpha: 1,
        duration: PAGE_FADE_TIMING.duration,
        ease: 'decelerate',
        clearProps: 'opacity,visibility',
      },
      PAGE_FADE_TIMING.delay,
    );
  }

  /* **Played from the first frame after the commit, not from the commit.** The commit is a
     long task, and a clock started inside it spent that task before anything was painted: on a
     development build the page being left was most of the way gone in the first frame that
     showed it leaving, and a transform started with that frame ran a beat behind the page around
     it. The from-states are already applied — `fromTo` renders immediately. */
  const start = requestAnimationFrame(() => timeline.play());
  arm(layer, () => {
    cancelAnimationFrame(start);
    timeline.kill();
    /* A theme wipe or hero press can cancel before the incoming leg completes.
       Its clearProps callback never runs after kill(), leaving the live page
       dimmed — or hidden during the overlap delay. Land it on the same clean
       state as a completed fade before releasing the transition. */
    if (page) gsap.set(page, { clearProps: 'opacity,visibility' });
    if (backArrives) gsap.set(backArrives, { clearProps: 'opacity,visibility' });
  });
}

/** The leaving half of every page fade: the FastEffects shape, as a WAAPI easing. */
const LEAVE_EASING = springToLinear(SPRINGS.fastEffects);

/**
 * **The fade a container transform rides, on the container's clock** — a forum post or a folder
 * opening from its list and closing back into it (`takeRouteContainerExpectation`).
 *
 * The page fade's own clock is 400ms — 80ms of overlap and 320ms of `emphasized-decelerate` — and
 * the container's is 250ms on the flight's curve (`lib/forumContainer.ts`): played side by side,
 * a post's card had landed in its row while the list it was landing in was still on its way, and
 * the thread it came from still on screen around it; a second motion after the first. So under a
 * container the fade keeps its own shape — the leaving page out over the first 27% on the
 * FastEffects shape, the arriving one in from a fifth of the way on the emphasized decelerate,
 * the same shares of the same curves — over the container's length, and the two land together.
 *
 * **On the compositor**, as the container is: on the main thread the fade stood still through the
 * long frames a route change starts with while the container went on without it, which is what
 * made them two motions on screen even when they were one on paper. Started in the same frame as
 * the container — both are asked for by the commit that mounts what the container lands on — and
 * one frame ahead, as its legs are, so their first presented frames are one.
 *
 * **And when the route has committed only its fallback, from the frame its page arrives in**
 * (`whenPageArrives`): until then the list stays whole over the hidden page, and the container
 * grows out of its row with the fade around it, as it does when the page commits at once.
 */
function playUnderContainer(
  layer: HTMLElement,
  clone: HTMLElement,
  page: HTMLElement | null,
  chrome: HTMLElement | null,
  slot: HTMLElement | null,
) {
  const full = scaledMs(FORUM_TRANSFORM_MS, 'page');
  if (page) {
    page.style.animation = 'none';
    settleEntryAnimations(page);
  }
  /* **The back affordance is settled when the page arrives, not when the route commits**: a page
     held behind the route's fallback brings its own a commit later, which would otherwise have
     popped in over the list. So the slot is hidden with the page, and `play` reads it then —
     unless both pages already have one, which stays put. */
  const staysPut = chrome !== null && slot !== null && slot.childElementCount > 0;
  const hidden = [page, staysPut ? null : slot].filter((el): el is HTMLElement => el !== null);
  /* Hidden from the commit on, as `autoAlpha` would have it: a focus cannot land in a page no
     one can see yet, and a fallback held under the list is not on screen at all. */
  for (const el of hidden) {
    el.style.opacity = '0';
    el.style.visibility = 'hidden';
  }
  const animations: Animation[] = [];
  let frame = 0;
  const play = () => {
    frame = requestAnimationFrame(() => {
      const arrivingBack = slot !== null && slot.childElementCount > 0;
      /* Between two pages that both have one it stays put, as `PageBack` does: the live one shows
         and its copy goes, with no fade. */
      if (chrome && arrivingBack) chrome.remove();
      const leaving = [clone, chrome && !arrivingBack ? chrome : null].filter((el): el is HTMLElement => el?.isConnected ?? false);
      const arriving = [page, slot && arrivingBack && !chrome ? slot : null].filter((el): el is HTMLElement => el !== null);
      for (const el of hidden) {
        el.style.visibility = '';
        if (!arriving.includes(el)) el.style.opacity = '';
      }
      for (const el of leaving) {
        animations.push(
          el.animate([{ opacity: getComputedStyle(el).opacity }, { opacity: 0 }], {
            duration: full * FADE_SHARE.leave,
            easing: LEAVE_EASING,
            fill: 'forwards',
          }),
        );
      }
      for (const el of arriving) {
        animations.push(
          el.animate([{ opacity: 0 }, { opacity: 1 }], {
            delay: full * FADE_SHARE.arriveDelay,
            duration: full * (1 - FADE_SHARE.arriveDelay),
            easing: EASE.decelerate,
            /* Held at its end too, until the stop below clears the inline 0 it was hidden with:
               otherwise the frame between its end and that stop shows the page hidden again. */
            fill: 'both',
          }),
        );
      }
      for (const animation of animations) animation.currentTime = 1000 / 60;
      void Promise.all(animations.map((animation) => animation.finished)).then(
        () => cancelRouteCrossFade(),
        () => {},
      );
    });
  };
  const held = page?.querySelector('[data-route-fallback]') ? page : null;
  const cancelHold = held ? whenPageArrives(held, play, CONTAINER_HOLD_MS) : null;
  if (!held) play();
  arm(
    layer,
    () => {
      cancelHold?.();
      cancelAnimationFrame(frame);
      for (const animation of animations) animation.cancel();
      for (const el of hidden) {
        el.style.opacity = '';
        el.style.visibility = '';
      }
    },
    held ? CONTAINER_HOLD_MS : 0,
  );
}

/** The page fade's shares of its own 400ms (`PAGE_FADE_TIMING`, and the leaving page's
    FastEffects), for the same fade on another clock. */
const FADE_SHARE = {
  leave: SPRING_MS.fastEffects / (DURATION.long * 1000),
  arriveDelay: PAGE_FADE_TIMING.delay / DURATION.long,
} as const;

