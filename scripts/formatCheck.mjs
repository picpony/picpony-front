/**
 * `npm run format:check`: whitespace errors on every line changed since the branch left `dev`,
 * committed or not — the same rule CI's "Changed-line whitespace" step applies to a push.
 *
 * It used to be `git diff --check HEAD`, which only sees *uncommitted* edits, so on a clean
 * checkout (CI, a reviewer's clone, right after a commit) it compared nothing and always passed
 * (review P1-F13). The base is the merge-base with `origin/dev` (or `dev`), else `HEAD^`, else
 * `HEAD`; `FORMAT_BASE` overrides it. A Node script rather than shell, so it runs the same on
 * Windows, where the suites are developed.
 */
import { execFileSync, spawnSync } from 'node:child_process';

function git(args) {
  try {
    return execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    return '';
  }
}

function base() {
  if (process.env.FORMAT_BASE) return process.env.FORMAT_BASE;
  for (const ref of ['origin/dev', 'dev']) {
    if (!git(['rev-parse', '--verify', '--quiet', `${ref}^{commit}`])) continue;
    const mergeBase = git(['merge-base', 'HEAD', ref]);
    /* On dev itself the merge-base is HEAD: fall through to the last commit instead. */
    if (mergeBase && mergeBase !== git(['rev-parse', 'HEAD'])) return mergeBase;
  }
  return git(['rev-parse', '--verify', '--quiet', 'HEAD^']) || 'HEAD';
}

const from = base();
const result = spawnSync('git', [
  '-c', 'core.whitespace=blank-at-eol,blank-at-eof,space-before-tab,cr-at-eol',
  'diff', '--check', from, '--', '.', ':(exclude)public/companions/browserponies.js',
], { stdio: 'inherit' });
if (result.status === 0) console.log(`format:check: no whitespace errors since ${from.slice(0, 12)}`);
process.exit(result.status ?? 1);
