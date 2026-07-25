'use client';

import {
  useCallback,
  useEffect,
  useRef,
  type ComponentProps,
  type MouseEvent,
  type PointerEvent,
  type RefObject,
} from 'react';
import type Link from 'next/link';
import { useRouter } from 'next/navigation';
import type { PonyImage } from '@/lib/types/image';
import { cancelImageDetailPrefetch } from '@/lib/detail';
import {
  canAnimateImageHero,
  prepareImageHero,
  requestImageHeroOpen,
  warmImageHero,
  warmImageHeroFrame,
  type ImageHeroSnapshot,
} from '@/lib/hero';
import { isScrollLikelyActive } from '@/lib/hero/scrollActivity';

type HeroLinkKind = 'card' | 'featured';
type NavigateHandler = NonNullable<ComponentProps<typeof Link>['onNavigate']>;

const HOVER_INTENT_DELAY_MS = 70;
const FOCUS_INTENT_DELAY_MS = 120;
const SNAPSHOT_REUSE_MS = 1500;

export function useHeroLink<T extends HTMLElement>({
  image,
  sourceRef,
  previewSrc,
  canAnimate,
  kind,
}: {
  image: PonyImage | null;
  sourceRef: RefObject<T | null>;
  previewSrc: string;
  canAnimate: boolean;
  kind: HeroLinkKind;
}) {
  const router = useRouter();
  const preparedRef = useRef<ImageHeroSnapshot | null>(null);
  const expiryTimerRef = useRef(0);
  const intentTimerRef = useRef(0);
  const cancelFrameWarmRef = useRef<Disposer | null>(null);
  const capturedPointerRef = useRef<number | null>(null);
  const clickOwnedRef = useRef(false);
  const href = image ? `/pic/${image.id}` : '#';

  const clearPrepared = useCallback(() => {
    if (expiryTimerRef.current) window.clearTimeout(expiryTimerRef.current);
    expiryTimerRef.current = 0;
    preparedRef.current = null;
  }, []);

  const cancelIntent = useCallback((cancelDetail = false) => {
    if (intentTimerRef.current) window.clearTimeout(intentTimerRef.current);
    intentTimerRef.current = 0;
    cancelFrameWarmRef.current?.();
    cancelFrameWarmRef.current = null;
    if (cancelDetail && image) cancelImageDetailPrefetch(image.id);
  }, [image]);

  const warmRouteAndMedia = useCallback((priority: 'background' | 'immediate') => {
    if (!image) return;
    router.prefetch(href);
    void warmImageHero(image.id, priority);
    cancelFrameWarmRef.current?.();
    cancelFrameWarmRef.current = warmImageHeroFrame(sourceRef.current);
  }, [href, image, router, sourceRef]);

  const scheduleIntent = useCallback((delay: number) => {
    if (!image || intentTimerRef.current || isScrollLikelyActive()) return;
    intentTimerRef.current = window.setTimeout(() => {
      intentTimerRef.current = 0;
      if (!isScrollLikelyActive()) warmRouteAndMedia('background');
    }, delay);
  }, [image, warmRouteAndMedia]);

  const prepare = useCallback(() => {
    if (!image || !sourceRef.current) return null;
    const cached = preparedRef.current;
    if (cached && Date.now() - cached.createdAt < SNAPSHOT_REUSE_MS) return cached;
    clearPrepared();
    cancelFrameWarmRef.current?.();
    cancelFrameWarmRef.current = null;
    const snapshot = prepareImageHero(
      image,
      sourceRef.current,
      canAnimate,
      previewSrc,
    );
    preparedRef.current = snapshot;
    if (snapshot) {
      expiryTimerRef.current = window.setTimeout(() => {
        if (preparedRef.current === snapshot) preparedRef.current = null;
        expiryTimerRef.current = 0;
      }, SNAPSHOT_REUSE_MS + 100);
    }
    return snapshot;
  }, [canAnimate, clearPrepared, image, previewSrc, sourceRef]);

  const takePrepared = useCallback(() => {
    const cached = preparedRef.current;
    clearPrepared();
    return cached && Date.now() - cached.createdAt < SNAPSHOT_REUSE_MS
      ? cached
      : prepare();
  }, [clearPrepared, prepare]);

  const activateHero = useCallback(() => {
    if (!image) return;
    const source = sourceRef.current;
    const snapshot = takePrepared();
    if (!source || !snapshot || !canAnimateImageHero(snapshot)) return false;
    const background = {
      pathname: window.location.pathname,
      search: window.location.search,
    };
    return requestImageHeroOpen({
      snapshot,
      source,
      detailHref: href,
      background,
      navigation: {
        push: (nextHref) => router.push(nextHref, { scroll: false }),
        replace: (nextHref) => router.replace(nextHref, { scroll: false }),
      },
    });
  }, [href, image, router, sourceRef, takePrepared]);

  const handleNavigate: NavigateHandler = useCallback((event) => {
    if (clickOwnedRef.current) {
      event.preventDefault();
      return;
    }
    if (activateHero()) event.preventDefault();
  }, [activateHero]);

  const handleClick = useCallback((event: MouseEvent<HTMLAnchorElement>) => {
    if (
      event.button !== 0 ||
      event.metaKey ||
      event.ctrlKey ||
      event.shiftKey ||
      event.altKey
    ) {
      return;
    }
    cancelIntent();
    warmRouteAndMedia('immediate');
    prepare();
    if (!activateHero()) return;
    clickOwnedRef.current = true;
    event.preventDefault();
    queueMicrotask(() => {
      clickOwnedRef.current = false;
    });
  }, [activateHero, cancelIntent, prepare, warmRouteAndMedia]);

  useEffect(() => () => {
    clearPrepared();
    cancelIntent(true);
  }, [cancelIntent, clearPrepared]);

  return {
    href,
    sourceKey: image ? `${kind}:${image.id}` : '',
    prefetch: false as const,
    scroll: false as const,
    onNavigate: handleNavigate,
    onClick: handleClick,
    onPointerEnter: () => scheduleIntent(HOVER_INTENT_DELAY_MS),
    onPointerLeave: () => cancelIntent(true),
    onFocus: () => scheduleIntent(FOCUS_INTENT_DELAY_MS),
    onBlur: () => cancelIntent(true),
    onPointerDown: (event: PointerEvent<HTMLAnchorElement>) => {
      if (
        event.button !== 0 ||
        event.metaKey ||
        event.ctrlKey ||
        event.shiftKey ||
        event.altKey
      ) {
        return;
      }
      try {
        event.currentTarget.setPointerCapture(event.pointerId);
        capturedPointerRef.current = event.pointerId;
      } catch {
        capturedPointerRef.current = null;
      }
    },
    onPointerUp: (event: PointerEvent<HTMLAnchorElement>) => {
      if (capturedPointerRef.current !== event.pointerId) return;
      capturedPointerRef.current = null;
      try {
        if (event.currentTarget.hasPointerCapture(event.pointerId)) {
          event.currentTarget.releasePointerCapture(event.pointerId);
        }
      } catch {
        // The browser may release capture when native scrolling wins.
      }
    },
    onPointerCancel: (event: PointerEvent<HTMLAnchorElement>) => {
      if (capturedPointerRef.current !== event.pointerId) return;
      capturedPointerRef.current = null;
    },
  };
}

type Disposer = () => void;
