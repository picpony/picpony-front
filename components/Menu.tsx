'use client';

import { useCallback, useEffect, useId, useRef, useState, type ReactNode, type RefObject } from 'react';
import { cn } from '@/lib/utils';
import Popover from './Popover';

/** M3 menu item height and the container's block padding. Keep in step with the
 *  `min-h-12` / `py-2` below — `Popover` uses them to pick a side before paint. */
const ITEM_HEIGHT = 48;
const BLOCK_PADDING = 8;

export interface MenuAction {
  /** Stable key, and what `onSelect` receives. */
  value: string;
  label: ReactNode;
  icon?: ReactNode;
  disabled?: boolean;
  /** Destructive items take the error ink. */
  destructive?: boolean;
}

interface MenuProps {
  open: boolean;
  onClose: (refocus: boolean) => void;
  /** The button that opens the menu. Must carry `aria-haspopup="menu"`. */
  anchorRef: RefObject<HTMLElement | null>;
  items: MenuAction[];
  onSelect: (value: string) => void;
  'aria-label'?: string;
  className?: string;
}

/**
 * An actions menu.
 *
 * `Select` is a *listbox* — it picks a value and shows which one is current.
 * This is a *menu* — it runs a command and then closes. They are different ARIA
 * roles with different keyboard contracts, which is why one cannot be built out
 * of the other, and why the image detail's share menu was hand-rolled instead.
 *
 * That hand-rolled one is worth recording, because it is what this exists to
 * prevent: it carried `role="menu"` and `role="menuitem"` and then implemented
 * none of the contract those roles promise — no arrow keys, no Escape, no focus
 * management, and a full-screen transparent `<div>` catching outside clicks
 * instead of the `lib/overlay.ts` hooks that were already sitting there. A
 * screen-reader user was told it was a menu and then could not operate it.
 *
 * Focus moves with the arrow keys (roving `tabIndex`, so Tab leaves the menu
 * rather than walking it — that is the difference between a menu and a
 * toolbar). Enter and Space run the active item; Escape closes and returns
 * focus to the anchor; Home and End jump the ends; disabled items are skipped
 * rather than merely unclickable.
 */
export default function Menu({
  open,
  onClose,
  anchorRef,
  items,
  onSelect,
  'aria-label': ariaLabel,
  className = '',
}: MenuProps) {
  const menuId = useId();
  /* `-1` means "not chosen yet", resolved to the first runnable item at render.
     Deriving it rather than seeding it from an effect on `open` is what keeps
     this out of the cascading-render trap: `Menu` stays mounted while closed
     (it is `Popover` that unmounts), so there is no remount to reset state, and
     an effect firing on every open is a second render for something the first
     render already knows. */
  const [chosenIndex, setChosenIndex] = useState(-1);
  const itemRefs = useRef<(HTMLButtonElement | null)[]>([]);

  const firstEnabled = Math.max(0, items.findIndex((i) => !i.disabled));
  const activeIndex = chosenIndex < 0 ? firstEnabled : chosenIndex;

  /* Closing forgets the caret, so the next open starts at the top again. In the
     close handler rather than an effect, because closing is an event. */
  const handleClose = useCallback(
    (refocus: boolean) => {
      setChosenIndex(-1);
      onClose(refocus);
    },
    [onClose],
  );

  /* Focus follows the active index, which is what makes this a menu rather than
     a list with a highlight: the browser's own focus is on the item, so a
     screen reader announces it and Enter reaches it without a key handler. */
  useEffect(() => {
    if (!open) return;
    const raf = requestAnimationFrame(() => itemRefs.current[activeIndex]?.focus());
    return () => cancelAnimationFrame(raf);
  }, [open, activeIndex]);

  const step = (delta: number) => {
    setChosenIndex(() => {
      const total = items.length;
      let next = activeIndex;
      for (let i = 0; i < total; i++) {
        next = (next + delta + total) % total;
        if (!items[next].disabled) return next;
      }
      return activeIndex;
    });
  };

  const run = (item: MenuAction) => {
    if (item.disabled) return;
    onSelect(item.value);
    handleClose(true);
  };

  const onKeyDown = (event: React.KeyboardEvent) => {
    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault();
        step(1);
        break;
      case 'ArrowUp':
        event.preventDefault();
        step(-1);
        break;
      case 'Home':
        event.preventDefault();
        setChosenIndex(firstEnabled);
        break;
      case 'End': {
        event.preventDefault();
        for (let i = items.length - 1; i >= 0; i--) {
          if (!items[i].disabled) {
            setChosenIndex(i);
            break;
          }
        }
        break;
      }
      case 'Tab':
        /* Tab dismisses rather than moving through the items. A menu is a
           transient layer over the page, so the next Tab stop belongs to the
           page, not to the menu's fourth entry. */
        handleClose(false);
        break;
    }
  };

  return (
    <Popover
      open={open}
      onClose={handleClose}
      anchorRef={anchorRef}
      role="menu"
      id={menuId}
      aria-label={ariaLabel}
      estimatedHeight={items.length * ITEM_HEIGHT + BLOCK_PADDING * 2}
      /* A menu is as wide as its longest label, not as wide as the icon button
         that opened it — unlike `Select`, whose trigger states the value. */
      matchAnchorWidth={false}
      className={cn('min-w-40 py-2', className)}
    >
      {/* No wrapper element. `Popover`'s entrance fades the panel's *direct
          children* in behind the container morph, so a wrapper here would be the
          only child and the per-row cascade would collapse into one block — and
          a `display: contents` wrapper is worse still, because it generates no
          box and `opacity` therefore does not apply to it at all. The keydown
          handler lives on each row instead, which is where the event originates
          anyway: focus is always on an item. */}
      {items.map((item, index) => (
        <button
          key={item.value}
          ref={(el) => {
            itemRefs.current[index] = el;
          }}
          type="button"
          role="menuitem"
          disabled={item.disabled}
          /* Roving: exactly one item is in the tab order at a time. */
          tabIndex={index === activeIndex ? 0 : -1}
          onClick={() => run(item)}
          onKeyDown={onKeyDown}
          onPointerEnter={() => !item.disabled && setChosenIndex(index)}
          data-ripple={item.disabled ? undefined : ''}
          /* M3 menu item: 48dp minimum, 16dp inline / 4dp block padding,
             label-large, and NO corner radius — rows are full-bleed, which is
             the single biggest thing that makes a menu read as a menu rather
             than as a stack of chips. */
          className={cn(
            'flex min-h-12 w-full cursor-pointer items-center gap-3 px-4 py-1 text-left text-label-l outline-none',
            /* The *inset* ring. The panel scrolls, and `overflow-y-auto` clips a
               box-shadow — a full-bleed row's outset ring would be cut off on
               both sides and at the ends of the scroll area. Same form as the
               gallery card's, which clips for the same reason. */
            'transition-ui focus-visible:inset-ring-2 focus-visible:focus-ring-inset',
            item.disabled
              ? 'cursor-not-allowed disabled-content'
              : cn('state-layer', item.destructive ? 'text-error' : 'text-on-surface'),
          )}
        >
          {item.icon && (
            <span className="grid shrink-0 place-items-center [&>svg]:block" aria-hidden="true">
              {item.icon}
            </span>
          )}
          <span className="min-w-0 flex-1 truncate">{item.label}</span>
        </button>
      ))}
    </Popover>
  );
}
