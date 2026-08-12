'use client';

import { MdPerson } from 'react-icons/md';
import FadeInImage from './FadeInImage';
import { getAvatarUrl, cn } from '@/lib/utils';

interface AvatarProps {
  /** Raw value from the API — bare paths are resolved against the asset host. */
  src?: string | null;
  /** The alt text. */
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
 * User avatar, with one fallback: image → glyph.
 *
 * Every surface used to hand-roll this, and they disagreed — some fell back to
 * an `MdPerson` glyph, some to the first letter of the name, some rendered an
 * empty grey circle when `avatar` was an empty string. They also each
 * re-implemented the "bare path needs the API host prefixed" rule inline instead
 * of calling `getAvatarUrl`, so a few spots produced broken `src` values.
 *
 * The initial is gone on purpose. A letter in a circle is a *different picture*
 * of the person from one row to the next — it changes when they rename, it is
 * meaningless for a name that starts with a Han glyph the box then has to shrink
 * to fit, and in a list of contacts it reads as content rather than as an
 * absence. One neutral glyph says "no portrait" everywhere, which is what the
 * state actually is.
 *
 * The two profile headers were the last holdouts, and they showed why the
 * duplication mattered rather than merely being untidy: `/user/[id]` hardcoded
 * `https://picpony.top/${avatar}` instead of `getAvatarUrl`, and
 * `/derpi/user/[id]` swapped its fallback in from an `onError` handler by reaching
 * into `nextElementSibling` and removing a class — an imperative DOM edit React
 * knows nothing about, which leaves the fallback showing if the same component
 * later re-renders with a working URL. Keeping the fallback mounted *underneath*,
 * as this does, has neither failure and doubles as the decode placeholder.
 *
 * When sized by class the glyph is sized in `cqmin`, so it tracks the box
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
      <div aria-hidden="true" className="absolute inset-0 flex items-center justify-center">
        {inline ? <MdPerson size={Math.round(size * 0.6)} /> : <MdPerson size="60cqmin" />}
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
