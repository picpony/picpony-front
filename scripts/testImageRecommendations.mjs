import assert from 'node:assert/strict';
import { test } from 'node:test';
import { requireTypeStripping } from './tsResolve.mjs';

requireTypeStripping('testImageRecommendations');
const { recommendImageColors } = await import('../lib/imageRecommendations.ts');
const { quantizeCelebi } = await import('../lib/quantize.ts');
const { hctOf, norm180, deriveCustomTheme, deriveTheme, contrast } = await import('../lib/paletteRule.ts');
const { parseCustomSpec } = await import('../lib/paletteSpec.ts');

function image(rows) {
  const pixels = [];
  for (const [hex, count, alpha = 255] of rows) {
    const rgb = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
    for (let i = 0; i < count; i++) pixels.push(...rgb, alpha);
  }
  return new Uint8ClampedArray(pixels);
}
const hueGap = (a, b) => Math.abs(norm180(hctOf(a).hue - hctOf(b).hue));

test('duplicate RGB centres conserve all 92 pixels, preserving the original centres', () => {
  // Captured negative control: the former if-absent-only insertion returned 71/92.
  const pixels = Array.from({ length: 92 }, (_, i) =>
    (255 << 24) | (254 << 16) | ((224 + i % 12) << 8) | (170 + (i * 7) % 15));
  const got = quantizeCelebi(pixels, 8);
  assert.equal([...got.values()].reduce((a, b) => a + b, 0), 92);
  assert.deepEqual([...got.keys()], [4294894769, 4294895793, 4294895789, 4294894260, 4294895541]);
});

test('paper does not outvote pale peach, and the peach is not pushed into a dark register', () => {
  const got = recommendImageColors(image([['#ffffff', 1600], ['#fecec3', 800], ['#8d7ac3', 80]]));
  const primary = hctOf(got[0].seed);
  assert.ok(hueGap(got[0].seed, '#fecec3') < 3);
  assert.ok(primary.tone > 85 && primary.tone < 87);
  assert.ok(primary.chroma > 15 && primary.chroma < 24);
  assert.ok(got[0].accent > 270 && got[0].accent < 325, 'the purple line art is a companion');
});

test('a one-percent vivid detail cannot replace a large readable hue family', () => {
  const got = recommendImageColors(image([['#99ddcc', 9900], ['#ff0044', 100]]));
  assert.ok(hueGap(got[0].seed, '#99ddcc') < 3);
  assert.ok(got.some((c) => hueGap(c.seed, '#ff0044') < 3), 'the detail remains available after the main area');
});

test('every family gets its place before a light alternative of a deep blue', () => {
  const got = recommendImageColors(image([['#24326a', 600], ['#f4c3b2', 300], ['#8de3ca', 100]]));
  assert.ok(hctOf(got[0].seed).tone >= 33.5 && hctOf(got[0].seed).tone <= 42.5);
  assert.ok(hueGap(got[1].seed, '#f4c3b2') < 3);
  assert.ok(hueGap(got[2].seed, '#8de3ca') < 3);
  assert.ok(hueGap(got[3].seed, got[0].seed) < 3 && hctOf(got[3].seed).tone > 81);
});

test('a light cool image stays light; a jewel alternative requires evidence of a dark family', () => {
  const got = recommendImageColors(image([['#b7e4f8', 500]]));
  assert.equal(got.length, 1);
  assert.ok(hctOf(got[0].seed).tone >= 82);
});

test('companion ranking uses covered area before chroma, and an absent companion stays automatic', () => {
  const got = recommendImageColors(image([['#fecec3', 750], ['#bc9ae0', 240], ['#00eaff', 10]]));
  assert.ok(Math.abs(norm180(got[0].accent - hctOf('#bc9ae0').hue)) < 3);
  assert.equal(recommendImageColors(image([['#fecec3', 200]]))[0].accent, null);
});

test('transparent RGB and partial alpha do not contribute; an empty image does not invent blue', () => {
  const visible = recommendImageColors(image([['#99ddcc', 100]]));
  const withClear = recommendImageColors(image([['#ff0000', 1000, 0], ['#0000ff', 500, 254], ['#99ddcc', 100]]));
  assert.deepEqual(withClear, visible);
  assert.deepEqual(recommendImageColors(image([['#ff0000', 200, 0]])), []);
  assert.deepEqual(recommendImageColors(new Uint8ClampedArray()), []);
});

test('grayscale keeps actual tones in population order and has no invented companion', () => {
  assert.deepEqual(recommendImageColors(image([['#cccccc', 800], ['#555555', 200]])), [
    { seed: '#cccccc', accent: null }, { seed: '#555555', accent: null },
  ]);
});

test('same pixels repeat exactly, bounded options are unique and fewer than eight is valid', () => {
  const pixels = image([['#fecec3', 100], ['#f4aec7', 90], ['#8d7ac3', 80], ['#9be0d4', 70], ['#f6e29b', 60]]);
  const first = recommendImageColors(pixels);
  for (let i = 0; i < 8; i++) assert.deepEqual(recommendImageColors(pixels), first);
  assert.equal(new Set(first.map((c) => c.seed)).size, first.length);
  assert.ok(first.length <= 8);
  assert.deepEqual(recommendImageColors(pixels, 0), []);
  assert.equal(recommendImageColors(pixels, 1).length, 1);
  assert.equal(recommendImageColors(image([['#fecec3', 100]])).length, 1);
});

test('recommendations install verbatim in both hue modes; legacy and manual seeds stay exact', () => {
  const options = recommendImageColors(image([['#fecec3', 300], ['#24326a', 200]]));
  for (const raw of ['#fecec3', '#808080', '#382756/30', '#f2ecc0/triadic']) {
    const spec = parseCustomSpec(raw);
    const theme = deriveCustomTheme(spec);
    assert.equal(theme.light.primary, spec.seed);
    assert.equal(theme.mono.light.primary, spec.seed);
  }
  for (const option of options) {
    const theme = deriveCustomTheme(option);
    assert.equal(theme.light.primary, option.seed);
    assert.equal(theme.mono.light.primary, option.seed);
    assert.equal(theme.mono.dark.primary, theme.dark.primary);
    for (const hues of [theme, theme.mono]) for (const mode of ['light', 'dark']) {
      assert.ok(contrast(hues[mode]['on-primary'], hues[mode].primary) >= 4.5);
      assert.ok(contrast(hues[mode]['on-secondary-container'], hues[mode]['secondary-container']) >= 4.5);
    }
  }
});

test('built-in text ink makes the unchanged brand pair readable without recolouring custom themes', () => {
  const builtIn = deriveTheme('#e06c9f', '#cb5b8d', undefined, 'built-in');
  assert.equal(builtIn.light.primary, '#e06c9f');
  assert.equal(builtIn.dark.primary, '#cb5b8d');
  for (const mode of ['light', 'dark']) {
    const roles = builtIn[mode];
    assert.ok(contrast(roles['on-primary'], roles.primary) >= 4.5);
    for (const surface of ['surface', 'surface-container-highest', 'secondary-container']) {
      assert.ok(contrast(roles['primary-ink'], roles[surface]) >= 4.5);
    }
  }
  const custom = deriveTheme('#e06c9f', '#cb5b8d');
  assert.equal(custom.light['on-primary'], '#ffffff');
  assert.equal(custom.light['primary-ink'], '#e06c9f');
  assert.equal(custom.dark['primary-ink'], '#cb5b8d');
});
