import type { SVGProps } from 'react';

/**
 * M3's check mark, as a stroke.
 *
 * Not `MdCheck`: a selection control's tick is a *drawn* mark rather than an icon, and the
 * difference is visible at the sizes these controls use. The icon font's glyph carries its own
 * padding inside a 24px box and a fixed weight, so at `size-4` it reads thin and sits off
 * centre; this is three points on a 12-unit grid with a 2-unit round-capped stroke, which is
 * what `CheckboxTokens`/`SwitchTokens` draw.
 *
 * It is one file because there are three of them: the checkbox's box, the switch's handle and
 * the palette picker's swatch. The first two had the same nine lines of SVG written out
 * separately — the exact duplication the design rules exist to prevent — and the third would
 * have made a fourth copy or, worse, reached for the icon and looked different.
 *
 * The stroke takes `currentColor`, so the ink is the enclosure's `color` and no call site has
 * to name a token. `pathProps` is for the checkbox alone, which animates the mark on with
 * `stroke-dasharray`; it is typed rather than spread loosely so that a call site cannot
 * quietly restyle the geometry.
 */
export default function CheckGlyph({
  className,
  pathProps,
}: {
  className?: string;
  pathProps?: SVGProps<SVGPathElement>;
}) {
  return (
    <svg viewBox="0 0 12 12" fill="none" aria-hidden="true" className={className}>
      <path
        d="M2.5 6L5 8.5L9.5 3.5"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        {...pathProps}
      />
    </svg>
  );
}
