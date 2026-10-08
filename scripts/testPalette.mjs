/**
 * The colour system's own contracts, with no browser: the custom palette's stored form (and the
 * single seed earlier builds wrote), the 副色相 rule and its guards, what 单色 and 多色 derive, the
 * shape of the blocks every palette is installed as, what a palette's tile is drawn from, the
 * image combinations, and the two new preferences' round trip through `lib/appearance` and the
 * account (`lib/settingsSync.ts`).
 * The ten built-ins' numbers are `npm run colors`'s job, not this file's.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { requireTypeStripping } from './tsResolve.mjs';

requireTypeStripping('testPalette');

/* ---- a document and a storage, enough for lib/appearance and lib/settingsSync ---- */
const values = new Map();
globalThis.localStorage = {
  getItem: (key) => (values.has(key) ? values.get(key) : null),
  setItem: (key, value) => values.set(key, String(value)),
  removeItem: (key) => values.delete(key),
};
const listeners = new Map();
const on = (target) => ({
  addEventListener(type, listener) {
    if (!target.has(type)) target.set(type, new Set());
    target.get(type).add(listener);
  },
  removeEventListener(type, listener) {
    target.get(type)?.delete(listener);
  },
  dispatchEvent(event) {
    for (const listener of [...(target.get(event.type) ?? [])]) listener(event);
    return true;
  },
});
globalThis.window = {
  ...on(listeners),
  setTimeout,
  clearTimeout,
  requestAnimationFrame: (cb) => setTimeout(cb, 0),
  matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }),
};
const cookies = new Map();
const styles = new Map();
const root = { dataset: {}, classList: { contains: () => false, add() {}, remove() {}, toggle() {} } };
globalThis.document = {
  ...on(new Map()),
  visibilityState: 'visible',
  documentElement: root,
  get cookie() {
    return [...cookies].map(([k, v]) => `${k}=${v}`).join('; ');
  },
  set cookie(line) {
    const [pair] = line.split(';');
    const at = pair.indexOf('=');
    cookies.set(pair.slice(0, at), pair.slice(at + 1));
  },
  querySelector: () => null,
  querySelectorAll: () => [],
  getElementById: (id) => styles.get(id) ?? null,
  createElement: () => ({ id: '', textContent: '' }),
  head: {
    append(node) {
      styles.set(node.id, node);
    },
  },
};

const spec = await import('../lib/paletteSpec.ts');
const rule = await import('../lib/paletteRule.ts');
const quantize = await import('../lib/quantize.ts');
const appearance = await import('../lib/appearance.ts');
const { COOKIE_KEYS, LS_KEYS } = await import('../lib/constants.ts');

test('a custom palette is stored as its seed and its 副色相, and a bare seed still reads', () => {
  assert.deepEqual(spec.parseCustomSpec('#E06C9F'), { seed: '#e06c9f', accent: null }, 'the old cookie, as 自动');
  assert.deepEqual(spec.parseCustomSpec(' #e06c9f/triadic '), { seed: '#e06c9f', accent: 'triadic' });
  assert.deepEqual(spec.parseCustomSpec('#e06c9f/272'), { seed: '#e06c9f', accent: 272 });
  assert.deepEqual(spec.parseCustomSpec('#e06c9f/0'), { seed: '#e06c9f', accent: 0 });
  for (const bad of ['#e06c9f/360', '#e06c9f/-3', '#e06c9f/auto', '#e06c9', 'e06c9f', '', null, 7]) {
    assert.equal(spec.parseCustomSpec(bad), null, `${bad} is not a spec`);
  }
  for (const value of [
    { seed: '#123456', accent: null },
    { seed: '#123456', accent: 'analogous' },
    { seed: '#123456', accent: 15 },
  ]) {
    assert.deepEqual(spec.parseCustomSpec(spec.formatCustomSpec(value)), value, 'round trip');
  }
  assert.equal(spec.formatCustomSpec({ seed: '#123456', accent: null }), '#123456', '自动 writes what old builds read');
  assert.equal(spec.parseAccent('271'), 271);
  assert.equal(spec.parseAccent(12.5), undefined, 'a hue is a whole degree');
  assert.equal(spec.parseAccent(undefined), undefined);
});

