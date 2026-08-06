'use client';

import { forwardRef, type ReactNode, type ButtonHTMLAttributes } from 'react';
import { MdClose, MdCheck } from 'react-icons/md';
import { cn } from '@/lib/utils';

export type ChipVariant = 'assist' | 'filter' | 'input';
export type ChipTone = 'neutral' | 'primary' | 'success' | 'warning' | 'error';
export type ChipSize = 'sm' | 'md';

interface ChipProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'> {
  variant?: ChipVariant;
  tone?: ChipTone;
  size?: ChipSize;
  /** `filter` chips show a leading check when selected and fill with the tone. */
  selected?: boolean;
  icon?: ReactNode;
  /** Renders a trailing dismiss button. Implies `variant="input"` styling. */
  onRemove?: () => void;
  removeLabel?: string;
  children?: ReactNode;
}

/**
 * M3 chip. Tags, category pills, badges and filter toggles were all separate
 * inline implementations with slightly different heights and radii; a tag row
 * and a category row next to each other did not line up.
 *
 * Tone is carried as a container/on-container pair so a selected chip stays
 * legible in both themes without a `dark:` counterpart at the call site.
 */
const TONE_SELECTED: Record<ChipTone, string> = {
  neutral: 'bg-secondary-container text-on-secondary-container',
  primary: 'bg-primary-container text-on-primary-container',
  success: 'bg-success-container text-on-success-container',
  warning: 'bg-warning-container text-on-warning-container',
  error: 'bg-error-container text-on-error-container',
};

const TONE_TEXT: Record<ChipTone, string> = {
  neutral: 'text-on-surface-variant',
  primary: 'text-primary',
  success: 'text-success',
  warning: 'text-warning',
  error: 'text-error',
};

const SIZES: Record<ChipSize, string> = {
  // 32px tall. M3 puts small chips at 32dp; below that they stop being
  // comfortable touch targets in a wrapped tag cloud.
  sm: 'h-8 gap-1 px-2.5 text-label-m',
  md: 'h-9 gap-1.5 px-3 text-label-l',
};

const Chip = forwardRef<HTMLButtonElement, ChipProps>(function Chip(
  {
    variant = 'assist',
    tone = 'neutral',
    size = 'sm',
    selected = false,
    icon,
    onRemove,
    removeLabel = '移除',
    className = '',
    disabled,
    onClick,
    children,
    ...rest
  },
  ref,
) {
  const isFilled = selected || (variant === 'input' && tone !== 'neutral');
  // A chip with no click handler and no remove action is a label, not a
  // control — render it inert so it does not land in the tab order.
  const isInteractive = Boolean(onClick) || variant === 'filter';

  return (
    <span
      className={cn(
        'inline-flex max-w-full items-center rounded-sm border transition-ui ease-[var(--ease-standard)]',
        SIZES[size],
        isFilled
          ? cn(TONE_SELECTED[tone], 'border-transparent')
          : cn('border-outline-variant bg-transparent', TONE_TEXT[tone]),
        disabled && 'pointer-events-none opacity-50',
        className,
      )}
    >
      <button
        ref={ref}
        type="button"
        disabled={disabled}
        onClick={onClick}
        aria-pressed={variant === 'filter' ? selected : undefined}
        tabIndex={isInteractive ? undefined : -1}
        className={cn(
          'inline-flex min-w-0 items-center gap-1 outline-none',
          isInteractive ? 'cursor-pointer' : 'cursor-default',
          'focus-visible:ring-2 focus-visible:ring-primary/40 rounded-sm',
        )}
        {...(isInteractive && !disabled ? { 'data-ripple': '' } : {})}
        {...rest}
      >
        {variant === 'filter' && selected ? (
          <MdCheck size={size === 'sm' ? 14 : 16} className="shrink-0" aria-hidden="true" />
        ) : (
          icon && (
            <span className="shrink-0 [&>svg]:block" aria-hidden="true">
              {icon}
            </span>
          )
        )}
        <span className="truncate">{children}</span>
      </button>

      {onRemove && (
        <button
          type="button"
          onClick={onRemove}
          aria-label={removeLabel}
          disabled={disabled}
          className="-mr-1 ml-0.5 inline-flex shrink-0 cursor-pointer items-center justify-center rounded-full p-0.5 opacity-70 outline-none transition hover:opacity-100 focus-visible:ring-2 focus-visible:ring-primary/40"
        >
          <MdClose size={size === 'sm' ? 13 : 15} />
        </button>
      )}
    </span>
  );
});

export default Chip;
