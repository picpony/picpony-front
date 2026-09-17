import { cn } from '@/lib/utils';

export type ButtonVariant =
  | 'filled'
  | 'tonal'
  | 'surface'
  | 'accent'
  | 'text'
  | 'danger'
  | 'danger-text'
  | 'success'
  | 'warning';
/**
 * Three sizes, each an M3 step of the 32 / 40 / 56 ladder, with leading/trailing
 * space 16 / 16 / 24 and icons at 20 / 20 / 24. The two display sizes above are
 * for a hero surface this app does not have.
 */
export type ButtonSize = 'xs' | 'md' | 'lg';

/**
 * The button recipe, with no React and — deliberately — no `'use client'`.
 *
 * It lives apart from `Button.tsx` because a server component may need the
 * class string: `app/not-found.tsx` renders `<Link>`s wearing the button shape,
 * and importing anything from a `'use client'` module there yields a *client
 * reference* rather than the value, which threw at render time.
 */

/**
 * Every variant is a container/on-container token pair, so none needs a dark
 * counterpart. Every variant carries the *same* focus ring — deliberate: a
 * focus ring answers "where is the keyboard" and must look identical on every
 * control (M3 draws it from one role for the same reason).
 *
 * **There is no outlined variant.** M3 does specify one; every use here was a
 * secondary action beside a filled primary, where a 1dp keyline reads as a
 * button that lost its fill. `tonal` is the step below `filled` for that
 * pairing, and this app separates by container tone rather than by an edge.
 *
 * **Ordinary controls keep one plane.** Container tones carry emphasis and the
 * state layer carries interaction; a hover does not add a decorative shadow.
 */
const VARIANTS: Record<ButtonVariant, string> = {
  filled: 'bg-primary text-on-primary focus-ring',
  tonal: 'bg-secondary-container text-on-secondary-container focus-ring',
  // Neutral commands beside fields and dropdowns share their container material.
  surface: 'bg-surface-container-highest text-on-surface focus-ring',
  accent: 'bg-primary-container text-on-primary-container focus-ring',
  text: 'bg-transparent text-on-surface-variant focus-ring',
  danger: 'bg-error-fill text-on-fill focus-ring',
  /* A destructive action that is not the primary one on its screen. A variant,
     not `variant="text"` plus a colour at the call site: `cn` is a plain join
     and would emit two colour utilities, letting Tailwind's output order pick.
     `error`, not `error-fill` — this is ink on a surface. */
  'danger-text': 'bg-transparent text-error focus-ring',
  /* The confirm half of a moderation pair (通过/拒绝, 上架/下架). Takes the
     scheme-independent `*-fill` pair like `danger`: the plain text roles flip
     between schemes, and a filled button wearing them visibly swaps shade. */
  success: 'bg-success-fill text-on-fill focus-ring',
  warning: 'bg-warning-fill text-on-fill focus-ring',
};

/* Heights, padding and the icon gap are M3's per-size values; see `ButtonSize`.
 * `xs` exists for the admin `DataTable` row action (M3 Expressive specs an
 * extra-small size for exactly this). Deliberately below the 48px touch floor —
 * dense chrome may be smaller than the finger target in a desktop-first surface.
 * The gap is 8dp at every size (`IconLabelSpace` does not vary); horizontal
 * padding is 16 / 16 / 24 (`ButtonXSmallTokens.LeadingSpace` is 16, same as
 * small's — only the medium step widens).
 * The glyph size belongs here, not at the call site. Both a component's icon
 * slot and a link's direct SVG get the same author CSS, which beats the SVG's
 * presentational width. A glyph nested further than the icon slot keeps its
 * own size; that wrapper usually exists to animate it. */
const SIZES: Record<ButtonSize, string> = {
  xs: 'h-8 gap-2 px-4 text-label-l [&>svg]:size-5 [&>span>svg]:size-5',
  md: 'h-10 gap-2 px-4 text-label-l [&>svg]:size-5 [&>span>svg]:size-5',
  /* `title-m`, not a body role: M3 gives the medium button `title-medium`, the
     same 16px at the weight a control wants. */
  lg: 'h-14 gap-2 px-6 text-title-m [&>svg]:size-6 [&>span>svg]:size-6',
};

/** Icon-only footprint per size, used when the label collapses on mobile. */
const ICON_ONLY: Record<ButtonSize, string> = {
  xs: 'max-sm:w-8 max-sm:px-0',
  md: 'max-sm:w-10 max-sm:px-0',
  lg: 'max-sm:w-14 max-sm:px-0',
};

/* A long label must stay inside its enclosure; an explicit cap still wins. */
const HAS_MAX_WIDTH = /(?:^|\s)max-w-\S+/;

/* **No pressed shape morph**, deliberately: M3 Expressive does specify one
   (8dp/12dp per size), but on a pill the corner has nowhere to travel *to* that
   reads as feedback — a 40dp pill flattening to 8dp for 137ms reads as the button
   snapping into a different component. Press feedback here is the state layer and
   the ripple. `border-radius` is also off the transition list below: a property
   that never changes still costs a style recalculation to watch. */

export interface ButtonClassOptions {
  variant?: ButtonVariant;
  size?: ButtonSize;
  responsiveLabel?: boolean;
  fullWidth?: boolean;
  disabled?: boolean;
  /** Busy controls block interaction while retaining their material and ink. */
  loading?: boolean;
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
  loading = false,
  className = '',
}: ButtonClassOptions = {}): string {
  const isDisabled = disabled || loading;
  return cn(
    // M3 Expressive shape: buttons are pills. It stays a pill even inside another
    // rounded box — concentric corners want inner = outer − gap, and inside the
    // search field's pill (gap 8px) a 40dp pill is already the concentric answer.
    // No bare weight utility: SIZES carries `text-label-*`/`text-title-*` roles
    // that already declare weight; restating it would pin the weight to today's
    // token value.
    // `whitespace-nowrap`: a button label is one line. Where the button is laid
    // out shrink-to-fit rather than as a `shrink-0` flex item, a label beside an
    // inline svg breaks between the two and renders the glyph above its text.
    // M3 button labels do not wrap; the button grows or the label truncates.
    'inline-flex shrink-0 items-center justify-center whitespace-nowrap rounded-full outline-none [&>svg]:shrink-0',
    !HAS_MAX_WIDTH.test(className) && 'max-w-full',
    loading ? 'cursor-wait' : disabled ? 'cursor-not-allowed' : 'cursor-pointer',
    /* Material changes share FastEffects with the icon button and text field.
       Geometry stays still; only the ink, container and focus indicator respond. */
    'spring-fast-effects transition-[color,background-color,box-shadow] focus-visible:ring-2',
    /* Hover/focus/press are the shared M3 state layer. No press scale and no
       press corner: a transforming button is one more thing the hero flight's
       rect read can catch mid-change. */
    !isDisabled && 'state-layer',
    disabled && !loading && 'disabled-content',
    VARIANTS[variant],
    SIZES[size],
    responsiveLabel && ICON_ONLY[size],
    fullWidth && 'w-full',
    className,
  );
}