test('自动 is a quarter-turn that never lands on a severity or the olive shoulder', () => {
  for (let hue = 0; hue < 360; hue += 1) {
    const got = rule.relatedHue(hue, 'auto');
    assert.ok(Number.isInteger(got) && got >= 0 && got < 360, `${hue} → ${got}`);
    assert.equal(rule.isGuardedHue(got), false, `${hue} → ${got} is guarded`);
    assert.equal(Math.abs(rule.norm180(got - hue)), 90, `${hue} → ${got} is not a right angle`);
    for (const preset of ['analogous', 'triadic', 'complement']) {
      assert.equal(rule.isGuardedHue(rule.relatedHue(hue, preset)), false, `${preset} of ${hue}`);
    }
  }
  assert.equal(rule.relatedHue(355.7, 'auto'), 266, 'the brand pink lands on the mascot’s periwinkle bows');
  assert.equal(rule.relatedHue(150, 'auto'), 240, 'a green seed turns the other way: −90° is the warning band');
  assert.equal(rule.isGuardedHue(22) && rule.isGuardedHue(76) && rule.isGuardedHue(152) && rule.isGuardedHue(100), true);
});

test('a relation tapers with the seed’s hue, a named hue is taken at its word', () => {
  /* A neutral grey is chroma 1.9 in HCT, not 0, so its accents keep the same sliver of hue. */
  const grey = rule.customAccents('#808080', null);
  assert.ok(grey.second.chroma < 5 && grey.spark.chroma < 5, 'a grey seed gets accents as grey as it is');
  const confidence = rule.hctOf('#808080').chroma / rule.MIN_SEED_CHROMA;
  assert.ok(Math.abs(grey.spark.chroma - rule.SPARK_CHROMA * confidence) < 1e-9, 'scaled by the seed’s own confidence');
  const named = rule.customAccents('#808080', 150);
  assert.deepEqual(named.spark, { hue: 150, chroma: rule.SPARK_CHROMA }, 'a guarded hue the user named stays');
  const pink = rule.customAccents('#e06c9f', 'triadic');
  assert.equal(pink.second.hue, pink.spark.hue, 'one 副色相, shared by the second colour and the accent');
  assert.equal(pink.second.chroma, rule.SECOND_CHROMA);
});

test('单色 is one hue; 多色 gives the second colour and the accent, and keeps the ring and the chip', () => {
  const d = rule.deriveCustomTheme({ seed: '#e06c9f', accent: null });
  for (const scheme of ['light', 'dark']) {
    const mono = d.mono[scheme];
    assert.equal(mono.tertiary, mono.secondary);
    assert.equal(mono['tertiary-container'], mono['secondary-container']);
    assert.equal(mono.focus, mono.secondary);
    assert.equal(mono['chip-selected'], mono['secondary-container']);
    assert.equal(d[scheme].focus, mono.focus, 'the focus ring does not change with 配色方案');
    assert.equal(d[scheme]['chip-selected'], mono['chip-selected'], 'nor a selected chip');
    assert.notEqual(d[scheme].secondary, mono.secondary, '多色 moves the selection colour');
    assert.equal(d[scheme].primary, mono.primary, 'and never the primary');
  }
  assert.equal(Math.round(rule.hctOf(d.light.tertiary).tone), rule.SPARK_TONE, 'the accent is a mark tone in light');
});

test('a tile is drawn from the theme’s own roles, and 单色’s face is one hue', () => {
  for (const spec of [
    { seed: '#e06c9f', accent: null },
    { seed: '#3d8f6a', accent: 'complement' },
    { seed: '#808080', accent: 200 },
  ]) {
    const d = rule.deriveCustomTheme(spec);
    const tones = rule.paletteTones(d);
    for (const scheme of ['light', 'dark']) {
      const face = tones.face[scheme];
      assert.equal(tones[scheme].primary, d[scheme].primary, 'the bar is the primary');
      assert.equal(tones[scheme].onPrimary, d[scheme]['on-primary'], 'its tick is the primary’s ink');
      assert.equal(face.page, d[scheme]['surface-container-lowest'], 'the page is the lowest surface');
      assert.equal(face.pick, d[scheme]['secondary-container'], 'the pill is what a selection wears');
      assert.equal(face.accent, d[scheme].tertiary, 'the dot is the accent as a mark');
      assert.equal(face.monoPage, d.mono[scheme]['surface-container-lowest']);
      assert.equal(face.monoPick, d.mono[scheme]['secondary-container']);
      assert.equal(face.monoPick, d.mono[scheme]['chip-selected'], '单色’s pill is its one hue');
    }
  }
});

