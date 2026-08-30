// Regenerates the tonal roles in `app/globals.css`. Run: `node scripts/palette.mjs`
//
// Why this exists as a file. The recipe used to be prose at the top of globals.css —
// "generated from the brand seed by holding its hue and varying lightness across the
// M3 tone scale" — which is true, and which nobody can re-run. The cost showed up
// exactly where prose costs you: the neutral palette's chroma drifted to about a
// third of what the recipe called for, and no check could have caught it.
//
// **The recipe itself is not here.** It is `lib/paletteRule.ts`, because three consumers
// need it and only one of them is a script: this file writes the ten built-in themes,
// `app/layout.tsx` derives the user's custom theme at SSR, and `lib/paletteLazy.ts`
// derives it again in the browser when they pick a new colour. A copy in each is how the
// three would drift. That module carries the whole argument for the rule — `primary` is a
// hex an artist drew, and the ramp, the harmony and the two inks are derived from it — and
// this file carries the eighteen hexes, the assertions, the report and the writes.
//
// Two things it is deliberately NOT:
//
//   - It does not write the *default* theme's CSS. `globals.css` interleaves ~40
//     paragraphs of reasoning with those values, and a generator that owned the block
//     would either destroy them or have to parse them. It prints; you paste — or
//     `--write` substitutes the declarations one at a time, matched on token *and*
//     current value. The nine character themes have no prose to protect and *are*
//     written, wholesale, to `app/theme-palettes.css`.
//     The values stay plain hex for the reason stated in globals.css — the browser's own
//     gamut mapping drifts the out-of-gamut ends between engines.
//   - It does not touch anything off the tonal ramps: the four `*-fill` tones (tuned
//     against white ink), `accent-*` (a categorical OKLCH hue sweep owned by
//     lib/tagCategories.ts), the `media-*` roles, `scrim`, and `glass-body` / `glass-sheen`
//     (the /about plate's own two colours and its specular, which are properties of that
//     material rather than of the theme — its *ink* follows `primary`, in `lib/flutedGlass.ts`).
//     Those are all argued for where they live. The semantic ramps — `error`, `success`,
//     `warning` — carry their own hues and are shared by all eleven themes verbatim,
//     because a severity that changes colour with the user's theme is not a severity.
//     `link` used to be on this list and is not: it is the brand hue at a text tone now,
//     so it rotates with the theme.
//
// `accent-*` stays in OKLCH and that is not an inconsistency: an even hue sweep at
// fixed lightness and chroma is the whole point of that scale, and OKLCH is where
// that relationship is expressible.
//
// ---------------------------------------------------------------------------
// The palette axis
//
// Ten built-in themes plus the user's own. Each built-in one is **two literal hexes from the
// MLP-VectorClub colour guide** — the character's coat Fill for the light scheme and the *same
// surface's Shadow Fill* for the dark one. Nothing computes them, nothing rounds them, and the
// report below emits them byte for byte. Everything else is a rule the eleven share, and that
// rule is `lib/paletteRule.ts`: the harmony, the role→tone map, the semantic ramps, and the
// three things still solved from those two fills (`on-primary` and the two inks).
//
// **This is the third answer and the first that survived looking at.** Both failures were
// reached by reasoning rather than by looking, which is why they are recorded:
//
//   - **The seed's own tone.** A seed's lightness is a property of the *artwork* — a pony is
//     drawn pale so a black outline reads against it — so taking it as the app bar's lightness
//     scattered the ten across tones 37–90 with no rule behind the scatter.
//   - **A rule: hue from the seed, tone from Material's own 500 row, chroma held to the
//     brand's.** Defensible, checkable, and it produced a series of ugly yellows: at every tone
//     that rule would visit, a yellow is either mud (desaturated at mid tone) or a shout
//     (saturated at high tone). In its first form it also pinned six of ten themes to the sRGB
//     gamut edge, which is neon beside a brand sitting at 67% of its own gamut.
//
// The colour that finally looked right was `#FAF5AB` — Fluttershy's actual coat, which an
// artist chose. So the rule stopped trying to *decide* the brand fill and started reading it.
//
// **The Shadow Fill is why the dark scheme needs no rule either.** Shading is the artist already
// answering "this same material, one step deeper", so the pair is guaranteed to read as one
// surface in two lights — which is what `primary` is specified to be here, since it does not
// invert between schemes. A computed tone shift is a second opinion about a question already
// answered, and measurably a worse one: the guide's own shadow values sit within 0.9–7.5° of
// hue for six of the nine, and where they drift (Rarity 22.9°, Applejack 14.7°, Chrysalis 12.0°)
// the drift *is* the artwork.
//
// ---------------------------------------------------------------------------
// Where a seed comes from
//
// The MLP-VectorClub colour guide, which extracts them from the show's own artwork. It is
// machine-readable — https://mlpvector.club/dist/mlpvc-colorguide.json, then
// `Appearances[id].ColorGroups[…].Colors[…]` — and **every one of the eighteen hexes below is
// one of its values, unaltered**. Verified against the live file; the `from` note on each entry
// names the group and the row.
//
// One detail of the guide is easy to miss and is why the `from` notes are as specific as they
// are: a coat is not a colour, it is *several labelled values* — Outline, Fill, Shadow Outline,
// Shadow Fill, and for some characters a fifth — where the Outline is the dark line drawn
// around the shape rather than the colour the character reads as. (Six of the nine carry four;
// Fluttershy, Lyra and Rarity have no Shadow Outline, and Applejack and Chrysalis add a
// Freckles / Blemishes value. Do not read the four as a parser contract.)
//
// Six characters take the coat, and three cannot. ASSERTION 4 is what picks those three:
//
//   - **Rarity's coat has no hue.** Fill `#EAEEF0` measures chroma 5.3 and its Outline
//     `#BDC1C2` measures 4.9 — a white pony, so there is nothing for a hue to be read from.
//     She takes her **mane**: Fill `#5E50A0` at chroma 46.2, with `#4A1767` for the dark. That
//     pair is the guide's own "Outline/Gradient Dark Fill" row rather than a Shadow Fill, which
//     is why its hue drifts 22.9° — the largest of the nine, and the artwork's answer.
//   - **Chrysalis's coat is black.** Fill `#2A2A2A` at chroma 1.0. She takes the **carapace**'s
//     upper gradient — `#1E837F` middle, `#00454A` front — the shell being the changeling
//     anatomy that is not black. Her mane `#1E5972` was the other candidate and sits 6.9° from
//     Rainbow Dash's coat; the carapace leaves 18.6° against Lyra and 32.0° against Rainbow.
//   - **Pinkie's coat is the brand.** Fill `#F5B7D0` is hue 353.2 against the brand's 355.7 —
//     the same colour, two degrees apart. She takes her **mane** `#EB458B` / `#BB1C76`, whose
//     chroma of 79.4 against the brand's 56.8 is what distinguishes the two themes; ASSERTION 5
//     names that pair as an exemption from the 15° bar for exactly this reason.
//
// **Luna takes her coat and not her mane, and that is a judgement rather than a derivation.**
// Coat Fill `#363E7A` is hue 280.3, which sits 13.8° from Rarity's mane and therefore needs
// ASSERTION 5's second exemption; her mane Fill `#1C4CC2` is 273.6 and would clear the bar
// outright at 20.5°. The coat was chosen anyway — she is a night-sky character and the two
// purples are separated by *tone* (28.5 against 39.0) where the brand and Pinkie are separated
// by chroma.
//
// Sorted by hue, the tightest gap that is not one of those two exemptions is **Lyra against
// Chrysalis at 18.6°**, comfortably over the bar. ASSERTION 5 checks all of it.
// ---------------------------------------------------------------------------

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
 * The ten built-in themes. `id` is the `data-palette` value; `seed` is the one input.
 *
 * `default` is first and its entry must never change: it is what proves a run still
 * reproduces globals.css. The rest are ordered by hue so the picker reads as a wheel.
 *
 * There is no third field, and that is the point — no per-theme tone, chroma or hue
 * override exists, and no seed is hand-mixed: every hex below is a value the colour guide
 * lists for that character. Which of its values, and why, is the table in the header.
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
 * Contrast, so a run can prove it moved nothing it was not asked to move
 *
 * `contrast` itself lives in `lib/paletteRule.ts`, which derives the brand tones from it
 * rather than only checking them.
 * ------------------------------------------------------------------------ */

