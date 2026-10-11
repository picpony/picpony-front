/** Speed preferences cross three clocks and two persistence stores. Test their agreement. */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';
import { requireTypeStripping } from './tsResolve.mjs';

requireTypeStripping('testMotionPreferences');
const model = await import('../lib/motionPreferences.ts');
const { LS_KEYS, COOKIE_KEYS } = await import('../lib/constants.ts');
const stored = new Map();
const cookies = new Map();
const styles = new Map();
const root = {
  dataset: {},
  setAttribute(name, value) { this.dataset[name.slice(5).replace(/-([a-z])/g, (_, c) => c.toUpperCase())] = value; },
  style: { setProperty: (name, value) => styles.set(name, String(value)) },
};
globalThis.localStorage = { getItem: (key) => stored.get(key) ?? null, setItem: (key, value) => stored.set(key, value) };
globalThis.window = { matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }) };
globalThis.document = {
  documentElement: root,
  set cookie(line) {
    const [name, value] = line.split(';')[0].split('=');
    cookies.set(name, value);
  },
};
const appearance = await import('../lib/appearance.ts');
const springs = await import('../lib/spring.ts');
const timing = await import('../lib/springTiming.ts');

function reset() {
  root.dataset = {};
  stored.clear(); cookies.clear(); styles.clear();
}

test('named category preferences survive reordering and reject invalid or oversized values', () => {
  const parsed = model.parseMotionCustom('page:slow,feedback:fast,image:warp,unknown:fast,__proto__:slow');
  assert.deepEqual(parsed, { ...model.motionPreset('default'), feedback: 'fast', page: 'slow' });
  assert.deepEqual(model.parseMotionCustom(model.formatMotionCustom(parsed)), parsed);
  for (const invalid of [null, undefined, '', 'bad', 'page:slow,'.repeat(150)]) {
    assert.deepEqual(model.parseMotionCustom(invalid), model.motionPreset('default'));
  }
});

test('entering custom seeds the current speed once, and ordinary presets retain those edits', () => {
  reset();
  appearance.commitMotion('standard', 'slow');
  appearance.commitMotion('standard', 'custom');
  assert.deepEqual(appearance.motionCustomSpeeds(), model.motionPreset('slow'));
  const custom = { ...model.motionPreset('default'), feedback: 'slow', page: 'fast', overlay: 'fast' };
  appearance.commitMotionCustom(custom);
  assert.equal(appearance.motionScale('page'), 0.7);
  assert.equal(appearance.motionScale('feedback'), 1.4);
  assert.equal(appearance.motionScale('image'), 1);
  assert.equal(appearance.scaledMs(400, 'overlay'), 280);
  const raw = model.formatMotionCustom(custom);
  assert.equal(stored.get(LS_KEYS.motionCustom), raw);
  assert.equal(cookies.get(COOKIE_KEYS.motionCustom), raw);
  assert.equal(root.dataset.motionCustom, raw);
  assert.equal(styles.get('--motion-custom-page'), '0.7');
  appearance.commitMotion('standard', 'fast');
  for (const { id } of model.MOTION_CATEGORIES) assert.equal(appearance.motionScale(id), 0.7);
  appearance.commitMotion('standard', 'custom');
  assert.deepEqual(appearance.motionCustomSpeeds(), custom);
  assert.equal(stored.get(LS_KEYS.motionCustom), raw);
});

test('each preset overwrites every category without leaving custom mode', () => {
  reset();
  appearance.commitMotion('standard', 'custom');
  for (const { value } of model.MOTION_PRESETS) {
    appearance.commitMotionCustom({ ...model.motionPreset('default'), tabs: 'slow', entrance: 'fast' });
    appearance.commitMotionCustom(model.motionPreset(value));
    assert.equal(appearance.motionSpeed(), 'custom');
    for (const { id } of model.MOTION_CATEGORIES) assert.equal(appearance.motionScale(id), model.MOTION_SPEED_SCALE[value]);
  }
});

