'use client';

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type RefObject,
} from 'react';
import { flushSync } from 'react-dom';
import { usePathname } from 'next/navigation';
import { motionTier } from '@/lib/appearance';
import { getAppScroller } from '@/lib/appScroller';
import { cancelImageDetailPrefetch, peekImageDetail, prefetchImageDetail } from '@/lib/detail';
import { isEditableTarget } from '@/lib/hooks';
import { speculationAllowed } from '@/lib/resource';
import {
  activeImageSequence,
  imageNeighbours,
  stepImageSequence,
  useImageNeighbours,
  type ImageNeighbours,
} from '@/lib/imageSequence';
import type { ImagePreview } from '@/lib/types/image';
import { imageHeroController } from './controller';
import { prepareImageHeroStep, warmImageHeroSource } from './media';
import { publishWhenHeroSettled } from './publish';
import {
  bindStepSwipe,
  playStepEnter,
  playStepExit,
  playStepReturn,
  settleStepMotion,
  takeOverStepMotion,
  type StepDirection,
  type StepMotion,
} from './step';

export type { StepDirection } from './step';

const DETAIL_PATH = /^\/pic\/([^/]+)$/;
/** How close to the loaded window's end, in pictures, the list's next page is read ahead. */
const PAGE_READ_AHEAD = 4;

/**
 * A step heading for `id` within the last few pictures of the loaded window reads the list's next
 * page ahead, in the way the reader is stepping: a reader walking through the list reaches its
 * end, and waiting there for a live page read (seconds, on Derpibooru's lane) is what read as the
 * swipe having stopped working. At a step rather than on arrival, so a run of quick flicks — which
 * never lets the viewer settle — still has it read in time. The one read this speculation adds
 * (AGENTS.md), and the very read the step at the end makes, which joins it rather than repeats it.
 */
function readAhead(id: number, direction: StepDirection) {
  if (!speculationAllowed()) return;
  const source = activeImageSequence();
  const loaded = source?.ids() ?? [];
  const index = loaded.indexOf(id);
  if (!source || index === -1) return;
  if (direction === 1 && loaded.length - 1 - index <= PAGE_READ_AHEAD && source.hasNext?.()) {
    void source.loadNext?.().catch(() => undefined);
  } else if (direction === -1 && index <= PAGE_READ_AHEAD && source.hasPrevious?.()) {
    void source.loadPrevious?.().catch(() => undefined);
  }
}

/**
 * Where focus may be for ←/→ to step: nowhere in particular, or inside the viewer — never in a
 * dialog over it (portalled outside), never in a control that owns the arrow keys itself.
 */
const ARROW_KEY_OWNERS =
  '[role="tablist"], [role="radiogroup"], [role="menu"], [role="menubar"], [role="listbox"], ' +
  '[role="slider"], [role="spinbutton"], [role="tree"], [role="grid"], [role="toolbar"], ' +
  '[role="scrollbar"], [role="combobox"], video, audio, input, select, textarea';

type StepView = {
  /** The picture on screen. */
  id: number;
  /** Where the viewer is heading — the latest step's picture; equal to `id` once it has swapped. */
  target: number;
  /** The location's picture when the view last agreed with it. */
  location: number;
  /** A step's history half is still rewriting the URL, so the location is not yet the truth. */
  stepping: boolean;
};

type PendingSwap = { id: number; direction: StepDirection };

export type DetailStepOptions = {
  /** The picture this route was mounted for — the route's own `[id]`. */
  routeId: number;
  /** The node the shared axis moves: everything that belongs to one picture, and nothing else. */
  contentRef: RefObject<HTMLElement | null>;
  /** Where ←/→ belong — the overlay's dialog, or the page's content. */
  rootRef: RefObject<HTMLElement | null>;
  /** The scroller that returns to the top on a swap. `null` is the app's own scroller. */
  scrollerRef: RefObject<HTMLElement | null> | null;
  /** Something layered over the detail owns input right now (a dialog, the lightbox, a menu). */
  isBlocked: () => boolean;
  /** A step could not reach its picture — its record could not be read, and the list had none. */
  onError: (error: unknown) => void;
};

