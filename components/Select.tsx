'use client';

import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { MdCheck, MdExpandMore } from 'react-icons/md';
import Popover, { estimateMenuHeight, type PopoverHandle } from './Popover';
import { ICON } from '@/lib/icons';

export interface SelectOption<T extends string = string> {
  value: T;
  label: string;
  /** Optional secondary line shown under the label. */
  hint?: string;
  disabled?: boolean;
}

interface SelectProps<T extends string = string> {
  value: T;
  options: SelectOption<T>[];
  onChange: (value: T) => void;
  placeholder?: string;
  disabled?: boolean;
  /** Extra classes for the trigger button. */
  className?: string;
  /** Compact trigger padding/text — for dense toolbars. */
  size?: 'sm' | 'md';
  'aria-label'?: string;
}

/* The menu's height estimate comes from `estimateMenuHeight` in `Popover`, which
   owns the placement decision and therefore owns the arithmetic. This file used to
   carry its own `MENU_ITEM_HEIGHT` / `MENU_PADDING` pair and `Menu.tsx` carried an
   identical one under different names — two copies of one row's geometry, which the
   pointer-density change would have had to update in both places. */


/**
 * Listbox with an animated popover, replacing the unstylable native <select>.
 *
 * The surface, its placement and its container transform now come from
 * `Popover`; what is left here is what makes this a *listbox* rather than a
 * menu — a current value, `aria-selected` rows, a trailing check, and a
 * keyboard contract that commits a value instead of running a command.
 *
 * One presentation on every width: it opens in place, under (or over) its own
 * trigger. A phone-width bottom sheet was tried and removed — the list is short
 * and already anchored to the control you just pressed, so relocating it to the
 * bottom of the screen moved your eye away from the thing you were setting.
 * `Popover` clamps it into the viewport, which is what the sheet was really
 * there to guarantee.
 */
