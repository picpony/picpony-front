'use client';

import { getImageProps } from 'next/image';
import { mediaFacts } from '@/lib/detail';
import { isDetailFinalOptimized } from '@/lib/detailFinalSource';
import { toCurrentImageLine } from '@/lib/imageLoader';
import type { ImagePreview } from '@/lib/types/image';
import { getHeroMediaRenderedWidth, getHeroMediaResponsiveSizes } from './geometry';

/**
 * The `w`-descriptor candidate `next/image` will pick for the detail's final at this viewport —
 * shared by the detail's own prefetch lease (`DetailImage`) and the press-time warm below, so
 * both ask for the file the final layer is going to request.
 */
export function getDetailFinalCandidate(
  srcSet: string | undefined,
  fallback: string,
  width: number,
  height: number,
) {
  if (!srcSet || typeof window === 'undefined') return fallback;

  const renderedWidth = getHeroMediaRenderedWidth(
    { width, height },
    { width: window.innerWidth, height: window.innerHeight },
  );
  const targetWidth = renderedWidth * Math.max(1, window.devicePixelRatio || 1);
  const candidates = srcSet
    .split(',')
    .map((candidate) => {
      const match = candidate.trim().match(/^(.*)\s+(\d+)w$/);
      return match ? { url: match[1], width: Number(match[2]) } : null;
    })
    .filter((candidate): candidate is { url: string; width: number } => Boolean(candidate))
    .sort((a, b) => a.width - b.width);

  return (
    candidates.find((candidate) => candidate.width >= targetWidth)?.url ??
    candidates.at(-1)?.url ??
    fallback
  );
}

/** The URL the detail's final `<img>` will request for this picture, or `''` for none. */
export function detailFinalRequestUrl(image: ImagePreview): string {
  const facts = mediaFacts(image);
  if (facts.isVideo || !facts.imageSrc) return '';
  /* The record the detail renders is put on the current image line (`applyImageLine`), and the
     final layer's first attempt is that URL exactly (`DetailImage`'s `firstAttempt`). */
  const src = toCurrentImageLine(facts.imageSrc);
  const width = Math.max(1, image.width || 1);
  const height = Math.max(1, image.height || 1);
  const { props } = getImageProps({
    src,
    alt: '',
    width,
    height,
    sizes: getHeroMediaResponsiveSizes({ width, height }),
    quality: 82,
    loading: 'eager',
    unoptimized: !isDetailFinalOptimized(src),
  });
  return getDetailFinalCandidate(props.srcSet, props.src, width, height);
}

/** Requests in flight, held so they are not collected (and cancelled) before they land. */
const warming = new Map<string, HTMLImageElement>();
const warmed = new Set<string>();
const MAX_WARMING = 3;
const MAX_WARMED = 24;

/**
 * **Start the detail's picture on the press, not on the route commit.** The final layer mounts
 * when the detail route commits — after the flight has landed and the route's payload has come
 * back, 300–550ms after the tap on a phone (measured on dev.picpony.top at 4× CPU) — and only
 * then asked for the full-size file, so the reader looked at the card's small bitmap, blown up,
 * for that long plus the download. A press is the user choosing this picture (the record and the
 * route are already fetched from here), so the file starts downloading in the same gesture; the
 * final `<img>` later finds it in the memory cache, and the flyer sharpens in the air from it
 * (`lib/hero/upgrade.ts`).
 *
 * Stills only (a video's `medium` is the video file); at most three in flight, so a run of
 * presses that each became a scroll cannot queue a gallery's worth of full-size files.
 */
export function warmDetailFinal(image: ImagePreview | null | undefined) {
  if (!image || typeof window === 'undefined') return;
  let url = '';
  try {
    url = detailFinalRequestUrl(image);
  } catch {
    return;
  }
  if (!url || warming.has(url) || warmed.has(url)) return;
  if (warming.size >= MAX_WARMING) {
    const [oldestUrl, oldest] = warming.entries().next().value!;
    oldest.removeAttribute('src');
    warming.delete(oldestUrl);
  }
  const probe = new Image();
  probe.decoding = 'async';
  probe.fetchPriority = 'high';
  const settle = (ok: boolean) => {
    probe.onload = null;
    probe.onerror = null;
    warming.delete(url);
    if (!ok) return;
    if (warmed.size >= MAX_WARMED) warmed.delete(warmed.values().next().value!);
    warmed.add(url);
  };
  probe.onload = () => settle(true);
  probe.onerror = () => settle(false);
  warming.set(url, probe);
  probe.src = url;
}