test('the tile’s page is the one surface step clear of every enclosure a tile is drawn on', () => {
  /* The reason for the page step, checked on the custom rule (ASSERTION 16 holds the ten): the
     lowest surface against the row, a dialog and a 副色相 tile, by tone. */
  const enclosures = ['surface-container-low', 'surface-container-high', 'surface-container-highest', 'secondary-container'];
  const tone = (hex) => rule.hctOf(hex).tone;
  for (const seed of ['#e06c9f', '#f9de84', '#30376c', '#808080']) {
    const d = rule.deriveCustomTheme({ seed, accent: null });
    for (const maps of [d, d.mono]) {
      for (const scheme of ['light', 'dark']) {
        const page = tone(maps[scheme][rule.FACE_ROLES.page]);
        for (const token of enclosures) {
          assert.ok(Math.abs(page - tone(maps[scheme][token])) >= 3.5, `${seed} ${scheme} page against ${token}`);
        }
        const row = tone(maps[scheme]['surface-container-low']);
        if (scheme === 'light') {
          assert.ok(Math.abs(tone(maps[scheme].surface) - row) < 3.5, 'the theme’s own surface would not clear the row');
        }
        assert.ok(Math.abs(page - row) > Math.abs(tone(maps[scheme].surface) - row), 'the step is further from it');
      }
    }
  }
});

test('every palette’s blocks declare one set of names per pair, and 单色 carries only what it changes', () => {
  const d = rule.deriveCustomTheme({ seed: '#3d8f6a', accent: 'complement' });
  const css = rule.paletteBlocksCss('custom', d);
  const blocks = [...css.matchAll(/(html[^{]+)\{([^}]*)\}/g)].map(([, selector, body]) => ({
    selector: selector.trim(),
    names: [...body.matchAll(/--md-sys-color-([a-z-]+):/g)].map((m) => m[1]),
  }));
  assert.deepEqual(
    blocks.map((b) => b.selector),
    [
      "html[data-palette='custom']",
      "html.dark[data-palette='custom']",
      "html[data-palette='custom'][data-palette-hues='mono']",
      "html.dark[data-palette='custom'][data-palette-hues='mono']",
    ],
  );
  assert.deepEqual(blocks[0].names, blocks[1].names);
  assert.deepEqual(blocks[2].names, blocks[3].names);
  assert.deepEqual(blocks[2].names, rule.monoTokens(d));
  assert.ok(!blocks[0].names.includes('error'), 'the severities are shared, not themed');
  assert.equal(rule.paletteBlocksCss('default', d, { multi: false }).includes("html[data-palette='default'] {"), false);
});

