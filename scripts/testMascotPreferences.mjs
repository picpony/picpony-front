import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';

function fixture(initial = {}) {
  const values = new Map(Object.entries(initial));
  const exports = {};
  const keys = { entranceMotion: 'picpony_entrance_motion', mascotVisible: 'picpony_show_mascot', mascotId: 'picpony_mascot_id', mascotSizeDesktop: 'picpony_mascot_size_desktop', mascotSizeMobile: 'picpony_mascot_size_mobile', legacyIntroAnimation: 'picpony_intro_animation_enabled', mascotCollapsed: 'picpony_mascot_collapsed', legacyMascotId: 'picpony_selected_mascot_id', legacyMascotSize: 'picpony_mascot_size' };
  const source = ts.transpileModule(readFileSync(new URL('../lib/mascot/settings.ts', import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  vm.runInNewContext(source, {
    exports, window: {}, localStorage: { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) },
    require(name) {
      if (name === '@/lib/constants') return { LS_KEYS: keys };
      if (name === '@/lib/appearance') return { commitEntranceMotion: on => values.set(keys.entranceMotion, on ? 'on' : 'off') };
      throw Error(`Unexpected import: ${name}`);
    },
  });
  return { values, entry: id => exports.mascotSettings.find(item => item.id === id) };
}

test('current off/on wins over the opposite legacy boolean, including cloud round trips', () => {
  for (const [current, legacy, expected] of [['off', 'true', false], ['on', 'false', true]]) {
    const f = fixture({ picpony_entrance_motion: current, picpony_intro_animation_enabled: legacy });
    const entry = f.entry('introAnimationEnabled');
    assert.equal(entry.read(), expected);
    entry.write(expected);
    assert.equal(f.values.get('picpony_entrance_motion'), current);
    assert.equal(f.values.get('picpony_intro_animation_enabled'), String(expected));
    assert.equal(entry.read(), expected);
  }
});
test('absent or invalid current entrance value preserves a legacy opt-out; absent both defaults on', () => {
  for (const current of [undefined, 'corrupt']) {
    const f = fixture({ ...(current ? { picpony_entrance_motion: current } : {}), picpony_intro_animation_enabled: 'false' });
    assert.equal(f.entry('introAnimationEnabled').read(), false);
  }
  assert.equal(fixture().entry('introAnimationEnabled').read(), true);
});
test('legacy mascot id and size migrate without overriding valid current choices', () => {
  const f = fixture({ picpony_selected_mascot_id: '2', picpony_mascot_size: 'small', picpony_mascot_size_desktop: 'large' });
  assert.equal(f.entry('mascotId').read(), '2');
  assert.equal(f.entry('mascotSizeDesktop').read(), 'large');
  assert.equal(f.entry('mascotSizeMobile').read(), 'small');
  assert.equal(f.entry('mascotSizeMobile').fromCloud({ mascotSize: 'xlarge' }), 'xlarge');
  assert.equal(f.entry('mascotSizeMobile').fromCloud({ mascotSize: 'xlarge', mascotSizeMobile: 'medium' }), 'medium');
});
