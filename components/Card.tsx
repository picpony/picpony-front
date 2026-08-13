'use client';

import { forwardRef, type HTMLAttributes, type ReactNode } from 'react';
import { cn } from '@/lib/utils';

export type CardVariant = 'filled' | 'elevated' | 'outlined' | 'transparent';
export type CardPadding = 'none' | 'sm' | 'md' | 'lg';

interface CardProps extends HTMLAttributes<HTMLDivElement> {
  variant?: CardVariant;
  padding?: CardPadding;
  /**
   * Adds the ripple and the hover state layer. Use for whole-card links/buttons.
   *
   * No press *scale*, despite what this line used to promise: M3 gives no size
   * feedback on press — the state layer and the ripple carry it — and a card
   * mid-transform corrupts the rect the hero flight reads on press. The doc was
   * describing behaviour the implementation had never had and the design rules
   * forbid, which is the kind of stale comment that gets "fixed" back in.
   */
  interactive?: boolean;
  children?: ReactNode;
}

/**
 * The one card surface. Replaces the `bg-surface-container-lowest border
 * border-outline-variant rounded-md` string that was pasted at
 * 105 call sites — each of which had to name a light and a dark colour, so a
 * palette change meant editing all of them.
 *
 * Depth comes from the surface-container tone scale rather than from shadows.
 * That is what makes the four variants survive dark mode: Tailwind's mid shadow
 * step is nearly invisible on a near-black background, whereas a tonal step is
 * not. The `shadow-e*` scale in globals.css deepens its alphas under `.dark`
 * for the same reason — use those, never the raw Tailwind ones.
 */
const VARIANTS: Record<CardVariant, string> = {
  // Default. Sits on `surface` and reads as a distinct plane without a border.
  filled: 'bg-surface-container-low',
  // For things that genuinely float above the page (dialogs, popovers, promos).
  elevated: 'bg-surface-container-lowest shadow-e1',
  // For dense lists where filled cards would stack into one grey mass.
  outlined: 'bg-surface border border-outline-variant',
  // No surface at all — content lies directly on the page background.
  transparent: 'bg-transparent',
};

const PADDINGS: Record<CardPadding, string> = {
  none: '',
  sm: 'p-3',
  md: 'p-4',
  lg: 'p-4 sm:p-6',
};

const Card = forwardRef<HTMLDivElement, CardProps>(function Card(
  { variant = 'filled', padding = 'md', interactive = false, className = '', children, ...rest },
  ref,
) {
  return (
    <div
      ref={ref}
      // M3 card corner is 12dp. `rounded-md` is 12px in the shape scale, which
      // is also what the old `rounded-md` resolved to before the scale moved,
      // so migrated cards keep their exact silhouette.
      className={cn(
        'rounded-md transition-shadow duration-200 ease-[var(--ease-standard)]',
        VARIANTS[variant],
        PADDINGS[padding],
        interactive &&
          'state-layer cursor-pointer text-on-surface',
        interactive && variant === 'elevated' && 'hover:shadow-e2',
        className,
      )}
      {...(interactive ? { 'data-ripple': '' } : {})}
      {...rest}
    >
      {children}
    </div>
  );
});

export default Card;
