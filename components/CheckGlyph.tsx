import type { SVGProps } from 'react';

/**
 * M3's check mark, as a stroke — not `MdCheck`: a selection control's tick is a
 * drawn mark, and the icon font's glyph is thin and off centre at control sizes.
 * Deliberately one shared file (checkbox, switch, palette swatch) rather than
 * copies of the same SVG. Stroke is `currentColor`, so the ink is the
 * enclosure's. `pathProps` exists for the checkbox's draw-on animation only.
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
