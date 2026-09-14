/**
 * Lets a plain `.mjs` script import the app's own `.ts` modules, with no build step.
 *
 * Node's synchronous `module.registerHooks` (22.15+) plus unflagged type stripping (22.18+) is
 * enough: the resolve hook rewrites `@/`-prefixed and relative specifiers and names the format,
 * and `'use client'` directives are inert outside a bundler.
 *
 * **Bare specifiers must go back to `next()`** or `react` resolves to `lib/react`. This is also
 * what lets a rewritten module keep reaching real packages
 * (`lib/paletteRule.ts` pulls `@material/material-color-utilities`).
 *
 * Import for its side effect *before* any `await import('….ts')` — static imports are hoisted
 * and evaluated in order, so the hook is registered by the time a dynamic import runs. Lives
 * here rather than in either consumer (`heroPath.mjs`, `palette.mjs`) because a second copy is
 * how the two would drift.
 */
import { registerHooks } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { existsSync } from 'node:fs';
import path from 'node:path';

const REQUIRED_NODE = [22, 18];

/** Exits with a readable message rather than a `SyntaxError` inside a stripped `.ts`. */
export function requireTypeStripping(commandName) {
  const [major, minor] = process.versions.node.split('.').map(Number);
  if (major < REQUIRED_NODE[0] || (major === REQUIRED_NODE[0] && minor < REQUIRED_NODE[1])) {
    console.error(
      `${commandName} needs Node ${REQUIRED_NODE.join('.')}+ for synchronous module hooks and ` +
        `type stripping; this is ${process.versions.node}.`,
    );
    process.exit(1);
  }
}

const ROOT = path.resolve(import.meta.dirname, '..');

function withExtension(filePath) {
  if (path.extname(filePath) && existsSync(filePath)) return filePath;
  for (const candidate of ['.ts', '.tsx', '.mjs', '.js', '/index.ts', '/index.tsx']) {
    if (existsSync(filePath + candidate)) return filePath + candidate;
  }
  return filePath;
}

registerHooks({
  resolve(specifier, context, nextResolve) {
    const relative = specifier.startsWith('./') || specifier.startsWith('../');
    if (!specifier.startsWith('@/') && !relative) return nextResolve(specifier, context);
    const base = specifier.startsWith('@/')
      ? path.join(ROOT, specifier.slice(2))
      : path.resolve(path.dirname(fileURLToPath(context.parentURL)), specifier);
    const resolved = withExtension(base);
    const url = pathToFileURL(resolved).href;
    return {
      url,
      shortCircuit: true,
      format: resolved.endsWith('.ts') || resolved.endsWith('.tsx') ? 'module-typescript' : undefined,
    };
  },
});