test('custom effects seed the resolved tier, preserve speed edits and gate categories independently', () => {
  reset();
  appearance.commitMotion('reduced', 'custom');
  appearance.commitMotionCustom({ ...model.motionPreset('default'), feedback: 'slow', overlay: 'fast' });
  appearance.commitMotion('custom', 'custom');
  assert.deepEqual(appearance.motionCustomEffects(), model.motionEffectPreset('reduced'));
  const effects = { ...model.motionEffectPreset('standard'), feedback: 'off', image: 'reduced' };
  appearance.commitMotionEffects(effects);
  assert.equal(appearance.motionTier(), 'off');
  assert.equal(appearance.motionTier('image'), 'reduced');
  assert.equal(appearance.motionTier('overlay'), 'standard');
  assert.equal(appearance.motionScale(), 0);
  assert.equal(appearance.motionScale('overlay'), 0.7, 'a disabled feedback clock cannot stop an enabled overlay');
  assert.equal(appearance.motionRatio('overlay'), 0.5, 'GSAP compensates against the live speed, not feedback visibility');
  assert.equal(appearance.motionScale('page'), 1);
  const raw = model.formatMotionEffects(effects);
  assert.equal(stored.get(LS_KEYS.motionEffects), raw);
  assert.equal(cookies.get(COOKIE_KEYS.motionEffects), raw);
  assert.equal(root.dataset.motionFeedback, 'off');
  assert.equal(styles.get('--motion-custom-enabled-feedback'), '0');
  appearance.commitMotion('off', 'fast');
  for (const { id } of model.MOTION_CATEGORIES) assert.equal(appearance.motionScale(id), 0);
  appearance.commitMotion('custom', 'custom');
  assert.deepEqual(appearance.motionCustomEffects(), effects);
  assert.equal(appearance.motionScale('overlay'), 0.7);
  const standard = timing.springTiming('defaultSpatial', 'overlay');
  const reduced = timing.springTiming('defaultSpatial', 'image');
  assert.notEqual(standard.easing, reduced.easing, 'a reduced image does not remove the overlay spring overshoot');
});

test('effects presets overwrite all categories while keeping custom mode and custom speeds', () => {
  reset();
  appearance.commitMotion('custom', 'custom');
  const speeds = { ...model.motionPreset('slow'), entrance: 'fast' };
  appearance.commitMotionCustom(speeds);
  for (const { value } of model.MOTION_EFFECTS) {
    appearance.commitMotionEffects(model.motionEffectPreset(value));
    assert.equal(appearance.motionMode(), 'custom');
    for (const { id } of model.MOTION_CATEGORIES) assert.equal(appearance.motionTier(id), value);
    assert.deepEqual(appearance.motionCustomSpeeds(), speeds);
  }
});

test('effect first paint and JS agree for valid, absent and corrupt stored preferences', () => {
  for (const raw of [null, '', 'feedback:off,overlay:reduced', 'image:slow,ambient:off,unknown:reduced', 'x'.repeat(1025)]) {
    reset();
    root.dataset = { motion: 'custom', motionSpeed: 'default' };
    vm.runInNewContext(model.motionCustomBootScript, { d: root, get: (key) => key === LS_KEYS.motionEffects ? raw : null });
    const expected = model.parseMotionEffects(raw);
    for (const { id } of model.MOTION_CATEGORIES) {
      assert.equal(appearance.motionTier(id), expected[id]);
      assert.equal(styles.get(`--motion-custom-enabled-${id}`), expected[id] === 'off' ? '0' : '1');
    }
    assert.deepEqual(appearance.motionCustomEffects(), expected);
  }
});

