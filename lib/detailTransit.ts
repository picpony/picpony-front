'use client';

/**
 * The picture detail's entrance and exit **when nothing flies** — a picture opened from a list row
 * with no shared image to carry (浏览历史), from a link in a comment or a message, by Forward, or
 * closed when the card it came from is gone.
 *
 * The overlay's entrance belongs to the hero flight (`.image-detail-route` carries no animation of
 * its own, and the flight requires the standard tier). Below it, globals.css gives the overlay the
 * weak form, a fade and 8px; but in the standard tier an open that did not fly had nothing at all,
 * and every close that did not fly was a cut in every tier. So:
 *
 * - **from a row that asked for it** (`rememberDetailOrigin`, the history list), the row grows
 *   into the overlay and shrinks back into it on the way out — the forum's container transform,
 *   one engine (`lib/containerTransformPlay.ts`), the contents anchored and never scaled;
 * - **otherwise**, the overlay arrives as the reduced tier's does at the standard tier's travel —
 *   a fade and 16px on the enter step — and leaves the same way on the exit step.
 *
 * Nothing here runs while a flight owns the screen, and nothing here imports the hero engine: the
 * runtime store says whether one is running, and the shell reaches this module.
 */

import { motionTier, scaledMs, MOTION_SPEED_SCALE } from '@/lib/appearance';
import { getImageHeroRuntime, isImageHeroTransitionRunning } from '@/lib/hero/runtime';
import { DURATION, EASE } from '@/lib/motionTokens';
import { captureVisualClone, restoreSnapshotScroll, type RouteSnapshot } from '@/lib/pageSnapshot';

/** How long a press on a row stays the reason for the next open: the navigation, with room. */
const ORIGIN_TTL_MS = 3000;
/** Standard travel and the weak form's (AGENTS: "8px is the weak form's travel"). */
const TRAVEL_PX = { standard: 16, reduced: 8 } as const;

let origin: { id: string; at: number } | null = null;

/**
 * The entrance running on each overlay, so a second mount of the same overlay adopts it instead of
 * landing it and starting over. React's development double-invoke of layout effects runs at the
 * passive-effect flush of a transition render — after the first paint — and landed the first
 * container a quarter of the way in, snapping the copy back to the row to grow again (M1-043).
 * A cleanup therefore lands the run a task later, and a remount in between takes it over.
 */
const entrances = new WeakMap<HTMLElement, { stop: () => void; timer: number }>();

/** Overlays whose exit has been played, so the commit that removes one does not play it twice. */
const exited = new WeakSet<HTMLElement>();

let play: typeof import('@/lib/detailTransitPlay') | null = null;
let loading = false;

/** The container transform's chunk, fetched by the press that will want it (as the forum's is). */
function ensurePlay() {
  if (play || loading) return;
  loading = true;
  void import('@/lib/detailTransitPlay').then(
    (module) => {
      play = module;
    },
    () => {
      /* A failed fetch is not retried per press: opens from a row then take the plain arrival. */
    },
  );
}

/** Whether nothing is flying: a flight's own legs own every pixel of the overlay. */
function heroIdle(): boolean {
  const { phase } = getImageHeroRuntime();
  return (phase === 'gallery-idle' || phase === 'detail-idle') && !isImageHeroTransitionRunning();
}

/**
 * Call on the press of a row marked `data-detail-origin={id}`, before the link navigates. Under
 * 减弱 and 关闭 nothing is recorded: the container transform is the standard tier's.
 */
export function rememberDetailOrigin(id: number | string) {
  if (motionTier() !== 'standard') return;
  ensurePlay();
  origin = { id: String(id), at: performance.now() };
}

/** The row a picture was opened from, while it is in the list on screen. */
export function findDetailOriginRow(id: number | string): HTMLElement | null {
  const row = document.querySelector<HTMLElement>(`[data-detail-origin="${CSS.escape(String(id))}"]`);
  if (!row?.isConnected || row.getClientRects().length === 0) return null;
  for (let pane = row.closest('[data-tab-pane]'); pane; pane = pane.parentElement?.closest('[data-tab-pane]') ?? null) {
    if (!pane.hasAttribute('data-tab-pane-active')) return null;
  }
  return row;
}

/** The control inside that row — where focus returns when the picture closes. */
export function findDetailOriginLink(id: number | string): HTMLElement | null {
  return findDetailOriginRow(id)?.querySelector<HTMLElement>('a[href]') ?? null;
}

function travel(): number {
  return motionTier() === 'reduced' ? TRAVEL_PX.reduced : TRAVEL_PX.standard;
}

function adopt(section: HTMLElement, entry: { stop: () => void; timer: number }): () => void {
  return () => {
    window.clearTimeout(entry.timer);
    entry.timer = window.setTimeout(() => {
      if (entrances.get(section) === entry) entrances.delete(section);
      entry.stop();
    }, 0);
  };
}

