'use client';

import {
  memo,
  startTransition,
  useDeferredValue,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from 'react';
import { flushSync } from 'react-dom';
import type { ImagePreview } from '@/lib/types/image';
import { createPagedSequence, type ImageSequenceSource } from '@/lib/imageSequence';
import {
  findCard,
  gridGeometry,
  MASONRY_COLUMN_COUNTS,
  masonryLayout,
  placedHeight,
  scrollCardIntoView,
  slotBox,
  slotsInBand,
} from '@/lib/masonry';
import { getAppScroller } from '@/lib/appScroller';
import { motionTier } from '@/lib/appearance';
import { springTiming } from '@/lib/springTiming';
import { StaggerGrid } from '@/lib/motionLazy';
import { SKIP, useResource } from '@/lib/resource';
import { useMounted } from '@/lib/overlay';
import { siteCommentCounts } from '@/lib/resources';
import { describeImage } from '@/lib/imageDescription';
import { TOUCH_SLOP_PX } from '@/lib/ripple';
import { cn } from '@/lib/utils';
import ImageCard from './ImageCard';
import CheckGlyph from './CheckGlyph';

/**
 * A grid that can select its cards (the favourites' batch mode). Outside the mode a card is the
 * gallery's own; inside it, a press, a tap or Space on a card toggles it rather than opening the
 * picture. The caller owns what is selected and what the mode is (`useSelectionMode`).
 */
export interface GridSelection {
  /** The mode is on: every card is a checkbox over its picture. */
  active: boolean;
  selected: ReadonlySet<number>;
  /** A card's toggle; `range` when Shift was held (select through to the last one toggled). */
  onToggle: (id: number, range: boolean) => void;
  /** A long press under a finger, outside the mode: enter it with this card selected. */
  onLongPress?: (id: number) => void;
}

interface MasonryGridProps {
  images: ImagePreview[];
  /** A swapping tab pane already owns the entrance of its contents. */
  entrance?: boolean;
  /**
   * The list this grid shows, so the detail's 上一张 / 下一张 step in its order
   * (`lib/imageSequence.ts`). A paged list passes `createPagedSequence`; without one the grid's
   * own page is the sequence.
   */
  sequence?: ImageSequenceSource;
  /**
   * Which list the rows belong to — route, query, owner, sort, filter; `sequence.key` when
   * omitted. A new page of the same list renders in the background; rows of a different list
   * render at once (see below).
   */
  listKey?: string;
  /**
   * PicPony's comment counts, when the list already has them (本站讨论's rows carry them). Without
   * it the grid asks for its page's counts itself, once, and never waits for them.
   */
  siteComments?: Record<number, number>;
  /** The selection mode, for a grid whose cards can be selected; absent, the grid is the gallery's alone. */
  selection?: GridSelection;
}

const EMPTY_IDS: readonly number[] = [];

/** Brings the card for `id` into view, when the grid named `grid` has it. Found by its
 * attribute rather than through the ref: a ref inside the sequence built during render is one
 * the React Compiler cannot prove is read only later, and it skipped the whole grid for it. */
function revealCard(grid: string, id: number): boolean {
  const card = findCard(document.querySelector(`[data-masonry-grid="${CSS.escape(grid)}"]`), id);
  if (!card) return false;
  scrollCardIntoView(card);
  return true;
}

/**
 * Whether every tab pane around `el` is the shown one. Geometry read inside a concealed pane makes
 * the engine lay the hidden subtree out just to answer (AGENTS), so a grid there is not measured.
 */
function inShownPanes(el: Element): boolean {
  for (let pane = el.closest('[data-tab-pane]'); pane; pane = pane.parentElement?.closest('[data-tab-pane]') ?? null) {
    if (!pane.hasAttribute('data-tab-pane-active')) return false;
  }
  return true;
}

/** A picture that has just left the list on screen, held in the slot it had while it fades. */
interface Leaver {
  image: ImagePreview;
  /** Its placement in the list it left. */
  style: Record<string, string>;
  index: number;
  /** The live card it follows in the DOM, so React never moves it; `null` ahead of the first. */
  after: number | null;
}

/** An edit of the list on screen — what the moves and the height hold start from. */
interface Edit {
  /** Every surviving picture's placement in the previous list. */
  from: Map<number, Record<string, string>>;
  /** The previous list's placement, whole: the height the page had under the grid. */
  items: Record<string, string>[];
  /** The previous list's grid heights (`--mh2` …), as CSS — what the edit's own commit holds. */
  height: Record<string, string>;
}

/** The cards a grid has mounted: a run of its list, and whether it is still to be aimed. */
interface MountedRun {
  list: ImagePreview[];
  key: string;
  from: number;
  to: number;
  aim: boolean;
  /** Pictures that left in an edit, still fading in their old slots. */
  leaving: Leaver[];
  /** Set by the commit that edits the list in place, for the layout effect that plays it. */
  edit: Edit | null;
}

/**
 * A new page mounts in chunks: the first screen's worth with the page, the rest a chunk per
 * frame. Twelve is three rows at four columns — what a page turn lands on at the list's top.
 */
const FIRST_CHUNK = 12;
const CHUNK = 12;

/**
 * **What changed, when the same list changes.** Pictures it already showed, still in it, mean
 * the list was *edited* — a removal, a picture shifted in from the next page behind it, a refresh
 * that found a few new ones — and every card stays mounted. Nothing in common means a *page
 * turn*. A list that would bring more than a chunk of newcomers is treated as a page turn too:
 * mounting them all with the edit is the long task the chunks exist to avoid (R12-010).
 */
function editOf(rendered: MountedRun, images: ImagePreview[]): MountedRun | null {
  const previous = rendered.list;
  if (previous.length === 0) return null;
  const nextIndex = new Map(images.map((image, index) => [image.id, index]));
  const kept = previous.filter((image) => nextIndex.has(image.id)).length;
  if ((kept === 0 && images.length > 0) || images.length - kept > CHUNK) return null;

  /* What stays mounted: every card that was, wherever the edit put it, and whatever arrived in
     between. A run that had finished mounting stays finished. */
  const complete = rendered.from <= 0 && rendered.to >= previous.length;
  let lo = images.length;
  let hi = 0;
  for (const image of previous.slice(rendered.from, rendered.to)) {
    const index = nextIndex.get(image.id);
    if (index === undefined) continue;
    lo = Math.min(lo, index);
    hi = Math.max(hi, index + 1);
  }
  const range = complete
    ? { from: 0, to: images.length }
    : lo < hi
      ? { from: lo, to: hi }
      : { from: 0, to: Math.min(images.length, FIRST_CHUNK) };

  const before = masonryLayout(previous);
  const from = new Map<number, Record<string, string>>();
  previous.forEach((image, index) => {
    if (nextIndex.has(image.id)) from.set(image.id, before.items[index]);
  });

  /* Under 关闭 nothing is kept to fade: what left is simply gone, as everything else is a cut. */
  const motion = typeof document !== 'undefined' && motionTier() !== 'off';
  const live = new Set(images.slice(range.from, range.to).map((image) => image.id));
  const leaving: Leaver[] = [];
  if (motion) {
    /* Still fading from an earlier edit, unless it came back (撤销): then it is live again. */
    for (const leaver of rendered.leaving) {
      if (nextIndex.has(leaver.image.id)) continue;
      leaving.push(leaver.after !== null && live.has(leaver.after) ? leaver : { ...leaver, after: null });
    }
    previous.forEach((image, index) => {
      if (nextIndex.has(image.id) || index < rendered.from || index >= rendered.to) return;
      let after: number | null = null;
      for (let j = index - 1; j >= 0 && after === null; j -= 1) {
        if (live.has(previous[j].id)) after = previous[j].id;
      }
      leaving.push({ image, style: before.items[index], index, after });
    });
  }
  return {
    list: images,
    key: rendered.key,
    ...range,
    aim: false,
    leaving,
    edit: { from, items: before.items, height: before.grid },
  };
}

/* ---------------------------------------------------------------------------
 * Playing an edit
 *
 * The cards are placed by CSS, so an edit is one commit that hands every surviving card its new
 * slot — and without this, that commit was the motion: cards jumped across columns in one frame
 * (M1-001). Both slots are known from the placements alone, so each moved card gets one
 * compositor `translate` from where it was to where it is, on the spatial spring; what left fades
 * where it was, on the effects one; and whatever follows the grid on the page glides by the height
 * the grid gained or lost, so nothing after it jumps either.
 * ------------------------------------------------------------------------ */

const FOLLOWER_MARGIN = 200;

/**
 * What comes after the grid in its column and is on screen: the later siblings of the grid's box
 * and of each of its ancestors, up to the page — the pager, the room a selection bar keeps, the
 * page's footer. Only what flows: a sticky bar is where the viewport puts it, not the grid.
 */
function followersOf(from: HTMLElement): HTMLElement[] {
  const result: HTMLElement[] = [];
  const bottom = window.innerHeight + FOLLOWER_MARGIN;
  for (let node: HTMLElement | null = from; node && !node.hasAttribute('data-page-content'); node = node.parentElement) {
    for (let sibling = node.nextElementSibling; sibling; sibling = sibling.nextElementSibling) {
      if (!(sibling instanceof HTMLElement)) continue;
      const position = getComputedStyle(sibling).position;
      if (position === 'sticky' || position === 'fixed' || position === 'absolute') continue;
      const rect = sibling.getBoundingClientRect();
      if (rect.height > 0 && rect.top < bottom && rect.bottom > -FOLLOWER_MARGIN) result.push(sibling);
    }
  }
  return result;
}

/** The translation a running move is showing right now, read off the element's computed style. */
function currentShift(el: HTMLElement): { x: number; y: number } {
  const transform = getComputedStyle(el).transform;
  if (!transform || transform === 'none') return { x: 0, y: 0 };
  const matrix = new DOMMatrixReadOnly(transform);
  return { x: matrix.m41, y: matrix.m42 };
}

/** The height hold: a `min-height` on the grid, and the watch that lets it go. */
interface Hold {
  /** In pixels; 0 once it has been let go. */
  floor: number;
  /** Stops watching, leaving the floor where it is — the next edit re-measures it. */
  stop: () => void;
}

/**
 * The grid's style for the commit that edits its list: each count's height at the larger of its
 * two placements, so the first layout after the commit — whoever forces it — still has the page
 * the reader was looking at, and nothing clamps the offset before `playEdit` has measured what the
 * page may lose. It is the render's because no effect can be sure of running first: `playEdit`
 * wrote this hold itself, first thing, after a style read for the column count — and that read
 * laid the page out (the grid is inside a size container), clamping the offset at a folder's end
 * by 28px before the hold existed (measured at 1440). One per column count, as the stylesheet
 * picks, so no script has to ask which.
 */
function heldGrid(grid: Record<string, string>, before: Record<string, string>): Record<string, string> {
  const held = { ...grid };
  for (const count of MASONRY_COLUMN_COUNTS) {
    const key = `--mh${count}`;
    if (grid[key] && before[key]) held[key] = `max(${grid[key]}, ${before[key]})`;
  }
  return held;
}

/**
 * Plays one edit, from a commit whose render held the grid at its old height (`heldGrid`), so the
 * reads see the page as it was on screen. Scroll anchoring is off for the layouts this makes, or it
 * would move the whole page to follow a card the edit just moved. It reads which cards moved and
 * by how much (from the placements, plus whatever a move still in flight was showing) and what the
 * grid's height becomes — and if shrinking it would pull the offset back, it keeps a floor of
 * exactly the height that keeps it, let go on the first scroll that no longer needs it (the tab
 * driver's rule, `holdFloor`). Then it lets the render's hold go. The floor is kept under every
 * tier — an offset is state, not decoration — and only the motion is the tier's: under 关闭 the
 * cards are simply where they now are.
 */
function playEdit({
  grid,
  edit,
  items,
  heights,
  ids,
  moves,
  hold,
  setHold,
  placement,
  onLeft,
}: {
  grid: HTMLElement;
  edit: Edit;
  /** The new placement, in list order, its grid heights, and the ids it is for. */
  items: readonly Record<string, string>[];
  heights: Record<string, string>;
  ids: readonly number[];
  moves: Map<HTMLElement, Animation>;
  hold: Hold | null;
  setHold: (hold: Hold | null) => void;
  /** The placement on screen whenever a held floor is checked — the latest, not this edit's. */
  placement: () => readonly Record<string, string>[];
  onLeft: (id: number) => void;
}) {
  const motion = motionTier() !== 'off';
  const scroller = grid.closest<HTMLElement>('[data-app-scroll-container]') ?? getAppScroller();
  const anchoring = scroller?.style.overflowAnchor ?? '';
  if (scroller) scroller.style.overflowAnchor = 'none';

  /* Reads. */
  const geometry = gridGeometry(grid);
  const index = new Map(ids.map((id, at) => [id, at]));
  const slots = [...grid.children].filter((el): el is HTMLElement => el instanceof HTMLElement);
  const shifts = new Map<HTMLElement, { x: number; y: number }>();
  for (const el of moves.keys()) if (el.isConnected) shifts.set(el, currentShift(el));
  let floor = 0;
  let followers: HTMLElement[] = [];
  let lift = 0;
  if (geometry && scroller) {
    /* The height the page had under the grid — its old placement, or the floor it was held at. */
    const before = Math.max(placedHeight(edit.items, geometry), hold?.floor ?? 0);
    const natural = placedHeight(items, geometry);
    if (natural < before - 0.5) {
      const need = scroller.scrollTop + scroller.clientHeight - (scroller.scrollHeight - geometry.rect.height);
      if (need > natural + 0.5) floor = Math.ceil(Math.min(need, before));
    }
    lift = Math.max(natural, floor) - before;
    if (motion && Math.abs(lift) >= 0.5) followers = followersOf(grid.parentElement ?? grid);
  }

  /* Writes: the render's hold let go, the floor in its place where the offset needs one. */
  hold?.stop();
  for (const count of MASONRY_COLUMN_COUNTS) {
    const key = `--mh${count}`;
    if (heights[key]) grid.style.setProperty(key, heights[key]);
  }
  grid.style.minHeight = floor ? `${floor}px` : '';
  void grid.offsetHeight;
  if (scroller) scroller.style.overflowAnchor = anchoring;
  setHold(floor && scroller ? watchFloor(grid, scroller, floor, placement) : null);
  if (!geometry || !motion) return;

  const move = springTiming('defaultSpatial');
  const track = (el: HTMLElement, animation: Animation) => {
    moves.get(el)?.cancel();
    moves.set(el, animation);
    const forget = () => {
      if (moves.get(el) === animation) moves.delete(el);
    };
    animation.finished.then(forget, forget);
  };

  for (const el of slots) {
    const id = Number(el.dataset.masonryId);
    if (el.hasAttribute('data-masonry-leaving')) {
      if (el.dataset.masonryFade !== undefined) continue;
      el.dataset.masonryFade = '';
      /* From wherever a move still in flight had it: the fade takes the transform over. */
      const shift = shifts.get(el);
      const at = shift ? `translate(${shift.x}px, ${shift.y}px)` : '';
      moves.get(el)?.cancel();
      const fade = el.animate(
        [{ opacity: 1, transform: at || 'none' }, { opacity: 0, transform: `${at} scale(0.92)` }],
        { ...springTiming('fastEffects'), fill: 'forwards' },
      );
      fade.finished.then(() => onLeft(id), () => {});
      continue;
    }
    /* Back from leaving (撤销): its fade is cancelled, and it comes in like an arrival. */
    const returning = el.dataset.masonryFade !== undefined;
    if (returning) {
      delete el.dataset.masonryFade;
      for (const animation of el.getAnimations()) animation.cancel();
    }
    const at = index.get(id);
    const was = edit.from.get(id);
    if (at === undefined) continue;
    if (!was || returning) {
      el.animate([{ opacity: 0 }, { opacity: 1 }], springTiming('defaultEffects'));
      track(el, el.animate([{ transform: 'scale(0.92)' }, { transform: 'none' }], move));
      continue;
    }
    const from = slotBox(was, geometry);
    const to = slotBox(items[at], geometry);
    const shift = shifts.get(el) ?? { x: 0, y: 0 };
    const dx = from.x - to.x + shift.x;
    const dy = from.y - to.y + shift.y;
    if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5) {
      moves.get(el)?.cancel();
      continue;
    }
    track(el, el.animate([{ transform: `translate(${dx}px, ${dy}px)` }, { transform: 'none' }], move));
  }

  for (const el of followers) {
    const shift = shifts.get(el) ?? { x: 0, y: 0 };
    track(el, el.animate([{ transform: `translateY(${shift.y - lift}px)` }, { transform: 'none' }], move));
  }
}

