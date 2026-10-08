'use client';

import {
  useCallback,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type CompositionEvent,
  type KeyboardEvent,
  type MouseEvent,
} from 'react';

/**
 * One combobox contract — WAI-ARIA 1.2's editable combobox with a listbox popup
 * ("list autocomplete, manual selection") — for every text field that offers
 * suggestions: /search's tag suggestions, a block group's tag field, the glossary's
 * Derpibooru lookup. Three hand-rolled copies had drifted three ways: one pre-selected
 * the first row (so "type, press Enter" picked a suggestion instead of searching),
 * two had no roles and no keys at all.
 *
 * **What it owns:** the ARIA wiring, the keyboard, the cursor, and scrolling the cursor
 * into view *inside the list* (never the page). **What it does not:** fetching, the
 * surface (render the list in a `Popover` with `role="listbox"`), or what a pick means.
 *
 *     const box = useCombobox({
 *       options: suggestions,            // a stable array (state or memo)
 *       open: showSuggestions,           // the caller wants the list shown
 *       onOpenChange: setShowSuggestions,
 *       onSelect: (tag) => addTag(tag),
 *       onEnterWithoutActive: () => addTag(text),   // omit to let a form submit natively
 *       resetKey: text,                  // a new query clears the cursor
 *     });
 *     <Input {...box.inputProps} value={text} onChange={(e) => {
 *       setText(e.target.value);
 *       if (!box.isComposing()) lookUp(e.target.value);   // no pinyin lookups
 *     }} />
 *     <Popover open={box.isOpen} {...box.listboxProps} anchorRef={…} onClose={() => setShowSuggestions(false)}>
 *       {suggestions.map((tag, i) => (
 *         <div key={tag.id} {...box.getOptionProps(i)} className={cn(rowClasses, box.optionClassName(i))}>…</div>
 *       ))}
 *     </Popover>
 *
 * The contract, key by key (focus never leaves the field — the list is named to it with
 * `aria-activedescendant`):
 *
 * - **No option is active until the user arrows into the list.** Enter then does what the
 *   field does without a list — submits the typed text (`onEnterWithoutActive`, or the
 *   form's own submission when that is omitted).
 * - **ArrowDown / ArrowUp** move the cursor, wrapping, skipping disabled options; on a
 *   closed list they open it at the first / last option.
 * - **Enter** on an active option picks it. **Tab** picks the active option too, then lets
 *   focus move on — it never traps focus in the field. With no active option it only
 *   closes the list.
 * - **Escape** closes an open list and consumes the key (so a surrounding dialog stays
 *   open); on a closed list it is left alone.
 * - **Home / End** belong to the text caret; they drop the cursor back into the field.
 * - **A pointer** hovering a row shows the state layer only — it does not move the
 *   keyboard's cursor, so a mouse resting on the list cannot turn Enter into a pick.
 *   Pressing a row does not take focus from the field (`onMouseDown` is prevented), which
 *   also keeps a phone's keyboard up.
 * - **IME composition** is never interrupted: keys during a composition (including the
 *   keyCode 229 some engines report) are ignored, and `isComposing()` tells the caller to
 *   skip lookups for pinyin fragments; `onCompositionEnd` receives the committed text.
 *
 * The cursor row takes `state-layer-active` (a roving cursor is not focus), every other
 * row `state-layer` — `optionClassName` returns the one to use. A *chosen* value, where
 * a caller shows one, is the `secondary-container` pair, not the cursor.
 */
export interface ComboboxConfig<T> {
  /** The options offered now, already filtered. Keep the array stable between renders. */
  options: readonly T[];
  /** Whether the caller wants the list shown. It is open when this is true *and* there
   *  is something to show. */
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** An option was picked — Enter or Tab on the cursor, or a press. */
  onSelect: (option: T, index: number) => void;
  /** Enter with no active option. Omit to let the key reach the form (a search submits). */
  onEnterWithoutActive?: () => void;
  /** The text an IME committed — run the lookup the composition skipped. */
  onCompositionEnd?: (value: string) => void;
  isOptionDisabled?: (option: T, index: number) => boolean;
  /** Anything that means "these are new options" — the query. A change clears the cursor. */
  resetKey?: unknown;
}

export interface ComboboxResult {
  /** Whether the list is showing: `open` and at least one option. Use it for the popup. */
  isOpen: boolean;
  /** The keyboard's cursor, or −1 for none. */
  activeIndex: number;
  setActiveIndex: (index: number) => void;
  /** True while an IME composition is in progress. */
  isComposing: () => boolean;
  listboxId: string;
  optionId: (index: number) => string;
  /** Spread on the text input. Compose your own `onKeyDown` by calling this one first. */
  inputProps: {
    role: 'combobox';
    'aria-autocomplete': 'list';
    'aria-expanded': boolean;
    'aria-controls': string | undefined;
    'aria-activedescendant': string | undefined;
    onKeyDown: (event: KeyboardEvent<HTMLElement>) => void;
    onCompositionStart: () => void;
    onCompositionEnd: (event: CompositionEvent<HTMLInputElement | HTMLTextAreaElement>) => void;
  };
  /** Spread on the popup (e.g. `Popover`), which must carry the listbox role. */
  listboxProps: { id: string; role: 'listbox' };
  /** Spread on each option row. */
  getOptionProps: (index: number) => {
    id: string;
    role: 'option';
    'aria-selected': boolean;
    'aria-disabled': boolean | undefined;
    onMouseDown: (event: MouseEvent) => void;
    onClick: () => void;
  };
  /** `state-layer-active` for the cursor row, `state-layer` for the rest. */
  optionClassName: (index: number) => string;
}

