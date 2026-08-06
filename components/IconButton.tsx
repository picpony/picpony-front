'use client';

import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react';
import Spinner from './Spinner';
import { cn } from '@/lib/utils';

export type IconButtonVariant = 'standard' | 'filled' | 'tonal' | 'outlined';
export type IconButtonSize = 'sm' | 'md' | 'lg';

/**
 * M3's icon button, as a primitive.
 *
 * There was no such thing, so every screen invented one. The image detail's
 * action row alone held three dialects in a single flex line: the favourite
 * used `state-layer`, the share and the pager used `hover:bg-surface-container-
 * high`, the report used `state-layer` again but with a different hover colour
 * — and all four wrote `p-2.5 rounded-full` by hand, which is a 40dp box only
 * because a 20px glyph happened to be inside it. Change the glyph and the
 * button changes size.
 *
 * The four variants are the spec's, and they differ only in their container:
 *
 *   standard  no container. The default, and what a row of secondary actions
 *             wants — containers on all of them would read as four buttons
 *             competing rather than one group.
 *   tonal     secondary container. A leading action that has to sit on top of
 *             content and stay findable — this is what `DetailBack` is.
 *   filled    primary. One per screen at most.
 *   outlined  an outline instead of a fill, for a toggle that is currently off.
 *
 * Hover, focus and press are the shared `state-layer`, painted from the
 * button's own `color`, so a variant never has to name a second tint. Sizes are
 * the sanctioned touch-target scale (36 / 40 / 48dp) and the glyph is sized by
 * the caller — `size` decides the box, and the box is what the finger hits.
 *
 * No `active:scale-*`: M3 gives no size feedback on press, and a control
 * mid-transform corrupts the rect the hero flight reads.
 */
const VARIANTS: Record<IconButtonVariant, string> = {
  standard: 'bg-transparent text-on-surface-variant focus-visible:ring-primary/30',
  filled:
    'bg-primary text-on-primary shadow-e1 enabled:hover:shadow-e2 focus-visible:ring-primary/40',
  tonal:
    'bg-secondary-container text-on-secondary-container shadow-e1 enabled:hover:shadow-e2 focus-visible:ring-primary/45',
  outlined:
    'border border-outline bg-transparent text-on-surface-variant enabled:hover:border-primary focus-visible:ring-primary/30',
};

const SIZES: Record<IconButtonSize, string> = {
  sm: 'h-9 w-9',
  md: 'h-10 w-10',
  lg: 'h-12 w-12',
};

interface IconButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'> {
  /** The glyph. Sized by the caller; the box comes from `size`. */
  icon: ReactNode;
  /** Required — an icon-only control has no visible label to name it. */
  'aria-label': string;
  variant?: IconButtonVariant;
  size?: IconButtonSize;
  /** Swaps the glyph for a spinner and blocks interaction. */
  loading?: boolean;
  /** Marks a toggle as on. Reads out, and picks up the selected container. */
  selected?: boolean;
}

const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  {
    icon,
    variant = 'standard',
    size = 'md',
    loading = false,
    selected = false,
    disabled,
    className = '',
    ...rest
  },
  ref,
) {
  const isDisabled = disabled || loading;

  return (
    <button
      ref={ref}
      type="button"
      disabled={isDisabled}
      aria-pressed={rest['aria-pressed'] ?? (selected ? true : undefined)}
      data-ripple={isDisabled ? undefined : ''}
      className={cn(
        'inline-flex shrink-0 cursor-pointer items-center justify-center rounded-full outline-none',
        'transition-[background-color,box-shadow,border-color,color] duration-200 ease-[var(--ease-standard)] focus-visible:ring-2',
        !isDisabled && 'state-layer',
        isDisabled && 'cursor-not-allowed opacity-40',
        /* A selected toggle takes the container/on-container pair rather than a
           tinted border plus a third text colour, which is how the favourite
           button ended up with `border-warning/40` — an alpha on a token, so it
           had to be eyeballed once per scheme. */
        selected ? 'bg-secondary-container text-on-secondary-container' : VARIANTS[variant],
        SIZES[size],
        className,
      )}
      {...rest}
    >
      {loading ? <Spinner size="sm" white={variant === 'filled'} /> : icon}
    </button>
  );
});

export default IconButton;
