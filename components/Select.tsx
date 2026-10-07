'use client';

import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { MdExpandMore } from 'react-icons/md';
import CheckGlyph from './CheckGlyph';
import Popover, { estimateMenuHeight, type PopoverHandle } from './Popover';
import { ICON } from '@/lib/icons';
import { cn } from '@/lib/utils';

export interface SelectOption<T extends string = string> {
  value: T;
  label: string;
  disabled?: boolean;
}

interface SelectProps<T extends string = string> {
  value: T;
  options: SelectOption<T>[];
  onChange: (value: T) => void;
  placeholder?: string;
  disabled?: boolean;
  /**
   * Extra classes for the control's outer box: the trigger button, or — with a
   * `label` — the field around it.
   */
  className?: string;
  /** Compact trigger padding/text — for dense toolbars. Ignored with a `label`. */
  size?: 'sm' | 'md';
  /** Toolbar choices share the pill silhouette of their neighbouring actions. Ignored with a `label`. */
  shape?: 'field' | 'pill';
  /**
   * A visible label, which makes this a **form slot**: M3's exposed dropdown menu in
   * its outlined form — the same outlined field, notch and floating label `Input` draws
   * for a label, at the form's 56dp, so a form's dropdowns and text fields are one
   * object rather than a filled box under a caption beside an outlined field. The label
   * names the control; `aria-label` is then unnecessary.
   */
  label?: string;
  'aria-label'?: string;
}

/* The menu's height estimate comes from `estimateMenuHeight` in `Popover`, which
   owns the placement decision and therefore owns the arithmetic. */

/**
 * Listbox with an animated popover, replacing the unstylable native <select>.
 *
 * The surface, its placement and its entrance now come from
 * `Popover`; what is left here is what makes this a *listbox* rather than a
 * menu — a current value, `aria-selected` rows, a trailing check, and a
 * keyboard contract that commits a value instead of running a command.
 *
 * Two shapes, and the label decides which — the same rule as `Input`. **Unlabelled**,
 * it is a filled trigger for a toolbar or a settings row (`size`, `shape`). **Labelled**,
 * it is a form slot (see `label`).
 *
 * One presentation on every width: it opens in place, under (or over) its own
 * trigger. A phone-width bottom sheet was tried and removed — the list is short
 * and already anchored to the control you just pressed, so relocating it to the
 * bottom of the screen moved your eye away from the thing you were setting.
 * `Popover` clamps it into the viewport, which is what the sheet was really
 * there to guarantee, and closes it once its trigger scrolls away.
 */
