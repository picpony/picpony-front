'use client';

import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react';
import Spinner from './Spinner';
import { useTooltip } from './Tooltip';
import { cn } from '@/lib/utils';

export type IconButtonVariant =
  | 'standard'
  | 'filled'
  | 'tonal'
  | 'outlined'
  | 'danger'
  | 'media'
  | 'on-primary';
export type IconButtonSize = 'sm' | 'md' | 'lg';
/**
 * Round is the default and covers every icon button in a row of actions. Square
 * exists for a control that has to answer to the *container* it sits in rather
 * than to its neighbours: the back affordance is pinned to the top-left of the
 * content section, whose own corner is 12dp, and a circle inside a rounded
 * rectangle at that distance reads as a sticker rather than as part of the
 * frame. M3 Expressive gives the icon button a shape axis for this.
 */
export type IconButtonShape = 'round' | 'square';

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
 *   media     sits on a photograph rather than on a surface, so it takes the
 *             media roles — none of the surface roles apply over a picture. It
 *             exists because the image detail's zoom control was a `<div onClick>`
 *             wearing a hand-written plate, and a control on media is a recurring
 *             object, not a one-off.
 *   on-primary sits on the brand-coloured app bar. It exists for the focus ring:
 *             `focus-ring` is the brand pink, which on a pink bar is invisible,
 *             so the app bar's four controls were hand-rolled with
 *             `focus-ring-on-primary` and an eight-class string repeated four
 *             times — a 48px box, a state layer, a ripple and a transition, once
 *             per button, drifting independently of the primitive.
 *
 * Hover, focus and press are the shared `state-layer`, painted from the
 * button's own `color`, so a variant never has to name a second tint. Sizes are
 * M3's icon-button steps — **32 / 40 / 56dp**, from `XSmall`/`Small`/`Medium`
 * `IconButtonTokens` — and the glyph is sized by the box, not by the caller (see
 * `ICON_SIZES` below). This line said 32 / 40 / **48** for a while; 48 is the
 * touch-target floor rather than a size, and `SIZES` has never agreed with it.
 *
 * **No elevation, in any variant.** M3 puts every icon button at level 0,
 * including the filled and tonal ones — the container tone is the whole
 * separation. `filled` and `tonal` here carried level 1 at rest rising to level
 * 2, which made a 40dp glyph cast a deeper shadow than the dialog it sat in.
 *
 * No `active:scale` utilities: M3 gives no size feedback on press, and a control
 * mid-transform corrupts the rect the hero flight reads.
 */
const VARIANTS: Record<IconButtonVariant, string> = {
  standard: 'bg-transparent text-on-surface-variant focus-ring',
  filled: 'bg-primary text-on-primary focus-ring',
  tonal: 'bg-secondary-container text-on-secondary-container focus-ring',
  outlined:
    'border border-outline bg-transparent text-on-surface-variant enabled:hover:border-primary focus-ring',
  /* A destructive icon-only action, and the only reason it is a variant rather
     than a `className` at the call site is that `cn` is a plain join: the upload
     page's remove badge was passing `bg-error-fill text-on-fill shadow-e3`, so
     the variant's own container was emitted alongside the override and which one
     applied came down to Tailwind's output order. It takes the same
     scheme-independent `*-fill` pair `Button`'s `danger` does, for the reason
     spelled out in the semantic-fills block in globals.css. */
  danger: 'bg-error-fill text-on-fill focus-ring',
  /* `state-layer` paints from the element's own `color`, so `on-media` gives the
     hover and press their tint without a second hand-picked value.
     The ring is `focus-ring-on-media`, painted inward: `focus-ring` is
     `secondary`, which has no guaranteed contrast over a photograph — the same
     argument that gave the app bar its own ring — and an outset white one would
     put its outer edge on the picture. Inward, it sits on this variant's own
     plate. `iconButtonClasses` switches the ring *width* to match. */
  media: 'bg-media-plate text-on-media backdrop-blur-sm focus-ring-on-media',
  'on-primary': 'bg-transparent text-on-primary focus-ring-on-primary',
};

/* The M3 icon-button steps, verbatim: `XSmallIconButtonTokens.ContainerHeight` 32,
   `SmallIconButtonTokens` 40 (the default), `MediumIconButtonTokens` **56**.
   Both ends have been wrong. `sm` was 36dp, which is not a step on any M3 scale —
   it sat between 32 and 40 and existed because nothing had written the scale down.
   And `lg` was 48dp, which *looks* like a step and is not one: 48 is M3's
   touch-target minimum, a floor on the hit area, and no icon-button token is 48.
   The medium icon button is 56, the same as a text field and a large button. */
const SIZES: Record<IconButtonSize, string> = {
  sm: 'h-8 w-8',
  md: 'h-10 w-10',
  lg: 'h-14 w-14',
};

