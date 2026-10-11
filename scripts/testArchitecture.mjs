/** Executable module boundaries. Runs in `npm test` without a browser or network. */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import path from 'node:path';
import { builtinModules } from 'node:module';
import { buildGraph, findCycles, findPath, readSources } from './moduleGraph.mjs';

const fixture = (sources) => buildGraph(new Map(Object.entries(sources)));
const root = path.resolve(import.meta.dirname, '..');
const graph = buildGraph(readSources(root));
const explain = (chains) => chains.map((chain) => chain.join(' -> ')).join('\n');
const builtins = new Set(builtinModules);
const serverOnly = (file) => /\.server\.[cm]?[jt]sx?$/.test(file) ||
  /^app\/(?:.*\/)?route\.[cm]?[jt]sx?$/.test(file) || file === 'lib/serverMemo.ts' ||
  file === 'next/headers' || file === 'server-only' || file.startsWith('node:') || builtins.has(file);

test('runtime graph follows aliases, relative imports and re-exports, excluding type-only edges', () => {
  const sample = fixture({
    'lib/start.ts': `import type { A } from './types';
      import { type B } from './types'; export type { C } from './types';
      export { type D } from './types'; type E = typeof import('./types');
      import './sideEffect'; import {} from './empty'; export {} from './emptyExport';
      export * from '@/lib/barrel';`,
    'lib/barrel.ts': `export { value } from './leaf.js';`,
    'lib/leaf.ts': 'export const value = 1;',
    'lib/types.ts': '',
  });
  assert.deepEqual(sample.get('lib/start.ts').edges.map((edge) => edge.target),
    ['lib/sideEffect', 'lib/empty', 'lib/emptyExport', 'lib/barrel.ts']);
  assert.deepEqual(findPath(sample, 'lib/start.ts', (file) => file === 'lib/leaf.ts'),
    ['lib/start.ts', 'lib/barrel.ts', 'lib/leaf.ts']);
});

test('lazy imports defer code but do not permit a client to load server-only code', () => {
  const sample = fixture({
    'components/Client.tsx': `'use client'; const load = () => import('@/lib/private.server');`,
    'lib/private.server.ts': 'export const value = 1;',
  });
  assert.equal(findPath(sample, 'components/Client.tsx', serverOnly), null);
  assert.deepEqual(findPath(sample, 'components/Client.tsx', serverOnly, true),
    ['components/Client.tsx', 'lib/private.server.ts']);
});

test('static cycles include re-exports and require, while a lazy binding back to its runtime is allowed', () => {
  assert.deepEqual(findCycles(fixture({
    'lib/a.ts': `export * from './b';`,
    'lib/b.ts': `const a = require('./a');`,
  })), [['lib/a.ts', 'lib/b.ts', 'lib/a.ts']]);
  assert.deepEqual(findCycles(fixture({
    'lib/a.ts': `const load = () => import('./b');`,
    'lib/b.ts': `import './a';`,
  })), []);
});

test('application modules have no static runtime cycles', () => {
  const cycles = findCycles(graph);
  assert.equal(cycles.length, 0, explain(cycles));
});

test('client module graphs cannot reach server-only modules, including through lazy imports', () => {
  const violations = [...graph].filter(([, node]) => node.client)
    .map(([file]) => findPath(graph, file, serverOnly, true)).filter(Boolean);
  assert.equal(violations.length, 0, explain(violations));
});

test('domain libraries do not import route implementations or the retired API aggregate', () => {
  const violations = [];
  for (const [file, { edges }] of graph) {
    for (const { target, line } of edges) {
      if (/^lib\/api(?:\.[cm]?[jt]s)?$/.test(target) ||
        (file.startsWith('lib/') && target.startsWith('app/'))) {
        violations.push(`${file}:${line} -> ${target}`);
      }
    }
  }
  assert.deepEqual(violations, []);
});

test('libraries do not depend on components except the viewer code warmup', () => {
  const violations = [];
  for (const [file, { edges }] of graph) {
    if (!file.startsWith('lib/')) continue;
    for (const edge of edges) {
      if (!edge.target.startsWith('components/')) continue;
      // This import deliberately preloads the destination's code on gallery intent.
      // It never renders a component; replacing it with registration would add a
      // mount-order requirement to the first press. Keep the exception exact.
      if (file === 'lib/hero/media.ts' && edge.target === 'components/PicDetail.tsx' && edge.dynamic) continue;
      violations.push(`${file}:${edge.line} -> ${edge.target}`);
    }
  }
  assert.deepEqual(violations, []);
});

test('motion implementations depend only on their owned collaborators, never the public facade', () => {
  const allowed = new Map([
    ['lib/motion/engine.ts', []],
    ['lib/motion/theme.ts', ['lib/motion/tabs.ts']],
    ['lib/motion/drawer.ts', ['lib/motion/engine.ts']],
    ['lib/motion/grid.ts', ['lib/motion/engine.ts']],
    ['lib/motion/sharedAxis.ts', ['lib/motion/tabGeometry.ts']],
    ['lib/motion/tabGeometry.ts', []],
    ['lib/motion/tabs.ts', ['lib/motion/sharedAxis.ts', 'lib/motion/tabGeometry.ts']],
  ]);
  const violations = [];
  for (const [file, { edges }] of graph) {
    if (!file.startsWith('lib/motion/')) continue;
    assert.ok(allowed.has(file), `declare the collaborators of ${file}`);
    for (const { target, line } of edges) {
      if ((target === 'lib/motion.ts' || target.startsWith('lib/motion/')) && !allowed.get(file).includes(target)) {
        violations.push(`${file}:${line} -> ${target}`);
      }
    }
  }
  assert.deepEqual(violations, []);
});

test('the shared shell keeps motion, hero, Markdown, palette and admin code behind their boundaries', () => {
  const deferred = new Set([
    'lib/motion.ts', 'lib/hero/index.ts', 'lib/hero/controller.ts',
    'components/MarkdownDocument.tsx', 'components/AuthForms.tsx', 'lib/paletteRule.ts',
  ]);
  const heavy = (file) => deferred.has(file) || file.startsWith('lib/motion/') || /^lib\/api\/admin/.test(file) ||
    /^(?:gsap|@gsap\/react|react-markdown|@material\/material-color-utilities)(?:\/|$)/.test(file);
  // All client roots installed by the server layout, not the server-only palette derivation.
  const shell = graph.get('app/layout.tsx').edges.filter((edge) => graph.get(edge.target)?.client);
  assert.ok(shell.length > 0, 'the shell scan must inspect actual client entry points');
  const violations = shell.map(({ target }) => findPath(graph, target, heavy)).filter(Boolean);
  assert.equal(violations.length, 0, explain(violations));
});
