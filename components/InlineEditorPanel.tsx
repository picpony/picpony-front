'use client';

import { useEffect, useLayoutEffect, useRef, type KeyboardEvent, type ReactNode } from 'react';
import { flushSync } from 'react-dom';
import { motionTier, scaledMs, type MotionTier } from '@/lib/appearance';
import { getAppScroller } from '@/lib/appScroller';
import { scrollAppToElement } from '@/lib/scrollTo';
import { springTiming } from '@/lib/springTiming';
import { dropMove, drawnOffsetY, followersOf, precedersOf, startMove } from '@/components/admin/tableMotion';

interface InlineEditorPanelProps {
  id: string;
  label: string;
  isClosing: boolean;
  onExitComplete: () => void;
  /** Escape inside the panel (when nothing inside it took the key) — the editor's 取消. */
  onEscape?: () => void;
  children: ReactNode;
}

/** Room kept under the app bar when a panel opening below the fold is brought into view. */
const REVEAL_OFFSET = 16;
/** A panel whose top lands this close to the scroller's bottom edge opens out of sight. */
const REVEAL_MARGIN = 96;
/** The content's entrance trails the panel's own by this much (ms at the default speed). */
const CONTENT_LAG_MS = 40;
/** How far the content rises into place as it fades in, and sinks as it leaves. */
const CONTENT_TRAVEL = 8;
/** A press's capture is for the open it starts; one older than this belongs to nothing. */
const CAPTURE_TTL_MS = 1000;

/** Where things were on the press, before React replaced the editor (`captureInlineEditorLayout`). */
interface Capture {
  editorId: string | null;
  row: Element;
  at: number;
  rowTop: number;
  /** Where everything that followed the pressed row was drawn. */
  tops: Map<HTMLElement, number>;
}

let pending: Capture | null = null;

/**
 * Call from the edit button's press, **before** the state change that opens (or moves) the editor:
 * it captures where the pressed row sits on screen, and where everything after it is, so the new
 * panel can hold that row in place when an editor above it is taken away in the same commit
 * (R9-038: opening 用户3's editor while 用户2's 880px one was open threw 用户3's row 432px above
 * the viewport), and glide what follows from where it was.
 */
export function captureInlineEditorLayout(trigger: Element) {
  const row = trigger.closest('.m3-row');
  if (!row) {
    pending = null;
    return;
  }
  const view = window.innerHeight;
  const tops = new Map<HTMLElement, number>();
  for (const el of followersOf(row, { top: -view, bottom: view * 2 })) tops.set(el, el.getBoundingClientRect().top);
  pending = { editorId: trigger.getAttribute('aria-controls'), row, at: performance.now(), rowTop: row.getBoundingClientRect().top, tops };
}

/**
 * The press's capture, for the panel it opened and no other: matched by the control's target id —
 * React may have replaced the row element while inserting its editor — or by the row itself. A
 * capture for another editor (an open that was refused) is left for its own panel and expires.
 * Read through a call rather than a module variable inlined into the effect: the React Compiler
 * once moved that read past its clearing assignment and lost the capture at commit.
 */
function takeCapture(panel: HTMLElement): Capture | null {
  const capture = pending;
  if (!capture || (capture.editorId !== panel.id && capture.row !== panel.previousElementSibling)) return null;
  pending = null;
  return performance.now() - capture.at <= CAPTURE_TTL_MS ? capture : null;
}

/**
 * Keep the pressed row where the user pressed it. Measured after the commit's layout — so a scroll
 * anchor the browser already applied reads as no movement — and corrected by the movement that
 * actually happened. Runs before the reflow is measured, so what follows still glides from where
 * it was on screen.
 */
function holdAnchor(capture: Capture | null, panel: HTMLElement) {
  const row = panel.previousElementSibling;
  if (!capture || !row) return;
  const scroller = getAppScroller();
  if (!scroller) return;
  const moved = row.getBoundingClientRect().top - capture.rowTop;
  if (Math.abs(moved) >= 1) scroller.scrollTop += moved;
}