/** The pairs that are written down somewhere — globals.css, AGENTS.md, or both.
 *
 * The third column is the WCAG floor that applies to *that* pair: 4.5:1 for normal-size
 * text (1.4.3), 3:1 for a non-text graphic or an indicator (1.4.11 / 2.4.11). It is here
 * so the ten-theme check can say "every theme clears whatever the default clears"
 * without hard-coding which pairs those are — three of them are known not to clear it and
 * are argued for in globals.css, and the check must not start failing on those. A pair
 * whose two schemes answer to different numbers writes `{ light, dark }`.
 *
 * The fourth column says how the ten are held to it, and the split is the whole of what
 * "consistent across themes" means now that the brand tone follows the hue:
 *
 *   spread   the tone map is identical for both members, so the pair varies only with hue.
 *            Held to ±SPREAD of the default. This is where the uniformity lives.
 *   floor    a brand member, so the value is a design consequence rather than a constant.
 *            Held to its own bar, per theme, with no spread.
 *   report   printed for review, asserted nowhere. Either the default already fails it
 *            (and says why in globals.css), or it measures a brand fill against a surface,
 *            which is exactly the quantity a hue-dependent brand tone is allowed to move.
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
  /* Non-text pairs, 3:1 under WCAG 1.4.11 / 2.4.11. The first is the progress
     indicator against its own track and the slider's fill against the same; the
     second is the focused text field's 2px outline and the tab indicator. */
  ['primary', 'secondary-container', 3, 'report'],
  ['primary', 'surface-container-low', 3, 'report'],
];

