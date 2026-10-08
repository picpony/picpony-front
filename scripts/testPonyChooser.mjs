import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import test from 'node:test';
import { requireTypeStripping } from './tsResolve.mjs';
requireTypeStripping('testPonyChooser');
const { filterPonies, ponyNameParts, ponyPreview, samePonySelection } = await import('../lib/desktopPonies/chooser.ts');
const { PONY_PREVIEWS } = await import('../lib/desktopPonies/previewCatalog.ts');

test('search finds original names and English paths; selected filter never changes selection order', () => {
  const catalog = [{ name: '云宝黛西（幼驹）', path: 'rainbow dash (filly)' }, { name: '小蝶', path: 'fluttershy' }, { name: '云宝黛西', path: 'rainbow dash' }];
  assert.deepEqual(filterPonies(catalog, 'RAINBOW filly', false, []).map(p => p.name), ['云宝黛西（幼驹）']);
  assert.deepEqual(filterPonies(catalog, '云宝', false, []).map(p => p.name), ['云宝黛西', '云宝黛西（幼驹）']);
  assert.deepEqual(filterPonies(catalog, '', true, ['小蝶']).map(p => p.name), ['小蝶']);
  assert.equal(catalog[0].name, '云宝黛西（幼驹）');
  assert.equal(samePonySelection(['小蝶', '云宝黛西'], ['云宝黛西', '小蝶']), true);
});
test('long names separate their actual supplied variant without inventing labels or truncating names', () => {
  assert.deepEqual(ponyNameParts('塞拉斯蒂娅公主（幼驹其二）'), { name: '塞拉斯蒂娅公主', variant: '幼驹其二' });
  assert.deepEqual(ponyNameParts('暮光闪闪'), { name: '暮光闪闪', variant: '' });
});
test('every original preview is a static PNG with recorded provenance, and unknown artwork is explicit', () => {
  const provenance = JSON.parse(readFileSync(new URL('../public/companions/previews/provenance.json', import.meta.url), 'utf8'));
  assert.equal(provenance.length, 36);
  for (const record of provenance) {
    const url = PONY_PREVIEWS[record.path];
    assert.equal(new URL(record.source).hostname, 'picpony.top');
    assert.match(record.source_sha256, /^[a-f0-9]{64}$/);
    const local = new URL('../public' + url, import.meta.url);
    assert.ok(existsSync(local));
    const bytes = readFileSync(local);
    assert.equal(bytes.subarray(1, 4).toString(), 'PNG');
    assert.equal(bytes.includes(Buffer.from('acTL')), false, 'No animated PNG');
  }
  assert.equal(ponyPreview({ name: '新角色', path: 'unknown new character' }), null);
});
