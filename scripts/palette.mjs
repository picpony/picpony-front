// Palette CSS: a plain invocation verifies; --write installs; --output-dir=PATH exports for review.
//
// The recipe is `lib/paletteRule.ts`, not here: three consumers need it (this script,
// `app/layout.tsx` at SSR, `lib/paletteLazy.ts` in the browser) and a copy in each is how they
// would drift. This file carries the ten themes' decisions, the assertions, the report and the
// writes.
//
// Two things it is deliberately NOT:
//
//   - It does not write the *default* theme's CSS wholesale. `globals.css` interleaves ~40
//     paragraphs of reasoning with those values; `--write` substitutes the declarations one at a
//     time, matched on token *and* current value. The other blocks have no prose to protect and
//     are written wholesale to `app/theme-palettes.css`. Values stay plain hex so the browser's own
//     gamut mapping cannot drift the out-of-gamut ends between engines.
//   - It does not touch anything off the tonal ramps: the four `*-fill` tones, `accent-*`
//     (a categorical OKLCH hue sweep owned by lib/tagCategories.ts), the `media-*` roles,
//     `scrim`, and `glass-body` / `glass-sheen` (the /about plate's own material; its ink follows
//     `primary` in `lib/flutedGlass.ts`). The semantic ramps — `error`, `success`, `warning` —
//     carry their own hues and are shared by all eleven themes verbatim: a severity that changes
//     colour with the theme is not a severity.
//
// The palette axis: ten built-in themes plus the user's own, each in two 配色方案 — 多色 (the
// default) and 单色. A built-in theme is **decided with the artwork beside it**, not transcribed
// from it:
//
//   - `primary`: the character's hue off the colour guide, at a tone chosen for the largest area
//     on screen — a pale group under dark ink or a deep group under white, clear of the middle
//     band where neither ink reaches 4.5:1. Direction A uses 0.96 of the available gamut, capped
//     at C36, for light fills; deep cool fills use 0.72, capped at C48. The dark fill uses the
//     same rule at `DARK_SHIFT` tones deeper —
//     the brand's own step. Until decision 27 the fills were the guide's literal hexes: read off
//     the artwork, several sat at the gamut's edge (天琴 1.00 of the ceiling, 邪茧 0.94) and read
//     as neon at app-bar size, and four put their bar's text under 4.5:1. The brand's pair was
//     given until the owner brought it under the same rule (ASSERTION 18 holds the two literals
//     `lib/paletteSpec.ts` must keep to what that decision renders).
//   - 多色's second colour and accent: two hues off the same character's art, each one cited.
//     The default theme's come off the mascot, whose coat also gives it its 多色 neutrals.
//
// Everything else is the shared rule in `lib/paletteRule.ts`.
//
// Where a hue comes from: the MLP-VectorClub colour guide
// (https://mlpvector.club/dist/mlpvc-colorguide.json, `Appearances[id].ColorGroups[…].Colors[…]`).
// A coat is several labelled values — Outline, Fill, Shadow Outline, Shadow Fill — where the Outline
// is the dark line around a shape, not the colour a character reads as; cite the Fill row. Two
// characters have no usable coat and take the next feature the guide gives them (ASSERTION 4 picks
// them): Rarity her mane, Chrysalis her carapace. Pinkie takes her coat, at a tone well above the
// brand's (ASSERTION 5's first exemption): her mane's raspberry could only become a quiet large
// area in the middle band. Luna takes her coat over her mane deliberately: a night-sky character,
// and the two purples are separated by tone rather than hue (the second exemption).

import {
  DislikeAnalyzer,
  Hct,
  SchemeTonalSpot,
  argbFromHex,
  hexFromArgb,
  labFromArgb,
} from '@material/material-color-utilities';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

import { requireTypeStripping } from './tsResolve.mjs';

requireTypeStripping('colors');

const rule = await import('../lib/paletteRule.ts');
const { clearColorAt, clearChromaAt } = await import('../lib/clearColor.ts');
const {
  BRAND_RAMP_SEED,
  BRAND_SEED,
  BRAND_SEED_DARK,
  BRAND_CHROMA,
  CHROMA_REFERENCE_TONE,
  NEUTRAL_CHROMA,
  HARMONY,
  ROLES,
  MULTI_TONES,
  CUSTOM_PALETTE,
  MIN_SEED_CHROMA,
  ON_PRIMARY_VARIANT_FLOOR,
  ON_PRIMARY_VARIANT_SHARE,
  ON_PRIMARY_VARIANT_TINT_CHROMA,
  DARK_SHIFT,
  HUE_GUARDS,
  SECOND_AREA_CAP,
  SECOND_CLARITY,
  SPARK_TONE,
  FACE_ROLES,
  contrast,
  deepSecondChroma,
  deriveCustomTheme,
  deriveTheme,
  hctOf,
  hexFromHct,
  isGuardedHue,
  maxChroma,
  monoTokens,
  norm180,
  paletteBlocksCss,
  paletteSet,
  rampChroma,
  themeFace,
} = rule;

/**
 * The ten built-in themes. `id` is the `data-palette` value. `default` is first — it is the theme
 * globals.css's declarations are compared against; the rest are ordered by hue so the picker
 * reads as a wheel.
 *
 * `fill` is the primary's decision — the guide's hue, a tone and a light/deep register under
 * direction A's shared `clearColorAt` rule; the brand's is the mascot's mane, like a character's
 * coat (ASSERTION 18). `second` and `spark` are 多色's two
 * hues, each read off the same character; `neutral` is the default's coat, its 多色 page.
 * `second.chroma` is the **tint's**: the light scheme's containers wear it, and the dark scheme's
 * take the clear shade the same hue allows (`deepSecondChroma`, ASSERTION 17).
 */
