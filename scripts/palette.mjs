// Regenerates the tonal roles in `app/globals.css`. Run: `node scripts/palette.mjs`
//
// The recipe is `lib/paletteRule.ts`, not here: three consumers need it (this script,
// `app/layout.tsx` at SSR, `lib/paletteLazy.ts` in the browser) and a copy in each is how they
// would drift. This file carries the eighteen hexes, the assertions, the report and the writes.
//
// Two things it is deliberately NOT:
//
//   - It does not write the *default* theme's CSS. `globals.css` interleaves ~40 paragraphs of
//     reasoning with those values; `--write` substitutes the declarations one at a time, matched
//     on token *and* current value. The nine character themes have no prose to protect and are
//     written wholesale to `app/theme-palettes.css`. Values stay plain hex so the browser's own
//     gamut mapping cannot drift the out-of-gamut ends between engines.
//   - It does not touch anything off the tonal ramps: the four `*-fill` tones, `accent-*`
//     (a categorical OKLCH hue sweep owned by lib/tagCategories.ts), the `media-*` roles,
//     `scrim`, and `glass-body` / `glass-sheen` (the /about plate's own material; its ink follows
//     `primary` in `lib/flutedGlass.ts`). The semantic ramps — `error`, `success`, `warning` —
//     carry their own hues and are shared by all eleven themes verbatim: a severity that changes
//     colour with the theme is not a severity.
//
// The palette axis: ten built-in themes plus the user's own. Each built-in theme is **two literal
// hexes from the MLP-VectorClub colour guide** — the coat Fill for light, the same surface's
// Shadow Fill for dark. Nothing computes or rounds them. Everything else is the shared rule in
// `lib/paletteRule.ts` (harmony, role→tone map, semantic ramps, and `on-primary` + the two inks
// solved from the two fills). The Shadow Fill is why the dark scheme needs no rule: shading is
// the artist answering "one step deeper", which is exactly what `primary` is here.
//
// Where a seed comes from: the MLP-VectorClub colour guide
// (https://mlpvector.club/dist/mlpvc-colorguide.json, `Appearances[id].ColorGroups[…].Colors[…]`);
// every hex below is one of its values, unaltered. A coat is several labelled values — Outline,
// Fill, Shadow Outline, Shadow Fill — where the Outline is the dark line around a shape, not the
// colour the character reads as; cite the Fill row. Three characters have no usable coat and take
// the next feature the guide gives them (ASSERTION 4 picks them): Rarity her mane, Chrysalis her
// carapace, Pinkie her mane (her coat Fill is hue 353.2 against the brand's 355.7 — the same
// colour). Luna takes her coat over her mane deliberately: a night-sky character, and the two
// purples are separated by tone rather than hue (ASSERTION 5's second exemption).

import {
  DislikeAnalyzer,
  Hct,
  SchemeTonalSpot,
  hexFromArgb,
} from '@material/material-color-utilities';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';

import { requireTypeStripping } from './tsResolve.mjs';

requireTypeStripping('colors');

const {
  BRAND_SEED,
  BRAND_SEED_DARK,
  BRAND_CHROMA,
  CHROMA_REFERENCE_TONE,
  NEUTRAL_CHROMA,
  HARMONY,
  ROLES,
  THEMED_ROLES,
  CUSTOM_PALETTE,
  MIN_SEED_CHROMA,
  WHITE_INK_BAR,
  DARK_SEPARATION,
  LIGHT_INK,
  contrast,
  deriveTheme,
  hctOf,
  norm180,
  paletteBlocksCss,
  paletteSet,
  rampChroma,
} = await import('../lib/paletteRule.ts');

const SEED = BRAND_SEED;
const seed = hctOf(SEED);

/**
 * The ten built-in themes. `id` is the `data-palette` value; `seed` is the one input. `default`
 * is first and must never change — it is what proves a run still reproduces globals.css; the
 * rest are ordered by hue so the picker reads as a wheel. There is no third field on purpose: no
 * per-theme override exists, and every hex is a value the colour guide lists for that character.
 */
