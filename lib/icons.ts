/**
 * The icon size scale.
 *
 * There were **fourteen** sizes in use — 12, 14, 16, 18, 20, 22, 24, 32, 36, 40,
 * 44, 48, 56, 64 — across 285 call sites, and the reason is simply that nothing
 * wrote a scale down. Every glyph was sized against the one next to it, so a
 * gallery card's score used 12, a chip's check used 14, a button's leading icon
 * used 16 and the sidebar used 22, none of which is a size Material defines.
 *
 * These five are M3's own icon sizes, and each one has a job:
 *
 *   dense     18  a glyph inside a chip, or beside a line of metadata. M3's
 *                 smallest defined icon size; below it a Material Symbol's
 *                 strokes stop resolving and it reads as a smudge rather than a
 *                 shape, which is exactly what the 12s and 14s were doing.
 *   control   20  inside a button or a dense icon button. `ButtonSmallTokens`
 *                 and `ButtonMediumTokens` give 20 and 24 respectively.
 *   standard  24  the default, and the one to reach for when unsure: a list
 *                 item, a navigation row, an app-bar action, a text field's
 *                 adornment. Every one of those is 24 in the token set.
 *   large     36  a large FAB's glyph, or a prominent single affordance —
 *                 `FabLargeTokens.IconSize`.
 *   display   48  an illustration rather than a control: the glyph above an
 *                 empty state or an error.
 *
 * Import and use `size={ICON.standard}` rather than a number, so the scale is
 * greppable and a new size cannot be introduced without deleting a name.
 *
 * This is *not* the scale for `Avatar` or `SkeletonCircle`, which take a box size
 * rather than a glyph size and have their own steps.
 */
export const ICON = {
  dense: 18,
  control: 20,
  standard: 24,
  large: 36,
  display: 48,
} as const;

export type IconSize = (typeof ICON)[keyof typeof ICON];
