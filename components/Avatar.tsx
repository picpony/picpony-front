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
   * The four are the scale; `'hero'` is the one avatar in the app that changes size
   * at a breakpoint (96 → 128) and therefore cannot be sized inline at all, since an
   * inline `width` beats any class. It emits the responsive utilities itself rather
   * than accepting them from the call site: this prop used to be `number | string`
   * with a string taken as arbitrary sizing classes, which meant the four-step
   * ladder in the docstring below was advice rather than a constraint — and two call
   * sites were already off it.
   */
  size?: 32 | 40 | 48 | 56 | 'hero';
  className?: string;
  /** Ring in the brand colour, for the profile header and other hero spots. */
  ringed?: boolean;
  /**
   * Render a native `<img referrerPolicy="no-referrer">` instead of `next/image`.
   *
   * For a host that is neither in `next.config.ts`'s whitelist nor willing to serve
   * a request carrying a `Referer` — QQ's avatar CDN is both. `/about` hand-rolled a
   * second avatar component (`MemberAvatar`) for exactly this, with its own box, its
   * own error state and a different fallback glyph, which is the duplication this
   * component's own docstring is about.
   */
  unoptimized?: boolean;
}

/**
 * User avatar, with one fallback: image → glyph.
 *
 * **The box takes one of four steps: 32 / 40 / 48 / 56**, plus `'hero'` for the two
 * profile headers. 40dp is the default and the one to reach for — it is `ListTokens`'
 * leading-avatar size, so it is what a row with a portrait in it is meant to be. 32 is
 * for a dense run (a chat turn), 48 for a contact list where the portrait is the
 * subject of the row, 56 for a header. There were 32, 36, 40, 44 and 48 in use, and 36
 * and 44 are on no scale: they were each chosen against the row they sat in rather
 * than against the other avatars in the app, which is why the sidebar's portrait and
 * the forum's were 4px apart for no reason anyone could state. The prop is a union now
 * rather than `number | string`, so the ladder is a constraint rather than a note — it
 * accepted arbitrary sizing classes before, and two call sites were using them.
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
 * When sized by `'hero'` the glyph is sized in `cqmin`, so it tracks the box
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
  unoptimized = false,
}: AvatarProps) {
  const url = getAvatarUrl(src);
  const inline = typeof size === 'number';
  /* `hero`'s classes live here rather than at the two call sites that need them, so
     the 96 → 128 pair is one value in one place and nothing else can invent a fifth
     box. `container-type: size` is what lets the fallback glyph track it in `cqmin`
     through the breakpoint without the caller restating anything; it is safe because
     an avatar is always a definite square. */
  const heroBox = 'w-24 h-24 sm:w-32 sm:h-32 [container-type:size]';
  /* The escape hatch's own error state. `next/image` reports a failed load through
     `FadeInImage`; a bare `<img>` needs `onError`, and the fallback below is already
     mounted underneath, so all this has to do is stop painting over it. */
  const [broken, setBroken] = useState(false);

  return (
    <div
      className={cn(
        'relative shrink-0 overflow-hidden rounded-full bg-surface-container-high text-on-surface-variant',
        ringed && 'ring-2 ring-primary',
        !inline && heroBox,
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

      {url && !broken ? (
        unoptimized ? (
          /* eslint-disable-next-line @next/next/no-img-element -- an off-whitelist host
             that also refuses a request carrying a `Referer`; see `unoptimized`. */
          <img
            src={url}
            alt={name || '用户头像'}
            referrerPolicy="no-referrer"
            loading="lazy"
            decoding="async"
            onError={() => setBroken(true)}
            className="absolute inset-0 h-full w-full object-cover"
          />
        ) : (
          <FadeInImage
            src={url}
            alt={name || '用户头像'}
            fill
            sizes={inline ? `${size}px` : '128px'}
            className="object-cover"
          />
        )
      ) : null}
    </div>
  );
}