test('the generated file keeps the invariant for the ten', () => {
  const css = readFileSync(new URL('../app/theme-palettes.css', import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  const blocks = new Map(
    [...css.matchAll(/(html[^{]+)\{([^}]*)\}/g)].map(([, selector, body]) => [
      selector.trim(),
      [...body.matchAll(/--md-sys-color-([a-z-]+):/g)].map((m) => m[1]),
    ]),
  );
  let pairs = 0;
  for (const [selector, names] of blocks) {
    if (selector.startsWith('html.dark')) continue;
    const twin = selector.replace(/^html/, 'html.dark');
    assert.deepEqual(blocks.get(twin), names, `${selector} and its dark twin differ`);
    pairs += 1;
  }
  assert.equal(pairs, 19, 'nine themes × two 配色方案, and the default’s 单色');
});

test('an image’s combinations pair each seed with the picture’s own far, clean, chromatic partner', () => {
  const combos = rule.imageCombinations(['#cf7ba3', '#b98e69', '#8495d7', '#baa4c7']);
  assert.equal(combos[0].seed, '#cf7ba3');
  assert.equal(Math.round(rule.norm180(combos[0].accent - 274)), 0, 'the mascot’s pink takes her periwinkle');
  for (const { seed, accent } of combos) {
    if (accent === null) continue;
    assert.ok(Math.abs(rule.norm180(accent - rule.hctOf(seed).hue)) >= rule.MIN_ACCENT_GAP);
    assert.equal(rule.isGuardedHue(accent), false);
  }
  assert.deepEqual(rule.imageCombinations(['#e06c9f', '#e36a95']), [
    { seed: '#e06c9f', accent: null },
    { seed: '#e36a95', accent: null },
  ], 'two pinks have no partner: 自动');
});

test('the image quantizer starts its k-means from Java’s generator, seeded as AOSP seeds it', () => {
  /* Reference values printed by java.util.Random itself (JDK 24). */
  const aosp = quantize.javaRandom(0x42688);
  assert.deepEqual(Array.from({ length: 12 }, () => aosp.nextInt(128)), [49, 111, 34, 84, 13, 30, 91, 105, 9, 12, 118, 24],
    'a power-of-two bound, the path the quantizer takes at 128 clusters');
  const other = quantize.javaRandom(0x42688);
  assert.deepEqual(Array.from({ length: 12 }, () => other.nextInt(100)), [61, 18, 60, 65, 41, 51, 70, 69, 55, 38, 61, 96]);
  const small = quantize.javaRandom(42);
  assert.deepEqual(Array.from({ length: 6 }, () => small.nextInt(7)), [1, 5, 6, 3, 5, 4]);
});

test('the same picture gives the same colours on every read', () => {
  /* Three colour fields with per-pixel noise from a fixed generator: enough near-ties for the
     library's randomly started k-means to land differently from one run to the next. */
  const size = 112;
  const pixels = new Uint8ClampedArray(size * size * 4);
  let state = 7;
  const jitter = () => {
    state = (state * 1103515245 + 12345) & 0x7fffffff;
    return (state % 61) - 30;
  };
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4;
      const [r, g, b] = x < 40 ? [207, 124, 165] : x < 80 ? [131, 151, 217] : [212, 178, 83];
      pixels[i] = r + jitter();
      pixels[i + 1] = g + jitter();
      pixels[i + 2] = b + jitter();
      pixels[i + 3] = 255;
    }
  }
  const first = rule.sourceColorsFromPixels(pixels);
  assert.ok(first.length >= 3, 'the three fields come back');
  for (let run = 0; run < 8; run++) assert.deepEqual(rule.sourceColorsFromPixels(pixels), first);
});

/** A 112 × 112 picture of colour fields, each pixel jittered by a fixed generator. */
function picture(fields) {
  const size = 112;
  const pixels = new Uint8ClampedArray(size * size * 4);
  let state = 11;
  const jitter = () => {
    state = (state * 1103515245 + 12345) & 0x7fffffff;
    return (state % 21) - 10;
  };
  const total = size * size;
  const bounds = [];
  let end = 0;
  for (const { share } of fields) bounds.push((end += Math.round(share * total)));
  for (let p = 0; p < total; p++) {
    const field = fields[Math.min(bounds.findIndex((b) => p < b), fields.length - 1)] ?? fields.at(-1);
    const [r, g, b] = field.rgb;
    pixels.set([r + jitter(), g + jitter(), b + jitter(), 255], p * 4);
  }
  return pixels;
}

