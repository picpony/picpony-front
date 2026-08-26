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
//     lib/tagCategories.ts), the `media-*` roles, `scrim` and the six `plate-*` tones (the
//     /about plate's ring, whose hues come from the logo artwork). Those are all argued for
//     where they live. The semantic ramps — `error`, `success`, `warning` — carry their own
//     hues and are shared by all ten themes verbatim, because a severity that changes
//     colour with the user's theme is not a severity. `link` used to be on this list and is
//     not: it is the brand hue at a text tone now, so it rotates with the theme.

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
//
// ---------------------------------------------------------------------------
// The palette axis
//
// There are ten themes and they differ in **one input**: the seed. Not the seed's hue —
// the seed, all three of its coordinates. Everything else is a rule the ten share: the
// role→tone map, the neutral chroma, the harmony offsets, the semantic ramps, the
// vividness the brand chroma is held to, and the four lines under BRAND below that turn a
// seed into a brand tone, an ink tone and a choice of `on-primary`.
//
// It used to share one *number* instead — `BRAND_TONE = 61 / 54` — and the argument was
// that contrast against white ink is a function of tone alone, so one tone gives
// provably identical figures. That is true and it was the wrong thing to hold fixed. At
// tone 61 a yellow can only be #b88d00: the whole 40–130° band is dark gold, because the
// contrast that made the guarantee cheap is the same quantity that decides how light a
// hue is allowed to be. Fluttershy is a pale yellow pony and no amount of hue adjustment
// makes tone 61 pale.
//
// So the shared thing is the derivation rather than its output, and every threshold in it
// is the default theme's own measured value — which makes the default a fixed point of the
// rule: it emits exactly the values it emitted before, and the UNCHANGED list below is the
// proof.
//
// What this costs, stated once: the ten no longer share a lightness, so a `primary` used
// as *ink* on a light surface is no longer safe for every theme (Fluttershy's is 1.23:1
// against her own surface). That is what `primary-ink` is for — the brand hue at whichever
// tone reads on the page — and it is why the app's ink-ish call sites read that role
// instead. For seven of the ten it is the same hex as `primary`.
//
// ---------------------------------------------------------------------------
// Where a seed comes from
//
// The MLP-VectorClub colour guide, which extracts them from the show's own artwork. It is
// machine-readable — https://mlpvector.club/dist/mlpvc-colorguide.json, then
// `Appearances[id].ColorGroups[…].Colors[…]` — and **every seed below is one of its hexes,
// unaltered**. That is worth stating because for three rounds it was not, and the reason is
// one detail of the guide that is easy to miss: a coat is not a colour, it is *four labelled
// values* — Outline, Fill, Shadow Outline, Shadow Fill — and the Outline is the dark line
// drawn around the shape rather than the colour the character reads as. Five of the seven
// seeds were outlines. Fluttershy's yellow was reported ugly three times and each attempt to
// fix it moved her hue, because her Outline (#E9D461, tone 85) was standing in for a coat
// whose Fill is #FAF5AB (tone 95); once the right row is read, the warmed yellow and the
// cooled indigo that were the file's two hand-mixed seeds both disappear.
//
// Which row a character takes is a judgement — the recipe has no per-theme data, but the
// *input* is chosen by eye, from that character's own entry, and the reason is one line each:
//
//   - Applejack, Fluttershy, Rainbow Dash, Twilight take their **coat**; Applejack's Outline
//     is the orange she reads as (her Fill, #FABA62, is a pale amber at hue 73 that would sit
//     30° from Fluttershy), while the two pale ponies take a *fill* and Twilight her Outline.
//   - Fluttershy and Lyra take the **Shadow Fill** rather than the Fill, because their Fill is
//     tone 93–95, where a brand fill stops having a boundary against a near-white page. One
//     consequence, stated because identical values for two roles look like a bug: at tone 90
//     Fluttershy's fill lands on `primary-container`'s own step, so for that palette the two
//     are the same hex. That is inherent to holding a brand this light, and the app never puts
//     the two side by side.
//   - Rarity's coat is #BDC1C2, near-achromatic, so it has no usable hue at all, and
//     Chrysalis's is #2A2A2A at chroma 1.0. They take the next feature the guide gives them:
//     Rarity's mane, and Chrysalis's carapace — the shell being the changeling anatomy that
//     is not black. Her mane (#1E5972) was the other candidate and sits 11° from Rainbow
//     Dash; the carapace is 23° clear of Lyra and 50° clear of Rainbow.
//   - Luna's coat Outline is tone 8 and her coat Fill tone 28, both under the floor
//     ASSERTION 4 sets, so she takes her **mane**'s Main Fill — which is the night sky she
//     is known for, and at tone 37 it keeps her light and dark schemes 5 tones apart
//     rather than the coat's 14.
//   - Pinkie takes her mane (#EB458B) rather than her coat, because her coat is hue 353.5
//     chroma 50.4 and the brand pink is 355.7/56.8 — the same colour. The mane's chroma
//     of 79.4 is what distinguishes her theme from the default; the hues are 4° apart.
//
// Sorted by hue the ten leave 20.5° between the closest pair that is not that one, which is
// Luna against Rarity — the two purples the guide gives no way to separate further, since
// Rarity's only other stop (316.2) is 3° from Twilight.
// ---------------------------------------------------------------------------