/** A panel that opened below the fold scrolls its row to the top of the view, the editor under it. */
function revealPanel(panel: HTMLElement) {
  const scroller = getAppScroller();
  if (!scroller) return;
  const view = scroller.getBoundingClientRect();
  if (panel.getBoundingClientRect().top <= view.bottom - REVEAL_MARGIN) return;
  const row = panel.previousElementSibling;
  scrollAppToElement(row instanceof HTMLElement ? row : panel, { offset: REVEAL_OFFSET });
}

/** One opening or closing: the panel's own tracks, and the moves it gave what follows. */
interface Run {
  phase: 'open' | 'close';
  own: Animation[];
  moved: Array<[HTMLElement, Animation]>;
  /** The row's bottom corners (`cornerTrack`), when the panel took the run's last place from it. */
  corner: Animation | null;
  landing: ReturnType<typeof setTimeout> | null;
}

const runs = new WeakMap<HTMLElement, Run>();

/**
 * Leaves the run for a task, then lands it — unless the panel's effect runs again in between and
 * adopts it. React's development build unmounts and remounts every effect once (StrictMode), and
 * cancelling there dropped the opening reflow: the rows below teleported 589px while the clip
 * opened over empty space (M1-030). A change of direction is the same cleanup-then-effect pair. A
 * real unmount lands everything where the layout now has it.
 */
function release(panel: HTMLElement) {
  const run = runs.get(panel);
  if (!run || run.landing) return;
  run.landing = setTimeout(() => {
    if (runs.get(panel) !== run) return;
    runs.delete(panel);
    for (const animation of run.own) animation.cancel();
    run.corner?.cancel();
    for (const [el, animation] of run.moved) dropMove(el, animation);
  }, 0);
}

function adopt(panel: HTMLElement): Run | undefined {
  const run = runs.get(panel);
  if (run?.landing) {
    clearTimeout(run.landing);
    run.landing = null;
  }
  return run;
}

/**
 * The row above the panel and its two bottom radii, when the panel took the run's last place from
 * it — `null` otherwise (a panel under a middle row changes no corner).
 *
 * A grouped run rounds its last row's bottom corners (`:nth-last-child(1 of .m3-row)`), so the commit
 * that inserts a panel under the last row squared that row's corners at once, 16dp to the 4dp seam,
 * over a panel that had not yet begun to grow — and the commit that removed it rounded them again in
 * one frame. `end` is read off the panel (the run's last now), `seam` off the row at rest.
 */
function cornerRow(panel: HTMLElement): { row: HTMLElement; end: string; seam: string } | null {
  const row = panel.previousElementSibling;
  if (!(row instanceof HTMLElement) || !row.classList.contains('m3-row')) return null;
  const end = getComputedStyle(panel).borderBottomLeftRadius;
  const seam = getComputedStyle(row).borderBottomLeftRadius;
  return end === seam ? null : { row, end, seam };
}

/** The row's bottom corners from one radius to the other, on the clock of the gesture they belong to. */
function cornerTrack(row: HTMLElement, from: string, to: string, timing: KeyframeAnimationOptions) {
  return row.animate([
    { borderBottomLeftRadius: from, borderBottomRightRadius: from },
    { borderBottomLeftRadius: to, borderBottomRightRadius: to },
  ], timing);
}

/** Where `el` is drawn now by its own tracks — running animations included. */
function poseOf(el: Element) {
  const style = getComputedStyle(el);
  return { translate: style.translate || 'none', opacity: style.opacity };
}

