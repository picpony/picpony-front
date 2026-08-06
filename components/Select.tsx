'use client';

import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import { createPortal } from 'react-dom';
import { MdCheck, MdExpandMore } from 'react-icons/md';
import { prefersReducedMotion } from '@/lib/motion';

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

const MENU_MARGIN = 6;
const VIEWPORT_PADDING = 12;
/** 18rem — past this the menu scrolls no matter how much room it has. */
const MAX_MENU_HEIGHT = 288;
/** M3 menu item height, and the container's block padding. Keep in step with
 *  the `min-h-12` / `py-2` on the elements below. */
const MENU_ITEM_HEIGHT = 48;
const MENU_PADDING = 8;

/* Container-transform timings. The reference uses 225ms in / 125ms out; the
   rows run at twice the container's duration so their fade trails the morph. */
const MENU_ENTER_MS = 225;
const MENU_EXIT_MS = 125;
const EASE_DECELERATE = 'cubic-bezier(0.05, 0.7, 0.1, 1)';
const EASE_STANDARD = 'cubic-bezier(0.2, 0, 0, 1)';
const EASE_ACCELERATE = 'cubic-bezier(0.3, 0, 0.8, 0.15)';

/**
 * Listbox with an animated popover, replacing the unstylable native <select>.
 * The menu renders in a portal so overflow-hidden ancestors cannot clip it, and
 * is positioned from the trigger rect each time it opens.
 *
 * One presentation on every width: it opens in place, under (or over) its own
 * trigger. A phone-width bottom sheet was tried and removed — the list is short
 * and already anchored to the control you just pressed, so relocating it to the
 * bottom of the screen moved your eye away from the thing you were setting.
 * `measure()` clamps it into the viewport, which is what the sheet was really
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
  const mounted = useSyncExternalStore(
    () => () => {},
    () => true,
    () => false,
  );
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [placement, setPlacement] = useState({
    top: 0,
    left: 0,
    width: 0,
    up: false,
    available: MAX_MENU_HEIGHT,
  });
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const listboxId = useId();

  const selected = options.find((o) => o.value === value);
  const selectedIndex = options.findIndex((o) => o.value === value);

  const measure = useCallback(() => {
    const trigger = triggerRef.current;
    if (!trigger) return;
    const rect = trigger.getBoundingClientRect();
    /* Menu height is unknown before paint, so estimate it to pick a side.
       Must track the real geometry — a 48dp item plus the container's 8dp
       padding top and bottom. When this drifts under the truth the menu is
       judged to fit when it does not, and a scrollbar appears in a menu that
       had room to open the other way. */
    const estimated = Math.min(options.length * MENU_ITEM_HEIGHT + MENU_PADDING * 2, MAX_MENU_HEIGHT);
    const spaceBelow = window.innerHeight - rect.bottom - MENU_MARGIN - VIEWPORT_PADDING;
    const spaceAbove = rect.top - MENU_MARGIN - VIEWPORT_PADDING;
    /* Open upwards when the menu does not fit below AND there is more room
       above. The old test only asked whether `spaceBelow` was short of the
       estimate — so a control in the middle of a long settings page kept
       `up === false`, the max-height clamped to whatever was left underneath,
       and a six-option menu came out two rows tall with a scrollbar even though
       the space above it was ample. */
    const up = estimated > spaceBelow && spaceAbove > spaceBelow;
    setPlacement({
      top: up ? rect.top - MENU_MARGIN : rect.bottom + MENU_MARGIN,
      left: rect.left,
      width: rect.width,
      up,
      available: Math.max(0, Math.min(MAX_MENU_HEIGHT, up ? spaceAbove : spaceBelow)),
    });
  }, [options.length]);

  const openMenu = () => {
    if (disabled) return;
    measure();
    setActiveIndex(selectedIndex >= 0 ? selectedIndex : 0);
    setOpen(true);
  };

  /* Exit: the reverse container transform, 125ms on the accelerated curve.
   *
   * The menu shrinks back into its trigger rather than blinking out. Unmount is
   * deferred until the animation finishes, which is why this is not simply
   * `setOpen(false)` — and why `closingRef` guards it: Escape, an outside
   * click and a commit can all fire in the same gesture, and without the guard
   * each would start another exit on a menu already on its way out. */
  const closingRef = useRef(false);

  const close = useCallback((refocus = true) => {
    if (refocus) triggerRef.current?.focus();
    if (closingRef.current) return;

    const menu = menuRef.current;
    const trigger = triggerRef.current;
    const finish = () => {
      closingRef.current = false;
      setOpen(false);
    };

    if (!menu || !trigger || prefersReducedMotion()) {
      finish();
      return;
    }

    const triggerRect = trigger.getBoundingClientRect();
    const menuRect = menu.getBoundingClientRect();
    if (menuRect.width === 0 || menuRect.height === 0) {
      finish();
      return;
    }

    closingRef.current = true;
    menu.style.pointerEvents = 'none';
    const exit = menu.animate(
      [
        {},
        {
          transform: `scale(${Math.min(1, triggerRect.width / menuRect.width)}, ${Math.min(
            1,
            triggerRect.height / menuRect.height,
          )})`,
          opacity: 0,
        },
      ],
      { duration: MENU_EXIT_MS, easing: EASE_ACCELERATE, fill: 'forwards' },
    );
    // `finished` rejects if the animation is cancelled (e.g. unmount); either
    // way the menu must not be left open.
    exit.finished.then(finish, finish);
  }, []);

  const commit = (option: SelectOption<T>) => {
    if (option.disabled) return;
    if (option.value !== value) onChange(option.value);
    close();
  };

  // Reposition against scroll/resize rather than trapping the page.
  useEffect(() => {
    if (!open) return;
    const onScroll = () => measure();
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', onScroll);
    return () => {
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', onScroll);
    };
  }, [open, measure]);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (menuRef.current?.contains(target) || triggerRef.current?.contains(target)) return;
      close(false);
    };
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [open, close]);

  /* Enter: an M3 container transform, matched to Vuetify 3.7's VDialogTransition.
   *
   * The menu starts at the trigger's own box — scaled down to it and
   * transparent — and grows into place, while the rows stay invisible for the
   * first third and then fade in behind the morph. That "container morphs,
   * then content arrives" split is the whole character of an MD3 menu opening,
   * and it is what a plain fade (my previous version) throws away.
   *
   * Web Animations rather than GSAP: this needs to start from a measured box,
   * and WAAPI's `fill: 'backwards'` guarantees the first painted frame is
   * already the scaled one — a tween that begins on the next rAF tick would
   * flash the menu at full size for a frame.
   *
   * Vuetify's own curves are Material *2* leftovers (0.4, 0, 0.2, 1); these are
   * the project's M3 equivalents, which is the one place worth diverging.
   */
  useLayoutEffect(() => {
    const menu = menuRef.current;
    const trigger = triggerRef.current;
    if (!open || !menu || !trigger) return;
    if (prefersReducedMotion()) return;

    const triggerRect = trigger.getBoundingClientRect();
    const menuRect = menu.getBoundingClientRect();
    if (menuRect.width === 0 || menuRect.height === 0) return;

    // Never scale up — the menu is at least as wide as its trigger.
    const sx = Math.min(1, triggerRect.width / menuRect.width);
    const sy = Math.min(1, triggerRect.height / menuRect.height);

    // The menu is already anchored to the trigger's edge, so scaling about that
    // edge reproduces the translate half of the reference for free.
    menu.style.transformOrigin = placement.up ? 'bottom left' : 'top left';

    const container = menu.animate(
      [{ transform: `scale(${sx}, ${sy})`, opacity: 0 }, { transform: 'none', opacity: 1 }],
      { duration: MENU_ENTER_MS, easing: EASE_DECELERATE, fill: 'backwards' },
    );

    const rows = [...menu.children].map((row) =>
      row.animate([{ opacity: 0 }, { opacity: 0, offset: 0.33 }, { opacity: 1 }], {
        duration: MENU_ENTER_MS * 2,
        easing: EASE_STANDARD,
        fill: 'backwards',
      }),
    );

    return () => {
      container.cancel();
      rows.forEach((row) => row.cancel());
    };
  }, [open, placement.up]);

  // Keep the active option in view during keyboard traversal.
  useEffect(() => {
    if (!open || activeIndex < 0) return;
    menuRef.current
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

  const pad = size === 'sm' ? 'px-2.5 py-1.5 text-body-s' : 'px-3 py-2 text-body-m';

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
              ? 'cursor-not-allowed text-on-surface/38'
              : isSelected
                ? 'bg-primary/12 text-primary'
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
                  isSelected ? 'text-primary/75' : 'text-on-surface-variant'
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
        className={`group inline-flex items-center justify-between gap-2 rounded-sm text-on-surface transition-ui outline-none disabled:opacity-50 disabled:cursor-not-allowed ${pad} ${
          open
            ? 'bg-primary-container text-on-primary-container ring-2 ring-primary/25'
            : 'bg-surface-container-high state-layer hover:text-primary focus-visible:ring-2 focus-visible:ring-primary/25'
        } ${className}`}
      >
        <span className={`truncate ${selected ? '' : 'text-outline'}`}>
          {selected?.label ?? placeholder}
        </span>
        <MdExpandMore
          size={size === 'sm' ? 16 : 18}
          className={`shrink-0 text-outline transition-transform duration-300 ease-[var(--ease-standard)] ${open ? 'rotate-180 text-primary' : ''}`}
        />
      </button>

      {mounted &&
        open &&
        createPortal(
          <div
            ref={menuRef}
            id={listboxId}
            role="listbox"
            aria-activedescendant={activeIndex >= 0 ? `${listboxId}-${activeIndex}` : undefined}
            style={{
              position: 'fixed',
              top: placement.up ? undefined : placement.top,
              bottom: placement.up ? window.innerHeight - placement.top : undefined,
              left: placement.left,
              minWidth: placement.width,
              transformOrigin: placement.up ? 'bottom center' : 'top center',
              maxHeight: `${placement.available}px`,
            }}
            /* `popover-scrollbar`, not `main-scrollbar`: the latter reserves its
               gutter permanently (right for a page column, wrong for a 160px
               menu, where it left every option 8px short of the right edge). */
            /* M3 menu container. Measured against Vuetify 3.7's MD3 menu, which
               is the reference implementation: 4dp corner (extra-small, not the
               8dp I first guessed), 8dp of padding on the block axis and NONE
               on the inline axis so rows run edge to edge, and no outline — the
               tonal step plus elevation is the whole M3 separation recipe. */
            /* Always `auto`, never a conditional `hidden`. The condition used a
               *estimated* content height, so a menu whose real content ran a few
               pixels past the estimate — one option with a hint line, or a label
               that wrapped — was judged to fit, got `overflow: hidden`, and then
               clipped that last option with no way to reach it. `auto` already
               means "a scrollbar only when one is needed", which is the whole
               behaviour the condition was trying to hand-roll. */
            className="popover-scrollbar bg-surface-container z-[200] overflow-y-auto rounded-xs py-2 shadow-e2"
          >
            {optionRows()}
          </div>,
          document.body,
        )}
    </>
  );
}
