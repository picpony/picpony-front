/**
 * Container transform for opening a forum post, and its reverse.
 *
 * Which post was pressed, and which card was left, cross the navigation here; the transform
 * itself (`lib/forumTransitionPlay.ts`, geometry and clock in `lib/forumContainer.ts`) carries the
 * row into the card and the card back into the row inside one rounded container, the contents
 * never scaled. Deliberately not built on the gallery's `lib/hero/**` flight system, but the same
 * construction in miniature. Composes with the route cross-fade: the outgoing content is taken
 * from its still frame, so the two are registered to the pixel.
 *
 * **The card opens on the row's own data** (`rememberForumOrigin`'s `preview`). A list row carries
 * the whole post — title, author, body — so the thread renders its card complete in the frame it
 * mounts, and the transform lands on the card's real size. It used to land on the loading card,
 * which then jumped to the post's height in one frame when the thread arrived (R6-037); only the
 * replies wait for the network now.
 */

import { heroOwnsScreen } from '@/lib/appScroller';
import { motionTier } from '@/lib/appearance';
import type { ForumPost } from '@/lib/types/forum';

/** Viewport-space box of the row that was pressed, or of the card that was left. */
export interface ForumOrigin {
  id: string;
  left: number;
  top: number;
  width: number;
  height: number;
  at: number;
}

/** How long a remembered rect stays usable — long enough for the navigation (a development
 *  build, or a phone, can spend over a second between the press and the commit), short enough
 *  that a back/forward cannot replay a stale rectangle. */
const ORIGIN_TTL_MS = 3000;
/** A preview outlives the flight: it is what a thread shows while its own read is in flight. */
const PREVIEW_TTL_MS = 5 * 60 * 1000;
const PREVIEW_MAX = 24;

let pending: ForumOrigin | null = null;
let returning: ForumOrigin | null = null;
/** The thread last left, on every tier: its row takes the focus back (`readForumLeft`). */
let left: { id: string; at: number } | null = null;
const previews = new Map<string, { post: ForumPost; at: number }>();

function boxOf(id: number | string, el: HTMLElement): ForumOrigin {
  const rect = el.getBoundingClientRect();
  return { id: String(id), left: rect.left, top: rect.top, width: rect.width, height: rect.height, at: performance.now() };
}

/** Hands the thread the row's copy of the post, so it opens complete (see the note above). */
export function rememberForumPreview(post: ForumPost) {
  const key = String(post.id);
  previews.delete(key);
  previews.set(key, { post, at: performance.now() });
  while (previews.size > PREVIEW_MAX) previews.delete(previews.keys().next().value as string);
}

/** The post as the list last showed it, while it is fresh enough to stand in for the thread's. */
export function readForumPreview(id: number | string): ForumPost | null {
  const entry = previews.get(String(id));
  if (!entry || performance.now() - entry.at > PREVIEW_TTL_MS) return null;
  return entry.post;
}

/** Call on the press, before pushing the route. Nothing is recorded under `off`, and the
 *  transform plays under `standard` only (under `reduced` the route's own fade is the whole
 *  transition). The preview is recorded on every tier. */
export function rememberForumOrigin(id: number | string, row: HTMLElement, preview?: ForumPost) {
  if (preview) rememberForumPreview(preview);
  if (motionTier() !== 'standard') return;
  /* The gesture-driven warm (see facade). Below the tier guard: on the other tiers the
     transform never runs, so warming there would fetch a chunk that is unreachable. */
  ensurePlay();
  pending = boxOf(id, row);
}

function fresh(origin: ForumOrigin | null, id: number | string): ForumOrigin | null {
  if (!origin || origin.id !== String(id)) return null;
  if (performance.now() - origin.at > ORIGIN_TTL_MS) return null;
  if (origin.width === 0 || origin.height === 0) return null;
  /* Stand down while a flight owns the screen: the premise is that the row is still painted
     where it was, and the cross-fade also stands itself down during a flight. */
  if (heroOwnsScreen()) return null;
  return origin;
}

/** Takes the rect if it belongs to this post and is still fresh.
 *
 *  Deliberately not single-use: it is read from a ref callback, which React re-runs on remounts
 *  (StrictMode's dev remount included), so destroying it on first read would leave the second
 *  attach with nothing. The id match and the TTL bound its lifetime instead.
 *
 *  Also an origin with no press behind it: Forward while this post's card was still closing back
 *  into its row, which the card then turns back out of (`lib/routeContainerPlay.ts`). */
export function readForumOrigin(id: number | string): ForumOrigin | null {
  const origin = fresh(pending, id);
  if (origin || !play?.forumReturnInFlight(String(id)) || heroOwnsScreen()) return origin;
  return { id: String(id), left: 0, top: 0, width: 0, height: 0, at: performance.now() };
}

/**
 * The card's rect as the thread is left, for the row to grow back out of (`playForumReturn`).
 * Recorded while the card is still laid out — its ref's detach, which runs before React removes
 * the node — and only for a card that was on screen: a row cannot come back from somewhere the
 * reader could not see.
 */
export function rememberForumReturn(id: number | string, card: HTMLElement) {
  left = { id: String(id), at: performance.now() };
  if (motionTier() !== 'standard') return;
  const box = boxOf(id, card);
  if (box.top >= window.innerHeight || box.top + box.height <= 0) return;
  ensurePlay();
  returning = box;
}

/** The card the list was just left from, while it is fresh. Not consumed by reading — the list
 *  reads it from an effect React may run twice — but by `clearForumReturn` once it plays. */
export function readForumReturn(): ForumOrigin | null {
  return returning && fresh(returning, returning.id);
}

export function clearForumReturn() {
  returning = null;
}

/**
 * The thread the reader has just left, on every tier, for the list's row of it to take the focus
 * back (`components/ForumPostList.tsx` marks it; the shell's route landing prefers the mark to the
 * page's heading). A moment's grace (`ORIGIN_TTL_MS`), then nothing; not consumed by reading, since
 * the list reads it from an effect React may run twice.
 */
export function readForumLeft(): string | null {
  return left && performance.now() - left.at <= ORIGIN_TTL_MS ? left.id : null;
}

/**
 * Facade for the container transform, which lives in `lib/forumTransitionPlay.ts` behind a
 * dynamic import. The split keeps it off the app's front door: `rememberForumOrigin` is called
 * by `ForumPostList`, rendered by the home page's forum pane, while the play half is only ever
 * wanted one navigation later.
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

/** Opening: the pressed row grows into `card`, which has just mounted. */
export function playForumContainerTransform(card: HTMLElement, origin: ForumOrigin): () => void {
  if (!play) {
    ensurePlay();
    return () => {};
  }
  return play.playForumContainerTransform(card, origin);
}

/** The reverse: the card the thread was left from shrinks back into `row`. */
export function playForumReturn(row: HTMLElement, origin: ForumOrigin): () => void {
  if (!play) return () => {};
  return play.playForumReturn(row, origin);
}
