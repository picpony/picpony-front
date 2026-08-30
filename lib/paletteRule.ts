/**
 * The palette recipe: a character's own two hexes in, a whole M3 scheme out.
 *
 * This is the derivation only — no filesystem, no assertions, no report. Three consumers
 * import it and they must agree by construction rather than by discipline:
 *
 *   - `scripts/palette.mjs` builds the ten built-in themes and writes the CSS.
 *   - `app/layout.tsx` derives the *user's* custom theme at SSR, so its 60 declarations
 *     are in the first byte and a cold load never flashes the default brand.
 *   - `lib/paletteLazy.ts` derives it again in the browser when the user picks a new hex.
 *
 * So it carries no `'use client'` and imports nothing framework-shaped. The only
 * dependency is `@material/material-color-utilities`, which is where HCT lives.
 *
 * The basis is **HCT**, not OKLCH, because HCT is the space M3's own numbers are quoted
 * in: "neutral chroma 6" means 6 in HCT. HCT also gamut-maps by holding hue and tone and
 * dropping chroma, which is precisely the invariant the ramps need.
 *
 * ---------------------------------------------------------------------------
 * `primary` is not derived. It is a colour someone drew.
 *
 * Every theme is **two literal hexes from the MLP-VectorClub colour guide**: the
 * character's coat Fill for the light scheme, and the *same surface's Shadow Fill* for the
 * dark one. Nothing computes them, nothing rounds them, and `npm run colors` emits them
 * byte for byte.
 *
 * That is the third answer to this problem and it is the one that stuck. The first took
 * the seed's own tone, which is a property of the **artwork** rather than of the design
 * system — a pony is drawn pale so a black outline reads against it — and scattered the
 * ten across tones 37–90 with no rule behind the scatter. The second replaced it with a
 * rule: hue from the seed, tone from Material's own 500 row, chroma held to the brand's.
 * That produced a defensible set and a series of ugly yellows, because at every tone that
 * rule was willing to visit, a yellow is either mud (desaturated, mid tone) or a shout
 * (saturated, high tone). The colour that finally looked right was `#FAF5AB` — Fluttershy's
 * actual coat, which an artist chose.
 *
 * So the rule stopped trying to *decide* the brand fill and started *reading* it. What is
 * left to derive is everything the guide does not contain: the surfaces, the harmony, the
 * containers, the ink, and which of white or a dark tone goes on top.
 *
 * **The Shadow Fill is why the dark scheme needs no rule either.** Shading is the artist
 * already answering "this same material, one step deeper", so the pair is guaranteed to
 * read as one surface in two lights — which is exactly what `primary` is specified to be
 * here (it does not invert between schemes; see globals.css). A tone shift computed from
 * the light value would be a second opinion about a question already answered.
 *
 * ---------------------------------------------------------------------------
 * What is derived, and the one number that matters
 *
 * The primary *ramp* — every tone other than the two pinned ones — is built from the light
 * hex's hue at a chroma decided by `rampChroma`, and **that chroma is measured at
 * `CHROMA_REFERENCE_TONE`, not at the fill's own tone.** This is the single non-obvious
 * line in the file, and it was found by shipping the alternative.
 *
 * A pale fill is pale because it sits where the gamut is *narrow*: `#FAF5AB` is chroma 30
 * at tone 95, where only 62 is available, while at tone 61 the same hue holds 67. Reading
 * the ramp's chroma at the fill's own tone therefore built the whole primary palette at
 * chroma 20 for a tint, and `primary-ink` — the colour of every glyph, tab indicator,
 * checkbox and focused field outline in the app — came out `#a69166`, a khaki-grey.
 * Measured at tone 61 instead, that theme's ink is `#9c9700`, a clean gold. Across the ten
 * the inks now run chroma 40–79 with no muddy member.
 *
 * The consequence to keep in mind: a theme's *fill* and its *ink* are allowed to be very
 * different colours. 小蝶's bar is a cream and her ink is a gold. That is correct — they
 * answer different questions, one about a surface and one about a mark — and it is what
 * lets a pale-coated character have a usable theme at all.
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

/**
 * The most chroma sRGB can hold at a hue and a tone.
 *
 * HCT gamut-maps by holding hue and tone and dropping chroma, so asking for far more than
 * exists returns the ceiling. That ceiling is why a hue's identity is a function of its
 * lightness — at tone 50 a violet reaches 88 and a teal only 40 — and it is why a pale
 * fill is automatically a tint.
 */
