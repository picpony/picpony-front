'use client';

import { useState } from 'react';
import { MdImageNotSupported } from 'react-icons/md';
import Skeleton from '@/components/Skeleton';
import { ICON } from '@/lib/icons';
import type { PonyChoice } from '@/lib/api/desktopPonies';
import { ponyPreview } from '@/lib/desktopPonies/chooser';
import styles from './PoniesSettings.module.css';

/** Static first frame, so there is no animation to stop on hidden/reduced/off screens. */
export default function PonyPreview({ pony }: { pony: PonyChoice }) {
  const src = ponyPreview(pony);
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);
  return <span className={styles.preview} aria-hidden="true">
    {!src || failed ? <span className="flex flex-col items-center gap-2 text-on-surface-variant">
      <MdImageNotSupported size={ICON.standard} />
      <span className="text-body-s">预览暂不可用</span>
    </span> : <>
      {!loaded && <Skeleton className="h-16 w-16" />}
      {/* Original sprite pixels, decoded once to PNG; no engine or animated GIF is loaded. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={src} alt="" width={112} height={96} loading="lazy" decoding="async" draggable={false}
        className={`${styles.sprite} ${loaded ? '' : 'invisible'}`} onLoad={() => setLoaded(true)} onError={() => setFailed(true)} />
    </>}
  </span>;
}
