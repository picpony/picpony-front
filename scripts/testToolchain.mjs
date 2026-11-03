/** Real callers of the patched minimatch entry points, without changing its matching engine. */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';
import legacyDefault, { minimatch, Minimatch } from 'minimatch';

const require = createRequire(import.meta.url);
const legacyRequire = require('minimatch');

test('legacy and named glob calls preserve lint file selection and ignore behavior', () => {
  const cases = [
    ['components/HeroStage.tsx', '**/*.{ts,tsx}', {}, true],
    ['components/HeroStage.css', '**/*.{ts,tsx}', {}, false],
    ['.next/server.js', '**/*', {}, false],
    ['.next/server.js', '**/*', { dot: true }, true],
    ['app/page.test.tsx', '!**/*.test.tsx', {}, false],
    ['app/page.tsx', '!**/*.test.tsx', {}, true],
    ['app/page.tsx', '*.tsx', { matchBase: true }, true],
    ['app/PAGE.TSX', '**/*.tsx', { nocase: true }, true],
  ];
  for (const match of [legacyRequire, legacyDefault, minimatch]) {
    for (const [file, pattern, options, expected] of cases) {
      assert.equal(match(file, pattern, options), expected, `${file} against ${pattern}`);
    }
  }
  // Config-array and eslintrc construct matchers; plugins also retain defaults on the callable.
  for (const Matcher of [legacyRequire.Minimatch, legacyDefault.Minimatch, Minimatch]) {
    const matcher = new Matcher('**/*.tsx', { dot: true });
    assert.equal(matcher.match('.hidden/page.tsx'), true);
    assert.equal(matcher.match('app/page.css'), false);
  }
  assert.equal(legacyRequire.defaults({ dot: true })('.hidden/page.tsx', '**/*.tsx'), true);
});

test('both compatibility entries retain the upstream pattern-length limit', () => {
  const excessive = 'a'.repeat(65_537);
  for (const match of [legacyRequire, legacyDefault, minimatch]) {
    assert.throws(() => match('a', excessive), /pattern is too long/);
  }
});

test('a React lint rule still honours glob exceptions without hiding real violations', async () => {
  const { ESLint } = require('eslint');
  const react = require('eslint-plugin-react');
  const eslint = new ESLint({
    overrideConfigFile: true,
    overrideConfig: {
      files: ['**/*.jsx'],
      languageOptions: {
        ecmaVersion: 'latest',
        sourceType: 'module',
        parserOptions: { ecmaFeatures: { jsx: true } },
      },
      plugins: { react },
      rules: { 'react/jsx-pascal-case': ['error', { ignore: ['Ignored_*'] }] },
    },
  });
  const [result] = await eslint.lintText(
    'const allowed = <Ignored_name />; const rejected = <Broken_name />;',
    { filePath: 'toolchain-fixture.jsx' },
  );
  assert.equal(result.errorCount, 1);
  assert.equal(result.messages[0].ruleId, 'react/jsx-pascal-case');
  assert.match(result.messages[0].message, /Broken_name/);
});
