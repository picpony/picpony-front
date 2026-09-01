/**
 * The palette recipe: a character's own two hexes in, a whole M3 scheme out.
 * Derivation only — no filesystem, no assertions, no report; AGENTS.md's
 * "The palette axis" section carries the history and the ten-theme table.
 *
 * A PLAIN MODULE: no `'use client'`, no framework imports. Three consumers agree
 * by construction — `scripts/palette.mjs` (builds the ten built-in themes, writes
 * the CSS), `app/layout.tsx` (derives the custom theme at SSR, so its declarations
 * are in the first byte), `lib/paletteLazy.ts` (re-derives in the browser on a new
 * hex). The basis is **HCT**, the space M3 quotes its numbers in.
 *
 * `primary` is not derived. It is a colour someone drew: two literal hexes from
 * the MLP-VectorClub colour guide — the coat **Fill** for light, the same
 * surface's Shadow Fill for dark (cite the Fill row, not the Outline); nothing
 * computes or rounds them, and `npm run colors` emits them byte for byte. The
 * Shadow Fill is why dark needs no rule either: one surface in two lights, which
 * is what `primary` is specified to be (it does not invert; see globals.css).
 *
 * The primary *ramp* is built from the light hex's hue at a chroma decided by
 * `rampChroma`, **measured at `CHROMA_REFERENCE_TONE`, not at the fill's own
 * tone** — a pale fill sits where the gamut is narrow, so reading chroma there
 * muddies the palette (ASSERTION 6: every `primary-ink` has chroma ≥ 35) — so a
 * theme's fill and its ink may be very different colours: surface vs mark.
 */

import {
  Hct,
  QuantizerCelebi,
  Score,
  TonalPalette,
  argbFromHex,
  hexFromArgb,
} from '@material/material-color-utilities';

/** The brand seed. The default theme's light fill, and the origin of the shared numbers. */
export const BRAND_SEED = '#e06c9f';
/** The brand's dark fill. Not a shadow value — the brand has no artwork, so it is given. */
export const BRAND_SEED_DARK = '#cb5b8d';

export const hctOf = (hex: string) => Hct.fromInt(argbFromHex(hex));

const brandSeed = hctOf(BRAND_SEED);

/** The most chroma sRGB can hold at a hue and tone — HCT gamut-maps to the ceiling. */
export const maxChroma = (hue: number, tone: number) => Hct.from(hue, 200, tone).chroma;

/** A colour from its three HCT coordinates, gamut-mapped — the picker's whole vocabulary. */
export const hexFromHct = (hue: number, chroma: number, tone: number) =>
  hexFromArgb(Hct.from(hue, chroma, tone).toInt()).toLowerCase();

/** A hue difference, brought into (−180, 180] so a wrap at 360 cannot become a rotation. */
export const norm180 = (d: number) => ((((d + 180) % 360) + 360) % 360) - 180;

/* --- Chroma --------------------------------------------------------------- */

/** Where a ramp's chroma is measured: the brand's own tone. Read the header before changing. */
export const CHROMA_REFERENCE_TONE = 61;

/** Ramp chroma in HCT: the brand seed's own — ceiling on the shared, floor on the character's. */
export const BRAND_CHROMA = brandSeed.chroma;

/**
 * The chroma of a theme's primary ramp, from its light fill: the brand's own as
 * floor, **tapering to zero as the fill runs out of hue** (inert at/above
 * `MIN_SEED_CHROMA`, so built-ins are untouched) — the taper is what lets a
 * grey be a theme: near-monochrome, not a grey bar over a randomly-hued ramp.
 */
export const rampChroma = (hue: number, fillChroma: number) => {
  const hueConfidence = Math.min(1, fillChroma / MIN_SEED_CHROMA);
  const floor = Math.min(BRAND_CHROMA, maxChroma(hue, CHROMA_REFERENCE_TONE)) * hueConfidence;
  return Math.max(fillChroma, floor);
};

/** M3 `SchemeTonalSpot`'s neutral chroma. */
export const NEUTRAL_CHROMA = 6;

