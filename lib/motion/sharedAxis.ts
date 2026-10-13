'use client';

import { motionScale, motionTier } from '@/lib/appearance';
import { getAppScroller } from '@/lib/appScroller';
import { DURATION, EASE } from '@/lib/motionTokens';
import {
  freshStripLeg, lagSampler, stripProgress, turnStrip, STRIP_DURATION_MS,
  type StripLeg, type StripSegment,
} from '@/lib/tabStrip';
import type { LeanPlan, PaneClip } from './tabGeometry';

/* ---------------------------------------------------------------------------
 * Shared axis — Material 3, one plane rather than two layers, run by the compositor
 *
 * **The two sides are laid end to end and the strip is what moves.** The incoming
 * side starts a whole window-width away — not the spec's 30dp — so at every instant
 * the two are exactly adjacent: outgoing at `-d·p`, incoming at `d·(1-p)`, always `d`
 * apart, the width of the window they slide past. Neither is ever painted over the
 * other; the window clips whatever is outside it.
 *
 * That is why there is no cross-fade: an opacity handoff *is* two layers stacked —
 * for the length of the fade both sides occupy the same pixels, which is precisely
 * what read as "a layer sliding up from the right". A 30dp nudge cannot carry the
 * movement alone, so full travel and no fade go together: a deliberate divergence
 * from the spec's numbers in service of what the spec is describing.
 *
 * **Each side is one element and one Web Animations `transform`**, which the engine hands
 * to the compositor whole: a frame costs the main thread nothing, so the router's commit, a
 * font slice landing or an image decoding during the switch no longer lands on the
 * animation's clock, and a hover hit test finds nothing dirty to lay out. And the pane moves
 * as a unit, so everything inside it moves by construction — a row, a wrapper with no box of
 * its own, an inline error, whatever a later feature adds.
 *
 * **On a leaning panel (`TabPanes lean`) the blocks on screen ease after their pane**, a little
 * further behind the lower they sit, so the page leaves on a shear — the layered departure — and
 * lands from the top down, never past its place (`lagSampler` in `lib/tabStrip.ts`). Each such
 * block is one more Web Animations transform, set up once in the tap — its lag behind the pane, on
 * top of the pane's own — while everything else keeps riding the pane.
 * The blocks come from the structure (`leanPlan`), never from marks, and only those on
 * screen lean. It used to be GSAP writing a transform to every marked block every frame (on
 * the production build one tap on 论坛 spent 25–35 layouts and ~540 forced style and layout
 * passes inside its run); marks it had not been given — the gallery's 全部 / 本站讨论 row, in a
 * wrapper with no box — stood still while their pane slid.
 *
 * **On a wide screen the window is the content column and a faded margin** (`columnWindow` in
 * `lib/tabStrip.ts`), not the whole scroller: each side fades out as it passes the window's edge
 * and in as it comes through the other one, rather than crossing the blank margins to be cut off
 * at the drawer and the scrollbar. The fade is a mask on the panel, which does not move, so it
 * stays at the window's edges while the panes pass through it — spatial, not a cross-fade: the two
 * sides never share a pixel.
 *
 * Nothing waits for the router: both panes are already mounted, so the transition
 * only needs the *attribute* that gives the incoming one a box — which this owns.
 * The route commit that follows is a visual no-op.
 * ------------------------------------------------------------------------ */

/**
 * Extra plate between the two pages, px, on top of whatever the layout gives.
 *
 * Where the window the pages slide past is the scroller — sidebar edge to screen edge —
 * the content column is centred inside it, so the two side margins are already empty
 * space between the pages: they sit one window apart on the strip, content centred in
 * its own window, exactly as a paged carousel does it. This is the floor under that,
 * for the phone layout where the column fills the window. Without a plate, edge-to-edge
 * pages read as one page shoving the other. A window bounded to the column on a wide
 * screen (`columnWindow`) needs none: the pages there sit twice its reach apart, at
 * least 112px, which is a plate already.
 *
 * A delay on the incoming side would also open a gap, and is the wrong mechanism:
 * the plate would stretch and close over the run, so the strip reads as elastic
 * instead of rigid. A carousel's pages are a fixed distance apart — that fixity is
 * what sells them as one surface.
 */
