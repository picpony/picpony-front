'use client';

import { forwardRef, type ReactNode, type ButtonHTMLAttributes, type HTMLAttributes } from 'react';
import { MdClose } from 'react-icons/md';
import { cn } from '@/lib/utils';
import { ICON } from '@/lib/icons';
import CheckGlyph from './CheckGlyph';

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
  /**
   * The remove button's accessible name. Defaults to `移除 {label}` when the label is a
   * string — a row of crosses all named 移除 leaves a screen reader nothing to tell
   * them apart by. Pass it whenever the label is not plain text.
   */
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
  /* Not the secondary container: under 多色 that is the theme's second colour, and at this tone
     step the tag categories own chip-shaped colour, so an accent never wears a chip. The chip
     pair is TonalSpot's selection in both 配色方案. */
  neutral: 'bg-chip-selected text-on-chip-selected',
  primary: 'bg-primary-container text-on-primary-container',
  success: 'bg-success-container text-on-success-container',
  warning: 'bg-warning-container text-on-warning-container',
  error: 'bg-error-container text-on-error-container',
};

/* An unselected chip's ink. `primary` is the neutral ink, not the brand: `primary-ink`
   is a *mark* role, and as 14px label text on this tone step it measured 2.51:1 (light)
   and 3.71:1 (dark) on the default palette, 2.41:1 on 露娜's dark one — under the 4.5:1
   text floor. The tone still decides the selected container pair above. */
const TONE_TEXT: Record<ChipTone, string> = {
  neutral: 'text-on-surface-variant',
  primary: 'text-on-surface-variant',
  success: 'text-success',
  warning: 'text-warning',
  error: 'text-error',
};

/* Split into the *box* and the *inside*, and that split is the whole point.
 *
 * Height, type role and border on the outer `<span>`; padding and gap on the
 * inner label (the click target, the element the ripple paints into). With all
 * of it on the span, the button shrink-wrapped to its content: a chip's own
 * padding was dead space and the ripple was a puddle in the middle of the text.
 * Padding inward makes the button fill the box.
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
 * `FilterChipTokens.ContainerHeight`; the token set offers no other), and a 48px
 * *target* under a finger, the Compose way: `minimumInteractiveComponentSize` gives a
 * chip 48dp of layout around its 32dp container, which is what the coarse-pointer
 * margin below does — so in the usual 8px-gapped row the rows land 48px apart and the
 * targets (`touch-target`, 8px either side of the box) tile instead of overlapping.
 * The label and the cross each grow only on the block axis when both exist, so neither
 * covers the other. */
const CHIP_HEIGHT = 'h-8 pointer-coarse:my-1';

/** 16dp with nothing before the label, 8dp with a glyph there. M3's own pair. */
const LEAD = { bare: 'pl-4', withGlyph: 'gap-2 pl-2' } as const;
/** Trailing edge: 16dp to the label; beside a cross, the cross's own box is the space. */
const TRAIL = { bare: 'pr-4', toCross: 'pr-0.5' } as const;