export function useCombobox<T>({
  options,
  open,
  onOpenChange,
  onSelect,
  onEnterWithoutActive,
  onCompositionEnd,
  isOptionDisabled,
  resetKey,
}: ComboboxConfig<T>): ComboboxResult {
  const baseId = useId();
  const listboxId = `${baseId}-listbox`;
  const optionId = useCallback((index: number) => `${baseId}-option-${index}`, [baseId]);
  const composing = useRef(false);
  const [active, setActive] = useState(-1);

  const isOpen = open && options.length > 0;

  /* A new query or a list that closed clears the cursor — during render, the documented
     pattern for state that follows a prop, so no frame shows a stale row. Opening does
     not: ArrowDown on a closed list opens it *and* places the cursor in one event. A
     shorter list simply cannot show a cursor past its end. */
  const [seenKey, setSeenKey] = useState(resetKey);
  const [seenOpen, setSeenOpen] = useState(isOpen);
  if (!Object.is(seenKey, resetKey) || seenOpen !== isOpen) {
    const closed = seenOpen && !isOpen;
    const newQuery = !Object.is(seenKey, resetKey);
    setSeenKey(resetKey);
    setSeenOpen(isOpen);
    if ((closed || newQuery) && active !== -1) setActive(-1);
  }
  const activeIndex = isOpen && active < options.length ? active : -1;

  const enabled = useCallback(
    (index: number) => !isOptionDisabled?.(options[index], index),
    [isOptionDisabled, options],
  );

  /** The next enabled index from `from` in direction `step`, wrapping; −1 if none. */
  const seek = useCallback(
    (from: number, step: 1 | -1) => {
      const total = options.length;
      for (let i = 1; i <= total; i++) {
        const next = (((from + step * i) % total) + total) % total;
        if (enabled(next)) return next;
      }
      return -1;
    },
    [options.length, enabled],
  );

  const pick = useCallback(
    (index: number) => {
      if (index < 0 || index >= options.length || !enabled(index)) return;
      onSelect(options[index], index);
      setActive(-1);
      onOpenChange(false);
    },
    [options, enabled, onSelect, onOpenChange],
  );

  /* Keep the cursor visible inside the list — the list's own scroll, never the page's
     (`scrollIntoView` would scroll every ancestor, the page included). */
  useLayoutEffect(() => {
    if (activeIndex < 0) return;
    const option = document.getElementById(optionId(activeIndex));
    const list = document.getElementById(listboxId);
    if (!option || !list) return;
    const view = list.getBoundingClientRect();
    const row = option.getBoundingClientRect();
    const inset = 8;
    if (row.top < view.top + inset) list.scrollTop += row.top - view.top - inset;
    else if (row.bottom > view.bottom - inset) list.scrollTop += row.bottom - view.bottom + inset;
  }, [activeIndex, listboxId, optionId]);

  const onKeyDown = useCallback(
    (event: KeyboardEvent<HTMLElement>) => {
      // Never interrupt an IME: its keys choose candidates, not options.
      if (event.nativeEvent.isComposing || event.keyCode === 229) return;
      switch (event.key) {
        case 'ArrowDown':
        case 'ArrowUp': {
          if (options.length === 0) return;
          event.preventDefault();
          const step = event.key === 'ArrowDown' ? 1 : -1;
          if (!isOpen) {
            onOpenChange(true);
            setActive(seek(step === 1 ? -1 : 0, step));
            return;
          }
          setActive(seek(activeIndex < 0 ? (step === 1 ? -1 : 0) : activeIndex, step));
          return;
        }
        case 'Enter':
          if (isOpen && activeIndex >= 0) {
            event.preventDefault();
            pick(activeIndex);
            return;
          }
          if (onEnterWithoutActive) {
            event.preventDefault();
            onEnterWithoutActive();
          }
          if (isOpen) onOpenChange(false);
          return;
        case 'Tab':
          // Never `preventDefault`: Tab always moves on.
          if (isOpen && activeIndex >= 0) pick(activeIndex);
          else if (isOpen) onOpenChange(false);
          return;
        case 'Escape':
          if (!isOpen) return;
          /* Consumed, so an enclosing dialog (whose layer skips prevented keys) stays
             open: the first Escape closes the innermost thing. */
          event.preventDefault();
          setActive(-1);
          onOpenChange(false);
          return;
        case 'Home':
        case 'End':
          // The caret's keys. The cursor goes back to the field; the caret moves natively.
          if (activeIndex >= 0) setActive(-1);
          return;
      }
    },
    [options.length, isOpen, activeIndex, seek, pick, onOpenChange, onEnterWithoutActive],
  );

  return {
    isOpen,
    activeIndex,
    setActiveIndex: setActive,
    isComposing: () => composing.current,
    listboxId,
    optionId,
    inputProps: {
      role: 'combobox',
      'aria-autocomplete': 'list',
      'aria-expanded': isOpen,
      'aria-controls': isOpen ? listboxId : undefined,
      'aria-activedescendant': activeIndex >= 0 ? optionId(activeIndex) : undefined,
      onKeyDown,
      onCompositionStart: () => {
        composing.current = true;
      },
      onCompositionEnd: (event) => {
        composing.current = false;
        onCompositionEnd?.(event.currentTarget.value);
      },
    },
    listboxProps: { id: listboxId, role: 'listbox' },
    getOptionProps: (index: number) => ({
      id: optionId(index),
      role: 'option',
      'aria-selected': index === activeIndex,
      'aria-disabled': enabled(index) ? undefined : true,
      // Keep focus (and a phone's keyboard) in the field; the press still clicks.
      onMouseDown: (event: MouseEvent) => event.preventDefault(),
      onClick: () => pick(index),
    }),
    optionClassName: (index: number) => (index === activeIndex ? 'state-layer-active' : 'state-layer'),
  };
}
