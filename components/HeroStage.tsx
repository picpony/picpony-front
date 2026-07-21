'use client';

import {
  useCallback,
  useEffect,
  useState,
  useSyncExternalStore,
} from 'react';
import { usePathname, useSearchParams } from 'next/navigation';
import DetailHeader from '@/components/DetailHeader';
import DetailBack from '@/components/DetailBack';
import HeroFrame from '@/components/HeroFrame';
import { peekImageDetail, subscribeImageDetail } from '@/lib/detail';
import {
  getImageHeroStage,
  interruptImageHero,
  observeImageHeroClientNavigation,
  subscribeImageHeroStage,
  type ImageHeroStageState,
} from '@/lib/hero';

const EMPTY_STAGE: ImageHeroStageState = { phase: 'idle', snapshot: null };

function getImageStyle(image: NonNullable<ImageHeroStageState['snapshot']>['image']) {
  const width = Math.max(1, image.width || 1);
  const height = Math.max(1, image.height || 1);
  const ratio = width / height;
  return {
    aspectRatio: `${width} / ${height}`,
    width: `min(100%, ${width}px, calc(80dvh * ${ratio}))`,
    maxWidth: '100%',
    maxHeight: '80dvh',
  };
}

function getServerStage() {
  return EMPTY_STAGE;
}

function getServerDetail() {
  return null;
}

export default function HeroStage() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const search = searchParams.toString();
  const state = useSyncExternalStore(
    subscribeImageHeroStage,
    getImageHeroStage,
    getServerStage,
  );
  const imageId = state.snapshot?.image.id ?? 0;
  const subscribeDetail = useCallback(
    (listener: () => void) => imageId > 0
      ? subscribeImageDetail(imageId, listener)
      : () => {},
    [imageId],
  );
  const readDetail = useCallback(
    () => imageId > 0 ? peekImageDetail(imageId) : null,
    [imageId],
  );
  const detail = useSyncExternalStore(subscribeDetail, readDetail, getServerDetail);
  const [drawnFrame, setDrawnFrame] = useState<HTMLCanvasElement | null>(null);
  const handleFrameDrawn = useCallback(() => {
    setDrawnFrame(state.snapshot?.previewFrame ?? null);
  }, [state.snapshot]);

  useEffect(() => {
    observeImageHeroClientNavigation(`${pathname}${search ? `?${search}` : ''}`);
  }, [pathname, search]);

  const layoutImage = state.snapshot?.image;
  const image = detail?.image ?? layoutImage;
  if (state.phase === 'idle' || !image || !layoutImage || !state.snapshot) return null;

  return (
    <>
    <section
      data-image-detail-overlay
      data-image-hero-stage
      className="pointer-events-auto absolute inset-0 z-[44] overflow-hidden"
    >
      <div data-image-detail-surface className="absolute inset-0 bg-white dark:bg-slate-950" />
      <div
        data-image-hero-stage-foreground
        aria-hidden="true"
        className="image-detail-overlay-scroll pointer-events-auto absolute inset-0 z-10 overflow-y-auto overscroll-contain touch-pan-y"
      >
        <div
          inert
          className="image-detail-overlay-content pointer-events-none relative min-h-full w-full"
        >
          <div className="image-detail-page mx-auto max-w-7xl px-2 sm:px-4">
            <div className="flex flex-col rounded-xl bg-transparent">
              <DetailHeader image={image} compact metadataReady={Boolean(detail)} />
              <div className="relative flex min-h-[40vh] w-full items-start justify-center p-4 md:min-h-[60vh]">
                <div
                  aria-hidden="true"
                  className="invisible flex-none"
                  style={getImageStyle(layoutImage)}
                />
              </div>
              <div
                data-image-detail-reveal="body"
                className="min-h-[80vh] bg-transparent p-4 sm:p-6"
              >
                <div className="mx-auto w-full max-w-5xl">
                  {detail ? (
                    <div className="mb-6">
                      <div className="mb-1.5 flex justify-between text-sm font-medium">
                        <span className="text-green-600">{detail.image.upvotes}</span>
                        <span className="text-red-500">{detail.image.downvotes}</span>
                      </div>
                      <div className="flex h-2.5 w-full overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
                        <div
                          className="h-full bg-green-500"
                          style={{
                            width: `${detail.image.upvotes + detail.image.downvotes > 0
                              ? detail.image.upvotes / (detail.image.upvotes + detail.image.downvotes) * 100
                              : 0}%`,
                          }}
                        />
                        <div className="h-full flex-1 bg-red-500" />
                      </div>
                    </div>
                  ) : (
                    <div aria-hidden="true" className="mb-6 animate-pulse">
                      <div className="mb-2 flex justify-between">
                        <span className="h-4 w-14 rounded bg-slate-200 dark:bg-slate-700" />
                        <span className="h-4 w-14 rounded bg-slate-200 dark:bg-slate-700" />
                      </div>
                      <div className="h-2.5 w-full rounded-full bg-slate-200 dark:bg-slate-700" />
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
      <div
        data-image-hero-stage-target-wrap
        className="image-hero-destination pointer-events-none absolute inset-x-0 z-20 will-change-transform"
      >
        <div className="mx-auto flex w-full max-w-7xl justify-center pl-6 pr-8 sm:pl-8 sm:pr-10">
          <div
            data-image-hero-stage-target
            data-image-hero-stage-id={image.id}
            data-image-hero-stage-ready={drawnFrame === state.snapshot.previewFrame ? 'true' : undefined}
            className="relative flex-none overflow-hidden rounded-lg bg-slate-50 dark:bg-slate-900"
            style={{
              ...getImageStyle(layoutImage),
              opacity: state.phase === 'landed' ? 1 : 0,
            }}
          >
            <HeroFrame
              frame={state.snapshot.previewFrame}
              onDrawn={handleFrameDrawn}
              aria-hidden="true"
              className="block h-full w-full object-contain"
            />
          </div>
        </div>
      </div>
    </section>
    <DetailBack
      data-image-detail-back-button
      data-image-detail-floating-back="stage"
      data-image-detail-reveal="chrome"
      data-image-hero-stage-back
      data-image-hero-stage-foreground
      onClick={() => { interruptImageHero(); }}
      className="pointer-events-auto absolute left-3 top-3 z-[46] sm:left-4 sm:top-4"
    />
    </>
  );
}
