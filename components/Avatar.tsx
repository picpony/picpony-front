'use client';

import { useState } from 'react';
import { MdPerson } from 'react-icons/md';
import FadeInImage from './FadeInImage';
import { getAvatarUrl, cn } from '@/lib/utils';

interface AvatarProps {
  /** Raw value from the API — bare paths are resolved against the asset host. */
  src?: string | null;
  /** The alt text. */
  name?: string | null;
  /**
   * One of the four box steps, or `'hero'` for the two profile headers.
   *
   * `'hero'` is the one avatar that changes size at a breakpoint (96 → 128) and
   * cannot be sized inline (an inline `width` beats any class), so it emits the
   * responsive utilities itself rather than taking them from the call site. The
   * union is deliberate: it makes the ladder a constraint rather than advice.
   */
  size?: 32 | 40 | 48 | 56 | 'hero';
  className?: string;
  /** Ring in the brand colour, for the profile header and other hero spots. */
  ringed?: boolean;
  /**
   * The page's largest paint — a profile header's avatar. Loads eagerly at high fetch
   * priority instead of lazily (Next 16 retires `priority` for exactly these two), so
   * the picture Next reports as the LCP element is not the last thing to arrive.
   */
  priority?: boolean;
  /**
   * Render a native `<img referrerPolicy="no-referrer">` instead of `next/image`.
   * Deliberate escape hatch for a host that is neither in `next.config.ts`'s
   * whitelist nor willing to serve a request carrying a `Referer` — QQ's avatar
   * CDN is both. Do not remove; it replaced a duplicated avatar component.
   */
  unoptimized?: boolean;
}

/**
 * User avatar, image → neutral glyph fallback (kept mounted underneath, so it
 * doubles as the decode placeholder).
 *
 * The box takes one of four steps: 32 / 40 / 48 / 56, 40 the default
 * (`ListTokens`' leading-avatar size); 32 dense, 48 contact list, 56 header.
 * The initial-letter fallback is deliberately gone: a letter is a different
 * picture of the person per row, changes on rename, and breaks on Han glyphs.
 *
 * The fallback stays mounted underneath rather than being swapped in on error —
 * React cannot see an imperative DOM swap, and the circle is then never empty.
 *
 * When sized by `'hero'` the glyph is sized in `cqmin`, tracking the box through
 * the breakpoint change; that needs `container-type: size`, safe here because an
 * avatar is always a definite square.
 */
export default function Avatar({
  src,
  name,
  size = 40,
  className = '',
  ringed = false,
  priority = false,
  unoptimized = false,
}: AvatarProps) {
  const url = getAvatarUrl(src);
  const inline = typeof size === 'number';
  /* `hero`'s classes live here, so the 96 → 128 pair is one value in one place.
     `container-type: size` lets the glyph track it in `cqmin`; safe because an
     avatar is always a definite square. */
  const heroBox = 'w-24 h-24 sm:w-32 sm:h-32 [container-type:size]';
  /* The escape hatch's own error state: a bare `<img>` needs `onError`; the
     fallback is already mounted underneath, so this just stops painting over it.
     Keyed on the URL that failed, so a new `src` (a changed avatar, the next row
     reusing this instance) gets its own attempt instead of inheriting the old one's
     failure for the component's lifetime. */
  const [brokenUrl, setBrokenUrl] = useState<string | null>(null);
  const broken = brokenUrl !== null && brokenUrl === url;

  return (
    <div
      className={cn(
        /* The container pair, not a neutral step: an avatar sits on every neutral step there
           is, and on a dialog (`surface-container-high`) a neutral disc was the dialog's own
           colour — only the bare glyph showed (G0-006). Missing media is `primary-container`
           here as it is for an absent profile banner; `secondary-container` means selected. */
        'relative shrink-0 overflow-hidden rounded-full bg-primary-container text-on-primary-container',
        ringed && 'ring-2 ring-primary-ink',
        !inline && heroBox,
        className,
      )}
      style={inline ? { width: size, height: size } : undefined}
    >
      {/* The fallback stays mounted underneath rather than being swapped in on
          error: it doubles as the decode placeholder, so the circle is never
          empty — and React cannot see an imperative swap anyway. */}
      <div aria-hidden="true" className="absolute inset-0 flex items-center justify-center">
        {inline ? <MdPerson size={Math.round(size * 0.6)} /> : <MdPerson size="60cqmin" />}
      </div>

      {url && !broken ? (
        unoptimized ? (
          /* eslint-disable-next-line @next/next/no-img-element -- an off-whitelist host
             that also refuses a request carrying a `Referer`; see `unoptimized`. */
          <img
            src={url}
            alt={name || '用户头像'}
            referrerPolicy="no-referrer"
            loading={priority ? 'eager' : 'lazy'}
            fetchPriority={priority ? 'high' : undefined}
            decoding="async"
            onError={() => setBrokenUrl(url)}
            className="absolute inset-0 h-full w-full object-cover"
          />
        ) : (
          <FadeInImage
            src={url}
            alt={name || '用户头像'}
            fill
            sizes={inline ? `${size}px` : '128px'}
            eager={priority}
            fetchPriority={priority ? 'high' : undefined}
            className="object-cover"
          />
        )
      ) : null}
    </div>
  );
}
