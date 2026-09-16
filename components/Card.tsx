'use client';

import {
  forwardRef,
  type AnchorHTMLAttributes,
  type ButtonHTMLAttributes,
  type HTMLAttributes,
  type ReactNode,
  type Ref,
} from 'react';
import { cn } from '@/lib/utils';

export type CardVariant = 'filled' | 'elevated' | 'outlined' | 'transparent';
export type CardPadding = 'none' | 'sm' | 'md' | 'lg';

interface CardAppearanceProps {
  variant?: CardVariant;
  padding?: CardPadding;
  children?: ReactNode;
}

/**
 * The native element owns its props: links take href/target/rel, buttons take
 * disabled/type, and a plain surface takes neither. `interactive` without `as`
 * always renders a button; a card containing its own controls stays a plain div.
 * The state layer and ripple provide press feedback without moving its bounds.
 */
type CardProps = CardAppearanceProps & (
  | (Omit<HTMLAttributes<HTMLDivElement>, 'children'> & {
      as?: 'div';
      interactive?: false;
    })
  | (Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'> & (
      | { as: 'button'; interactive?: boolean }
      | { as?: undefined; interactive: true }
    ))
  | (Omit<AnchorHTMLAttributes<HTMLAnchorElement>, 'children'> & {
      as: 'a';
      interactive?: boolean;
    })
);

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

const Card = forwardRef<HTMLElement, CardProps>(function Card(props, ref) {
  const {
    variant = 'filled',
    padding = 'md',
    interactive = false,
    as,
    className = '',
    children,
    ...rest
  } = props;
  const disabled = 'disabled' in props && props.disabled;
  const resolved = as ?? (interactive ? 'button' : 'div');
  const isButton = resolved === 'button';
  /* An anchor takes the same block/left-align/focus treatment a button does — it is
     the same object under the pointer — but never `type` or `disabled`. */
  const isControl = isButton || resolved === 'a';
  const presentation = {
    // M3 card corner is 12dp.
    className: cn(
      'rounded-md transition-shadow duration-standard ease-[var(--ease-standard)]',
      VARIANTS[variant],
      PADDINGS[padding],
      /* A card that is a button still reads as a card: no pill, no label role,
         and the text stays left-aligned — a button centres its content by
         default, which would re-set every paragraph inside it. */
      isControl && 'block w-full text-left outline-none focus-visible:ring-2 focus-ring',
      /* `disabled` is typed and forwarded, so it has to *look* disabled:
         `disabled-content` is the app's one weight (38%, M3's figure), and the
         state layer comes off with it. The ripple host stays positioned while
         a wave already in flight finishes, as it does in `Button`. */
      !disabled && interactive && 'state-layer cursor-pointer text-on-surface',
      !disabled && interactive && variant === 'elevated' && 'hover:shadow-e2',
      disabled && 'disabled-content cursor-not-allowed',
      className,
    ),
    ...(isControl && interactive ? { 'data-ripple': '' } : {}),
  };

  if (resolved === 'button') {
    const buttonProps = rest as ButtonHTMLAttributes<HTMLButtonElement>;
    return (
      <button
        {...buttonProps}
        {...presentation}
        ref={ref as Ref<HTMLButtonElement>}
        type={buttonProps.type ?? 'button'}
      >
        {children}
      </button>
    );
  }
  if (resolved === 'a') {
    return (
      <a {...(rest as AnchorHTMLAttributes<HTMLAnchorElement>)} {...presentation} ref={ref as Ref<HTMLAnchorElement>}>
        {children}
      </a>
    );
  }
  return (
    <div {...(rest as HTMLAttributes<HTMLDivElement>)} {...presentation} ref={ref as Ref<HTMLDivElement>}>
      {children}
    </div>
  );
});

export default Card;