/**
 * A floor held under the grid, let go on the first scroll that no longer needs it: once the page
 * without it would still reach the bottom of the viewport, taking it away changes nothing on screen.
 */
function watchFloor(
  grid: HTMLElement,
  scroller: HTMLElement,
  floor: number,
  placement: () => readonly Record<string, string>[],
): Hold {
  let frame = 0;
  const hold: Hold = { floor, stop: () => {} };
  const check = () => {
    frame = 0;
    const now = gridGeometry(grid);
    if (!grid.isConnected || !now) {
      hold.stop();
      return;
    }
    const rest = scroller.scrollHeight - now.rect.height;
    if (scroller.scrollTop + scroller.clientHeight <= rest + placedHeight(placement(), now) + 1) {
      grid.style.minHeight = '';
      hold.floor = 0;
      hold.stop();
    }
  };
  const onScroll = () => {
    if (!frame) frame = requestAnimationFrame(check);
  };
  hold.stop = () => {
    scroller.removeEventListener('scroll', onScroll);
    if (frame) cancelAnimationFrame(frame);
    frame = 0;
  };
  scroller.addEventListener('scroll', onScroll, { passive: true });
  return hold;
}

/**
 * The gallery grid. **Placed by CSS, not chosen in script** — see `lib/masonry.ts`: every card's
 * slot is computed for each column count and a media query picks the set, so the server's HTML
 * is the right layout on a phone and a desktop alike, hydration renders exactly what the server
 * sent, and crossing a breakpoint moves boxes rather than remounting cards (and re-requesting
 * their images). The cards are one flat list keyed on the image id, in feed order.
 *
 * **A list, to assistive technology** (C8): a `list` of `listitem`s with their position and the
 * page's size, so a screen reader announces "3 of 50" and walks the pictures in the feed's order —
 * the DOM order, which is also the order the placement fills the columns in.
 *
 * **A new page lands in a deferred render, a chunk at a time.** The resource store publishes
 * synchronously, and a page of fifty cards rendered in the same task blocked input for over a
 * second on a slow phone right as the content arrived (R12-010). `useDeferredValue` keeps the
 * published render cheap — the grid still shows the page it had — and the new page mounts in
 * chunks of twelve, one per frame, each in a transition, so no commit carries more than a chunk
 * of cards. Every slot is placed from the start, so the grid's height never changes as the
 * chunks arrive. The server's list hydrates whole: it is already painted.
 *
 * **Only a page turn is deferred — never a change of list.** Rows of a different list (`listKey`)
 * are a restoration, not an arrival: a cached Back to another search, say. Deferred, the previous
 * list's pictures stood under the restored caption for a render and the restored scroll offset
 * was clamped against *their* height; so a new list renders at once. It does not mount whole —
 * that was one long task of fifty cards: its first chunk mounts with it, the viewport is checked
 * before the first paint (from the placement's own numbers) and any slot it shows that the chunk
 * lacks is mounted then, and the rest follows a chunk a frame. A client mount is handled the same,
 * and so is a page turn: its glide is still on its way to the list's top when the page lands, and
 * a first chunk mounted up there left the viewport bare for two to four frames (M1-033).
 *
 * **An edit is neither** (`editOf`): a picture removed, one shifted in behind it. Every card stays
 * mounted — no chunk restart, no remount, no image read again — and the edit plays (`playEdit`):
 * the cards that moved glide from their old slot to their new one, what left fades where it was,
 * and the page under the grid follows its height instead of jumping. A press lands every move at
 * once, so the hero flight never measures a card mid-glide (AGENTS: no residual transform on a
 * gallery card's ancestor).
 */