export const maxChroma = (hue: number, tone: number) => Hct.from(hue, 200, tone).chroma;

/**
 * A colour from its three HCT coordinates, gamut-mapped. The picker's whole vocabulary:
 * every cell it offers is one of these, so it can never present a colour the browser will
 * then clip to something else.
 */
export const hexFromHct = (hue: number, chroma: number, tone: number) =>
  hexFromArgb(Hct.from(hue, chroma, tone).toInt()).toLowerCase();

/** A hue difference, brought into (−180, 180] so a wrap at 360 cannot become a rotation. */
export const norm180 = (d: number) => ((((d + 180) % 360) + 360) % 360) - 180;

/* ---------------------------------------------------------------------------
 * Chroma
 * ------------------------------------------------------------------------ */

/**
 * Where a ramp's chroma is measured: the brand's own tone.
 *
 * A constant rather than the fill's tone, for the reason in the header — read it before
 * changing this, because the failure it prevents is invisible in the app bar and obvious
 * in every icon on the screen.
 */
export const CHROMA_REFERENCE_TONE = 61;

/**
 * The colourfulness a ramp is held to, in HCT: the brand seed's own, 56.8.
 *
 * A *ceiling* on the shared value and a *floor* under the character's own, so it can never
 * desaturate a character already more colourful than the brand (碧琪 keeps 79.4) and never
 * lets a pale one produce a grey ramp.
 */
export const BRAND_CHROMA = brandSeed.chroma;

/**
 * The chroma of a theme's primary ramp, from its light fill.
 *
 * The floor is the brand's own, and it **tapers away as the fill runs out of hue**. That
 * taper is what lets a grey be a theme. Without it the floor is unconditional, so
 * `#808080` — chroma 2, whose hue is whatever 8-bit rounding left behind — produced a grey
 * bar over a fully saturated ramp: a random-hued `primary-ink`, containers and links, from
 * a colour with no hue in it. Two greys that look identical to the eye would have given two
 * completely different themes.
 *
 * Above `MIN_SEED_CHROMA` the taper is inert, so every built-in theme is untouched — the
 * least colourful fill in the set is 小蝶's coat at chroma 29.8. Below it the ramp falls off
 * linearly with the fill, which lands a grey on a near-monochrome scheme. That is M3's own
 * `SchemeMonochrome` reached from the other direction, and it is the honest answer to a
 * colour that has nothing to rotate a palette by.
 */
export const rampChroma = (hue: number, fillChroma: number) => {
  const hueConfidence = Math.min(1, fillChroma / MIN_SEED_CHROMA);
  const floor = Math.min(BRAND_CHROMA, maxChroma(hue, CHROMA_REFERENCE_TONE)) * hueConfidence;
  return Math.max(fillChroma, floor);
};

/** M3 `SchemeTonalSpot`'s neutral chroma. */
export const NEUTRAL_CHROMA = 6;