test('reduced preserves category speeds and off wins over every category and spring', () => {
  reset();
  appearance.commitMotion('standard', 'custom');
  appearance.commitMotionCustom({ ...model.motionPreset('slow'), overlay: 'fast' });
  const standard = timing.springTiming('defaultSpatial', 'overlay');
  assert.equal(standard.duration, springs.SPRING_MS.defaultSpatial * 0.7);
  appearance.commitMotion('reduced', 'custom');
  const reduced = timing.springTiming('defaultSpatial', 'overlay');
  assert.equal(reduced.duration, standard.duration);
  assert.notEqual(reduced.easing, standard.easing);
  assert.equal(appearance.motionScale('page'), 1.4);
  appearance.commitMotion('off', 'custom');
  appearance.commitMotionCustom(model.motionPreset('fast'));
  for (const { id } of model.MOTION_CATEGORIES) {
    assert.equal(appearance.motionScale(id), 0);
    assert.equal(timing.springTiming('defaultSpatial', id).duration, 0);
  }
});

test('pre-paint storage recovery matches the server model and works before hydration', () => {
  for (const raw of [null, 'page:slow,feedback:fast', 'overlay:warp,ambient:slow', 'x'.repeat(1025)]) {
    const css = new Map();
    const element = { dataset: {}, setAttribute: root.setAttribute, style: { setProperty: (name, value) => css.set(name, String(value)) } };
    vm.runInNewContext(model.motionCustomBootScript, { d: element, get: (key) => key === LS_KEYS.motionCustom ? raw : null });
    const parsed = model.parseMotionCustom(raw);
    assert.equal(element.dataset.motionCustom, raw ? model.formatMotionCustom(parsed) : undefined);
    const expected = { ...model.motionCustomStyle(parsed), ...model.motionEffectsStyle(model.motionEffectPreset('standard')) };
    assert.deepEqual(Object.fromEntries(css), Object.fromEntries(Object.entries(expected).map(([k, v]) => [k, String(v)])));
    reset();
    root.dataset = { motion: 'standard', motionSpeed: 'custom', ...element.dataset };
    for (const { id } of model.MOTION_CATEGORIES) assert.equal(appearance.motionScale(id), model.MOTION_SPEED_SCALE[parsed[id]]);
  }
});

test('GSAP category springs compensate for the global clock exactly once', () => {
  reset();
  let globalSpeed = 1;
  const engine = {
    registerPlugin() {}, registerEase() {}, defaults() {},
    ticker: { lagSmoothing() {} },
    globalTimeline: { timeScale: (value) => { globalSpeed = value; } },
  };
  const exports = {};
  const dependencies = {
    gsap: { default: engine }, '@gsap/react': {},
    'gsap/CustomEase': { CustomEase: { create: (name) => name } }, 'gsap/Flip': {}, 'gsap/Observer': {},
    '@/lib/appearance': appearance, '@/lib/spring': springs, '@/lib/springTiming': timing,
    '@/lib/motionTokens': { DURATION: { short: 0.2 }, EASE: {} },
  };
  const source = ts.transpileModule(readFileSync(new URL('../lib/motion/engine.ts', import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  vm.runInNewContext(source, { exports, require: (name) => {
    assert.ok(name in dependencies, `Unexpected dependency: ${name}`);
    return dependencies[name];
  } });
  appearance.commitMotion('standard', 'custom');
  for (const feedback of ['fast', 'default', 'slow']) {
    for (const overlay of ['fast', 'default', 'slow']) {
      appearance.commitMotionCustom({ ...model.motionPreset('default'), feedback, overlay });
      const wallSeconds = exports.spring('defaultSpatial', 'overlay').duration / globalSpeed;
      assert.ok(Math.abs(wallSeconds - springs.SPRING_DURATION.defaultSpatial * model.MOTION_SPEED_SCALE[overlay]) < 1e-9);
    }
  }
});

test('blocked storage still applies and persists the current session through the cookie', () => {
  reset();
  const original = globalThis.localStorage;
  globalThis.localStorage = { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('blocked'); } };
  try {
    appearance.commitMotion('standard', 'custom');
    appearance.commitMotionCustom({ ...model.motionPreset('default'), page: 'slow' });
    assert.equal(appearance.motionScale('page'), 1.4);
    assert.equal(cookies.get(COOKIE_KEYS.motionSpeed), 'custom');
  } finally { globalThis.localStorage = original; }
});
