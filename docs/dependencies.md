# Dependencies and security updates

Use the latest stable versions that satisfy the consumers' peer requirements, and keep
`package.json`, `bun.lock` and any Bun patches together. Install with `bun install --frozen-lockfile`
in CI; `npm install` does not apply Bun's `patchedDependencies`.

## Current constraints (2026-11-03)

- `next` and `eslint-config-next` move together; both are 16.4.4. Read the installed Next docs
  before changing framework code, then verify the Babel React Compiler still emits memo caches
  as described in `docs/performance.md`.
- ESLint stays on the latest 9.x (9.39.5). The current React, JSX accessibility and import plugins
  do not declare ESLint 10 support. Upgrade that major only when all three support it.
- `sharp` remains pinned and overridden to 0.35.5, including Next's copy. This is the official
  mitigation for the SVG optimizer advisory, and the native libraries travel with the standalone
  build. Update its override along with its direct dependency.
- `zod` is overridden to 4.6.7 for the React Hooks lint plugin's compatible 4.x dependency.

## The minimatch entry-point patch

All `minimatch` consumers use 11.0.4, which also resolves `brace-expansion` to 5.0.12. The older
matcher versions still match the security advisory; simply keeping a legacy major is insufficient.

ESLint 9 and several plugins call `require('minimatch')` or use a default import. Version 11 exposes
named exports instead. `patches/minimatch@11.0.4.patch` adds two entry wrappers that expose v11's
own matcher as that callable/default and preserve the named exports, including `Minimatch`.
It does not change the matching implementation or disable its input limits. This is compatibility
for the APIs these installed JavaScript consumers use, not a reimplementation of every legacy API.

Keep this patch registered in `patchedDependencies`. Regenerate it with `bun patch` and
`bun patch --commit node_modules/minimatch` when changing the pinned version; never rely on a
hand-edited `node_modules` tree. Patch files stay LF through `.gitattributes` so Bun's lockfile
hash is reproducible on Windows and Linux. Remove the wrappers when the consuming plugins have
migrated to the named API. `scripts/testToolchain.mjs` checks the entry points, matching behavior,
input limit and an actual glob-driven React lint rule.

## Verification

After a dependency change, run `bun audit`, `bun run check` and `bun run build`. A Next upgrade also
needs the route/browser and Hero regressions, plus the compiler and initial-bundle checks from
`docs/performance.md`. Reinstall from the frozen lockfile to verify that any patch is reproducible.
Do not silence an audit entry by deleting checks, suppressing alerts or substituting an older
vulnerable implementation behind a new version number.
