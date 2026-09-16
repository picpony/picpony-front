'use client';

import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { MdExpandMore } from 'react-icons/md';
import CheckGlyph from './CheckGlyph';
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
   owns the placement decision and therefore owns the arithmetic. */


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
  const firstEnabled = options.findIndex((option) => !option.disabled);
  const cursorIndex = options[activeIndex] && !options[activeIndex].disabled ? activeIndex : firstEnabled;

  // A route-policy update can disable a setting while its menu is open. Close
  // declaratively after commit; commit() also checks disabled for the tiny gap.
  useEffect(() => {
    if (disabled && open) queueMicrotask(() => setOpen(false));
  }, [disabled, open]);

  const openMenu = () => {
    if (disabled) return;
    setActiveIndex(selectedIndex >= 0 && !options[selectedIndex].disabled ? selectedIndex : firstEnabled);
    setOpen(true);
  };

  /* `Popover` owns the exit animation and defers its own unmount until it has
     played, so closing is just a state flip here. */
  const close = useCallback((refocus = true) => {
    if (refocus) triggerRef.current?.focus();
    setOpen(false);
  }, []);

  const commit = (option: SelectOption<T>) => {
    if (disabled || option.disabled) return;
    if (option.value !== value) onChange(option.value);
    close();
  };

  // Keep the active option in view during keyboard traversal.
  useEffect(() => {
    if (!open || cursorIndex < 0) return;
    popoverRef.current?.element
      ?.querySelectorAll<HTMLElement>('[data-option]')
      [cursorIndex]?.scrollIntoView({ block: 'nearest' });
  }, [open, cursorIndex]);

  const handleKeyDown = (event: React.KeyboardEvent) => {
    const step = (delta: number) => {
      event.preventDefault();
      if (!open) {
        openMenu();
        return;
      }
      setActiveIndex(() => {
        const total = options.length;
        let next = cursorIndex;
        for (let i = 0; i < total; i++) {
          next = (next + delta + total) % total;
          if (!options[next].disabled) return next;
        }
        return cursorIndex;
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
        if (open) setActiveIndex(event.key === 'Home'
          ? firstEnabled
          : options.findLastIndex((option) => !option.disabled));
        break;
      case 'Enter':
      case ' ':
        event.preventDefault();
        if (open && options[cursorIndex]) commit(options[cursorIndex]);
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
     values are the field's box (56dp with the field's 4dp corner and `body-l`
     ink — a form slot) and the small control step (40dp, `body-m` — a filter
     bar, toolbar, card header or `.m3-row`, where the neighbours are a 32dp
     switch and a 32dp chip and matching them is what "coordinated" means). */
  const pad = size === 'sm' ? 'h-10 px-3 text-body-m' : 'h-14 px-4 text-body-l';

  /* **A menu row is 40dp under a pointer and 48 under a finger**, which is
     `touch-size` — the row carries `data-ripple`, so `touch-target`'s
     pseudo-element would be clipped away. 48 is M3's minimum *target*; the
     item's own height is 40, so writing 48 unconditionally imports a touch
     figure into the desktop layout. */
  const optionRows = () =>
    options.map((option, index) => {
      const isSelected = option.value === value;
      return (
        <div
          key={option.value}
          id={`${listboxId}-${index}`}
          data-option
          data-ripple=""
          role="option"
          aria-selected={isSelected}
          aria-disabled={option.disabled}
          onPointerEnter={() => !option.disabled && setActiveIndex(index)}
          onClick={() => commit(option)}
          /* M3 menu item: 16dp inline / 4dp block padding, label-large, and NO
             corner radius — rows are full-bleed. The current value takes the
             `secondary-container` pair, the app's "selected" pair everywhere.
             The keyboard cursor is `state-layer-active`: `state-layer` paints
             nothing until a pointer arrives, so arrowing through the list used
             to show no cursor at all. */
          className={`flex min-h-10 touch-size cursor-pointer items-center gap-3 px-4 py-1 text-label-l transition-ui ${
            option.disabled
              ? 'cursor-not-allowed text-on-surface disabled-content'
              : isSelected
                ? 'bg-secondary-container text-on-secondary-container'
                : index === cursorIndex
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
          <CheckGlyph
            className={`size-4.5 shrink-0 transition-ui ${
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
        data-ripple=""
        /* On the **trigger**, not on the listbox. `aria-activedescendant` names
           the current item to whichever element holds DOM focus, and focus never
           leaves this button — the listbox is a portalled panel that is never
           focused. Declared over there, it named a row to an element no screen
           reader was listening to, so arrowing through the list moved the scroll,
           painted the cursor and announced nothing. */
        aria-activedescendant={
          open && cursorIndex >= 0 ? `${listboxId}-${cursorIndex}` : undefined
        }
        onClick={() => (open ? close() : openMenu())}
        onKeyDown={handleKeyDown}
        className={`group inline-flex items-center justify-between gap-2 rounded-xs text-on-surface transition-ui outline-none disabled:disabled-content disabled:cursor-not-allowed focus-visible:ring-2 focus-ring bg-surface-container-highest state-layer ${pad} ${className}`}
      >
        {/* **The trigger is as wide as its widest option, not as its current one.**
            A combobox that resizes when you pick a value re-lays-out the row it
            sits in under the pointer that just chose. A grid cell with every
            label stacked in it, all but one `invisible`, is what makes the box
            the max of them — no measurement, no hand-typed `min-w`, and it stays
            true when the options change. `truncate` still caps it. */}
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
              `outline` is a boundary role specified to the 3:1 a *non-text*
              element needs — under the 4.5:1 AA bar for body text on this app's
              light surface. */}
          <span
            className={`col-start-1 row-start-1 truncate ${selected ? '' : 'text-on-surface-variant'}`}
          >
            {selected?.label ?? placeholder}
          </span>
        </span>
        {/* `on-surface-variant`, which is `FilledTextFieldTokens.TrailingIconColor`. */}
        <MdExpandMore
          size={ICON.control}
          className={`shrink-0 text-on-surface-variant spring-fast-spatial transition-[rotate] ${open ? 'rotate-180' : ''}`}
        />
      </button>

      {/* M3 menu container, from `Popover` (which owns corner, tone and
          elevation — see its note). What stays here is the 8dp block padding
          with NONE on the inline axis, so rows run edge to edge. */}
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
