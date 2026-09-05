/**
 * Container transform for opening a forum post.
 *
 * The pressed row's rect crosses the navigation so the post card can grow out of the row you
 * tapped. Deliberately not built on the gallery's `lib/hero/**` flight system — the row and the
 * card are already the same surface here. Composes with the route cross-fade: the card starts at
 * exactly the rectangle the cross-fade's clone still paints, so the two are registered.
 */

import { heroOwnsScreen } from '@/lib/appScroller';
import { motionTier } from '@/lib/appearance';

/** Viewport-space box of the row that was pressed. */
export interface ForumOrigin {
  id: string;
  left: number;
  top: number;
  width: number;
  height: number;
  at: number;
}

/** How long a remembered rect stays usable — long enough for the navigation, short enough
 *  that a back/forward cannot replay a stale rectangle. */
const ORIGIN_TTL_MS = 1500;

let pending: ForumOrigin | null = null;

/** Call on the press, before pushing the route. Nothing is recorded under `off`;
 *  `reduced` still records — the transform degrades to a fade, built in
 *  `playForumContainerTransform` below. */
export function rememberForumOrigin(id: number | string, row: HTMLElement) {
  if (motionTier() === 'off') return;
  /* The gesture-driven warm (see facade). Below the `off` guard: on that tier the transform can
     never run, so warming there would fetch GSAP for an animation that is unreachable. */
  ensurePlay();
  const rect = row.getBoundingClientRect();
  pending = {
    id: String(id),
    left: rect.left,
    top: rect.top,
    width: rect.width,
    height: rect.height,
    at: performance.now(),
  };
}

/** Takes the rect if it belongs to this post and is still fresh.
 *
 *  Deliberately not single-use: it is read from a ref callback, which React re-runs on remounts
 *  (StrictMode's dev remount included), so destroying it on first read would leave the second
 *  attach with nothing. The id match and the TTL bound its lifetime instead. */
export function readForumOrigin(id: number | string): ForumOrigin | null {
  const origin = pending;
  if (!origin || origin.id !== String(id)) return null;
  if (performance.now() - origin.at > ORIGIN_TTL_MS) return null;
  if (origin.width === 0 || origin.height === 0) return null;
  /* Stand down while a flight owns the screen: the premise is that the row is still painted
     where it was, and the cross-fade also stands itself down during a flight. */
  if (heroOwnsScreen()) return null;
  return origin;
}

/**
 * Facade for the container transform, which lives in `lib/forumTransitionPlay.ts` behind a
 * dynamic import. The split keeps GSAP off the app's front door: `rememberForumOrigin` is called
 * by `ForumPostList`, rendered by `/forum` and the home page's forum pane, while the play half is
 * only ever wanted on `/forum/[id]`, one navigation later.
 *
 * The warm is gesture-driven, not timer-driven: recording an origin *is* a press on a post, and
 * the detail route is a network round trip away, so the chunk is fetched exactly when it is about
 * to be needed. If it loses that race the card simply appears.
 */
let play: typeof import('@/lib/forumTransitionPlay') | null = null;
let loading = false;

function ensurePlay() {
  if (play || loading) return;
  loading = true;
  void import('@/lib/forumTransitionPlay').then(
    (module) => {
      play = module;
    },
    () => {
      /* A failed chunk fetch is not retried per press: every open is then a plain appearance. */
    },
  );
}

export function playForumContainerTransform(
  card: HTMLElement,
  content: HTMLElement | null,
  origin: ForumOrigin,
): () => void {
  if (!play) {
    ensurePlay();
    return () => {};
  }
  return play.playForumContainerTransform(card, content, origin);
}
