/**
 * The palette recipe: a theme's two fills and its accents in, a whole M3 scheme out — twice, once
 * per 配色方案. Derivation only — no filesystem, no assertions, no report; AGENTS.md's "The palette
 * axis" section carries the history and the ten-theme table.
 *
 * A PLAIN MODULE: no `'use client'`, no framework imports. Three consumers agree
 * by construction — `scripts/palette.mjs` (builds the ten built-in themes, writes
 * the CSS), `app/layout.tsx` (derives the custom theme at SSR, so its declarations
 * are in the first byte), `lib/paletteLazy.ts` (re-derives in the browser on a new
 * hex). The basis is **HCT**, the space M3 quotes its numbers in.
 *
 * `primary` is not derived here. A built-in theme's two fills are decided in
 * `scripts/palette.mjs` — the colour guide's hue, at a tone and a share of the
 * gamut chosen for the largest area on screen — and the custom palette's light
 * fill is the user's own hex, verbatim. What this module solves from them is the
 * rest: the ramp, `on-primary`, the two inks, and the dark fill where there is no
 * second hex (`DARK_SHIFT`).
 *
 * The primary *ramp* is built from the light hex's hue at a chroma decided by
 * `rampChroma`, **measured at `CHROMA_REFERENCE_TONE`, not at the fill's own
 * tone** — a pale fill sits where the gamut is narrow, so reading chroma there
 * muddies the palette (ASSERTION 6: every `primary-ink` has chroma ≥ 35) — so a
 * theme's fill and its ink may be very different colours: surface vs mark.
 *
 * **Two schemes per theme, 多色 and 单色** (`PaletteHues`, `lib/paletteSpec.ts`). 单色 is M3's
 * `SchemeTonalSpot` with one change: the tertiary roles read the secondary palette, so no second
 * hue appears anywhere (ASSERTION 8 compares the palettes it does use with the library's). 多色
 * gives the secondary roles the theme's **second colour** — every selection container follows it,
 * at the tint's chroma in light and, for a built-in, at a clear shade's in dark
 * (`deepSecondChroma`) — and the
 * tertiary roles its **accent**, which only a few accent moments read (a favourite or like
 * that is on, the level meter, an empty state's glyph). The focus ring and a selected filter chip
 * keep 单色's colours in both (`selection`, below).
 */

import {
  Hct,
  TonalPalette,
  argbFromHex,
  differenceDegrees,
  hexFromArgb,
} from '@material/material-color-utilities';

import { clearChromaAt } from './clearColor';
import { quantizeCelebi } from './quantize';

import {
  BRAND_RAMP_SEED,
  BRAND_SEED,
  BRAND_SEED_DARK,
  HUES_ATTRIBUTE,
  type AccentChoice,
  type AccentPreset,
  type CustomSpec,
  type CustomTones,
  type FaceScheme,
  type ThemeFace,
} from './paletteSpec';

/* The brand seed, its dark fill and the pink the ramp chroma is measured from are declared in
   `./paletteSpec` (the import-free module) and re-exported here, where the generator and the
   recipe have always read them. */
export { BRAND_RAMP_SEED, BRAND_SEED, BRAND_SEED_DARK };

export const hctOf = (hex: string) => Hct.fromInt(argbFromHex(hex));

const brandSeed = hctOf(BRAND_RAMP_SEED);

/** The most chroma sRGB can hold at a hue and tone — HCT gamut-maps to the ceiling. */
export const maxChroma = (hue: number, tone: number) => Hct.from(hue, 200, tone).chroma;

/** A colour from its three HCT coordinates, gamut-mapped — the picker's whole vocabulary. */
export const hexFromHct = (hue: number, chroma: number, tone: number) =>
  hexFromArgb(Hct.from(hue, chroma, tone).toInt()).toLowerCase();

/** A hue difference, brought into (−180, 180] so a wrap at 360 cannot become a rotation. */
export const norm180 = (d: number) => ((((d + 180) % 360) + 360) % 360) - 180;

/** A hue, brought into [0, 360). */
export const wrapHue = (h: number) => ((h % 360) + 360) % 360;

/* --- Chroma --------------------------------------------------------------- */

/** Where a ramp's chroma is measured: the brand's own tone. Read the header before changing. */
export const CHROMA_REFERENCE_TONE = 61;

/**
 * Ramp chroma in HCT: the brand's own — ceiling on the shared, floor on the character's.
 *
 * Measured on `BRAND_RAMP_SEED`, the mascot's mane, **not on the brand's fill**: under direction A
 * the fill is a tint, and a tint's chroma is whatever the gamut holds at its tone (20.4 at the
 * brand's). This number is the floor under every theme's primary ramp, so reading it off a tint
 * would take all eleven `primary-ink`s with it — the same mistake `CHROMA_REFERENCE_TONE` exists
 * to prevent, one level up. ASSERTION 6 is the check.
 */
export const BRAND_CHROMA = brandSeed.chroma;

/**
 * The chroma at which a fill is taken to assert a hue, in three places. For a
 * **built-in** theme it is a hard bar — a fill must define a hue (ASSERTION 4,
 * `scripts/palette.mjs`; it is why two characters take a feature other than
 * their coat). For the **user's** colour it is no bar — it is where
 * `rampChroma`'s taper saturates: a person choosing grey is not making a
 * mistake, and what a grey becomes is a near-monochrome scheme, a real M3 variant.
 * And an accent *related* to the user's colour tapers the same way (`customAccents`):
 * a grey has no hue to be at a right angle to.
 */
export const MIN_SEED_CHROMA = 15;

/**
 * The chroma of a theme's primary ramp, from its light fill: the brand's own as
 * floor, **tapering to zero as the fill runs out of hue** (inert at/above
 * `MIN_SEED_CHROMA`, so built-ins are untouched) — the taper is what lets a
 * grey be a theme: near-monochrome, not a grey bar over a randomly-hued ramp.
 */
export const rampChroma = (hue: number, fillChroma: number) => {
  const floor = Math.min(BRAND_CHROMA, maxChroma(hue, CHROMA_REFERENCE_TONE)) * hueConfidence(fillChroma);
  return Math.max(fillChroma, floor);
};