import {
  Hct,
  TonalPalette,
  argbFromHex,
  hexFromArgb,
} from '@material/material-color-utilities';

/** The brand seed — the default theme's, and the origin the other nine measure against. */
const SEED = '#e06c9f';

/**
 * The ten themes. `id` is the `data-palette` value; `seed` is the one input.
 *
 * `default` is first and its entry must never change: it is what proves a run still
 * reproduces globals.css. The rest are ordered by hue so the picker reads as a wheel.
 *
 * There is no third field, and that is the point — no per-theme tone, chroma or hue
 * override exists, and no seed is hand-mixed: every hex below is a value the colour guide
 * lists for that character. Which of its values, and why, is the table in the header.
 */
const THEMES = [
  { id: 'default', label: '默认', seed: SEED },
  { id: 'applejack', label: '苹果嘉儿', seed: '#EF6F2F' },
  { id: 'fluttershy', label: '小蝶', seed: '#F3E488' },
  { id: 'lyra', label: '天琴', seed: '#62DFB2' },
  { id: 'chrysalis', label: '邪茧', seed: '#1E837F' },
  { id: 'rainbow', label: '云宝黛西', seed: '#6BABDA' },
  { id: 'luna', label: '露娜', seed: '#1C4CC2' },
  { id: 'rarity', label: '瑞瑞', seed: '#5E50A0' },
  { id: 'twilight', label: '暮光闪闪', seed: '#A46BBD' },
  { id: 'pinkie', label: '碧琪', seed: '#EB458B' },
];


/* WCAG relative luminance and contrast. Up here rather than beside the other checks
   because the brand tones below are *derived* from contrast rather than merely audited
   against it. */