const THEMES = [
  { id: 'default', label: '默认', light: SEED, dark: BRAND_SEED_DARK, from: '品牌，无出处可取' },
  { id: 'applejack', label: '苹果嘉儿', light: '#FABA62', dark: '#EF9C54', from: '毛色 Fill / Shadow Fill' },
  { id: 'fluttershy', label: '小蝶', light: '#FAF5AB', dark: '#F3E488', from: '毛色 Fill / Shadow Fill' },
  { id: 'lyra', label: '天琴', light: '#8CFFDB', dark: '#62DFB2', from: '毛色 Fill / Shadow Fill' },
  { id: 'chrysalis', label: '邪茧', light: '#1E837F', dark: '#00454A', from: '甲壳上段 中段 / 前段' },
  { id: 'rainbow', label: '云宝黛西', light: '#9BDBF5', dark: '#8CC7E7', from: '毛色 Fill / Shadow Fill' },
  { id: 'luna', label: '露娜', light: '#363E7A', dark: '#282D5A', from: '毛色 Fill / Shadow Fill' },
  { id: 'rarity', label: '瑞瑞', light: '#5E50A0', dark: '#4A1767', from: '鬃毛 Fill / 渐变暗部' },
  { id: 'twilight', label: '暮光闪闪', light: '#CC9CDF', dark: '#BF89D1', from: '毛色 Fill / Shadow Fill' },
  { id: 'pinkie', label: '碧琪', light: '#EB458B', dark: '#BB1C76', from: '鬃毛 Fill / Outline' },
];

/* ---------------------------------------------------------------------------
 * What is in the file now
 * ------------------------------------------------------------------------ */

const css = readFileSync(new URL('../app/globals.css', import.meta.url), 'utf8');
const darkAt = css.indexOf('.dark {');
if (darkAt < 0) throw new Error('cannot find the .dark block in globals.css');

