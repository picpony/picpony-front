import { defineConfig, globalIgnores } from 'eslint/config';
import nextVitals from 'eslint-config-next/core-web-vitals';
import nextTs from 'eslint-config-next/typescript';

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    files: ['**/*.ts', '**/*.tsx'],
    rules: {
      '@typescript-eslint/consistent-type-imports': ['error', {
        prefer: 'type-imports',
        fixStyle: 'inline-type-imports',
        // Lazy facades use typeof import() to describe modules without loading them.
        disallowTypeAnnotations: false,
      }],
      'no-duplicate-imports': ['error', { allowSeparateTypeImports: true }],
    },
  },
  globalIgnores([
    '.next/**',
    'out/**',
    'build/**',
    'next-env.d.ts',
    // Git-ignored screenshots, measurement harnesses and generated browser bundles.
    '.workbuddy/**',
    // One-off local probes / e2e scripts, not part of the app runtime.
    'scripts/**',
  ]),
]);

export default eslintConfig;
