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
import { gsap, prefersReducedMotion } from '@/lib/motion';

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

/**
 * Listbox with an animated popover, replacing the unstylable native <select>.
 * The menu renders in a portal so overflow-hidden ancestors cannot clip it, and
 * is positioned from the trigger rect each time it opens.
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
  const mounted = useSyncExternalStore(() => () => {}, () => true, () => false);
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [placement, setPlacement] = useState({ top: 0, left: 0, width: 0, up: false });
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const listboxId = useId();

  const selected = options.find(o => o.value === value);
  const selectedIndex = options.findIndex(o => o.value === value);

  const measure = useCallback(() => {
    const trigger = triggerRef.current;
    if (!trigger) return;
    const rect = trigger.getBoundingClientRect();
    // Menu height is unknown before paint; estimate to pick a side, then the
    // max-height below keeps it inside the viewport either way.
    const estimated = Math.min(options.length * 44 + 12, 288);
    const spaceBelow = window.innerHeight - rect.bottom;
    const up = spaceBelow < estimated + VIEWPORT_PADDING && rect.top > spaceBelow;
    setPlacement({
      top: up ? rect.top - MENU_MARGIN : rect.bottom + MENU_MARGIN,
      left: rect.left,
      width: rect.width,
      up,
    });
  }, [options.length]);

  const openMenu = () => {
    if (disabled) return;
    measure();
    setActiveIndex(selectedIndex >= 0 ? selectedIndex : 0);
    setOpen(true);
  };

  const close = useCallback((refocus = true) => {
    setOpen(false);
    if (refocus) triggerRef.current?.focus();
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

  // Enter animation: the menu grows from the trigger edge while options cascade.
  useLayoutEffect(() => {
    const menu = menuRef.current;
    if (!open || !menu) return;
    if (prefersReducedMotion()) return;
    const ctx = gsap.context(() => {
      gsap.timeline()
        .fromTo(menu,
          { autoAlpha: 0, y: placement.up ? 8 : -8, scaleY: 0.88 },
          { autoAlpha: 1, y: 0, scaleY: 1, duration: 0.26, ease: 'decelerate' },
        )
        .from(menu.querySelectorAll('[data-option]'), {
          autoAlpha: 0,
          y: placement.up ? 6 : -6,
          duration: 0.22,
          ease: 'decelerate',
          stagger: 0.025,
          clearProps: 'all',
        }, 0.05);
    }, menu);
    return () => ctx.revert();
  }, [open, placement.up]);

  // Keep the active option in view during keyboard traversal.
  useEffect(() => {
    if (!open || activeIndex < 0) return;
    menuRef.current
      ?.querySelectorAll<HTMLElement>('[data-option]')[activeIndex]
      ?.scrollIntoView({ block: 'nearest' });
  }, [open, activeIndex]);

  const handleKeyDown = (event: React.KeyboardEvent) => {
    const step = (delta: number) => {
      event.preventDefault();
      if (!open) { openMenu(); return; }
      setActiveIndex(prev => {
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
      case 'ArrowDown': step(1); break;
      case 'ArrowUp': step(-1); break;
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
        if (open) { event.preventDefault(); close(); }
        break;
      case 'Tab':
        if (open) close(false);
        break;
    }
  };

  const pad = size === 'sm' ? 'px-2.5 py-1.5 text-xs' : 'px-3 py-2 text-sm';

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
        className={`group inline-flex items-center justify-between gap-2 rounded-lg text-slate-800 dark:text-slate-200 transition-all duration-200 ease-[var(--ease-standard)] outline-none disabled:opacity-50 disabled:cursor-not-allowed ${pad} ${
          open
            ? 'bg-primary/10 text-primary ring-2 ring-primary/25 dark:bg-primary/20'
            : 'bg-slate-100 dark:bg-slate-800 hover:bg-primary/10 hover:text-primary dark:hover:bg-primary/20 focus-visible:ring-2 focus-visible:ring-primary/25'
        } ${className}`}
      >
        <span className={`truncate ${selected ? '' : 'text-slate-400 dark:text-slate-500'}`}>
          {selected?.label ?? placeholder}
        </span>
        <MdExpandMore
          size={size === 'sm' ? 16 : 18}
          className={`shrink-0 text-slate-400 transition-transform duration-300 ease-[var(--ease-standard)] ${open ? 'rotate-180 text-primary' : ''}`}
        />
      </button>

      {mounted && open && createPortal(
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
            maxHeight: `min(18rem, ${(placement.up ? placement.top : window.innerHeight - placement.top) - VIEWPORT_PADDING}px)`,
          }}
          className="main-scrollbar z-[200] overflow-y-auto rounded-xl border border-slate-200 bg-white p-1 shadow-xl shadow-black/10 dark:border-slate-700 dark:bg-slate-800 dark:shadow-black/40"
        >
          {options.map((option, index) => {
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
                className={`flex cursor-pointer items-center gap-2 rounded-lg px-3 py-2 text-sm transition-colors duration-150 ${
                  option.disabled
                    ? 'cursor-not-allowed text-slate-300 dark:text-slate-600'
                    : isSelected
                      ? 'bg-primary/10 font-medium text-primary'
                      : index === activeIndex
                        ? 'bg-slate-100 text-slate-700 dark:bg-slate-700/60 dark:text-slate-200'
                        : 'text-slate-700 dark:text-slate-300'
                }`}
              >
                <span className="min-w-0 flex-1">
                  <span className="block truncate">{option.label}</span>
                  {option.hint && (
                    <span className="mt-0.5 block truncate text-xs text-slate-400 dark:text-slate-500">
                      {option.hint}
                    </span>
                  )}
                </span>
                <MdCheck
                  size={16}
                  className={`shrink-0 transition-all duration-200 ease-[var(--ease-spring)] ${
                    isSelected ? 'scale-100 opacity-100' : 'scale-50 opacity-0'
                  }`}
                />
              </div>
            );
          })}
        </div>,
        document.body,
      )}
    </>
  );
}
