'use client';

import { useEffect, useMemo, useRef, useState, type MouseEvent } from 'react';
import dynamic from 'next/dynamic';
import { getImageProps } from 'next/image';
import { useRouter } from 'next/navigation';
import { bbcodeToSafeHtml, type RichImageAttributes } from '@/lib/bbcode';
import { inAppHref, isInternalHref, isPlainActivation } from '@/lib/richTextLinks';
import { cn } from '@/lib/utils';
import type { PicLightboxSlide } from '@/components/PicLightbox';

/* The viewer, whole, behind its own boundary: only a press on a picture fetches it. */
const PicLightbox = dynamic(() => import('@/components/PicLightbox'), { ssr: false, loading: () => null });

interface BBCodeRendererProps {
  content: string;
  className?: string;
}

/** The widest a rendered picture gets: the reading column. */
const RICH_IMAGE_SIZES = '(max-width: 960px) 100vw, 900px';

/**
 * A picture through the optimizer when the optimizer may fetch it — PicPony's own uploads and a
 * Derpibooru image path with no query (`next.config.ts` `remotePatterns`, which is the security
 * of the optimizer and must not be widened for this) — so a 2527px upload is not what a 789px
 * column downloads. A GIF keeps its own URL: the optimizer passes animations through unresized.
 * Anything else is its own URL. In development the optimizer is off and this is the same URL.
 */
function richImage(src: string): RichImageAttributes {
  let url: URL;
  try {
    url = new URL(src);
  } catch {
    return { src };
  }
  const own = url.hostname === 'picpony.top';
  const derpi = url.hostname === 'derpicdn.net' && url.pathname.startsWith('/img/') && !url.search;
  if (url.protocol !== 'https:' || !(own || derpi) || /\.gif$/i.test(url.pathname)) return { src };
  const { props } = getImageProps({ src, alt: '', fill: true, sizes: RICH_IMAGE_SIZES, quality: 75 });
  return { src: props.src, srcSet: props.srcSet, sizes: props.sizes };
}

/** The URL a picture was written with, from an optimizer URL (`/_next/image?url=…`) or itself. */
function originalOf(img: HTMLImageElement): string {
  const src = img.getAttribute('src') ?? '';
  if (!src.startsWith('/_next/image')) return img.currentSrc || img.src;
  return new URLSearchParams(src.split('?')[1] ?? '').get('url') ?? img.src;
}

/**
 * The picture has arrived, or has definitely not: a failed optimizer read falls back to the
 * picture's own URL once, and a failed own URL says so in place — `complete` alone is true for a
 * failed picture too, so the test is `naturalWidth` (AGENTS "Complete is not loaded").
 */
function settleImage(img: HTMLImageElement, failed: boolean) {
  if (!failed) {
    img.removeAttribute('data-loading');
    return;
  }
  if (img.getAttribute('src')?.startsWith('/_next/image')) {
    const original = originalOf(img);
    img.removeAttribute('srcset');
    img.removeAttribute('sizes');
    img.src = original;
    return;
  }
  img.removeAttribute('data-loading');
  img.setAttribute('data-failed', '');
  img.alt = '图片加载失败';
}

/**
 * The published presentation of a BBCode text.
 *
 * Three behaviours the HTML string cannot carry, delegated from the container: a link into the
 * app navigates in place (a modified click still does what the browser does with it); a picture
 * opens the viewer on itself, with the text's other pictures beside it; and a picture holds a
 * placeholder's box until it has arrived, then fades in (globals.css).
 */
export default function BBCodeRenderer({ content, className }: BBCodeRendererProps) {
  const html = useMemo(
    () => bbcodeToSafeHtml(content, { image: richImage, zoomable: true, isInternal: isInternalHref }),
    [content],
  );
  const ref = useRef<HTMLDivElement>(null);
  const router = useRouter();
  const [viewer, setViewer] = useState<{ slides: PicLightboxSlide[]; index: number; open: boolean } | null>(null);

  useEffect(() => {
    const root = ref.current;
    if (!root) return;
    const onLoad = (event: Event) => {
      if (event.target instanceof HTMLImageElement && root.contains(event.target)) settleImage(event.target, false);
    };
    const onError = (event: Event) => {
      if (event.target instanceof HTMLImageElement && root.contains(event.target)) settleImage(event.target, true);
    };
    root.addEventListener('load', onLoad, true);
    root.addEventListener('error', onError, true);
    /* Whatever settled before this ran — a server-rendered picture that arrived before hydration. */
    for (const img of root.querySelectorAll<HTMLImageElement>('img[data-loading]')) {
      if (img.complete) settleImage(img, img.naturalWidth === 0);
    }
    return () => {
      root.removeEventListener('load', onLoad, true);
      root.removeEventListener('error', onError, true);
    };
  }, [html]);

  const onClick = (event: MouseEvent<HTMLDivElement>) => {
    const target = event.target instanceof Element ? event.target : null;
    const zoom = target?.closest<HTMLButtonElement>('[data-rt-zoom]');
    if (zoom && ref.current?.contains(zoom)) {
      const buttons = [...ref.current.querySelectorAll<HTMLButtonElement>('[data-rt-zoom]')];
      const slides = buttons.map((button) => {
        const img = button.querySelector('img');
        return { src: img ? originalOf(img) : '', alt: '' };
      });
      setViewer({ slides, index: Math.max(0, buttons.indexOf(zoom)), open: true });
      return;
    }
    const link = target?.closest<HTMLAnchorElement>('a[href]');
    if (!link || !ref.current?.contains(link) || link.target || !isPlainActivation(event)) return;
    const route = inAppHref(link.getAttribute('href') ?? '', window.location.origin);
    if (!route) return;
    event.preventDefault();
    router.push(route, { scroll: false });
  };

  if (!html) return null;
  return (
    <>
      {/* The container is not a control: the delegated handler only acts on the links and
          picture buttons inside it, each a real element with its own role and keyboard path. */}
      <div
        ref={ref}
        className={cn('bbcode-content break-words', className)}
        onClick={onClick}
        dangerouslySetInnerHTML={{ __html: html }}
      />
      {viewer && (
        <PicLightbox
          open={viewer.open}
          index={viewer.index}
          slides={viewer.slides}
          close={() => setViewer(null)}
        />
      )}
    </>
  );
}