/** Shared expanding row used by admin tables for in-place editing. */
export default function InlineEditorPanel({
  id,
  label,
  isClosing,
  onExitComplete,
  onEscape,
  children,
}: InlineEditorPanelProps) {
  const panelRef = useRef<HTMLElement>(null);
  const surfaceRef = useRef<HTMLDivElement>(null);
  const onExitCompleteRef = useRef(onExitComplete);

  useEffect(() => {
    onExitCompleteRef.current = onExitComplete;
  }, [onExitComplete]);

  /*
   * **The reveal is a clip made of two translated boxes, not an animated `clip-path`.** The section
   * is the clip (`overflow: clip`, the run's own corners) and paints nothing; the surface inside it
   * carries the tone and the padding. Opening, the section starts a panel's height above its slot
   * and the surface the same distance below it, so the surface stands still while the section's box
   * — all that is drawn of it — grows down over it: the uncovering the row below makes as it moves
   * away, on the same spring. The `clip-path` and GSAP tweens this replaces ran on the main thread
   * in exactly the frames after inserting a 587px editor (M1-032); every track here is a compositor
   * `translate` or `opacity`, and what follows moves on a `transform` (`tableMotion`), so a table
   * moving the panel as a row composes with the clip instead of replacing it.
   */
  useLayoutEffect(() => {
    const panel = panelRef.current;
    const surface = surfaceRef.current;
    if (!panel || !surface) return;
    const phase = isClosing ? 'close' : 'open';
    const previous = adopt(panel);
    if (previous?.phase === phase) return () => release(panel);

    const tier = motionTier();
    if (!previous && !isClosing) {
      const capture = takeCapture(panel);
      holdAnchor(capture, panel);
      revealPanel(panel);
      runs.set(panel, open(panel, surface, tier, capture));
    } else if (isClosing) {
      /* Closing takes the panel's controls away (it goes inert at once): focus that was inside
         returns to the control that opened it, rather than falling to the page. */
      if (panel.contains(document.activeElement)) {
        const trigger = document.querySelector<HTMLElement>(`[aria-controls="${CSS.escape(panel.id)}"]`);
        trigger?.focus({ preventScroll: true });
      }
      const run = turn(panel, surface, tier, previous ?? null, 'close');
      runs.set(panel, run);
      const finish = () => {
        if (runs.get(panel) !== run) return;
        for (const [el, animation] of run.moved) dropMove(el, animation);
        /* The moves land and the panel goes in one task: the layout shift replaces each translate
           exactly, so nothing moves in the frame between. The row's corners are held at the run's
           end until the removal gives it them, then let go — a fill left in place would round a row
           that later stops being last. */
        flushSync(() => onExitCompleteRef.current());
        run.corner?.cancel();
      };
      if (run.own.length) run.own[0].finished.then(finish, () => {});
      else queueMicrotask(() => {
        if (runs.get(panel) === run) onExitCompleteRef.current();
      });
    } else {
      runs.set(panel, turn(panel, surface, tier, previous ?? null, 'open'));
    }
    return () => release(panel);
  }, [isClosing]);

  const onKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key !== 'Escape' || event.defaultPrevented || !onEscape) return;
    event.preventDefault();
    onEscape();
  };

  return (
    <section
      ref={panelRef}
      id={id}
      onKeyDown={onKeyDown}
      /* `inert` for the ~110ms the close holds it on screen: until the panel is gone, a clipped-away
         editor full of `Input`s and `Button`s would still be focusable. Every other overlay in the
         app already covers this window. */
      inert={isClosing}
      /* The clip: the run's corners and seam, and nothing it paints or hit-tests itself — opening,
         its box stands over the rows above, which must stay pressable. In forced colours the run's
         edge is the surface's, which stands still; on the clip it would sweep over those rows. The
         `!` is needed to beat `.m3-row`'s own forced-colours outline, which is unlayered. */
      className="m3-row pointer-events-none overflow-clip forced-colors:outline-none!"
      aria-label={label}
    >
      <div ref={surfaceRef} className="pointer-events-auto rounded-[inherit] bg-surface-container px-4 py-5 forced-boundary">
        {children}
      </div>
    </section>
  );
}

/** The panel's laid-out height, and the distance everything after it moves (height and seam). */
function footprint(panel: HTMLElement) {
  const height = panel.offsetHeight;
  return { height, distance: height + (parseFloat(getComputedStyle(panel).marginTop) || 0) };
}

/**
 * Where each target is drawn while the panel takes no room — before it opened, once it has closed —
 * and how far the page will shift down when it goes. Not "its footprint higher": a follower held by
 * the free space of a short page (the shell's footer at the foot of the column) moves less than the
 * panel is tall, and closing it by the footprint carried the footer 465px past where it then dropped
 * back to. And a panel closing at the end of a scrolled page — where its 保存 and 取消 are — makes
 * the browser clamp the scroll offset, so everything above it drops by the clamp: `shift`.
 *
 * The panel is collapsed for the one read rather than hidden — a focused field inside it keeps its
 * box, so it keeps focus — and the scroll offset the read clamped is put back.
 */
