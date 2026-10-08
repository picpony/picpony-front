'use client';

import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { MdClose, MdMoreVert } from 'react-icons/md';
import Button from '@/components/Button';
import IconButton from '@/components/IconButton';
import Menu from '@/components/Menu';
import { getAppScroller } from '@/lib/appScroller';
import { cn } from '@/lib/utils';

export interface SelectionCommand {
  /** Stable key. */
  value: string;
  /** The command's whole name — 移动到…, 移出收藏夹 — the label, the tooltip and the menu row. */
  label: string;
  icon: ReactNode;
  onSelect: () => void;
  disabled?: boolean;
  destructive?: boolean;
}

/* What a command costs in each form, in px — the button anatomy's own numbers: a 40dp icon
   button; a text button's 12dp sides, 20dp glyph, 8dp gap and the label at 14px a character. */
const ICON_WIDTH = 40;
const LABELLED_BASE = 12 + 20 + 8 + 12;
const CHARACTER = 14;
/* The bar's own: its 8dp inset either side, the dismiss control, the count and the 4dp gaps. */
const CHROME = 16 + ICON_WIDTH + 8;
const GAP = 4;

type Fit = { form: 'labelled' } | { form: 'icons' } | { form: 'compact'; shown: number };

function countWidth(text: string): number {
  return Array.from(text).length * CHARACTER + 16;
}

/**
 * The count at its widest — three digits, as many as a selection of pages of fifty reaches. The
 * bar's form and its width are decided by this rather than by the count on screen, so neither
 * changes as the count grows: at 390 a tenth picture used to send 复制到… into 更多 and re-form
 * the bar in a frame (M1-005). The digits are tabular, so any three are the widest three.
 */
const widestCount = (unit: string) => `已选择 888 ${unit}`;

/** The roomiest form the commands fit in at this width. */
function fitFor(width: number, commands: readonly SelectionCommand[], countText: string): Fit {
  const room = width - CHROME - countWidth(countText);
  const labelled = commands.reduce((sum, command) => sum + LABELLED_BASE + Array.from(command.label).length * CHARACTER + GAP, 0);
  if (room >= labelled) return { form: 'labelled' };
  if (room >= commands.length * (ICON_WIDTH + GAP)) return { form: 'icons' };
  /* As many as fit beside the 更多 control, which holds the rest. */
  return { form: 'compact', shown: Math.max(0, Math.floor(room / (ICON_WIDTH + GAP)) - 1) };
}

/**
 * The selection mode's contextual bar — the count, the commands and the way out — floating at the
 * bottom of the page column (`useSelectionMode`, `MasonryGrid`'s `selection`).
 *
 * - **Where**: a zero-height sticky slot at the end of the screen, so the bar rides the bottom of
 *   the view while the screen is on it and is centred over the column, never the window (the
 *   drawer is beside it). The screen leaves room under its last row while the mode is on.
 * - **What**: every command at once, labelled, where they fit; their glyphs alone (each names
 *   itself in its tooltip) where they do not; and on a phone the first few with the rest under
 *   更多. Measured from the slot's own width, so the drawer's state counts too.
 * - **Motion**: it rises into place on the default spatial spring and fades on the effects one;
 *   leaving, both run on the effects spring, so nothing overshoots on the way out. It stays
 *   mounted, `inert` while hidden, so the exit can play and nothing hidden takes focus. While it
 *   leaves it shows what it showed — the count and the commands as they were, never 已选择 0 张
 *   or a 全选 that came back the moment the selection cleared (M1-004).
 * - **The room under the last row** outlives the mode until it is out of sight. Taken away with
 *   the mode, it shortened the page under a reader at its end, the offset clamped and the page
 *   dropped 80px in a frame (M1-004); it goes on the first scroll that leaves it below the
 *   viewport, where taking it away moves nothing on screen.
 * - **Focus**: a mode entered from a control that then went away (the header's 选择) puts focus on
 *   the bar's ✕; the mode's own hook hands it back when the mode ends.
 */
