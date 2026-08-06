/**
 * The one map from a tag category to the colour that represents it.
 *
 * There were three of these before, and they disagreed: the glossary admin tab
 * painted 分级 blue, the search autocomplete painted it pink, and the tag list
 * on an image gave artists blue — the same hue the glossary was using for a
 * different thing. Nothing linked them, so every category was a different
 * colour depending on which screen you were looking at, which is the one job
 * a categorical colour has to get right.
 *
 * Two vocabularies feed in: Derpibooru's tag API (`character`, `species`,
 * `origin`, `content-official`, …) and the autocomplete endpoint's own names
 * (`artist`, `oc`, `content_official`, …). Both are keyed here, normalised
 * through `tagCategory()`, so a category means one colour everywhere.
 *
 * `general` is deliberately uncoloured. It is the default category and by far
 * the largest, so colouring it would tint most of every tag cloud and leave the
 * genuinely distinct categories with nothing to stand out against.
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
 * Chip classes for a category: the accent container plus its ink, or the
 * neutral surface pair. Both halves come from the same token so a call site
 * cannot pair a fill with the wrong text colour.
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
 * Tailwind's source scanner cannot follow. The generated utilities are kept
 * alive by `@source inline(...)` at the top of app/globals.css, next to the
 * token definitions themselves.
 */