/* The glyph size belongs to the button, not to the call site. `IconSize` is 20 at
   extra-small and 24 at both small and medium, and leaving it to the caller is how
   `ImageCropper` ended up passing 20 into a default-size button while `Modal`
   passed 24 into the same box.

   **It wins over the call site**, which this note used to deny. `react-icons` emits
   `size` as the svg's `width`/`height` *attributes*, and a presentational attribute
   loses to author CSS — so a `size` passed in here is inert, and the dozens of
   `size={ICON.dense}` props in the app have been rendering at their slot's size all
   along. They are left in place because they change nothing; the claim that they
   won was the defect.

   The exception is an icon wrapped in an element of its own: this is a child
   selector, so it cannot reach a glyph inside a `<span>`. The app bar's theme toggle
   wraps its icon to animate the swap, and there the call site's `size` is the only
   thing sizing the glyph. `Button`'s slot has the same shape and the same caveat. */
const ICON_SIZES: Record<IconButtonSize, string> = {
  sm: '[&>svg]:size-5',
  md: '[&>svg]:size-6',
  lg: '[&>svg]:size-6',
};

/* Spelled per branch rather than as a default plus an override, because `cn` is
   a plain join: emitting both radii would leave the stylesheet's order to pick
   the corner. Same reason `Chip` writes out every horizontal step. */
const SHAPES: Record<IconButtonShape, string> = {
  round: 'rounded-full',
  square: 'rounded-md',
};

/* And the same guard `Skeleton`, `Badge` and `ProgressBar` all use, for the same
   reason: a call site that names its own corner has already answered the question, and
   emitting the shape's as well would leave the output order to decide. The case that
   needed it is a **run of buttons joined like a grouped list** — /messages' composer
   puts the emoji and send controls either side of the field, and the seam facing the
   field takes the 4dp step while the outer end takes 16dp, which is `.m3-row`'s own
   rule for a run. That cannot come from a `shape` union without inventing a value per
   position. */
const HAS_RADIUS = /(?:^|\s)(?:\S+:)?rounded(?:-\S+)?/;

interface IconButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'> {
  /** The glyph. Sized by `size` via `ICON_SIZES`, not by the caller. */
  icon: ReactNode;
  /** Required — an icon-only control has no visible label to name it. */
  'aria-label': string;
  variant?: IconButtonVariant;
  size?: IconButtonSize;
  /** `square` takes the 12dp step — see `IconButtonShape`. */
  shape?: IconButtonShape;
  /** Swaps the glyph for a spinner and blocks interaction. */
  loading?: boolean;
  /** Marks a toggle as on. Reads out, and picks up the selected container. */
  selected?: boolean;
  /**
   * The dismiss gesture: the glyph turns a quarter-turn on hover.
   *
   * Written out at four sites before this — `Modal`'s close, `AuthModal`'s,
   * `DevBanner`'s and the upload page's remove-image button — on three
   * different box sizes and two different transitions, each with its own
   * `motion-reduce` guard. It is one affordance, so it is one flag.
   */
  dismiss?: boolean;
  /**
   * The hover/focus label. Defaults to `title` if given, otherwise to
   * `aria-label` — an icon-only control cannot ship without one, so there is
   * always something true to show and no call site has to remember to pass it.
   *
   * Pass `false` to opt out: a control whose meaning is already on screen beside
   * it, or a decorative copy that rides along on an animation.
   *
   * This is an M3 tooltip rather than the browser's `title` bubble. `title` gave
   * the OS font at the OS size with no token in it, a delay the page cannot set,
   * nothing reachable on a touch screen, and — the part that matters — no
   * `aria-describedby`, since `title` is a last-resort accessible *name* rather
   * than a description, so a screen reader either read it instead of the label or
   * ignored it.
   */
  tooltip?: string | false;
}

export interface IconButtonClassOptions {
  variant?: IconButtonVariant;
  size?: IconButtonSize;
  shape?: IconButtonShape;
  selected?: boolean;
  disabled?: boolean;
  dismiss?: boolean;
  className?: string;
}

/**
 * The icon-button recipe, for the handful of cases where the element genuinely
 * cannot be a `<button>` — the app bar's 消息 entry is an `<a>`, because it is a
 * navigation, and a `<button>` may not be nested in one. Same split, and the
 * same reason, as `buttonClasses` beside `Button`.
 *
 * Reach for the component everywhere else. Hand-copying this string is what let
 * four app-bar controls drift apart in the first place.
 */