test('Monet’s four come first, and the picture offers up to four more of its own colours', () => {
  const pixels = picture([
    { rgb: [207, 124, 165], share: 0.3 },
    { rgb: [131, 151, 217], share: 0.25 },
    { rgb: [212, 178, 83], share: 0.2 },
    { rgb: [90, 160, 110], share: 0.14 },
    { rgb: [236, 236, 232], share: 0.105 },
    /* A small vivid subject: 0.5% of the picture, under Score's 1% neighbourhood cutoff. */
    { rgb: [240, 88, 36], share: 0.005 },
  ]);
  const four = rule.sourceColorsFromPixels(pixels, 4);
  const eight = rule.sourceColorsFromPixels(pixels, 8);
  assert.deepEqual(eight.slice(0, four.length), four, 'Monet’s own four, unchanged and first');
  assert.ok(eight.length > four.length && eight.length <= 8);
  const extras = eight.slice(four.length).map((hex) => rule.hctOf(hex));
  for (const hct of extras) assert.ok(hct.chroma >= 15, 'an extra defines a hue');
  const accent = rule.hctOf('#f05824');
  assert.ok(extras.some((hct) => Math.abs(rule.norm180(hct.hue - accent.hue)) < 15), 'the small vivid subject is offered');
  const all = eight.map((hex) => rule.hctOf(hex));
  for (let i = 0; i < all.length; i++) {
    for (let j = i + 1; j < all.length; j++) {
      const sameHue = Math.abs(rule.norm180(all[i].hue - all[j].hue)) < 15;
      assert.ok(!sameHue || Math.abs(all[i].tone - all[j].tone) >= 12 || i < four.length && j < four.length,
        `${eight[i]} and ${eight[j]} are two options, not one`);
    }
  }
});

test('the ranking is Score’s own: at Monet’s floor the port answers as the library does', async () => {
  const { Score } = await import('@material/material-color-utilities');
  const pictures = [
    picture([{ rgb: [207, 124, 165], share: 0.4 }, { rgb: [131, 151, 217], share: 0.3 }, { rgb: [212, 178, 83], share: 0.3 }]),
    picture([{ rgb: [240, 240, 236], share: 0.7 }, { rgb: [90, 160, 110], share: 0.2 }, { rgb: [240, 88, 36], share: 0.1 }]),
    picture([{ rgb: [30, 60, 140], share: 0.5 }, { rgb: [200, 60, 50], share: 0.25 }, { rgb: [250, 220, 90], share: 0.25 }]),
  ];
  for (const pixels of pictures) {
    const argb = [];
    for (let i = 0; i < pixels.length; i += 4) argb.push((255 << 24) | (pixels[i] << 16) | (pixels[i + 1] << 8) | pixels[i + 2]);
    const quantised = quantize.quantizeCelebi(argb, 128);
    assert.deepEqual(rule.monetPicks(rule.scoreClusters(quantised), 4, rule.MONET_MIN_CHROMA), Score.score(quantised, { desired: 4 }));
  }
});

test('the paper a sketch is drawn on is never offered as a theme', () => {
  /* A pastel sketch: seven tenths near-white paper with a faint lavender cast, soft shading and thin lines. */
  const pixels = picture([
    { rgb: [246, 244, 250], share: 0.7 },
    { rgb: [252, 205, 185], share: 0.14 },
    { rgb: [236, 200, 214], share: 0.08 },
    { rgb: [150, 118, 190], share: 0.05 },
    { rgb: [205, 112, 187], share: 0.03 },
  ]);
  const options = rule.sourceColorsFromPixels(pixels, 8);
  assert.ok(options.length > 0);
  for (const hex of options) assert.ok(rule.hctOf(hex).chroma >= rule.THEME_MIN_CHROMA, `${hex} defines a hue`);
  /* A picture with no colour that reaches 15 still has options: Monet's own floor. */
  const faint = rule.sourceColorsFromPixels(picture([
    { rgb: [236, 226, 222], share: 0.6 },
    { rgb: [214, 218, 226], share: 0.4 },
  ]), 8);
  assert.ok(faint.length > 0, 'a faint picture falls back instead of offering nothing');
});

test('a one-hue picture offers its lighter and darker tones, never one colour twice', () => {
  const pixels = picture([
    { rgb: [120, 30, 70], share: 0.34 },
    { rgb: [207, 90, 150], share: 0.33 },
    { rgb: [245, 180, 210], share: 0.33 },
  ]);
  const options = rule.sourceColorsFromPixels(pixels, 8).map((hex) => rule.hctOf(hex));
  assert.ok(options.length >= 3, 'the three tones come back');
  for (let i = 0; i < options.length; i++) {
    for (let j = i + 1; j < options.length; j++) {
      assert.ok(Math.abs(options[i].tone - options[j].tone) >= 12 ||
        Math.abs(rule.norm180(options[i].hue - options[j].hue)) >= 15, 'each option is its own colour');
    }
  }
});