/**
 * The harmony, verbatim from M3's `SchemeTonalSpot`.
 *
 *     secondaryPalette:      TonalPalette.fromHueAndChroma(hue,        16.0)
 *     tertiaryPalette:       TonalPalette.fromHueAndChroma(hue + 60.0, 24.0)
 *     neutralPalette:        TonalPalette.fromHueAndChroma(hue,         6.0)
 *     neutralVariantPalette: TonalPalette.fromHueAndChroma(hue,         8.0)
 *
 * These used to be three hexes reverse-engineered out of globals.css — `#755360`,
 * `#894d1f`, `#7f7378` — held as offsets from the seed so they would rotate with it. That
 * was the right *mechanism* reached for the wrong reason: they were kept because changing
 * them would move the default theme, not because they were correct. Measured against the
 * spec they were secondary chroma 19.4 (21% high), tertiary +57.31° chroma 37.1 (55% high)
 * and neutralVariant −9.48° chroma 6.7 (a 9.5° rotation with no argument behind it at all).
 * Only `neutral` was already exact.
 *
 * Switching to the spec moved eight of the default theme's tokens by a step or two —
 * `outline`, `on-surface-variant` and `outline-variant` among them, which are the two most
 * repeated non-brand colours in the app. That is the cost, and it is paid once.
 *
 * **The chroma is flat, and it stays flat even though `primary`'s no longer is.** M3 pairs
 * a constant secondary 16 with a constant primary 36 — a ratio of 0.44 — while this app's
 * primary ramp runs **45.5–79.4**, so the ratio here lands between **0.202** (碧琪, chroma
 * 79.4) and **0.352** (邪茧, chroma 45.5). Making secondary proportional would restore the
 * ratio and would not be M3: the spec's number is a constant, and a focus ring that gets
 * louder on the more saturated themes is a focus ring answering a question about the brand
 * rather than about the keyboard.
 *
 * `paletteSet` writes `hue + 60` raw where the library calls `sanitizeDegreesDouble` first.
 * That is inert and checked: `TonalPalette.fromHueAndChroma` stores the hue verbatim but every
 * colour it emits goes through `Hct.from` → `HctSolver.solveToInt`, which sanitises. Three of
 * the ten themes do wrap past 360° (default 415.7°, twilight 379.1°, pinkie 419.9°) and their
 * emitted ARGB is byte-identical to the sanitised palette's at every tone. Nothing reads the
 * un-normalised `TonalPalette.hue` field. **ASSERTION 8 compares this whole set against a real
 * `SchemeTonalSpot`**, so a library change cannot pass silently.
 */
export const HARMONY = {
  secondary: { dHue: 0, chroma: 16 },
  tertiary: { dHue: 60, chroma: 24 },
  neutralVariant: { dHue: 0, chroma: 8 },
};

/**
 * The semantic ramps. Their hues are their meaning, so they are absolute and every theme
 * shares them: a severity that changes colour with the user's theme is not a severity. M3
 * agrees and fixes `error` the same way.
 *
 * It does **not** take M3's error values, and that is deliberate rather than an oversight.
 * The spec pins error at hue 25 / chroma 84; this one is hue 22 / chroma 67.2, three degrees
 * away and a quarter less colourful. The three degrees are worth nothing either way — what
 * matters is that `success` (chroma 43.9) and `warning` (chroma 39.0) have **no M3
 * equivalent at all**, because the spec has no such roles. Taking the spec's 84 for the one
 * ramp that has a spec would make the error toast visibly louder than the success toast
 * beside it, which is a severity ordering nobody chose. The three are tuned as a set.
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

/* ---------------------------------------------------------------------------
 * There is no style axis, and that is a decision this file used to get wrong
 *
 * An image-derived theme was a **(seed, style) pair** for one pass, because that is what an
 * AOSP wallpaper option is: `ColorProvider.kt` crosses `styleList = [TONAL_SPOT, SPRITZ,
 * VIBRANT, EXPRESSIVE]` with the seeds `ColorScheme.getSeedColors` ranks out of the
 * wallpaper, splicing MONOCHROMATIC in at index 1. Correctly transcribed, and wrong here.
 *
 * Two things break when a style decides `primary`, and both were measured on the seeds a real
 * photograph yields. A style puts `primary` at M3's own **P40 light / P80 dark**, which is
 * right where `primary` is a mark on a surface and wrong where it fills the app bar; and three
 * of the five styles do not keep the seed's hue at all. For a sunset orange `#e8762c` lifted
 * out of a picture, the five options offered were:
 *
 *     tonalSpot   #8c4e29   a dark brown
 *     neutral     #71594e   a grey-brown
 *     vibrant     #9c4400   a dark rust
 *     expressive  #595799   a purple      (the hue rotated 240°)
 *     monochrome  #5e5e5e   grey
 *
 * Not one of them is the colour in the photograph, and every one is tone 40 — so whichever
 * you picked, the app bar came out dark and muddy. That is "取的色很奇怪", and it is not a
 * tuning problem: it is the style axis doing exactly what it says it does.
 *
 * So an image gives **seeds**, and a seed is installed the way a character's coat Fill is:
 * verbatim, as `primary`. There is one rule in this system, `deriveTheme` below is it, and
 * 从图片取色 and 选择颜色 now differ only in how the hex is named.
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

/* ---------------------------------------------------------------------------
 * Contrast
 *
 * Up here rather than beside the checks that use it, because the ink tones below are
 * *derived* from contrast rather than merely audited against it.
 * ------------------------------------------------------------------------ */

