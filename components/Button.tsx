'use client';

import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react';
import Spinner from './Spinner';

export type ButtonVariant = 'filled' | 'tonal' | 'accent' | 'outlined' | 'text' | 'danger';
export type ButtonSize = 'sm' | 'md' | 'lg';

interface ButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** Leading icon; hidden from a11y since the label carries the meaning. */
  icon?: ReactNode;
  /** Swaps the icon for a spinner and blocks interaction. */
  loading?: boolean;
  /** Hide the label below `sm`, keeping a square icon-only button. */
  responsiveLabel?: boolean;
  fullWidth?: boolean;
  children?: ReactNode;
}

// Material 3 leans on filled surfaces rather than outlines, so the default
// secondary action is a borderless tonal button. Hover/active styling is
// scoped with `enabled:` so a disabled button never lights up while still
// showing its not-allowed cursor.
const VARIANTS: Record<ButtonVariant, string> = {
  filled:
    'bg-primary text-white shadow-sm enabled:hover:bg-primary/90 enabled:hover:shadow-md enabled:hover:shadow-primary/25 focus-visible:ring-primary/40',
  tonal:
    'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-200 enabled:hover:bg-primary/10 enabled:hover:text-primary dark:enabled:hover:bg-primary/20 dark:enabled:hover:text-primary focus-visible:ring-primary/30',
  accent:
    'bg-primary/10 text-primary dark:bg-primary/15 enabled:hover:bg-primary/20 dark:enabled:hover:bg-primary/25 focus-visible:ring-primary/40',
  outlined:
    'border border-slate-300 bg-transparent text-slate-700 dark:border-slate-600 dark:text-slate-200 enabled:hover:border-primary enabled:hover:bg-primary/5 enabled:hover:text-primary dark:enabled:hover:border-primary dark:enabled:hover:bg-primary/10 dark:enabled:hover:text-primary focus-visible:ring-primary/30',
  text:
    'text-slate-600 dark:text-slate-300 enabled:hover:bg-slate-100 enabled:hover:text-slate-900 dark:enabled:hover:bg-slate-700 dark:enabled:hover:text-slate-100 focus-visible:ring-slate-400/40',
  danger:
    'bg-red-500 text-white shadow-sm enabled:hover:bg-red-600 enabled:hover:shadow-md enabled:hover:shadow-red-500/25 focus-visible:ring-red-400/50',
};

const SIZES: Record<ButtonSize, string> = {
  sm: 'h-8 gap-1.5 px-3 text-xs',
  md: 'h-9 gap-2 px-4 text-sm',
  lg: 'h-11 gap-2 px-6 text-base',
};

/** Icon-only footprint per size, used when the label collapses on mobile. */
const ICON_ONLY: Record<ButtonSize, string> = {
  sm: 'max-sm:w-8 max-sm:px-0',
  md: 'max-sm:w-9 max-sm:px-0',
  lg: 'max-sm:w-11 max-sm:px-0',
};

/**
 * The single button primitive. Presses ripple (via the global RippleLayer),
 * settle with a scale, and lift on hover — so every action in the app reacts
 * the same way.
 */
const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  {
    variant = 'tonal',
    size = 'md',
    icon,
    loading = false,
    responsiveLabel = false,
    fullWidth = false,
    disabled,
    className = '',
    children,
    ...rest
  },
  ref,
) {
  const isDisabled = disabled || loading;

  return (
    <button
      ref={ref}
      disabled={isDisabled}
      data-ripple={isDisabled ? undefined : ''}
      className={`inline-flex shrink-0 items-center justify-center rounded-lg font-medium outline-none transition-all duration-200 ease-[var(--ease-standard)] focus-visible:ring-2 ${
        isDisabled
          ? 'cursor-not-allowed opacity-50'
          : 'cursor-pointer active:scale-95'
      } ${VARIANTS[variant]} ${SIZES[size]} ${
        responsiveLabel ? ICON_ONLY[size] : ''
      } ${fullWidth ? 'w-full' : ''} ${className}`}
      {...rest}
    >
      {loading ? (
        <Spinner size="sm" white={variant === 'filled' || variant === 'danger'} />
      ) : (
        icon && <span aria-hidden="true" className="shrink-0">{icon}</span>
      )}
      {children && (
        <span className={responsiveLabel ? 'max-sm:hidden' : undefined}>{children}</span>
      )}
    </button>
  );
});

export default Button;
