'use client';

import {
  useEffect,
  useRef,
  useSyncExternalStore,
} from 'react';
import { usePathname, useSearchParams } from 'next/navigation';
import DetailHeader from '@/components/DetailHeader';
import DetailBack from '@/components/DetailBack';
import HeroFrame from '@/components/HeroFrame';
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

export default function HeroStage() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const search = searchParams.toString();
  const state = useSyncExternalStore(
    subscribeImageHeroStage,
    getImageHeroStage,
    getServerStage,
  );
  const targetRef = useRef<HTMLDivElement>(null);
  const handleFrameDrawn = () => {
    targetRef.current?.setAttribute('data-image-hero-stage-ready', 'true');
  };

  useEffect(() => {
    observeImageHeroClientNavigation(`${pathname}${search ? `?${search}` : ''}`);
  }, [pathname, search]);

  const layoutImage = state.snapshot?.image;
  // The stage is the geometry contract for the flight. Keep it bound to the
  // click-time snapshot while the detail request resolves: a late title or
  // metadata update must not move the destination below the flyer. The real
  // route receives the richer image after the atomic handoff.
  const image = layoutImage;
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
              <DetailHeader key={image.id} image={image} layout="stage" metadataReady={false} />
              <div className="relative flex min-h-[32vh] w-full items-start justify-center px-4 pb-4 pt-2 md:min-h-[48vh]">
                <div
                  className="pointer-events-none absolute inset-x-4 top-2 z-20 flex justify-center"
                >
                  <div
                    ref={targetRef}
                    data-image-hero-stage-target
                    data-image-hero-stage-id={image.id}
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
                  <div aria-hidden="true" className="mb-6 animate-pulse">
                    <div className="mb-2 flex justify-between">
                      <span className="h-4 w-14 rounded bg-slate-200 dark:bg-slate-700" />
                      <span className="h-4 w-14 rounded bg-slate-200 dark:bg-slate-700" />
                    </div>
                    <div className="h-2.5 w-full rounded bg-slate-200 dark:bg-slate-700" />
                  </div>
                </div>
              </div>
            </div>
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
