'use client';

import { MdPerson } from 'react-icons/md';
import FadeInImage from './FadeInImage';
import { getAvatarUrl, cn } from '@/lib/utils';

interface AvatarProps {
  /** Raw value from the API — bare paths are resolved against the asset host. */
  src?: string | null;
  /** Used for the alt text and for the initial shown when there is no image. */
  name?: string | null;
  /**
   * A number sizes the box inline. A **string** is taken as sizing utilities
   * instead — `"w-24 h-24 sm:w-32 sm:h-32"` — for the two profile headers, whose
   * avatar changes size at a breakpoint and therefore cannot be sized inline at
   * all: an inline `width` beats any class, so those two hand-rolled the whole
   * component rather than fight it.
   */
  size?: number | string;
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
 *
 * The two profile headers were the last holdouts, and they showed why the
 * duplication mattered rather than merely being untidy: `/user/[id]` hardcoded
 * `https://picpony.top/${avatar}` instead of `getAvatarUrl`, and
 * `/derpi/user/[id]` swapped its fallback in from an `onError` handler by reaching
 * into `nextElementSibling` and removing a class — an imperative DOM edit React
 * knows nothing about, which leaves the initial showing if the same component
 * later re-renders with a working URL. Keeping the fallback mounted *underneath*,
 * as this does, has neither failure and doubles as the decode placeholder.
 *
 * When sized by class the initial is sized in `cqmin`, so it tracks the box
 * through a breakpoint change without the caller restating it. That needs
 * `container-type: size`, which is safe here because an avatar is always a
 * definite square.
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
  const inline = typeof size === 'number';

  return (
    <div
      className={cn(
        'relative shrink-0 overflow-hidden rounded-full bg-surface-container-high text-on-surface-variant',
        ringed && 'ring-2 ring-primary',
        !inline && cn('[container-type:size]', size),
        className,
      )}
      style={inline ? { width: size, height: size } : undefined}
    >
      {/* The fallback stays mounted underneath rather than being swapped in on
          error: it doubles as the placeholder while the image decodes, so the
          circle is never empty. */}
      <div
        aria-hidden={url ? 'true' : undefined}
        className={cn(
          /* No type role applies: the initial is sized to its own circle, so the
             size has to be a container query (or an inline px for `inline`), not
             one of the fifteen steps. The weight is still pinned to the scale's
             emphasized value (700) rather than the 600 it used to carry, which
             belonged to no role in this app. */
          'absolute inset-0 flex items-center justify-center font-bold select-none',
          !inline && 'text-[42cqmin]',
        )}
        style={inline ? { fontSize: Math.round(size * 0.42) } : undefined}
      >
        {initial || (inline ? <MdPerson size={Math.round(size * 0.6)} /> : <MdPerson size="60cqmin" />)}
      </div>

      {url && (
        <FadeInImage
          src={url}
          alt={name || '用户头像'}
          fill
          sizes={inline ? `${size}px` : '128px'}
          className="object-cover"
        />
      )}
    </div>
  );
}
