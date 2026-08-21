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
   * the part that was missing — a real `<button>` to hang them on.
   *
   * **This used to render a `<div>`**, which made it a control no keyboard could
   * reach and no screen reader could name: a cursor, a state layer and a ripple
   * on an element with no role, no tab stop and no Enter/Space handling. It had
   * zero call sites, which is the only reason it never shipped as a defect — and
   * it is the same defect `DataTable`'s docstring records removing when it
   * dropped `onRowClick`. A prop that produces an inaccessible control is worse
   * than an absent one, so `interactive` now implies `as="button"`.
   *
   * No press *scale*: M3 gives no size feedback on press — the state layer and
   * the ripple carry it — and a card mid-transform corrupts the rect the hero
   * flight reads on press.
   */
  interactive?: boolean;
  /**
   * Overrides the element. Only ever `div` or `button`: a card is a surface, and
   * the one thing a surface is sometimes *also* is a single large control.
   * `interactive` already picks `button`, so pass this only to opt back out —
   * a card whose press target is a nested link, say.
   */
  /**
   * `'a'` is for a card-shaped `<Link>`, which is the one thing this primitive could
   * not express: four card-shaped links in the app hand-rolled the whole recipe
   * because `Card` rendered only a `div` or a `button`. Pass `href` through `...rest`,
   * or spread `Link`'s own props onto it.
   */
  as?: 'div' | 'button' | 'a';
  /** Forwarded when the card is a `button`. */
  disabled?: ButtonHTMLAttributes<HTMLButtonElement>['disabled'];
  type?: ButtonHTMLAttributes<HTMLButtonElement>['type'];
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
 *
 * Each variant's container tone is M3's own, not a step chosen by eye; see the
 * container table in AGENTS.md for the whole set and for what went wrong when
 * they were each off by one.
 */
const VARIANTS: Record<CardVariant, string> = {
  /* Default. M3's *filled* card is `surface-container-highest` at elevation 0 —
     the highest step on the tone scale, which is what lets a card read as a
     distinct plane with no border and no shadow at all. This was
     `surface-container-low`, which is the *elevated* card's colour minus its
     shadow: two steps too light, so on `surface` (#fdf8f9 against #f7f2f4 in the
     light scheme) the card was a 6-point tonal step and effectively invisible.
     Both variants below were shifted by the same one step, so the whole set was
     off by one rather than each being wrong on its own. */
  filled: 'bg-surface-container-highest',
  // For things that genuinely float above the page (dialogs, popovers, promos).
  // M3's elevated card is `surface-container-low` + level 1.
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
      // M3 card corner is 12dp. `rounded-md` is 12px in the shape scale, which
      // is also what the old `rounded-md` resolved to before the scale moved,
      // so migrated cards keep their exact silhouette.
      className={cn(
        'rounded-md transition-shadow duration-200 ease-[var(--ease-standard)]',
        VARIANTS[variant],
        PADDINGS[padding],
        /* A card that is a button still reads as a card: no pill, no label role,
           and the text stays left-aligned — a `<button>` centres its content by
           default, which would re-set every paragraph inside it. */
        isControl && 'block w-full text-left outline-none focus-visible:ring-2 focus-ring',
        /* `disabled` is typed and forwarded, so it has to *look* disabled. It did
           not: a disabled card was pixel-identical to an enabled one while being a
           real `<button>` that ignored clicks, which is the worst of both — the same
           class of defect as the `interactive` div that could not be focused.
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
