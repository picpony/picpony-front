'use client';

import { forwardRef, type ButtonHTMLAttributes, type HTMLAttributes, type ReactNode } from 'react';
import { cn } from '@/lib/utils';

export type CardVariant = 'filled' | 'elevated' | 'outlined' | 'transparent';
export type CardPadding = 'none' | 'sm' | 'md' | 'lg';

interface CardProps extends Omit<HTMLAttributes<HTMLElement>, 'children'> {
  variant?: CardVariant;
  padding?: CardPadding;
  /**
   * The whole card is one control. Adds the ripple, the hover state layer and —
   * the part that was missing — a real `<button>` to hang them on. (A control no
   * keyboard could reach and no screen reader could name is worse than an absent
   * prop; `interactive` therefore implies `as="button"`.)
   *
   * No press *scale*: M3 gives no size feedback on press — the state layer and
   * the ripple carry it — and a card mid-transform corrupts the rect the hero
   * flight reads on press.
   */
  interactive?: boolean;
  /**
   * Overrides the element. Only ever `div`, `button` or `a`: a card is a surface,
   * and the one thing a surface is sometimes *also* is a single large control.
   * `interactive` already picks `button`, so pass this only to opt back out — a
   * card whose press target is a nested link, say.
   *
   * `'a'` is for a card-shaped `<Link>`, the one thing this primitive could not
   * otherwise express. Pass `href` through `...rest`, or spread `Link`'s own
   * props onto it.
   */
  as?: 'div' | 'button' | 'a';
  /** Forwarded when the card is a `button`. */
  disabled?: ButtonHTMLAttributes<HTMLButtonElement>['disabled'];
  type?: ButtonHTMLAttributes<HTMLButtonElement>['type'];
  children?: ReactNode;
}

/**
 * The one card surface.
 *
 * Depth comes from the surface-container tone scale rather than from shadows —
 * that is what makes the variants survive dark mode, where a mid shadow step is
 * nearly invisible. Use the `shadow-e*` scale, never the raw Tailwind ones.
 *
 * Each variant's container tone is M3's own, not a step chosen by eye; see the
 * container table in AGENTS.md for the whole set.
 */
const VARIANTS: Record<CardVariant, string> = {
  /* M3's *filled* card is `surface-container-highest` at elevation 0 — the highest
     tone step, which is what lets a card read as a distinct plane with no border
     and no shadow. */
  filled: 'bg-surface-container-highest',
  // For things that genuinely float above the page. M3: `surface-container-low` + level 1.
  elevated: 'bg-surface-container-low shadow-e1',
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

const Card = forwardRef<HTMLElement, CardProps>(function Card(
  {
    variant = 'filled',
    padding = 'md',
    interactive = false,
    as,
    type,
    disabled,
    className = '',
    children,
    ...rest
  },
  ref,
) {
  const resolved = as ?? (interactive ? 'button' : 'div');
  const isButton = resolved === 'button';
  /* An anchor takes the same block/left-align/focus treatment a button does — it is
     the same object under the pointer — but never `type` or `disabled`. */
  const isControl = isButton || resolved === 'a';
  const Tag = resolved as 'div';

  return (
    <Tag
      ref={ref as React.Ref<HTMLDivElement>}
      // M3 card corner is 12dp.
      className={cn(
        'rounded-md transition-shadow duration-standard ease-[var(--ease-standard)]',
        VARIANTS[variant],
        PADDINGS[padding],
        /* A card that is a button still reads as a card: no pill, no label role,
           and the text stays left-aligned — a button centres its content by
           default, which would re-set every paragraph inside it. */
        isControl && 'block w-full text-left outline-none focus-visible:ring-2 focus-ring',
        /* `disabled` is typed and forwarded, so it has to *look* disabled:
           `disabled-content` is the app's one weight (38%, M3's figure), and the
           state layer and ripple come off with it. */
        !disabled && interactive && 'state-layer cursor-pointer text-on-surface',
        !disabled && interactive && variant === 'elevated' && 'hover:shadow-e2',
        disabled && 'disabled-content cursor-not-allowed',
        className,
      )}
      {...(isButton ? { type: type ?? 'button', disabled } : {})}
      {...(isControl && interactive && !disabled ? { 'data-ripple': '' } : {})}
      {...rest}
    >
      {children}
    </Tag>
  );
});

export default Card;
