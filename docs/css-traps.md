# CSS verification

Check rendered geometry and built CSS after a styling change. Source text alone does not prove that a Tailwind utility exists or that a transform is visible.

## Variant syntax

Use `peer-focus-visible:focus-ring`. `peer-focus-ring` is an unknown class and emits nothing.

After building, find the escaped selector in `.next/static/chunks/`. Match the actual selector, such as `.focus-visible\\:focus-ring`, rather than a substring in a comment.

## Utility extraction

Tailwind scans class candidates in raw source, including `.tsx` comments. Do not name a removed utility in a comment just to explain its removal; write the value in prose.

Markdown is excluded by `@source not "../**/*.md"` in [app/globals.css](../app/globals.css). Code comments are still scanned. Do not depend on the extractor ignoring particular punctuation or on a palette class currently being undefined.

A word such as `rounded` can also appear in ordinary prose, so absence checks must target an actual emitted selector.

## Transformable boxes

A non-replaced inline `span` cannot transform. Use `display: block` or `inline-block` for a moving box.

Verify pixels or `getBoundingClientRect()`. `getComputedStyle()` can report a transform matrix even when the inline box does not move.

## Stack spacing

Tailwind 4 implements `space-y-*` with low-specificity child margins. A child's `mb-0` can cancel that spacing. Let the stack own the gap, or give children explicit margins without `space-y-*`.

## Inline masks

Inline styles bypass Lightning CSS. Use `maskProperty` from `lib/maskStyle.ts` for runtime mask image, size, position and repeat writes; Chrome 109 needs the prefixed family. Restore the same properties after a transition. Stylesheet masks receive prefixes from the build.

## Whitespace

A whitespace-only JSX text node does not create an extra flex or grid item. Spaces in running inline text remain meaningful.

Inspect the parent's display and white-space context before removing `{' '}`. Do not change it on the assumption that it adds a flex gap.

## Verification

Run `bun run build` for CSS changes, inspect the emitted selector, then check the affected layout in the browser. Follow the relevant [primitive](design/primitives.md), [colour](design/colour.md) and [surface](design/surfaces.md) contracts.