/** How sure a fill is of its hue: 0 for a grey, 1 from `MIN_SEED_CHROMA` up. */
const hueConfidence = (fillChroma: number) => Math.min(1, fillChroma / MIN_SEED_CHROMA);

/** M3 `SchemeTonalSpot`'s neutral chroma. */
export const NEUTRAL_CHROMA = 6;

/**
 * The harmony, verbatim from M3's `SchemeTonalSpot` — secondary chroma 16,
 * neutral chroma 6, neutralVariant chroma 8, all at the primary's hue. The
 * chroma stays flat even though `primary`'s no longer is: M3 pairs constant
 * secondary 16 with constant primary 36, and a proportional secondary would not
 * be M3 — a focus ring that gets louder on the more saturated themes answers a
 * question about the brand, not the keyboard.
 *
 * TonalSpot's tertiary (hue + 60°, chroma 24) is not here, and that is 单色's one
 * change: its tertiary roles read this secondary palette instead, so no second hue
 * appears. **ASSERTION 8 compares the set against a real `SchemeTonalSpot`**:
 * drifting from these numbers is a failing check, not a style choice.
 */
export const HARMONY = {
  secondary: { dHue: 0, chroma: 16 },
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
  | 'neutral'
  | 'neutralVariant'
  | 'error'
  | 'success'
  | 'warning';

/* --- Exact installation: the displayed seed is `primary` -------------------
 * A wallpaper style decides `primary` at a dark P40/P80 and three of five don't
 * keep the seed's hue, so no option is the colour in the picture. `deriveTheme`
 * below installs the given seed. Image recommendations adapt tone/chroma before display in
 * `imageRecommendations.ts`; the manual/saved path never calls that recommendation step.
 * 多色 does not reopen that axis: it never touches `primary`.
 * ------------------------------------------------------------------------ */

/** The one recipe for the TonalSpot palettes. Every ramp 单色 has, from a hue and a chroma. */
export function paletteSet(hue: number, chroma: number): Record<PaletteName, TonalPalette> {
  return {
    primary: TonalPalette.fromHueAndChroma(hue, chroma),
    secondary: TonalPalette.fromHueAndChroma(hue + HARMONY.secondary.dHue, HARMONY.secondary.chroma),
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
 * not a built-in theme's dark fill, which `scripts/palette.mjs` decides (and which
 * the refined fills all keep above 1.67:1 on this page).
 */
export const DARK_SEPARATION = 3;

/**
 * The dark fill's step: the same hue, seven tones deeper — the brand's own pair
 * (tone 61 over 54). The built-in themes take it through `scripts/palette.mjs`;
 * the custom palette takes it here, where there is no second hex to read.
 */
export const DARK_SHIFT = 7;

/** Named themes' ink clears text contrast even on selected/raised surfaces, with rounding room. */
export const BUILT_IN_INK_CONTRAST = 4.6;
type InkPolicy = 'exact-custom' | 'built-in';

/**
 * `on-primary-variant`: the app bar's own ink — its icons and the wordmark — a step quieter than
 * `on-primary` (the owner: 「header里的图标（含logo）能不能稍微浅一点点」, a little less contrast
 * against the bar). The ramp tone on the line from `on-primary` toward the fill whose contrast
 * against that fill is `ON_PRIMARY_VARIANT_SHARE` of `on-primary`'s own, floored at
 * `ON_PRIMARY_VARIANT_FLOOR` so it would still carry text, and never past `on-primary`: where
 * `on-primary` is itself under the floor (an exact custom theme's white at 3:1), the variant *is*
 * `on-primary`. Both directions — a dark ink on a pale bar rises toward it, white on a deep bar
 * comes down toward it — and per scheme, because the two fills differ. One recipe for every
 * palette, so a custom theme gains the role and keeps every role it had. ASSERTION 19.
 *
 * **Coming down from white it is a tint, held to `ON_PRIMARY_VARIANT_TINT_CHROMA`.** The ramp's
 * own tones near white carry whatever chroma the gamut allows there, and that differs by hue
 * several times over: indigo and violet are held to about C21 at T89 (露娜 `#dbddff`, 瑞瑞
 * `#e3dbff`), cyan is not, and 邪茧's quieter ink came out a saturated aqua (`#7bf6eb`, C45.7) —
 * a new colour on the bar rather than a softer white. A dark ink rising toward a pale bar keeps
 * its own chroma: that is the ink's character (the brand's wine, 小蝶's olive), not a tint.
 */
export const ON_PRIMARY_VARIANT_SHARE = 0.75;
export const ON_PRIMARY_VARIANT_FLOOR = 4.5;
export const ON_PRIMARY_VARIANT_TINT_CHROMA = 22;

export function onPrimaryVariant(
  ramp: TonalPalette,
  ink: string,
  inkTone: number,
  fill: string,
  share = ON_PRIMARY_VARIANT_SHARE,
): string {
  const full = contrast(ink, fill);
  const target = Math.min(full, Math.max(ON_PRIMARY_VARIANT_FLOOR, share * full));
  const fillTone = Math.round(hctOf(fill).tone);
  const step = inkTone < fillTone ? 1 : -1;
  /* Down from white the ink is a tint of the ramp's hue; up from a dark ink it is the ramp itself. */
  const tint = step < 0 && ramp.chroma > ON_PRIMARY_VARIANT_TINT_CHROMA
    ? TonalPalette.fromHueAndChroma(ramp.hue, ON_PRIMARY_VARIANT_TINT_CHROMA)
    : ramp;
  let best = ink;
  for (let tone = inkTone + step; step > 0 ? tone < fillTone : tone > fillTone; tone += step) {
    const hex = hexFromArgb(tint.tone(tone)).toLowerCase();
    if (contrast(hex, fill) < target) break;
    best = hex;
  }
  return best;
}

export interface BrandTones {
  /** `primary`, light scheme. */
  light: string;
  /** `primary`, dark scheme. */
  dark: string;
  /** `on-primary`. One value: it does not flip between schemes, because `primary` does not. */
  onPrimary: string;
  /** `on-primary-variant` per scheme: the bar's quieter ink, against that scheme's fill. */
  onPrimaryVariantLight: string;
  onPrimaryVariantDark: string;
  inkLight: string;
  inkDark: string;
}

/**
 * `on-primary`, and the two ink values — measured against the TonalSpot surfaces,
 * so 多色 and 单色 share one brand whatever tint the default's coat gives its page.
 *
 *   exact-custom keeps the established 3:1 white / tone-20 policy and its original
 *                page-only ink floors, so manual/saved themes retain every role.
 *   built-in     requires 4.5:1 on both fills, lowering the paired dark ink where
 *                needed; primary-ink also clears raised/selected surfaces as text.
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
  policy: InkPolicy,
): BrandTones {
  const p = (t: number) => hexFromArgb(palettes.primary.tone(t)).toLowerCase();
  const readable = policy === 'built-in';
  const surfaceLight = hexFromArgb(palettes.neutral.tone(readable ? 90 : 98)).toLowerCase();
  const surfaceDark = hexFromArgb(palettes.neutral.tone(readable ? 30 : 6)).toLowerCase();
  const bar = readable ? 4.5 : WHITE_INK_BAR;

  const white =
    contrast('#ffffff', light) >= bar && contrast('#ffffff', dark) >= bar;

  let inkLight = Math.round(hctOf(light).tone);
  while (inkLight > 10 && contrast(p(inkLight), surfaceLight) < (readable ? BUILT_IN_INK_CONTRAST : LIGHT_INK)) inkLight -= 1;

  let inkDark = Math.round(hctOf(dark).tone);
  while (inkDark < 95 && contrast(p(inkDark), surfaceDark) < (readable ? BUILT_IN_INK_CONTRAST : DARK_SEPARATION)) inkDark += 1;

  let onTone = 20;
  if (readable && !white) {
    while (onTone > 0 && Math.min(contrast(p(onTone), light), contrast(p(onTone), dark)) < bar) onTone -= 1;
  }
  const ink = white ? '#ffffff' : p(onTone);
  const inkTone = white ? 100 : onTone;
  return {
    light,
    dark,
    onPrimary: ink,
    onPrimaryVariantLight: onPrimaryVariant(palettes.primary, ink, inkTone, light),
    onPrimaryVariantDark: onPrimaryVariant(palettes.primary, ink, inkTone, dark),
    inkLight: p(inkLight),
    inkDark: p(inkDark),
  };
}

/* --- 多色: the second colour and the accent -------------------------------- */

/**
 * A theme's two extra hues. The ten built-ins name theirs from the character's own
 * art (`scripts/palette.mjs`); the custom palette's come from `customAccents`.
 */
export interface Accents {
  /**
   * 第二色 — the secondary palette under 多色: broad and quiet, every selection container. The
   * chroma is the **tint's**, which is what the light scheme's tone-90 containers wear; for a
   * built-in theme `deepSecondChroma` gives the dark scheme's tone-30 shade its own, or it reads
   * as 浊色.
   */
  second: { hue: number; chroma: number };
  /** 点缀色 — the tertiary palette under 多色: a mark, at a few accent moments. */
  spark: { hue: number; chroma: number };
  /**
   * The neutrals' hue per scheme, where 多色 takes it from somewhere other than the
   * primary — the default theme's, whose primary is the mascot's mane and whose page
   * is her coat. Chroma stays M3's (6 and 8).
   */
  neutralHue?: { light: number; dark: number };
}

/** The custom palette's second colour, at the quiet end of the built-ins' 14–18. */
export const SECOND_CHROMA = 18;
/** The custom palette's accent, at the quiet end of the built-ins' 36–48. */
export const SPARK_CHROMA = 36;

/**
 * The accent's tone in light, as a mark: M3's text tone 40 turns every warm hue
 * brown, so the accent takes the tone `primary-ink` solves the same problem with.
 * Still ≥ 3:1 on the page and against its own container, which the level meter
 * needs; the dark scheme keeps M3's 80.
 */
export const SPARK_TONE = 50;

/**
 * Where an accent that was not named may not land: the three severities, each band
 * spanning its role's hue and its fill's (error 22 / 18.8, warning 75.8 / 65.9,
 * success 152 / 155.3) with room either side, and the olive shoulder of
 * `DislikeAnalyzer`'s band (hue 90–111), where every accent tone reads as mud.
 * Inclusive. `scripts/palette.mjs` asserts that each severity still sits inside its
 * band, so a retuned severity cannot slip out from under its guard.
 */
export const HUE_GUARDS = [
  { from: 10, to: 34, reason: 'error' },
  { from: 60, to: 86, reason: 'warning' },
  { from: 85, to: 125, reason: 'olive' },
  { from: 142, to: 165, reason: 'success' },
] as const;

export const isGuardedHue = (hue: number) => {
  const h = wrapHue(hue);
  return HUE_GUARDS.some((band) => h >= band.from && h <= band.to);
};

/* --- The second colour's two registers -------------------------------------
 *
 * A theme's second colour is **declared once, as a tint**: chroma 14–18, read off the character's
 * art for the light scheme, where every container role sits at tone 90. In the dark scheme those
 * same roles sit at tone 30 — a *shade* — and M3 reuses the one chroma there. That is where
 * decision 29's 清色 intent breaks: at tone 90 the gamut is narrow, so 16 is most of the purity
 * the hue can hold and the colour reads as 明清色; at tone 30 the gamut is two to four times as
 * wide, so the same 16 leaves most of it unused and what fills the gap is grey — 浊色, "a pure
 * hue plus grey". Measured over the ten, as a share of the hue's own deep register at that tone:
 * the four containers the owner called muddy hold 0.37–0.51 (天琴 0.43 brown, 苹果嘉儿 0.51 olive,
 * 小蝶 0.37 plum, 云宝 0.39), the four he called clean hold 0.68–0.81 (邪茧, 露娜, 瑞瑞, 碧琪).
 * It is not simply the hue, and it is not the absolute chroma: 默认's and 暮光's periwinkle holds
 * 0.43 at chroma 18, the same share as the brown, while 碧琪's blue holds 0.81 at the same 18.
 *
 * So the chroma is declared per register, the way `clearColorAt` already gives a *fill* one number
 * for a tint and another for a shade. Three bounds, in the order they bind:
 *
 *   SECOND_CLARITY   how much of the hue's deep register a dark container must hold to read as a
 *                    shade rather than a greyed tone. 0.65 is the bar the four clean themes
 *                    already clear, with room — their own standard, not a new taste.
 *   SECOND_AREA_CAP  the most chroma a *broad* surface may take, however wide its gamut:
 *                    TonalSpot's own chroma for a second hue, and two thirds of the accent's
 *                    quiet end, so "the second colour is broad and quiet, the accent is a mark"
 *                    survives the lift (decision 29: purity falls as area grows).
 *   the declared     a floor, never a ceiling — a second colour already clear of the bar does not
 *                    move, so the four clean themes stay byte-identical.
 *
 * **The ten built-ins only**, by the same split as `inkPolicy`: a saved custom theme keeps its
 * whole existing role derivation (AGENTS: "Exact manual and saved custom themes retain their full
 * existing role derivation"), so its dark containers do not move under a user who chose them.
 * A built-in second colour is never on a guarded hue (ASSERTION 13), so purity is never raised in
 * the olive shoulder or under a severity.
 *
 * 单色 takes no part in this. Its secondary palette is `SchemeTonalSpot`'s, verbatim, which
 * ASSERTION 8 pins to the library — this is 多色's own rule, like `SPARK_TONE`.
 */

/** The tone every container role sits at in the dark scheme (`ROLES`, verbatim from AOSP). */
const DARK_CONTAINER_TONE = 30;
/** The share of its hue's deep register a dark selection container must hold. ASSERTION 17. */
export const SECOND_CLARITY = 0.65;
/** The chroma ceiling for a broad container — under the accent's 36, so a mark stays a mark. */
export const SECOND_AREA_CAP = 24;

/**
 * A built-in second colour's chroma in the dark scheme: its declared tint chroma, or the clear
 * shade its hue allows at the container tone, whichever is more. Read the block above before
 * changing either constant; `scripts/palette.mjs`'s ASSERTION 17 is this same bar, measured on the
 * emitted hex.
 */
export function deepSecondChroma(hue: number, chroma: number): number {
  const deep = clearChromaAt(hue, DARK_CONTAINER_TONE, 'deep');
  return Math.max(chroma, Math.min(SECOND_AREA_CAP, SECOND_CLARITY * deep));
}

/** A hue as an integer degree, which is how one is stored and compared. */
const degree = (hue: number) => Math.round(wrapHue(hue)) % 360;

/** The nearest unguarded whole degree, searching outward one at a time. */
function nearestOpenHue(hue: number): number {
  const start = degree(hue);
  for (let d = 0; d < 180; d += 1) {
    for (const h of [wrapHue(start - d), wrapHue(start + d)]) {
      if (!isGuardedHue(h)) return h;
    }
  }
  return start;
}

/**
 * How far each relation turns from the seed's hue. 自动 is a quarter-turn cooler —
 * the classic square harmony, and on the brand pink it lands on the mascot's own
 * periwinkle bows (266° against 268°). The presets are the same idea at 30°, 120°
 * and 180°: 邻近 is subtle by definition (under 40° a container's hue barely shows).
 */
const TURNS: Record<'auto' | AccentPreset, number> = {
  auto: -90,
  analogous: -30,
  triadic: -120,
  complement: 180,
};

/**
 * The hue a relation gives, from the seed's hue: the turn, else its mirror when the
 * turn lands in a guarded band, else the open hue nearest the turn. An integer, so a
 * stored hue and a recomputed one agree.
 */
export function relatedHue(seedHue: number, relation: 'auto' | AccentPreset): number {
  const turn = TURNS[relation];
  const first = degree(seedHue + turn);
  if (!isGuardedHue(first)) return first;
  const mirror = degree(seedHue - turn);
  if (!isGuardedHue(mirror)) return mirror;
  return nearestOpenHue(first);
}

/**
 * The custom palette's accents. One hue, shared by the second colour and the accent
 * (the owner's call: the ten get two hues from an artist; one chosen by hand is
 * the one least likely to clash). A *relation* — 自动 or a preset — tapers its
 * chroma with the seed's confidence in its own hue, so a grey seed gets grey
 * accents, as `rampChroma` gives it a near-grey ramp; **a hue the user named is
 * taken at its word**, guards and all — the same rule the primary follows (the
 * built-ins are held to a hue; a person's own colour is not).
 */
export function customAccents(seed: string, accent: AccentChoice): Accents {
  if (typeof accent === 'number') {
    return { second: { hue: accent, chroma: SECOND_CHROMA }, spark: { hue: accent, chroma: SPARK_CHROMA } };
  }
  const fill = hctOf(seed);
  const hue = relatedHue(fill.hue, accent ?? 'auto');
  const confidence = hueConfidence(fill.chroma);
  return {
    second: { hue, chroma: SECOND_CHROMA * confidence },
    spark: { hue, chroma: SPARK_CHROMA * confidence },
  };
}

/** The tone a 副色相 is drawn at where it stands alone as a swatch — `ColorPicker`'s 自选 rail. */
const ACCENT_SWATCH_TONE = 62;

/** A 副色相 as a swatch: its accent's own palette at `ACCENT_SWATCH_TONE`. */
export function accentSwatch(accents: Accents): string {
  return hexFromArgb(
    TonalPalette.fromHueAndChroma(accents.spark.hue, accents.spark.chroma).tone(ACCENT_SWATCH_TONE),
  ).toLowerCase();
}

/* --- The role → tone map --------------------------------------------------- */

/**
 * Which palette a role reads, by slot. Each 配色方案 fills the slots differently:
 *
 *   slot        单色                    多色
 *   secondary   TonalSpot secondary     the second colour
 *   tertiary    TonalSpot secondary     the accent
 *   selection   TonalSpot secondary     TonalSpot secondary
 *   neutral*    TonalSpot neutral(s)    the theme's own (the default's coat), else TonalSpot
 *
 * `selection` is for the two things that must not change with 配色方案: the focus ring
 * (it answers "where is the keyboard", M3's `FocusIndicatorColor` is `Secondary`) and a
 * selected filter chip (the tag categories own chip-shaped colour, so an accent never
 * wears a chip).
 */
type Slot = PaletteName | 'tertiary' | 'selection';

type ToneSpec =
  | number
  | 'primary-light'
  | 'primary-dark'
  | 'on-primary'
  | 'on-primary-variant-light'
  | 'on-primary-variant-dark'
  | 'ink-light'
  | 'ink-dark';
export type Role = readonly [token: string, slot: Slot, light: ToneSpec, dark: ToneSpec];

/**
 * Verbatim from AOSP's generated `ColorLightTokens.kt` / `ColorDarkTokens.kt`
 * (VERSION v0_210); only the roles this app declares are listed, plus three of its
 * own on the `selection` slot. Five entries are names rather than tones — `primary`
 * and `on-primary` are literal hexes, the two inks are solved against contrast.
 */
export const ROLES: readonly Role[] = [
  // token,                     slot,             light,             dark
  ['primary',                   'primary',        'primary-light',   'primary-dark'],
  /* One value on purpose: `primary` does not invert between schemes, so a filled
     button cannot read as two different components depending on the scheme. */
  ['on-primary',                'primary',        'on-primary',      'on-primary'],
  /* The app bar's own ink, a step quieter than `on-primary`: see `onPrimaryVariant`. */
  ['on-primary-variant',        'primary',        'on-primary-variant-light', 'on-primary-variant-dark'],
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

  /* 多色 draws `tertiary` itself at `SPARK_TONE` in light — a mark, see there. */
  ['tertiary',                  'tertiary',       40,                80],
  ['on-tertiary',               'tertiary',       100,               20],
  ['tertiary-container',        'tertiary',       90,                30],
  ['on-tertiary-container',     'tertiary',       10,                90],

  /* The focus ring: M3's secondary, and TonalSpot's in both 配色方案. */
  ['focus',                     'selection',      40,                80],
  /* A selected filter chip: the secondary container pair, TonalSpot's in both. */
  ['chip-selected',             'selection',      90,                30],
  ['on-chip-selected',          'selection',      10,                90],

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

/** 多色's one tone of its own: the accent as a mark in light. */
export const MULTI_TONES: Readonly<Record<string, readonly [number, number]>> = {
  tertiary: [SPARK_TONE, 80],
};

/**
 * Which of those roles a theme block declares.
 *
 * Everything that follows the theme; the three semantic ramps do not, so their
 * twelve roles are emitted once — by the default theme in globals.css — and
 * inherited, which is why a generated block can be a partial override. Roles
 * reached through a var() indirection are deliberately absent: re-emitting them
 * would freeze the indirection at generate time.
 */
const SHARED_SLOTS = new Set<Slot>(['error', 'success', 'warning']);
export const THEMED_ROLES: readonly Role[] = ROLES.filter(([, slot]) => !SHARED_SLOTS.has(slot));
export const THEMED_TOKENS: readonly string[] = THEMED_ROLES.map(([token]) => token);

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
  /** 多色's two hues, or null for a theme derived without them (its 多色 is its 单色). */
  accents: Accents | null;
}

type RoleMap = Record<string, string>;

export interface DerivedTheme {
  meta: ThemeMeta;
  /** 多色 — every role, light scheme. */
  light: RoleMap;
  /** 多色 — every role, dark scheme. */
  dark: RoleMap;
  /** 单色 — every role, both schemes. */
  mono: { light: RoleMap; dark: RoleMap };
}

/**
 * The dark fill for a theme that has only one hex — the custom palette: seven
 * tones down, then lightened until it clears the dark page. The floor applies
 * here where it does not for a built-in theme, whose dark value is a colour
 * decided with the artwork beside it — a colour nobody chose is not owed the same
 * latitude.
 */
function deriveDarkFill(palettes: Record<PaletteName, TonalPalette>, lightTone: number): string {
  const p = (t: number) => hexFromArgb(palettes.primary.tone(t)).toLowerCase();
  const surfaceDark = hexFromArgb(palettes.neutral.tone(6)).toLowerCase();
  let tone = Math.round(lightTone) - DARK_SHIFT;
  while (tone < 95 && contrast(p(tone), surfaceDark) < DARK_SEPARATION) tone += 1;
  return p(tone);
}

type SlotPalettes = Record<Slot, TonalPalette>;

/** Every role, both schemes, from one filling of the slots per scheme. */
function resolveRoles(
  slots: { light: SlotPalettes; dark: SlotPalettes },
  named: Record<string, string>,
  tones: Readonly<Record<string, readonly [number, number]>> = {},
): { light: RoleMap; dark: RoleMap } {
  const out = { light: {} as RoleMap, dark: {} as RoleMap };
  for (const [token, slot, lightTone, darkTone] of ROLES) {
    const [lightAt, darkAt] = tones[token] ?? [lightTone, darkTone];
    for (const [scheme, raw] of [
      ['light', lightAt],
      ['dark', darkAt],
    ] as const) {
      out[scheme][token] =
        typeof raw === 'number' ? hexFromArgb(slots[scheme][slot].tone(raw)).toLowerCase() : named[raw];
    }
  }
  return out;
}

/**
 * Every role in `ROLES`, both schemes, both 配色方案.
 *
 * `lightHex` **is** primary in light — a built-in theme's decided fill, the hex the
 * user named, or a seed lifted from an image: one rule, no exception. `darkHex` is
 * the built-in's own dark fill; otherwise `deriveDarkFill`. Without `accents`, 多色
 * is 单色.
 */
export function deriveTheme(lightHex: string, darkHex?: string, accents?: Accents, inkPolicy: InkPolicy = 'exact-custom'): DerivedTheme {
  const light = lightHex.toLowerCase();
  const f = hctOf(light);
  const chroma = rampChroma(f.hue, f.chroma);
  const palettes = paletteSet(f.hue, chroma);

  const derivedDark = !darkHex;
  const dark = (darkHex ?? deriveDarkFill(palettes, f.tone)).toLowerCase();
  const brand = inkTones(palettes, light, dark, inkPolicy);

  const named: Record<string, string> = {
    'primary-light': brand.light,
    'primary-dark': brand.dark,
    'on-primary': brand.onPrimary,
    'on-primary-variant-light': brand.onPrimaryVariantLight,
    'on-primary-variant-dark': brand.onPrimaryVariantDark,
    'ink-light': brand.inkLight,
    'ink-dark': brand.inkDark,
  };

  const tonalSpot: SlotPalettes = { ...palettes, tertiary: palettes.secondary, selection: palettes.secondary };
  const mono = resolveRoles({ light: tonalSpot, dark: tonalSpot }, named);

  let multi = mono;
  if (accents) {
    /* Two registers for one declared hue: the tint in light, the clear shade in dark — for the
       built-ins; a custom theme keeps one chroma in both, as it always had (`deepSecondChroma`). */
    const second = TonalPalette.fromHueAndChroma(accents.second.hue, accents.second.chroma);
    const secondDeep =
      inkPolicy === 'built-in'
        ? TonalPalette.fromHueAndChroma(accents.second.hue, deepSecondChroma(accents.second.hue, accents.second.chroma))
        : second;
    const spark = TonalPalette.fromHueAndChroma(accents.spark.hue, accents.spark.chroma);
    const neutrals = (hue: number | undefined) =>
      hue === undefined
        ? { neutral: palettes.neutral, neutralVariant: palettes.neutralVariant }
        : {
            neutral: TonalPalette.fromHueAndChroma(hue, NEUTRAL_CHROMA),
            neutralVariant: TonalPalette.fromHueAndChroma(hue, HARMONY.neutralVariant.chroma),
          };
    const slots = (hue: number | undefined, secondary: TonalPalette): SlotPalettes => ({
      ...tonalSpot,
      ...neutrals(hue),
      secondary,
      tertiary: spark,
    });
    multi = resolveRoles(
      {
        light: slots(accents.neutralHue?.light, second),
        dark: slots(accents.neutralHue?.dark, secondDeep),
      },
      named,
      MULTI_TONES,
    );
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
      accents: accents ?? null,
    },
    light: multi.light,
    dark: multi.dark,
    mono,
  };
}

/**
 * The roles a palette tile's face reads (`components/PaletteTileFace.tsx`): under a band of the
 * theme's `primary` — its app bar — the theme's page, and on it what a selection wears and, under
 * 多色, the accent as a mark. Real roles rather than swatches chosen for the tile, so a tile shows
 * exactly what the theme paints.
 *
 * **The page is `surface-container-lowest`, not `surface`.** A tile is borderless and separates
 * from what it sits on by tone, and its own `surface` measured too close to /settings' row
 * (`surface-container-low`): 1.8–2.2 in L* in light — no edge at all — and 3.7–4.3 in dark, over
 * every theme on every theme. The lowest step is the ladder's far end in the page's own
 * direction — lighter than every container in light, darker in dark — so it is the one step that
 * clears all three places a tile is drawn, light / dark: the row by 3.9 / 5.7, a dialog
 * (`surface-container-high`) by 7.9 / 12.7, a 副色相 tile (`surface-container-highest`,
 * `secondary-container` when chosen) by 9.9 / 17.7. A lighter dark page would read as a raised
 * card, and lands on a dialog's own tone. ASSERTION 16.
 */
export const FACE_ROLES = {
  page: 'surface-container-lowest',
  pick: 'secondary-container',
  accent: 'tertiary',
} as const;

export function themeFace(derived: DerivedTheme): ThemeFace {
  const scheme = (s: 'light' | 'dark'): FaceScheme => ({
    page: derived[s][FACE_ROLES.page]!,
    pick: derived[s][FACE_ROLES.pick]!,
    accent: derived[s][FACE_ROLES.accent]!,
    monoPage: derived.mono[s][FACE_ROLES.page]!,
    monoPick: derived.mono[s][FACE_ROLES.pick]!,
  });
  return { light: scheme('light'), dark: scheme('dark') };
}

/** A palette's whole tile — the bar per scheme and the face — what `data-palette-tones` packs. */
export function paletteTones(derived: DerivedTheme): CustomTones {
  const bar = (s: 'light' | 'dark') => ({ primary: derived[s].primary!, onPrimary: derived[s]['on-primary']! });
  return { light: bar('light'), dark: bar('dark'), face: themeFace(derived) };
}

/** The themed tokens where 单色 differs from 多色, in either scheme. */
export function monoTokens(derived: DerivedTheme): string[] {
  return THEMED_TOKENS.filter(
    (token) =>
      derived.mono.light[token] !== derived.light[token] || derived.mono.dark[token] !== derived.dark[token],
  );
}

/**
 * The CSS blocks for one palette id, in the exact shape `app/theme-palettes.css`
 * carries, so generated and runtime-injected blocks cannot diverge: 多色 as the
 * theme's own two blocks, then 单色 as two more carrying only the roles it changes.
 * `multi: false` leaves the first two out — the default theme's 多色 is `:root`
 * itself. The selectors carry html on purpose: `@import` must precede any rule, so
 * the generated blocks land above `:root` at equal specificity — source order would
 * decide, and wrongly. 单色's blocks outrank 多色's by one attribute, (0,2,1) and
 * (0,3,1), and each pair declares one set of names in both schemes, so a name in the
 * light half can never paint through the dark one.
 */
export function paletteBlocksCss(
  id: string,
  derived: DerivedTheme,
  { indent = '', multi = true }: { indent?: string; multi?: boolean } = {},
): string {
  const out: string[] = [];
  const block = (selector: string, roles: RoleMap, tokens: readonly string[]) => {
    out.push(`${indent}${selector} {`);
    for (const token of tokens) out.push(`${indent}  --md-sys-color-${token}: ${roles[token]};`);
    out.push(`${indent}}`);
  };
  const palette = `[data-palette='${id}']`;
  const mono = `[${HUES_ATTRIBUTE}='mono']`;
  if (multi) {
    block(`html${palette}`, derived.light, THEMED_TOKENS);
    block(`html.dark${palette}`, derived.dark, THEMED_TOKENS);
  }
  const changed = monoTokens(derived);
  if (changed.length > 0) {
    block(`html${palette}${mono}`, derived.mono.light, changed);
    block(`html.dark${palette}${mono}`, derived.mono.dark, changed);
  }
  return out.join('\n');
}

/* --- The custom palette ---------------------------------------------------- */

/** The eleventh palette's `data-palette` value. Its colours are per-user, not generated. */
export const CUSTOM_PALETTE = 'custom';

const HEX = /^#[0-9a-f]{6}$/i;

/** Normalises a user-supplied seven-character hex, or returns null. The whole stored
 * form — seed and 副色相 — is `CustomSpec` in `lib/paletteSpec.ts`. */
export function normalizeCustomSeed(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const hex = value.trim().toLowerCase();
  return HEX.test(hex) ? hex : null;
}

/** The eleventh palette, both 配色方案: the seed as `primary`, and its 副色相. */
export const deriveCustomTheme = (spec: CustomSpec) =>
  deriveTheme(spec.seed, undefined, customAccents(spec.seed, spec.accent));

/**
 * Legacy Monet source-colour helper, retained for compatibility/reference tests. The product
 * image picker now uses `recommendImageColors`; this helper does not rank its recommendations.
 *
 * The extraction is two calls: `QuantizerCelebi` reduces the pixels to a palette
 * with populations — our deterministic port of it (`lib/quantize.ts`), since the
 * library's starts its k-means from `Math.random` and the same picture offered
 * different colours on every read — and `Score`'s arithmetic ranks them as
 * theme sources (`scoreClusters` / `monetPicks`, a port so the chroma floor is
 * ours to set; the arithmetic is quoted below and held to the library's answers
 * in `scripts/testPalette.mjs`):
 *
 *   - proportion contributes `proportion × 100 × WEIGHT_PROPORTION` (0.7),
 *     where the proportion is a 30° hue-neighbourhood share — a colour is
 *     credited for the company it keeps.
 *   - chroma contributes `(chroma − TARGET_CHROMA) × w`, and **`w` is
 *     asymmetric**: 0.3 above the target of 48, 0.1 below it.
 *   - the filter drops `chroma < THEME_MIN_CHROMA` (15, see below) **and**
 *     `proportion ≤ CUTOFF_EXCITED_PROPORTION` (0.01) — the second one is the
 *     trap below.
 *   - the hue spread is a **sweep**, 90° down to 15°: the first bar that yields
 *     `desired` candidates wins; if none does, it returns **fewer**.
 *
 * **The guard is the empty-result case: AOSP's answer is a colour that is not
 * in the picture** — when the filter leaves nothing, `Score` returns its own
 * fallback (Google Blue), which here would silently paint the app bar a blue
 * nobody chose. A chroma-only test was never sufficient: the 0.01 proportion
 * cutoff is reachable with plenty of chroma present (a small saturated subject
 * in a large frame). The port needs no such test — it can only ever name a
 * cluster of this picture — and where nothing survives, the image's own most
 * populous tones are offered instead, 12 tones apart — a greyscale photograph
 * has a perfectly good theme here, since `rampChroma` tapers its floor away.
 *
 * **Monet decides the first four; the picture can offer four more** (the owner's request: four
 * options were too few, and a picture whose four all read as muddy left nothing worth taking).
 * Past `MONET_SEEDS`, `morePictureColours` fills the rest from the same quantised clusters —
 * still colours in the picture, never a style's transform of one.
 *
 * **Every offered colour defines a hue — chroma 15, not Monet's 5 — and that is what keeps two
 * crops of one picture on one answer.** A sketch on tinted paper is mostly one near-white cluster,
 * and at chroma 5 it sat on Monet's line: in one crop it passed and, on sheer share, took a place
 * in the four (`#f5f4fa`, the paper, offered as a theme); in a crop 5% smaller it did not, and the
 * hue sweep reshuffled the other three around the gap. At 15 the paper is never a candidate, so
 * neither crop's four depends on it (the owner's 111.png and 222.png). The shares stay the whole
 * picture's, as Monet counts them; a picture with no colour at 15 falls back to Monet's own 5.
 *
 * The caller downsamples; see `SAMPLE_AREA` in `lib/paletteLazy.ts`.
 */
export function sourceColorsFromPixels(pixels: Uint8ClampedArray, desired = MONET_SEEDS): string[] {
  /* ARGB, and only the opaque pixels: a transparent PNG's empty region is not a
     colour, and quantising it drags every candidate toward the clear colour. */
  const argb: number[] = [];
  for (let i = 0; i < pixels.length; i += 4) {
    if (pixels[i + 3] < 255) continue;
    argb.push((255 << 24) | (pixels[i] << 16) | (pixels[i + 1] << 8) | pixels[i + 2]);
  }
  if (argb.length === 0) return [];
  const quantised = quantizeCelebi(argb, 128);

  /* Monet's ranking over the colours that define a hue, then the picture's other colours; only
     a picture with no such colour at all falls back to Monet's own chroma floor. See the header. */
  const scored = scoreClusters(quantised);
  const monet = Math.min(desired, MONET_SEEDS);
  let ranked = monetPicks(scored, monet, THEME_MIN_CHROMA);
  if (ranked.length === 0) ranked = monetPicks(scored, monet, MONET_MIN_CHROMA);
  if (ranked.length > 0) {
    const seeds = [...ranked, ...morePictureColours(scored, ranked, desired - ranked.length)];
    return seeds.map((n) => hexFromArgb(n).toLowerCase());
  }

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

/** AOSP's `MAX_SEED_COLORS`, Monet's cap in `ColorScheme.getSeedColors`: the options it ranks. */
export const MONET_SEEDS = 4;

/* `Score`'s own arithmetic (`score.js`; its constants are private statics there), ported so the
   chroma floor is ours to set: a colour is credited for its 30° hue neighbourhood's share of the
   picture and for chroma past the A1 target. `scripts/testPalette.mjs` holds the port to the
   library's answers at Monet's own floor. */
const TARGET_CHROMA = 48;
const WEIGHT_PROPORTION = 0.7;
const WEIGHT_CHROMA_ABOVE = 0.3;
const WEIGHT_CHROMA_BELOW = 0.1;
const CUTOFF_EXCITED_PROPORTION = 0.01;
/** Monet's own chroma floor — here only the fallback for a picture with no colour at 15. */
export const MONET_MIN_CHROMA = 5;
/** An offered colour must define a hue: the bar a built-in theme's fill meets (ASSERTION 4). */
export const THEME_MIN_CHROMA = 15;
/** An extra must cover a visible share of the picture, so one stray cluster's colour is not offered. */
const EXTRA_MIN_SHARE = 0.002;
/** Two options of one hue are two options only this far apart in tone. */
const EXTRA_TONE_GAP = 12;
/** `Score`'s own floor for two options' hue difference. */
const EXTRA_HUE_GAP = 15;

export interface ScoredCluster {
  argb: number;
  hct: Hct;
  /** The cluster's own share of the picture. */
  share: number;
  /** Its 30° hue neighbourhood's share — what `Score` calls the proportion. */
  proportion: number;
  score: number;
}

/** Every cluster, scored as `Score` scores it and sorted best first (stable, as `Score` sorts). */
export function scoreClusters(quantised: Map<number, number>): ScoredCluster[] {
  let total = 0;
  for (const population of quantised.values()) total += population;
  const clusters = [...quantised].map(([argb, population]) => ({ argb, share: population / total, hct: Hct.fromInt(argb) }));
  const hueShare = new Array<number>(360).fill(0);
  for (const { hct, share } of clusters) hueShare[Math.floor(hct.hue) % 360] += share;
  const neighbourhood = new Array<number>(360).fill(0);
  for (let hue = 0; hue < 360; hue++) {
    for (let i = hue - 14; i < hue + 16; i++) neighbourhood[(i + 360) % 360] += hueShare[hue];
  }
  return clusters
    .map((cluster) => {
      const { chroma, hue } = cluster.hct;
      const proportion = neighbourhood[Math.round(hue) % 360];
      const weight = chroma < TARGET_CHROMA ? WEIGHT_CHROMA_BELOW : WEIGHT_CHROMA_ABOVE;
      return { ...cluster, proportion, score: proportion * 100 * WEIGHT_PROPORTION + (chroma - TARGET_CHROMA) * weight };
    })
    .sort((a, b) => b.score - a.score);
}

/**
 * Monet's picks: `Score`'s filter at the given chroma floor, then its sweep — the largest hue
 * difference, 90° down to 15°, at which `desired` candidates exist, or the 15° yield if none. Only
 * ever colours of the picture: where nothing passes the answer is empty, never Google Blue.
 */
export function monetPicks(scored: readonly ScoredCluster[], desired: number, minChroma: number): number[] {
  const passing = scored.filter(({ hct, proportion }) => hct.chroma >= minChroma && proportion > CUTOFF_EXCITED_PROPORTION);
  let chosen: ScoredCluster[] = [];
  for (let difference = 90; difference >= 15; difference--) {
    chosen = [];
    for (const cluster of passing) {
      if (!chosen.some((other) => differenceDegrees(cluster.hct.hue, other.hct.hue) < difference)) chosen.push(cluster);
      if (chosen.length >= desired) break;
    }
    if (chosen.length >= desired) break;
  }
  return chosen.map(({ argb }) => argb);
}

/**
 * Up to `count` more colours out of the picture, after Monet's own: ranked by `Score`'s arithmetic
 * without its 1% neighbourhood cutoff — the rule that kept a small vivid subject (an eye, a flower,
 * a ribbon) out of the four, and often the colour worth theming on — and floored instead at a real
 * hue and a visible share. First a hue the options do not have yet, then a clearly lighter or
 * darker tone of one they have (a deep and a pale pink are two themes), so a one-hue picture can
 * still offer choices without offering the same colour twice.
 */
function morePictureColours(scored: readonly ScoredCluster[], chosen: readonly number[], count: number): number[] {
  if (count <= 0) return [];
  const ranked = scored.filter(
    ({ argb, hct, share }) => hct.chroma >= THEME_MIN_CHROMA && share >= EXTRA_MIN_SHARE && !chosen.includes(argb),
  );
  const taken = chosen.map((argb) => Hct.fromInt(argb));
  const newHue = (hct: Hct) => taken.every((t) => differenceDegrees(hct.hue, t.hue) >= EXTRA_HUE_GAP);
  const newTone = (hct: Hct) =>
    taken.every((t) => differenceDegrees(hct.hue, t.hue) >= EXTRA_HUE_GAP || Math.abs(hct.tone - t.tone) >= EXTRA_TONE_GAP);
  const picked: number[] = [];
  for (const accepts of [newHue, newTone]) {
    for (const { argb, hct } of ranked) {
      if (picked.length >= count) return picked;
      if (picked.includes(argb) || !accepts(hct)) continue;
      picked.push(argb);
      taken.push(hct);
    }
  }
  return picked;
}

/**
 * The hue gap under which a second colour stops showing at container tone: two
 * hues 40° apart at tone 90 and chroma 16–20 render as one (the mascot's mauve and
 * lilac against her pink measured the same). An image's own partner has to clear it.
 */
export const MIN_ACCENT_GAP = 45;

/** One image-derived palette: a seed, and the 副色相 that goes with it. */
export interface ImageCombination {
  seed: string;
  /** The picture's own partner hue, or null for 自动 — the right-angle rule. */
  accent: number | null;
}

/**
 * The colour combinations in a picture, one per seed: the seed as `primary`, and
 * as its 副色相 the most chromatic *other* seed that asserts a hue, sits at least
 * `MIN_ACCENT_GAP` away and is not in a guarded band — the picture's own pairing.
 * A seed with no such partner takes 自动, and the dialog says so. On the mascot's
 * second render the first combination is pink and periwinkle — the mascot herself.
 */
export function imageCombinations(seeds: readonly string[]): ImageCombination[] {
  return seeds.map((seed) => {
    const own = hctOf(seed).hue;
    const partner = seeds
      .filter((other) => other !== seed)
      .map((other) => hctOf(other))
      .filter(
        (h) =>
          h.chroma >= MIN_SEED_CHROMA &&
          Math.abs(norm180(h.hue - own)) >= MIN_ACCENT_GAP &&
          !isGuardedHue(degree(h.hue)),
      )
      .sort((a, b) => b.chroma - a.chroma)[0];
    return { seed, accent: partner ? degree(partner.hue) : null };
  });
}

/**
 * `deriveCustomTheme` behind a bounded memo, for the server: the layout renders more
 * than once per page view under `<Link>` prefetching. Pure function, so plain
 * memoisation — no TTL; the cap stops a hostile cookie growing an unbounded map
 * (insertion order evicts).
 */
const derivedCache = new Map<string, DerivedTheme>();
const DERIVED_CACHE_MAX = 64;

export function deriveCustomThemeCached(spec: CustomSpec): DerivedTheme {
  const key = `${spec.seed}|${spec.accent ?? ''}`;
  const hit = derivedCache.get(key);
  if (hit) return hit;
  const derived = deriveCustomTheme(spec);
  derivedCache.set(key, derived);
  if (derivedCache.size > DERIVED_CACHE_MAX) {
    derivedCache.delete(derivedCache.keys().next().value as string);
  }
  return derived;
}