export default memo(function MasonryGrid({
  images: latestImages,
  entrance = true,
  sequence,
  listKey,
  siteComments,
  selection,
}: MasonryGridProps) {
  const listId = useId();
  const key = listKey ?? sequence?.key ?? `grid:${listId}`;
  const latest = useMemo(() => ({ images: latestImages, key }), [latestImages, key]);
  const deferred = useDeferredValue(latest);
  const shown = deferred.key === latest.key ? deferred : latest;
  const images = shown.images;
  const layout = useMemo(() => masonryLayout(images), [images]);

  /* Cards cascade in individually (one whole-grid fade read as a page redraw). The cascade
     targets each `.image-card` rather than its slot — the hero flight measures a descendant
     of the card, and the slot is only a positioned box. `deps` re-evaluates the hook's
     empty-grid check when rows land; it does not replay the cascade on a page turn or a
     reflow — `useStaggerGridOn` latches once per mount. */
  const gridRef = useRef<HTMLDivElement>(null);
  const mounted = useMounted();
  /* Which cards are mounted: a run `[from, to)` of the list, grown a chunk a frame until it holds
     them all. `aim` means the run is still to be pointed at the viewport (below). */
  const [rendered, setRendered] = useState<MountedRun>(() => ({
    list: images,
    key: shown.key,
    from: 0,
    to: mounted ? Math.min(images.length, FIRST_CHUNK) : images.length,
    aim: mounted,
    leaving: [],
    edit: null,
  }));
  /* What to mount of a list that just arrived: the same pictures in a new array (a refresh) what
     was already mounted; an edit of the list on screen everything it had (`editOf`); a page turn
     its first chunk, aimed; and a list new to this grid — a client mount, a change of list — its
     first chunk too, aimed. */
  const arriving = (): MountedRun => {
    const first = Math.min(images.length, FIRST_CHUNK);
    const fresh = { list: images, key: shown.key, from: 0, to: first, aim: true, leaving: [], edit: null };
    if (rendered.key !== shown.key) return fresh;
    const same =
      rendered.list.length === images.length && rendered.list.every((image, index) => image.id === images[index]?.id);
    if (same) return { ...rendered, list: images, to: Math.min(images.length, rendered.to), edit: null };
    return editOf(rendered, images) ?? fresh;
  };
  const current = rendered.list === images && rendered.key === shown.key;
  const run = current ? rendered : arriving();
  if (!current) setRendered(run);
  const { from, to, aim, leaving, edit } = run;

  /* **An arriving list mounts what the viewport needs first**, wherever the viewport is. A list
     mounted whole was one long task of fifty cards (R12-010); mounted from its top, a restored
     offset deep in it is blank until the chunks reach it. So the first chunk mounts with the
     list — which covers the viewport whenever the list's top is on screen: a tab switch, a first
     load — and the run is then checked against the viewport, after every layout effect of this
     commit (a parent restoring its offset runs after this one) and still before the first paint.
     Only when the viewport shows slots the run lacks does it mount them there and then: added to
     the run when they adjoin it, in place of it when the viewport is further down. */
  useLayoutEffect(() => {
    if (!aim) return;
    let cancelled = false;
    queueMicrotask(() => {
      if (cancelled) return;
      const grid = gridRef.current;
      const scroller = grid?.closest<HTMLElement>('[data-app-scroll-container]') ?? getAppScroller();
      const port = scroller?.getBoundingClientRect();
      const band = grid && port ? slotsInBand(layout.items, grid, port.top, port.bottom) : null;
      if (!band || (band.from >= from && band.to <= to)) {
        startTransition(() => setRendered((state) => (state.list === images && state.aim ? { ...state, aim: false } : state)));
        return;
      }
      const target =
        band.from <= to && band.to >= from
          ? { from: Math.min(from, band.from), to: Math.max(to, band.to) }
          : band;
      flushSync(() =>
        setRendered((state) => (state.list === images && state.aim ? { ...state, ...target, aim: false } : state)),
      );
    });
    return () => {
      cancelled = true;
    };
  }, [aim, from, to, images, layout]);

  /* The rest a chunk a frame, each in a transition: towards the list's top first, then down it.
     Up first because a run that starts below the top was aimed there by the viewport, and a page
     turn's glide is on its way up — the next slots it crosses are the ones above.

     **And every frame until the run is whole, the viewport is checked against it**: a slot on
     screen that the run lacks mounts there and then, before the frame paints. A transition waits
     behind urgent work — every picture of the new page landing is some — and a glide crossing
     slots still waiting for their chunk showed a viewport two-thirds bare for a quarter of a
     second (M1-033: 2–4 slots in view of the 16 a viewport holds, at 1440). The check is the
     placement's arithmetic and two boxes, never read inside a concealed pane. */
  useEffect(() => {
    if (aim || (from <= 0 && to >= images.length)) return;
    let frame = 0;
    let asked = false;
    const tick = () => {
      frame = 0;
      const grid = gridRef.current;
      const scroller = grid?.closest<HTMLElement>('[data-app-scroll-container]') ?? getAppScroller();
      const port = grid && inShownPanes(grid) ? scroller?.getBoundingClientRect() : undefined;
      const band = grid && port ? slotsInBand(layout.items, grid, port.top, port.bottom) : null;
      if (band && (band.from < from || band.to > to)) {
        flushSync(() =>
          setRendered((state) =>
            state.list === images && !state.aim
              ? { ...state, from: Math.min(state.from, band.from), to: Math.max(state.to, band.to) }
              : state,
          ),
        );
        return;
      }
      if (!asked) {
        asked = true;
        startTransition(() =>
          setRendered((state) => {
            if (state.list !== images || state.aim) return state;
            if (state.from > 0) return { ...state, from: Math.max(0, state.from - CHUNK) };
            return { ...state, to: Math.min(images.length, state.to + CHUNK) };
          }),
        );
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => {
      if (frame) cancelAnimationFrame(frame);
    };
  }, [aim, from, to, images, layout]);

  /* The edit, once its commit is in the DOM and before it is painted — once per edit (`edit` is
     new for each, and every other run carries none). */
  const moves = useRef(new Map<HTMLElement, Animation>());
  const hold = useRef<Hold | null>(null);
  /* The edit's commit holds the grid's height (`heldGrid`); `playEdit` lets it go in the DOM. React
     diffs a style by its values against what it last rendered, so while the run keeps the edit it
     writes nothing, and the natural heights go back in only with the next list. Not a manual memo:
     the compiler could not preserve one over `edit`, and skipped the whole grid for it. */
  const gridStyle = edit ? heldGrid(layout.grid, edit.height) : layout.grid;
  const played = useRef<Edit | null>(null);
  const placement = useRef(layout.items);
  useLayoutEffect(() => {
    placement.current = layout.items;
  }, [layout]);
  useLayoutEffect(() => {
    const grid = gridRef.current;
    if (!edit || !grid || played.current === edit) return;
    played.current = edit;
    playEdit({
      grid,
      edit,
      items: layout.items,
      heights: layout.grid,
      ids: images.map((image) => image.id),
      moves: moves.current,
      hold: hold.current,
      setHold: (next) => {
        hold.current = next;
      },
      placement: () => placement.current,
      onLeft: (id) =>
        setRendered((state) =>
          state.leaving.some((leaver) => leaver.image.id === id)
            ? { ...state, leaving: state.leaving.filter((leaver) => leaver.image.id !== id) }
            : state,
        ),
    });
  }, [edit, images, layout]);

  /* A press lands every move where it is going (a fade runs on: nothing is aimed at it), so the
     hero flight measures a card where it is and a moving target is never the one pressed. */
  useEffect(() => {
    const running = moves.current;
    const land = () => {
      for (const animation of running.values()) animation.finish();
    };
    window.addEventListener('pointerdown', land, true);
    window.addEventListener('keydown', land, true);
    return () => {
      window.removeEventListener('pointerdown', land, true);
      window.removeEventListener('keydown', land, true);
      for (const animation of running.values()) animation.cancel();
      running.clear();
      hold.current?.stop();
      hold.current = null;
    };
  }, []);

  /* Without a list of its own, the grid's page is the sequence: 上一张 / 下一张 step within it,
     and before a return flight the card is scrolled into view (the viewer may have stepped
     several screens away from it). Memoised on the page, so opening two cards of one page
     shares one window. */
  const pageSequence = useMemo(
    () =>
      createPagedSequence({
        key: `grid:${listId}`,
        page: 1,
        current: { ids: images.map((image) => image.id), previews: images, totalPages: 1 },
        pageSize: Math.max(1, images.length),
        fetchPage: async () => ({ ids: [] }),
        reveal: async (id) => revealCard(listId, id),
      }),
    [listId, images],
  );
  const activeSequence = sequence ?? pageSequence;

  const ids = useMemo(() => (images.length > 0 ? images.map((image) => image.id) : EMPTY_IDS), [images]);
  const counts = useResource(siteCommentCounts, siteComments || ids.length === 0 ? SKIP : { ids });
  const onSite = siteComments ?? counts.data;

  /* A slot: a live card at its place in the list, or one that left, held where it was. */
  const slot = (image: ImagePreview, index: number, style: Record<string, string>, left: boolean) => (
    <div
      key={image.id}
      role="listitem"
      aria-posinset={left ? undefined : index + 1}
      aria-setsize={left ? undefined : images.length}
      aria-hidden={left || undefined}
      inert={left}
      data-masonry-id={image.id}
      data-masonry-leaving={left ? '' : undefined}
      className={cn('masonry-item', left && 'pointer-events-none')}
      style={style as CSSProperties}
    >
      <ImageCard image={image} index={index} sequence={activeSequence} siteComments={onSite?.[image.id]} />
      {selection && (
        <CardSelection
          image={image}
          active={selection.active}
          selected={selection.selected.has(image.id)}
          onToggle={selection.onToggle}
          onLongPress={selection.onLongPress}
        />
      )}
    </div>
  );

  /* The leavers follow the card they followed, so a fading card is never moved in the DOM. */
  const children: ReactNode[] = [];
  const after = (id: number | null) => {
    for (const leaver of leaving) if (leaver.after === id) children.push(slot(leaver.image, leaver.index, leaver.style, true));
  };
  after(null);
  images.slice(from, to).forEach((image, offset) => {
    const index = from + offset;
    children.push(slot(image, index, layout.items[index], false));
    after(image.id);
  });

  return (
    <>
      <div className="masonry">
        <div ref={gridRef} role="list" data-masonry-grid={listId} className="masonry-grid" style={gridStyle as CSSProperties}>
          {children}
        </div>
      </div>
      {/* Renders nothing, and is a **sibling after** the grid rather than a child:
          React attaches a parent's ref only after its children's layout effects,
          so inside the div the hook's root was null on every mounting commit and
          the entrance silently never ran. The cascade lives behind a dynamic
          import, so the gallery chunk does not carry GSAP; with the engine absent
          the cards are simply there. */}
      {entrance && (
        <StaggerGrid
          gridRef={gridRef}
          selector=".image-card"
          deps={[images.length, images[0]?.id]}
        />
      )}
    </>
  );
});

/** A press held this long under a finger enters the selection mode — the tooltip's long press. */
const LONG_PRESS_MS = 500;

/**
 * One card's part of the selection mode, a **sibling of the card** in its slot — never inside the
 * card's link, where a control would be interactive content nested in an anchor (AGENTS).
 *
 * It is the card's checkbox: a button over the whole picture, named by it, that a press, a tap,
 * Enter or Space toggles. The card under it is `inert` for the mode's length — out of the tab
 * order and the accessibility tree, so the picture cannot be opened from under the checkbox and a
 * screen reader meets one control per card — set on the card's own root, where the card component
 * renders no `inert` of its own. A focus that was on the card moves to its checkbox. Outside the
 * mode it listens on the slot for a long press under a finger (a touch that stays within the slop
 * for half a second): that enters the mode with the card selected, and the click and the context
 * menu the press would have produced are swallowed.
 *
 * **It is always mounted, and the mode fades it** — in and out on the effects spring, the disc
 * growing from 0.8 with it, `inert` while out. Mounted and unmounted, forty-one discs, the mat and
 * the tick appeared and vanished in one frame beside a bar that glides (M1-002). While the mode
 * leaves it keeps showing what it was — a selected card leaves selected — and settles to the
 * unselected face only once it is out of sight.
 *
 * **The tick draws itself and the disc pops**, as `Checkbox` does: the stroke on the effects spring
 * after the press step, the pop on a selection it saw made — not when the mode opens on a card
 * already selected (M1-003).
 */
const CardSelection = memo(function CardSelection({
  image,
  active,
  selected,
  onToggle,
  onLongPress,
}: {
  image: ImagePreview;
  active: boolean;
  selected: boolean;
  onToggle: (id: number, range: boolean) => void;
  onLongPress?: (id: number) => void;
}) {
  const buttonRef = useRef<HTMLButtonElement>(null);
  const heldPress = useRef(false);
  const id = image.id;

  /* Held while the mode leaves; brought up to date once the fade is over, out of sight. */
  const [shownSelected, setShownSelected] = useState(selected);
  if (active && shownSelected !== selected) setShownSelected(selected);
  const ticked = active ? selected : shownSelected;
  const [seen, setSeen] = useState(selected);
  const [popped, setPopped] = useState(false);
  if (seen !== selected) {
    setSeen(selected);
    setPopped(selected && active);
  }

  /* The long press, on the slot (the card's link is what the finger is on). */
  useEffect(() => {
    const slot = buttonRef.current?.parentElement;
    if (active || !onLongPress || !slot) return;
    let timer = 0;
    let start: { x: number; y: number; pointer: number } | null = null;
    let fired = false;
    const cancel = () => {
      window.clearTimeout(timer);
      start = null;
    };
    const onDown = (event: PointerEvent) => {
      if (event.pointerType !== 'touch' || !event.isPrimary) return;
      cancel();
      fired = false;
      heldPress.current = false;
      start = { x: event.clientX, y: event.clientY, pointer: event.pointerId };
      timer = window.setTimeout(() => {
        start = null;
        fired = true;
        heldPress.current = true;
        onLongPress(id);
      }, LONG_PRESS_MS);
    };
    const onMove = (event: PointerEvent) => {
      if (!start || event.pointerId !== start.pointer) return;
      if (Math.hypot(event.clientX - start.x, event.clientY - start.y) > TOUCH_SLOP_PX) cancel();
    };
    /* What the press would have done next: the link's navigation, the platform's link menu. */
    const swallow = (event: Event) => {
      if (!fired && !start) return;
      event.preventDefault();
      if (event.type === 'click') {
        event.stopPropagation();
        fired = false;
      }
    };
    slot.addEventListener('pointerdown', onDown);
    slot.addEventListener('pointermove', onMove);
    slot.addEventListener('pointerup', cancel);
    slot.addEventListener('pointercancel', cancel);
    slot.addEventListener('click', swallow, true);
    slot.addEventListener('contextmenu', swallow, true);
    return () => {
      cancel();
      slot.removeEventListener('pointerdown', onDown);
      slot.removeEventListener('pointermove', onMove);
      slot.removeEventListener('pointerup', cancel);
      slot.removeEventListener('pointercancel', cancel);
      slot.removeEventListener('click', swallow, true);
      slot.removeEventListener('contextmenu', swallow, true);
    };
  }, [active, onLongPress, id]);

  /* The card under the checkbox is out of reach for the mode's length. */
  useLayoutEffect(() => {
    const card = buttonRef.current?.parentElement?.querySelector<HTMLElement>(':scope > .image-card');
    if (!active || !card) return;
    const hadFocus = card.contains(document.activeElement);
    card.inert = true;
    if (hadFocus) buttonRef.current?.focus({ preventScroll: true });
    return () => {
      card.inert = false;
    };
  }, [active]);

  return (
    <button
      ref={buttonRef}
      type="button"
      role="checkbox"
      aria-checked={selected}
      aria-label={describeImage(image)}
      inert={!active}
      data-select-card=""
      data-ripple=""
      onPointerDown={() => { heldPress.current = false; }}
      onContextMenu={(event) => { if (heldPress.current) event.preventDefault(); }}
      onClick={(event) => {
        if (heldPress.current) {
          heldPress.current = false;
          event.preventDefault();
          return;
        }
        onToggle(id, event.shiftKey);
      }}
      onTransitionEnd={(event) => {
        if (!active && event.target === event.currentTarget && event.propertyName === 'opacity') setShownSelected(selected);
      }}
      className={cn(
        'group absolute inset-0 z-10 block overflow-hidden rounded-lg select-none touch-manipulation',
        /* The focus ring is the gallery card's own, drawn inward on a pseudo-element
           (`[data-select-card]` in globals.css): over a picture, beside the mat below. */
        'focus-visible:outline-hidden transition-[opacity,box-shadow] spring-fast-effects',
        active ? 'cursor-pointer' : 'pointer-events-none opacity-0',
        /* Selected, the picture sits in a mat of the page's own surface: the tile reads as drawing
           back, with no transform on anything the hero measures. */
        ticked && 'inset-ring-4 inset-ring-surface',
      )}
    >
      <span className="media-hover-scrim absolute inset-0 rounded-lg" aria-hidden="true" />
      <span
        aria-hidden="true"
        className={cn(
          'absolute top-2 left-2 flex size-6 items-center justify-center rounded-full border-2',
          'transition-[background-color,border-color,scale] spring-fast-effects',
          ticked
            ? 'border-primary bg-primary text-on-primary forced-selected forced-colors:border-[color:Highlight]'
            : 'border-on-media bg-media-plate forced-boundary',
          !active && 'scale-80',
          popped && 'animate-control-pop',
        )}
      >
        <CheckGlyph
          className="size-4"
          pathProps={{
            strokeDasharray: '10.5',
            strokeDashoffset: ticked ? 0 : 10.5,
            /* An effects spring: a dash offset that overshoots draws past the end of the path and
               retracts. The press step lets the disc settle before the stroke starts. */
            className: 'spring-fast-effects transition-[stroke-dashoffset]',
            style: { transitionDelay: ticked ? 'var(--transition-duration-press)' : '0ms' },
          }}
        />
      </span>
    </button>
  );
});
