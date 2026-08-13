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
  /**
   * Renders a trailing dismiss button, which is what makes this an *input* chip.
   * It does not change the fill: M3's input chip is outlined unless it carries a
   * tone, and `isFilled` below is what decides that. (This said "implies
   * `variant="input"` styling", which it does not — the two are independent.)
   */
  onRemove?: () => void;
  removeLabel?: string;
  /**
   * A container/on-container class pair for the *categorical* case — a tag
   * coloured by its category, a staff role. Replaces the `tone` pair rather than
   * joining it, because `cn` is a plain join and emitting both would let the
   * stylesheet's order pick the winner.
   *
   * Only `lib/tagCategories.ts` and `lib/roles.ts` may choose a hue (the
   * `accent-*` scale is categorical, not semantic), so this takes their output
   * rather than a colour name.
   */
  colors?: string;
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

/* Split into the *box* and the *inside*, and that split is the whole point.
 *
 * The height, the type role and the border belong to the outer `<span>`; the
 * padding and the gap belong to the inner `<button>`. All of it used to sit on
 * the span, which left the button — the click target, and the element
 * `data-ripple` paints into — shrink-wrapped to the icon and the label. So a
 * chip's own padding was dead space: pressing 8px inside its left edge did
 * nothing, and the ripple was a puddle in the middle of the text rather than a
 * wave across the control. Moving the padding inward makes the button fill the
 * box, which is what a filter chip has to be to read as pressable at all.
 *
 * Every horizontal step is spelled out per branch rather than composed from a
 * base plus an override, because `cn` is a plain join: `px-3` next to `pr-1.5`
 * emits both and lets Tailwind's output order decide the trailing edge.
 *
 * 32px tall at `sm`. M3 puts small chips at 32dp; below that they stop being
 * comfortable touch targets in a wrapped tag cloud. */
const SIZES: Record<ChipSize, { box: string; lead: string; solo: string; toCross: string; trail: string }> = {
  sm: { box: 'h-8 text-label-m', lead: 'gap-1 pl-2.5', solo: 'pr-2.5', toCross: 'pr-1', trail: 'pr-1.5' },
  md: { box: 'h-9 text-label-l', lead: 'gap-1.5 pl-3', solo: 'pr-3', toCross: 'pr-1.5', trail: 'pr-2' },
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
    colors,
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
  const s = SIZES[size];

  return (
    <span
      className={cn(
        'inline-flex max-w-full items-center rounded-sm transition-ui ease-[var(--ease-standard)]',
        s.box,
        // The only padding the span keeps: the gap between the dismiss cross and
        // the trailing edge, which the button below cannot supply.
        onRemove && s.trail,
        /* Unselected is a *tone step*, not an outline.
         *
         * M3 draws an unselected filter chip with a 1dp outline, and that is
         * what this was — but a row of them next to a filled `Button` reads as a
         * row of buttons someone forgot to fill in, and the two admin filters
         * (只看未翻译, 查重模式) sit exactly there. A container step says the
         * same thing without a second kind of edge: the chip is separated from
         * the surface by being lighter than it in the light scheme and darker in
         * the dark one, which is the mechanism the rest of this app already uses
         * for depth. Selected still takes the tone's container pair, so the two
         * states differ by hue rather than by whether an edge exists. */
        colors
          ? colors
          : isFilled
            ? TONE_SELECTED[tone]
            : cn('bg-surface-container-high', TONE_TEXT[tone]),
        disabled && 'pointer-events-none disabled-content',
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
          // `self-stretch` for the height, the size's padding for the width —
          // together they make the press target, the state layer and the ripple
          // cover the chip instead of hugging its text.
          'inline-flex min-w-0 items-center self-stretch outline-none',
          s.lead,
          onRemove ? s.toCross : s.solo,
          isInteractive ? 'cursor-pointer' : 'cursor-default',
          // Its own radius, matching the box: the ripple is clipped by this
          // element, so a square one would paint into the chip's rounded corner.
          'rounded-sm focus-visible:ring-2 focus-ring',
        )}
        {...(isInteractive ? { 'data-ripple': '' } : {})}
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
          className="touch-target inline-flex shrink-0 cursor-pointer items-center justify-center rounded-full p-0.5 text-on-surface-variant outline-none transition-[color] duration-300 ease-[var(--ease-standard)] state-layer focus-visible:ring-2 focus-ring"
        >
          <MdClose size={size === 'sm' ? 13 : 15} />
        </button>
      )}
    </span>
  );
});

export default Chip;
