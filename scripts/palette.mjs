// Regenerates the tonal roles in `app/globals.css`. Run: `node scripts/palette.mjs`
//
// Why this exists as a file. The recipe used to be prose at the top of globals.css —
// "generated from the brand seed by holding its hue and varying lightness across the
// M3 tone scale" — which is true, and which nobody can re-run. The cost showed up
// exactly where prose costs you: the neutral palette's chroma drifted to about a
// third of what the recipe called for, and no check could have caught it.
//
// Two things it is deliberately NOT:
//
//   - It does not write the CSS. `globals.css` interleaves ~40 paragraphs of
//     reasoning with these values, and a generator that owned the block would either
//     destroy them or have to parse them. It prints; you paste. The values stay plain
//     hex in the file for the reason stated there — the browser's own gamut mapping
//     drifts the out-of-gamut ends between engines.
//   - It does not touch anything off the tonal ramps: the four `*-fill` tones (tuned
//     against white ink), `accent-*` (a categorical OKLCH hue sweep owned by
//     lib/tagCategories.ts), the `media-*` roles, `scrim`, `link`, `plate-cool` and
//     `plate-warm`. Those are all argued for where they live.
//
// The basis is **HCT**, not the OKLCH the prose recipe used, because HCT is the space
// M3's own numbers are quoted in: "neutral chroma 6" means 6 in HCT, and converting
// that to an OKLCH chroma is an approximation that has to be redone per lightness.
// HCT also maps out-of-gamut colours by holding tone and dropping chroma, which is
// precisely the invariant this file needs — see ASSERTIONS below.
//
// `accent-*` stays in OKLCH and that is not an inconsistency: an even hue sweep at
// fixed lightness and chroma is the whole point of that scale, and OKLCH is where
// that relationship is expressible.

import {
  Hct,
  TonalPalette,
  argbFromHex,
  hexFromArgb,
} from '@material/material-color-utilities';

/** The brand seed. The one input. */
const SEED = '#e06c9f';

/**
 * `primary`'s tone, per scheme.
 *
 * AOSP puts primary at P40 light / P80 dark, and the direction is not arbitrary: the
 * brand has to separate from the surface it sits on, and that surface is near-white in
 * one scheme and near-black in the other. So the spec's light tone is the *darker* of
 * the two.
 *
 * This app inverts that on purpose — 61 light, 54 dark — because it holds the brand
 * pink itself rather than a tone of it, and a filled button that swaps shade with the
 * theme does not read as one material. 61 and 54 are close enough to read as the same
 * colour while each keeps a little separation from its own surface.
 *
 * The cost is stated once here and once in globals.css, because it is a real one and it
 * is not fixable without moving something: white ink on tone 61 is 3.08:1 and on 54 is
 * 3.88:1, both under the 4.5:1 AA floor for 14px text. That is the label of every
 * `filled` button, the active pagination number and the featured badge. Contrast is a
 * function of two colours, so the only levers are the fill and the ink — a single tone
 * at 48 would clear it (4.81:1 both schemes) at the price of a visibly deeper brand,
 * and darkening `on-primary` to P10 would clear it (5.71:1 / 4.54:1) at the price of a
 * dark wordmark and dark glyphs on the app bar. Neither is taken; the divergence is.
 */
const BRAND_TONE = { light: 61, dark: 54 };

/** M3 `SchemeTonalSpot`'s neutral chroma. Measured at ~1.6 in the file before this. */
const NEUTRAL_CHROMA = 6;

const hctOf = (hex) => Hct.fromInt(argbFromHex(hex));
const seed = hctOf(SEED);

/* Chroma per palette.
 *
 * `secondary` and `tertiary` are read off the values already in the file rather than
 * taken from TonalSpot's 16 and 24, because they are lower on purpose: the colour
 * section rests on "secondary is the muted rose two steps off primary", and the focus
 * ring is secondary. Reading them back means this script reproduces the current file
 * exactly for every role it is not meant to change, which is the only way to tell a
 * generated value from a hand-edited one.
 *
 * The semantic palettes carry their own hues and are read the same way. */
const measured = (hex) => {
  const h = hctOf(hex);
  return { hue: h.hue, chroma: h.chroma };
};

