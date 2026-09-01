'use client';

import { forwardRef, type ReactNode, type ButtonHTMLAttributes } from 'react';
import { MdClose, MdCheck } from 'react-icons/md';
import { cn } from '@/lib/utils';
import { ICON } from '@/lib/icons';

export type ChipVariant = 'assist' | 'filter' | 'input';
export type ChipTone = 'neutral' | 'primary' | 'success' | 'warning' | 'error';

interface ChipProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'> {
  variant?: ChipVariant;
  tone?: ChipTone;
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
  primary: 'text-primary-ink',
  success: 'text-success',
  warning: 'text-warning',
  error: 'text-error',
};

/* Split into the *box* and the *inside*, and that split is the whole point.
 *
 * Height, type role and border on the outer `<span>`; padding and gap on the
 * inner `<button>` (the click target, the element `data-ripple` paints into).
 * With all of it on the span, the button shrink-wrapped to its content: a chip's
 * own padding was dead space and the ripple was a puddle in the middle of the
 * text. Padding inward makes the button fill the box.
 *
 * Every horizontal step is spelled per branch rather than composed from a base
 * plus an override: `cn` is a plain join and would let Tailwind's output order
 * decide the trailing edge.
 *
 * **Padding depends on whether there is a glyph beside the label, not on the
 * size** — M3 gives 16dp of leading space bare and 8dp with a glyph there, the
 * glyph's visual mass replacing the air. Both sizes share one horizontal set and
 * differ only in height.
 *
 * **One height: 32dp** (`AssistChipTokens.ContainerHeight` =
 * `FilterChipTokens.ContainerHeight`; the token set offers no other). Deliberately
 * under the 48dp touch minimum — `touch-target` on the inner button is what the
 * spec's "touch target may extend beyond the component bounds" is for. */
const CHIP_HEIGHT = 'h-8';

/** 16dp with nothing before the label, 8dp with a glyph there. M3's own pair. */
const LEAD = { bare: 'pl-4', withGlyph: 'gap-2 pl-2' } as const;
/** Trailing edge: 16dp to the label, 8dp to a dismiss cross. */
const TRAIL = { bare: 'pr-4', toCross: 'pr-2' } as const;

const Chip = forwardRef<HTMLButtonElement, ChipProps>(function Chip(
  {
    variant = 'assist',
    tone = 'neutral',
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
  const showsCheck = variant === 'filter' && selected;
  const hasGlyph = showsCheck || Boolean(icon);

  return (
    <span
      className={cn(
        'inline-flex max-w-full items-center rounded-sm transition-ui',
        CHIP_HEIGHT,
        /* `label-l` at both sizes. M3's chip label is Label Large regardless of
           the chip's height; `sm` was `label-m`, one step down, so a tag row and
           a filter row set the same words at 12px and 14px. */
        'text-label-l',
        // The only padding the span keeps: the gap between the dismiss cross and
        // the trailing edge, which the button below cannot supply.
        onRemove && 'pr-2',
        /* Unselected is a *tone step*, not an outline — deliberate, do not restore
         * the keyline. M3 draws an unselected filter chip with a 1dp outline, but
         * a row of them beside a filled button reads as buttons someone forgot to
         * fill in. A container step says the same thing with the mechanism the
         * rest of this app uses for depth; selected still takes the tone's
         * container pair, so the states differ by hue, not by whether an edge
         * exists. */
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
          hasGlyph ? LEAD.withGlyph : LEAD.bare,
          onRemove ? TRAIL.toCross : TRAIL.bare,
          isInteractive ? 'cursor-pointer' : 'cursor-default',
          /* The state layer. A filter chip is a control and it was the only one
             in the app with no hover feedback at all. Only when genuinely
             interactive: a chip used as a tag is a mark, and lighting up under
             the pointer would promise a press that does nothing. */
          isInteractive && 'state-layer',
          // Its own radius, matching the box: the ripple is clipped by this
          // element, so a square one would paint into the chip's rounded corner.
          'rounded-sm focus-visible:ring-2 focus-ring',
        )}
        {...(isInteractive ? { 'data-ripple': '' } : {})}
        {...rest}
      >
        {showsCheck ? (
          /* 18dp, M3's chip icon size. It was 14 at `sm` and 16 at `md` — two
             values, neither on the icon scale, for one glyph. */
          <MdCheck size={ICON.dense} className="shrink-0" aria-hidden="true" />
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
          /* `transition-ui`, the app's 200ms — the standard clock, so the cross
             settles with the chip it sits in. */
          className="touch-target state-layer focus-ring text-on-surface-variant transition-ui inline-flex shrink-0 cursor-pointer items-center justify-center rounded-full p-0.5 outline-none focus-visible:ring-2"
        >
          {/* 18dp, matching the leading check — M3's chip icon size. */}
          <MdClose size={ICON.dense} />
        </button>
      )}
    </span>
  );
});

export default Chip;
