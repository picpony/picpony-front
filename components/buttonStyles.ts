import { cn } from '@/lib/utils';

export type ButtonVariant =
  | 'filled'
  | 'tonal'
  | 'accent'
  | 'text'
  | 'danger'
  | 'danger-text'
  | 'success'
  | 'warning';
export type ButtonSize = 'xs' | 'sm' | 'md' | 'lg';

/**
 * The button recipe, with no React and — deliberately — no `'use client'`.
 *
 * It lives apart from `Button.tsx` because a server component may need the
 * class string: `app/not-found.tsx` renders `<Link>`s wearing the button shape,
 * and a `<button>` may not be nested in an `<a>`. Importing anything from a
 * `'use client'` module into a server component yields a *client reference*
 * rather than the value, so calling `buttonClasses()` there threw at render
 * time and took the whole not-found route down with it.
 */

/**
 * Every variant is a container/on-container token pair, so none of them needs a
 * `dark:` counterpart — the old definitions spelled out four colours each
 * (light bg, light text, dark bg, dark text) plus hover variants, which is why
 * they had drifted out of step with one another.
 *
 * Every variant also carries the *same* focus ring. That is deliberate and it
 * is the one place a variant does not get its own colour: a focus ring answers
 * "where is the keyboard", which the user needs to recognise instantly and
 * identically on every control in the app — M3 draws it from one role for the
 * same reason. Tinting it per variant also went wrong in practice, because
 * `danger` had grown `ring-error` at 50% around an `error-fill` fill, i.e. a red
 * ring drawn immediately outside a red button.
 *
 * **There is no outlined variant.** M3 does specify one, and this had it — but
 * every one of the four places it was used was a secondary action beside a
 * filled primary one (取消 next to 保存, 重置 next to 检索), and at that job a
 * 1dp keyline reads as a button that lost its fill rather than as a quieter
 * button. `tonal` is the step M3 puts directly below `filled` for exactly this
 * pairing, and it separates from the surface the way everything else in this app
 * does — by a container tone rather than by an edge. The variant is removed
 * rather than merely unused, because a variant that exists gets reached for.
 */
const VARIANTS: Record<ButtonVariant, string> = {
  filled:
    'bg-primary text-on-primary shadow-e1 enabled:hover:shadow-e2 focus-ring',
  tonal: 'bg-secondary-container text-on-secondary-container focus-ring',
  accent: 'bg-primary-container text-on-primary-container focus-ring',
  text: 'bg-transparent text-on-surface-variant focus-ring',
  danger:
    'bg-error-fill text-on-fill shadow-e1 enabled:hover:shadow-e2 focus-ring',
  /* A destructive action that is not the primary one on its screen — "清空记录",
     "移除该项". It has to be a variant rather than `variant="text"` plus a
     `text-error` at the call site: `cn` is a plain join and does not resolve
     Tailwind conflicts, so the two colour utilities would both be emitted and
     which one applied would come down to Tailwind's output order instead of to
     what the call site asked for.
     `error`, not `error-fill` — this is ink on a surface, which is the role the
     text token is for; `error-fill` is the scheme-independent tone reserved for
     graphics and for filled destructive buttons like `danger` above. */
  'danger-text': 'bg-transparent text-error focus-ring',
  /* The confirm half of a moderation pair — 通过 next to 拒绝, 上架 next to 下架.
     There was no variant for it, which is the whole reason fourteen admin
     controls were hand-rolled with the `success-fill`/`on-fill` pair plus a hover
     that darkened the fill by an eyeballed 90%: three of the four tokens right
     and the hover invented, once per call site, so the same approve button
     darkened by a different amount in three different tabs.
     Both take the scheme-independent `*-fill` pair for the same reason `danger`
     does, spelled out in the semantic-fills block in globals.css: the plain
     `success`/`warning` roles are *text* roles that flip between schemes, so a
     filled button wearing them visibly swapped shade with the theme. */
  success:
    'bg-success-fill text-on-fill shadow-e1 enabled:hover:shadow-e2 focus-ring',
  warning:
    'bg-warning-fill text-on-fill shadow-e1 enabled:hover:shadow-e2 focus-ring',
};