/**
 * The harmony, verbatim from M3's `SchemeTonalSpot` — secondary chroma 16,
 * tertiary hue+60° chroma 24, neutral chroma 6, neutralVariant chroma 8.
 * The chroma stays flat even though `primary`'s no longer is: M3 pairs constant
 * secondary 16 with constant primary 36, and a proportional secondary would not
 * be M3 — a focus ring that gets louder on the more saturated themes answers a
 * question about the brand, not the keyboard.
 *
 * `paletteSet` writes `hue + 60` raw where the library sanitises first — inert,
 * since every emitted colour goes through `Hct.from` → `HctSolver.solveToInt`
 * and nothing reads the un-normalised hue field. **ASSERTION 8 compares this
 * whole set against a real `SchemeTonalSpot`**: drifting from these numbers is
 * a failing check, not a style choice.
 */
export const HARMONY = {
  secondary: { dHue: 0, chroma: 16 },
  tertiary: { dHue: 60, chroma: 24 },
  neutralVariant: { dHue: 0, chroma: 8 },
};

/**
 * The semantic ramps. Their hues are their meaning, so they are absolute and
 * every theme shares them: a severity that changes colour with the user's theme
 * is not a severity. `error` deliberately diverges from M3's spec (hue 22 /
 * chroma 67.2 vs the spec's 25/84) so it does not out-shout the success/warning
 * pair, which has no M3 equivalent — the three are tuned as a set.
 */
export const SEMANTIC = {
  error: '#a62a2c',
  success: '#256f3b',
  warning: '#7f5400',
};

const fromHex = (hex: string) => {
  const m = hctOf(hex);
  return TonalPalette.fromHueAndChroma(m.hue, m.chroma);
};

export type PaletteName =
  | 'primary'
  | 'secondary'
  | 'tertiary'
  | 'neutral'
  | 'neutralVariant'
  | 'error'
  | 'success'
  | 'warning';

/* --- No style axis: an image gives seeds, installed verbatim as `primary` ---
 * A wallpaper style decides `primary` at a dark P40/P80 and three of five don't
 * keep the seed's hue, so no option is the colour in the picture. `deriveTheme`
 * below is the one rule: 从图片取色 and 选择颜色 differ only in how the hex is named.
 * ------------------------------------------------------------------------ */

/** The one recipe. Every ramp a theme has, from a hue and a chroma. */
export function paletteSet(hue: number, chroma: number): Record<PaletteName, TonalPalette> {
  return {
    primary: TonalPalette.fromHueAndChroma(hue, chroma),
    secondary: TonalPalette.fromHueAndChroma(hue + HARMONY.secondary.dHue, HARMONY.secondary.chroma),
    tertiary: TonalPalette.fromHueAndChroma(hue + HARMONY.tertiary.dHue, HARMONY.tertiary.chroma),
    neutral: TonalPalette.fromHueAndChroma(hue, NEUTRAL_CHROMA),
    neutralVariant: TonalPalette.fromHueAndChroma(
      hue + HARMONY.neutralVariant.dHue,
      HARMONY.neutralVariant.chroma,
    ),
    error: fromHex(SEMANTIC.error),
    success: fromHex(SEMANTIC.success),
    warning: fromHex(SEMANTIC.warning),
  };
}

/* --- Contrast: up here because the ink tones below are *derived* from it ---- */

