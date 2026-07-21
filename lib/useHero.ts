'use client';

import {
  useCallback,
  useEffect,
  useRef,
  type ComponentProps,
  type PointerEvent,
  type RefObject,
} from 'react';
import type Link from 'next/link';
import { useRouter } from 'next/navigation';
import type { PonyImage } from '@/lib/types/image';
import {
  cancelImageDetailPrefetch,
  prefetchImageDetail,
} from '@/lib/detail';
import {
  canUseImageHeroTransition,
  isImageHeroTransitionRunning,
  navigateToImageWithHero,
  prepareImageHero,
  warmImageHeroFrame,
  warmImageHero,
  type ImageHeroSnapshot,
} from '@/lib/hero';

type HeroLinkKind = 'card' | 'featured';
type NavigateHandler = NonNullable<ComponentProps<typeof Link>['onNavigate']>;
const HOVER_INTENT_DELAY = 70;

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
  const expiryTimerRef = useRef<number | null>(null);
  const hoverTimerRef = useRef<number | null>(null);
  const cancelFrameWarmRef = useRef<(() => void) | null>(null);
  const href = image ? `/pic/${image.id}` : '#';

  const clearPrepared = useCallback(() => {
    if (expiryTimerRef.current !== null) {
      window.clearTimeout(expiryTimerRef.current);
      expiryTimerRef.current = null;
    }
    preparedRef.current = null;
  }, []);

  const cancelHoverIntent = useCallback((cancelDetail = false) => {
    if (hoverTimerRef.current !== null) {
      window.clearTimeout(hoverTimerRef.current);
      hoverTimerRef.current = null;
    }
    cancelFrameWarmRef.current?.();
    cancelFrameWarmRef.current = null;
    if (cancelDetail && image) cancelImageDetailPrefetch(image.id);
  }, [image]);

  const warmFrame = useCallback(() => {
    cancelFrameWarmRef.current?.();
    cancelFrameWarmRef.current = warmImageHeroFrame(sourceRef.current);
  }, [sourceRef]);

  const warmImmediately = useCallback(() => {
    if (!image) return;
    cancelHoverIntent();
    router.prefetch(href);
    void warmImageHero(image.id);
  }, [cancelHoverIntent, href, image, router]);

  const scheduleHoverWarm = useCallback(() => {
    if (!image || hoverTimerRef.current !== null) return;
    hoverTimerRef.current = window.setTimeout(() => {
      hoverTimerRef.current = null;
      router.prefetch(href);
      void warmImageHero();
      void prefetchImageDetail(image.id, { priority: 'background' }).catch(() => undefined);
      warmFrame();
    }, HOVER_INTENT_DELAY);
  }, [href, image, router, warmFrame]);

  const prepare = useCallback(() => {
    if (!image || isImageHeroTransitionRunning()) return null;
    const prepared = preparedRef.current;
    if (prepared && Date.now() - prepared.createdAt < 1500) return prepared;

    clearPrepared();
    cancelFrameWarmRef.current?.();
    cancelFrameWarmRef.current = null;
    const next = prepareImageHero(
      image,
      sourceRef.current,
      canAnimate,
      previewSrc,
    );
    preparedRef.current = next;
    if (next) {
      expiryTimerRef.current = window.setTimeout(() => {
        if (preparedRef.current === next) preparedRef.current = null;
        expiryTimerRef.current = null;
      }, 1600);
    }
    return next;
  }, [canAnimate, clearPrepared, image, previewSrc, sourceRef]);

  const takePrepared = useCallback(() => {
    const prepared = preparedRef.current;
    clearPrepared();
    return prepared && Date.now() - prepared.createdAt < 1500
      ? prepared
      : prepare();
  }, [clearPrepared, prepare]);

  const handleNavigate: NavigateHandler = useCallback((event) => {
    if (!image) return;
    if (isImageHeroTransitionRunning()) {
      event.preventDefault();
      return;
    }

    const snapshot = takePrepared();
    const source = sourceRef.current;
    if (!snapshot || !source || !canUseImageHeroTransition(snapshot)) return;

    event.preventDefault();
    const originHref = `${window.location.pathname}${window.location.search}`;
    void navigateToImageWithHero(
      snapshot,
      source,
      () => {
        window.history.pushState(
          { ...window.history.state, picponyHero: href },
          '',
          originHref,
        );
        router.replace(href, { scroll: false });
      },
      (navigationHandled) => {
        if (!navigationHandled) window.history.back();
      },
      { detailHref: href },
    );
  }, [href, image, router, sourceRef, takePrepared]);

  useEffect(() => {
    return () => {
      clearPrepared();
      cancelHoverIntent(true);
    };
  }, [cancelHoverIntent, clearPrepared]);

  return {
    href,
    sourceKey: image ? `${kind}:${image.id}` : '',
    warmFrame,
    prefetch: false as const,
    scroll: false as const,
    onPointerEnter: scheduleHoverWarm,
    onPointerLeave: () => cancelHoverIntent(true),
    onPointerDown: (event: PointerEvent<HTMLAnchorElement>) => {
      warmImmediately();
      if (event.button === 0) prepare();
    },
    onClick: () => {
      warmImmediately();
      prepare();
    },
    onFocus: warmImmediately,
    onBlur: () => cancelHoverIntent(true),
    onNavigate: handleNavigate,
  };
}
