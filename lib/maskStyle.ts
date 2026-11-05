const MASK = 'linear-gradient(#000, #000)';

/** Inline styles bypass the CSS compiler. Chrome 109 uses prefixed mask properties. */
export function maskProperty(part: 'image' | 'size' | 'position' | 'repeat'): string {
  const prefix = CSS.supports('mask-image', MASK) ? '' : '-webkit-';
  return `${prefix}mask-${part}`;
}

export function supportsMask(): boolean {
  return typeof CSS !== 'undefined' && CSS.supports(maskProperty('image'), MASK);
}