const luminance = (hex) => {
  const ch = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  const lin = ch.map((c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * lin[0] + 0.7152 * lin[1] + 0.0722 * lin[2];
};
const contrast = (a, b) => {
  const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
};

/**
 * `primary`'s tone, and the two things that follow from it.
 *
 * AOSP puts primary at P40 light / P80 dark, and the direction is not arbitrary: the
 * brand has to separate from the surface it sits on, and that surface is near-white in
 * one scheme and near-black in the other. So the spec's light tone is the *darker* of
 * the two, and it changes with the scheme.
 *
 * This app holds the brand colour itself rather than a tone of it, because a filled
 * button that swaps shade with the theme does not read as one material. What it holds is
 * now **the seed's own lightness** rather than a shared constant — one rule, ten themes,
 * no per-theme data:
 *
 *   light tone   the seed's own, rounded. If white ink does not reach 3:1 on it, darken
 *                by up to WHITE_INK_SNAP tones to get there; if that is not enough, this
 *                is a light brand and it takes dark ink instead.
 *   dark tone    `light − DARK_SHIFT`, then lightened until it separates from the dark
 *                surface by DARK_SEPARATION. Eight of the ten never reach that floor; the
 *                two characters darker than it move up to it instead of down, because a
 *                brand darker than the floor has no boundary against a near-black page.
 *   on-primary   white where white clears the non-text bar in *both* schemes, else the
 *                palette's tone 20. One ink per theme, never flipping between schemes —
 *                which is structural here, since both scheme columns read this one field.
 *   ink tone     the lightest tone at or below the brand tone that still makes LIGHT_INK
 *                against the light surface. Where the brand already does, which is seven
 *                of the ten, the two are the same hex.
 *
 * Every threshold is either a WCAG bar or the default theme's own measured value, which is
 * what makes the default a fixed point: 3.08 white ink, 4.79 dark separation against a 3:1
 * floor it never reaches, 2.94 ink on surface.
 *
 * The known cost is unchanged and is now per-theme rather than global: white ink on the
 * brand measures 3.06 (Applejack), 3.08 (the default), 3.65 (Pinkie), 3.89 (Twilight) and
 * 4.49 (Chrysalis) in light and 3.87 / 3.91 for the default and Applejack in dark, all under
 * the 4.5:1 AA floor for 14px text — the label of every `filled` button, the active
 * pagination number, the featured badge. The other white-ink themes reach 4.63–6.01 in dark
 * and 6.73–7.23 in light, so the figure is per-theme rather than a property of the role.
 * Contrast is a function of two colours and both levers have a visible price (a single tone
 * at 48 clears it at 4.81:1 and reads deeper and duller; `on-primary` at P10 clears it at
 * 5.55/4.41 and puts dark glyphs on the app bar). Neither is taken. The three light-coated
 * characters take dark ink and clear the text floor outright — Fluttershy 10.14/8.37, Lyra
 * 7.97/6.48, Rainbow 5.35/4.30. That is the one place a per-seed tone *improves* on the
 * shared one.
 */
const WHITE_INK_BAR = 3; // WCAG 1.4.11: a non-text graphic. The wordmark and glyphs are one.
const WHITE_INK_SNAP = 2; // tones of latitude, i.e. the rounding's own scale
const DARK_SHIFT = 7; // light → dark, the separation this app has always carried
/* The dark scheme's floor is **WCAG 1.4.11's 3:1**, not the default theme's own 4.79.
 *
 * That distinction is the difference between one rule and two directions. The dark page is
 * tone 6, so separation from it is very nearly a function of the brand's tone alone —
 * measured across the ten at tone 41 it is 2.96–2.99, at tone 42 it is 3.07–3.11, at tone 54
 * it is 4.74–4.79, i.e. the ten agree to ±0.05 — and a floor of 4.79 therefore *pins* every
 * brand darker than tone 61 to tone 54. Chrysalis (50), Twilight (54), Pinkie (56), Rarity
 * (39) and Luna (37) all landed there, so three themes came out **lighter** in dark than in
 * light, Twilight came out identical in both, and Pinkie's shift was cut from seven tones to
 * two — while the five lighter ones kept the documented "seven tones deeper". One knob, two
 * visibly different behaviours.
 *
 * At 3:1 the floor is tone 42, and eight of the ten simply take `light − 7`. The two that
 * cannot are the two characters darker than that floor, and what they cannot do is not a
 * choice: a tone-37 navy on a near-black page has no boundary, and an app bar with no
 * boundary is exactly what 1.4.11 is about. They move *up* to the floor instead — Luna by 5
 * tones and Rarity by 3, which is less movement between schemes than the default theme's own
 * 7. */
const DARK_SEPARATION = 3;
const LIGHT_INK = 2.9; // the default's own 2.94, floored

/** M3 `SchemeTonalSpot`'s neutral chroma. Measured at ~1.6 in the file before this. */
const NEUTRAL_CHROMA = 6;

const hctOf = (hex) => Hct.fromInt(argbFromHex(hex));
const seed = hctOf(SEED);

/**
 * The most chroma sRGB can hold at a hue and a tone.
 *
 * HCT gamut-maps by holding hue and tone and dropping chroma, so asking for far more than
 * exists returns the ceiling. That ceiling is what makes a hue's identity a function of its
 * lightness: at tone 50 a violet can reach 88 and a teal only 40, and a yellow's peak sits
 * at tone 89 where a blue's sits at 69.
 */
const maxChroma = (hue, tone) => Hct.from(hue, 200, tone).chroma;

/**
 * How vivid a brand is, as a fraction of what its own hue can do at its own tone.
 *
 * This replaces an absolute floor — AOSP `CorePalette.of`'s `max(48, chroma)` — and the
 * reason is that 48 means something different at every hue. Measured against the ceiling
 * above: at Rarity's violet it is 55% of what is available, at Rainbow's blue 81%, and at
 * Chrysalis's teal it is **unreachable**, because that hue tops out at 40 — so the "floor"
 * was quietly pinning some themes to the gamut edge while leaving others muted. A fraction
 * is achievable everywhere and means the same thing everywhere, which an absolute floor
 * cannot be.
 *
 * The value is the default theme's own, so the brand is the definition rather than a
 * participant, and it is applied as a *floor*: a character more saturated than the brand
 * keeps their own chroma (Pinkie 79, Applejack 65), a character flatter than it is brought
 * up to it (Rarity 46 -> 58, Twilight 49 -> 60). It cannot desaturate anyone.
 */
const VIVIDNESS = seed.chroma / maxChroma(seed.hue, Math.round(seed.tone));

/** A hue difference, brought into (−180, 180] so a wrap at 360 cannot become a rotation. */
const norm180 = (d) => ((((d + 180) % 360) + 360) % 360) - 180;

/* The brand harmony, as offsets from the seed rather than as absolute values.
 *
 * `secondary`, `tertiary` and `neutralVariant` used to be three fixed hexes with their
 * hue and chroma read back out. That was right while there was one seed — reading them
 * back is what let a run reproduce the file exactly for roles it was not meant to move,
 * which is the only way to tell a generated value from a hand-edited one — and it is
 * what stops the moment there is more than one seed.
 *
 * They are *not* AOSP's defaults, so substituting AOSP's constants would have moved the
 * default theme. Measured: secondary is hue 354.8 / chroma 19.4 where `TonalSpot` says
 * chroma 16; tertiary is 53.0 / 37.1 where the spec says +60° / 24; neutralVariant is
 * 346.2 / 6.7 where the spec says 8. So what generalises is the *relationship*: hold each
 * one's distance from the seed's hue and its own chroma, and the whole harmony rotates
 * with the brand. For the default seed that is arithmetically the same palette it was,
 * which the UNCHANGED list below is the proof of.
 *
 * The wrap matters: tertiary's raw difference is −302.69, and using that instead of
 * +57.31 sends the third colour somewhere else entirely. */
const rel = (hex) => {
  const m = hctOf(hex);
  return { dHue: norm180(m.hue - seed.hue), chroma: m.chroma };
};

const HARMONY = {
  secondary: rel('#755360'),
  tertiary: rel('#894d1f'),
  /* Its chroma is asserted below: measured against M3's own output this palette is
     already at ~97% of the spec's chroma 8, so moving it would turn a micro-adjustment
     into a re-skin. `outline` and the supporting-text role are the two most-repeated
     non-brand colours in the app. */
  neutralVariant: rel('#7f7378'),
};

/* The semantic ramps. Their hues are their meaning, so they are absolute and every
   theme shares them — see the header. */
const SEMANTIC = {
  error: '#a62a2c',
  success: '#256f3b',
  warning: '#7f5400',
};

const fromHex = (hex) => {
  const m = hctOf(hex);
  return TonalPalette.fromHueAndChroma(m.hue, m.chroma);
};

/**
 * The one recipe. Everything a theme is, from a hue and a chroma.
 *
 * The chroma arriving here has already been through the vividness floor in `themeInput`;
 * this function holds no policy of its own.
 */
const paletteSet = (hue, chroma) => ({
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
});

/** Resolved once per theme: the hue/chroma/tone actually fed to the recipe. */
const themeInput = (theme) => {
  const s = hctOf(theme.seed);
  const tone = Math.round(s.tone);
  const ceiling = maxChroma(s.hue, tone);
  return {
    hue: s.hue,
    tone,
    seedTone: s.tone,
    seedChroma: s.chroma,
    ceiling,
    chroma: Math.max(s.chroma, VIVIDNESS * ceiling),
  };
};

const PALETTE_SETS = new Map(
  THEMES.map((t) => {
    const { hue, chroma } = themeInput(t);
    return [t.id, paletteSet(hue, chroma)];
  }),
);

const toneOf = (themeId, palette, t) =>
  hexFromArgb(PALETTE_SETS.get(themeId)[palette].tone(t)).toLowerCase();

/**
 * The brand tones, derived per theme by the five rules documented above.
 *
 * `surface` is read from the theme's own neutral palette rather than passed in, because
 * "separates from the page" means *this* theme's page — the neutral rotates with the seed
 * too, so a shared figure would be measuring the wrong ground.
 */
const brandTones = (themeId, brandTone) => {
  const p = (t) => toneOf(themeId, 'primary', t);
  const surfaceLight = toneOf(themeId, 'neutral', 98);
  const surfaceDark = toneOf(themeId, 'neutral', 6);

  let light = brandTone;
  let white = contrast('#ffffff', p(light)) >= WHITE_INK_BAR;
  if (!white) {
    for (let d = 1; d <= WHITE_INK_SNAP; d += 1) {
      if (contrast('#ffffff', p(light - d)) >= WHITE_INK_BAR) {
        light -= d;
        white = true;
        break;
      }
    }
  }

  let dark = light - DARK_SHIFT;
  while (dark < 95 && contrast(p(dark), surfaceDark) < DARK_SEPARATION) dark += 1;

  // Both schemes or neither: `primary` does not invert here, so its ink must not either.
  if (white && contrast('#ffffff', p(dark)) < WHITE_INK_BAR) white = false;

  let inkLight = light;
  while (inkLight > 10 && contrast(p(inkLight), surfaceLight) < LIGHT_INK) inkLight -= 1;

  return { light, dark, onPrimary: white ? 100 : 20, inkLight, inkDark: dark };
};

const BRAND = new Map(THEMES.map((t) => [t.id, brandTones(t.id, themeInput(t).tone)]));


/* The role → tone map, verbatim from AOSP's generated
   `ColorLightTokens.kt` / `ColorDarkTokens.kt`, VERSION v0_210. Fetch with:

     base=https://android.googlesource.com/platform/frameworks/support/+/refs/heads/\
     androidx-main/compose/material3/material3/src/commonMain/kotlin/androidx/compose/material3
     curl -s "$base/tokens/ColorLightTokens.kt?format=TEXT" | base64 -d

   Only the roles this app declares are listed. A tone may be a function of the theme's
   derived brand tones — three roles are, and every one of them is on the brand palette. */
const ROLES = [
  // token,                     palette,          light,       dark
  ['primary',                   'primary',        (b) => b.light,     (b) => b.dark],
  /* Both scheme columns read the same field on purpose: one ink per theme, so a `filled`
     button cannot read as two different components between schemes. That makes the
     non-inversion structural rather than something a check has to catch — what is checked
     is that the choice clears the bar in both schemes, by the `floor` row in PAIRS. */
  ['on-primary',                'primary',        (b) => b.onPrimary, (b) => b.onPrimary],
  ['primary-container',         'primary',        90,          30],
  ['on-primary-container',      'primary',        10,          90],
  ['inverse-primary',           'primary',        80,          40],
  /* The brand as *ink* — see BRAND above. Same hex as `primary` for seven of the ten;
     for the three light-coated characters it is the tone that can still be read on the page. */
  ['primary-ink',               'primary',        (b) => b.inkLight,  (b) => b.inkDark],
  /* Navigable text. It was a hand-written blue for both schemes, on the argument that blue
     is a link's affordance rather than a brand element — true, and it left every link in
     the app ignoring the theme, including the source URL on an image's detail page. It is
     the brand hue at a text tone now, and prose links carry a rest-state underline so the
     affordance no longer rests on hue alone. Measured across the ten: 6.12–6.19:1 light
     and 10.81–10.94:1 dark against `surface`, against the old blue's 6.34 and 10.09. */
  ['link',                      'primary',        40,          80],
  ['link-hover',                'primary',        35,          85],

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

/* Which of those roles a *character* theme overrides.
 *
 * The five brand-and-surface palettes rotate with the seed; the three semantic ones do
 * not, so their twelve roles are emitted once — in globals.css, by the default theme —
 * and inherited by the other nine. That inheritance is why the generated blocks can be a
 * partial override rather than a full scheme: `[data-palette=…]` only has to say what
 * differs from `:root`.
 *
 * Everything reached through a `var()` indirection is deliberately absent for the same
 * reason and must stay absent: `surface-raised` points at a container step, and
 * `focus` / `focus-on-primary` / `focus-on-media` point at `secondary` / `on-primary` /
 * `on-media`. Re-emitting them would freeze the indirection at generate time. */
const THEMED_PALETTES = new Set(['primary', 'secondary', 'tertiary', 'neutral', 'neutralVariant']);
const THEMED_ROLES = ROLES.filter(([, palette]) => THEMED_PALETTES.has(palette));

/* ---------------------------------------------------------------------------
 * What is in the file now
 * ------------------------------------------------------------------------ */

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';

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
 * `luminance` and `contrast` themselves live up beside BRAND, which derives tones from
 * them rather than only checking them.
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
 * "consistent across themes" means now that the brand tone is per-seed:
 *
 *   spread   the tone map is identical for both members, so the pair varies only with hue.
 *            Held to ±SPREAD of the default. This is where the uniformity lives.
 *   floor    a brand member, so the value is a design consequence rather than a constant.
 *            Held to its own bar, per theme, with no spread.
 *   report   printed for review, asserted nowhere. Either the default already fails it
 *            (and says why in globals.css), or it measures a brand fill against a surface,
 *            which is exactly the quantity a per-seed brand tone is allowed to move.
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

/** themeId -> { light: { token: hex }, dark: { … } }, every role in `ROLES`. */
const generated = new Map();

for (const theme of THEMES) {
  const brand = BRAND.get(theme.id);
  const out = { light: {}, dark: {} };
  for (const [token, palette, lightTone, darkTone] of ROLES) {
    for (const [scheme, raw] of [
      ['light', lightTone],
      ['dark', darkTone],
    ]) {
      const t = typeof raw === 'function' ? raw(brand) : raw;
      const hex = toneOf(theme.id, palette, t);
      out[scheme][token] = hex;

      /* ASSERTION 1 — the emitted colour is actually at the tone asked for. HCT maps
         out-of-gamut values by holding tone and dropping chroma, so this should hold
         even at the saturated ends; if it ever does not, the ramp is lying about its
         own lightness and every contrast figure derived from it is unsafe. That matters
         more than it looks: BRAND *derives* three tones per theme by measuring contrast
         on this palette, so a ramp that misses its own tone would quietly move the brand
         itself rather than only a reported figure. */
      const got = hctOf(hex).tone;
      if (Math.abs(got - t) > 0.5) {
        failures.push(`${theme.id} ${scheme} ${token}: asked tone ${t}, got ${got.toFixed(2)}`);
      }
    }
  }
  generated.set(theme.id, out);
}

const next = generated.get('default');

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
 * necessarily nudges the other. Measured here: the dark end moves 5.87 -> 6.63.
 *
 * Two forms now. Against the file, for the default theme, which is the original check
 * and the only one that can catch a hand-edit. Against the recipe's own target, for all
 * ten — because the other nine have nothing in the file to compare with, and what
 * actually has to hold for them is that the *palette* is the one the recipe asked for. */
const NV_TOKENS = ['on-surface-variant', 'outline', 'outline-variant'];
for (const scheme of ['light', 'dark']) {
  for (const token of NV_TOKENS) {
    const was = current[scheme][token];
    if (!was) continue;
    const before = hctOf(was);
    const after = hctOf(next[scheme][token]);
    if (Math.abs(after.chroma - before.chroma) > 1) {
      failures.push(
        `default ${scheme} ${token} chroma moved: ${before.chroma.toFixed(2)} -> ${after.chroma.toFixed(2)}`,
      );
    }
  }
}
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
  `neutral chroma ${NEUTRAL_CHROMA}, brand tone derived per seed` +
    ` (white ink ≥ ${WHITE_INK_BAR} with ${WHITE_INK_SNAP} tones of latitude,` +
    ` dark shift ${DARK_SHIFT} floored at ${DARK_SEPARATION} separation, ink ≥ ${LIGHT_INK})`,
);
console.log(
  `vividness floor ${(VIVIDNESS * 100).toFixed(1)}% of the hue's own ceiling at its own tone` +
    ` — the default's ${seed.chroma.toFixed(1)} of ${maxChroma(seed.hue, Math.round(seed.tone)).toFixed(1)}`,
);
console.log(
  `harmony  secondary ${HARMONY.secondary.dHue.toFixed(2)}° C${HARMONY.secondary.chroma.toFixed(1)}` +
    `  tertiary ${HARMONY.tertiary.dHue.toFixed(2)}° C${HARMONY.tertiary.chroma.toFixed(1)}` +
    `  neutralVariant ${HARMONY.neutralVariant.dHue.toFixed(2)}° C${HARMONY.neutralVariant.chroma.toFixed(1)}\n`,
);

console.log('THEMES');
for (const theme of THEMES) {
  const { hue, chroma, tone, seedChroma, ceiling } = themeInput(theme);
  const b = BRAND.get(theme.id);
  const g = generated.get(theme.id);
  console.log(
    `  ${pad(theme.id, 11)} ${pad(theme.label, 6)} hue ${hue.toFixed(1).padStart(5)}` +
      `  chroma ${seedChroma.toFixed(1).padStart(5)}${chroma > seedChroma + 0.05 ? ` -> ${chroma.toFixed(1)}` : '        '}` +
      ` of ${ceiling.toFixed(0).padStart(3)} (${((chroma / ceiling) * 100).toFixed(0).padStart(3)}%)` +
      `  tone ${String(tone).padStart(2)} -> brand ${String(b.light).padStart(2)}/${b.dark}` +
      `  ink ${String(b.inkLight).padStart(2)}/${b.inkDark}` +
      `  on-primary ${b.onPrimary === 100 ? 'white' : `tone 20 ${g.light['on-primary']}`}`,
  );
  console.log(
    `              primary ${g.light.primary} / ${g.dark.primary}` +
      `  ink ${g.light['primary-ink']} / ${g.dark['primary-ink']}` +
      `${g.light['primary-ink'] === g.light.primary ? ' [ink == fill]' : ' [ink != fill]'}` +
      `  surface ${g.light.surface} / ${g.dark.surface}` +
      `  link ${g.light.link} / ${g.dark.link}`,
  );
}

/* The hue wheel, because the closest pair is the thing a new theme is most likely to
   break and no other line of this report would show it. */
const wheel = THEMES.map((t) => ({ id: t.id, hue: themeInput(t).hue })).sort((a, b) => a.hue - b.hue);
console.log('\n  hue order  ' + wheel.map((w) => `${w.id} ${w.hue.toFixed(1)}`).join('  ·  '));
console.log(
  '  gaps       ' +
    wheel
      .map((w, i) => {
        const prev = wheel[(i - 1 + wheel.length) % wheel.length];
        const gap = norm180(w.hue - prev.hue);
        return `${(gap < 0 ? gap + 360 : gap).toFixed(1)}`;
      })
      .join('  ') ,
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
 * the default. That was checkable because the brand tone was shared, and it is the check
 * that made the shared tone worth keeping — so replacing the tone means replacing it.
 *
 * The three kinds are declared per pair in PAIRS above. `spread` is the same ±SPREAD test
 * as before and still covers everything whose tone map the ten share, which is every
 * surface step, both neutral-variant roles, the whole secondary/tertiary harmony, the
 * semantic containers and the two link roles — measured, the worst is 0.16. `floor` covers
 * the two pairs a per-seed brand tone is allowed to move: white-or-dark ink on the brand,
 * and the brand's ink on the page. `report` is printed and not asserted.
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

/* ASSERTION 4 — a seed's own lightness is usable as a brand tone.
 *
 * There is no assertion here that `on-primary` does not invert between schemes, and there
 * was one until it was noticed that it could not fail: the `on-primary` row in ROLES hands
 * the *same* `b.onPrimary` to both scheme columns, so the two are one `toneOf` call and are
 * equal by construction rather than by check. What can actually go wrong is the choice being
 * unjustified in one scheme, and that is the `on-primary`/`primary` `floor` row in PAIRS,
 * which measures it per scheme (3.06–10.14 light, 3.87–8.37 dark).
 *
 * The brand tone is the seed's, so a near-white or near-black seed would produce a theme
 * whose largest surfaces cannot be told from the page behind them. Asserted rather than
 * clamped on purpose: clamping would hand back a theme that is quietly *not* the colour
 * that was asked for, which is the failure mode this whole file exists to prevent. It is
 * also the check that picks a character's row for them at both ends — Luna's coat Outline
 * (tone 8) and Fill (tone 28) fail it, which is how she ended up on her mane, and
 * Fluttershy's and Lyra's coat Fills (95 and 93) fail it, which is how they ended up on
 * their Shadow Fills.
 *
 * The upper end is where a *fill* stops separating from a near-white page, and the slope is
 * shallow enough that the number needs its measurements beside it: at tone 90 (Fluttershy's)
 * `primary` on `surface` is 1.23:1, at 93 it is 1.13, at 95 it is 1.08. Those are all below
 * any WCAG bar — a brand fill is judged against its own `on-primary`, not against the page —
 * so what the ceiling protects is the *boundary* of the app bar, and 92 is where a hue
 * difference stops carrying it on its own. */
for (const theme of THEMES) {
  const { seedTone } = themeInput(theme);
  if (seedTone < 30 || seedTone > 92) {
    failures.push(
      `${theme.id} seed ${theme.seed} is tone ${seedTone.toFixed(1)}, outside 30–92 — too close to` +
        ' white or black to serve as a brand fill; pick a different row of the colour guide',
    );
  }
}

/* ASSERTION 5 — the hue wheel has no coincident pair.
 *
 * Two themes at the same hue are two themes that look the same in the picker however
 * different their tones are, and the picker is a radiogroup of coloured circles with a
 * caption — the caption is not what anyone reads. The bar is 15°, which is under the
 * closest *deliberate* pair (Luna against Rarity at 20.5°) and over the one exception:
 * the brand and Pinkie are 4.2° apart and separated by chroma instead, 56.8 against 79.4,
 * which is a visible difference at equal hue where 4° is not. */
const HUE_BAR = 15;
{
  const wheel = THEMES.map((t) => ({ id: t.id, hue: themeInput(t).hue })).sort((a, b) => a.hue - b.hue);
  for (let i = 0; i < wheel.length; i += 1) {
    const a = wheel[i];
    const b = wheel[(i + 1) % wheel.length];
    const gap = Math.abs(norm180(b.hue - a.hue));
    const exempt = [a.id, b.id].every((id) => id === 'default' || id === 'pinkie');
    if (gap < HUE_BAR && !exempt) {
      failures.push(
        `${a.id} and ${b.id} are ${gap.toFixed(1)}° apart in hue, under the ${HUE_BAR}° bar` +
          ' — one of them needs a different row of the colour guide',
      );
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
    ' * warning), the categorical `accent-*` scale, the `media-*` roles, `scrim` and `plate-*`',
    ' * are shared by every theme and stay in globals.css — a severity that changed colour with',
    ' * the theme would not be a severity, and a tag category that did would not be a category.',
    ' *',
    " * The default theme is `:root` itself, so there is no `[data-palette='default']` block:",
    ' * choosing it simply stops matching any of these.',
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
    const { hue, chroma } = themeInput(theme);
    const b = BRAND.get(theme.id);
    const g = generated.get(theme.id);
    lines.push(
      `/* ${theme.label} — hue ${hue.toFixed(1)}, chroma ${chroma.toFixed(1)},` +
        ` brand tone ${b.light}/${b.dark}, ink ${b.inkLight}/${b.inkDark},` +
        ` on-primary ${b.onPrimary === 100 ? 'white' : 'tone 20'} */`,
    );
    for (const [selector, scheme] of [
      [`html[data-palette='${theme.id}']`, 'light'],
      [`html.dark[data-palette='${theme.id}']`, 'dark'],
    ]) {
      lines.push(`${selector} {`);
      for (const [token] of THEMED_ROLES) {
        lines.push(`  --md-sys-color-${token}: ${g[scheme][token]};`);
      }
      lines.push('}');
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
// Two hexes per theme per scheme, for the two places a \`var()\` cannot reach.
//
// \`primary\` is the \`<meta name="theme-color">\` value: the browser reads that tag to
// paint its own chrome before any stylesheet exists, so it has to be a literal. It used
// to be two literals hand-copied into \`viewport.themeColor\` in \`app/layout.tsx\`, with a
// comment calling them the app's only unavoidable ones; there are twenty now, which is
// past what a human keeps in step, so they are generated and the layout inlines them.
//
// Both are also the swatch's, for the picker in /settings: a swatch has to show a theme that
// is *not* the active one, so it cannot read the tokens — those are always the active theme's.
// \`onPrimary\` is there because the selected swatch carries a tick, and which ink that tick
// takes is a per-theme answer now: seven themes are white on their brand and the three
// light-coated characters are dark.
//
// Two fields have been removed over time — \`primary-container\`, then \`surface\` when the
// swatch stopped drawing a surface ring behind the colour. A payload no consumer touches is
// a payload that goes stale silently, so it goes.

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

export type PaletteId = (typeof PALETTES)[number]['id'];

export const DEFAULT_PALETTE: PaletteId = '${THEMES[0].id}';

const IDS: readonly string[] = PALETTES.map((p) => p.id);

export function isPaletteId(value: unknown): value is PaletteId {
  return typeof value === 'string' && IDS.includes(value);
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
 * The repo has `core.autocrlf=true` and no `.gitattributes` covering these two files, so
 * git checks them out CRLF while this script writes them LF. A raw byte compare therefore
 * reports both stale on a *clean* tree, forever, from the first fresh clone — and
 * `colors:write` would then rewrite them LF and produce a whole-file diff. `globals.css` is
 * immune because it is patched declaration by declaration rather than rewritten.
 * There is also a `.gitattributes` pinning both to `eol=lf`, which fixes the working tree;
 * this fixes the check even where that file has not been applied yet. */
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



