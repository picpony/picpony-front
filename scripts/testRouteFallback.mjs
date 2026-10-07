/**
 * The route fallback is the page column's, never the picture slot's.
 *
 * Next gives every parallel slot of a layout that segment's `loading.tsx`, so the root fallback
 * (`app/loading.tsx`) was also the `@imageDetail` slot's. The shell renders that slot in the content
 * host beside the scroller, not in the page column, and whenever its segment waited for data — a
 * Back after the router cache had been dropped — the page silhouette was laid out there, at the
 * host's top-left with no gutter, over the page already on screen ("the skeleton left behind").
 *
 * Pinned here: the fallback renders in the page column and renders nothing inside
 * `ImageDetailSlot`; the shell wraps the picture slot — and only the picture slot — in it. Both
 * components are compiled the way the app compiles them (React Compiler, then JSX).
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { test } from 'node:test';
import vm from 'node:vm';
import { transformSync } from '@babel/core';
import compiler from 'babel-plugin-react-compiler';
import ts from 'typescript';

const ROOT = path.resolve(import.meta.dirname, '..');
const require = createRequire(import.meta.url);
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');

/** One module the way the app ships it, evaluated against a fixed table of imports. */
function load(file, imports) {
  const source = readFileSync(path.join(ROOT, file), 'utf8');
  const compiled = transformSync(source, {
    filename: path.basename(file),
    configFile: false,
    babelrc: false,
    parserOpts: { plugins: ['typescript', 'jsx'] },
    plugins: [[compiler, { target: '19' }]],
  }).code;
  const code = ts.transpileModule(compiled, {
    compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const module = { exports: {} };
  const resolve = (specifier) => {
    if (specifier in imports) return imports[specifier];
    if (specifier === 'react' || specifier.startsWith('react/') || specifier.startsWith('react-compiler-runtime')) {
      return require(specifier);
    }
    throw new Error(`${file} imports ${specifier}, which this test does not provide`);
  };
  vm.runInThisContext(`(function (exports, require, module) {${code}\n})`, { filename: file })(module.exports, resolve, module);
  return module.exports;
}

const slot = load('components/ImageDetailSlot.tsx', {});
/* The placeholder primitive stands in as a plain marked box: what is under test is where the
   fallback renders, not what a placeholder bar looks like. */
const skeleton = {
  __esModule: true,
  default: ({ className = '' }) => React.createElement('div', { className: `skeleton ${className}` }),
  SkeletonText: ({ lines = 3 }) =>
    React.createElement('div', null, ...Array.from({ length: lines }, (_, i) => React.createElement('div', { key: i, className: 'skeleton' }))),
};
const loading = load('app/loading.tsx', {
  '@/components/Skeleton': skeleton,
  '@/components/ImageDetailSlot': slot,
});
const Loading = loading.default;

test('in the page column the route fallback is the page silhouette, announced once', () => {
  const html = renderToStaticMarkup(React.createElement(Loading));
  assert.match(html, /role="status"/);
  assert.match(html, /data-page-loading/);
  assert.match(html, /加载中…/);
  assert.equal(html.match(/class="skeleton/g)?.length, 6, 'title, two blocks and three lines');
});

test('inside the picture slot the route fallback renders nothing at all', () => {
  const html = renderToStaticMarkup(
    React.createElement(slot.ImageDetailSlot, null, React.createElement(Loading)),
  );
  assert.equal(html, '', 'no silhouette, no status, no footer hold');
});

test('the slot boundary adds no element of its own and passes its content through', () => {
  const html = renderToStaticMarkup(
    React.createElement(slot.ImageDetailSlot, null, React.createElement('section', { id: 'detail' }, 'picture')),
  );
  assert.equal(html, '<section id="detail">picture</section>');
});

test('the boundary reaches the fallback however deep Next nests it', () => {
  /* Next renders the fallback several components below the slot element (the layout router, its
     error and loading boundaries); context crosses all of them. */
  const Wrapper = ({ children }) => React.createElement(React.Fragment, null, React.createElement('i', null, children));
  const html = renderToStaticMarkup(
    React.createElement(slot.ImageDetailSlot, null, React.createElement(Wrapper, null, React.createElement(Wrapper, null, React.createElement(Loading)))),
  );
  assert.equal(html, '<i><i></i></i>');
});

/* The shell's wiring, read from its syntax tree: the `@imageDetail` slot (the `overlay` prop) is
   rendered inside `ImageDetailSlot`, and the page (`children`) is not. */
const shellSource = readFileSync(path.join(ROOT, 'components/AppLayout.tsx'), 'utf8');
const shell = ts.createSourceFile('AppLayout.tsx', shellSource, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);

function jsxExpressions(name) {
  const found = [];
  const visit = (node) => {
    if (ts.isJsxExpression(node) && node.expression && ts.isIdentifier(node.expression) && node.expression.text === name) {
      found.push(node);
    }
    ts.forEachChild(node, visit);
  };
  visit(shell);
  return found;
}

function enclosingElements(node) {
  const names = [];
  for (let current = node.parent; current; current = current.parent) {
    if (ts.isJsxElement(current)) names.push(current.openingElement.tagName.getText(shell));
  }
  return names;
}

test('the shell renders the picture slot inside ImageDetailSlot', () => {
  const overlay = jsxExpressions('overlay');
  assert.equal(overlay.length, 1, 'the slot is rendered once');
  assert.ok(enclosingElements(overlay[0]).includes('ImageDetailSlot'));
});

test('the page column is outside ImageDetailSlot, so its own fallback still shows', () => {
  const children = jsxExpressions('children').filter((node) => enclosingElements(node).includes('BackgroundLocationProvider'));
  assert.ok(children.length >= 1, 'the page is rendered in the shell');
  for (const node of children) assert.ok(!enclosingElements(node).includes('ImageDetailSlot'));
});