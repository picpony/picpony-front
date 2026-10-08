/**
 * The palette's plain data: 配色方案 (多色 / 单色), the custom palette's spec, and what a palette's
 * tile is drawn from. A plain module with no imports — `lib/appearance.ts` and `lib/settingsSync.ts`
 * (client), `app/layout.tsx` (server) and `lib/paletteRule.ts` (the recipe, which is HCT) all read
 * these, and the recipe is the one of the four that must never be imported to read them: that
 * would put HCT in every route that reads a preference.
 */

/**
 * The brand seed: the default theme's light fill, and — with `BRAND_RAMP_SEED` — the origin of the
 * shared numbers the recipe (`lib/paletteRule.ts`) derives. It lives here, in the import-free
 * module, so a client that only needs the colour — the custom palette's starting point in
 * `PaletteSwatches` — reads the one literal without importing HCT; a second copy there survived
 * the documented way of moving the brand (G0-015).
 *
 * **It is no longer a given.** Like the nine characters' fills, the brand's two are decided under
 * direction A (`THEMES` in `scripts/palette.mjs`: the mascot's mane hue, stepped 9.7° toward coral
 * to stay clear of 碧琪; the light register; a tone chosen for the largest area on screen) and
 * `npm run colors` asserts that these two literals are exactly what that decision renders — a
 * literal here that drifts from the rule is a failure, not a second opinion.
 */
export const BRAND_SEED = '#fdcad3';
/** The brand's dark fill: the same decision, `DARK_SHIFT` tones deeper. */
export const BRAND_SEED_DARK = '#fdaebe';
/**
 * The pink the app's ramp chroma is measured from — the mascot's mane, the colour every fill here
 * used to be. `BRAND_CHROMA` (`lib/paletteRule.ts`) is its chroma, and it is the floor under the
 * primary ramp of **every** theme: it must not follow the brand's *fill*, which under direction A
 * is a pale tint whose chroma (the gamut's, at that tone) is a third of what a ramp needs. A
 * theme's fill and its ink are allowed to be very different colours; this is the ink's side.
 */
export const BRAND_RAMP_SEED = '#e06c9f';

/**
 * 配色方案. `multi` adds the theme's second colour (every selection container) and its accent (a
 * few accent moments); `mono` keeps the primary's hue alone, M3's `SchemeTonalSpot`. `multi` is the
 * default, so it is the attribute's *absence* — a visitor with no cookie needs no selector.
 */
export type PaletteHues = 'multi' | 'mono';

export const PALETTE_HUES: readonly PaletteHues[] = ['multi', 'mono'];

export const isPaletteHues = (value: unknown): value is PaletteHues =>
  value === 'multi' || value === 'mono';

/** The `<html>` attribute 单色 is keyed on, present only for `mono`. */
export const HUES_ATTRIBUTE = 'data-palette-hues';

/**
 * How the custom palette's 副色相 is chosen. `null` is 自动 — the right-angle rule; a preset is a
 * relation to the seed's hue (re-derived from the seed, so it moves with it); a number is a hue the
 * user named, 0–359, taken at its word. One hue: the second colour and the accent share it.
 */
export type AccentPreset = 'analogous' | 'triadic' | 'complement';
export type AccentChoice = null | AccentPreset | number;

export const ACCENT_PRESETS: readonly AccentPreset[] = ['analogous', 'triadic', 'complement'];

const isPreset = (value: unknown): value is AccentPreset =>
  value === 'analogous' || value === 'triadic' || value === 'complement';

/**
 * An accent from anything stored — a cookie's tail, an attribute, the account's
 * `themeCustomAccent`. `undefined` for a value that is not one, which a caller reads as 自动.
 */
export function parseAccent(value: unknown): AccentChoice | undefined {
  if (value === null) return null;
  if (isPreset(value)) return value;
  const n = typeof value === 'string' && /^\d{1,3}$/.test(value) ? Number(value) : value;
  return typeof n === 'number' && Number.isInteger(n) && n >= 0 && n < 360 ? n : undefined;
}

export const sameAccent = (a: AccentChoice, b: AccentChoice) => a === b;

