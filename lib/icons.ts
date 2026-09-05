/**
 * Icon-size scale (18 / 20 / 24 / 36 / 48). Use `size={ICON.standard}`, never a number:
 * a named size keeps the scale greppable and a new size impossible to add silently.
 *
 *   dense     18  a glyph inside a chip, or beside a line of metadata — M3's smallest
 *                 defined size; below it a Material Symbol's strokes stop resolving.
 *   control   20  inside a button or a dense icon button.
 *   standard  24  the default: a list/nav row, an app-bar action, a field adornment.
 *   large     36  a large FAB's glyph, or one prominent affordance.
 *   display   48  an illustration: the glyph over an empty state or an error.
 *
 * Not for `Avatar` / `SkeletonCircle` — those take a box size, not a glyph size.
 */
export const ICON = {
  dense: 18,
  control: 20,
  standard: 24,
  large: 36,
  display: 48,
} as const;

export type IconSize = (typeof ICON)[keyof typeof ICON];