test('配色方案 is an attribute present only for 单色, stored and mirrored into its cookie', () => {
  appearance.commitPaletteHues('mono');
  assert.equal(root.dataset.paletteHues, 'mono');
  assert.equal(values.get(LS_KEYS.paletteHues), 'mono');
  assert.equal(cookies.get(COOKIE_KEYS.paletteHues), 'mono');
  assert.equal(appearance.currentPaletteHues(), 'mono');
  appearance.commitPaletteHues('multi');
  assert.equal('paletteHues' in root.dataset, false, '多色 is the absence');
  assert.equal(cookies.get(COOKIE_KEYS.paletteHues), 'multi');
});

/** A whole tile's worth of hexes, each distinct, so a field packed out of order is caught. */
const tonesFixture = (primary) => {
  let n = 0x10;
  const next = () => `#${(n++).toString(16).padStart(2, '0').repeat(3)}`;
  const face = () => ({ page: next(), pick: next(), accent: next(), monoPage: next(), monoPick: next() });
  return {
    light: { primary, onPrimary: '#ffffff' },
    dark: { primary: next(), onPrimary: '#ffffff' },
    face: { light: face(), dark: face() },
  };
};

test('a custom install parks its spec and fourteen hexes on <html>, and writes the spec cookie', () => {
  const tones = tonesFixture('#111111');
  assert.equal(appearance.packTones(tones).split(' ').length, 14);
  assert.deepEqual(appearance.unpackCustomTones(appearance.packTones(tones)), tones);
  assert.equal(
    appearance.unpackCustomTones('#111111 #ffffff #222222 #ffffff #333333 #444444'),
    null,
    'the six-field chip form is not a tile',
  );
  assert.equal(appearance.unpackCustomTones('#1 #2 #3 #4'), null, 'nor anything that is not hexes');
  appearance.commitCustomPalette({ seed: '#111111', accent: 'triadic', css: '/* rules */', tones });
  assert.equal(root.dataset.palette, 'custom');
  assert.equal(root.dataset.paletteAccent, 'triadic');
  assert.equal(appearance.currentCustomAccent(), 'triadic');
  assert.equal(cookies.get(COOKIE_KEYS.paletteCustom), '#111111/triadic');
  assert.equal(values.get(LS_KEYS.paletteCustom), '#111111/triadic');
  assert.equal(styles.get('palette-custom').textContent, '/* rules */');
  appearance.commitCustomPalette({ seed: '#111111', accent: null, css: '', tones });
  assert.equal('paletteAccent' in root.dataset, false);
  assert.equal(cookies.get(COOKIE_KEYS.paletteCustom), '#111111', '自动 writes the bare seed');
});

test('a delayed custom recovery never overwrites a newer seed, companion or palette', async () => {
  const original = { seed: '#aa3355', accent: null };
  const start = () => {
    values.set(LS_KEYS.palette, 'custom');
    values.set(LS_KEYS.paletteCustom, spec.formatCustomSpec(original));
    root.dataset.palette = 'default';
    appearance.recoverCustomPalette();
  };
  const settled = async () => {
    // Join the same lazy recipe read, then let recovery's final continuation run.
    const lazy = await import('../lib/paletteLazy.ts');
    await lazy.resolveCustomPalette(original);
    await new Promise((resolve) => setImmediate(resolve));
  };
  for (const newer of [{ seed: '#3355aa', accent: null }, { seed: original.seed, accent: 272 }]) {
    start();
    appearance.commitCustomPalette({ ...newer, css: '/* newer rules */', tones: tonesFixture(newer.seed) });
    await settled();
    assert.deepEqual(appearance.currentCustomSpec(), newer);
    assert.equal(values.get(LS_KEYS.paletteCustom), spec.formatCustomSpec(newer));
    assert.equal(styles.get('palette-custom').textContent, '/* newer rules */');
  }
  start();
  appearance.commitPalette('luna');
  await settled();
  assert.equal(appearance.currentPalette(), 'luna');

  start();
  await settled();
  assert.deepEqual(appearance.currentCustomSpec(), original, 'an unchanged stored choice is recovered');
});