export const AXIS_GAP = 96;
/**
 * How far the reduced tier shifts each side, instead of a whole window's width.
 * Enough to carry the *direction* of the move, short enough not to read as a slide
 * — the 24dp M3's own shared axis uses for its small-container form, the same order
 * as the 8px an entrance travels here. A cross-fade cannot say which way you went,
 * and on a tab bar that is half the information.
 */
const REDUCED_AXIS_SHIFT_PX = 24;

/* The strip's motion — a critically damped spring the tap launches, and the leg a second tap
 * turns it onto — is `lib/tabStrip.ts`, where its numbers are argued and tested. */

/** A turn's first frame later than this after the tap (1.5 frames at 60 Hz) restarts the new
 *  leg from that frame — see `turn` in `playSharedAxis`. */
const STRIP_LATE_FRAME_MS = 25;

/**
 * A fresh run's lean, by speed, window, leg and depth. It depends on nothing else — a run's first
 * leg is the same every time — so the lags are worked out once and every later switch at that
 * width reuses them: planning happens inside the press, and on a phone at 4× CPU the home pill's
 * two panes already outlast it. A turn's lean depends on its history and is never kept.
 */
const freshLean = new Map<string, Array<[number, number]>>();
const FRESH_LEAN_LIMIT = 256;

/** Whether the engine can fade a window's edges (`edge`): a strip bounded to the column without
 *  them would show the arriving side waiting in the margin, so the scroller stays the window. */
export function supportsEdgeMask(): boolean {
  return typeof CSS !== 'undefined' && !!CSS.supports?.('mask-image', 'linear-gradient(#000, #000)');
}

/** Whether the engine takes a `linear()` easing — the strip's shape, and the lean's. */
function supportsLinearEasing(): boolean {
  return typeof CSS !== 'undefined' && !!CSS.supports?.('transition-timing-function', 'linear(0, 1)');
}

/**
 * A response as a Web Animations easing, sampled where it bends until straight segments stay
 * within 0.15% of it. An engine without `linear()` gets the emphasized decelerate — the one
 * cubic that also leaves at speed.
 */
function linearEasingOf(ease: (t: number) => number, tolerance = 0.0015): string {
  if (!supportsLinearEasing()) return EASE.decelerate;
  const stops: string[] = [`${+ease(0).toFixed(4)} 0%`];
  const split = (t0: number, v0: number, t1: number, v1: number, depth: number) => {
    const mid = (t0 + t1) / 2;
    const value = ease(mid);
    if (depth < 4 || (depth < 12 && Math.abs(value - (v0 + v1) / 2) > tolerance)) {
      split(t0, v0, mid, value, depth + 1);
      split(mid, value, t1, v1, depth + 1);
      return;
    }
    stops.push(`${+v1.toFixed(4)} ${+(t1 * 100).toFixed(3)}%`);
  };
  split(0, ease(0), 1, ease(1), 0);
  return `linear(${stops.join(', ')})`;
}

export interface SharedAxisHandle {
  /** Jump to the end state and run the settle callback. Idempotent. */
  finish(): void;
  /**
   * Send the run back towards its start from wherever it is — a tap on the tab it is leaving
   * turns the strip round at once, rather than snapping to the end and sliding back — and
   * settle there, with `onSettle(true)`. A second call turns it again. False once settled, and
   * while the run is still held.
   */
  reverse(): boolean;
  /**
   * Start a run created `held`, with the outgoing pane's vertical compensation as it now is (the
   * scroll restore is written with it, in the same task). A no-op on a run already moving.
   */
  play(leavingOffsetY?: number): void;
  /** Let go of everything the run holds without settling it: nothing moved, nothing to land. */
  cancel(): void;
}

/**
 * Slides `leaving` out and `entering` in along one axis as a single plane. Both elements
 * must already have a box — see the grid rules for `[data-tab-panel]` in globals.css, which
 * stack the panes in one cell so the row height is `max(outgoing, incoming)` for the run.
 *
 * Reads nothing when the caller passes `distance`: the caller has already laid the panes out
 * (the one forced layout of a switch). The animations are created in this task and start
 * together on the next frame the compositor draws.
 */