const Chip = forwardRef<HTMLButtonElement, ChipProps>(function Chip(
  {
    variant = 'assist',
    tone = 'neutral',
    selected = false,
    icon,
    onRemove,
    removeLabel,
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
  // control — render it as text so it is neither a tab stop nor a "button".
  const isInteractive = Boolean(onClick) || variant === 'filter';
  const showsCheck = variant === 'filter' && selected;
  const hasGlyph = showsCheck || Boolean(icon);
  const crossLabel = removeLabel ?? (typeof children === 'string' ? `移除 ${children}` : '移除');

  const inside = (
    <>
      {showsCheck ? (
        /* 18dp, M3's chip icon size. It was 14 at `sm` and 16 at `md` — two
           values, neither on the icon scale, for one glyph. */
        <CheckGlyph className="size-4.5 shrink-0" />
      ) : (
        icon && (
          <span className="shrink-0 [&>svg]:block [&>svg]:size-4.5" aria-hidden="true">
            {icon}
          </span>
        )
      )}
      <span className="truncate">{children}</span>
    </>
  );

  /* The label: padding, not the span, so the target, state layer and ripple cover the
     chip instead of hugging its text; `self-stretch` for the height. Its own radius,
     matching the box: the ripple host takes it, so a square one would paint into the
     chip's rounded corner. */
  const labelClasses = cn(
    'inline-flex min-w-0 items-center self-stretch rounded-sm',
    hasGlyph ? LEAD.withGlyph : LEAD.bare,
    onRemove ? TRAIL.toCross : TRAIL.bare,
  );

  return (
    <span
      className={cn(
        'inline-flex max-w-full items-center rounded-sm spring-fast-effects transition-[color,background-color,opacity]',
        CHIP_HEIGHT,
        /* `label-l` at both sizes. M3's chip label is Label Large regardless of
           the chip's height; `sm` was `label-m`, one step down, so a tag row and
           a filter row set the same words at 12px and 14px. */
        'text-label-l select-none',
        // The only padding the span keeps: the few px between the cross and the edge.
        onRemove && 'pr-0.5',
        /* Unselected is a *tone step*, not an outline — deliberate, do not restore
         * the keyline. M3 draws an unselected filter chip with a 1dp outline, but
         * a row of them beside a filled button reads as buttons someone forgot to
         * fill in. A container step says the same thing with the mechanism the
         * rest of this app uses for depth; selected still takes the tone's
         * container pair, so the states differ by hue, not by whether an edge
         * exists. Under forced colors that step is gone, so the system edge
         * stands in for it (a selected filter chip also keeps its check). */
        colors
          ? colors
          : isFilled
            ? TONE_SELECTED[tone]
            : cn('bg-surface-container-high', TONE_TEXT[tone]),
        'forced-boundary',
        disabled && 'pointer-events-none disabled-content',
        className,
      )}
    >
      {isInteractive ? (
        <button
          ref={ref}
          type="button"
          disabled={disabled}
          onClick={onClick}
          aria-pressed={variant === 'filter' ? selected : undefined}
          /* `inner`: the wave is clipped by the host span, so the chip's 48px target
             is not clipped out of hit-testing with it. */
          data-ripple="inner"
          className={cn(
            labelClasses,
            'cursor-pointer touch-manipulation',
            onRemove ? 'touch-target-block' : 'touch-target',
            /* The state layer. A filter chip is a control and it was the only one in
               the app with no hover feedback at all. */
            'state-layer focus-visible:outline-hidden focus-visible:ring-2 focus-ring',
          )}
          {...rest}
        >
          <span data-ripple-host="" aria-hidden="true" />
          {inside}
        </button>
      ) : (
        /* A tag used as a mark is text, not a `<button>` with no handler: that was
           exposed as a button, reachable by a click, and announced as a control that
           does nothing. No state layer either — lighting up under the pointer would
           promise a press. */
        <span {...(rest as HTMLAttributes<HTMLSpanElement>)} className={cn(labelClasses, 'cursor-default')}>
          {inside}
        </span>
      )}

      {onRemove && (
        <button
          type="button"
          onClick={onRemove}
          aria-label={crossLabel}
          disabled={disabled}
          /* A 32dp box — the chip's full height — around the 18dp cross (M3's chip icon
             size), growing to the touch floor on the block axis only: extended sideways
             it would cover the end of the label, and a tap on a tag's last glyph would
             remove it. Inherit the chip's on-container ink, including semantic and
             categorical fills; its state layer follows the same colour. */
          className="touch-target-block state-layer focus-ring spring-fast-effects transition-[color,box-shadow] inline-flex size-8 shrink-0 cursor-pointer touch-manipulation items-center justify-center rounded-full focus-visible:outline-hidden focus-visible:ring-2"
        >
          <MdClose size={ICON.dense} />
        </button>
      )}
    </span>
  );
});

export default Chip;