export const luminance = (hex: string) => {
  const ch = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  const lin = ch.map((c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * lin[0] + 0.7152 * lin[1] + 0.0722 * lin[2];
};

export const contrast = (a: string, b: string) => {
  const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
};

/* --- The three things still derived from the two fills --------------------- */

export const WHITE_INK_BAR = 3; // WCAG 1.4.11: a non-text graphic. The wordmark and glyphs are one.
export const LIGHT_INK = 2.9; // the default's own 2.94, floored

/**
 * A mark on the dark page — tone 6 — needs WCAG 1.4.11's 3:1. Governs
 * `primary-ink` in dark and the custom palette's derived dark fill; deliberately
 * not a built-in theme's dark fill (three Shadow Fills land at tone 20–26, a
 * knowing divergence — lifting them once made a dark bar lighter than its light
 * one, a defect this repo has shipped before).
 */
export const DARK_SEPARATION = 3;

/** Only the custom palette uses this: one hex in, so its dark fill has to come from somewhere. */
export const DARK_SHIFT = 7;

export interface BrandTones {
  /** `primary`, light scheme. */
  light: string;
  /** `primary`, dark scheme. */
  dark: string;
  /** `on-primary`. One value: it does not flip between schemes, because `primary` does not. */
  onPrimary: string;
  inkLight: string;
  inkDark: string;
}

/**
 * `on-primary`, and the two ink values.
 *
 *   on-primary   white where white clears 3:1 on both bars, else tone 20 — one
 *                ink per theme, never flipping between schemes.
 *   ink, light   the lightest tone at or below the light fill's that still makes
 *                `LIGHT_INK` against this theme's own surface.
 *   ink, dark    the darkest tone at or above the dark fill's that still makes
 *                `DARK_SEPARATION` against this theme's own dark surface. It
 *                walks *up* where the fill is allowed not to, keeping a mark
 *                legible on the bars that deliberately have no edge.
 */
function inkTones(
  palettes: Record<PaletteName, TonalPalette>,
  light: string,
  dark: string,
): BrandTones {
  const p = (t: number) => hexFromArgb(palettes.primary.tone(t)).toLowerCase();
  const surfaceLight = hexFromArgb(palettes.neutral.tone(98)).toLowerCase();
  const surfaceDark = hexFromArgb(palettes.neutral.tone(6)).toLowerCase();

  const white =
    contrast('#ffffff', light) >= WHITE_INK_BAR && contrast('#ffffff', dark) >= WHITE_INK_BAR;

  let inkLight = Math.round(hctOf(light).tone);
  while (inkLight > 10 && contrast(p(inkLight), surfaceLight) < LIGHT_INK) inkLight -= 1;

  let inkDark = Math.round(hctOf(dark).tone);
  while (inkDark < 95 && contrast(p(inkDark), surfaceDark) < DARK_SEPARATION) inkDark += 1;

  const ink = white ? '#ffffff' : p(20);
  return {
    light,
    dark,
    onPrimary: ink,
    inkLight: p(inkLight),
    inkDark: p(inkDark),
  };
}

/* --- The role → tone map --------------------------------------------------- */

type ToneSpec =
  | number
  | 'primary-light'
  | 'primary-dark'
  | 'on-primary'
  | 'ink-light'
  | 'ink-dark';
export type Role = readonly [token: string, palette: PaletteName, light: ToneSpec, dark: ToneSpec];

/**
 * Verbatim from AOSP's generated `ColorLightTokens.kt` / `ColorDarkTokens.kt`
 * (VERSION v0_210); only the roles this app declares are listed. Five entries
 * are names rather than tones — `primary` and `on-primary` are literal hexes,
 * the two inks are solved against contrast.
 */
export const ROLES: readonly Role[] = [
  // token,                     palette,          light,             dark
  ['primary',                   'primary',        'primary-light',   'primary-dark'],
  /* One value on purpose: `primary` does not invert between schemes, so a filled
     button cannot read as two different components depending on the scheme. */
  ['on-primary',                'primary',        'on-primary',      'on-primary'],
  ['primary-container',         'primary',        90,                30],
  ['on-primary-container',      'primary',        10,                90],
  ['inverse-primary',           'primary',        80,                40],
  /* The brand as *ink* — a mark, never lighter than the brand in light, never
     darker in dark. Fill and ink may differ: one is a surface, one a mark. */
  ['primary-ink',               'primary',        'ink-light',       'ink-dark'],
  /* Navigable text: the brand hue at a text tone. Prose links carry a rest-state
     underline so the affordance no longer rests on hue alone. */
  ['link',                      'primary',        40,                80],
  ['link-hover',                'primary',        35,                85],

  ['secondary',                 'secondary',      40,                80],
  ['on-secondary',              'secondary',      100,               20],
  ['secondary-container',       'secondary',      90,                30],
  ['on-secondary-container',    'secondary',      10,                90],

  ['tertiary',                  'tertiary',       40,                80],
  ['on-tertiary',               'tertiary',       100,               20],
  ['tertiary-container',        'tertiary',       90,                30],
  ['on-tertiary-container',     'tertiary',       10,                90],

  ['error',                     'error',          40,                80],
  ['on-error',                  'error',          100,               20],
  ['error-container',           'error',          90,                30],
  ['on-error-container',        'error',          10,                90],

  // Not M3 slots; the app needs them and generates them the same way.
  ['success',                   'success',        40,                80],
  ['on-success',                'success',        100,               20],
  ['success-container',         'success',        90,                30],
  ['on-success-container',      'success',        10,                90],
  ['warning',                   'warning',        40,                80],
  ['on-warning',                'warning',        100,               20],
  ['warning-container',         'warning',        90,                30],
  ['on-warning-container',      'warning',        10,                90],

  ['surface',                   'neutral',        98,                6],
  ['surface-dim',               'neutral',        87,                6],
  ['surface-bright',            'neutral',        98,                24],
  ['surface-container-lowest',  'neutral',        100,               4],
  ['surface-container-low',     'neutral',        96,                10],
  ['surface-container',         'neutral',        94,                12],
  ['surface-container-high',    'neutral',        92,                17],
  ['surface-container-highest', 'neutral',        90,                22],
  ['on-surface',                'neutral',        10,                90],
  ['inverse-surface',           'neutral',        20,                90],
  ['inverse-on-surface',        'neutral',        95,                20],

  ['on-surface-variant',        'neutralVariant', 30,                80],
  ['outline',                   'neutralVariant', 50,                60],
  ['outline-variant',           'neutralVariant', 80,                30],
];

/**
 * Which of those roles a *non-default* theme overrides.
 *
 * The five brand-and-surface palettes rotate with the seed; the three semantic
 * ones do not, so their twelve roles are emitted once — by the default theme in
 * globals.css — and inherited, which is why a generated block can be a partial
 * override. Roles reached through a var() indirection are deliberately absent:
 * re-emitting them would freeze the indirection at generate time.
 */
const THEMED_PALETTES = new Set<PaletteName>([
  'primary',
  'secondary',
  'tertiary',
  'neutral',
  'neutralVariant',
]);
export const THEMED_ROLES: readonly Role[] = ROLES.filter(([, palette]) =>
  THEMED_PALETTES.has(palette),
);

/* --- The whole derivation, in one call ------------------------------------- */

export interface ThemeMeta extends BrandTones {
  hue: number;
  /** The chroma of the primary ramp, measured at `CHROMA_REFERENCE_TONE`. */
  chroma: number;
  /** The light fill's own chroma, which the ramp's is a floor over. */
  fillChroma: number;
  toneLight: number;
  toneDark: number;
  /** True when the dark fill was derived rather than given — the custom palette's case. */
  derivedDark: boolean;
}

export interface DerivedTheme {
  meta: ThemeMeta;
  light: Record<string, string>;
  dark: Record<string, string>;
}

/**
 * The dark fill for a theme that has only one hex — the custom palette: seven
 * tones down, then lightened until it clears the dark page. The floor applies
 * here where it does not for a built-in theme, whose dark value is a colour
 * someone chose — a colour nobody chose is not owed the same latitude.
 */
function deriveDarkFill(palettes: Record<PaletteName, TonalPalette>, lightTone: number): string {
  const p = (t: number) => hexFromArgb(palettes.primary.tone(t)).toLowerCase();
  const surfaceDark = hexFromArgb(palettes.neutral.tone(6)).toLowerCase();
  let tone = Math.round(lightTone) - DARK_SHIFT;
  while (tone < 95 && contrast(p(tone), surfaceDark) < DARK_SEPARATION) tone += 1;
  return p(tone);
}

/**
 * Every role in `ROLES`, both schemes.
 *
 * `lightHex` **is** primary in light — a character's coat Fill, the hex the user
 * named, or a seed lifted from an image: one rule, no exception. `darkHex` is
 * the Shadow Fill where there is an artist to ask; otherwise `deriveDarkFill`.
 */
export function deriveTheme(lightHex: string, darkHex?: string): DerivedTheme {
  const light = lightHex.toLowerCase();
  const f = hctOf(light);
  const chroma = rampChroma(f.hue, f.chroma);
  const palettes = paletteSet(f.hue, chroma);

  const derivedDark = !darkHex;
  const dark = (darkHex ?? deriveDarkFill(palettes, f.tone)).toLowerCase();
  const brand = inkTones(palettes, light, dark);

  const named: Record<string, string> = {
    'primary-light': brand.light,
    'primary-dark': brand.dark,
    'on-primary': brand.onPrimary,
    'ink-light': brand.inkLight,
    'ink-dark': brand.inkDark,
  };

  const out = { light: {} as Record<string, string>, dark: {} as Record<string, string> };
  for (const [token, palette, lightTone, darkTone] of ROLES) {
    for (const [scheme, raw] of [
      ['light', lightTone],
      ['dark', darkTone],
    ] as const) {
      out[scheme][token] =
        typeof raw === 'number'
          ? hexFromArgb(palettes[palette].tone(raw)).toLowerCase()
          : named[raw];
    }
  }

  return {
    meta: {
      ...brand,
      hue: f.hue,
      chroma,
      fillChroma: f.chroma,
      toneLight: hctOf(brand.light).tone,
      toneDark: hctOf(brand.dark).tone,
      derivedDark,
    },
    light: out.light,
    dark: out.dark,
  };
}

/**
 * The two CSS blocks for one palette id, in the exact shape
 * `app/theme-palettes.css` carries, so generated and runtime-injected blocks
 * cannot diverge. The selectors carry html on purpose: `@import` must precede
 * any rule, so the generated blocks land above `:root` at equal specificity —
 * source order would decide, and wrongly.
 */
export function paletteBlocksCss(id: string, derived: DerivedTheme, indent = ''): string {
  const out: string[] = [];
  for (const [selector, scheme] of [
    [`html[data-palette='${id}']`, 'light'],
    [`html.dark[data-palette='${id}']`, 'dark'],
  ] as const) {
    out.push(`${indent}${selector} {`);
    for (const [token] of THEMED_ROLES) {
      out.push(`${indent}  --md-sys-color-${token}: ${derived[scheme][token]};`);
    }
    out.push(`${indent}}`);
  }
  return out.join('\n');
}

/* --- The custom palette ---------------------------------------------------- */

/** The eleventh palette's `data-palette` value. Its colours are per-user, not generated. */
export const CUSTOM_PALETTE = 'custom';

/**
 * The chroma at which a fill is taken to assert a hue, in two places. For a
 * **built-in** theme it is a hard bar — a fill must define a hue (ASSERTION 4,
 * `scripts/palette.mjs`; it is why two characters take a feature other than
 * their coat). For the **user's** colour it is no bar — it is where
 * `rampChroma`'s taper saturates: a person choosing grey is not making a
 * mistake, and what a grey becomes is a near-monochrome scheme, a real M3 variant.
 */
export const MIN_SEED_CHROMA = 15;

const HEX = /^#[0-9a-f]{6}$/i;

/** Normalises a user-supplied seven-character hex, or returns null. The seed is
 * mirrored in `LS_KEYS.paletteCustom` and `COOKIE_KEYS.paletteCustom`
 * (`lib/constants.ts`), which this plain module does not import. */
export function normalizeCustomSeed(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const hex = value.trim().toLowerCase();
  return HEX.test(hex) ? hex : null;
}

/**
 * The candidate theme colours in an image — Monet's own extraction, then one
 * guard of ours.
 *
 * The extraction is two library calls: `QuantizerCelebi` reduces the pixels to a
 * palette with populations, and `Score` ranks them as theme sources. `Score`'s
 * arithmetic (from `score.js`) matters:
 *
 *   - proportion contributes `proportion × 100 × WEIGHT_PROPORTION` (0.7),
 *     where the proportion is a 30° hue-neighbourhood share — a colour is
 *     credited for the company it keeps.
 *   - chroma contributes `(chroma − TARGET_CHROMA) × w`, and **`w` is
 *     asymmetric**: 0.3 above the target of 48, 0.1 below it.
 *   - the filter drops `chroma < CUTOFF_CHROMA` (5) **and** `proportion ≤
 *     CUTOFF_EXCITED_PROPORTION` (0.01) — the second one is the trap below.
 *   - the hue spread is a **sweep**, 90° down to 15°: the first bar that yields
 *     `desired` candidates wins; if none does, it returns **fewer**.
 *
 * **The guard is the empty-result case: AOSP's answer is a colour that is not
 * in the picture** — when the filter leaves nothing, `Score` returns its own
 * fallback (Google Blue), which here would silently paint the app bar a blue
 * nobody chose. A chroma-only test is not sufficient: the 0.01 proportion
 * cutoff is reachable with plenty of chroma present (a small saturated subject
 * in a large frame). So the test is *identity* — every real candidate is a key
 * of the quantised map (`Score`'s ARGB round-trips through `Hct.fromInt`), and
 * the fallback is not. Where nothing survives, the image's own most populous
 * tones are offered instead, 12 tones apart — a greyscale photograph has a
 * perfectly good theme here, since `rampChroma` tapers its floor away.
 *
 * The caller downsamples; see `SAMPLE_AREA` in `lib/paletteLazy.ts`.
 */
export function sourceColorsFromPixels(pixels: Uint8ClampedArray, desired = 4): string[] {
  /* ARGB, and only the opaque pixels: a transparent PNG's empty region is not a
     colour, and quantising it drags every candidate toward the clear colour. */
  const argb: number[] = [];
  for (let i = 0; i < pixels.length; i += 4) {
    if (pixels[i + 3] < 255) continue;
    argb.push((255 << 24) | (pixels[i] << 16) | (pixels[i + 1] << 8) | pixels[i + 2]);
  }
  if (argb.length === 0) return [];
  const quantised = QuantizerCelebi.quantize(argb, 128);

  /* AOSP's ranking, with anything that did not come out of this image dropped —
     which is the fallback, and only the fallback. See the header. */
  const ranked = Score.score(quantised, { desired }).filter((n) => quantised.has(n));
  if (ranked.length > 0) return ranked.map((n) => hexFromArgb(n).toLowerCase());

  const byPopulation = [...quantised.entries()].sort((a, b) => b[1] - a[1]);
  const picked: Hct[] = [];
  for (const [n] of byPopulation) {
    const hct = Hct.fromInt(n);
    if (picked.some((p) => Math.abs(p.tone - hct.tone) < 12)) continue;
    picked.push(hct);
    if (picked.length >= desired) break;
  }
  return picked.map((h) => hexFromArgb(h.toInt()).toLowerCase());
}

/**
 * `deriveTheme` behind a bounded memo, for the server: the layout renders more
 * than once per page view under `<Link>` prefetching. Pure function, so plain
 * memoisation — no TTL; the cap stops a hostile cookie growing an unbounded map
 * (insertion order evicts).
 */
const derivedCache = new Map<string, DerivedTheme>();
const DERIVED_CACHE_MAX = 64;

export function deriveThemeCached(lightHex: string, darkHex?: string): DerivedTheme {
  const key = `${lightHex}|${darkHex ?? ''}`;
  const hit = derivedCache.get(key);
  if (hit) return hit;
  const derived = deriveTheme(lightHex, darkHex);
  derivedCache.set(key, derived);
  if (derivedCache.size > DERIVED_CACHE_MAX) {
    derivedCache.delete(derivedCache.keys().next().value as string);
  }
  return derived;
}