/** The custom palette as stored: its seed, which **is** `primary`, and its 副色相. */
export interface CustomSpec {
  seed: string;
  accent: AccentChoice;
}

/**
 * The stored form, in `LS_KEYS.paletteCustom` and `COOKIE_KEYS.paletteCustom`: the seed, then a
 * slash and the accent when it is not 自动 — `#e06c9f`, `#e06c9f/triadic`, `#e06c9f/272`. A
 * cookie's characters, no escaping. The seed alone is what every earlier build wrote, and it still
 * reads, as 自动.
 */
const SPEC = /^(#[0-9a-f]{6})(?:\/(analogous|triadic|complement|\d{1,3}))?$/;

export function parseCustomSpec(value: unknown): CustomSpec | null {
  if (typeof value !== 'string') return null;
  const match = SPEC.exec(value.trim().toLowerCase());
  if (!match) return null;
  const accent = match[2] === undefined ? null : parseAccent(match[2]);
  return accent === undefined ? null : { seed: match[1]!, accent };
}

export const formatCustomSpec = ({ seed, accent }: CustomSpec): string =>
  accent === null ? seed : `${seed}/${accent}`;

export const sameCustomSpec = (a: CustomSpec | null, b: CustomSpec | null) =>
  a === b || (a !== null && b !== null && a.seed === b.seed && sameAccent(a.accent, b.accent));

/* --- What a palette's tile is drawn from ------------------------------------ */

/** A theme's bar in one scheme: its `primary` and the ink over it. */
export interface PaletteTone {
  primary: string;
  onPrimary: string;
}

/**
 * One scheme of a theme's miniature (`components/PaletteTileFace.tsx`), in both 配色方案: the page
 * it is drawn on, what a selection wears there, and — under 多色 — the accent as a mark. Hexes,
 * because a tile shows a theme that is not the one in force, and every token is the active one's.
 */
export interface FaceScheme {
  /** The page: the theme's `surface-container-lowest` (see `themeFace` for why that step). */
  page: string;
  /** What a selection wears: the theme's `secondary-container` — the second colour, under 多色. */
  pick: string;
  /** The accent as a mark: `tertiary`. 多色 only. */
  accent: string;
  /** 单色's page and selection (the page differs only where 多色 has neutrals of its own). */
  monoPage: string;
  monoPick: string;
}

export interface ThemeFace {
  light: FaceScheme;
  dark: FaceScheme;
}

/** Everything a palette's tile is drawn from: the bar per scheme and the face per scheme. */
export interface CustomTones {
  light: PaletteTone;
  dark: PaletteTone;
  face: ThemeFace;
}

const FACE_FIELDS = ['page', 'pick', 'accent', 'monoPage', 'monoPick'] as const;
const TONE_FIELDS = ['primary', 'onPrimary'] as const;
const SCHEMES = ['light', 'dark'] as const;
const TONE_COUNT = SCHEMES.length * (TONE_FIELDS.length + FACE_FIELDS.length);

/**
 * A custom palette's tile, as the one string `data-palette-tones` carries on `<html>`: fill and ink
 * light, fill and ink dark, then the face's five per scheme, light first — fourteen hexes. Written
 * by `applyCustomPalette` and at SSR by `app/layout.tsx`, both through this function.
 */
export const packTones = (t: CustomTones): string =>
  [
    ...SCHEMES.flatMap((s) => TONE_FIELDS.map((f) => t[s][f])),
    ...SCHEMES.flatMap((s) => FACE_FIELDS.map((f) => t.face[s][f])),
  ].join(' ');

/** The reverse, or null for anything that is not fourteen hexes. */
export function unpackCustomTones(value: string | null | undefined): CustomTones | null {
  const parts = (value ?? '').split(' ');
  if (parts.length !== TONE_COUNT || !parts.every((p) => /^#[0-9a-f]{6}$/i.test(p))) return null;
  let at = 0;
  const take = <K extends string>(fields: readonly K[]) =>
    Object.fromEntries(fields.map((f) => [f, parts[at++]])) as Record<K, string>;
  const light = take(TONE_FIELDS);
  const dark = take(TONE_FIELDS);
  return { light, dark, face: { light: take(FACE_FIELDS), dark: take(FACE_FIELDS) } };
}