export function iconButtonClasses({
  variant = 'standard',
  size = 'md',
  shape = 'round',
  selected = false,
  disabled = false,
  dismiss = false,
  className = '',
}: IconButtonClassOptions = {}): string {
  return cn(
    'inline-flex shrink-0 cursor-pointer items-center justify-center outline-none',
    'transition-[background-color,box-shadow,border-color,color,opacity,rotate] duration-200 ease-[var(--ease-standard)]',
    /* One indicator, and the width has to agree with the colour: `media` sets
       `--tw-inset-ring-color`, so pairing it with the outset `ring-2` would leave
       that ring at `currentcolor` and draw two. `selected` replaces the variant
       string with the ordinary outset ring, so it follows the same branch. */
    variant === 'media' && !selected
      ? 'focus-visible:inset-ring-2'
      : 'focus-visible:ring-2',
    !disabled && 'state-layer',
    disabled && 'cursor-not-allowed disabled-content',
    dismiss && !disabled && 'hover:rotate-90 motion-reduce:hover:rotate-0',
    /* A selected toggle takes the container/on-container pair rather than a
       tinted border plus a third text colour, which is how the favourite
       button ended up with a 40%-alpha warning border — an alpha on a token, so
       it had to be eyeballed once per scheme.
       The focus ring is spelled again inside this branch: it used to replace the
       whole variant string, and every variant carries its own `focus-ring`, so a
       *selected* icon button lost the ring's colour entirely — `ring-2` then fell
       back to `currentcolor`, i.e. whatever ink happened to surround it. That is
       the exact failure the `focus-ring` utility was added to end. */
    selected
      ? 'bg-secondary-container text-on-secondary-container focus-ring'
      : VARIANTS[variant],
    /* A *selected* icon button is a rounded square, not a circle:
       `SelectedContainerShapeRound` is `CornerMedium` at the small step and
       `CornerLarge` at the medium one. That is M3's shape-as-state, and it is the
       one place the shape axis is decided by state rather than by the call site —
       so an explicit `shape="square"` still wins over both. A call site that names
       its own corner outranks all three; see `HAS_RADIUS`. */
    !HAS_RADIUS.test(className) &&
      cn(
        shape === 'round' && selected && (size === 'lg' ? 'rounded-lg' : 'rounded-md'),
        shape === 'round' && !selected && SHAPES.round,
        shape === 'square' && SHAPES.square,
      ),
    SIZES[size],
    ICON_SIZES[size],
    className,
  );
}

const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  {
    icon,
    variant = 'standard',
    size = 'md',
    shape = 'round',
    loading = false,
    selected = false,
    dismiss = false,
    disabled,
    tooltip,
    /* Intercepted rather than spread: with an M3 tooltip rendered, leaving the
       native attribute on would put two bubbles on one control. */
    title,
    /* Destructured with a default rather than left to `{...rest}` overriding a
       hard-coded attribute below. The app bar's search control is a real form
       `submit` — that worked only because the spread happened to come last, and
       a future reorder would have silently turned it back into a no-op. */
    type = 'button',
    className = '',
    ...rest
  },
  ref,
) {
  const isDisabled = disabled || loading;
  /* A copy riding along on an animation is `aria-hidden` and must not describe
     itself; nor must a disabled control, which has nothing to offer on hover. */
  const inert = rest['aria-hidden'] === true || rest['aria-hidden'] === 'true';
  const label = tooltip === false || inert ? undefined : (tooltip ?? title ?? rest['aria-label']);
  const { anchorRef, anchorProps, tooltip: bubble } = useTooltip(label);

  return (
    <>
      <button
        ref={(node) => {
          anchorRef.current = node;
          if (typeof ref === 'function') ref(node);
          else if (ref) ref.current = node;
        }}
        type={type}
        disabled={isDisabled}
        aria-pressed={rest['aria-pressed'] ?? (selected ? true : undefined)}
        /* Always present, never conditional on `disabled`.
           `[data-ripple]` in globals.css is what gives this element
           `position: relative` and `overflow: hidden`, and the ripple span is an
           absolutely-positioned child that depends on both. Dropping the attribute
           when the button becomes disabled therefore does not merely stop *future*
           ripples — it un-positions the one currently animating, which reflows to
           the initial containing block and finishes in the top-left corner of the
           page. That is reachable from a single click on any button whose own
           handler sets `loading`: the 领取 button on /tasks is the one that showed
           it. `RippleLayer` already refuses to spawn on a disabled target, so the
           gate belongs there and only there. */
        data-ripple=""
        className={iconButtonClasses({
          variant,
          size,
          shape,
          selected,
          disabled: isDisabled,
          dismiss,
          className,
        })}
        {...rest}
        {...anchorProps}
      >
        {loading ? <Spinner size="sm" tone={variant === 'filled' ? 'on-primary' : 'primary'} /> : icon}
      </button>
      {bubble}
    </>
  );
});

export default IconButton;