const PALETTES = {
  primary: TonalPalette.fromHueAndChroma(seed.hue, seed.chroma),
  secondary: (() => {
    const m = measured('#755360');
    return TonalPalette.fromHueAndChroma(m.hue, m.chroma);
  })(),
  tertiary: (() => {
    const m = measured('#894d1f');
    return TonalPalette.fromHueAndChroma(m.hue, m.chroma);
  })(),
  error: (() => {
    const m = measured('#a62a2c');
    return TonalPalette.fromHueAndChroma(m.hue, m.chroma);
  })(),
  success: (() => {
    const m = measured('#256f3b');
    return TonalPalette.fromHueAndChroma(m.hue, m.chroma);
  })(),
  warning: (() => {
    const m = measured('#7f5400');
    return TonalPalette.fromHueAndChroma(m.hue, m.chroma);
  })(),
  /* The one palette this run is meant to move. */
  neutral: TonalPalette.fromHueAndChroma(seed.hue, NEUTRAL_CHROMA),
  /* Read back, and asserted unchanged below: measured against M3's own output this
     one is already at ~97% of the spec's chroma 8, so moving it would turn a
     micro-adjustment into a re-skin. `outline` and the supporting-text role are the
     two most-repeated non-brand colours in the app. */
  neutralVariant: (() => {
    const m = measured('#7f7378');
    return TonalPalette.fromHueAndChroma(m.hue, m.chroma);
  })(),
};

const tone = (palette, t) => hexFromArgb(PALETTES[palette].tone(t));

/* The role → tone map, verbatim from AOSP's generated
   `ColorLightTokens.kt` / `ColorDarkTokens.kt`, VERSION v0_210. Fetch with:

     base=https://android.googlesource.com/platform/frameworks/support/+/refs/heads/\
     androidx-main/compose/material3/material3/src/commonMain/kotlin/androidx/compose/material3
     curl -s "$base/tokens/ColorLightTokens.kt?format=TEXT" | base64 -d

   Only the roles this app declares are listed. `on-primary` is white in both schemes
   rather than dark in the dark one, because `primary` does not invert here. */
const ROLES = [
  // token,                     palette,          light,       dark
  ['primary',                   'primary',        BRAND_TONE.light, BRAND_TONE.dark],
  ['on-primary',                'primary',        100,         100],
  ['primary-container',         'primary',        90,          30],
  ['on-primary-container',      'primary',        10,          90],
  ['inverse-primary',           'primary',        80,          40],

  ['secondary',                 'secondary',      40,          80],
  ['on-secondary',              'secondary',      100,         20],
  ['secondary-container',       'secondary',      90,          30],
  ['on-secondary-container',    'secondary',      10,          90],

  ['tertiary',                  'tertiary',       40,          80],
  ['on-tertiary',               'tertiary',       100,         20],
  ['tertiary-container',        'tertiary',       90,          30],
  ['on-tertiary-container',     'tertiary',       10,          90],

  ['error',                     'error',          40,          80],
  ['on-error',                  'error',          100,         20],
  ['error-container',           'error',          90,          30],
  ['on-error-container',        'error',          10,          90],

  // Not M3 slots; the app needs them and generates them the same way.
  ['success',                   'success',        40,          80],
  ['on-success',                'success',        100,         20],
  ['success-container',         'success',        90,          30],
  ['on-success-container',      'success',        10,          90],
  ['warning',                   'warning',        40,          80],
  ['on-warning',                'warning',        100,         20],
  ['warning-container',         'warning',        90,          30],
  ['on-warning-container',      'warning',        10,          90],

  ['surface',                   'neutral',        98,          6],
  ['surface-dim',               'neutral',        87,          6],
  ['surface-bright',            'neutral',        98,          24],
  ['surface-container-lowest',  'neutral',        100,         4],
  ['surface-container-low',     'neutral',        96,          10],
  ['surface-container',         'neutral',        94,          12],
  ['surface-container-high',    'neutral',        92,          17],
  ['surface-container-highest', 'neutral',        90,          22],
  ['on-surface',                'neutral',        10,          90],
  ['inverse-surface',           'neutral',        20,          90],
  ['inverse-on-surface',        'neutral',        95,          20],

  ['on-surface-variant',        'neutralVariant', 30,          80],
  ['outline',                   'neutralVariant', 50,          60],
  ['outline-variant',           'neutralVariant', 80,          30],
];

