import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';

function load(file, globals = {}, imports = {}) {
  const exports = {};
  const source = readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
  const code = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  vm.runInNewContext(code, { exports, ...globals, require: (name) => {
    assert.ok(name in imports, `Unexpected import: ${name}`);
    return imports[name];
  } }, { filename: file });
  return exports;
}

function motion(native) {
  const spring = load('lib/spring.ts', { CSS: { supports: () => native } });
  const sampling = load('lib/sampledAnimation.ts', {}, { '@/lib/spring': spring });
  return { ...spring, ...sampling };
}

function interpolate(samples, time) {
  const index = samples.findIndex(({ offset }) => offset >= time);
  if (index <= 0) return samples[0].progress;
  const a = samples[index - 1];
  const b = samples[index];
  return a.progress + (b.progress - a.progress) * (time - a.offset) / (b.offset - a.offset);
}

function bezier(easing, time) {
  const [x1, y1, x2, y2] = easing.match(/[\d.]+/g).map(Number);
  const at = (a, b, t) => 3 * (1 - t) ** 2 * t * a + 3 * (1 - t) * t * t * b + t ** 3;
  let lo = 0;
  let hi = 1;
  for (let i = 0; i < 30; i++) {
    const mid = (lo + hi) / 2;
    if (at(x1, x2, mid) < time) lo = mid;
    else hi = mid;
  }
  return at(y1, y2, (lo + hi) / 2);
}

test('spring fits bound displacement error and never add bounce to effects', () => {
  const legacy = motion(false);
  const native = motion(true);
  for (const [shape, spec] of Object.entries(legacy.SHAPE_SPEC)) {
    const fallback = legacy.springEasing(shape);
    assert.match(fallback, /^cubic-bezier\(/);
    assert.equal(native.springEasing(shape), native.springToLinear(spec));
    let previous = 0;
    let peak = 0;
    for (let i = 0; i <= 1000; i++) {
      const t = i / 1000;
      const value = bezier(fallback, t);
      assert.ok(Math.abs(value - legacy.springEase(spec)(t)) < (shape === 'spatialFast' ? 0.051 : 0.020), `${shape} at ${t}`);
      if (shape === 'effects') assert.ok(value >= previous && value <= 1, 'Effects must be monotone');
      previous = value;
      peak = Math.max(peak, value);
    }
    if (shape !== 'effects') assert.ok(peak > 1, 'Spatial motion retains overshoot');
  }
});

test('legacy tracks keep overshoot, reversals and return-to-origin motion', () => {
  const samples = [
    { offset: 0, progress: 0 }, { offset: 0.25, progress: 1.1 },
    { offset: 0.6, progress: -0.2 }, { offset: 1, progress: 0 },
  ];
  for (const [from, to] of [[0, 240], [240, 0]]) {
    const frame = (p) => ({ transform: `translateX(${from + (to - from) * p}px)` });
    const native = motion(true).sampledTrack(samples, frame);
    const legacy = motion(false).sampledTrack(samples, frame);
    assert.equal(native.keyframes.length, 2);
    assert.match(native.easing, /1\.1 25%.*-0\.2 60%/);
    assert.equal(legacy.easing, 'linear');
    for (let i = 0; i < samples.length; i++) {
      assert.equal(legacy.keyframes[i].offset, samples[i].offset);
      assert.equal(legacy.keyframes[i].transform, frame(samples[i].progress).transform);
    }
    assert.equal(legacy.keyframes.at(-1).transform, frame(0).transform);
  }
});

test('sampled springs follow the physical clock, including fade windows', () => {
  const legacy = motion(false);
  for (const spec of Object.values(legacy.SHAPE_SPEC)) {
    const ease = legacy.springEase(spec);
    const samples = legacy.sampleEasing(ease);
    assert.ok(samples.length < 100, 'No dense per-element sampling');
    assert.equal(samples[0].offset, 0);
    assert.equal(samples.at(-1).offset, 1);
    for (let i = 0; i <= 1000; i++) {
      assert.ok(Math.abs(interpolate(samples, i / 1000) - ease(i / 1000)) < 0.002);
    }
    const fraction = (p) => Math.min(1, Math.max(0, (p - 0.15) / 0.7));
    const track = legacy.sampledTrack(samples, (p) => ({ opacity: p }), fraction);
    assert.equal(track.keyframes[0].opacity, 0);
    assert.equal(track.keyframes.at(-1).opacity, 1);
    assert.ok(track.keyframes.every(({ opacity }) => opacity >= 0 && opacity <= 1));
  }
});

test('inline masks select the supported property family', () => {
  for (const native of [false, true]) {
    const masks = load('lib/maskStyle.ts', {
      CSS: { supports: (property) => property.startsWith('-webkit-') || native },
    });
    assert.equal(masks.supportsMask(), true);
    for (const part of ['image', 'size', 'position', 'repeat']) {
      assert.equal(masks.maskProperty(part), `${native ? '' : '-webkit-'}mask-${part}`);
    }
  }
  assert.equal(load('lib/maskStyle.ts').supportsMask(), false);
});
