import type { ReactNode, SVGProps } from 'react';

export interface IconProps extends Omit<SVGProps<SVGSVGElement>, 'children'> {
  size?: number | string;
  color?: string;
  title?: string;
}

/**
 * Lightweight 24x24 Material glyph primitive used by the shared shell and core routes so
 * unrelated routes' `react-icons/md` glyphs never land in the initial document chunk. Matches
 * `react-icons`'s `IconBase` defaults (`width`/`height` defaulting to `1em`, `fill="currentColor"`,
 * `strokeWidth={0}`) so `IconButton` and `Button` CSS size overrides behave identically, and
 * defaults `aria-hidden="true"` when no `title` is provided.
 */
export function SvgIcon({
  size = '1em',
  color,
  title,
  d,
  children,
  style,
  ...rest
}: IconProps & { d?: string; children?: ReactNode }) {
  return (
    <svg
      stroke="currentColor"
      fill="currentColor"
      strokeWidth={0}
      viewBox="0 0 24 24"
      height={size}
      width={size}
      style={color ? { color, ...style } : style}
      aria-hidden={title ? undefined : true}
      xmlns="http://www.w3.org/2000/svg"
      {...rest}
    >
      {title ? <title>{title}</title> : null}
      {d ? <path d={d} /> : children}
    </svg>
  );
}

/** Creates a single-path 24x24 Material glyph component. */
export function pathIcon(d: string) {
  return function MaterialIcon(props: IconProps) {
    return <SvgIcon d={d} {...props} />;
  };
}