export const luminance = (hex: string) => {
  const ch = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  const lin = ch.map((c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * lin[0] + 0.7152 * lin[1] + 0.0722 * lin[2];
};

export const contrast = (a: string, b: string) => {
  const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
};

/* ---------------------------------------------------------------------------
 * The three things still derived from the two fills
 * ------------------------------------------------------------------------ */

export const WHITE_INK_BAR = 3; // WCAG 1.4.11: a non-text graphic. The wordmark and glyphs are one.
export const LIGHT_INK = 2.9; // the default's own 2.94, floored

/**
 * A mark on the dark page — tone 6 — needs WCAG 1.4.11's 3:1. This governs `primary-ink`
 * in the dark scheme, and, for the custom palette only, where a *derived* dark fill sits.
 *
 * It deliberately does **not** govern a built-in theme's dark fill. Three characters'
 * Shadow Fill lands at tone 20–26 and therefore measures 1.42–1.72:1 against that page, so
 * their app bar has no boundary in dark mode: 邪茧, 露娜, 瑞瑞. That is a knowing
 * divergence, taken because the alternative measured worse — lifting them to tone 42 makes
 * 露娜's *dark* bar lighter than her light one (28 → 41), which is the "three themes came
 * out lighter in dark than in light" defect this repo has already shipped once. The white
 * ink on those bars still measures 10.8–13.1:1, so nothing on them is unreadable; what is
 * lost is the bar's edge against the page, and for a night-sky character that is close to
 * the intent anyway.
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
 *   on-primary   white where white clears 3:1 on **both** bars, else the ramp's tone 20.
 *                One ink per theme, never flipping between schemes — which matters more
 *                now than when the two fills were seven tones apart, because a character's
 *                Fill and Shadow Fill can differ by 24 tones (邪茧).
 *   ink, light   the lightest tone at or below the light fill's that still makes
 *                `LIGHT_INK` against this theme's own `surface`.
 *   ink, dark    the darkest tone at or above the dark fill's that still makes
 *                `DARK_SEPARATION` against this theme's own dark surface. It walks *up*
 *                where the fill is allowed not to, which is what keeps a mark legible on
 *                the three themes whose bar deliberately has no edge.
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

/* ---------------------------------------------------------------------------
 * The role → tone map
 * ------------------------------------------------------------------------ */

type ToneSpec =
  | number
  | 'primary-light'
  | 'primary-dark'
  | 'on-primary'
  | 'ink-light'
  | 'ink-dark';
export type Role = readonly [token: string, palette: PaletteName, light: ToneSpec, dark: ToneSpec];

/**
 * Verbatim from AOSP's generated `ColorLightTokens.kt` / `ColorDarkTokens.kt`, VERSION
 * v0_210. Fetch with:
 *
 *     base=https://android.googlesource.com/platform/frameworks/support/+/refs/heads/\
 *     androidx-main/compose/material3/material3/src/commonMain/kotlin/androidx/compose/material3
 *     curl -s "$base/tokens/ColorLightTokens.kt?format=TEXT" | base64 -d
 *
 * Only the roles this app declares are listed. Five entries are **names** rather than
 * tones, because those five are not positions on a ramp: `primary` and `on-primary` are
 * literal hexes now, and the two inks are solved against contrast.
 */
export const ROLES: readonly Role[] = [
  // token,                     palette,          light,             dark
  ['primary',                   'primary',        'primary-light',   'primary-dark'],
  /* Both columns take the same value on purpose: `primary` does not invert between schemes,
     so one ink per theme, and a `filled` button cannot read as two different components
     depending on the scheme. */
  ['on-primary',                'primary',        'on-primary',      'on-primary'],
  ['primary-container',         'primary',        90,                30],
  ['on-primary-container',      'primary',        10,                90],
  ['inverse-primary',           'primary',        80,                40],
  /* The brand as *ink*. A theme's fill and its ink are allowed to be very different
     colours — 小蝶's bar is a cream and her ink is a gold — because one is a surface and
     the other is a mark. See the header. */
  ['primary-ink',               'primary',        'ink-light',       'ink-dark'],
  /* Navigable text: the brand hue at a text tone. Prose links carry a rest-state underline
     so the affordance no longer rests on hue alone. */
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
 * The five brand-and-surface palettes rotate with the seed; the three semantic ones do
 * not, so their twelve roles are emitted once — in globals.css, by the default theme — and
 * inherited. That inheritance is why a generated block can be a partial override rather
 * than a full scheme.
 *
 * Everything reached through a `var()` indirection is deliberately absent and must stay
 * absent: `surface-raised` points at a container step, and `focus` / `focus-on-primary` /
 * `focus-on-media` point at `secondary` / `on-primary` / `on-media`. Re-emitting them would
 * freeze the indirection at generate time.
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

/* ---------------------------------------------------------------------------
 * The whole derivation, in one call
 * ------------------------------------------------------------------------ */

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
 * The dark fill for a theme that has only one hex — the user's custom palette.
 *
 * A character's Shadow Fill is an artist's answer; there is no artist here, so this is the
 * fallback: seven tones deeper, then lightened until it clears the dark page. The floor
 * applies where it does not for a built-in theme, and the asymmetry is deliberate —
 * `#4a1767` is a colour someone chose for 瑞瑞, and a colour nobody chose is not owed the
 * same latitude.
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
 * `lightHex` **is** `primary` in the light scheme — a character's coat Fill, or the hex the
 * user named, or a seed lifted out of an image. All three are the same case, which is the
 * point: there is one rule here and nothing is an exception to it. `darkHex` is the Shadow
 * Fill where there is an artist to ask; where there is not, `deriveDarkFill` answers.
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
 * The two CSS blocks for one palette id, in the exact shape `app/theme-palettes.css`
 * carries — so the generated file and the runtime-injected custom theme cannot diverge.
 *
 * The selectors carry `html` on purpose. `@import` has to come before any rule, so the
 * generated blocks land *above* `:root` in source order, and `:root` and
 * `[data-palette=x]` are both specificity (0,1,0) — source order would decide, and it
 * would decide wrong. With the element name they are (0,1,1) and (0,2,1), which beats
 * `:root` and `.dark` whatever the order.
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

/* ---------------------------------------------------------------------------
 * The custom palette
 * ------------------------------------------------------------------------ */

/** The eleventh palette's `data-palette` value. Its colours are per-user, not generated. */
export const CUSTOM_PALETTE = 'custom';

/**
 * The chroma at which a fill is taken to assert a hue, in two places.
 *
 * For a **built-in** theme it is a hard bar, asserted by `scripts/palette.mjs`, and it is why
 * two characters take a feature other than their coat: 瑞瑞's is `#BDC1C2` at chroma 4.7 and
 * 邪茧's is `#2A2A2A` at chroma 1.0. Ten themes chosen from a colour guide can afford to
 * insist.
 *
 * For the **user's** colour it is not a bar at all — it is where `rampChroma`'s taper
 * saturates. A grey is a legitimate thing to want a theme to be, and refusing it was the
 * wrong call: the picker's job is to show what a colour becomes, not to argue with it. What
 * a grey becomes is a near-monochrome scheme, which is a real M3 variant.
 */
export const MIN_SEED_CHROMA = 15;

const HEX = /^#[0-9a-f]{6}$/i;

/** Normalises a user-supplied hex, or returns null if it is not one. */
export function normalizeCustomSeed(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const hex = value.trim().toLowerCase();
  return HEX.test(hex) ? hex : null;
}

/**
 * The candidate theme colours in an image — Monet's own extraction, then one guard of ours.
 *
 * The extraction is two library calls and nothing else: `QuantizerCelebi` reduces the pixels to
 * a palette with populations (Wu followed by weighted k-means), and `Score` ranks those by how
 * well each would serve as a theme's source. `Score`'s arithmetic, from `score.js`, since the
 * numbers matter and the summary version of them was wrong here twice:
 *
 *   - proportion contributes `proportion × 100 × WEIGHT_PROPORTION` (0.7), where the proportion
 *     is not the cluster's own share but `hueExcitedProportions[hue]` — the summed share of a
 *     30° neighbourhood, so a colour is credited for the company it keeps.
 *   - chroma contributes `(chroma − TARGET_CHROMA) × w`, and **`w` is asymmetric**: 0.3 above
 *     the target of 48, 0.1 below it. Being more colourful than A1 is rewarded three times as
 *     steeply as being less colourful is penalised.
 *   - the filter drops `chroma < CUTOFF_CHROMA` (5) **and** `proportion ≤
 *     CUTOFF_EXCITED_PROPORTION` (0.01). The second one is the trap below.
 *   - the hue spread is a **sweep**, from 90° down to 15°, taking the first bar that yields
 *     `desired` candidates. 15° is the floor rather than the rule, and if no bar reaches
 *     `desired` it returns **fewer** — so a caller may not assume it gets what it asked for.
 *
 * **The guard is the empty-result case, and it exists because AOSP's answer to it is a colour
 * that is not in the picture.** When the filter leaves nothing, `Score` returns its own
 * `fallbackColorARGB` — Google Blue, `#4285f4` (Monet's is `#1b6ef3`; the two differ). Android
 * can afford that; here it would silently paint the app bar a blue nobody chose.
 *
 * Testing chroma ≥ 5 across the clusters is what this used to do and it is **not sufficient**:
 * the 0.01 proportion cutoff is reachable with plenty of chroma present. Measured on synthetic
 * 128×96 frames of a grey street with a red sign, the sign filtered out — and Google Blue came
 * back — at 0.3% and 0.6% of the frame, and only survived at 1.0%. A photograph with a small
 * saturated subject lands in that band.
 *
 * So the test is *identity*: every real candidate is a **key of the quantised map**
 * (`Score` returns `Hct.fromInt(argb).toInt()`, which round-trips exactly), and the fallback is
 * not. One line, and it covers the no-chroma case and the low-proportion case together. Where
 * nothing survives, the image's own most populous tones are offered instead, spread 12 tones
 * apart — a greyscale photograph has a perfectly good theme here, since `rampChroma` tapers its
 * chroma floor away as a fill runs out of hue.
 *
 * The caller downsamples; see `SAMPLE_AREA` in `lib/paletteLazy.ts`.
 */
export function sourceColorsFromPixels(pixels: Uint8ClampedArray, desired = 4): string[] {
  /* ARGB, and only the opaque pixels: a transparent PNG's empty region is not a colour, and
     quantising it drags every candidate toward whatever the canvas was cleared to. */
  const argb: number[] = [];
  for (let i = 0; i < pixels.length; i += 4) {
    if (pixels[i + 3] < 255) continue;
    argb.push((255 << 24) | (pixels[i] << 16) | (pixels[i + 1] << 8) | pixels[i + 2]);
  }
  if (argb.length === 0) return [];
  const quantised = QuantizerCelebi.quantize(argb, 128);

  /* AOSP's ranking, with anything that did not come out of this image dropped — which is the
     fallback, and only the fallback. See the header. */
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
 * `deriveTheme` behind a bounded memo, for the server.
 *
 * `app/layout.tsx` runs this on every request that carries a custom-palette cookie, and
 * `<Link>` prefetching means a single page view renders the layout more than once. The
 * function is pure — same hex, same sixty hexes, for ever — so this is memoisation in the
 * plain sense, with no TTL and no staleness: unlike `lib/serverMemo.ts`, there is nothing
 * upstream that could have changed. The cap is what stops a hostile cookie from growing an
 * unbounded map; insertion order is the eviction order.
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
