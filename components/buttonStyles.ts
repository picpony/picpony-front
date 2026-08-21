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
/**
 * Three sizes, and every one of them is an M3 step.
 *
 * M3's button ladder is 32 / 40 / 56 / 96 / 136 (extra-small through
 * extra-large), with leading and trailing space 12 / 16 / 24 and the icon at
 * 20 / 20 / 24. This app needs the bottom three; the two above are display
 * sizes for a hero surface it does not have.
 *
 * There were four, at 28 / 36 / 40 / 48 with 10 / 14 / 20 / 24 of padding, and
 * only one of the eight numbers was an M3 value. The reason is that nothing
 * wrote the scale down, so each size was chosen against the one next to it — the
 * heights land on Tailwind's spacing steps rather than on Material's, which is a
 * different grid that happens to overlap in places. `sm` is gone rather than
 * retuned: at 40dp it was `md`, and keeping both would have meant two names for
 * one box.
 */
export type ButtonSize = 'xs' | 'md' | 'lg';

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
 *
 * **A button is flat at rest.** M3's filled button is elevation level 0, and it
 * takes level 1 on hover and nothing else — pressed goes back to 0. Every filled
 * variant here carried level 1 at rest and level 2 on hover, i.e. the whole
 * ladder shifted up one, which is what made a row of buttons read as a row of
 * floating chips. It also meant the hover lift was a step between two shadows
 * that are nearly identical rather than the appearance of one, so the feedback
 * the elevation change exists to give was not being given. The tonal, text and
 * accent variants have no elevation in the spec and never had any here.
 */
const VARIANTS: Record<ButtonVariant, string> = {
  filled: 'bg-primary text-on-primary enabled:hover:shadow-e1 focus-ring',
  tonal: 'bg-secondary-container text-on-secondary-container focus-ring',
  accent: 'bg-primary-container text-on-primary-container focus-ring',
  text: 'bg-transparent text-on-surface-variant focus-ring',
  danger: 'bg-error-fill text-on-fill enabled:hover:shadow-e1 focus-ring',
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
  success: 'bg-success-fill text-on-fill enabled:hover:shadow-e1 focus-ring',
  warning: 'bg-warning-fill text-on-fill enabled:hover:shadow-e1 focus-ring',
};

/* Heights, padding and the icon gap are M3's per-size values; see `ButtonSize`.
 *
 `xs` exists for one enclosure: a row action inside an admin `DataTable`. Those
 were the last eight hand-rolled buttons in the app, at `px-3 py-1` / `px-2 py-1`
 with a bare 4dp corner and their own eyeballed hover-darkening alpha — and they
 could not simply become the default, because 40dp would have added 8px to every
 row of every table. M3 Expressive specs an extra-small size for exactly this, so
 it is on-spec rather than a concession. It is below the 48px touch minimum on
 purpose and by the same rule the `touch-target` utility documents: dense chrome
 may be smaller than the finger target, and these sit in a desktop-first admin
 surface.
 *
 * The gap is 8dp at every size — `IconLabelSpace` does not vary in the token set,
 * which is why a 32dp button and a 56dp one put the same air between glyph and
 * label. It was 4 / 6 / 8 / 8, i.e. three values for one constant.
 *
 * Horizontal padding is **16 / 16 / 24**, from `LeadingSpace` / `TrailingSpace`.
 * `xs` read 12, on the assumption that a smaller button wants proportionally less
 * air; the token set says otherwise — `ButtonXSmallTokens.LeadingSpace` is 16dp,
 * the same as small's. Only the medium step widens, to 24.
 *
 * The glyph size belongs here too, not at the call site: `IconSize` is 20 at
 * extra-small and small, 24 at medium. Leaving it to callers is how the same slot
 * ended up holding an 18dp glyph in one file and a 24dp one in another.
 *
 * **And it wins over the call site, which is not what this note used to claim.**
 * It said an explicit `size` on the icon still took precedence, "which a handful of
 * optically-small glyphs need". It does not: `react-icons` emits `size` as the svg's
 * `width`/`height` *attributes* (`iconBase.mjs`), and a presentational attribute
 * loses to author CSS, so `[&>span>svg]:size-5` here is the final word. Every
 * `icon={<MdEdit size={ICON.dense} />}` in the app — and there are dozens — has been
 * rendering at 20, not 18. Those props are inert rather than wrong, so they are left
 * alone; what was wrong was the promise. If a glyph genuinely needs a different size,
 * that is a size step on the primitive, not a prop the primitive silently ignores.
 *
 * The one case where a call site's `size` *is* load-bearing is an icon wrapped in an
 * element of its own — the app bar's theme toggle puts its glyph inside a `<span>` to
 * animate the swap, and a child selector cannot reach through that. There the
 * attribute is the only thing sizing the glyph, so do not remove it. */
const SIZES: Record<ButtonSize, string> = {
  xs: 'h-8 gap-2 px-4 text-label-l [&>span>svg]:size-5',
  md: 'h-10 gap-2 px-4 text-label-l [&>span>svg]:size-5',
  /* `title-m`, not a body role. A button's label is a label, and `body-l` on the
     largest button was the one place in the app a body role landed on a control —
     M3 gives the medium button `title-medium`, which is the same 16px at the
     weight a control wants. */
  lg: 'h-14 gap-2 px-6 text-title-m [&>span>svg]:size-6',
};

/** Icon-only footprint per size, used when the label collapses on mobile. */
const ICON_ONLY: Record<ButtonSize, string> = {
  xs: 'max-sm:w-8 max-sm:px-0',
  md: 'max-sm:w-10 max-sm:px-0',
  lg: 'max-sm:w-14 max-sm:px-0',
};

/* **No pressed shape morph**, and it is worth recording that this was tried.
   M3 Expressive does specify one — `ButtonXSmallTokens.PressedContainerShape` and
   `ButtonSmallTokens`' are `CornerSmall` (8dp), `ButtonMediumTokens`' is
   `CornerMedium` (12dp) — and it was implemented here, on `fast-spatial`, animating
   `border-radius` only so it could not corrupt the rect the hero flight reads on
   press. It came out anyway: on a pill the corner has nowhere to travel *to* that
   reads as feedback rather than as a glitch, because the box keeps its dimensions
   and only the ends flatten, so a 40dp pill going to 8dp for 137ms reads as the
   button snapping into a different component. Press feedback here is the state layer
   and the ripple, which is what every other control in the app uses.

   So `border-radius` is off the transition list below as well. A property that never
   changes still costs a style recalculation to watch. */

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
    // No bare weight utility: every entry in SIZES carries a `text-label-*` role, and
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
    /* Colour and shadow only, on `standard`/200ms — a recolour is not geometry, and
       there is no geometry here to animate: see the note above `SIZES` for why the
       pressed corner morph came out. */
    '[transition:background-color_200ms_var(--ease-standard),box-shadow_200ms_var(--ease-standard)] focus-visible:ring-2',
    /* Hover/focus/press are the shared M3 state layer. No press *scale* and no press
       *corner*: M3 gives no size feedback on press that survives on a pill, and a
       transforming button is one more thing the hero flight's rect read can catch
       mid-change. */
    !disabled && 'state-layer',
    disabled && 'cursor-not-allowed disabled-content',
    VARIANTS[variant],
    SIZES[size],
    responsiveLabel && ICON_ONLY[size],
    fullWidth && 'w-full',
    className,
  );
}
