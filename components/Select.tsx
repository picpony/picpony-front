'use client';

import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { MdCheck, MdExpandMore } from 'react-icons/md';
import Popover, { type PopoverHandle } from './Popover';

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

/** M3 menu item height, and the container's block padding. Keep in step with
 *  the `min-h-12` / `py-2` on the elements below — `Popover` uses them to pick
 *  a side before the menu has been laid out. */
const MENU_ITEM_HEIGHT = 48;
const MENU_PADDING = 8;

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

  /* The trigger is a form control and sits in the same rows as one — an admin
     filter bar is a search field, then two of these. So it takes the text
     field's box: 12dp corner, 44px tall at `md`. It was 8dp and about 39px,
     which put a different corner and a 5px step next to every field it stood
     beside. `sm` stays denser for a toolbar that has no field in it. */
  const pad = size === 'sm' ? 'h-9 px-3 text-body-s' : 'h-11 px-4 text-body-m';

  /* Rows are taller below `sm`: 36px is fine under a mouse and too small a
     target under a thumb. Handled with a breakpoint rather than a second
     component so there is only ever one list to keep in step. */
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
          /* M3 menu item, per the same reference: 48dp minimum, 16dp inline /
             4dp block padding, label-large, and NO corner radius — rows are
             full-bleed, which is the single biggest thing that makes a menu
             read as a menu rather than as a list of chips.

             Selection is a translucent overlay of the accent at the M3
             "activated" opacity, not a solid container fill. A filled row was
             my own invention and it shouted; the reference tints. */
          className={`flex min-h-12 cursor-pointer items-center gap-3 px-4 py-1 text-label-l transition-ui ${
            option.disabled
              ? 'cursor-not-allowed text-on-surface disabled-content'
              : isSelected
                ? 'bg-secondary-container text-on-secondary-container'
                : index === activeIndex
                  ? 'state-layer text-on-surface'
                  : 'text-on-surface'
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
            size={18}
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
        onClick={() => (open ? close() : openMenu())}
        onKeyDown={handleKeyDown}
        className={`group inline-flex items-center justify-between gap-2 rounded-md text-on-surface transition-ui outline-none disabled:disabled-content disabled:cursor-not-allowed focus-visible:ring-2 focus-ring ${pad} ${
          open
            ? 'bg-primary-container text-on-primary-container'
            : 'bg-surface-container-high state-layer hover:text-primary'
        } ${className}`}
      >
        {/* `on-surface-variant`, not `outline`. A placeholder is text, and
            `outline` is a boundary role specified to the 3:1 that a *non-text*
            element needs — measured against this app's light surface it lands
            at 4.3:1, under the 4.5:1 AA asks of body text. It passes in the
            dark scheme (5.8:1), which is why it survived this long. The chevron
            beside it keeps `outline`: a glyph only has to clear 3:1. */}
        <span className={`truncate ${selected ? '' : 'text-on-surface-variant'}`}>
          {selected?.label ?? placeholder}
        </span>
        <MdExpandMore
          size={size === 'sm' ? 16 : 18}
          className={`shrink-0 text-outline transition-transform duration-300 ease-[var(--ease-standard)] ${open ? 'rotate-180 text-primary' : ''}`}
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
        aria-activedescendant={activeIndex >= 0 ? `${listboxId}-${activeIndex}` : undefined}
        estimatedHeight={options.length * MENU_ITEM_HEIGHT + MENU_PADDING * 2}
        className="py-2"
      >
        {optionRows()}
      </Popover>
    </>
  );
}
