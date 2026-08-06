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

import { gsap, prefersReducedMotion } from '@/lib/motion';

/** Viewport-space box of the row that was pressed. */
interface ForumOrigin {
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

/** Call on the press, before pushing the route. */
export function rememberForumOrigin(id: number | string, row: HTMLElement) {
  if (prefersReducedMotion()) return;
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
  return origin;
}

/**
 * Grows `card` from `origin` to wherever it has just been laid out.
 *
 * A FLIP: the card is already in its final position, so the tween only has to
 * put it back at the origin and release it. The scale is non-uniform, which
 * would smear the text — hence `content`, which is held out and faded in over
 * the back half. That is the spec's own answer, and it is why a container
 * transform reads as one surface changing shape rather than as a page being
 * zoomed.
 *
 * Returns a cleanup that reverts everything, for a navigation that unmounts
 * mid-flight.
 */
export function playForumContainerTransform(
  card: HTMLElement,
  content: HTMLElement | null,
  origin: ForumOrigin,
): () => void {
  const to = card.getBoundingClientRect();
  if (to.width === 0 || to.height === 0) return () => {};

  const timeline = gsap.timeline().fromTo(
    card,
    {
      x: origin.left - to.left,
      y: origin.top - to.top,
      scaleX: origin.width / to.width,
      scaleY: origin.height / to.height,
      transformOrigin: 'top left',
    },
    {
      x: 0,
      y: 0,
      scaleX: 1,
      scaleY: 1,
      duration: 0.4,
      ease: 'decelerate',
      /* Nothing may keep a transform: this card is an ancestor of the post's
           images, and a residual one would make it a containing block for any
           fixed descendant. */
      clearProps: 'transform,transformOrigin,willChange',
    },
    0,
  );

  if (content) {
    timeline.fromTo(
      content,
      { autoAlpha: 0 },
      { autoAlpha: 1, duration: 0.25, ease: 'none', clearProps: 'opacity,visibility' },
      0.15,
    );
  }

  return () => {
    timeline.kill();
    gsap.set(content ? [card, content] : card, {
      clearProps: 'transform,transformOrigin,opacity,visibility,willChange',
    });
  };
}
