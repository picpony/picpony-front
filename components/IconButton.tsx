'use client';

import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react';
import Spinner from './Spinner';
import { cn } from '@/lib/utils';

export type IconButtonVariant =
  | 'standard'
  | 'filled'
  | 'tonal'
  | 'outlined'
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
 *             times — a 44px box, a state layer, a ripple and a transition, once
 *             per button, drifting independently of the primitive.
 *
 * Hover, focus and press are the shared `state-layer`, painted from the
 * button's own `color`, so a variant never has to name a second tint. Sizes are
 * the sanctioned touch-target scale (36 / 40 / 48dp) and the glyph is sized by
 * the caller — `size` decides the box, and the box is what the finger hits.
 *
 * No `active:scale` utilities: M3 gives no size feedback on press, and a control
 * mid-transform corrupts the rect the hero flight reads.
 */
const VARIANTS: Record<IconButtonVariant, string> = {
  standard: 'bg-transparent text-on-surface-variant focus-ring',
  filled:
    'bg-primary text-on-primary shadow-e1 enabled:hover:shadow-e2 focus-ring',
  tonal:
    'bg-secondary-container text-on-secondary-container shadow-e1 enabled:hover:shadow-e2 focus-ring',
  outlined:
    'border border-outline bg-transparent text-on-surface-variant enabled:hover:border-primary focus-ring',
  /* `state-layer` paints from the element's own `color`, so `on-media` gives the
     hover and press their tint without a second hand-picked value. */
  media: 'bg-media-plate text-on-media backdrop-blur-sm focus-ring',
  'on-primary': 'bg-transparent text-on-primary focus-ring-on-primary',
};

const SIZES: Record<IconButtonSize, string> = {
  sm: 'h-9 w-9',
  md: 'h-10 w-10',
  lg: 'h-12 w-12',
};

/* Spelled per branch rather than as a default plus an override, because `cn` is
   a plain join: emitting both radii would leave the stylesheet's order to pick
   the corner. Same reason `Chip` writes out every horizontal step. */
const SHAPES: Record<IconButtonShape, string> = {
  round: 'rounded-full',
  square: 'rounded-md',
};

interface IconButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'> {
  /** The glyph. Sized by the caller; the box comes from `size`. */
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
    'transition-[background-color,box-shadow,border-color,color,opacity,rotate] duration-200 ease-[var(--ease-standard)] focus-visible:ring-2',
    SHAPES[shape],
    !disabled && 'state-layer',
    disabled && 'cursor-not-allowed disabled-content',
    dismiss && !disabled && 'hover:rotate-90 motion-reduce:hover:rotate-0',
    /* A selected toggle takes the container/on-container pair rather than a
       tinted border plus a third text colour, which is how the favourite
       button ended up with a 40%-alpha warning border — an alpha on a token, so
       it had to be eyeballed once per scheme. */
    selected ? 'bg-secondary-container text-on-secondary-container' : VARIANTS[variant],
    SIZES[size],
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

  return (
    <button
      ref={ref}
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
    >
      {loading ? <Spinner size="sm" white={variant === 'filled'} /> : icon}
    </button>
  );
});

export default IconButton;