function layoutWithout(panel: HTMLElement, targets: HTMLElement[]): { tops: number[]; shift: number } {
  const scroller = getAppScroller();
  const scrollTop = scroller?.scrollTop ?? 0;
  const { height, marginTop } = panel.style;
  panel.style.height = '0px';
  panel.style.marginTop = '0px';
  const tops = targets.map((el) => el.getBoundingClientRect().top);
  const shift = scroller ? scrollTop - scroller.scrollTop : 0;
  panel.style.height = height;
  panel.style.marginTop = marginTop;
  if (scroller && scroller.scrollTop !== scrollTop) scroller.scrollTop = scrollTop;
  return { tops, shift };
}

/**
 * Opens a panel that was not on screen. 标准: the clip grows down on DefaultSpatial while what
 * follows glides down on the same spring from where it was drawn, and the content rises in behind
 * it, 40ms late — offset rather than shortened, so it reads as arriving *behind* the panel (its
 * opacity on the effects twin, which cannot overshoot). 减弱 fades the panel in and moves nothing —
 * the reflow is a long travel, which that tier drops; 关闭 appears outright.
 */
function open(panel: HTMLElement, surface: HTMLElement, tier: MotionTier, capture: Capture | null): Run {
  const run: Run = { phase: 'open', own: [], moved: [], corner: null, landing: null };
  if (tier === 'off') return run;
  const corners = cornerRow(panel);
  if (tier === 'reduced') {
    const fade = springTiming('fastEffects');
    run.own.push(panel.animate([{ opacity: 0 }, { opacity: 1 }], fade));
    if (corners) run.corner = cornerTrack(corners.row, corners.end, corners.seam, fade);
    return run;
  }
  const { height, distance } = footprint(panel);
  const spatial = springTiming('defaultSpatial');
  const effects = springTiming('defaultEffects');
  const lag = scaledMs(CONTENT_LAG_MS);

  /* Reads first. Each follower starts where it was drawn on the press — or, for an open nothing
     pressed, where it is drawn with the panel taking no room — measured against where the layout
     has it now (its box less any move it is still drawn at, which the new move replaces). */
  const targets = followersOf(panel, { top: -distance, bottom: window.innerHeight + distance });
  const before = targets.some((el) => !capture?.tops.has(el)) ? layoutWithout(panel, targets).tops : null;
  const offsets = targets.map((el, index) => {
    const drawn = el.getBoundingClientRect().top;
    return (capture?.tops.get(el) ?? before?.[index] ?? drawn) - (drawn - drawnOffsetY(el));
  });

  run.own.push(
    panel.animate([{ translate: `0 ${-height}px` }, { translate: 'none' }], spatial),
    surface.animate([{ translate: `0 ${height}px` }, { translate: 'none' }], spatial),
  );
  /* The row's corners square on the clip's spring, as the panel arrives under them. */
  if (corners) run.corner = cornerTrack(corners.row, corners.end, corners.seam, spatial);
  for (const child of Array.from(surface.children)) {
    run.own.push(
      child.animate([{ translate: `0 ${-CONTENT_TRAVEL}px` }, { translate: 'none' }], { ...spatial, delay: lag, fill: 'backwards' }),
      child.animate([{ opacity: 0 }, { opacity: 1 }], { ...effects, delay: lag, fill: 'backwards' }),
    );
  }
  targets.forEach((el, index) => {
    if (Math.abs(offsets[index]) < 0.5) {
      dropMove(el);
      return;
    }
    run.moved.push([el, startMove(el, [{ transform: `translateY(${offsets[index]}px)` }, { transform: 'none' }], spatial)]);
  });
  return run;
}

/**
 * Sends the panel the other way from where it is drawn now — a close of an open (or opening)
 * panel, or a close turned back. Every part leaves from its current pose: the content with no lag,
 * since a reversal resumes the visible pose rather than putting a delay in its way.
 *
 * Closing (标准): the content sinks out and the clip closes upward on FastEffects while what follows
 * glides up to where it will be on the same clock — one gesture, one clock, or the gap outlives the
 * panel — and, at the end of a scrolled page, what precedes it (the clip with it) glides down by the
 * clamp the removal will cause; the tracks hold their end (`fill: forwards`) until the panel goes.
 * Re-opening: the same parts back to rest on the opening's spring. 减弱 fades the panel alone; 关闭
 * runs nothing, and a close removes the panel in a microtask.
 */
