/**
 * The one map from a tag category to the colour that represents it — this file is
 * the only thing allowed to pick an accent hue for a category (the accent scale is
 * categorical, not semantic), so a category means one colour on every screen. Two
 * vocabularies feed in, Derpibooru's tag API (`character`, `species`, `origin`,
 * `content-official`, …) and the autocomplete endpoint's own names (`artist`, `oc`,
 * `content_official`, …), both keyed here and normalised through `tagCategory()`.
 *
 * `general` is deliberately uncoloured: it is the default category and by far the
 * largest, so colouring it would tint most of every tag cloud and leave the genuinely
 * distinct categories with nothing to stand out against.
 */
export type AccentHue =
  'red' | 'orange' | 'yellow' | 'green' | 'teal' | 'blue' | 'indigo' | 'purple';

export interface TagCategory {
  label: string;
  /** `null` renders as the neutral surface chip. */
  hue: AccentHue | null;
}

const CATEGORIES: Record<string, TagCategory> = {
  artist: { label: '艺术家', hue: 'blue' },
  oc: { label: 'OC', hue: 'indigo' },
  character: { label: '角色', hue: 'purple' },
  species: { label: '种族', hue: 'green' },
  rating: { label: '分级', hue: 'red' },
  origin: { label: '来源', hue: 'teal' },
  'content-official': { label: '官方内容', hue: 'yellow' },
  'content-fanmade': { label: '同人内容', hue: 'orange' },
  general: { label: '常规', hue: null },
  error: { label: '错误', hue: null },
};

const NEUTRAL: TagCategory = { label: '其他', hue: null };

/** Accepts either vocabulary's spelling, plus unknown values. */
export function tagCategory(name: string | undefined | null): TagCategory {
  if (!name) return NEUTRAL;
  return CATEGORIES[name] ?? CATEGORIES[name.replace(/_/g, '-')] ?? NEUTRAL;
}

/**
 * Chip classes for a category: the accent container plus its ink, or the neutral
 * surface pair. Both halves come from the same token so a call site cannot pair
 * a fill with the wrong text colour.
 */
export function tagCategoryChip(name: string | undefined | null): string {
  const { hue } = tagCategory(name);
  return hue
    ? `bg-accent-${hue} text-on-accent-${hue}`
    : 'bg-surface-container-high text-on-surface-variant';
}

/**
 * Background for a small solid indicator (the dots in the search
 * autocomplete). Uses the ink tone rather than the container: at 8px a
 * container-weight fill is invisible against the surface it sits on.
 */
export function tagCategoryDot(name: string | undefined | null): string {
  const { hue } = tagCategory(name);
  return hue ? `bg-on-accent-${hue}` : 'bg-outline';
}

/*
 * The two helpers above build their class names by interpolating a hue, which
 * Tailwind's source scanner cannot follow; `@source inline(...)` at the top of
 * app/globals.css keeps the generated utilities alive.
 */