export default function SelectionBar({
  active,
  count,
  unit,
  commands,
  onExit,
  label,
}: {
  active: boolean;
  count: number;
  /** 张, 个 — what is counted. */
  unit: string;
  commands: readonly SelectionCommand[];
  onExit: () => void;
  /** The toolbar's accessible name — 图片多选, 收藏夹多选. */
  label: string;
}) {
  const slotRef = useRef<HTMLDivElement>(null);
  const roomRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const moreRef = useRef<HTMLButtonElement>(null);
  const [width, setWidth] = useState(0);
  const [menuOpen, setMenuOpen] = useState(false);

  /* What the bar shows: the live count and commands while the mode is on, the last of them while
     it leaves. */
  const [held, setHeld] = useState({ count, commands });
  if (active && (held.count !== count || held.commands !== commands)) setHeld({ count, commands });
  const shown = active ? { count, commands } : held;
  const countText = `已选择 ${shown.count} ${unit}`;

  /* The room: kept from the mode's end until removing it changes nothing on screen. */
  const [roomHeld, setRoomHeld] = useState(false);
  const room = active || roomHeld;

  useLayoutEffect(() => {
    const slot = slotRef.current;
    if (!slot) return;
    setWidth(slot.getBoundingClientRect().width);
    const observer = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width));
    observer.observe(slot);
    return () => observer.disconnect();
  }, []);

  /* Entered from a control that the mode then took away: focus has fallen to the page. */
  useEffect(() => {
    if (!active) return;
    const focused = document.activeElement;
    if (!focused || focused === document.body || !focused.isConnected || focused.closest('[inert]')) {
      closeRef.current?.focus({ preventScroll: true });
    }
  }, [active]);

  const [openedFor, setOpenedFor] = useState(active);
  if (openedFor !== active) {
    setOpenedFor(active);
    if (!active) {
      setMenuOpen(false);
      setRoomHeld(true);
    }
  }

  useLayoutEffect(() => {
    const spacer = roomRef.current;
    if (active || !roomHeld) return;
    const scroller = spacer?.closest<HTMLElement>('[data-app-scroll-container]') ?? getAppScroller();
    /* Below the viewport (or with no box at all, in a pane out of sight), the room can go: the
       page under the reader does not change, and nothing clamps the offset. */
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

  const fit = width > 0 ? fitFor(width, shown.commands, widestCount(unit)) : { form: 'icons' as const };
  const inline = fit.form === 'compact' ? shown.commands.slice(0, fit.shown) : shown.commands;
  const overflow = fit.form === 'compact' ? shown.commands.slice(fit.shown) : [];

  return (
    <>
    {room && <div ref={roomRef} className="h-20 shrink-0" aria-hidden="true" />}
    {/* `z-page-chrome`: the page's own floating chrome, as the home pill is — a stated step of the
        app's order rather than a number that agrees with the shop's bar by luck (G3-026). */}
    <div ref={slotRef} className="pointer-events-none sticky bottom-[max(1rem,env(safe-area-inset-bottom))] z-page-chrome h-0">
      <div className="absolute inset-x-0 bottom-0 flex justify-center px-2">
        {/* The fade: one opacity, on the effects spring both ways. */}
        <div
          role="toolbar"
          aria-label={label}
          inert={!active}
          className={cn(
            'max-w-full transition-opacity spring-fast-effects',
            active ? 'pointer-events-auto opacity-100' : 'opacity-0',
          )}
        >
          {/* The travel: up into place on the spatial spring, back down on the effects one. */}
          <div
            data-selection-travel=""
            data-hidden={active ? undefined : ''}
            className={cn(
              'flex h-14 max-w-full items-center gap-1 rounded-full bg-surface-container-high px-2 text-on-surface shadow-e2 forced-boundary',
              'transition-[translate]',
              active ? 'translate-y-0 spring-default-spatial' : 'translate-y-4 spring-fast-effects',
            )}
          >
            <IconButton ref={closeRef} dismiss icon={<MdClose />} aria-label="退出选择" onClick={onExit} />
            {/* As wide as its widest count (the `Select` technique): the live text and an
                invisible three-digit one share one cell, so the bar never re-forms or re-centres
                as the count grows. */}
            <span className="grid shrink-0 px-2 text-label-l whitespace-nowrap tabular-nums">
              <span aria-hidden="true" className="invisible col-start-1 row-start-1">
                {widestCount(unit)}
              </span>
              <span aria-live="polite" className="col-start-1 row-start-1">
                {countText}
              </span>
            </span>
            {inline.map((command) =>
              fit.form === 'labelled' ? (
                <Button
                  key={command.value}
                  variant={command.destructive ? 'danger-text' : 'text'}
                  icon={command.icon}
                  disabled={command.disabled}
                  onClick={command.onSelect}
                  className="whitespace-nowrap"
                >
                  {command.label}
                </Button>
              ) : (
                <IconButton
                  key={command.value}
                  variant={command.destructive ? 'danger-text' : 'standard'}
                  icon={command.icon}
                  aria-label={command.label}
                  disabled={command.disabled}
                  onClick={command.onSelect}
                />
              ),
            )}
            {overflow.length > 0 && (
              <>
                <IconButton
                  ref={moreRef}
                  icon={<MdMoreVert />}
                  aria-label="更多操作"
                  aria-haspopup="menu"
                  aria-expanded={menuOpen}
                  onClick={() => setMenuOpen((open) => !open)}
                />
                <Menu
                  open={menuOpen}
                  onClose={() => setMenuOpen(false)}
                  anchorRef={moreRef}
                  aria-label="更多操作"
                  items={overflow.map((command) => ({
                    value: command.value,
                    label: command.label,
                    icon: command.icon,
                    disabled: command.disabled,
                    destructive: command.destructive,
                  }))}
                  onSelect={(value) => overflow.find((command) => command.value === value)?.onSelect()}
                />
              </>
            )}
          </div>
        </div>
      </div>
    </div>
    </>
  );
}
