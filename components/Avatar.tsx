'use client';

import { MdPerson } from 'react-icons/md';
import FadeInImage from './FadeInImage';
import { getAvatarUrl, cn } from '@/lib/utils';

interface AvatarProps {
  /** Raw value from the API — bare paths are resolved against the asset host. */
  src?: string | null;
  /** Used for the alt text and for the initial shown when there is no image. */
  name?: string | null;
  size?: number;
  className?: string;
  /** Ring in the brand colour, for the profile header and other hero spots. */
  ringed?: boolean;
}

/**
 * User avatar with a deterministic fallback chain: image → initial → glyph.
 *
 * Every surface used to hand-roll this, and they disagreed — some fell back to
 * an `MdPerson` glyph, some to the first letter, some rendered an empty grey
 * circle when `avatar` was an empty string. They also each re-implemented the
 * "bare path needs the API host prefixed" rule inline instead of calling
 * `getAvatarUrl`, so a few spots produced broken `src` values.
 */
export default function Avatar({
  src,
  name,
  size = 40,
  className = '',
  ringed = false,
}: AvatarProps) {
  const url = getAvatarUrl(src);
  const initial = name?.trim()?.charAt(0)?.toUpperCase();

  return (
    <div
      className={cn(
        'relative shrink-0 overflow-hidden rounded-full bg-surface-container-high text-on-surface-variant',
        ringed && 'ring-2 ring-primary/40',
        className,
      )}
      style={{ width: size, height: size }}
    >
      {/* The fallback stays mounted underneath rather than being swapped in on
          error: it doubles as the placeholder while the image decodes, so the
          circle is never empty. */}
      <div
        aria-hidden={url ? 'true' : undefined}
        className="absolute inset-0 flex items-center justify-center font-semibold select-none"
        style={{ fontSize: Math.round(size * 0.42) }}
      >
        {initial || <MdPerson size={Math.round(size * 0.6)} />}
      </div>

      {url && (
        <FadeInImage
          src={url}
          alt={name || '用户头像'}
          fill
          sizes={`${size}px`}
          className="object-cover"
        />
      )}
    </div>
  );
}