export default function Select<T extends string = string>({
  value,
  options,
  onChange,
  placeholder = '请选择',
  disabled,
  className = '',
  size = 'md',
  'aria-label': ariaLabel,
}: SelectProps<T>) {
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const popoverRef = useRef<PopoverHandle>(null);
  const listboxId = useId();

  const selected = options.find((o) => o.value === value);
  const selectedIndex = options.findIndex((o) => o.value === value);

  const openMenu = () => {
    if (disabled) return;
    setActiveIndex(selectedIndex >= 0 ? selectedIndex : 0);
    setOpen(true);
  };

  /* `Popover` owns the exit animation and defers its own unmount until it has
     played, so closing is just a state flip here. It used to be sixty lines of
     WAAPI plus a re-entrancy guard, duplicated in every other floating surface
     that wanted the same behaviour and therefore present in none of them. */
  const close = useCallback((refocus = true) => {
    if (refocus) triggerRef.current?.focus();
    setOpen(false);
  }, []);

  const commit = (option: SelectOption<T>) => {
    if (option.disabled) return;
    if (option.value !== value) onChange(option.value);
    close();
  };

  // Keep the active option in view during keyboard traversal.
  useEffect(() => {
    if (!open || activeIndex < 0) return;
    popoverRef.current?.element
      ?.querySelectorAll<HTMLElement>('[data-option]')
      [activeIndex]?.scrollIntoView({ block: 'nearest' });
  }, [open, activeIndex]);

  const handleKeyDown = (event: React.KeyboardEvent) => {
    const step = (delta: number) => {
      event.preventDefault();
      if (!open) {
        openMenu();
        return;
      }
      setActiveIndex((prev) => {
        const total = options.length;
        let next = prev;
        for (let i = 0; i < total; i++) {
          next = (next + delta + total) % total;
          if (!options[next].disabled) return next;
        }
        return prev;
      });
    };

    switch (event.key) {
      case 'ArrowDown':
        step(1);
        break;
      case 'ArrowUp':
        step(-1);
        break;
      case 'Home':
      case 'End':
        event.preventDefault();
        if (open) setActiveIndex(event.key === 'Home' ? 0 : options.length - 1);
        break;
      case 'Enter':
      case ' ':
        event.preventDefault();
        if (open && options[activeIndex]) commit(options[activeIndex]);
        else openMenu();
        break;
      case 'Escape':
        if (open) {
          event.preventDefault();
          close();
        }
        break;
      case 'Tab':
        if (open) close(false);
        break;
    }
  };

  /* **The trigger's step is decided by its enclosure, not by its type.** The two
     values are the field's box (56dp, `OutlinedTextFieldTokens.ContainerHeight`, the
     only height M3 gives a field, with the field's 4dp corner and `body-l` ink) and
     the small control step (40dp with `body-m`). Which one a call site takes follows
     one rule: a slot in a form column is 56, and a control in a filter bar, a
     toolbar, a card header or an `.m3-row` is 40, because there its neighbours are a
     32dp switch and a 32dp chip and matching them is what "coordinated" means.

     `md` used to be the answer everywhere by default — fourteen of the twenty call
     sites — including three settings rows where the row directly below held a 32dp
     switch, so one card ran at two pitches and the dropdown was 1.75x the height of
     the control under it. The `sm` step already existed and already shipped in
     /search's filter panel; nothing was wrong with it except that it had to be asked
     for. All three of the trigger's numbers have moved once before: 44 then 48 then
     56, 12dp then 4dp, `body-m` then `body-l`. */
  const pad = size === 'sm' ? 'h-10 px-3 text-body-m' : 'h-14 px-4 text-body-l';

  /* **A menu row is 40dp under a pointer and 48 under a finger**, which is
     `touch-size` — the row carries `data-ripple`, so `touch-target`'s pseudo-element
     would be clipped away by the `overflow: hidden` that clips the wave.
     It was a flat `min-h-12`, and the comment here argued that "a menu row is the
     same object under a thumb as under a mouse". The object is the same; the floor
     is not. 48 is M3's minimum *target*, and the menu item's own height is 40 — so
     writing 48 unconditionally imported a touch figure into the desktop layout,
     which is what made a five-option list 40px taller than it needed to be. */
  const optionRows = () =>
    options.map((option, index) => {
      const isSelected = option.value === value;
      return (
        <div
          key={option.value}
          id={`${listboxId}-${index}`}
          data-option
          data-ripple={option.disabled ? undefined : ''}
          role="option"
          aria-selected={isSelected}
          aria-disabled={option.disabled}
          onPointerEnter={() => !option.disabled && setActiveIndex(index)}
          onClick={() => commit(option)}
          /* M3 menu item, per the same reference: 16dp inline / 4dp block padding,
             label-large, and NO corner radius — rows are full-bleed, which is the
             single biggest thing that makes a menu read as a menu rather than as a
             list of chips. The height is `min-h-10 touch-size`, per the note above.

             The current value takes the `secondary-container` pair, which is
             M3's selected-list-item container and the same pair this app uses
             everywhere else it means "selected" — the sidebar's active row, a
             selected `Chip`, `IconButton`'s selected state. The note here used to
             claim the opposite, that the row was a translucent accent overlay at
             the activated opacity; the code had never done that, and a solid
             container is the correct answer, so the comment was the wrong half. */
          className={`flex min-h-10 touch-size cursor-pointer items-center gap-3 px-4 py-1 text-label-l transition-ui ${
            option.disabled
              ? 'cursor-not-allowed text-on-surface disabled-content'
              : isSelected
                ? 'bg-secondary-container text-on-secondary-container'
                : index === activeIndex
                  /* The keyboard cursor. `state-layer` paints nothing until a
                     pointer arrives, so arrowing through this list used to show
                     no cursor at all — the scroll moved and the row was
                     announced, and nothing on screen said which one it was. */
                  ? 'state-layer-active text-on-surface'
                  : 'state-layer text-on-surface'
          }`}
        >
          <span className="min-w-0 flex-1">
            <span className="block truncate">{option.label}</span>
            {option.hint && (
              <span
                className={`mt-0.5 block truncate text-body-s ${
                  isSelected ? 'text-on-secondary-container' : 'text-on-surface-variant'
                }`}
              >
                {option.hint}
              </span>
            )}
          </span>
          {/* 18dp trailing check — M3 uses a trailing element, not a colour
              change, to say which item is current. */}
          <MdCheck
            size={ICON.dense}
            aria-hidden="true"
            className={`shrink-0 transition-ui ${
              isSelected ? 'scale-100 opacity-100' : 'scale-50 opacity-0'
            }`}
          />
        </div>
      );
    });

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        role="combobox"
        aria-expanded={open}
        aria-controls={open ? listboxId : undefined}
        aria-haspopup="listbox"
        aria-label={ariaLabel}
        disabled={disabled}
        /* On the **trigger**, not on the listbox. `aria-activedescendant` names
           the current item to whichever element holds DOM focus, and focus never
           leaves this button — the listbox is a portalled panel that is never
           focused. Declared over there, it named a row to an element no screen
           reader was listening to, so arrowing through the list moved the scroll,
           painted the cursor and announced nothing. */
        aria-activedescendant={
          open && activeIndex >= 0 ? `${listboxId}-${activeIndex}` : undefined
        }
        onClick={() => (open ? close() : openMenu())}
        onKeyDown={handleKeyDown}
        className={`group inline-flex items-center justify-between gap-2 rounded-xs text-on-surface transition-ui outline-none disabled:disabled-content disabled:cursor-not-allowed focus-visible:ring-2 focus-ring bg-surface-container-highest state-layer ${pad} ${className}`}
      >
        {/* **The trigger is as wide as its widest option, not as its current one.**
            A combobox that resizes when you pick a value is the one thing a combobox
            must not do — the row it sits in re-lays-out under the pointer that just
            chose. It was `w-auto` from `sm` up, so the width tracked the selected
            label: /settings' content filter measured 150px on 完全安全 (Safe) and grew
            on 中等限制 (Spoilers), while the sort dropdowns beside it looked fine only
            because their four options are all four Han characters wide.

            A grid cell with every label stacked in it, all but one `invisible`, is what
            makes the box the max of them. No measurement, no ResizeObserver, no
            hand-typed `min-w`: the browser's own intrinsic sizing does it, and it stays
            true when the options change. The ghosts are `aria-hidden` and take no
            layout row of their own because every child is in cell 1/1.

            `truncate` still applies, so a genuinely long option is capped by whatever
            width the call site allows rather than pushing the row out. */}
        <span className="grid min-w-0 flex-1 text-left">
          {options.map((o) => (
            <span
              key={o.value}
              aria-hidden="true"
              className="col-start-1 row-start-1 invisible truncate"
            >
              {o.label}
            </span>
          ))}
          {/* `on-surface-variant`, not `outline`. A placeholder is text, and
              `outline` is a boundary role specified to the 3:1 that a *non-text*
              element needs — measured against this app's light surface it lands
              at 4.3:1, under the 4.5:1 AA asks of body text. It passes in the
              dark scheme (5.8:1), which is why it survived this long. */}
          <span
            className={`col-start-1 row-start-1 truncate ${selected ? '' : 'text-on-surface-variant'}`}
          >
            {selected?.label ?? placeholder}
          </span>
        </span>
        {/* `on-surface-variant`, which is `FilledTextFieldTokens.TrailingIconColor`.
            It was `text-outline` going `text-primary` when open — `outline` is the
            boundary role the placeholder two lines up rejects for itself, and the
            `primary` swap was the third thing this trigger changed on expand. */}
        <MdExpandMore
          size={ICON.control}
          className={`shrink-0 text-on-surface-variant transition-ui ${open ? 'rotate-180' : ''}`}
        />
      </button>

      {/* M3 menu container, from `Popover`: 8dp corner (`small`, which the
          shape scale specifies for "text fields, menus"), elevation 2 (which it
          specifies for "menus, nav bar"), no outline. This used to spell out a
          4dp corner with a comment arguing for it against the emoji picker's
          comment arguing the opposite — see the note in `Popover`. What stays
          here is the 8dp block padding with NONE on the inline axis, so rows
          run edge to edge. */}
      <Popover
        open={open}
        onClose={close}
        anchorRef={triggerRef}
        handleRef={popoverRef}
        id={listboxId}
        role="listbox"
        estimatedHeight={estimateMenuHeight(options.length)}
        className="py-2"
      >
        {optionRows()}
      </Popover>
    </>
  );
}
