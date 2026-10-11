'use client';

import { motionScale, motionTier } from '@/lib/appearance';
import { getAppScroller } from '@/lib/appScroller';
import { DURATION, EASE } from '@/lib/motionTokens';
import {
  freshStripLeg, lagSamples, stripProgress, turnStrip, STRIP_DURATION_MS,
  type StripLeg, type StripSegment,
} from '@/lib/tabStrip';
import type { LeanPlan } from './tabGeometry';

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
 * **On a leaning panel (`TabPanes lean`) the blocks on screen follow a little late**, top
 * first, so the page leaves on a shear: the layered departure. Each such block is one more Web
 * Animations transform, set up once in the tap — the *difference* between the strip and the
 * strip `delay` ms earlier, `S(t) − S(t − delay)`, on top of the pane's own — so the block
 * lands exactly where the strip was `delay` ago while everything else keeps riding the pane.
 * The blocks come from the structure (`leanPlan`), never from marks, and only those on
 * screen lean. It used to be GSAP writing a transform to every marked block every frame (on
 * the production build one tap on 论坛 spent 25–35 layouts and ~540 forced style and layout
 * passes inside its run); marks it had not been given — the gallery's 全部 / 本站讨论 row, in a
 * wrapper with no box — stood still while their pane slid.
 *
 * Nothing waits for the router: both panes are already mounted, so the transition
 * only needs the *attribute* that gives the incoming one a box — which this owns.
 * The route commit that follows is a visual no-op.
 * ------------------------------------------------------------------------ */

/**
 * Extra plate between the two pages, px, on top of whatever the layout gives.
 *
 * The window the pages slide past is the scroller — sidebar edge to screen edge —
 * and the content column is centred inside it, so the two side margins are already
 * empty space between the pages: they sit one window apart on the strip, content
 * centred in its own window, exactly as a paged carousel does it. This is the floor
 * under that, for the phone layout where the column fills the window. Without a
 * plate, edge-to-edge pages read as one page shoving the other.
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
   * settle there, with `onSettle(true)`. A second call turns it again. False once settled.
   */
  reverse(): boolean;
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
  /** `reversed`: the run was sent back to its start (`reverse`), so `leaving` stays. */
  onSettle?: (reversed: boolean) => void;
}): SharedAxisHandle {
  const { leaving, entering, axis = 'x', direction, leavingOffsetY = 0, onSettle } = opts;
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

  const settle = () => {
    if (settled) return;
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
    if (frozen.size > 0) {
      void getComputedStyle(leaving).transform;
      for (const [node, previous] of frozen) node.style.transition = previous;
      frozen.clear();
    }
    onSettle?.(reversed);
  };

  /* The reduced cross-fade plays itself back; the standard strip replaces this with its
     relaunch below. */
  let turn = () => {
    reversed = !reversed;
    for (const animation of animations) animation.reverse();
  };
  const handle: SharedAxisHandle = {
    finish: settle,
    reverse: () => {
      if (settled || animations.length === 0) return false;
      turn();
      return true;
    },
  };

  if (tier === 'off' || distance <= 0 || scale <= 0) {
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

  /* Reduced: the panes cross-fade with a short shift instead of sliding a window's
   * width. Dropped: the *distance* (a full-window slide is the performance). Survives:
   * direction — 24px reads "the next one came from the right", which a bare cross-fade
   * cannot say. `leavingOffsetY` still applies, held rather than travelled: not travel, but
   * holding the outgoing pane over the pixels the eye was on after the scroller moved to the
   * destination's remembered offset. */
  if (tier === 'reduced') {
    const shift = REDUCED_AXIS_SHIFT_PX * direction;
    run(
      leaving,
      [
        { transform: place(0, leavingOffsetY), opacity: 1 },
        { transform: place(-shift, leavingOffsetY), opacity: 0 },
      ],
      { duration: DURATION.press * 1000 * scale, easing: EASE.accelerate, fill: 'both' },
    );
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

  /* The strip as one number, `p`: 0 rests on `leaving`, 1 on `entering`. A leg runs `p` from
   * where the strip is to one side; both panes take the same keyframes and timing, so at every
   * instant the pair is exactly one window apart. Filling both ways holds the arriving pane
   * off-screen until the compositor starts the leg, and both at their ends until the settle
   * lets go. */
  const full = STRIP_DURATION_MS * scale;
  let leg = freshStripLeg(full);
  /* Every leg the strip has run, for the blocks: a block `delay` late is where the strip was
     `delay` ago, which after a turn can still be on the leg before it. The times are the
     timeline's, except while the first leg is waiting for the compositor to start it — then they
     are that leg's own, from 0, and the blocks wait with it. */
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
  /* Blocks that share a delay share the lag's shape (one easing), and those that also share their
     own transform share one parsed model (`startLeg`). */
  const byDelay = new Map<number, Map<string, HTMLElement[]>>();
  for (const { el, delay, base } of blocks) {
    const bases = byDelay.get(delay * scale) ?? new Map<string, HTMLElement[]>();
    byDelay.set(delay * scale, bases);
    bases.set(base, [...(bases.get(base) ?? []), el]);
  }
  /* A pixel and a half: invisible in a lag that is a third of a window at its peak, and it keeps
     the lag's easing to 15–25 stops. */
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
    run(
      leaving,
      [
        { transform: place(-direction * distance * next.from, leavingOffsetY) },
        { transform: place(-direction * distance * next.to, leavingOffsetY) },
      ],
      timing,
    );
    run(
      entering,
      [
        { transform: place(direction * distance * (1 - next.from)) },
        { transform: place(direction * distance * (1 - next.to)) },
      ],
      timing,
    );
    /* A block's own transform is its lag behind the pane it sits in, the same on both sides —
       `+d·(S(t) − S(t − delay))` in the direction of travel — sampled once per delay and
       shared by every block of that delay. Linear between samples; the samples are the curve.
       **One keyframe pair, and the lag's shape as the easing**: from the pane's own place to the
       peak lag, with a `linear()` easing that rises to 1 and comes back — `linear()` may leave
       [0, 1] and return, which a lag that swells and settles needs (and a turn, which sends it
       negative). The same curve as a keyframe per sample, at a fraction of the cost: each block's
       effect is a copy of one model per delay (`new KeyframeEffect(model)`), which shares the
       parsed easing, and the engine resolves two values per block instead of twenty. */
    for (const [delay, bases] of byDelay) {
      const samples = lagSamples(history, delay, at, tolerance);
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
          adopt(animation, 'tab-lean');
          animation.play();
        }
      }
    }
    if (startTime !== null) for (const animation of animations) animation.startTime = startTime;
  };

  /* **A tap that turns the strip round sends it the other way at once**, from the pose on screen
   * (`turnStrip`). Played backwards instead (`Animation.reverse`), a leg went on the old way for
   * a frame while the engine resolved the new rate, and a late tap retraced the slow end of the
   * curve — the brake at the start of every quick re-switch. The blocks turn from where each of
   * them is, in the order they left: each is still where the strip was `delay` ago, so it runs
   * on for its own delay and then follows the new leg — top first, the lean reversing as a wave
   * rather than any block starting over.
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