test('the static offline fallback uses the default palette in both schemes', () => {
  const globals = readFileSync(new URL('../app/globals.css', import.meta.url), 'utf8');
  const offline = readFileSync(new URL('../public/offline.html', import.meta.url), 'utf8');
  const painted = [globals.match(/(?:^|\n):root \{([\s\S]*?)\n\}/)[1], globals.match(/(?:^|\n)\.dark \{([\s\S]*?)\n\}/)[1]];
  const fallback = [...offline.matchAll(/:root \{([\s\S]*?)\}/g)].map((match) => match[1]);
  assert.equal(fallback.length, 2);
  for (let i = 0; i < 2; i++) {
    for (const token of ['surface', 'on-surface', 'on-surface-variant']) {
      const color = (text, prefix) => text.match(new RegExp(`--${prefix}${token}:\\s*(#[0-9a-f]{6});`))[1];
      assert.equal(color(fallback[i], ''), color(painted[i], 'md-sys-color-'), `${token} in ${i ? 'dark' : 'light'}`);
    }
  }
});

test('配色方案 and the 副色相 travel with the palette to the account', async () => {
  const writes = [];
  globalThis.fetch = async (url, init = {}) => {
    const action = new URL(String(url), 'https://app.invalid').searchParams.get('action');
    if (action !== 'update_settings') throw new Error(`unexpected request: ${action}`);
    writes.push(JSON.parse(init.body).settings);
    return new Response(JSON.stringify({ success: true }), { status: 200 });
  };
  const sync = await import('../lib/settingsSync.ts');
  sync.setSettingsSyncNotifier(() => {});
  let serverUser = null;
  sync.bindSettingsSync({
    refreshSession: async (token) => {
      const startedAt = Date.now();
      sync.adoptCloudSettings(token, structuredClone(serverUser), startedAt);
    },
    writeSession: (_token, settings) => {
      serverUser = { ...serverUser, settings: structuredClone(settings) };
    },
    afterBrowsingChange: () => {},
  });
  const account = { id: 3, token: 'token-p', username: 'pony', birthday: '2000-01-01' };
  values.set(LS_KEYS.userInfo, JSON.stringify(account));
  window.dispatchEvent(new Event('user_info_updated'));
  serverUser = { ...account, settings: { theme: 'luna', themeHues: 'mono', mascotId: '4' } };
  sync.adoptCloudSettings('token-p', structuredClone(serverUser), Date.now());
  assert.equal(values.get(LS_KEYS.palette), 'luna');
  assert.equal(values.get(LS_KEYS.paletteHues), 'mono', 'the account’s 配色方案 is adopted');
  assert.equal(root.dataset.paletteHues, 'mono');
  assert.equal(writes.length, 0, 'adopting writes nothing back');

  appearance.commitPaletteHues('multi'); // what the select's wipe ends in
  await new Promise((resolve) => setTimeout(resolve, 700));
  assert.equal(writes.at(-1).themeHues, 'multi', 'a choice made here is noticed and sent');
  assert.equal(writes.at(-1).mascotId, '4', 'keys this app does not manage ride through');

  const tones = tonesFixture('#aa3355');
  appearance.commitCustomPalette({ seed: '#aa3355', accent: 200, css: '', tones });
  await new Promise((resolve) => setTimeout(resolve, 700));
  assert.equal(writes.at(-1).theme, 'custom');
  assert.equal(writes.at(-1).themeCustomSeed, '#aa3355');
  assert.equal(writes.at(-1).themeCustomAccent, 200);
  appearance.commitCustomPalette({ seed: '#aa3355', accent: null, css: '', tones });
  await new Promise((resolve) => setTimeout(resolve, 700));
  assert.equal(writes.at(-1).themeCustomAccent, null, '自动 is written out, so an old hue cannot ride through');
  assert.deepEqual(sync.settingsSyncSnapshot().pending, {});
});