export function playSharedAxis(opts: {
  leaving: HTMLElement;
  entering: HTMLElement;
  /** Which way the strip travels. */
  axis?: 'x' | 'y';
  /** +1 = moving forward; the outgoing side exits towards the negative end. */
  direction: 1 | -1;
  /** Width (or height) of the window the strip slides past, gap included. Defaults to
   *  the window's own box plus `AXIS_GAP` — pass it when it was read before a write. */
  distance?: number;
  /** The window itself, clipped for the run: the app scroller unless the caller names a region
   *  that bounds the panes (`[data-tab-window]`, see `runTabTransition`). */
  view?: HTMLElement | null;
  /** Vertical compensation for a scroll restore, held by the outgoing pane for the run. */
  leavingOffsetY?: number;
  /** The blocks that lean (`leanPlan`, both panes). The standard tier on the x axis only:
   *  减弱 drops the stagger with the rest of the performance, and 关闭 is a cut. */
  lean?: LeanPlan;
  /** What of each pane to clip for the run (`paneClip`): the rows the window cannot show, which
   *  an animated transform would otherwise have painted whole. `offset` is the scroller's offset
   *  they were measured for; a scroll away from it during the run widens them. */
  clip?: { leaving: PaneClip | null; entering: PaneClip | null; offset: number };
  /** On a wide screen, the window's edges (`columnWindow`): `panel`'s box is widened by `reach`
   *  on either side for the run and masked to it, fading over `fade` at each edge. The standard
   *  tier on the x axis only — the reduced tier's shift stays inside the column. */
  edge?: { panel: HTMLElement; reach: number; fade: number };
  /** `reversed`: the run was sent back to its start (`reverse`), so `leaving` stays. */
  onSettle?: (reversed: boolean) => void;
  /**
   * Set it up at its first pose and hold it there until `play` — the press on a tab, which
   * primes its switch (`primeTabTransition`). Held, every animation is in effect at its start:
   * the panes and the blocks are composited and the arriving pane is painted whole (an animated
   * transform's subtree is painted without culling) in the frames the finger is still down, so
   * the click that follows has only to start the clock.
   */
  held?: boolean;
}): SharedAxisHandle {
  const { leaving, entering, axis = 'x', direction, onSettle } = opts;
  let leavingOffsetY = opts.leavingOffsetY ?? 0;
  let held = opts.held === true;
  const tier = motionTier('tabs');
  const scale = motionScale('tabs');

  /* The window the strip slides past is the *scroller*, not the pane: the pane is
   * the centred content column, the scroller runs sidebar edge to screen edge. One
   * column of travel made the incoming page appear mid-page with the two pages edge
   * to edge and no plate; one *window* of travel fixes both — pages enter and leave
   * at the content-area edges, and each being centred in its own window, the side
   * margins become the gap. A caller whose panes live in a bounded region names it. */
  const view = opts.view ?? getAppScroller();
  const distance =
    opts.distance ??
    (axis === 'x'
      ? view?.clientWidth || entering.getBoundingClientRect().width
      : view?.clientHeight || entering.getBoundingClientRect().height) + AXIS_GAP;

  let settled = false;
  let reversed = false;
  const animations: Animation[] = [];
  /** Leaning blocks stacked for the run, with the inline position and z-index to give back. */
  const lifted: Array<[HTMLElement, string, string]> = [];
  /** Panes clipped for the run, with the inline clip-path to give back. */
  const clipped = new Map<HTMLElement, string>();
  let stopClipWatch = () => {};
  /* Gives the panel back the box and mask it had before the window's edges (`edge`). */
  let restoreEdge = () => {};

  /* CSS transitions are frozen on the two moved panes, inline, for the length of the run,
     and handed back after the cancel is committed — otherwise a pane's own transform
     transition would animate the snap from the last frame back to rest. The previous inline
     value is put back, not merely removed. */
  const frozen = new Map<HTMLElement, string>();
  const freeze = (nodes: HTMLElement[]) => {
    for (const node of nodes) {
      if (frozen.has(node)) continue;
      frozen.set(node, node.style.transition);
      node.style.transition = 'none';
    }
  };

  const teardown = () => {
    settled = true;
    view?.removeAttribute('data-axis-running');
    /* Nothing may keep a transform. `lib/hero/dom.ts` only compensates for a
     * transform on `[data-image-detail-background-visual]`, so a residual one on a
     * pane — an ancestor of every gallery card — would silently corrupt the rect the
     * hero flight reads on press. Every animation fills both ways, so this cancel is the
     * one place any of them lets go; the caller hides the pane that left in the same task. */
    for (const animation of animations) animation.cancel();
    /* Given back before the read below, so the one layout the settle forces covers it too — a
       block that loses its transform is a containing block no more, and after the read the
       restack cost the settle's height check a second forced layout (measured). */
    for (const [el, position, zIndex] of lifted.splice(0)) {
      el.style.position = position;
      el.style.zIndex = zIndex;
    }
    stopClipWatch();
    for (const [node, previous] of clipped) node.style.clipPath = previous;
    clipped.clear();
    restoreEdge();
    restoreEdge = () => {};
    if (frozen.size > 0) {
      void getComputedStyle(leaving).transform;
      for (const [node, previous] of frozen) node.style.transition = previous;
      frozen.clear();
    }
  };
  const settle = () => {
    if (settled) return;
    teardown();
    onSettle?.(reversed);
  };

  /* The reduced cross-fade plays itself back; the standard strip replaces this with its
     relaunch below. */
  let turn = () => {
    reversed = !reversed;
    for (const animation of animations) animation.reverse();
  };
  /* The outgoing pane's keyframes for the leg in hand — rebuilt when `play` brings a vertical
     compensation the held run was set up without. Replaced by each branch below. */
  let leavingKeyframes: () => Keyframe[] = () => [];
  const handle: SharedAxisHandle = {
    finish: settle,
    reverse: () => {
      if (settled || held || animations.length === 0) return false;
      turn();
      return true;
    },
    play: (offsetY = 0) => {
      if (settled || !held) return;
      held = false;
      if (offsetY !== leavingOffsetY) {
        leavingOffsetY = offsetY;
        (animations[0]?.effect as KeyframeEffect | null)?.setKeyframes(leavingKeyframes());
      }
      /* From its hold at 0: each is play-pending until the next frame the compositor draws,
         which starts them together, as a fresh run's are. */
      for (const animation of animations) animation.play();
    },
    cancel: () => {
      if (settled) return;
      teardown();
    },
  };

  if (tier === 'off' || distance <= 0 || scale <= 0) {
    /* Nothing to hold: a held run settles when it is played, a moving one at once. */
    if (held) {
      handle.play = () => {
        if (!settled) settle();
      };
      return handle;
    }
    queueMicrotask(settle);
    return handle;
  }

  /* Settles once both animations have reached whichever end they are heading for — `finish`
     fires again after a `reverse`, and `playState` says which way it ended. */
  const maybeSettle = () => {
    if (!settled && animations.every((animation) => animation.playState === 'finished')) settle();
  };
  /* Named, so a probe (`npm run net:tabs`) can tell the strip's own animations from anything
     else running inside a pane: `tab-strip` on a pane, `tab-lean` on a block. */
  const adopt = (animation: Animation, id: string) => {
    animation.id = id;
    animation.addEventListener('finish', maybeSettle);
    animations.push(animation);
    /* Held at its first pose: in effect, so composited and painted, but not running. */
    if (held) animation.pause();
  };
  const run = (node: HTMLElement, keyframes: Keyframe[], timing: KeyframeAnimationOptions) =>
    adopt(node.animate(keyframes, timing), 'tab-strip');
  const place = (along: number, y = 0) =>
    axis === 'x' ? `translate3d(${along}px, ${y}px, 0)` : `translate3d(0, ${along + y}px, 0)`;

  /* Turn the scroller into that window for the length of the run. Set before
   * anything is offset, so no frame paints a page hanging outside it or hands the
   * scroller something to scroll sideways. Callers always settle the previous run
   * first, so the attribute cannot be cleared from under a live one. */
  view?.setAttribute('data-axis-running', axis);
  freeze([leaving, entering]);

  /* Each pane cut to the rows the window can show (`clip`), in its own coordinates — so it moves
     with the pane — and widened to whatever a scroll during the run brings into view: both panes
     ride the scroller, so a scroll moves the band in each by the same amount. Read off the
     scroller in a frame, never in the scroll event, and written only when it grows. */
  const scroller = getAppScroller();
  const bands: Array<{ node: HTMLElement; initial: PaneClip; band: PaneClip }> = [];
  for (const [node, band] of [[leaving, opts.clip?.leaving], [entering, opts.clip?.entering]] as const) {
    if (!band || axis !== 'x') continue;
    clipped.set(node, node.style.clipPath);
    bands.push({ node, initial: band, band: { ...band } });
  }
  const writeClip = (node: HTMLElement, band: PaneClip) => {
    node.style.clipPath = `inset(${band.top}px -100vw ${band.bottom}px -100vw)`;
  };
  for (const { node, band } of bands) writeClip(node, band);
  if (bands.length > 0 && scroller) {
    const from = opts.clip?.offset ?? 0;
    let frame = 0;
    const widen = () => {
      frame = 0;
      if (settled) return;
      const delta = scroller.scrollTop - from;
      for (const { node, initial, band } of bands) {
        const top = Math.min(band.top, Math.max(0, initial.top + delta));
        const bottom = Math.min(band.bottom, Math.max(0, initial.bottom - delta));
        if (top === band.top && bottom === band.bottom) continue;
        band.top = top;
        band.bottom = bottom;
        writeClip(node, band);
      }
    };
    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(widen);
    };
    scroller.addEventListener('scroll', onScroll, { passive: true });
    stopClipWatch = () => {
      scroller.removeEventListener('scroll', onScroll);
      if (frame) cancelAnimationFrame(frame);
      frame = 0;
    };
  }

  /* Reduced: the panes cross-fade with a short shift instead of sliding a window's
   * width. Dropped: the *distance* (a full-window slide is the performance). Survives:
   * direction — 24px reads "the next one came from the right", which a bare cross-fade
   * cannot say. `leavingOffsetY` still applies, held rather than travelled: not travel, but
   * holding the outgoing pane over the pixels the eye was on after the scroller moved to the
   * destination's remembered offset. */
  if (tier === 'reduced') {
    const shift = REDUCED_AXIS_SHIFT_PX * direction;
    leavingKeyframes = () => [
      { transform: place(0, leavingOffsetY), opacity: 1 },
      { transform: place(-shift, leavingOffsetY), opacity: 0 },
    ];
    run(leaving, leavingKeyframes(), {
      duration: DURATION.press * 1000 * scale,
      easing: EASE.accelerate,
      fill: 'both',
    });
    run(
      entering,
      [
        { transform: place(shift), opacity: 0 },
        { transform: place(0), opacity: 1 },
      ],
      { duration: DURATION.short * 1000 * scale, easing: EASE.decelerate, fill: 'both' },
    );
    return handle;
  }

  /* **The window's edges** (`edge`): the panel's box widened to the window for the run, and masked
     to it — transparent at the box's edges, opaque from `fade` in. The widening is a margin and a
     padding of the same size, so the panes keep their box and nothing they hold is laid out again;
     the panel does not move, so the fade stays where the window ends while the panes pass through
     it. A wider box rather than a mask allowed to reach past the panel's own box: Chromium drops
     such a mask over composited content — over the panes, for the whole run (measured).
     Written with the run's other styles, before its first frame, held runs included: an
     arriving pane held at its first pose sits a window's width out, in the margin. */
  if (opts.edge && axis === 'x') {
    const { panel, reach, fade } = opts.edge;
    const style = panel.style;
    const before = [style.marginLeft, style.marginRight, style.paddingLeft, style.paddingRight, style.maskImage];
    style.marginLeft = style.marginRight = `${-reach}px`;
    style.paddingLeft = style.paddingRight = `${reach}px`;
    style.maskImage = `linear-gradient(to right, transparent, black ${fade}px, black calc(100% - ${fade}px), transparent)`;
    restoreEdge = () => {
      [style.marginLeft, style.marginRight, style.paddingLeft, style.paddingRight, style.maskImage] = before;
    };
  }

  /* The strip as one number, `p`: 0 rests on `leaving`, 1 on `entering`. A leg runs `p` from
   * where the strip is to one side; both panes take the same keyframes and timing, so at every
   * instant the pair is exactly one window apart. Filling both ways holds the arriving pane
   * off-screen until the compositor starts the leg, and both at their ends until the settle
   * lets go. */
  const full = STRIP_DURATION_MS * scale;
  let leg = freshStripLeg(full);
  /* Every leg the strip has run, for the blocks: each eases after the strip from the run's
     start, and meets a turn from where it is. The times are the timeline's, except
     while the first leg is waiting for the compositor to start it — then they are that leg's own,
     from 0, and the blocks wait with it. */
  let history: StripSegment[] = [];
  let historyPending = false;
  /* The lean's shape is a `linear()` easing (below); an engine without one gets no lean. */
  const leans = axis === 'x' && supportsLinearEasing();
  const blocks = leans ? (opts.lean?.blocks ?? []) : [];
  /* Restacked for the run — see `LeanPlan` — in the frame the run starts rather than in the tap:
     written in the tap, the inline writes made every attribute React sets in that same task
     cost more (setAttribute's own time at 4× CPU, 23ms → 46–53ms, measured). Before that frame's
     style pass, so the first frame that moves is already stacked. */
  const lift = leans ? (opts.lean?.lift ?? []) : [];
  if (lift.length > 0) {
    requestAnimationFrame(() => {
      if (settled) return;
      for (const { el, position } of lift) {
        lifted.push([el, el.style.position, el.style.zIndex]);
        if (position) el.style.position = 'relative';
        el.style.zIndex = '1';
      }
    });
  }
  /* Blocks at one depth share the lag's shape (one easing), and those that also share their own
     transform share one parsed model (`startLeg`). */
  const byDepth = new Map<number, Map<string, HTMLElement[]>>();
  for (const { el, depth, base } of blocks) {
    const bases = byDepth.get(depth) ?? new Map<string, HTMLElement[]>();
    byDepth.set(depth, bases);
    bases.set(base, [...(bases.get(base) ?? []), el]);
  }
  /* A pixel and a half: invisible in a lag of an eighth of the window at its peak, and it keeps
     the lag's easing to 6–12 stops a depth; a block counts as landed at a third of it. */
  const tolerance = 1.5 / distance;

  const startLeg = (next: StripLeg, startTime: number | null, prior: readonly StripSegment[]) => {
    for (const animation of animations) animation.cancel();
    animations.length = 0;
    leg = next;
    const at = startTime ?? 0;
    history = [...prior, { leg: next, start: at }];
    historyPending = startTime === null;
    const timing = {
      duration: next.duration,
      easing: linearEasingOf(stripProgress(next.launch)),
      fill: 'both' as const,
    };
    leavingKeyframes = () => [
      { transform: place(-direction * distance * leg.from, leavingOffsetY) },
      { transform: place(-direction * distance * leg.to, leavingOffsetY) },
    ];
    run(leaving, leavingKeyframes(), timing);
    run(
      entering,
      [
        { transform: place(direction * distance * (1 - next.from)) },
        { transform: place(direction * distance * (1 - next.to)) },
      ],
      timing,
    );
    /* A block's own transform is its lag behind the pane it sits in, the same on both
       sides, in the direction of travel — sampled once per depth (`lagSampler`, which samples the
       strip once for all of them) and shared by every block at that depth. Linear between
       samples; the samples are the curve.
       **One keyframe pair, and the lag's shape as the easing**: from the pane's own place to the
       peak lag, with a `linear()` easing that rises to 1 and comes back — `linear()` may leave
       [0, 1] and return, which a lag that swells and settles needs (and a turn, which sends it
       negative). The same curve as a keyframe per sample, at a fraction of the cost: each block's
       effect is a copy of one model per depth (`new KeyframeEffect(model)`), which shares the
       parsed easing, and the engine resolves two values per block instead of twenty. */
    const fresh = prior.length === 0 && startTime === null;
    let lagAt: ((depth: number, tolerance: number) => Array<[number, number]>) | null = null;
    const lagOf = (depth: number) => {
      const key = fresh ? `${scale}|${Math.round(distance)}|${next.from}|${next.to}|${next.duration}|${next.launch}|${depth}` : null;
      const kept = key ? freshLean.get(key) : undefined;
      if (kept) return kept;
      lagAt ??= lagSampler(history, at, scale);
      const samples = lagAt(depth, tolerance);
      if (key) {
        if (freshLean.size >= FRESH_LEAN_LIMIT) freshLean.clear();
        freshLean.set(key, samples);
      }
      return samples;
    };
    for (const [depth, bases] of byDepth) {
      const samples = lagOf(depth);
      if (samples.length < 2) continue;
      const span = samples[samples.length - 1][0] - at;
      const peak = samples.reduce((most, [, lag]) => Math.max(most, Math.abs(lag)), 0);
      if (!(span > 0) || !(peak > 0)) continue;
      const easing = `linear(${samples
        .map(([t, lag]) => `${+(lag / peak).toFixed(5)} ${+(((t - at) / span) * 100).toFixed(3)}%`)
        .join(', ')})`;
      for (const [base, els] of bases) {
        const tail = base && base !== 'none' ? ` ${base}` : '';
        const model = new KeyframeEffect(
          null,
          [
            { transform: `translate3d(0px, 0px, 0px)${tail}` },
            { transform: `translate3d(${direction * distance * peak}px, 0px, 0px)${tail}` },
          ],
          { duration: span, easing, fill: 'both' },
        );
        for (const el of els) {
          const effect = new KeyframeEffect(model);
          effect.target = el;
          const animation = new Animation(effect, document.timeline);
          if (!held) animation.play();
          adopt(animation, 'tab-lean');
        }
      }
    }
    if (startTime !== null) for (const animation of animations) animation.startTime = startTime;
  };

  /* **A tap that turns the strip round sends it the other way at once**, from the pose on screen
   * (`turnStrip`). Played backwards instead (`Animation.reverse`), a leg went on the old way for
   * a frame while the engine resolved the new rate, and a late tap retraced the slow end of the
   * curve — the brake at the start of every quick re-switch. The blocks turn from where each of
   * them is: a lower one, further behind its pane, goes on the old way until the pane comes back
   * past it, so the lean reverses top first, as a wave, and no block starts over.
   *
   * The pose is the old leg's at the moment of the tap, and the new leg starts at that moment,
   * so a frame committed on time carries straight on from it. `performance.now()`, not the
   * timeline's time: with nothing on the main thread animating, the engine may stop producing
   * main frames while the compositor goes on drawing, and the timeline's time is then the last
   * main frame's, however long ago. A commit that comes late — the tap's own work on a slow
   * phone — would open the new leg ahead of the pose the compositor had got to, a jump; so the
   * first frame checks, and past a frame and a half it starts the leg again from that frame. */
  turn = () => {
    const previous = leg;
    const lead = animations[0];
    const began = typeof lead?.startTime === 'number' ? lead.startTime : null;
    /* Nothing has moved while the first leg is still waiting to start. */
    const prior =
      began === null
        ? []
        : historyPending
          ? history.map((segment) => ({ leg: segment.leg, start: segment.start + began }))
          : history;
    const launch = (at: number) => {
      const next = turnStrip(previous, began === null ? 0 : at - began, full);
      reversed = next.to === 0;
      startLeg(next, began === null ? null : at, prior);
      return next;
    };
    const tapped = performance.now();
    const current = launch(tapped);
    if (began === null) return;
    requestAnimationFrame((frame) => {
      if (!settled && leg === current && frame - tapped > STRIP_LATE_FRAME_MS) launch(frame);
    });
  };

  startLeg(leg, null, []);
  return handle;
}
