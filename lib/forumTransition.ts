/**
 * Container transform for opening a forum post.
 *
 * The pressed row's rectangle is handed across the navigation so the post's
 * card can grow out of exactly the row you tapped, instead of the generic
 * cross-fade every other route gets. It is deliberately not built on
 * `lib/hero/**`: that system owns the gallery's shared-element flight — a
 * flyer over a frozen, transformed background, with its own history bridge —
 * and none of that is needed here, because the list row and the post card are
 * already the same surface at the same tone.
 *
 * It also composes with the route cross-fade rather than standing it down. The
 * clone the cross-fade paints still shows the row where the row was, and the
 * card starts at exactly that rectangle, so the two are registered: the clone
 * fades off a container that is growing out from underneath it, which is what
 * the transform is supposed to look like.
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

/**
 * How long a remembered rect stays usable.
 *
 * Long enough to cover the navigation, short enough that a back/forward or a
 * later direct visit to the same post cannot pick up a stale rectangle and
 * grow the card out of wherever the row happened to be some minutes ago.
 */
const ORIGIN_TTL_MS = 1500;

let pending: ForumOrigin | null = null;

/** Call on the press, before pushing the route.
 *
 * Nothing is remembered under `off`, so `readForumOrigin` finds nothing and the transform
 * never runs. `reduced` still records: the transform degrades to a fade rather than
 * vanishing, and that fade is built in `playForumContainerTransform` below. */
export function rememberForumOrigin(id: number | string, row: HTMLElement) {
  if (motionTier() === 'off') return;
  /* A press on a post is the signal that the transform is about to be wanted. See the facade.
     Below the `off` guard rather than above it: this fetches the play half and therefore GSAP,
     and on that tier the transform can never run — so above the guard it downloaded the engine
     on the first press of any forum row to serve an animation that is unreachable. */
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
 * Deliberately *not* single use. It is read from a ref callback, and React
 * runs those again on any remount — including the one StrictMode simulates in
 * development, measured here as attach / detach / attach 32ms apart. A rect
 * that destroyed itself on the first read therefore left the second attach
 * with nothing, and the flight never played at all in dev. The id match and
 * the TTL are what bound its lifetime instead: a rect can only be used by the
 * post whose row was pressed, and only for about as long as a navigation
 * plausibly takes. */
export function readForumOrigin(id: number | string): ForumOrigin | null {
  const origin = pending;
  if (!origin || origin.id !== String(id)) return null;
  if (performance.now() - origin.at > ORIGIN_TTL_MS) return null;
  if (origin.width === 0 || origin.height === 0) return null;
  /* Stand down while a flight owns the screen. This transition's whole premise is
     that the row is still painted where the row was — the cross-fade's clone shows
     it, so the card can start at exactly that rectangle — and the cross-fade stands
     itself down during a flight. Nothing here did, so the card grew out of a
     rectangle with nothing under it. Gated here rather than at the call site because
     the TTL check already lives here: no origin, no transform. */
  if (heroOwnsScreen()) return null;
  return origin;
}

/**
 * The container transform itself lives in `lib/forumTransitionPlay.ts`, behind a dynamic import,
 * and this is the facade for it.
 *
 * The split is about who reaches what. `rememberForumOrigin` is called by `ForumPostList`, which
 * is rendered by `/forum` **and by the home page's forum pane** — so a function that records a
 * `getBoundingClientRect` was putting GSAP and its five plugins into the app's front door. The
 * transform itself is only ever wanted on `/forum/[id]`, one navigation later.
 *
 * The warm is driven by the gesture rather than by a timer: recording an origin *is* a press on a
 * post, and the detail route is a network round trip away, so the chunk is fetched exactly when it
 * is about to be needed and never otherwise. If it loses that race the card simply appears, which
 * is what `motionTier() === 'off'` gives today.
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
      /* A failed chunk fetch is not retried per press: every open is then a plain appearance,
         which is what the module's absence already means. */
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
