'use client';

import { useLayoutEffect, useRef, useState } from 'react';
import { MdShoppingCart } from 'react-icons/md';
import Button from '@/components/Button';
import { CountBadge } from '@/components/Badge';
import { getAppScroller } from '@/lib/appScroller';
import { motionTier, useMotionTier } from '@/lib/appearance';
import { ICON } from '@/lib/icons';
import { springTiming } from '@/lib/springTiming';
import { cn } from '@/lib/utils';

/**
 * What the cart holds, floating at the bottom of a narrow column, and the way into it (the
 * docked panel takes its place from `@4xl`). The same object as the favourites' `SelectionBar`,
 * and built the same way (M1-014):
 *
 * - **Always mounted**, `inert` while hidden, so its exit can play and nothing hidden takes focus.
 *   It rises into place on the default spatial spring and fades on the effects one; leaving, both
 *   run on the effects spring, so nothing overshoots on the way out — 8px of travel under 减弱, as
 *   every travel there is, and a cut under 关闭.
 * - **While it leaves it shows what it showed**: after a checkout the total does not drop to 0 and
 *   the badge does not vanish under the fade.
 * - **Its room never reflows the page.** It floats in a zero-height sticky slot right after the
 *   list, hanging below it; the 80px under the list's last row (its 56dp plus the 24dp gap it
 *   always had) is a spacer of its own after the slot, held from the bar's last appearance until a
 *   scroll leaves it below the viewport — taken away with the bar it shortened the page under a
 *   reader at its end and the offset clamped (M1-004's drop). It opens on the effects spring: at
 *   the page end the footer glides down under the arriving bar instead of dropping 80px in the
 *   frame the bar appeared, and since the bar hangs from the slot rather than sitting on the room,
 *   the room growing carries nothing with it.
 * - **One width**, the column's up to `max-w-sm`, so a total that gains a digit never re-forms or
 *   re-centres it; the money is exact (`formatExactCount`) and is never the part that gives way —
 *   below a 22rem column the button says 查看 and names the cart in its label.
 * - **The badge arrives with the bar**: a fresh `CountBadge` each time the bar comes back, so its
 *   pop (a count arriving on screen) never runs on top of the bar's own rise.
 */
export default function CartBar({
  active,
  pieces,
  summary,
  label,
  onOpen,
  onWarm,
}: {
  active: boolean;
  /** Pieces the cart shows — its badge. */
  pieces: number;
  /** The line beside the badge: the total, or the pieces while the shop's answer is on its way. */
  summary: string;
  /** The button's whole name — 查看购物车，2 件商品. */
  label: string;
  onOpen: () => void;
  /** Fetch the sheet's chunk on intent. */
  onWarm: () => void;
}) {
  const tier = useMotionTier();
  const roomRef = useRef<HTMLDivElement>(null);

  /* What the bar shows: the live cart while it is up, the last of it while it leaves. */
  const [held, setHeld] = useState({ pieces, summary, label });
  if (active && (held.pieces !== pieces || held.summary !== summary || held.label !== label)) {
    setHeld({ pieces, summary, label });
  }
  const shown = active ? { pieces, summary, label } : held;

  /* Each appearance mounts its own badge; the room outlives the bar until it is out of sight. */
  const [appearance, setAppearance] = useState(0);
  const [roomHeld, setRoomHeld] = useState(false);
  const [openedFor, setOpenedFor] = useState(active);
  if (openedFor !== active) {
    setOpenedFor(active);
    if (active) setAppearance((count) => count + 1);
    else setRoomHeld(true);
  }
  const room = active || roomHeld;

  /* The room opening as the bar arrives (not when the screen mounts with a cart already held). */
  const roomWas = useRef(room);
  useLayoutEffect(() => {
    const opened = room && !roomWas.current;
    roomWas.current = room;
    const spacer = roomRef.current;
    if (!opened || !spacer || motionTier() === 'off') return;
    const height = spacer.getBoundingClientRect().height;
    /* No box at all in the docked layout. */
    if (height === 0) return;
    spacer.animate([{ height: '0px' }, { height: `${height}px` }], springTiming('defaultEffects'));
  }, [room]);

  useLayoutEffect(() => {
    const spacer = roomRef.current;
    if (active || !roomHeld) return;
    const scroller = spacer?.closest<HTMLElement>('[data-app-scroll-container]') ?? getAppScroller();
    /* Below the viewport (or with no box at all — the docked layout hides it), the room can go:
       the page under the reader does not change, and nothing clamps the offset. */
    const free = () => {
      if (!spacer || !scroller) return true;
      const box = spacer.getBoundingClientRect();
      return box.height === 0 || box.top >= scroller.getBoundingClientRect().bottom;
    };
    if (free()) {
      setRoomHeld(false);
      return;
    }
    let frame = 0;
    const onScroll = () => {
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        if (free()) setRoomHeld(false);
      });
    };
    scroller?.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      scroller?.removeEventListener('scroll', onScroll);
      if (frame) cancelAnimationFrame(frame);
    };
  }, [active, roomHeld]);

  return (
    <>
      {/* `z-page-chrome`, the step the selection bar and the home pill take: a page's own floating
          chrome (G3-026). Sticky 80px higher than the bar's bottom edge, since the bar hangs 24px
          below it: floating, the bar's bottom is 16px above the viewport's; at the page end it
          rests in its room. */}
      <div className="pointer-events-none sticky bottom-[calc(max(1rem,env(safe-area-inset-bottom))+5rem)] z-page-chrome h-0 @4xl/shop:hidden">
        <div className="absolute inset-x-0 top-6 flex justify-center px-2">
          {/* The fade: one opacity, on the effects spring both ways. */}
          <div
            inert={!active}
            className={cn(
              'w-full max-w-sm transition-opacity spring-fast-effects',
              active ? 'pointer-events-auto opacity-100' : 'opacity-0',
            )}
          >
            {/* The travel: up into place on the spatial spring, back down on the effects one. */}
            <div
              className={cn(
                'flex h-14 items-center gap-3 rounded-full bg-surface-container-high py-2 pr-2 pl-5 text-on-surface shadow-e2 forced-boundary',
                'transition-[translate]',
                active
                  ? 'translate-y-0 spring-default-spatial'
                  : cn(tier === 'reduced' ? 'translate-y-2' : 'translate-y-4', 'spring-fast-effects'),
              )}
            >
              <span className="relative inline-flex shrink-0 text-on-surface-variant" aria-hidden="true">
                <MdShoppingCart size={ICON.standard} />
                <CountBadge key={appearance} count={shown.pieces} className="absolute -top-1.5 -right-2.5" />
              </span>
              <span className="min-w-0 flex-1 truncate text-body-m whitespace-nowrap text-on-surface tabular-nums">
                {shown.summary}
              </span>
              <Button
                variant="filled"
                aria-label={shown.label}
                onPointerEnter={onWarm}
                onPointerDown={onWarm}
                onFocus={onWarm}
                onClick={onOpen}
              >
                查看<span className="@max-[22rem]/shop:hidden">购物车</span>
              </Button>
            </div>
          </div>
        </div>
      </div>
      {room && <div ref={roomRef} className="h-20 shrink-0 @4xl/shop:hidden" aria-hidden="true" />}
    </>
  );
}
