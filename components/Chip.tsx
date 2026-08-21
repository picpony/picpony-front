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
 * base plus an override, because `cn` is a plain join: `px-3` next to `pr-2`
 * emits both and lets Tailwind's output order decide the trailing edge.
 *
 * **The padding depends on whether there is a glyph beside the label, not on the
 * size.** M3 gives a chip 16dp of leading space with nothing in front of the
 * label and 8dp when an icon or a check is there, because the glyph's own visual
 * mass replaces the air. Both sizes therefore share one set of horizontal steps
 * and differ only in height. They used to be 10dp and 12dp regardless, which is
 * neither of the spec's values and made a chip with a check read as more tightly
 * packed than the same chip without one.
 *
 * **One height: 32dp.** `AssistChipTokens.ContainerHeight` and
 * `FilterChipTokens.ContainerHeight` are both 32, and the token set gives a chip no
 * other height — so there is nothing for a `size` prop to choose between. It had
 * two (36 then 40 for `md`), and the 40 came from this file: it moved there to land on
 * the 32/40/48/56 control scale, which was the right instinct applied to the wrong
 * kind of object. A chip is not a control step, it is a chip.
 *
 * 32dp is under the 48dp touch minimum, and that is what `touch-target` on the
 * inner button is for — M3 states it directly: "the touch target may extend beyond
 * the component bounds". */
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
          hasGlyph ? LEAD.withGlyph : LEAD.bare,
          onRemove ? TRAIL.toCross : TRAIL.bare,
          isInteractive ? 'cursor-pointer' : 'cursor-default',
          /* The state layer, which this did not have. A filter chip is a control
             and it was the only one in the app with no hover feedback at all —
             the ripple answered a press and nothing answered a pointer arriving,
             so a row of filters read as labels until you clicked one. Only when
             it is genuinely interactive: a chip used as a tag is a mark, and
             lighting up under the pointer would promise a press that does
             nothing. */
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
          /* `transition-ui`, which is the app's 200ms. This was the one control
             carrying a hand-written 300ms, so a chip's cross settled a third
             slower than the chip it sits in. */
          className="touch-target state-layer focus-ring text-on-surface-variant transition-ui inline-flex shrink-0 cursor-pointer items-center justify-center rounded-full p-0.5 outline-none focus-visible:ring-2"
        >
          {/* 18dp, matching the leading check. It was 13 and 15 — sizes that
              exist nowhere else in the app. */}
          <MdClose size={ICON.dense} />
        </button>
      )}
    </span>
  );
});

export default Chip;