/* ---------------------------------------------------------------------------
 * Run
 * ------------------------------------------------------------------------ */

const failures = [];

/** themeId -> the whole DerivedTheme: `{ meta, light, dark }`. */
const generated = new Map(THEMES.map((t) => [t.id, deriveTheme(t.light, t.dark)]));

/* ASSERTION 1 — the emitted colour is actually at the tone asked for.
 *
 * HCT maps out-of-gamut values by holding tone and dropping chroma, so this should hold
 * even at the saturated ends; if it ever does not, the ramp is lying about its own
 * lightness and every contrast figure derived from it is unsafe. That matters more than it
 * looks: the brand derivation *reads* three tones per theme by measuring contrast on this
 * palette, so a ramp that misses its own tone would quietly move the brand itself rather
 * than only a reported figure. */
for (const theme of THEMES) {
  const g = generated.get(theme.id);
  for (const [token, , lightTone, darkTone] of ROLES) {
    for (const [scheme, raw] of [
      ['light', lightTone],
      ['dark', darkTone],
    ]) {
      /* Five roles are named rather than toned — `primary`, `on-primary` and the two inks
         are literal hexes or contrast solutions, so there is no tone they were asked for. */
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
 * `outline` and the supporting-text role are the two most repeated non-brand colours in the
 * app, so a palette that quietly drifts off its target re-skins the whole product. What is
 * asserted is the *chroma*, not the hex: every value in globals.css was originally generated
 * in OKLCH, so re-deriving it in HCT moves each channel by a step or two even when hue and
 * chroma are held. The tolerance is a full point rather than a tenth because an OKLCH ramp
 * at fixed chroma is *not* an HCT ramp at fixed chroma — the two disagree slightly with
 * lightness, so pinning one end necessarily nudges the other.
 *
 * It used to have a second form: the default theme's three tokens compared against
 * *globals.css's current values*, to catch a hand-edit. That form is gone, and its removal
 * is the point rather than a loss. It froze whatever chroma the file happened to hold — so
 * when `HARMONY` moved to M3's spec values (6.7 -> 8.0, a deliberate correction), the check
 * fired and, because failures are flushed before `--write` runs, **blocked the very write
 * that would have legitimised the change**. A guard that cannot be satisfied by the
 * sanctioned procedure is a guard that gets bypassed. The hand-edit case is already covered, and better:
 * the CHANGED/idempotence check on globals.css tests *every* token rather than three. */
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

/* The hue wheel, because the closest pair is the thing a new theme is most likely to
   break and no other line of this report would show it. */
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
 * This used to be one rule for every pair: no theme more than a quarter of a point from
 * the default. That was checkable only while the brand tone was shared, so the three kinds
 * are declared per pair in PAIRS above. `spread` is the same ±SPREAD test and still covers
 * everything whose tone map the ten share, which is every surface step, both neutral-variant
 * roles, the whole secondary/tertiary harmony, the semantic containers and the two link
 * roles — measured, the worst is 0.10. `floor` covers the two pairs a hue-dependent brand
 * tone is allowed to move: white-or-dark ink on the brand, and the brand's ink on the page.
 * `report` is printed and not asserted.
 *
 * Both asserted kinds also keep the original "no theme loses a bar the default clears",
 * which is what stops this from failing on the divergences globals.css argues for. */
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

/* ASSERTION 4 — a built-in fill defines a hue.
 *
 * This used to bound the seed's *tone* to 30–92, because the brand tone was the seed's own
 * and a near-white or near-black seed produced a theme whose largest surfaces could not be
 * told from the page. `primary` is a literal hex now, so that check is meaningless — and what
 * it was really catching all along was the other failure, which is still live: a
 * near-achromatic fill has no hue to rotate the palette by.
 *
 * It is the check that picks a character's row for them: Rarity's coat is #BDC1C2 at chroma
 * 4.7 and Chrysalis's is #2A2A2A at chroma 1.0, which is why those two take a mane and a
 * carapace.
 *
 * **It is a hard bar here and deliberately not one for the user's colour.** Ten themes chosen
 * from a colour guide can afford to insist on a hue; a person who wants a grey theme is not
 * making a mistake. `rampChroma` tapers its chroma floor to zero as a fill runs out of hue,
 * so a grey lands on a near-monochrome scheme rather than a grey bar over a randomly-hued
 * ramp — the taper is inert above this constant, so every theme below is unaffected by it.
 *
 * There is no assertion here that `on-primary` does not invert between schemes, and there
 * was one until it was noticed that it could not fail: the `on-primary` row in ROLES hands
 * the *same* `b.onPrimary` to both scheme columns, so the two are one lookup and are equal
 * by construction. What can actually go wrong is the choice being unjustified in one
 * scheme, and that is the `on-primary`/`primary` `floor` row in PAIRS. */
for (const theme of THEMES) {
  const { fillChroma } = generated.get(theme.id).meta;
  if (fillChroma < MIN_SEED_CHROMA) {
    failures.push(
      `${theme.id} light fill ${theme.light} is chroma ${fillChroma.toFixed(1)}, under` +
        ` ${MIN_SEED_CHROMA} — too close to grey to define a hue; pick a different row of the guide`,
    );
  }
}

/* ASSERTION 5 — the hue wheel has no coincident pair, and the two exemptions.
 *
 * Two themes at the same hue are two themes that look the same in the picker however
 * different their tones are, and the picker is a radiogroup of coloured circles with a
 * caption — the caption is not what anyone reads. The bar is 15°.
 *
 * Both exemptions are pairs that a *second* axis separates, which is why they are named
 * rather than the bar being lowered — a future theme still has to clear 15° on hue alone.
 *
 *   default / pinkie   4.2° apart, separated by **chroma**: 56.8 against 79.4, a dusty
 *                      rose beside a hot pink. Visible at equal hue where 4° is not.
 *   luna / rarity     13.8° apart, separated by **tone**: 露娜's coat Fill is tone 28 and
 *                      瑞瑞's mane Fill is 39, a near-navy beside an indigo. This one is a
 *                      deliberate trade — 露娜's *mane* would leave 20.5° and clear the bar
 *                      outright, and her coat was chosen over it anyway. */
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

/* ASSERTION 6 — the inks are one family even though the fills are not.
 *
 * This is the design claim of the natural-lightness rule, in checkable form. The fills
 * deliberately span a wide tone range so that each hue sits where it looks best; the
 * *inks* must not, because `primary-ink` is what a section heading's glyph, a checkbox's
 * box, a tab indicator, a slider's fill and a focused field's outline all take, and those
 * have to read as the same weight of mark in every theme. Measured, all ten land in 56–61.
 *
 * The band is asserted rather than the contrast, because contrast against the page is
 * already a `floor` row in PAIRS — what this adds is that the ten agree with *each other*,
 * which a per-theme floor cannot say. */
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
 * `DislikeAnalyzer` is MCU's own, and it encodes a published finding rather than a taste:
 * Palmer and Schloss (2010) measure a universal distaste for dark yellow-greens, which the
 * library defines as hue 90–111 at chroma > 16 and tone < 65. It is exactly the hole the
 * *previous* rule fell into — with `primary` pinned near tone 61, Fluttershy's hue can only be
 * `#a59401`, a dark olive — so this is the assertion that would have caught that revision's
 * worst output. Reading the fill off the artwork satisfies it by construction: her coat is
 * `#faf5ab` at tone 95. Kept as a guard on the next seed somebody adds. */
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
 * `HARMONY` and `NEUTRAL_CHROMA` in `lib/paletteRule.ts` spell out four numbers that M3 owns
 * (secondary 16, tertiary +60° at 24, neutral 6, neutralVariant 8), and until this existed
 * nothing checked them against the library at all: ASSERTION 2 compares emitted chroma against
 * *our own* constant, so it is self-referential and cannot see the two drifting apart. A
 * dependency bump that retuned TonalSpot would have passed every check in this file.
 *
 * So: build a real `SchemeTonalSpot` from each theme's fill and compare all four palettes at
 * every tone the role map uses. `primary` is deliberately excluded — the library pins it at a
 * flat chroma 36 and this app's is `rampChroma`, which is the documented divergence.
 *
 * It also covers the one mechanism difference: `paletteSet` writes `hue + 60` where the library
 * sanitises first, and three of the ten themes wrap past 360°. If that ever stopped being inert
 * this is what would say so. */
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
 * Neither has prose to protect, so both are owned outright: built here, compared on a
 * plain run, overwritten by `--write`. Comparing rather than only writing is what makes
 * `npm run colors` a verifier — a stale generated file is a failure, not a silent
 * disagreement between the CSS and the recipe.
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
// paint its own chrome before any stylesheet exists, so it has to be a literal. It used
// to be two literals hand-copied into \`viewport.themeColor\` in \`app/layout.tsx\`, with a
// comment calling them the app's only unavoidable ones; there are twenty now, which is
// past what a human keeps in step, so they are generated and the layout inlines them.
//
// Both are also the swatch's, for the picker in /settings: a swatch has to show a theme
// that is *not* the active one, so it cannot read the tokens — those are always the active
// theme's. \`onPrimary\` is there because the selected swatch carries a tick, and which ink that
// tick takes is a per-theme answer: five themes are white on their brand and five are dark.
//
// Four fields have been removed over time and every removal was the same rule: \`primary-container\`
// went, then \`surface\` when the swatch stopped drawing a ring behind the colour, then
// \`secondary\` and \`tertiary\` when the chip went back to one flat colour. A payload no consumer
// touches is a payload that goes stale silently, so it goes — and one a consumer needs is
// generated rather than hand-copied, which is the same rule read the other way.
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