/* Heights are one step taller than before (was 32/36/44). 32px was well under
 a comfortable touch target, and this is a phone-first site.

 `xs` is the exception, and it exists for one enclosure: a row action inside an
 admin `DataTable`. Those were the last eight hand-rolled buttons in the app, at
 `px-3 py-1` / `px-2 py-1` with a bare `rounded` and their own eyeballed
 hover-darkening alpha — and they could not simply become `sm`,
 because 36dp would have added 10px to every row of every table. M3 Expressive
 specs an XS size for exactly this, so it is on-spec rather than a concession.
 It is below the 44px touch minimum on purpose and by the same rule the
 `touch-target` utility documents: dense chrome may be smaller than the finger
 target, and these sit in a desktop-first admin surface. */
const SIZES: Record<ButtonSize, string> = {
  xs: 'h-7 gap-1 px-2.5 text-label-m',
  sm: 'h-9 gap-1.5 px-3.5 text-label-m',
  md: 'h-10 gap-2 px-5 text-label-l',
  lg: 'h-12 gap-2 px-6 text-body-l',
};

/** Icon-only footprint per size, used when the label collapses on mobile. */
const ICON_ONLY: Record<ButtonSize, string> = {
  xs: 'max-sm:w-7 max-sm:px-0',
  sm: 'max-sm:w-9 max-sm:px-0',
  md: 'max-sm:w-10 max-sm:px-0',
  lg: 'max-sm:w-12 max-sm:px-0',
};

export interface ButtonClassOptions {
  variant?: ButtonVariant;
  size?: ButtonSize;
  responsiveLabel?: boolean;
  fullWidth?: boolean;
  disabled?: boolean;
  className?: string;
}

/**
 * Reach for this only when the element genuinely cannot be a `<button>` —
 * otherwise use the `Button` component. Hand-copying the string is what let 29
 * call sites drift apart on radius, height, elevation and hover mechanic.
 */
export function buttonClasses({
  variant = 'tonal',
  size = 'md',
  responsiveLabel = false,
  fullWidth = false,
  disabled = false,
  className = '',
}: ButtonClassOptions = {}): string {
  return cn(
    // M3 Expressive shape: buttons are pills. Reads friendlier than the
    // 8px rectangles and separates actions from cards at a glance.
    //
    // It stays a pill even inside another rounded box — the /search bar puts
    // two of these in a text field's trailing slot. A square 12dp button was
    // tried there on the theory that an inner corner should echo its enclosure,
    // and it is the wrong reading of that rule: concentric corners want
    // `inner = outer - gap`, not `inner = outer`. The field is a pill, the gap
    // is 8px, and `28 - 8` is exactly half a 40dp button — so the pill is
    // already the concentric answer, and the square one was the mismatch.
    //
    // No `font-medium`: every entry in SIZES carries a `text-label-*` role, and
    // those tokens are already weight 500. Restating it pinned the button's
    // weight to today's token value and made the primitive look like it was
    // overriding the type scale it is supposed to follow.
    // `whitespace-nowrap`: a button label is one line. Where the button is laid
    // out shrink-to-fit rather than as a `shrink-0` flex item — an `inline-flex`
    // inside a block, a grid cell, a narrow table column — a label passed as a
    // bare child alongside an inline `<svg>` breaks between the two and renders
    // the glyph above its own text, spilling out of the fixed height. M3 button
    // labels do not wrap; the button grows or the label truncates.
    'inline-flex shrink-0 cursor-pointer items-center justify-center whitespace-nowrap rounded-full outline-none',
    'transition-[background-color,box-shadow] duration-200 ease-[var(--ease-standard)] focus-visible:ring-2',
    /* Hover/focus/press are the shared M3 state layer. There is no press
       *shrink*: M3 gives no size feedback on press — the state layer plus the
       ripple carry it — and a scaling button is one more thing that can be
       caught mid-transform by the hero flight's rect read. */
    !disabled && 'state-layer',
    disabled && 'cursor-not-allowed disabled-content',
    VARIANTS[variant],
    SIZES[size],
    responsiveLabel && ICON_ONLY[size],
    fullWidth && 'w-full',
    className,
  );
}