/* ---------------------------------------------------------------------------
 * What is in the file now
 * ------------------------------------------------------------------------ */

import { readFileSync, writeFileSync } from 'node:fs';

const css = readFileSync(new URL('../app/globals.css', import.meta.url), 'utf8');
const darkAt = css.indexOf('.dark {');
if (darkAt < 0) throw new Error('cannot find the .dark block in globals.css');

const current = { light: {}, dark: {} };
for (const m of css.matchAll(/--md-sys-color-([a-z-]+):\s*(#[0-9a-fA-F]{6})\s*;/g)) {
  current[m.index < darkAt ? 'light' : 'dark'][m[1]] = m[2].toLowerCase();
}

/* ---------------------------------------------------------------------------
 * Contrast, so a run can prove it moved nothing it was not asked to move
 * ------------------------------------------------------------------------ */

const luminance = (hex) => {
  const ch = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  const lin = ch.map((c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * lin[0] + 0.7152 * lin[1] + 0.0722 * lin[2];
};
const contrast = (a, b) => {
  const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
};

/** The pairs that are written down somewhere — globals.css, AGENTS.md, or both. */
const PAIRS = [
  ['primary', 'surface'],
  ['primary', 'surface-container-highest'],
  ['on-primary', 'primary'],
  ['secondary', 'surface'],
  ['secondary', 'surface-container-highest'],
  ['secondary', 'primary'],
  ['on-surface', 'surface'],
  ['on-surface-variant', 'surface'],
  ['outline', 'surface'],
  ['outline-variant', 'surface'],
  ['on-primary-container', 'primary-container'],
  ['on-secondary-container', 'secondary-container'],
  ['on-error-container', 'error-container'],
  ['on-success-container', 'success-container'],
  ['on-warning-container', 'warning-container'],
  /* Non-text pairs, 3:1 under WCAG 1.4.11 / 2.4.11. The first is the progress
     indicator against its own track and the slider's fill against the same; the
     second is the focused text field's 2px outline and the tab indicator. */
  ['primary', 'secondary-container'],
  ['primary', 'surface-container-low'],
];

/* ---------------------------------------------------------------------------
 * Run
 * ------------------------------------------------------------------------ */

const next = { light: {}, dark: {} };
const failures = [];

for (const [token, palette, lightTone, darkTone] of ROLES) {
  for (const [scheme, t] of [
    ['light', lightTone],
    ['dark', darkTone],
  ]) {
    const hex = tone(palette, t).toLowerCase();
    next[scheme][token] = hex;

    /* ASSERTION 1 — the emitted colour is actually at the tone asked for. HCT maps
       out-of-gamut values by holding tone and dropping chroma, so this should hold
       even at the saturated ends; if it ever does not, the ramp is lying about its
       own lightness and every contrast figure derived from it is unsafe. */
    const got = hctOf(hex).tone;
    if (Math.abs(got - t) > 0.5) {
      failures.push(`${scheme} ${token}: asked tone ${t}, got ${got.toFixed(2)}`);
    }
  }
}

/* ASSERTION 2 — the neutral-variant palette keeps its chroma.
 *
 * Measured against M3's own output this palette is already at ~97% of the spec's
 * chroma 8, so raising it would turn a micro-adjustment into a re-skin — and
 * `outline` plus the supporting-text role are the two most repeated non-brand colours
 * in the app. What is asserted is the *chroma*, not the hex: every value in the file
 * was originally generated in OKLCH, so re-deriving it in HCT moves each channel by a
 * step or two even when hue and chroma are held. That shift is the whole point of the
 * basis change; a chroma that moves by more than a point is not. The tolerance is one
 * point rather than a tenth because an OKLCH ramp at fixed chroma is *not* an HCT ramp
 * at fixed chroma — the two disagree slightly with lightness, so pinning one end
 * necessarily nudges the other. Measured here: the dark end moves 5.87 -> 6.63. */
for (const scheme of ['light', 'dark']) {
  for (const token of ['on-surface-variant', 'outline', 'outline-variant']) {
    const was = current[scheme][token];
    if (!was) continue;
    const before = hctOf(was);
    const after = hctOf(next[scheme][token]);
    if (Math.abs(after.chroma - before.chroma) > 1) {
      failures.push(
        `${scheme} ${token} chroma moved: ${before.chroma.toFixed(2)} -> ${after.chroma.toFixed(2)}`,
      );
    }
  }
}

const changed = [];
const same = [];
for (const [token] of ROLES) {
  for (const scheme of ['light', 'dark']) {
    const was = current[scheme][token];
    const now = next[scheme][token];
    if (!was) continue;
    (was === now ? same : changed).push({ scheme, token, was, now });
  }
}

const pad = (s, n) => String(s).padEnd(n);
console.log(`seed ${SEED}  hue ${seed.hue.toFixed(2)}  chroma ${seed.chroma.toFixed(2)}`);
console.log(`neutral chroma ${NEUTRAL_CHROMA}, brand tone ${BRAND_TONE}\n`);

console.log(`CHANGED (${changed.length})`);
for (const c of changed) {
  console.log(`  ${pad(c.scheme, 6)} ${pad(c.token, 26)} ${c.was} -> ${c.now}`);
}
console.log(`\nUNCHANGED (${same.length}) — the run reproduces these exactly`);
for (const c of same) console.log(`  ${pad(c.scheme, 6)} ${pad(c.token, 26)} ${c.was}`);

console.log('\nCONTRAST  pair                                        before   after');
for (const scheme of ['light', 'dark']) {
  for (const [a, b] of PAIRS) {
    const wasA = current[scheme][a];
    const wasB = current[scheme][b];
    const nowA = next[scheme][a] ?? wasA;
    const nowB = next[scheme][b] ?? wasB;
    if (!wasA || !wasB) continue;
    const before = contrast(wasA, wasB);
    const after = contrast(nowA, nowB);
    const flag = Math.abs(after - before) > 0.05 ? '  <- moved' : '';
    console.log(
      `  ${pad(scheme, 6)} ${pad(`${a} / ${b}`, 44)} ${before.toFixed(2).padStart(6)}  ${after
        .toFixed(2)
        .padStart(6)}${flag}`,
    );
  }
}

if (failures.length) {
  console.error(`\nFAILED (${failures.length}):`);
  for (const f of failures) console.error(`  ${f}`);
  process.exit(1);
}
console.log('\nassertions passed');

/* ---------------------------------------------------------------------------
 * `--write` — substitute the declarations in place
 *
 * Only the `--md-sys-color-<token>: #hex;` declarations are touched, one at a time,
 * matched on token *and* current value, **within the scheme's own block**. Every
 * comment, every non-tonal token and every rule in the file is left exactly as it was —
 * which is the whole reason this is a substitution rather than a block rewrite: ~40
 * paragraphs of reasoning live between these values.
 *
 * The split at `.dark {` is load-bearing rather than tidy. A token can legitimately
 * hold the *same* value in both schemes — `primary` did, while it was one tone — and
 * then `token + value` is not a unique key at all. Replacing globally in that state
 * rewrites both declarations to the light scheme's new value and silently loses the
 * dark one. Within a block the key is unique, and that is asserted rather than assumed.
 * --------------------------------------------------------------------------- */
if (process.argv.includes('--write')) {
  const halves = { light: css.slice(0, darkAt), dark: css.slice(darkAt) };
  let written = 0;
  for (const { scheme, token, was, now } of changed) {
    const needle = `--md-sys-color-${token}: ${was};`;
    const hits = halves[scheme].split(needle).length - 1;
    if (hits !== 1) {
      console.error(`\nrefusing to write: "${needle}" matches ${hits} times in ${scheme}`);
      process.exit(1);
    }
    halves[scheme] = halves[scheme].replace(needle, `--md-sys-color-${token}: ${now};`);
    written += 1;
  }
  writeFileSync(new URL('../app/globals.css', import.meta.url), halves.light + halves.dark);
  console.log(`\nwrote ${written} declarations to app/globals.css`);
}