const current = { light: {}, dark: {} };
for (const m of css.matchAll(/--md-sys-color-([a-z-]+):\s*(#[0-9a-fA-F]{6})\s*;/g)) {
  current[m.index < darkAt ? 'light' : 'dark'][m[1]] = m[2].toLowerCase();
}

/* ---------------------------------------------------------------------------
 * Contrast — so a run can prove it moved nothing it was not asked to move.
 * ------------------------------------------------------------------------ */

/**
 * The pairs written down somewhere (globals.css, AGENTS.md, or both).
 *
 * Third column: the WCAG floor for *that* pair (4.5:1 text / 1.4.3, 3:1 non-text / 1.4.11,
 * 2.4.11), so the ten-theme check can say "every theme clears whatever the default clears"
 * without hard-coding which pairs those are — three are known not to clear it and are argued in
 * globals.css. A pair whose two schemes answer to different numbers writes `{ light, dark }`.
 *
 * Fourth column, how the ten are held to it:
 *   spread — shared tone map, held to ±SPREAD of the default (where uniformity lives)
 *   floor  — a brand member; held to its own bar per theme, no spread
 *   report — printed for review, asserted nowhere (default already fails it, or it measures a
 *            hue-dependent brand fill against a surface)
 */
const PAIRS = [
  ['primary', 'surface', 4.5, 'report'],
  ['primary', 'surface-container-highest', 4.5, 'report'],
  ['on-primary', 'primary', 3, 'floor'],
  ['primary-ink', 'surface', { light: LIGHT_INK, dark: DARK_SEPARATION }, 'floor'],
  ['primary-ink', 'surface-container-highest', 2.5, 'report'],
  ['link', 'surface', 4.5, 'spread'],
  ['link-hover', 'surface', 4.5, 'spread'],
  ['secondary', 'surface', 4.5, 'spread'],
  ['secondary', 'surface-container-highest', 4.5, 'spread'],
  ['secondary', 'primary', 3, 'report'],
  ['on-surface', 'surface', 4.5, 'spread'],
  ['on-surface-variant', 'surface', 4.5, 'spread'],
  ['outline', 'surface', 3, 'spread'],
  ['outline-variant', 'surface', 3, 'spread'],
  ['on-primary-container', 'primary-container', 4.5, 'spread'],
  ['on-secondary-container', 'secondary-container', 4.5, 'spread'],
  ['on-error-container', 'error-container', 4.5, 'spread'],
  ['on-success-container', 'success-container', 4.5, 'spread'],
  ['on-warning-container', 'warning-container', 4.5, 'spread'],
  /* Non-text pairs, 3:1: progress indicator vs its own track (and the slider's fill), and the
     focused field's 2px outline (and the tab indicator). */
  ['primary', 'secondary-container', 3, 'report'],
  ['primary', 'surface-container-low', 3, 'report'],
];

/* ---------------------------------------------------------------------------
 * Run
 * ------------------------------------------------------------------------ */

const failures = [];

/** themeId -> the whole DerivedTheme: `{ meta, light, dark }`. */
const generated = new Map(THEMES.map((t) => [t.id, deriveTheme(t.light, t.dark)]));

/* ASSERTION 1 — every emitted colour is actually at the tone asked for (skipping the five roles
 * that are literal hexes or contrast solutions rather than ramp positions).
 *
 * The brand derivation reads three tones per theme by measuring contrast on this palette, so a
 * ramp that misses its own tone would quietly move the brand itself, not just a reported figure. */
for (const theme of THEMES) {
  const g = generated.get(theme.id);
  for (const [token, , lightTone, darkTone] of ROLES) {
    for (const [scheme, raw] of [
      ['light', lightTone],
      ['dark', darkTone],
    ]) {
      /* Five roles are named rather than toned (literal hexes or contrast solutions). */
      if (typeof raw !== 'number') continue;
      const got = hctOf(g[scheme][token]).tone;
      if (Math.abs(got - raw) > 0.5) {
        failures.push(`${theme.id} ${scheme} ${token}: asked tone ${raw}, got ${got.toFixed(2)}`);
      }
    }
  }
}

/** The default theme's two role maps, i.e. what globals.css is compared against. */
const next = generated.get('default');

/* ASSERTION 2 — the neutral-variant palette is at the chroma the recipe asked for.
 *
 * `outline` and the supporting-text role are the two most repeated non-brand colours in the app.
 * The chroma is asserted, not the hex: the values were generated in OKLCH and re-derived in HCT,
 * and an OKLCH ramp at fixed chroma is not an HCT ramp at fixed chroma — hence a full-point
 * tolerance. There is deliberately no second form comparing against globals.css's current values:
 * it froze whatever the file happened to hold and once **blocked the very `--write` that would
 * have legitimised a sanctioned harmony change**. Hand-edits are covered by the
 * CHANGED/idempotence check on every token instead. */
const NV_TOKENS = ['on-surface-variant', 'outline', 'outline-variant'];
for (const theme of THEMES) {
  for (const scheme of ['light', 'dark']) {
    for (const token of NV_TOKENS) {
      const got = hctOf(generated.get(theme.id)[scheme][token]).chroma;
      if (Math.abs(got - HARMONY.neutralVariant.chroma) > 1) {
        failures.push(
          `${theme.id} ${scheme} ${token} chroma ${got.toFixed(2)} off target ${HARMONY.neutralVariant.chroma.toFixed(2)}`,
        );
      }
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
console.log(
  `neutral chroma ${NEUTRAL_CHROMA}. \`primary\` is not derived — both fills are literal` +
    ` colour-guide hexes. Derived: on-primary (white ≥ ${WHITE_INK_BAR} on *both* bars, else` +
    ` tone 20), ink light ≥ ${LIGHT_INK} on surface, ink dark ≥ ${DARK_SEPARATION} on the dark page`,
);
console.log(
  `ramp chroma: the light fill's own, floored at min(${BRAND_CHROMA.toFixed(1)}, gamut ceiling)` +
    ` measured at tone ${CHROMA_REFERENCE_TONE} — not at the fill's tone, or a tint's ramp goes grey`,
);
console.log(
  `harmony  secondary ${HARMONY.secondary.dHue.toFixed(2)}° C${HARMONY.secondary.chroma.toFixed(1)}` +
    `  tertiary ${HARMONY.tertiary.dHue.toFixed(2)}° C${HARMONY.tertiary.chroma.toFixed(1)}` +
    `  neutralVariant ${HARMONY.neutralVariant.dHue.toFixed(2)}° C${HARMONY.neutralVariant.chroma.toFixed(1)}\n`,
);

console.log('THEMES');
for (const theme of THEMES) {
  const g = generated.get(theme.id);
  const m = g.meta;
  console.log(
    `  ${pad(theme.id, 11)} ${pad(theme.label, 6)} ${m.light} / ${m.dark}` +
      `  hue ${m.hue.toFixed(1).padStart(5)}` +
      `  tone ${m.toneLight.toFixed(0).padStart(2)}/${m.toneDark.toFixed(0).padStart(2)}` +
      `  fill chroma ${m.fillChroma.toFixed(0).padStart(2)} -> ramp ${m.chroma.toFixed(0).padStart(2)}` +
      `  on-primary ${m.onPrimary === '#ffffff' ? 'white  ' : m.onPrimary}` +
      `  ${pad(theme.from, 24)}`,
  );
  console.log(
    `              ink ${m.inkLight} / ${m.inkDark}` +
      `${m.inkLight === m.light ? ' [ink == fill]' : ' [ink != fill]'}` +
      `  surface ${g.light.surface} / ${g.dark.surface}` +
      `  link ${g.light.link} / ${g.dark.link}` +
      `  bar/page ${contrast(m.light, g.light.surface).toFixed(2)} / ${contrast(m.dark, g.dark.surface).toFixed(2)}`,
  );
}

/* The hue wheel — the closest pair is what a new theme is most likely to break. */
const wheel = THEMES.map((t) => ({ id: t.id, hue: generated.get(t.id).meta.hue })).sort(
  (a, b) => a.hue - b.hue,
);
console.log('\n  hue order  ' + wheel.map((w) => `${w.id} ${w.hue.toFixed(1)}`).join('  ·  '));
console.log(
  '  gaps       ' +
    wheel
      .map((w, i) => {
        const prev = wheel[(i - 1 + wheel.length) % wheel.length];
        const gap = norm180(w.hue - prev.hue);
        return `${(gap < 0 ? gap + 360 : gap).toFixed(1)}`;
      })
      .join('  '),
);

console.log(`\nCHANGED (${changed.length})`);
for (const c of changed) {
  console.log(`  ${pad(c.scheme, 6)} ${pad(c.token, 26)} ${c.was} -> ${c.now}`);
}
console.log(`\nUNCHANGED (${same.length}) — the run reproduces these exactly`);
for (const c of same) console.log(`  ${pad(c.scheme, 6)} ${pad(c.token, 26)} ${c.was}`);

console.log('\nCONTRAST — default theme, file vs run');
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

/* ASSERTION 3 — the ten are consistent where consistency is constructible.
 *
 * Three kinds declared per pair in PAIRS: `spread` (±SPREAD of the default — every surface step,
 * both neutral-variant roles, the secondary/tertiary harmony, the semantic containers, the link
 * roles; measured worst 0.10), `floor` (the two pairs a hue-dependent brand tone may move), and
 * `report` (printed, not asserted). Both asserted kinds also keep "no theme loses a bar the
 * default clears", so the divergences globals.css argues for do not fail the run. */
const SPREAD = 0.25;
console.log(`\nCONTRAST MATRIX — every theme against the default, tolerance ±${SPREAD}`);
for (const scheme of ['light', 'dark']) {
  console.log(`  ${scheme}`);
  for (const [a, b, rawBar, kind] of PAIRS) {
    const ref = contrast(next[scheme][a], next[scheme][b]);
    const bar = typeof rawBar === 'object' ? rawBar[scheme] : rawBar;
    const cells = [];
    for (const theme of THEMES) {
      const g = generated.get(theme.id)[scheme];
      const v = contrast(g[a], g[b]);
      if (theme.id !== 'default') {
        const d = v - ref;
        cells.push(
          `${theme.id.slice(0, 4)} ${v.toFixed(2)}${d >= 0 ? '+' : '-'}${Math.abs(d).toFixed(2)}`,
        );
      }
      if (kind === 'spread') {
        if (Math.abs(v - ref) > SPREAD) {
          failures.push(
            `${theme.id} ${scheme} ${a}/${b}: ${v.toFixed(2)} vs default ${ref.toFixed(2)}`,
          );
        }
        if (ref >= bar && v < bar) {
          failures.push(`${theme.id} ${scheme} ${a}/${b}: ${v.toFixed(2)} under ${bar}:1 (default clears it)`);
        }
      }
      if (kind === 'floor' && v < bar) {
        failures.push(`${theme.id} ${scheme} ${a}/${b}: ${v.toFixed(2)} under the ${bar}:1 floor`);
      }
    }
    console.log(
      `    ${pad(kind, 7)}${pad(`${a} / ${b}`, 42)} ref ${ref.toFixed(2).padStart(5)}  ${cells.join('  ')}`,
    );
  }
}

/* ASSERTION 4 — a built-in fill defines a hue (chroma ≥ MIN_SEED_CHROMA).
 *
 * The check that picks a character's row for them: Rarity's coat is chroma 5.3 and Chrysalis's
 * 1.0, which is why those two take a mane and a carapace. Hard bar for the ten built-ins;
 * deliberately not applied to the user's colour — a person who wants a grey theme is not making a
 * mistake. `rampChroma` tapers its chroma floor to zero as a fill runs out of hue (inert above
 * this constant), so a grey lands on a near-monochrome scheme rather than a grey bar over a
 * randomly-hued ramp.
 *
 * No assertion here that `on-primary` does not invert between schemes — it cannot fail, since
 * both scheme columns get the same lookup. The `on-primary`/`primary` `floor` row in PAIRS is
 * what guards the choice. */
for (const theme of THEMES) {
  const { fillChroma } = generated.get(theme.id).meta;
  if (fillChroma < MIN_SEED_CHROMA) {
    failures.push(
      `${theme.id} light fill ${theme.light} is chroma ${fillChroma.toFixed(1)}, under` +
        ` ${MIN_SEED_CHROMA} — too close to grey to define a hue; pick a different row of the guide`,
    );
  }
}

/* ASSERTION 5 — the hue wheel has no coincident pair (15° bar), with two exemptions.
 *
 * Two themes at the same hue look the same in the picker however different their tones. Both
 * exemptions are pairs a *second* axis separates, so the bar itself is never lowered — a future
 * theme still has to clear 15° on hue alone:
 *   default / pinkie  4.2°, separated by chroma (56.8 vs 79.4)
 *   luna / rarity     13.8°, separated by tone (28 vs 39) — a deliberate trade
 */
const HUE_BAR = 15;
const HUE_EXEMPT = [
  ['default', 'pinkie'],
  ['luna', 'rarity'],
];
for (let i = 0; i < wheel.length; i += 1) {
  const a = wheel[i];
  const b = wheel[(i + 1) % wheel.length];
  const gap = Math.abs(norm180(b.hue - a.hue));
  const exempt = HUE_EXEMPT.some((pair) => pair.includes(a.id) && pair.includes(b.id));
  if (gap < HUE_BAR && !exempt) {
    failures.push(
      `${a.id} and ${b.id} are ${gap.toFixed(1)}° apart in hue, under the ${HUE_BAR}° bar` +
        ' — one of them needs a different row of the colour guide',
    );
  }
}

/* ASSERTION 6 — every `primary-ink` is chroma ≥ 35.
 *
 * The checkable form of the `CHROMA_REFERENCE_TONE` argument: the ramp's chroma is measured at
 * tone 61, not the fill's own tone, so a pale fill cannot produce a greyed ink — the glyph,
 * checkbox, tab indicator and focused-outline colour must stay one family of marks across all
 * ten. Contrast against the page is already a `floor` row in PAIRS; what this adds is that the
 * ten agree with each other. */
const INK_CHROMA_FLOOR = 35;
for (const theme of THEMES) {
  const { inkLight } = generated.get(theme.id).meta;
  const c = hctOf(inkLight).chroma;
  if (c < INK_CHROMA_FLOOR) {
    failures.push(
      `${theme.id} primary-ink ${inkLight} is chroma ${c.toFixed(1)}, under ${INK_CHROMA_FLOOR} —` +
        ' the ramp is being read at the fill own tone somewhere, and a tint has no chroma there',
    );
  }
}

/* ASSERTION 7 — no theme's brand fill is a colour people reliably dislike.
 *
 * `DislikeAnalyzer` (MCU's own) encodes Palmer & Schloss 2010: a universal distaste for dark
 * yellow-greens — hue 90–111, chroma > 16, tone < 65. The exact hole an earlier seed rule fell
 * into (pinned near tone 61, Fluttershy's hue could only be a dark olive). Reading fills off the
 * artwork satisfies it by construction; kept as a guard on the next seed somebody adds. */
for (const theme of THEMES) {
  const hex = generated.get(theme.id).light.primary;
  if (DislikeAnalyzer.isDisliked(hctOf(hex))) {
    failures.push(
      `${theme.id} primary ${hex} is in the disliked yellow-green band (hue 90–111, tone < 65) —` +
        ' pick a different row of the colour guide for it',
    );
  }
}

/* ASSERTION 8 — the harmony is the library's `SchemeTonalSpot`, not our transcription of it.
 *
 * ASSERTION 2 compares emitted chroma against *our own* constant, so it is self-referential; a
 * dependency bump that retuned TonalSpot would have passed every other check in this file. This
 * builds a real `SchemeTonalSpot` per theme and compares all four palettes at every tone the
 * role map uses. `primary` is excluded — the library pins it at chroma 36 and this app's is
 * `rampChroma` (the documented divergence). Also covers the one mechanism difference:
 * `paletteSet` writes `hue + 60` where the library sanitises first, and three themes wrap past
 * 360°. */
const TONES_USED = [...new Set(ROLES.map(([, , l]) => l).concat(ROLES.map(([, , , d]) => d)))]
  .filter((t) => typeof t === 'number')
  .sort((a, b) => a - b);

for (const theme of THEMES) {
  const fill = hctOf(generated.get(theme.id).light.primary);
  const spec = new SchemeTonalSpot(Hct.from(fill.hue, fill.chroma, fill.tone), false, 0);
  const ours = paletteSet(fill.hue, rampChroma(fill.hue, fill.chroma));
  for (const name of ['secondary', 'tertiary', 'neutral', 'neutralVariant']) {
    for (const tone of TONES_USED) {
      const mine = ours[name].tone(tone);
      const theirs = spec[`${name}Palette`].tone(tone);
      if (mine !== theirs) {
        failures.push(
          `${theme.id} ${name} at tone ${tone} is ${hexFromArgb(mine)} where SchemeTonalSpot` +
            ` says ${hexFromArgb(theirs)} — HARMONY has drifted from the library`,
        );
      }
    }
  }
}

/* ---------------------------------------------------------------------------
 * The two generated files
 *
 * Neither has prose to protect, so both are owned outright: built here, compared on a plain run,
 * overwritten by `--write`. Comparing is what makes `npm run colors` a verifier — a stale
 * generated file is a failure, not a silent disagreement between the CSS and the recipe.
 * ------------------------------------------------------------------------ */

const CHARACTER_THEMES = THEMES.filter((t) => t.id !== 'default');

const paletteCss = (() => {
  const lines = [
    '/* Generated by scripts/palette.mjs — do not edit. Run `npm run colors:write`.',
    ' *',
    ' * The nine character palettes. Each is a *partial* override of `:root`: only the roles',
    ' * whose palette rotates with the seed are here. The semantic ramps (error / success /',
    ' * warning), the categorical `accent-*` scale, the `media-*` roles, `scrim` and the',
    ' * `glass-body` / `glass-sheen` pair are shared by every theme and stay in globals.css —',
    ' * a severity that changed colour with the theme would not be a severity, a tag category',
    " * that did would not be a category, and a material's own body and highlight are not",
    ' * brand colours. What the /about plate takes from the palette is its *ink*, which reads',
    ' * `primary` at run time rather than through a token of its own.',
    ' *',
    " * The default theme is `:root` itself, so there is no `[data-palette='default']` block:",
    ' * choosing it simply stops matching any of these. The eleventh palette is the user’s own',
    " * and is not here either — `app/layout.tsx` renders its two blocks into <head> from the",
    ' * seed in their cookie, through the same `paletteBlocksCss` that shapes these.',
    ' *',
    ' * Every block declares the **same** set of names, and that is what makes the arrangement',
    ' * safe rather than merely working: `html[data-palette=x]` (0,1,1) also outranks `.dark`',
    ' * (0,1,0), so a name present in a light block and missing from its dark twin would paint',
    ' * its light value in dark mode with no `.dark` rule able to win it back. One loop over',
    ' * `THEMED_ROLES` emits all eighteen blocks, so the two halves cannot diverge.',
    ' *',
    ' * The selectors carry `html` on purpose. `@import` has to come before any rule, so these',
    ' * blocks land *above* `:root` in the cascade, and `:root` and `[data-palette=x]` are both',
    ' * specificity (0,1,0) — source order would decide, and it would decide wrong. With the',
    ' * element name they are (0,1,1) and (0,2,1), which beats `:root` and `.dark` whatever the',
    ' * order. */',
    '',
  ];
  for (const theme of CHARACTER_THEMES) {
    const g = generated.get(theme.id);
    const m = g.meta;
    lines.push(
      `/* ${theme.label} — ${theme.from}. fill ${m.light} / ${m.dark},` +
        ` hue ${m.hue.toFixed(1)}, ramp chroma ${m.chroma.toFixed(1)},` +
        ` ink ${m.inkLight} / ${m.inkDark},` +
        ` on-primary ${m.onPrimary === '#ffffff' ? 'white' : m.onPrimary} */`,
    );
    lines.push(paletteBlocksCss(theme.id, g));
    lines.push('');
  }
  return lines.join('\n');
})();

const themeColorsTs = (() => {
  const entries = THEMES.map((theme) => {
    const g = generated.get(theme.id);
    const shape = (scheme) =>
      `{ primary: '${g[scheme].primary}', onPrimary: '${g[scheme]['on-primary']}' }`;
    return [
      '  {',
      `    id: '${theme.id}',`,
      `    label: '${theme.label}',`,
      `    light: ${shape('light')},`,
      `    dark: ${shape('dark')},`,
      '  },',
    ].join('\n');
  });
  return `// Generated by scripts/palette.mjs — do not edit. Run \`npm run colors:write\`.
//
// Two hexes per theme per scheme, for the two places a \`var()\` cannot reach.
//
// \`primary\` is the \`<meta name="theme-color">\` value: the browser reads that tag to
// paint its own chrome before any stylesheet exists, so it has to be a literal, generated
// rather than hand-copied. Both are also the swatch's, for the picker in /settings: a swatch has
// to show a theme that is *not* the active one, so it cannot read the tokens — those are always
// the active theme's. \`onPrimary\` is there because the selected swatch carries a tick, and which
// ink that tick takes is a per-theme answer: five themes are white on their brand and five are
// dark. Fields no consumer touches go; fields a consumer needs are generated — the same rule read
// both ways.
//
// The eleventh palette is **not** in this array and must not be: its colours come from the
// user's own seed, so there is nothing to generate. It is here only as an id, because
// \`PaletteId\` is what every consumer validates against and a union that cannot express the
// palette the user has chosen is a union that silently downgrades them to the default. The
// derivation lives in \`lib/paletteRule.ts\`; this file stays free of it so that importing a
// swatch colour does not pull HCT into every route.

export interface PaletteScheme {
  primary: string;
  onPrimary: string;
}

export interface PaletteEntry {
  id: string;
  label: string;
  light: PaletteScheme;
  dark: PaletteScheme;
}

export const PALETTES = [
${entries.join('\n')}
] as const satisfies readonly PaletteEntry[];

/** The user's own palette. Mirrors \`CUSTOM_PALETTE\` in \`lib/paletteRule.ts\`. */
export const CUSTOM_PALETTE = '${CUSTOM_PALETTE}';

export type BuiltInPaletteId = (typeof PALETTES)[number]['id'];
export type PaletteId = BuiltInPaletteId | typeof CUSTOM_PALETTE;

export const DEFAULT_PALETTE: PaletteId = '${THEMES[0].id}';

const IDS: readonly string[] = PALETTES.map((p) => p.id);

export function isPaletteId(value: unknown): value is PaletteId {
  return typeof value === 'string' && (value === CUSTOM_PALETTE || IDS.includes(value));
}
`;
})();

const CSS_PATH = new URL('../app/theme-palettes.css', import.meta.url);
const TS_PATH = new URL('../lib/generated/themeColors.ts', import.meta.url);

const readOrNull = (url) => {
  try {
    return readFileSync(url, 'utf8');
  } catch {
    return null;
  }
};

/* Compared with newlines normalised, and that is not fastidiousness.
 *
 * The repo has `core.autocrlf=true`, so git checks these two files out CRLF while this
 * script writes them LF. A raw byte compare therefore reports both stale on a *clean* tree,
 * forever, from the first fresh clone — and `colors:write` would then rewrite them LF and
 * produce a whole-file diff. `globals.css` is immune because it is patched declaration by
 * declaration rather than rewritten. There is also a `.gitattributes` pinning both to
 * `eol=lf`, which fixes the working tree; this fixes the check even where that file has not
 * been applied yet. */
const sameText = (a, b) => a.replace(/\r\n/g, '\n') === b.replace(/\r\n/g, '\n');

const writing = process.argv.includes('--write');
if (!writing) {
  for (const [url, want, name] of [
    [CSS_PATH, paletteCss, 'app/theme-palettes.css'],
    [TS_PATH, themeColorsTs, 'lib/generated/themeColors.ts'],
  ]) {
    const got = readOrNull(url);
    if (got === null) failures.push(`${name} is missing — run \`npm run colors:write\``);
    else if (!sameText(got, want)) failures.push(`${name} is stale — run \`npm run colors:write\``);
  }

  /* And the same standard for `globals.css`, which used to be exempt.
   *
   * `changed` was printed and handed to `--write`, and nothing else: a hand-edited
   * `--md-sys-color-*` in that file was listed under CHANGED and the run still exited 0 —
   * while AGENTS.md claimed idempotence against it as *the* check that those values are
   * still the recipe's output rather than someone's edit. The two generated files were held
   * to that standard and the one with prose in it was not, which is the wrong way round:
   * it is the file a person can plausibly edit by hand. A legitimate re-seed goes through
   * `colors:write`, which is exactly the message. */
  if (changed.length > 0) {
    failures.push(
      `app/globals.css has ${changed.length} declaration(s) that are not the recipe's output` +
        ' — see CHANGED above, then run `npm run colors:write`',
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
if (writing) {
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

  writeFileSync(CSS_PATH, paletteCss);
  mkdirSync(new URL('../lib/generated/', import.meta.url), { recursive: true });
  writeFileSync(TS_PATH, themeColorsTs);
  console.log(
    `wrote ${CHARACTER_THEMES.length} palettes (${THEMED_ROLES.length} roles × 2 schemes each)` +
      ' to app/theme-palettes.css and lib/generated/themeColors.ts',
  );
}