/**
 * The overlay's entrance, from `PicDetail`'s layout effect on mount — before the first paint, so
 * the full overlay is never shown for a frame first. Returns a cleanup that lands it. The picture
 * is the overlay's own `data-image-hero-route-id`: the route's id, which a step to the next picture
 * does not change.
 */
export function playDetailEntrance(section: HTMLElement): () => void {
  exited.delete(section);
  const running = entrances.get(section);
  if (running) {
    window.clearTimeout(running.timer);
    return adopt(section, running);
  }
  /* 减弱 has its keyframe in globals.css; 关闭 is a cut. */
  if (motionTier() !== 'standard' || !heroIdle()) return () => {};
  const imageId = section.getAttribute('data-image-hero-route-id') ?? '';
  /* Not consumed by reading: the id and the TTL bound it; a close clears it. */
  const pressed = origin && origin.id === imageId && performance.now() - origin.at <= ORIGIN_TTL_MS;
  const row = pressed ? findDetailOriginRow(imageId) : null;
  let stop: (() => void) | null = row && play ? play.playDetailOpen(section, row) : null;
  if (!stop) {
    const arrival = section.animate(
      [
        { opacity: 0, transform: `translateY(${TRAVEL_PX.standard}px)` },
        { opacity: 1, transform: 'none' },
      ],
      { duration: scaledMs(DURATION.long * 1000), easing: EASE.decelerate },
    );
    stop = () => arrival.cancel();
  }
  const entry = { stop, timer: 0 };
  entrances.set(section, entry);
  return adopt(section, entry);
}

/** What a closing overlay looked like, captured before React removes it. */
export interface DetailExitSnapshot {
  id: string;
  snapshot: RouteSnapshot;
  parent: HTMLElement;
  box: DOMRect;
}

/**
 * Called by the shell as the overlay closes: when the hero seals it — a close that has to wait for
 * the router keeps the overlay mounted, hidden, for the whole round trip — or else in the commit
 * that removes it. Either way the overlay is still laid out, with its own column's scroll offset.
 * Null when a flight is carrying it home, under 关闭, when its exit has already been played, or
 * when it is too large to copy.
 */
export function captureDetailExit(): DetailExitSnapshot | null {
  origin = null;
  if (motionTier() === 'off' || !heroIdle()) return null;
  const section = document.querySelector<HTMLElement>('[data-image-detail-overlay]');
  const parent = section?.parentElement;
  if (!section || !parent || exited.has(section)) return null;
  /* An overlay still hidden behind its own entrance has nothing on screen to carry out. */
  if (parseFloat(getComputedStyle(section).opacity) < 0.5) return null;
  const snapshot = captureVisualClone(section, parent);
  if (!snapshot) return null;
  exited.add(section);
  /* The hero's seal is on the overlay as it is copied (`visibility: hidden`, on it and on its back
     affordance): the copy is what the overlay looked like before it, not after. The fade path
     never cleared it, so every close that took it was invisible — a cut (M1-042). */
  const node = snapshot.node;
  node.style.visibility = 'visible';
  node.style.opacity = '';
  node.removeAttribute('inert');
  for (const back of node.querySelectorAll<HTMLElement>('[data-image-detail-floating-back]')) back.style.visibility = '';
  return { id: section.getAttribute('data-image-hero-route-id') ?? '', snapshot, parent, box: section.getBoundingClientRect() };
}

/** The overlay is on screen again (Forward before the router committed the close): its next close
    plays an exit of its own. */
export function forgetDetailExit() {
  const section = document.querySelector<HTMLElement>('[data-image-detail-overlay]');
  if (section) exited.delete(section);
}

/**
 * The exit, played as soon as its copy is taken: back into the row it came from when that row is
 * on screen (standard tier), otherwise a fade and a short drop on the exit step — leaving is
 * quicker than arriving.
 */
export function playDetailExit(exit: DetailExitSnapshot) {
  const row = motionTier() === 'standard' && play ? findDetailOriginRow(exit.id) : null;
  if (row && play && play.playDetailReturn(exit, row)) return;
  const node = exit.snapshot.node;
  node.inert = true;
  node.setAttribute('aria-hidden', 'true');
  node.setAttribute('data-detail-exit', '');
  node.style.pointerEvents = 'none';
  exit.parent.appendChild(node);
  restoreSnapshotScroll(exit.snapshot);
  const leaving = node.animate(
    [
      { opacity: 1, transform: 'none' },
      { opacity: 0, transform: `translateY(${travel()}px)` },
    ],
    { duration: scaledMs(DURATION.short * 1000), easing: EASE.accelerate, fill: 'forwards' },
  );
  const remove = () => node.remove();
  leaving.finished.then(remove, remove);
  /* By the wall-clock rule, in case the animation never settles (a frozen tab). */
  window.setTimeout(remove, DURATION.short * 1000 * MOTION_SPEED_SCALE.slow + 300);
}
