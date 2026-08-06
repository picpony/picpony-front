import { cn } from '@/lib/utils';

export type ButtonVariant = 'filled' | 'tonal' | 'accent' | 'outlined' | 'text' | 'danger';
export type ButtonSize = 'sm' | 'md' | 'lg';

/**
 * The button recipe, with no React and — deliberately — no `'use client'`.
 *
 * It lives apart from `Button.tsx` because a server component may need the
 * class string: `app/not-found.tsx` renders `<Link>`s wearing the button shape,
 * and a `<button>` may not be nested in an `<a>`. Importing anything from a
 * `'use client'` module into a server component yields a *client reference*
 * rather than the value, so calling `buttonClasses()` there threw at render
 * time and took the whole not-found route down with it.
 */

/**
 * Every variant is a container/on-container token pair, so none of them needs a
 * `dark:` counterpart — the old definitions spelled out four colours each
 * (light bg, light text, dark bg, dark text) plus hover variants, which is why
 * they had drifted out of step with one another.
 */
const VARIANTS: Record<ButtonVariant, string> = {
  filled:
    'bg-primary text-on-primary shadow-e1 enabled:hover:shadow-e2 focus-visible:ring-primary/40',
  tonal: 'bg-secondary-container text-on-secondary-container focus-visible:ring-primary/30',
  accent: 'bg-primary-container text-on-primary-container focus-visible:ring-primary/40',
  outlined:
    'border border-outline bg-transparent text-primary enabled:hover:border-primary focus-visible:ring-primary/30',
  text: 'bg-transparent text-on-surface-variant focus-visible:ring-primary/30',
  danger:
    'bg-error-fill text-on-fill shadow-e1 enabled:hover:shadow-e2 focus-visible:ring-error/50',
};

/* Heights are one step taller than before (was 32/36/44). 32px was well under
 a comfortable touch target, and this is a phone-first site. */
const SIZES: Record<ButtonSize, string> = {
  sm: 'h-9 gap-1.5 px-3.5 text-label-m',
  md: 'h-10 gap-2 px-5 text-label-l',
  lg: 'h-12 gap-2 px-6 text-body-l',
};

/** Icon-only footprint per size, used when the label collapses on mobile. */
const ICON_ONLY: Record<ButtonSize, string> = {
  sm: 'max-sm:w-9 max-sm:px-0',
  md: 'max-sm:w-10 max-sm:px-0',
  lg: 'max-sm:w-12 max-sm:px-0',
};

export interface ButtonClassOptions {
  variant?: ButtonVariant;
  size?: ButtonSize;
  responsiveLabel?: boolean;
  fullWidth?: boolean;
  disabled?: boolean;
  className?: string;
}

/**
 * Reach for this only when the element genuinely cannot be a `<button>` —
 * otherwise use the `Button` component. Hand-copying the string is what let 29
 * call sites drift apart on radius, height, elevation and hover mechanic.
 */
export function buttonClasses({
  variant = 'tonal',
  size = 'md',
  responsiveLabel = false,
  fullWidth = false,
  disabled = false,
  className = '',
}: ButtonClassOptions = {}): string {
  return cn(
    // M3 Expressive shape: buttons are pills. Reads friendlier than the
    // 8px rectangles and separates actions from cards at a glance.
    'inline-flex shrink-0 cursor-pointer items-center justify-center rounded-full font-medium outline-none',
    'transition-[background-color,box-shadow,border-color] duration-200 ease-[var(--ease-standard)] focus-visible:ring-2',
    /* Hover/focus/press are the shared M3 state layer. There is no press
       *shrink*: M3 gives no size feedback on press — the state layer plus the
       ripple carry it — and a scaling button is one more thing that can be
       caught mid-transform by the hero flight's rect read. */
    !disabled && 'state-layer',
    disabled && 'cursor-not-allowed opacity-50',
    VARIANTS[variant],
    SIZES[size],
    responsiveLabel && ICON_ONLY[size],
    fullWidth && 'w-full',
    className,
  );
}
