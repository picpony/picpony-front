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
      if (name === '@/lib/constants') return { LS_KEYS: keys, COOKIE_KEYS: { entranceMotion: 'entranceMotion' } };
      if (name === '@/lib/appearance') return { commitEntranceMode: mode => values.set(keys.entranceMotion, mode) };
      throw Error(`Unexpected import: ${name}`);
    },
  });
  return { values, entry: id => exports.mascotSettings.find(item => item.id === id) };
}

test('the current entrance mode wins over the opposite legacy boolean, including cloud round trips', () => {
  for (const [current, legacy, expected] of [
    ['off', 'true', 'off'],
    ['on', 'false', 'non-blocking'],
    ['non-blocking', 'false', 'non-blocking'],
    ['blocking', 'false', 'blocking'],
  ]) {
    const f = fixture({ picpony_entrance_motion: current, picpony_intro_animation_enabled: legacy });
    const entry = f.entry('introAnimation');
    assert.equal(entry.read(), expected);
    entry.write(expected);
    assert.equal(f.values.get('picpony_entrance_motion'), expected);
    assert.equal(f.values.get('picpony_intro_animation_enabled'), String(expected !== 'off'));
    assert.equal(entry.read(), expected);
  }
});
test('absent or invalid current entrance value preserves a legacy opt-out; absent both is non-blocking', () => {
  for (const current of [undefined, 'corrupt']) {
    const f = fixture({ ...(current ? { picpony_entrance_motion: current } : {}), picpony_intro_animation_enabled: 'false' });
    assert.equal(f.entry('introAnimation').read(), 'off');
  }
  assert.equal(fixture().entry('introAnimation').read(), 'non-blocking');
});
test('the account keeps the original boolean and adds whether the entrance blocks', () => {
  /* Copied into this realm: the module runs in its own context, whose prototypes a strict deep
     comparison would refuse. */
  const entry = fixture().entry('introAnimation');
  assert.deepEqual([...entry.cloudKeys], ['introAnimationEnabled', 'introAnimationBlocking']);
  assert.deepEqual({ ...entry.toCloud('blocking') }, { introAnimationEnabled: true, introAnimationBlocking: true });
  assert.deepEqual({ ...entry.toCloud('non-blocking') }, { introAnimationEnabled: true, introAnimationBlocking: false });
  assert.deepEqual({ ...entry.toCloud('off') }, { introAnimationEnabled: false, introAnimationBlocking: false });
  assert.equal(entry.fromCloud({ introAnimationEnabled: false, introAnimationBlocking: true }), 'off');
  assert.equal(entry.fromCloud({ introAnimationEnabled: true, introAnimationBlocking: true }), 'blocking');
  assert.equal(entry.fromCloud({ introAnimationEnabled: 'true', introAnimationBlocking: false }), 'non-blocking');
  assert.equal(entry.fromCloud({}), undefined);
  /* The original front end says that it plays and not how: this device's mode stands, unless the
     device had it off. */
  const blocking = fixture({ picpony_entrance_motion: 'blocking' }).entry('introAnimation');
  assert.equal(blocking.fromCloud({ introAnimationEnabled: true }), undefined);
  const off = fixture({ picpony_entrance_motion: 'off' }).entry('introAnimation');
  assert.equal(off.fromCloud({ introAnimationEnabled: true }), 'non-blocking');
  /* The server's first byte depends on the mode, so the engine re-mirrors its cookie from storage
     on every start; only 阻塞 and 关闭 need one, the default is the cookie's absence. */
  assert.equal(entry.cookie, 'entranceMotion');
});
test('legacy mascot id and size migrate without overriding valid current choices', () => {
  const f = fixture({ picpony_selected_mascot_id: '2', picpony_mascot_size: 'small', picpony_mascot_size_desktop: 'large' });
  assert.equal(f.entry('mascotId').read(), '2');
  assert.equal(f.entry('mascotSizeDesktop').read(), 'large');
  assert.equal(f.entry('mascotSizeMobile').read(), 'small');
  assert.equal(f.entry('mascotSizeMobile').fromCloud({ mascotSize: 'xlarge' }), 'xlarge');
  assert.equal(f.entry('mascotSizeMobile').fromCloud({ mascotSize: 'xlarge', mascotSizeMobile: 'medium' }), 'medium');
});
