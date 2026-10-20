'use client';

import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { scaledMs } from '@/lib/appearance';
import { MENU_TRANSITION, PAGE_FADE_TIMING, TRAVEL_PX } from '@/lib/motionTokens';
import { springTiming } from '@/lib/springTiming';
import { cn } from '@/lib/utils';

/** The side the arriving content comes in from. The departing one leaves towards the opposite. */
export type SwapSide = 'bottom' | 'left';

/** How far the two travel by default, in px — the 8 an entrance takes under the reduced tier. */
const DEFAULT_DISTANCE = TRAVEL_PX.small;

/** The pair of offsets the change animates between, for one side and one distance. */
function offsets(side: SwapSide, distance: number) {
  return side === 'bottom'
    ? { arrive: `translateY(${distance}px)`, depart: `translateY(-${distance}px)` }
    : { arrive: `translateX(-${distance}px)`, depart: `translateX(${distance}px)` };
}

interface SwapContentProps {
  /** What the box is showing. A new key is new content: the old one leaves as the new arrives. */
  contentKey: string;
  /**
   * The side the arriving content comes in from; the departing one leaves towards the opposite.
   * `bottom` reads as the content moving up (a row saying something else), `left` as it moving
   * right (a pane turning to the next one).
   */
  side?: SwapSide;
  /**
   * How far the two travel, in px. The default is a row's worth; a pane that is a whole form takes
   * more of one to read as a direction at all rather than as two cross-fades.
   */
  distance?: number;
  className?: string;
  /**
   * One element — the arriving content, always rendered live. A caller whose content re-renders
   * without this component's key changing (a filter chip toggling inside the same sentence) gets
   * its update: the key answers *when the box changes what it shows*, not what it holds.
   */
  children: ReactNode;
}

/**
 * A box that changes what it shows by handing over: what was there leaves in one direction and what
 * replaced it arrives from the other. Compose's `AnimatedContent`, for a box whose height is already
 * right or does not matter — `/search`'s semantic line, whose every state is one 40dp row.
 * `SizeSwap` is the sibling for a box whose *height* is what has to travel.
 *
 * **This component does not touch the height.** The departing element is a copy it holds, because
 * React drops the old node in the commit, and that copy is taken out of the flow (`absolute`) rather
 * than stacked in a cell beside the arriving one: the box is the arriving content's height from the
 * first frame, so a change of height lands in the frame the old content starts leaving, inside
 * movement that is already happening. Stacked, the box would stand at the taller of the two for the
 * length of the change and then settle to the new height — two changes, and in a column whose
 * content is centred each one drags everything on screen with it. `FollowHeight` is the component
 * for a box whose height should travel instead; a 40dp row, whose height is its own, needs neither.
 *
 * The arrival is `MENU_TRANSITION.enter`, held back by `PAGE_FADE_TIMING`'s own delay; the departure
 * is FastEffects, as every small surface leaves, so the two are never half-transparent through each
 * other: by the 80ms the arrival waits the departing copy is 4% opaque. It used to leave on a 150ms
 * standard-accelerate, which was still 59% opaque when the new content started to arrive.
 * Nothing plays on mount: a box that arrives on screen is not a box that changed what it shows —
 * which is also what keeps a development mount's double-invoked layout effect from playing an
 * entrance this component never had. Under 关闭 the change is a cut (`scaledMs` reaches 0).
 */
export default function SwapContent({
  contentKey,
  side = 'bottom',
  distance = DEFAULT_DISTANCE,
  className,
  children,
}: SwapContentProps) {
  /* What the box was showing when the key last changed; the departing element is rendered from
     this rather than from the live `children`, which by then has already been replaced. */
  const [shown, setShown] = useState({ key: contentKey, node: children });
  const [leaving, setLeaving] = useState<{ key: string; node: ReactNode } | null>(null);
  const leavingRef = useRef<HTMLDivElement>(null);
  const enteringRef = useRef<HTMLDivElement>(null);

  /* A change of content is state derived from props, so it is answered during render — React
     re-renders at once and the condition is false on that pass — rather than from an effect, which
     would paint a frame of the old content under the new key. */
  if (shown.key !== contentKey) {
    setLeaving(shown);
    setShown({ key: contentKey, node: children });
  }

  useLayoutEffect(() => {
    if (!leaving) return;
    const { enter } = MENU_TRANSITION;
    const exit = springTiming('fastEffects');
    const { arrive, depart } = offsets(side, distance);
    enteringRef.current?.animate(
      [
        { opacity: 0, transform: arrive },
        { opacity: 1, transform: 'none' },
      ],
      {
        duration: scaledMs(enter.duration),
        delay: scaledMs(PAGE_FADE_TIMING.delay * 1000),
        easing: enter.easing,
        /* `backwards`, so the arriving content holds its start state through the delay rather than
           appearing at rest and dropping back. */
        fill: 'backwards',
      },
    );
    const run = leavingRef.current?.animate(
      [
        { opacity: 1, transform: 'none' },
        { opacity: 0, transform: depart },
      ],
      { ...exit, fill: 'forwards' },
    );
    /* Only this departure clears the slot: a swap behind it has already replaced `leaving` with a
       node of its own (and the `key` below gave that one its own element, so this run is animating
       a node React has dropped). */
    if (run) run.onfinish = () => setLeaving((current) => (current === leaving ? null : current));
  }, [leaving, side, distance]);

  return (
    <div className={cn('relative', className)}>
      {leaving && (
        <div
          key={leaving.key}
          ref={leavingRef}
          aria-hidden="true"
          /* Out of the tab order and out of the pointer's way: the copy is a picture of what was
             there, and its controls are unreachable duplicates of the new content's. */
          inert
          /* Out of the flow, so the box's height is the arriving content's from the first frame;
             `top-0` rather than `inset-0` so the copy keeps its own height instead of being
             stretched to the new one's while it leaves. */
          className="pointer-events-none absolute inset-x-0 top-0 min-w-0"
        >
          {leaving.node}
        </div>
      )}
      <div ref={enteringRef} className="min-w-0">
        {children}
      </div>
    </div>
  );
}