export type DetailStep = {
  /** The picture to render. */
  imageId: number;
  /** Either side of the picture the viewer is heading for — what 上一张 / 下一张 offer. */
  neighbours: ImageNeighbours;
  /** The direction whose next page is loading (the button shows it busy). */
  loading: StepDirection | null;
  step: (direction: StepDirection) => void;
  /** A callback ref for the picture's box: binds the horizontal swipe. */
  bindSwipe: (node: HTMLElement | null) => (() => void) | undefined;
  /** A step is moving the content, loading, or under a finger — the pull-down stands aside. */
  isStepping: () => boolean;
};

/**
 * 上一张 / 下一张 for the open detail (decision 19): which picture it shows, the shared axis
 * between two of them, the arrows' state, ←/→ and the swipe — and, on arrival, warming both
 * neighbours so the next step paints at once.
 *
 * **The picture shown is this hook's state, not the route's `[id]` and not the URL.** A step is
 * in place: the route never remounts and the tree keeps naming the picture it opened on, while
 * the history ladder is rewritten behind the step to name the new one (`requestDetailStep`). The
 * URL lags the swap by a traversal, and the swap lags the press by the outgoing half of the
 * transition, so neither can drive what is on screen. The location is adopted whenever no step
 * is rewriting it (a Back, a forward replay, a reload): the view agrees with the URL at rest.
 */
