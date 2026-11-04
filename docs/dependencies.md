# Dependencies

Version constraints, Bun patches and dependency verification. Exact installed versions come from [package.json](../package.json) and [bun.lock](../bun.lock).

## Package management

- Use stable versions compatible with all consumers' peer requirements.
- Change the manifest, lockfile and affected patches together.
- CI installs with `bun install --frozen-lockfile`. `npm install` does not apply Bun's `patchedDependencies`.
- Keep patch files LF through `.gitattributes`, so their hashes survive Windows and Linux checkouts.

## Version constraints

The following constraints were recorded on 2026-11-03; recheck them when upgrading.

| Package | Constraint |
| --- | --- |
| `next`, `eslint-config-next` | Upgrade together; pinned to 16.4.4 |
| ESLint | 9.x, currently 9.39.5; wait for React, JSX accessibility and import plugin support before moving to 10 |
| `sharp` | Pin and override to 0.35.5, including Next's copy; retain the SVG optimizer mitigation and packaged native libraries |
| `zod` | Override to 4.6.7 for the React Hooks lint plugin's compatible 4.x dependency |
| `minimatch` | 11.0.4, with `brace-expansion` 5.0.12 and the entry-point patch below |

Read the installed Next guides before changing framework code. Verify the Babel React Compiler and initial bundles using [Performance](performance.md).

## minimatch entry-point patch

ESLint 9 and several plugins expect a callable `require('minimatch')` or a default import. Version 11 exposes named exports.

[patches/minimatch@11.0.4.patch](../patches/minimatch@11.0.4.patch) adds wrappers around v11's own matcher and preserves named exports, including `Minimatch`. It does not change matching or disable input limits.

- Keep the patch registered in `patchedDependencies`.
- Regenerate with `bun patch` and `bun patch --commit node_modules/minimatch` when changing the pinned version.
- Do not rely on hand edits in `node_modules`.
- Remove wrappers after consumers migrate to the named API.
- `scripts/testToolchain.mjs` verifies entry points, matching, input limits and a glob-driven React lint rule.

## Verification

After dependency changes, run:

```bash
bun audit
bun run check
bun run build
```

Reinstall with the frozen lockfile to verify patch reproducibility. A Next upgrade also needs browser and Hero regressions plus compiler and bundle checks.

Do not resolve an advisory by deleting checks, suppressing alerts or hiding an older vulnerable implementation behind a new version number.
