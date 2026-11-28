'use client';

import { useLayoutEffect, useRef, useState } from 'react';
import { MdImageNotSupported } from '@/components/icons/settings';
import LoadingIndicator from '@/components/LoadingIndicator';
import { ICON } from '@/lib/icons';
import type { PonyChoice } from '@/lib/api/desktopPonies';
import { ponyPreview } from '@/lib/desktopPonies/chooser';
import styles from './PoniesSettings.module.css';

/** Static first frame, so there is no animation to stop on hidden/reduced/off screens. */
export default function PonyPreview({ pony }: { pony: PonyChoice }) {
  const src = ponyPreview(pony);
  const imgRef = useRef<HTMLImageElement>(null);
  /* Keyed on `src` so changing `pony` without remounting resets load/failure state cleanly. */
  const [status, setStatus] = useState<{ src: string; kind: 'loaded' | 'failed' } | null>(null);
  const loaded = Boolean(src && status?.src === src && status.kind === 'loaded');
  const failed = Boolean(src && status?.src === src && status.kind === 'failed');

  useLayoutEffect(() => {
    if (!src) return;
    const img = imgRef.current;
    const ready = Boolean(img?.complete && img.naturalWidth > 0);
    setStatus(ready ? { src, kind: 'loaded' } : null);
  }, [src]);

  return (
    <span className={styles.preview} aria-hidden="true">
      {!src || failed ? (
        <span className="flex flex-col items-center gap-2 text-on-surface-variant">
          <MdImageNotSupported size={ICON.standard} />
          <span className="text-body-s">预览暂不可用</span>
        </span>
      ) : (
        <>
          {!loaded && <LoadingIndicator size="sm" tone="inherit" decorative autoPause />}
          {/* Original sprite pixels, decoded once to PNG; no engine or animated GIF is loaded. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            ref={imgRef}
            src={src}
            alt=""
            width={112}
            height={96}
            loading="lazy"
            decoding="async"
            draggable={false}
            className={`${styles.sprite} ${loaded ? '' : 'invisible'}`}
            onLoad={() => setStatus({ src, kind: 'loaded' })}
            onError={() => setStatus({ src, kind: 'failed' })}
          />
        </>
      )}
    </span>
  );
}