export function useDetailStep({
  routeId,
  contentRef,
  rootRef,
  scrollerRef,
  isBlocked,
  onError,
}: DetailStepOptions): DetailStep {
  const pathname = usePathname();
  const match = DETAIL_PATH.exec(pathname ?? '');
  const locationId = match ? Number(match[1]) : routeId;
  const [view, setView] = useState<StepView>(() => ({
    id: locationId,
    target: locationId,
    location: locationId,
    stepping: false,
  }));
  if (!view.stepping && view.location !== locationId) {
    setView({ id: locationId, target: locationId, location: locationId, stepping: false });
  }
  const [loading, setLoading] = useState<StepDirection | null>(null);
  const neighbours = useImageNeighbours(view.target);
  const settled = useImageNeighbours(view.id);

  const viewRef = useRef(view);
  const mountedRef = useRef(false);
  /** A step waiting on a read (the list's next page, or a record no list row describes). */
  const pendingLoadRef = useRef<{ direction: StepDirection; fromId: number; step: Promise<boolean> } | null>(null);
  const motionRef = useRef<StepMotion | null>(null);
  const phaseRef = useRef<'idle' | 'exit' | 'enter'>('idle');
  const pendingSwapRef = useRef<PendingSwap | null>(null);
  const draggingRef = useRef(false);
  /** Where the content was when the finger took it over — the drag's offsets are added to it. */
  const dragOriginRef = useRef(0);
  const optionsRef = useRef({ isBlocked, onError });

  useLayoutEffect(() => {
    viewRef.current = view;
    optionsRef.current = { isBlocked, onError };
  });

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      motionRef.current?.cancel();
      motionRef.current = null;
      pendingSwapRef.current = null;
    };
  }, []);

  const resetScroll = useCallback(() => {
    const scroller = scrollerRef ? scrollerRef.current : getAppScroller();
    scroller?.scrollTo({ top: 0, behavior: 'instant' });
  }, [scrollerRef]);

  /**
   * The swap itself: one synchronous commit while nothing of the outgoing picture is visible,
   * the scroller back at the top, the engine told the picture it published is on screen, and the
   * incoming half started from the same frame. `instant` is the engine asking for it now (a close
   * must measure the picture about to be shown) and skips the incoming half.
   */
  const commitSwap = useCallback(
    (instant: boolean) => {
      const swap = pendingSwapRef.current;
      if (!swap || !mountedRef.current) return;
      pendingSwapRef.current = null;
      const element = contentRef.current;
      const active = document.activeElement;
      const focusWasInside = Boolean(element && active instanceof HTMLElement && element.contains(active));
      flushSync(() => {
        setView((current) => ({ ...current, id: swap.id }));
      });
      resetScroll();
      imageHeroController.settleDetailStep(swap.id);
      motionRef.current?.cancel();
      motionRef.current = null;
      if (!element || instant || motionTier() === 'off') {
        settleStepMotion(element);
        phaseRef.current = 'idle';
      } else {
        phaseRef.current = 'enter';
        const motion = playStepEnter(element, swap.direction);
        motionRef.current = motion;
        void motion.finished.then(() => {
          if (motionRef.current !== motion) return;
          motionRef.current = null;
          phaseRef.current = 'idle';
        });
      }
      /* The swap replaced the body the focus was in (its action row mounts again with the new
         record): keep the keyboard in the viewer rather than on the document. */
      if (focusWasInside && (!document.activeElement || document.activeElement === document.body)) {
        rootRef.current?.focus({ preventScroll: true });
      }
    },
    [contentRef, resetScroll, rootRef],
  );

  /** The history rewrite failed: the URL still names the picture the view last agreed with. */
  const revert = useCallback(() => {
    pendingSwapRef.current = null;
    motionRef.current?.cancel();
    motionRef.current = null;
    phaseRef.current = 'idle';
    settleStepMotion(contentRef.current);
    flushSync(() => {
      setView((current) => ({
        id: current.location,
        target: current.location,
        location: current.location,
        stepping: false,
      }));
    });
  }, [contentRef]);

  /**
   * Start a step whose picture and record are in hand. `'busy'` when a flight still owns the
   * screen — the press landed in the last frames of an open — so the caller can try once more
   * when it settles rather than drop the press (R10-014).
   */
  const begin = useCallback(
    (
      fromId: number,
      toId: number,
      direction: StepDirection,
      preview: ImagePreview,
      speed: number,
    ): 'started' | 'busy' | 'refused' => {
      const synced = imageHeroController.requestDetailStep({
        fromId,
        toId,
        snapshot: prepareImageHeroStep(preview),
        flush: () => commitSwap(true),
      });
      if (synced === false) return imageHeroController.hasForeground() ? 'busy' : 'refused';
      viewRef.current = { ...viewRef.current, target: toId, stepping: true };
      readAhead(toId, direction);
      setView((current) => ({ ...current, target: toId, stepping: true }));
      pendingSwapRef.current = { id: toId, direction };
      if (phaseRef.current !== 'exit') {
        const element = contentRef.current;
        if (!element || motionTier() === 'off') {
          commitSwap(true);
        } else {
          phaseRef.current = 'exit';
          const motion = playStepExit(element, direction, speed);
          motionRef.current = motion;
          void motion.finished.then((completed) => {
            if (completed && motionRef.current === motion) commitSwap(false);
          });
        }
      }
      void synced.then((ok) => {
        if (!mountedRef.current) return;
        if (!ok) {
          revert();
          return;
        }
        setView((current) => (current.stepping ? { ...current, stepping: false } : current));
      });
      return 'started';
    },
    [commitSwap, contentRef, revert],
  );

  /** A step whose picture and record are in hand; waits out a flight still owning the screen. */
  const start = useCallback(
    async (
      fromId: number,
      toId: number,
      direction: StepDirection,
      preview: ImagePreview,
      speed: number,
    ): Promise<boolean> => {
      const outcome = begin(fromId, toId, direction, preview, speed);
      if (outcome !== 'busy') return outcome === 'started';
      await imageHeroController.waitForFlightIdle();
      if (!mountedRef.current || viewRef.current.target !== fromId || optionsRef.current.isBlocked()) {
        return false;
      }
      return begin(fromId, toId, direction, preview, 0) === 'started';
    },
    [begin],
  );

  /** Past the loaded window, or a picture the list holds no record for: read it, then step. */
  const loadThenStart = useCallback(
    async (fromId: number, toId: number | null, direction: StepDirection): Promise<boolean> => {
      let preview: ImagePreview | undefined;
      setLoading(direction);
      try {
        if (toId === null) {
          toId = await stepImageSequence(fromId, direction);
          if (toId === null) return false;
        }
        preview =
          activeImageSequence()?.preview?.(toId) ??
          peekImageDetail(toId)?.image ??
          (await prefetchImageDetail(toId, { priority: 'immediate' })).image;
      } catch (error) {
        if (mountedRef.current) optionsRef.current.onError(error);
        return false;
      } finally {
        if (mountedRef.current) setLoading(null);
      }
      if (!mountedRef.current || viewRef.current.target !== fromId || optionsRef.current.isBlocked()) {
        return false;
      }
      return start(fromId, toId, direction, preview, 0);
    },
    [start],
  );

  const runStep = useCallback(
    (direction: StepDirection, speed = 0, fromSwipe = false): Promise<boolean> => {
      if (optionsRef.current.isBlocked()) return Promise.resolve(false);
      const fromId = viewRef.current.target;
      const source = activeImageSequence();
      const around = imageNeighbours(fromId, source);
      if (!around.inSequence) return Promise.resolve(false);
      const toId = direction === 1 ? around.next : around.previous;
      const preview = toId === null ? undefined : (source?.preview?.(toId) ?? peekImageDetail(toId)?.image);
      if (toId !== null && preview) return start(fromId, toId, direction, preview, speed);

      /* Something must be read first. The page returns to rest under the finger while the arrow
         shows the wait, and pages when the read lands. */
      if (fromSwipe) {
        const element = contentRef.current;
        if (element) playStepReturn(element, speed);
      }
      const pending = pendingLoadRef.current;
      if (pending) {
        /* Already reading this way from this picture: this is the step that read will make — one
           picture, however often it is asked for while the page is on its way. It used to refuse,
           so every swipe during a slow page read did nothing at all. */
        return pending.direction === direction && pending.fromId === fromId
          ? pending.step
          : Promise.resolve(false);
      }
      if (toId === null && !(direction === 1 ? around.canLoadNext : around.canLoadPrevious)) {
        return Promise.resolve(false);
      }
      const step = loadThenStart(fromId, toId, direction);
      const entry = { direction, fromId, step };
      pendingLoadRef.current = entry;
      void step.finally(() => {
        if (pendingLoadRef.current === entry) pendingLoadRef.current = null;
      });
      return step;
    },
    [contentRef, loadThenStart, start],
  );

  const step = useCallback(
    (direction: StepDirection) => {
      void runStep(direction);
    },
    [runStep],
  );

  const isStepping = useCallback(
    () => phaseRef.current !== 'idle' || draggingRef.current || pendingLoadRef.current !== null,
    [],
  );

  /* ←/→ while the viewer has the keyboard: not in a field, not in a composition, not with a
     modifier (those are the browser's and the system's), not in a control that owns the arrows. */
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
      if (event.defaultPrevented || event.isComposing || event.keyCode === 229) return;
      if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
      const target = event.target;
      const root = rootRef.current;
      const inViewer =
        target === document.body ||
        target === document.documentElement ||
        (target instanceof Node && Boolean(root?.contains(target)));
      if (!inViewer || isEditableTarget(target) || isEditableTarget(document.activeElement)) return;
      if (target instanceof Element && target !== root && target.closest(ARROW_KEY_OWNERS)) return;
      if (!activeImageSequence()) return;
      event.preventDefault();
      void runStep(event.key === 'ArrowRight' ? 1 : -1);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [rootRef, runStep]);

  const bindSwipe = useCallback(
    (node: HTMLElement | null) => {
      if (!node) return undefined;
      return bindStepSwipe({
        target: node,
        /* In any phase of a step: a second flick while the first is still settling is taken over
           (`onStart`), never dropped — and while the next page is on its way, since the drag then
           shows the wait itself (resistance, and the step once the page lands). Only while
           something else owns the surface does a finger find nothing to hold. */
        canStart: () =>
          !optionsRef.current.isBlocked() &&
          !document.documentElement.dataset.imageHeroDismissGesture &&
          !imageHeroController.hasForeground() &&
          imageNeighbours(viewRef.current.target).inSequence,
        canStep: (direction) => {
          const around = imageNeighbours(viewRef.current.target);
          return direction === 1
            ? around.next !== null || around.canLoadNext
            : around.previous !== null || around.canLoadPrevious;
        },
        /* Nothing loaded that way yet — a page still to come, or the list's end: the drag is
           resisted, so the finger feels the end rather than a picture that is not there. */
        resists: (direction) => {
          const around = imageNeighbours(viewRef.current.target);
          return (direction === 1 ? around.next : around.previous) === null;
        },
        onStart: () => {
          draggingRef.current = true;
          /* The finger takes the content over from where it is, as a native pager takes a new
             drag from its in-flight pose. Before the swap, the outgoing picture is already leaving
             and nearly gone: the swap lands now and the finger takes the incoming picture from
             its first pose. After it, the incoming half stops where it is — its travel becomes
             the drag's origin, and its fade runs on. */
          if (phaseRef.current === 'exit') {
            commitSwap(false);
            /* The swap can take the gesture away with the picture — a surface that no longer
               holds this recogniser releases its drag in that very commit — and the incoming
               half then carries the content to rest by itself. Taking over after that pinned the
               content at the incoming half's first pose, with no finger left to move it. */
            if (!draggingRef.current) return;
          }
          motionRef.current = null;
          phaseRef.current = 'idle';
          dragOriginRef.current = takeOverStepMotion(contentRef.current);
        },
        onDrag: (offset) => {
          const element = contentRef.current;
          if (element && draggingRef.current) {
            element.style.transform = `translate3d(${dragOriginRef.current + offset}px, 0, 0)`;
          }
        },
        onRelease: ({ speed, direction }) => {
          draggingRef.current = false;
          const element = contentRef.current;
          if (direction === null) {
            if (element) playStepReturn(element, speed);
            return;
          }
          void runStep(direction, speed, true).then((started) => {
            if (!started && contentRef.current && phaseRef.current === 'idle') {
              playStepReturn(contentRef.current, speed);
            }
          });
        },
      });
    },
    [commitSwap, contentRef, runStep],
  );

  /* Warm both neighbours once the viewer has arrived and settled: the record (background
     priority, so it never takes the lane from the picture on screen) and the `medium` rung the
     step paints as its preview. Moving on cancels a neighbour's read that has not started. A
     guess, so it asks first: a metered or slow connection pays for no speculation. */
  const settledNext = settled.next;
  const settledPrevious = settled.previous;
  useEffect(() => {
    if (view.stepping) return;
    const ids = [settledNext, settledPrevious].filter((id): id is number => id !== null);
    if (ids.length === 0) return;
    const cancelWarm = publishWhenHeroSettled(() => {
      if (!speculationAllowed()) return;
      const source = activeImageSequence();
      for (const id of ids) {
        void prefetchImageDetail(id, { priority: 'background' }).catch(() => undefined);
        warmImageHeroSource(source?.preview?.(id) ?? peekImageDetail(id)?.image, { forStep: true });
      }
    });
    return () => {
      cancelWarm();
      for (const id of ids) {
        if (id !== viewRef.current.target && id !== viewRef.current.id) cancelImageDetailPrefetch(id);
      }
    };
  }, [settledNext, settledPrevious, view.stepping]);

  return {
    imageId: view.id,
    neighbours,
    loading,
    step,
    bindSwipe,
    isStepping,
  };
}