const THEMES = [
  {
    id: 'default',
    label: '默认',
    fill: { hue: 5.4, tone: 86, register: 'light' },
    from:
      '吉祥物鬃毛 #E06C9F（H355.7）向珊瑚方向偏 9.7° 至 H5.4：A 的暖色上沿 T86。' +
      '偏转是为与碧琪（H353 T82）在浅、深两色方案都拉开 ΔE ≥ 6（6.9 / 6.1）：原色相在 T82–T86 与她仅差 ΔE 0.9–4.7',
    second: { hue: 272, chroma: 18, from: 'mascot2 毛色暗部 #BFC3E0（H276，约 8% 像素）与蝴蝶结之间：长春花薰衣草' },
    spark: { hue: 268, chroma: 36, from: '两张吉祥物图的蝴蝶结 H270 / H267（各约 1% 像素）：长春花蓝' },
    neutral: { light: 48, dark: 285, from: '光下取两张图的奶油毛色 H51 / H46，影中取毛色暗部 H276 与薰衣草 H298 之间' },
  },
  {
    id: 'applejack',
    label: '苹果嘉儿',
    fill: { hue: 73, tone: 86, register: 'light' },
    from: '毛色 Fill #FABA62（H73）：A 的暖金浅色下沿 T86，保留苹果嘉儿的金橙色相',
    second: { hue: 130, chroma: 16, from: '可爱标志的叶子 #6BB944（H138）与眼睛（H142），向黄侧移到 H130：淡叶色' },
    spark: { hue: 130, chroma: 40, from: '叶子 H130，离 success 足够远；金色鬃毛落在橄榄区' },
  },
  {
    id: 'fluttershy',
    label: '小蝶',
    fill: { hue: 95, tone: 92, register: 'light' },
    from: '毛色 Fill #FAF5AB（T95.4），保留已定 H95 黄油色：A 的黄色上沿 T92',
    second: { hue: 352, chroma: 18, from: '鬃毛 Fill #F3B5CF（H352）：玫瑰粉' },
    spark: { hue: 192, chroma: 36, from: '可爱标志的蝴蝶 #69C8C3（H193）与眼睛 #02ACA4（H191）：蝴蝶青' },
  },
  {
    id: 'lyra',
    label: '天琴',
    fill: { hue: 172, tone: 88, register: 'light' },
    from: '毛色 Fill #8CFFDB（H174 T92.7）：A 的薄荷上沿 T88，大面积彩度上限 C36',
    second: { hue: 50, chroma: 14, from: '眼睛渐变顶端 #E66100（H44.5）的淡色，向黄 5°：杏色（鬃毛的水青离主色只有 28°，看不出）' },
    spark: { hue: 44, chroma: 40, from: '眼睛渐变顶端 #E66100（H44.5）：竖琴的金离 warning 只有 8°' },
  },
  {
    id: 'chrysalis',
    label: '邪茧',
    fill: { hue: 190, tone: 42, register: 'deep' },
    from: '甲壳中段 #1E837F（H193 T49.6），保留深青甲壳身份：A 的深色上沿 T42',
    second: { hue: 231, chroma: 16, from: '鬃毛 Fill #1E5972（H232）' },
    spark: { hue: 130, chroma: 40, from: '眼睛渐变底部 #CDE67E（H123）与魔法光 #00F600（H142）之间：青柠绿' },
  },
  {
    id: 'rainbow',
    label: '云宝黛西',
    fill: { hue: 228, tone: 84, register: 'light' },
    from: '毛色 Fill #9BDBF5（H225）与 Shadow Fill #8CC7E7（H232）之间',
    second: { hue: 315, chroma: 18, from: '鬃毛第六色 #632E86（H315.5）：紫' },
    spark: { hue: 42, chroma: 40, from: '鬃毛第三色 #EF7135（H41.5）：橙' },
  },
  {
    id: 'luna',
    label: '露娜',
    fill: { hue: 280, tone: 34, register: 'deep' },
    from: '毛色 Fill #363E7A（H280 T28.5）：A 的深色下沿 T34，保留夜空深蓝',
    second: { hue: 184, chroma: 16, from: '眼睛 #00B6A3（H184）：青' },
    spark: { hue: 303, chroma: 48, from: '鬃毛边缘 #844FDE（H303）：紫' },
  },
  {
    id: 'rarity',
    label: '瑞瑞',
    fill: { hue: 294, tone: 39, register: 'deep' },
    from: '鬃毛 Fill #5E50A0（H294 T39）：保留紫鬃毛的自然深度，与露娜靠色相及明度区分',
    second: { hue: 232, chroma: 16, from: '可爱标志的钻石 #2696CB（H237.5）：淡蓝' },
    spark: { hue: 228, chroma: 40, from: '钻石 Fill #7DD1F5（H228）：钻石蓝' },
  },
  {
    id: 'twilight',
    label: '暮光闪闪',
    fill: { hue: 319, tone: 82, register: 'light' },
    from: '毛色 Fill #CC9CDF（H319 T70.8）：A 的浅紫下沿 T82，仍配靛蓝鬃毛与品红星标',
    second: { hue: 272, chroma: 18, from: '鬃毛 Fill #243870（H272.5）：靛蓝' },
    spark: { hue: 359, chroma: 48, from: '可爱标志的星 #EA428B（H359.5）：品红' },
  },
  {
    id: 'pinkie',
    label: '碧琪',
    fill: { hue: 353, tone: 82, register: 'light' },
    from: '毛色 Fill #F5B7D0（H353 T80.7）：A 的浅粉下沿 T82，与品牌粉靠明度区分',
    second: { hue: 226, chroma: 18, from: '可爱标志的气球 #7ED0F2（H227）与眼睛（H226）：气球蓝' },
    spark: { hue: 226, chroma: 40, from: '气球与眼睛 H226（黄气球 H108 落在橄榄区）' },
  },
];

const CHARACTER_THEMES = THEMES.filter((t) => t.id !== 'default');

/** A theme's two fills: its direction-A decision, rendered one step apart. */
function fillsOf(theme) {
  const { hue, tone, register } = theme.fill;
  const at = (t) => clearColorAt(hue, t, register);
  return { light: at(tone), dark: at(tone - DARK_SHIFT) };
}

const accentsOf = (theme) => ({
  second: { hue: theme.second.hue, chroma: theme.second.chroma },
  spark: { hue: theme.spark.hue, chroma: theme.spark.chroma },
  ...(theme.neutral ? { neutralHue: { light: theme.neutral.light, dark: theme.neutral.dark } } : {}),
});

/** themeId -> the whole DerivedTheme: `{ meta, light, dark, mono }` (light/dark are 多色's). */
const generated = new Map(
  THEMES.map((theme) => {
    const fills = fillsOf(theme);
    return [theme.id, deriveTheme(fills.light, fills.dark, accentsOf(theme), 'built-in')];
  }),
);

const VARIANTS = ['multi', 'mono'];
const VARIANT_LABEL = { multi: '多色', mono: '单色' };
/** One 配色方案's role maps for a theme. */
const rolesOf = (id, variant) => (variant === 'mono' ? generated.get(id).mono : generated.get(id));

/* ---------------------------------------------------------------------------
 * Colour distance — for "does this read as a severity / a tag category" questions
 * ------------------------------------------------------------------------ */

/**
 * The two distances every "is it the same colour" check below is held to, in CIEDE2000. About 2
 * is a just-noticeable difference side by side; under `READS_AS_ONE` two colours seen apart are
 * taken for one — the bar an area or a mark is held to — and under `SAME_SWATCH` they are one.
 */
const READS_AS_ONE = 6;
const SAME_SWATCH = 3;

/** CIEDE2000. */
function deltaE(hexA, hexB) {
  const [L1, a1, b1] = labFromArgb(argbFromHex(hexA));
  const [L2, a2, b2] = labFromArgb(argbFromHex(hexB));
  const rad = Math.PI / 180;
  const Cb = (Math.hypot(a1, b1) + Math.hypot(a2, b2)) / 2;
  const G = 0.5 * (1 - Math.sqrt(Cb ** 7 / (Cb ** 7 + 25 ** 7)));
  const [a1p, a2p] = [(1 + G) * a1, (1 + G) * a2];
  const [C1p, C2p] = [Math.hypot(a1p, b1), Math.hypot(a2p, b2)];
  const h1p = (Math.atan2(b1, a1p) / rad + 360) % 360;
  const h2p = (Math.atan2(b2, a2p) / rad + 360) % 360;
  let dhp = h2p - h1p;
  if (C1p * C2p === 0) dhp = 0;
  else if (dhp > 180) dhp -= 360;
  else if (dhp < -180) dhp += 360;
  const dHp = 2 * Math.sqrt(C1p * C2p) * Math.sin((dhp / 2) * rad);
  const Lbp = (L1 + L2) / 2;
  const Cbp = (C1p + C2p) / 2;
  let hbp = h1p + h2p;
  if (C1p * C2p !== 0) {
    if (Math.abs(h1p - h2p) > 180) hbp = h1p + h2p < 360 ? (hbp + 360) / 2 : (hbp - 360) / 2;
    else hbp /= 2;
  }
  const T =
    1 -
    0.17 * Math.cos((hbp - 30) * rad) +
    0.24 * Math.cos(2 * hbp * rad) +
    0.32 * Math.cos((3 * hbp + 6) * rad) -
    0.2 * Math.cos((4 * hbp - 63) * rad);
  const dTheta = 30 * Math.exp(-(((hbp - 275) / 25) ** 2));
  const Rc = 2 * Math.sqrt(Cbp ** 7 / (Cbp ** 7 + 25 ** 7));
  const Sl = 1 + (0.015 * (Lbp - 50) ** 2) / Math.sqrt(20 + (Lbp - 50) ** 2);
  const Sc = 1 + 0.045 * Cbp;
  const Sh = 1 + 0.015 * Cbp * T;
  const Rt = -Math.sin(2 * dTheta * rad) * Rc;
  const [dL, dC, dH] = [(L2 - L1) / Sl, (C2p - C1p) / Sc, dHp / Sh];
  return Math.sqrt(dL ** 2 + dC ** 2 + dH ** 2 + Rt * dC * dH);
}