export default function Select<T extends string = string>({
  value,
  options,
  onChange,
  placeholder = '请选择',
  disabled,
  className = '',
  size = 'md',
  shape = 'field',
  label,
  'aria-label': ariaLabel,
}: SelectProps<T>) {
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const popoverRef = useRef<PopoverHandle>(null);
  const listboxId = useId();
  const triggerId = useId();
  const labelId = useId();
  const labelled = Boolean(label);

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

  // The portal mounts after `open` commits. Wait for its row, then scroll only
  // the list using layout offsets, which stay stable during the scale entrance.
  useEffect(() => {
    if (!open || cursorIndex < 0) return;
    const frame = requestAnimationFrame(() => {
      const panel = popoverRef.current?.element;
      const option = panel?.querySelectorAll<HTMLElement>('[data-option]')[cursorIndex];
      if (!panel || !option) return;
      const style = getComputedStyle(panel);
      const start = parseFloat(style.paddingTop);
      const end = parseFloat(style.paddingBottom);
      const top = option.offsetTop;
      const bottom = top + option.offsetHeight;
      if (top < panel.scrollTop + start) panel.scrollTop = top - start;
      else if (bottom > panel.scrollTop + panel.clientHeight - end) {
        panel.scrollTop = bottom - panel.clientHeight + end;
      }
    });
    return () => cancelAnimationFrame(frame);
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

  /* The enclosure chooses the height and type: 56dp with body-l in a form,
     or 40dp with label-l beside toolbar commands. Both use a 16dp text inset.
     The default field shape is 8dp, matching filled Input; toolbar choices can
     take the pill shape of their neighbouring buttons. */
  const pad = size === 'sm' ? 'h-10 px-4 text-label-l' : 'h-14 px-4 text-body-l';

  /* A row is 40dp under a fine pointer and 48dp under a finger. Express the
     two sizes on the pointer axis: two base min-height utilities would leave
     Tailwind's emission order to decide whether the touch floor applies. */
  const optionRows = () =>
    options.map((option, index) => {
      const isSelected = option.value === value;
      const isCursor = index === cursorIndex;
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
          /* Rows sit 8dp inside the panel's 16dp corner, with an 8dp corner of
             their own. The two 8dp insets align text with the trigger's 16dp. The
             value takes the `secondary-container` pair, the app's "selected" pair
             everywhere — and still answers the pointer and the keyboard like every
             other row: the state layer composes over the container, and the
             keyboard cursor (`state-layer-active`) marks it when the cursor is on
             it, which is where every open starts. It used to take neither, so the
             row the cursor opened on showed no cursor and no hover. */
          className={cn(
            'flex min-h-10 pointer-coarse:min-h-12 items-center gap-2 rounded-sm px-2 py-1 text-label-l spring-fast-effects transition-[color,background-color,opacity]',
            option.disabled
              ? 'cursor-not-allowed text-on-surface disabled-content'
              : cn(
                  'cursor-pointer',
                  isSelected ? 'bg-secondary-container text-on-secondary-container' : 'text-on-surface',
                  /* The keyboard cursor. `state-layer` paints nothing until a pointer
                     arrives, so arrowing through this list used to show no cursor at
                     all — the scroll moved and the row was announced, and nothing on
                     screen said which one it was. */
                  isCursor ? 'state-layer-active' : 'state-layer',
                ),
          )}
        >
          <span className="min-w-0 flex-1 truncate">{option.label}</span>
          {/* Same 20dp trailing slot as the trigger's arrow, so equal-width
              fields and lists leave the same amount of room for their labels. */}
          <span className="grid size-5 shrink-0 place-items-center" aria-hidden="true">
            <CheckGlyph
              weight="light"
              className={`size-4 spring-fast-effects transition-opacity ${isSelected ? 'opacity-100' : 'opacity-0'}`}
            />
          </span>
        </div>
      );
    });

  /* **The trigger is as wide as its widest option, not as its current one.**
     A combobox that resizes when you pick a value re-lays-out the row it
     sits in under the pointer that just chose. A grid cell with every
     label stacked in it, all but one `invisible`, is what makes the box
     the max of them — no measurement, no hand-typed `min-w`, and it stays
     true when the options change. `truncate` still caps it. */
  const valueCell = (
    <span className="grid min-w-0 flex-1 text-left">
      {options.map((o) => (
        <span
          key={o.value}
          aria-hidden="true"
          className="col-start-1 row-start-1 invisible truncate pr-2"
        >
          {o.label}
        </span>
      ))}
      {/* `on-surface-variant`, not `outline`. A placeholder is text, and
          `outline` is a boundary role specified to the 3:1 a *non-text*
          element needs — under the 4.5:1 AA bar for body text on this app's
          light surface. Labelled, the placeholder waits (like an input's)
          until the label has floated out of its way. */}
      <span
        data-field-placeholder={selected ? undefined : ''}
        className={cn('col-start-1 row-start-1 truncate', !selected && 'text-on-surface-variant')}
      >
        {selected?.label ?? placeholder}
      </span>
    </span>
  );

  /* The arrow follows the panel's shared menu clocks: the app's 200ms
     enter and 150ms exit, scaled by the preference. Vuetify supplies the
     anchored arrangement, not those duration values. */
  const arrow = (
    <MdExpandMore
      size={labelled ? ICON.standard : ICON.control}
      aria-hidden="true"
      className={`shrink-0 text-on-surface-variant transition-[rotate] ${open ? 'menu-enter rotate-180' : 'menu-exit rotate-0'}`}
    />
  );

  const comboboxProps = {
    ref: triggerRef,
    type: 'button' as const,
    role: 'combobox',
    'aria-expanded': open,
    'aria-controls': open ? listboxId : undefined,
    'aria-haspopup': 'listbox' as const,
    disabled,
    /* On the **trigger**, not on the listbox. `aria-activedescendant` names
       the current item to whichever element holds DOM focus, and focus never
       leaves this button — the listbox is a portalled panel that is never
       focused. Declared over there, it named a row to an element no screen
       reader was listening to, so arrowing through the list moved the scroll,
       painted the cursor and announced nothing. */
    'aria-activedescendant': open && cursorIndex >= 0 ? `${listboxId}-${cursorIndex}` : undefined,
    onClick: () => (open ? close() : openMenu()),
    onKeyDown: handleKeyDown,
  };

  return (
    <>
      {labelled ? (
        /* The outlined field's own shell (`.m3-field`, globals.css): the button stands
           where the input would, `data-filled` floats the label as a value does in an
           input, and the focused field's 2dp outline is the focus indicator — no ring,
           no state layer, the outlined text field's own language. The arrow gets the
           trailing icon's 12dp inset rather than the text's 16. */
        <div
          className={cn('m3-field', className)}
          data-labelled=""
          data-trail="icon"
          data-filled={selected ? '' : undefined}
        >
          <button
            {...comboboxProps}
            id={triggerId}
            aria-labelledby={labelId}
            className="flex h-14 cursor-pointer items-center gap-2 text-left text-body-l select-none touch-manipulation focus-visible:outline-hidden disabled:cursor-not-allowed"
          >
            {valueCell}
            {arrow}
          </button>
          <label id={labelId} htmlFor={triggerId}>
            {label}
          </label>
          <fieldset aria-hidden="true">
            <legend>
              <span>{label}</span>
            </legend>
          </fieldset>
        </div>
      ) : (
        <button
          {...comboboxProps}
          aria-label={ariaLabel}
          /* `inner`: the wave is clipped by the host span below rather than by this
             box, so the 40dp trigger's 48px touch target survives hit-testing. */
          data-ripple="inner"
          className={cn(
            'group inline-flex min-w-0 max-w-full cursor-pointer items-center justify-between gap-2',
            shape === 'pill' ? 'rounded-full' : 'rounded-sm',
            'text-on-surface spring-fast-effects transition-[color,background-color,box-shadow,opacity]',
            'focus-visible:outline-hidden focus-visible:ring-2 focus-ring',
            'disabled:disabled-content disabled:cursor-not-allowed',
            /* A control, not content: no long-press selection, no double-tap zoom;
               and under forced colors its tone step is gone, so the system edge. */
            'touch-target select-none touch-manipulation forced-boundary',
            'bg-surface-container-highest state-layer',
            pad,
            className,
          )}
        >
          <span data-ripple-host="" aria-hidden="true" />
          {valueCell}
          {arrow}
        </button>
      )}

      {/* Popover owns the outer surface; this list owns one 8dp inset on all
          four sides, keeping its rounded rows concentric with the panel. */}
      <Popover
        open={open}
        onClose={close}
        anchorRef={triggerRef}
        handleRef={popoverRef}
        id={listboxId}
        role="listbox"
        aria-label={labelled ? label : ariaLabel}
        estimatedHeight={estimateMenuHeight(options.length)}
        className="p-2"
      >
        {optionRows()}
      </Popover>
    </>
  );
}