function turn(panel: HTMLElement, surface: HTMLElement, tier: MotionTier, previous: Run | null, phase: 'open' | 'close'): Run {
  const run: Run = { phase, own: [], moved: [], corner: null, landing: null };
  const closing = phase === 'close';
  const { height, distance } = footprint(panel);
  const content = Array.from(surface.children);
  const view = window.innerHeight;
  const moved = [...new Set([
    ...(previous?.moved ?? []).map(([el]) => el),
    ...followersOf(panel, { top: -distance, bottom: view + distance }),
  ])].filter((el) => el.isConnected);
  /* Reads, then the previous run goes: its tracks are cancelled only once their pose is known. A
     close sends each follower to where it will be drawn once the panel is gone, and what precedes
     the panel down by the page's shift. */
  const without = closing && tier === 'standard' ? layoutWithout(panel, moved) : null;
  const shift = without && without.shift >= 0.5 ? without.shift : 0;
  const above = shift ? precedersOf(panel, { top: -shift, bottom: view }).filter((el) => !moved.includes(el)) : [];
  const targets = [...moved, ...above];
  const panelPose = poseOf(panel);
  const surfacePose = poseOf(surface);
  const contentPoses = content.map(poseOf);
  const offsets = targets.map(drawnOffsetY);
  const ends = targets.map((el, index) => {
    if (index >= moved.length) return shift;
    return without ? without.tops[index] - el.getBoundingClientRect().top : 0;
  });
  /* The row's corners leave from where they are drawn — a turned run's track included — and their
     rest is read once that track is gone. */
  const cornerFrom = panel.previousElementSibling instanceof HTMLElement ? getComputedStyle(panel.previousElementSibling).borderBottomLeftRadius : null;
  for (const animation of previous?.own ?? []) animation.cancel();
  previous?.corner?.cancel();
  const corners = cornerRow(panel);

  if (tier !== 'standard') {
    for (const [el, animation] of previous?.moved ?? []) dropMove(el, animation);
    if (tier === 'reduced') {
      const fade: KeyframeAnimationOptions = { ...springTiming('fastEffects'), fill: closing ? 'forwards' : 'auto' };
      run.own.push(panel.animate([{ opacity: panelPose.opacity }, { opacity: closing ? 0 : 1 }], fade));
      if (corners && cornerFrom) run.corner = cornerTrack(corners.row, cornerFrom, closing ? corners.end : corners.seam, fade);
    }
    return run;
  }
  const timing: KeyframeAnimationOptions = closing ? { ...springTiming('fastEffects'), fill: 'forwards' } : springTiming('defaultSpatial');
  const fade: KeyframeAnimationOptions = closing ? timing : springTiming('defaultEffects');
  run.own.push(
    panel.animate([{ translate: panelPose.translate, opacity: panelPose.opacity }, { translate: closing ? `0 ${shift - height}px` : 'none', opacity: 1 }], timing),
    surface.animate([{ translate: surfacePose.translate }, { translate: closing ? `0 ${height}px` : 'none' }], timing),
  );
  content.forEach((child, index) => {
    run.own.push(
      child.animate([{ translate: contentPoses[index].translate }, { translate: closing ? `0 ${-CONTENT_TRAVEL}px` : 'none' }], timing),
      child.animate([{ opacity: contentPoses[index].opacity }, { opacity: closing ? 0 : 1 }], fade),
    );
  });
  if (corners && cornerFrom) run.corner = cornerTrack(corners.row, cornerFrom, closing ? corners.end : corners.seam, timing);
  targets.forEach((el, index) => {
    run.moved.push([el, startMove(el, [
      { transform: `translateY(${offsets[index]}px)` },
      { transform: ends[index] ? `translateY(${ends[index]}px)` : 'none' },
    ], timing)]);
  });
  return run;
}