/** OKLCH to sRGB hex, for measuring the categorical `accent-*` scale, which globals.css writes in OKLCH. */
function oklchToHex(L, C, hueDeg) {
  const h = (hueDeg * Math.PI) / 180;
  const [a, b] = [C * Math.cos(h), C * Math.sin(h)];
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  const linear = [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];
  const encode = (x) => {
    const v = Math.min(1, Math.max(0, x));
    return v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055;
  };
  return `#${linear.map((x) => Math.round(encode(x) * 255).toString(16).padStart(2, '0')).join('')}`;
}

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
/** The categorical scale's containers, per scheme — the tag and role chips an accent must not pass for. */
const categorical = { light: {}, dark: {} };
for (const m of css.matchAll(/--md-sys-color-(accent-[a-z]+):\s*oklch\(([\d.]+) ([\d.]+) ([\d.]+)\)\s*;/g)) {
  categorical[m.index < darkAt ? 'light' : 'dark'][m[1]] = oklchToHex(+m[2], +m[3], +m[4]);
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
 * Both 配色方案 are held to the table, each against the default's own.
 */
const PAIRS = [
  ['primary', 'surface', 4.5, 'report'],
  ['primary', 'surface-container-highest', 4.5, 'report'],
  ['on-primary', 'primary', 4.5, 'floor'],
  ['primary-ink', 'surface', 4.5, 'floor'],
  ['primary-ink', 'surface-container-highest', 4.5, 'floor'],
  ['primary-ink', 'secondary-container', 4.5, 'floor'],
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

/**
 * The pairs 多色 depends on, each with its bar and the place it is drawn. Held for every theme, in
 * both schemes and both 配色方案 (单色's tertiary roles are its secondary ones, so the same rows
 * hold it to today's numbers) — and for the custom palette's rule, swept (ASSERTION 15).
 */
const ACCENT_PAIRS = [
  ['on-tertiary-container', 'tertiary-container', 4.5, 'a favourite or like that is on: its glyph'],
  ['tertiary', 'surface', 3, 'an empty state’s glyph, the level meter on the page'],
  ['tertiary', 'surface-container-low', 3, 'the accent on a low card'],
  ['tertiary', 'surface-container-highest', 3, 'the accent on the highest card'],
  ['tertiary', 'tertiary-container', 3, 'the level meter: its fill against its own track'],
  ['secondary', 'secondary-container', 3, 'every other meter: its fill against its track'],
  ['on-secondary-container', 'secondary-container', 4.5, 'text in a selected row, a bubble, a tonal button'],
  ['focus', 'surface', 3, 'the focus ring on the page (2.4.11)'],
  ['focus', 'surface-container-highest', 3, 'the focus ring on the highest step'],
  ['focus', 'secondary-container', 3, 'the focus ring beside a selected row'],
  ['on-chip-selected', 'chip-selected', 4.5, 'a selected filter chip'],
];

/* ---------------------------------------------------------------------------
 * Run
 * ------------------------------------------------------------------------ */

const failures = [];

/* ASSERTION 1 — every emitted colour is actually at the tone asked for (skipping the five roles
 * that are literal hexes or contrast solutions rather than ramp positions), in both 配色方案 —
 * 多色 asks for its accent at `SPARK_TONE` in light.
 *
 * The brand derivation reads three tones per theme by measuring contrast on this palette, so a
 * ramp that misses its own tone would quietly move the brand itself, not just a reported figure. */
for (const theme of THEMES) {
  for (const variant of VARIANTS) {
    const roles = rolesOf(theme.id, variant);
    for (const [token, , lightTone, darkTone] of ROLES) {
      const [lightAsk, darkAsk] = (variant === 'multi' && MULTI_TONES[token]) || [lightTone, darkTone];
      for (const [scheme, raw] of [
        ['light', lightAsk],
        ['dark', darkAsk],
      ]) {
        if (typeof raw !== 'number') continue;
        const got = hctOf(roles[scheme][token]).tone;
        if (Math.abs(got - raw) > 0.5) {
          failures.push(
            `${theme.id} ${VARIANT_LABEL[variant]} ${scheme} ${token}: asked tone ${raw}, got ${got.toFixed(2)}`,
          );
        }
      }
    }
  }
}

/** The default theme's 多色 role maps, i.e. what globals.css is compared against. */
const next = generated.get('default');

/* ASSERTION 2 — the neutral-variant palette is at the chroma the recipe asked for, in both
 * 配色方案 (the default's coat included: its hue moves, M3's chroma does not).
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
  for (const variant of VARIANTS) {
    for (const scheme of ['light', 'dark']) {
      for (const token of NV_TOKENS) {
        const got = hctOf(rolesOf(theme.id, variant)[scheme][token]).chroma;
        if (Math.abs(got - HARMONY.neutralVariant.chroma) > 1) {
          failures.push(
            `${theme.id} ${VARIANT_LABEL[variant]} ${scheme} ${token} chroma ${got.toFixed(2)}` +
              ` off target ${HARMONY.neutralVariant.chroma.toFixed(2)}`,
          );
        }
      }
    }
  }
}

/* What globals.css holds against what the run gives. A role with no hex declaration at all is a
 * failure of its own: `--write` substitutes values in place and will not guess where a new
 * declaration belongs among the file's prose, so a new role is added by hand, once. */
const changed = [];
const same = [];
for (const [token] of ROLES) {
  for (const scheme of ['light', 'dark']) {
    const was = current[scheme][token];
    const now = next[scheme][token];
    if (!was) {
      failures.push(
        `app/globals.css declares no hex for --md-sys-color-${token} in its ${scheme} block —` +
          ` add \`--md-sys-color-${token}: ${now};\` where it belongs, then re-run`,
      );
      continue;
    }
    (was === now ? same : changed).push({ scheme, token, was, now });
  }
}

const pad = (s, n) => String(s).padEnd(n);
const seed = hctOf(BRAND_RAMP_SEED);
console.log(
  `ramp seed ${BRAND_RAMP_SEED}  hue ${seed.hue.toFixed(2)}  chroma ${seed.chroma.toFixed(2)}` +
    `   brand fill ${BRAND_SEED} / ${BRAND_SEED_DARK} (direction A, asserted below)`,
);
console.log(
  `neutral chroma ${NEUTRAL_CHROMA}. Direction-A fills retain guide hue and light/deep character;` +
    ` dark ${DARK_SHIFT} tones deeper. Built-in on-primary and primary-ink clear 4.5:1 text contrast;` +
    ` custom/manual themes retain their established derivation.`,
);
console.log(
  `ramp chroma: the light fill's own, floored at min(${BRAND_CHROMA.toFixed(1)}, gamut ceiling)` +
    ` measured at tone ${CHROMA_REFERENCE_TONE} — not at the fill's tone, or a tint's ramp goes grey`,
);
console.log(
  `harmony (单色)  secondary ${HARMONY.secondary.dHue.toFixed(2)}° C${HARMONY.secondary.chroma.toFixed(1)}` +
    `  neutralVariant ${HARMONY.neutralVariant.dHue.toFixed(2)}° C${HARMONY.neutralVariant.chroma.toFixed(1)};` +
    ` tertiary roles read the secondary palette.  多色: each theme's second colour and accent,` +
    ` the accent at tone ${SPARK_TONE} in light; the second colour's declared chroma is its tint,` +
    ` and its dark containers take the clear shade its hue allows —` +
    ` ${(SECOND_CLARITY * 100).toFixed(0)}% of the deep register, capped at C${SECOND_AREA_CAP}\n`,
);

const shareOf = (hex) => {
  const h = hctOf(hex);
  return h.chroma / maxChroma(h.hue, h.tone);
};

console.log('THEMES');
for (const theme of THEMES) {
  const g = generated.get(theme.id);
  const m = g.meta;
  console.log(
    `  ${pad(theme.id, 11)} ${pad(theme.label, 6)} ${m.light} / ${m.dark}` +
      `  hue ${m.hue.toFixed(1).padStart(5)}` +
      `  tone ${m.toneLight.toFixed(0).padStart(2)}/${m.toneDark.toFixed(0).padStart(2)}` +
      `  share ${shareOf(m.light).toFixed(2)}/${shareOf(m.dark).toFixed(2)}` +
      `  ramp ${m.chroma.toFixed(0).padStart(2)}` +
      `  on-primary ${m.onPrimary === '#ffffff' ? 'white  ' : m.onPrimary}` +
      ` ${contrast(m.onPrimary, m.light).toFixed(2)}/${contrast(m.onPrimary, m.dark).toFixed(2)}`,
  );
  console.log(
    `              ink ${m.inkLight} / ${m.inkDark}` +
      `${m.inkLight === m.light ? ' [ink == fill]' : ' [ink != fill]'}` +
      `  surface ${g.light.surface} / ${g.dark.surface}` +
      `  bar/page ${contrast(m.light, g.light.surface).toFixed(2)} / ${contrast(m.dark, g.dark.surface).toFixed(2)}` +
      `  多色 second H${theme.second.hue} C${theme.second.chroma} accent H${theme.spark.hue} C${theme.spark.chroma}`,
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

console.log('\nCONTRAST — default theme (多色), file vs run');
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

/* ASSERTION 3 — the ten are consistent where consistency is constructible, in both 配色方案.
 *
 * Three kinds declared per pair in PAIRS: `spread` (±SPREAD of the default — every surface step,
 * both neutral-variant roles, the secondary harmony, the semantic containers, the link roles),
 * `floor` (the two pairs a hue-dependent brand tone may move), and `report` (printed, not
 * asserted). Both asserted kinds also keep "no theme loses a bar the default clears", so the
 * divergences globals.css argues for do not fail the run. */
const SPREAD = 0.25;
console.log(`\nCONTRAST MATRIX — every theme against the default, tolerance ±${SPREAD}`);
for (const variant of VARIANTS) {
  for (const scheme of ['light', 'dark']) {
    console.log(`  ${VARIANT_LABEL[variant]} ${scheme}`);
    const reference = rolesOf('default', variant)[scheme];
    for (const [a, b, rawBar, kind] of PAIRS) {
      const ref = contrast(reference[a], reference[b]);
      const bar = typeof rawBar === 'object' ? rawBar[scheme] : rawBar;
      const cells = [];
      for (const theme of THEMES) {
        const g = rolesOf(theme.id, variant)[scheme];
        const v = contrast(g[a], g[b]);
        if (theme.id !== 'default') {
          const d = v - ref;
          cells.push(`${theme.id.slice(0, 4)} ${v.toFixed(2)}${d >= 0 ? '+' : '-'}${Math.abs(d).toFixed(2)}`);
        }
        const where = `${theme.id} ${VARIANT_LABEL[variant]} ${scheme} ${a}/${b}`;
        if (kind === 'spread') {
          if (Math.abs(v - ref) > SPREAD) failures.push(`${where}: ${v.toFixed(2)} vs default ${ref.toFixed(2)}`);
          if (ref >= bar && v < bar) failures.push(`${where}: ${v.toFixed(2)} under ${bar}:1 (default clears it)`);
        }
        if (kind === 'floor' && v < bar) failures.push(`${where}: ${v.toFixed(2)} under the ${bar}:1 floor`);
      }
      console.log(`    ${pad(kind, 7)}${pad(`${a} / ${b}`, 42)} ref ${ref.toFixed(2).padStart(5)}  ${cells.join('  ')}`);
    }
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
 * what guards the choice, and ASSERTION 9 what holds a character's bar to text. */
for (const theme of THEMES) {
  const { fillChroma, light } = generated.get(theme.id).meta;
  if (fillChroma < MIN_SEED_CHROMA) {
    failures.push(
      `${theme.id} light fill ${light} is chroma ${fillChroma.toFixed(1)}, under` +
        ` ${MIN_SEED_CHROMA} — too close to grey to define a hue; pick a different row of the guide`,
    );
  }
}

/* ASSERTION 5 — the hue wheel has no coincident pair (15° bar), with two exemptions.
 *
 * Two themes at the same hue look the same in the picker however different their tones. Both
 * exemptions are pairs a *second* axis separates, so the bar itself is never lowered — a future
 * theme still has to clear 15° on hue alone — and the second axis is held too: the two fills
 * must not read as one colour (`READS_AS_ONE`):
 *   default / pinkie  2.9°, separated by tone (61 vs 76): a coat against the brand's mane
 *   luna / rarity     13.6°, separated by tone (32 vs 40) — a deliberate trade */
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
for (const [a, b] of HUE_EXEMPT) {
  const d = deltaE(generated.get(a).meta.light, generated.get(b).meta.light);
  const dark = deltaE(generated.get(a).meta.dark, generated.get(b).meta.dark);
  console.log(
    `\n  exemption ${a} / ${b}: fills ΔE ${d.toFixed(1)} light (floor ${READS_AS_ONE}),` +
      ` ${dark.toFixed(1)} dark (reported)`,
  );
  if (d < READS_AS_ONE) {
    failures.push(`${a} and ${b} share a hue and their fills are only ΔE ${d.toFixed(1)} apart — the exemption needs a second axis`);
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
 * into (pinned near tone 61, Fluttershy's hue could only be a dark olive); 小蝶's butter yellow
 * sits at tone 89 for the same reason. */
for (const theme of THEMES) {
  for (const hex of [generated.get(theme.id).meta.light, generated.get(theme.id).meta.dark]) {
    if (DislikeAnalyzer.isDisliked(hctOf(hex))) {
      failures.push(
        `${theme.id} primary ${hex} is in the disliked yellow-green band (hue 90–111, tone < 65) —` +
          ' move its tone out of the band',
      );
    }
  }
}

/* ASSERTION 8 — 单色 is the library's `SchemeTonalSpot`, not our transcription of it.
 *
 * ASSERTION 2 compares emitted chroma against *our own* constant, so it is self-referential; a
 * dependency bump that retuned TonalSpot would have passed every other check in this file. This
 * builds a real `SchemeTonalSpot` per theme and compares the three palettes 单色 reads at every
 * tone the role map uses. `primary` is excluded — the library pins it at chroma 36 and this app's
 * is `rampChroma` (the documented divergence) — and so is TonalSpot's tertiary, which 单色 does
 * not read: its tertiary roles are its secondary ones, asserted here too, so no second hue can
 * appear in it. */
const TONES_USED = [...new Set(ROLES.map(([, , l]) => l).concat(ROLES.map(([, , , d]) => d)))]
  .filter((t) => typeof t === 'number')
  .sort((a, b) => a - b);

const ONE_HUE = [
  ['tertiary', 'secondary'],
  ['on-tertiary', 'on-secondary'],
  ['tertiary-container', 'secondary-container'],
  ['on-tertiary-container', 'on-secondary-container'],
];
/* The two things that must not change with 配色方案, and what they are in 单色. */
const SELECTION = [
  ['focus', 'secondary'],
  ['chip-selected', 'secondary-container'],
  ['on-chip-selected', 'on-secondary-container'],
];

for (const theme of THEMES) {
  const g = generated.get(theme.id);
  const fill = hctOf(g.meta.light);
  const spec = new SchemeTonalSpot(Hct.from(fill.hue, fill.chroma, fill.tone), false, 0);
  const ours = paletteSet(fill.hue, rampChroma(fill.hue, fill.chroma));
  for (const name of ['secondary', 'neutral', 'neutralVariant']) {
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
  for (const scheme of ['light', 'dark']) {
    for (const [a, b] of [...ONE_HUE, ...SELECTION]) {
      if (g.mono[scheme][a] !== g.mono[scheme][b]) {
        failures.push(`${theme.id} 单色 ${scheme} ${a} ${g.mono[scheme][a]} is not its ${b} ${g.mono[scheme][b]}`);
      }
    }
  }
}

/* ASSERTION 9 — every built-in bar, including the unchanged brand fill, carries text at 4.5:1.
 * Direction A bounds large-area chroma rather than penalising a clear pale fill for being close
 * to its narrow gamut ceiling. Its light/deep limits are checked in both schemes. */
const BAR_TEXT = 4.5;
for (const theme of THEMES) {
  const m = generated.get(theme.id).meta;
  for (const [scheme, fill] of [
    ['light', m.light],
    ['dark', m.dark],
  ]) {
    const c = contrast(m.onPrimary, fill);
    if (c < BAR_TEXT) {
      failures.push(`${theme.id} ${scheme} bar ${fill}: its ink ${m.onPrimary} is ${c.toFixed(2)}:1, under ${BAR_TEXT}:1`);
    }
    if (theme.fill) {
      const chroma = hctOf(fill).chroma;
      const ceiling = theme.fill.register === 'light' ? 36 : 48;
      if (chroma > ceiling + 0.5) {
        failures.push(`${theme.id} ${scheme} fill ${fill} chroma ${chroma.toFixed(2)} exceeds its area ceiling ${ceiling}`);
      }
    }
  }
}

/* ASSERTION 18 — the brand's two literals in `lib/paletteSpec.ts` are the rule's own output.
 *
 * Numbered 18 so the numbers AGENTS.md cites do not move. The brand used to be the one theme
 * exempt from direction A — `品牌色，给定`, two hexes at tone 61/54 and chroma 56.8, which is
 * 20.8 over the light register's C36 ceiling and 8.8 over the deep register's C48, in the middle
 * band that belongs to neither register. It now carries a `fill` decision like the nine
 * characters, so ASSERTION 9's area ceiling and ASSERTION 1's tone fidelity hold it too.
 *
 * What this adds is the one thing those cannot: `BRAND_SEED` has to stay a **literal**, because
 * `lib/paletteSpec.ts` is the import-free module every client reads a preference through and HCT
 * may not reach it. So the literal and the decision are two statements of one colour, and
 * `--write` cannot reconcile them — it only substitutes `--md-sys-color-*` declarations. This is
 * the check that says so, with the two lines to paste. `BRAND_RAMP_SEED` is asserted the other
 * way round: it is the mascot's mane, the colour the brand *was*, and it must not drift into
 * being the fill, or `BRAND_CHROMA` — the floor under every theme's ramp — follows a tint down
 * and takes all eleven `primary-ink`s with it (ASSERTION 6 is what would then fail). */
{
  const decided = fillsOf(THEMES[0]);
  for (const [name, literal, want] of [
    ['BRAND_SEED', BRAND_SEED, decided.light],
    ['BRAND_SEED_DARK', BRAND_SEED_DARK, decided.dark],
  ]) {
    if (literal !== want) {
      failures.push(
        `lib/paletteSpec.ts's ${name} is ${literal} where the default theme's direction-A` +
          ` decision renders ${want} — paste \`export const ${name} = '${want}';\``,
      );
    }
  }
  const ramp = hctOf(BRAND_RAMP_SEED);
  if (ramp.chroma < INK_CHROMA_FLOOR) {
    failures.push(
      `BRAND_RAMP_SEED ${BRAND_RAMP_SEED} is chroma ${ramp.chroma.toFixed(1)}, under` +
        ` ${INK_CHROMA_FLOOR} — it is the floor under every theme's ramp and must be a mark's` +
        " chroma, not a tint's; it is the mascot's mane, not the app bar's fill",
    );
  }
  console.log(
    `\nBRAND — fill ${BRAND_SEED} / ${BRAND_SEED_DARK} from ${THEMES[0].from.split('；')[0]};` +
      ` ramp seed ${BRAND_RAMP_SEED} chroma ${ramp.chroma.toFixed(1)}`,
  );
}

/* ASSERTION 19 — the app bar's quieter ink still reads, and is quieter.
 *
 * `on-primary-variant` is the bar's icons and wordmark at `ON_PRIMARY_VARIANT_SHARE` of
 * `on-primary`'s contrast against the bar, floored at 4.5:1 so it would still carry text, never past
 * `on-primary` itself. Held for the ten in both schemes and both 配色方案, and for the custom sweep
 * below, where an exact custom theme's `on-primary` may sit under the floor and the variant must
 * then be `on-primary` (its contrast, not more). */
const BAR_INK_SLACK = 0.005;
const barInk = [];
for (const theme of THEMES) {
  for (const variant of VARIANTS) {
    for (const scheme of ['light', 'dark']) {
      const roles = rolesOf(theme.id, variant)[scheme];
      const full = contrast(roles['on-primary'], roles.primary);
      const quiet = contrast(roles['on-primary-variant'], roles.primary);
      if (variant === 'multi') barInk.push(`${theme.id.slice(0, 4)} ${scheme[0]} ${full.toFixed(2)}→${quiet.toFixed(2)}`);
      const where = `${theme.id} ${VARIANT_LABEL[variant]} ${scheme} on-primary-variant ${roles['on-primary-variant']}`;
      if (quiet < ON_PRIMARY_VARIANT_FLOOR - BAR_INK_SLACK) failures.push(`${where}: ${quiet.toFixed(2)}:1 on the bar, under ${ON_PRIMARY_VARIANT_FLOOR}:1`);
      if (quiet > full + BAR_INK_SLACK) failures.push(`${where}: ${quiet.toFixed(2)}:1, above on-primary's ${full.toFixed(2)}:1`);
      /* Lighter than the bar, it is a tint: 邪茧's came out a saturated aqua at the ramp's C45.7. */
      const quietHct = hctOf(roles['on-primary-variant']);
      if (quietHct.tone > hctOf(roles.primary).tone && quietHct.chroma > ON_PRIMARY_VARIANT_TINT_CHROMA + 0.5) {
        failures.push(`${where}: chroma ${quietHct.chroma.toFixed(1)} on a deep bar, over the tint's ${ON_PRIMARY_VARIANT_TINT_CHROMA}`);
      }
    }
  }
}
console.log(
  `\nBAR INK — on-primary → on-primary-variant against the bar (×${ON_PRIMARY_VARIANT_SHARE}, floor ${ON_PRIMARY_VARIANT_FLOOR}):\n  ` +
    barInk.join('  ·  '),
);

/* ASSERTION 10 — 多色 is more than one hue.
 *
 * The second colour covers every selection container, where a hue under 40° from the primary
 * does not show at all: at tone 90 and chroma 16–20 the mascot's mauve and lilac, 16° and 39°
 * from her pink, rendered the same as it. The accent is a mark beside the brand's own marks, so
 * it is held apart from `primary-ink` by distance instead — a hue alone would pass a violet next
 * to an indigo it is plainly different from. */
const SECOND_GAP = 40;
for (const theme of THEMES) {
  const g = generated.get(theme.id);
  const gap = Math.abs(norm180(theme.second.hue - g.meta.hue));
  if (gap < SECOND_GAP) {
    failures.push(`${theme.id} second colour H${theme.second.hue} is ${gap.toFixed(0)}° from its primary, under ${SECOND_GAP}° — 多色 would render as 单色`);
  }
  for (const scheme of ['light', 'dark']) {
    const d = deltaE(g[scheme].tertiary, g[scheme]['primary-ink']);
    if (d < READS_AS_ONE) {
      failures.push(`${theme.id} ${scheme} accent ${g[scheme].tertiary} is ΔE ${d.toFixed(1)} from primary-ink — it reads as the brand`);
    }
  }
}

/* ASSERTION 11 — every pair 多色 depends on clears its bar, everywhere. */
const accentMinimum = new Map();
for (const theme of THEMES) {
  for (const variant of VARIANTS) {
    for (const scheme of ['light', 'dark']) {
      const roles = rolesOf(theme.id, variant)[scheme];
      for (const [a, b, bar] of ACCENT_PAIRS) {
        const v = contrast(roles[a], roles[b]);
        const key = `${VARIANT_LABEL[variant]} ${a} / ${b}`;
        const min = accentMinimum.get(key);
        if (!min || v < min.v) accentMinimum.set(key, { v, bar, who: `${theme.id} ${scheme}` });
        if (v < bar) failures.push(`${theme.id} ${VARIANT_LABEL[variant]} ${scheme} ${a}/${b}: ${v.toFixed(2)} under ${bar}:1`);
      }
    }
  }
}
console.log('\nACCENT PAIRS — the minimum over the ten themes, both schemes');
for (const [key, { v, bar, who }] of accentMinimum) {
  console.log(`  ${pad(key, 52)} ${v.toFixed(2).padStart(5)}  (bar ${bar}, ${who})`);
}

/* ASSERTION 12 — no emitted accent is a colour people reliably dislike (see ASSERTION 7). */
const ACCENT_TOKENS = [
  'secondary',
  'secondary-container',
  'on-secondary-container',
  'tertiary',
  'tertiary-container',
  'on-tertiary-container',
];
for (const theme of THEMES) {
  const g = generated.get(theme.id);
  for (const scheme of ['light', 'dark']) {
    for (const token of ACCENT_TOKENS) {
      if (DislikeAnalyzer.isDisliked(hctOf(g[scheme][token]))) {
        failures.push(`${theme.id} 多色 ${scheme} ${token} ${g[scheme][token]} is in the disliked yellow-green band`);
      }
    }
  }
}

/* ASSERTION 13 — an accent never passes for a severity.
 *
 * Three forms. The built-ins' hues keep out of the bands the custom rule is guarded by
 * (`HUE_GUARDS`); each severity still sits inside its own band, with room, so retuning one cannot
 * slip it out from under its guard; and, measured: the accent mark and every selection container
 * stay `READS_AS_ONE` from every severity role, fill and container — a selected row must not read
 * as a warning. The accent's *container* is held to `SAME_SWATCH` only, and that is a finding
 * rather than a concession: at tone 90 every warm pastel is near every other, and 天琴's and
 * 云宝's orange and 暮光's magenta come within ΔE 4.9–5.3 of error-container. It is one small
 * square — a favourite or a like that is on — always under its own filled glyph in the accent's
 * dark ink, never an area; a severity's container is a banner or a chip with words in it. */
const GUARD_MARGIN = 5;
for (const theme of THEMES) {
  for (const [name, accent] of [
    ['second colour', theme.second],
    ['accent', theme.spark],
  ]) {
    if (isGuardedHue(accent.hue)) {
      failures.push(`${theme.id} ${name} H${accent.hue} is inside a guarded band (a severity or the olive shoulder)`);
    }
  }
}
for (const band of HUE_GUARDS) {
  if (band.reason === 'olive') continue;
  for (const token of [band.reason, `${band.reason}-fill`]) {
    const hex = current.light[token];
    if (!hex) continue;
    const h = hctOf(hex).hue;
    const margin = Math.min(h - band.from, band.to - h);
    if (margin < GUARD_MARGIN) {
      failures.push(`${token} ${hex} (H${h.toFixed(1)}) sits ${margin.toFixed(1)}° inside its guard ${band.from}–${band.to}, under ${GUARD_MARGIN}°`);
    }
  }
}
let closestToSeverity = { d: Infinity };
const closestContainer = {};
for (const theme of THEMES) {
  const g = generated.get(theme.id);
  for (const scheme of ['light', 'dark']) {
    const roles = g[scheme];
    for (const severity of ['error', 'success', 'warning']) {
      for (const hex of [roles[severity], current.light[`${severity}-fill`]]) {
        const d = deltaE(roles.tertiary, hex);
        if (d < closestToSeverity.d) closestToSeverity = { d, who: `${theme.id} ${scheme} vs ${severity} ${hex}` };
        if (d < READS_AS_ONE) failures.push(`${theme.id} ${scheme} accent ${roles.tertiary} is ΔE ${d.toFixed(1)} from ${severity} ${hex}`);
      }
      for (const [token, floor] of [
        ['secondary-container', READS_AS_ONE],
        ['tertiary-container', SAME_SWATCH],
      ]) {
        const d = deltaE(roles[token], roles[`${severity}-container`]);
        const best = closestContainer[token];
        if (!best || d < best.d) closestContainer[token] = { d, who: `${theme.id} ${scheme} vs ${severity}-container` };
        if (d < floor) {
          failures.push(`${theme.id} ${scheme} ${token} ${roles[token]} is ΔE ${d.toFixed(1)} from ${severity}-container, under ${floor}`);
        }
      }
    }
  }
}
console.log(`\n  closest accent mark to a severity:           ΔE ${closestToSeverity.d.toFixed(1)} (${closestToSeverity.who})`);
for (const [token, { d, who }] of Object.entries(closestContainer)) {
  console.log(`  closest ${pad(token, 22)} to a severity: ΔE ${d.toFixed(1)} (${who})`);
}

/* ASSERTION 17 — a dark container is a shade of its hue, not a greyed tone.
 *
 * Numbered 17 rather than inserted at 14 so the numbers AGENTS.md and the ledger already cite do
 * not move; it belongs beside ASSERTION 13, which is the other half of the same question — 13 asks
 * whether a container reads as something it is not, this asks whether it reads as a colour at all.
 *
 * Decision 29's intent is 清色 only, never 浊色 ("a pure hue plus grey"), and the one place the
 * generator could not keep it was here: a second colour is declared once, as the tint the light
 * scheme's tone-90 containers wear, and M3 reuses that chroma at tone 30 in dark, where the gamut
 * is two to four times as wide. 天琴 #594234 (brown), 苹果嘉儿 #414a32 (olive), 小蝶 #5b3f4b (plum)
 * and 云宝 #504158 were the four the owner named, and they held 0.37–0.51 of their hue's own deep
 * register where 邪茧, 露娜, 瑞瑞 and 碧琪 held 0.68–0.81. So the bar is the clean four's own
 * standard, with room, and the rule that meets it is `deepSecondChroma`.
 *
 * Measured on the emitted hex, not on the ask: gamut mapping, a palette built at the wrong chroma,
 * or the deep register being dropped all fail it. One bound relaxes it, argued where it is
 * declared (`lib/paletteRule.ts`): the area cap, since a broad surface may not reach the accent's
 * purity. 多色, dark and the ten built-ins only — 单色's secondary palette is `SchemeTonalSpot`'s,
 * pinned by ASSERTION 8; in light a container is a tint, where the whole of the gamut's
 * narrowness is the point; and a saved custom theme keeps its existing derivation, so the custom
 * sweep (ASSERTION 15) is not held to it.
 *
 * `CLARITY_ROUNDING` is one chroma unit because a `TonalPalette` tone is an sRGB integer triple,
 * and 8-bit rounding alone moves a measured chroma by a few tenths. The shortfalls this catches
 * are 4.5–6.4 (the six themes below the bar before the deep register existed), so a unit of slack
 * cannot hide one. */
const CLARITY_ROUNDING = 1;
const clarityRows = [];
for (const theme of THEMES) {
  const g = generated.get(theme.id);
  for (const [token, name, declared] of [
    ['secondary-container', '第二色', theme.second],
    ['tertiary-container', '点缀', theme.spark],
  ]) {
    const deep = clearChromaAt(declared.hue, 30, 'deep');
    const bar = Math.min(SECOND_AREA_CAP, SECOND_CLARITY * deep);
    const got = hctOf(g.dark[token]).chroma;
    clarityRows.push({
      id: theme.id,
      name,
      token,
      hex: g.dark[token],
      got,
      deep,
      bar,
      ask: deepSecondChroma(declared.hue, declared.chroma),
    });
    if (got < bar - CLARITY_ROUNDING) {
      failures.push(
        `${theme.id} 多色 dark ${token} ${g.dark[token]} is chroma ${got.toFixed(1)} where its hue's` +
          ` deep register holds ${deep.toFixed(1)} — under the ${bar.toFixed(1)} a shade needs` +
          ` (${(SECOND_CLARITY * 100).toFixed(0)}% of the register, capped at ${SECOND_AREA_CAP}):` +
          ' a pure hue plus grey, which decision 29 excludes',
      );
    }
  }
}
console.log('\nDARK CLARITY — the share of its hue’s deep register each 多色 dark container holds');
for (const row of clarityRows) {
  console.log(
    `  ${pad(row.id, 11)} ${pad(row.name, 7)} ${pad(row.token, 20)} ${row.hex}` +
      `  C${row.got.toFixed(1).padStart(4)} of deep ${row.deep.toFixed(1).padStart(4)}` +
      `  = ${(row.got / row.deep).toFixed(2)}  (bar ${row.bar.toFixed(1)}, ask ${row.ask.toFixed(1)})`,
  );
}

/* ASSERTION 14 — the focus ring and a selected filter chip do not change with 配色方案.
 *
 * The ring answers "where is the keyboard", and a scheme switch must not move that answer; the
 * chip keeps 单色's pair because the tag categories own chip-shaped colour. */
for (const theme of THEMES) {
  const g = generated.get(theme.id);
  for (const scheme of ['light', 'dark']) {
    for (const [token] of SELECTION) {
      if (g[scheme][token] !== g.mono[scheme][token]) {
        failures.push(`${theme.id} ${scheme} ${token} is ${g[scheme][token]} in 多色 and ${g.mono[scheme][token]} in 单色`);
      }
    }
  }
}

/* ASSERTION 15 — the custom palette's rule holds the same floors for any colour.
 *
 * A sweep rather than a sample: 24 hues at four fills each (dark, middle, pale, very pale), three
 * greys, and every way to choose a 副色相 — 自动, the three relations, and a named hue inside a
 * guarded band, which is taken at its word. Each derivation is held to ACCENT_PAIRS in both
 * 配色方案; a *relation* must also land outside the guards, and 自动 on a fill with a hue must be
 * multi by ASSERTION 10's bar. */
const SWEEP_FILLS = [
  [30, 0.6],
  [55, 0.8],
  [80, 0.5],
  [92, 0.35],
];
const SWEEP_ACCENTS = [null, 'analogous', 'triadic', 'complement', 150];
const sweepSeeds = ['#808080', '#1f1f1f', '#f2f2f2'];
for (let hue = 0; hue < 360; hue += 15) {
  for (const [tone, share] of SWEEP_FILLS) sweepSeeds.push(hexFromHct(hue, share * maxChroma(hue, tone), tone));
}
let sweepFailures = 0;
for (const sweepSeed of sweepSeeds) {
  for (const accent of SWEEP_ACCENTS) {
    const d = deriveCustomTheme({ seed: sweepSeed, accent });
    const where = `custom ${sweepSeed}/${accent ?? '自动'}`;
    for (const variant of VARIANTS) {
      const maps = variant === 'mono' ? d.mono : d;
      for (const scheme of ['light', 'dark']) {
        for (const [a, b, bar] of ACCENT_PAIRS) {
          const v = contrast(maps[scheme][a], maps[scheme][b]);
          if (v < bar) {
            sweepFailures += 1;
            failures.push(`${where} ${VARIANT_LABEL[variant]} ${scheme} ${a}/${b}: ${v.toFixed(2)} under ${bar}:1`);
          }
        }
      }
    }
    const hue = d.meta.accents.spark.hue;
    if (typeof accent !== 'number' && isGuardedHue(hue)) {
      sweepFailures += 1;
      failures.push(`${where}: the relation landed on H${hue}, inside a guarded band`);
    }
    /* ASSERTION 19 for the eleventh palette. */
    for (const scheme of ['light', 'dark']) {
      const full = contrast(d[scheme]['on-primary'], d[scheme].primary);
      const quiet = contrast(d[scheme]['on-primary-variant'], d[scheme].primary);
      if (quiet < Math.min(ON_PRIMARY_VARIANT_FLOOR, full) - BAR_INK_SLACK || quiet > full + BAR_INK_SLACK) {
        sweepFailures += 1;
        failures.push(`${where} ${scheme} on-primary-variant: ${quiet.toFixed(2)}:1 against on-primary's ${full.toFixed(2)}:1`);
      }
    }
    const own = hctOf(sweepSeed);
    if (accent === null && own.chroma >= MIN_SEED_CHROMA && Math.abs(norm180(hue - own.hue)) < SECOND_GAP) {
      sweepFailures += 1;
      failures.push(`${where}: 自动 put the 副色相 ${Math.abs(norm180(hue - own.hue)).toFixed(0)}° from the seed`);
    }
  }
}
console.log(
  `\nCUSTOM SWEEP — ${sweepSeeds.length} seeds × ${SWEEP_ACCENTS.length} ways to choose a 副色相,` +
    ` both 配色方案: ${sweepFailures} failures`,
);

/* ASSERTION 16 — a palette tile's page reads against every surface a tile is drawn on.
 *
 * The tile is borderless (`components/PaletteTileFace.tsx`) and separates by tone, the way this app
 * separates things, so its page (`FACE_ROLES.page`) is held, in L*, clear of each enclosure: the
 * /settings row, a dialog, and ColorPicker's 副色相 tile unchosen and chosen — for every theme a tile
 * shows against every theme in force, both 配色方案, both schemes. Tone is L*, and every palette puts
 * a role at the same tone, so the custom palette (either side) measures what these do. The theme's
 * own `surface` would measure 1.8 against the row in light; the page step is chosen on this. */
const TILE_SEPARATION = 3.5;
const TILE_ENCLOSURES = [
  ['surface-container-low', 'the /settings row'],
  ['surface-container-high', 'a dialog'],
  ['surface-container-highest', 'a 副色相 tile'],
  ['secondary-container', 'a chosen 副色相 tile'],
];
const tileSeparation = {};
for (const variant of VARIANTS) {
  for (const scheme of ['light', 'dark']) {
    for (const [token, where] of TILE_ENCLOSURES) {
      let least = Infinity;
      for (const tile of THEMES) {
        const page = hctOf(rolesOf(tile.id, variant)[scheme][FACE_ROLES.page]).tone;
        for (const active of THEMES) {
          const gap = Math.abs(page - hctOf(rolesOf(active.id, variant)[scheme][token]).tone);
          least = Math.min(least, gap);
          if (gap < TILE_SEPARATION) {
            failures.push(
              `${VARIANT_LABEL[variant]} ${scheme}: ${tile.id}'s tile page is ${gap.toFixed(1)} in L* from` +
                ` ${where} under ${active.id} (${token}), under ${TILE_SEPARATION}`,
            );
          }
        }
      }
      const key = `${scheme} ${where}`;
      tileSeparation[key] = Math.min(tileSeparation[key] ?? Infinity, least);
    }
  }
}
console.log(
  `\nTILE PAGE (${FACE_ROLES.page}) — least L* to each enclosure, every theme on every theme:\n  ` +
    Object.entries(tileSeparation)
      .map(([key, gap]) => `${key} ${gap.toFixed(1)}`)
      .join('  ·  '),
);

/* REPORT — asserted nowhere. How close a selection container comes to a tag or role chip: the
 * categorical scale owns the tone-90 plane, and what keeps a selected row from reading as a tag is
 * the chip rule (an accent never wears a chip), not distance — 单色 was as close for five themes. */
console.log('\nREPORT — the nearest categorical container to each selection container (ΔE, both schemes)');
for (const variant of VARIANTS) {
  const cells = [];
  for (const theme of THEMES) {
    let best = { d: Infinity, name: '' };
    for (const scheme of ['light', 'dark']) {
      const container = rolesOf(theme.id, variant)[scheme]['secondary-container'];
      for (const [name, hex] of Object.entries(categorical[scheme])) {
        if (name.startsWith('accent-') && !name.startsWith('accent-on')) {
          const d = deltaE(container, hex);
          if (d < best.d) best = { d, name: `${name.slice(7)} ${scheme}` };
        }
      }
    }
    cells.push(`${theme.id.slice(0, 4)} ${best.d.toFixed(1)} ${best.name}`);
  }
  console.log(`  ${VARIANT_LABEL[variant]}  ${cells.join('  ·  ')}`);
}

/* ---------------------------------------------------------------------------
 * The three generated files
 *
 * None has prose to protect, so all three are owned outright: built here, compared on a plain run,
 * overwritten by `--write`. Comparing is what makes `npm run colors` a verifier — a stale
 * generated file is a failure, not a silent disagreement between the CSS and the recipe.
 * ------------------------------------------------------------------------ */

const paletteCss = (() => {
  const lines = [
    '/* Generated by scripts/palette.mjs — do not edit. Run `npm run colors:write`.',
    ' *',
    ' * The ten palettes, each a *partial* override of `:root`: only the roles that follow the',
    ' * theme are here. The semantic ramps (error / success / warning), the categorical `accent-*`',
    ' * scale, the `media-*` roles, `scrim` and the `glass-body` / `glass-sheen` pair are shared by',
    ' * every theme and stay in globals.css — a severity that changed colour with the theme would',
    ' * not be a severity, a tag category that did would not be a category, and a material’s own',
    ' * body and highlight are not brand colours. What the /about plate takes from the palette is',
    ' * its *ink*, which reads `primary` at run time rather than through a token of its own.',
    ' *',
    ' * Two 配色方案 per theme. 多色 is a theme’s own pair of blocks; 单色 is two more, keyed on',
    " * `data-palette-hues='mono'`, carrying only the roles it changes: the second colour and the",
    ' * accent return to the primary’s hue, and the default’s coat neutrals to TonalSpot’s. 多色 is',
    ' * the default, so it is the attribute’s absence — and the default theme’s 多色 is `:root`',
    ' * itself, so its only blocks here are its 单色 pair. The eleventh palette is the user’s own and',
    " * is not here either — `app/layout.tsx` renders its blocks into <head> from the spec in their",
    ' * cookie, through the same `paletteBlocksCss` that shapes these.',
    ' *',
    ' * Every pair declares the **same** set of names in both schemes, and that is what makes the',
    ' * arrangement safe rather than merely working: `html[data-palette=x]` (0,1,1) also outranks',
    ' * `.dark` (0,1,0), so a name present in a light block and missing from its dark twin would',
    ' * paint its light value in dark mode with no `.dark` rule able to win it back. One loop emits',
    ' * both halves, so they cannot diverge. 单色’s blocks are (0,2,1) and (0,3,1), a step above.',
    ' *',
    ' * The selectors carry `html` on purpose. `@import` has to come before any rule, so these',
    ' * blocks land *above* `:root` in the cascade, and `:root` and `[data-palette=x]` are both',
    ' * specificity (0,1,0) — source order would decide, and it would decide wrong. With the',
    ' * element name they are (0,1,1) and (0,2,1), which beats `:root` and `.dark` whatever the',
    ' * order. */',
    '',
  ];
  for (const theme of THEMES) {
    const g = generated.get(theme.id);
    const m = g.meta;
    if (theme.id === 'default') {
      lines.push(`/* ${theme.label} — 单色 only: its 多色 is \`:root\` and \`.dark\` in globals.css. */`);
      lines.push(paletteBlocksCss(theme.id, g, { multi: false }));
    } else {
      lines.push(
        `/* ${theme.label} — ${theme.from}. fill ${m.light} / ${m.dark},` +
          ` hue ${m.hue.toFixed(1)}, ramp chroma ${m.chroma.toFixed(1)},` +
          ` ink ${m.inkLight} / ${m.inkDark},` +
          ` on-primary ${m.onPrimary === '#ffffff' ? 'white' : m.onPrimary}.`,
      );
      lines.push(
        `   多色：第二色 H${theme.second.hue} C${theme.second.chroma}` +
          `（深色方案 C${deepSecondChroma(theme.second.hue, theme.second.chroma).toFixed(1)}），` +
          `${theme.second.from}；` +
          `点缀 H${theme.spark.hue} C${theme.spark.chroma}，${theme.spark.from}。 */`,
      );
      lines.push(paletteBlocksCss(theme.id, g));
    }
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
// Per theme, the few hexes for the places a \`var()\` cannot reach.
//
// \`primary\` is the \`<meta name="theme-color">\` value: the browser reads that tag to
// paint its own chrome before any stylesheet exists, so it has to be a literal, generated
// rather than hand-copied. \`onPrimary\` is its ink, which a palette tile's tick takes. What else
// a tile is drawn from is in \`lib/generated/themeFaces.ts\`, which only /settings imports: this
// file is in every route's bundle, so it carries only what the shell reads. Fields no consumer
// touches go; fields a consumer needs are generated — the same rule read both ways.
//
// The eleventh palette is **not** in this array and must not be: its colours come from the
// user's own seed, so there is nothing to generate. It is here only as an id, because
// \`PaletteId\` is what every consumer validates against and a union that cannot express the
// palette the user has chosen is a union that silently downgrades them to the default. The
// derivation lives in \`lib/paletteRule.ts\`; this file stays free of it so that importing a
// theme colour does not pull HCT into every route.

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

/* The tiles' faces: read off each theme's own roles by `themeFace`, the function the custom
   palette's tile is drawn through too, so a built-in tile and the eleventh cannot disagree. */
const themeFacesTs = (() => {
  const face = (f) =>
    `{ page: '${f.page}', pick: '${f.pick}', accent: '${f.accent}', monoPage: '${f.monoPage}', monoPick: '${f.monoPick}' }`;
  const entries = THEMES.map((theme) => {
    const f = themeFace(generated.get(theme.id));
    return [`  ${theme.id}: {`, `    light: ${face(f.light)},`, `    dark: ${face(f.dark)},`, '  },'].join('\n');
  });
  return `// Generated by scripts/palette.mjs — do not edit. Run \`npm run colors:write\`.
//
// Each built-in theme's miniature, for its tile in /settings (\`components/PaletteTileFace.tsx\`):
// per scheme, the page (\`${FACE_ROLES.page}\`), what a selection wears on it
// (\`${FACE_ROLES.pick}\`) and the accent as a mark (\`${FACE_ROLES.accent}\`) under 多色, then 单色's
// page and selection. The bar is \`primary\` and its ink, in \`lib/generated/themeColors.ts\`. Hexes,
// because a tile shows a theme that is not the active one and every token is the active one's; a
// file of its own, because only /settings draws tiles and \`themeColors.ts\` is in every route.

import type { ThemeFace } from '../paletteSpec';
import type { BuiltInPaletteId } from './themeColors';

export const THEME_FACES: Record<BuiltInPaletteId, ThemeFace> = {
${entries.join('\n')}
};
`;
})();

const CSS_PATH = new URL('../app/theme-palettes.css', import.meta.url);
const TS_PATH = new URL('../lib/generated/themeColors.ts', import.meta.url);
const FACES_PATH = new URL('../lib/generated/themeFaces.ts', import.meta.url);

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

// Export uses this same generator and every numeric assertion, while allowing review of
// shared globals separately from installation. It never writes into the source tree.
const exportArgument = process.argv.find((arg) => arg.startsWith('--output-dir='));
const exportValue = exportArgument?.slice('--output-dir='.length).trim();
if (exportArgument && !exportValue) throw new Error('--output-dir needs a directory outside the repository');
const exportDirectory = exportValue ? resolve(exportValue) : null;
if (exportDirectory) {
  const fromRepository = relative(fileURLToPath(new URL('../', import.meta.url)), exportDirectory);
  if (!(isAbsolute(fromRepository) || fromRepository === '..' || fromRepository.startsWith(`..${sep}`))) {
    throw new Error('--output-dir must be outside the repository; use --write to install');
  }
}
const writing = process.argv.includes('--write');
if (writing && exportDirectory) throw new Error('Choose --write or --output-dir, not both');
if (!writing && !exportDirectory) {
  for (const [url, want, name] of [
    [CSS_PATH, paletteCss, 'app/theme-palettes.css'],
    [TS_PATH, themeColorsTs, 'lib/generated/themeColors.ts'],
    [FACES_PATH, themeFacesTs, 'lib/generated/themeFaces.ts'],
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
   * still the recipe's output rather than someone's edit. The generated files were held
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
if (writing || exportDirectory) {
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
  const outputRoot = exportDirectory ?? fileURLToPath(new URL('../', import.meta.url));
  for (const [relative, content] of [
    ['app/globals.css', halves.light + halves.dark],
    ['app/theme-palettes.css', paletteCss],
    ['lib/generated/themeColors.ts', themeColorsTs],
    ['lib/generated/themeFaces.ts', themeFacesTs],
  ]) {
    const path = join(outputRoot, relative);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, content);
  }
  console.log(`\n${exportDirectory ? 'exported' : 'wrote'} ${written} declarations for app/globals.css`);
  if (exportDirectory) {
    writeFileSync(join(outputRoot, 'palette-data.json'), JSON.stringify({
      themes: THEMES,
      generated: Object.fromEntries(generated),
      globalsChanges: changed,
    }, null, 2));
    console.log(`exported review files to ${exportDirectory}`);
  }
  console.log(
    `${exportDirectory ? 'exported' : 'wrote'} ${THEMES.length} palettes (多色 and 单色) to app/theme-palettes.css,` +
      ' lib/generated/themeColors.ts and lib/generated/themeFaces.ts',
  );
}
