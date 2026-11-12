'use client';

import { useEffect, useId, useRef, useState } from 'react';
import Lightbox from 'yet-another-react-lightbox';
import Zoom from 'yet-another-react-lightbox/plugins/zoom';
import Counter from 'yet-another-react-lightbox/plugins/counter';
import Fullscreen from 'yet-another-react-lightbox/plugins/fullscreen';
import Download from 'yet-another-react-lightbox/plugins/download';
import Video from 'yet-another-react-lightbox/plugins/video';
import Slideshow from 'yet-another-react-lightbox/plugins/slideshow';
import type { ControllerRef, Slide, SlideshowRef } from 'yet-another-react-lightbox';
/* The library's stylesheet travels with this module — it is only ever needed once the viewer is
   open, and this module is the lazily loaded one. */
import 'yet-another-react-lightbox/styles.css';
import Spinner from '@/components/Spinner';
import { MOTION_SPEED_SCALE, useMotionScale } from '@/lib/appearance';
import { COMPONENT_SPRING_MS, SPRING_MS, springLinear } from '@/lib/spring';
import { useHistoryLayer } from '@/lib/historyLayers';

/**
 * The fullscreen lightbox, whole, in one lazily-loaded module.
 *
 * It was already `dynamic()` in `PicDetail` — but only the *core* was. The five plugins were
 * static imports that the component then aliased to five consts, so `yet-another-react-lightbox`
 * and its zoom, counter, fullscreen, download and video entry points all landed in the detail
 * route's first-load chunk while the thing they configure was code-split away. Splitting the
 * core and statically importing its plugins is the shape that looks like a fix and is not one.
 *
 * That matters here specifically rather than in general: the detail route's first render happens
 * *inside* the hero flight's window — `startRouteNavigation` pushes the URL during the opening
 * leg and the route is sealed with `visibility`, so React lays the whole page out while the
 * flyer is in the air. Anything not needed to paint that first frame is worth moving off it.
 *
 * The type is re-exported rather than redeclared. `PicDetail` takes `PicLightboxSlide` as a
 * type-only import, which SWC erases, so it gets the library's shape without pulling the module
 * back into its bundle.
 *
 * **Its download is the detail's** (`onDownload`, `lib/download.ts`): one path for one action.
 * The library's own saved whatever the URL answered — an error page included — under the last
 * path segment of a line-wrapped URL, which was the proxy's query string.
 */
export type PicLightboxSlide = Slide;

// One shell depth lease per viewer, including overlapping viewer departures.
// See docs/transitions.md#fullscreen-image-viewer.
const backgroundOwners = new WeakMap<HTMLElement, Set<object>>();

function sinkBackground() {
  const root = document.querySelector<HTMLElement>('[data-app-root]');
  if (!root) return () => {};
  const owners = backgroundOwners.get(root) ?? new Set<object>();
  const owner = {};
  owners.add(owner);
  backgroundOwners.set(root, owners);
  root.setAttribute('data-lightbox-depth', '');
  return () => {
    owners.delete(owner);
    if (!owners.size) root.removeAttribute('data-lightbox-depth');
  };
}

export default function PicLightbox({
  open,
  close,
  slides,
  index = 0,
  onDownload,
  slideshow = false,
  onSlideshowStart,
  onSlideshowStop,
}: {
  open: boolean;
  close: () => void;
  slides: PicLightboxSlide[];
  /** The slide it opens on — a post's third picture opens on the third, with the rest beside it. */
  index?: number;
  /** Save the original — the detail's own download. Without it the control is not drawn. */
  onDownload?: () => void;
  /** Explicitly requested playback; the normal image viewer never advances on its own. */
  slideshow?: boolean;
  onSlideshowStart?: () => void;
  onSlideshowStop?: () => void;
}) {
  const scale = useMotionScale('image');
  const portalId = useId();
  const releaseBackground = useRef<(() => void) | null>(null);
  const closeTurn = useRef(0);
  const exitTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => {
    closeTurn.current += 1;
    if (exitTimer.current !== null) clearTimeout(exitTimer.current);
    releaseBackground.current?.();
    releaseBackground.current = null;
  }, [open]);

  const finishClose = async () => {
    const turn = ++closeTurn.current;
    const animations = document.getElementById(portalId)?.getAnimations() ?? [];
    // YARL skips its lifetime on OS reduced motion. Keep the controlled portal mounted
    // through the app's remaining departure, including an explicit standard preference.
    if (animations.length) {
      await Promise.race([
        Promise.allSettled(animations.map(animation => animation.finished)),
        new Promise<void>(resolve => {
          exitTimer.current = setTimeout(resolve, SPRING_MS.defaultEffects * MOTION_SPEED_SCALE.slow);
        }),
      ]);
      if (turn !== closeTurn.current) return;
      if (exitTimer.current !== null) clearTimeout(exitTimer.current);
      exitTimer.current = null;
    }
    if (turn === closeTurn.current) close();
  };

  /* Back closes the viewer and nothing under it (docs/transitions.md#fullscreen-image-viewer).
     Release the history entry when departure starts, alongside the shell's return. */
  const controller = useRef<ControllerRef>(null);
  const slideshowController = useRef<SlideshowRef>(null);
  const resumeOnVisible = useRef(false);
  const [exiting, setExiting] = useState(false);
  useHistoryLayer(open && !exiting, () => {
    if (controller.current) controller.current.close();
    else close();
  });

  useEffect(() => {
    if (!open || !slideshow || exiting) {
      resumeOnVisible.current = false;
      return;
    }
    const visibility = () => {
      const player = slideshowController.current;
      if (document.hidden) {
        // Repeated hidden events must not forget playback paused by the first event. Spelled out:
        // the React Compiler does not lower a logical assignment, and skipped the whole viewer.
        if (!resumeOnVisible.current) resumeOnVisible.current = Boolean(player?.playing);
        player?.pause();
      } else if (resumeOnVisible.current) {
        resumeOnVisible.current = false;
        player?.play();
      }
    };
    visibility();
    document.addEventListener('visibilitychange', visibility);
    // The plugin clears its scheduler on unmount. Pausing here would also pause autoplay
    // during Strict Mode's effect replay, even though the viewer remains open.
    return () => document.removeEventListener('visibilitychange', visibility);
  }, [open, slideshow, exiting]);

  return (
    <Lightbox
      open={open}
      close={finishClose}
      className="pic-lightbox"
      portal={{ container: { id: portalId } }}
      slides={slides}
      index={index}
      controller={{ ref: controller }}
      on={{
        entering: () => {
          closeTurn.current += 1;
          if (exitTimer.current !== null) clearTimeout(exitTimer.current);
          if (!releaseBackground.current) releaseBackground.current = sinkBackground();
          setExiting(false);
        },
        exiting: () => {
          releaseBackground.current?.();
          releaseBackground.current = null;
          resumeOnVisible.current = false;
          slideshowController.current?.pause();
          setExiting(true);
        },
        slideshowStart: () => {
          if (document.hidden) {
            resumeOnVisible.current = true;
            slideshowController.current?.pause();
          } else if (!slideshowController.current?.disabled) {
            onSlideshowStart?.();
          }
        },
        slideshowStop: onSlideshowStop,
      }}
      /* A counter reading 1 / 1 says nothing, and neither does a download control with nothing
         behind it. */
      plugins={[Zoom, ...(slides.length > 1 ? [Counter] : []), Fullscreen, ...(onDownload ? [Download] : []), Video, ...(slideshow ? [Slideshow] : [])]}
      slideshow={{ autoplay: slideshow, delay: 5000, ref: slideshowController }}
      /* These numbers also drive the library's JS lifetime and zoom/swipe
         tracks. A CSS-only fade left slow exits cut off at 250ms and kept an
         invisible portal blocking input under the off tier. */
      animation={{
        /* YARL's lifetime follows departure. CSS splits fullscreen arrival into SlowSpatial
           travel and SlowEffects opacity; departure uses DefaultEffects for both. */
        fade: SPRING_MS.defaultEffects * scale,
        /* A slide is a pager turning: `PAGER_SPRING`, Compose's `HorizontalPager` snap (ζ1 k400) —
           the same spring the tab strip pages on, so the app's two pagers turn alike. A zoom step
           docks to its new scale on the layout spring. Both critically damped, so a picture never
           swings past its slot and back. */
        swipe: COMPONENT_SPRING_MS.pager * scale,
        zoom: SPRING_MS.layout * scale,
        easing: {
          fade: springLinear('defaultEffects'),
          swipe: springLinear('layout'),
          navigation: springLinear('layout'),
        },
      }}
      zoom={{
        maxZoomPixelRatio: 3,
        scrollToZoom: true,
      }}
      counter={{ separator: ' / ' }}
      labels={{
        Lightbox: '图片查看器',
        'Photo gallery': '图片',
        Carousel: '轮播',
        Slide: '图片',
        '{index} of {total}': '第 {index} 张，共 {total} 张',
        Previous: '上一张',
        Next: '下一张',
        /* No `(Esc)` in a name: it is spoken, parenthesis and all. */
        Close: '关闭',
        Download: '下载原图',
        'Zoom in': '放大',
        'Zoom out': '缩小',
        'Enter Fullscreen': '全屏',
        'Exit Fullscreen': '退出全屏',
        Play: '开始放映',
        Pause: '暂停放映',
      }}
      carousel={{
        finite: true,
      }}
      /* Replace the library's own loading ring with `Spinner` like everything
         else; `tone="inherit"` because this sits on media-stage whose ink is
         `on-media`, which neither other tone names. */
      render={{
        iconLoading: () => (
          <span className="text-on-media">
            <Spinner size="lg" tone="inherit" track />
          </span>
        ),
        /* One picture has nowhere to go: the library would still draw both arrows,
           disabled, at the two edges (R4-034). */
        ...(slides.length <= 1 ? { buttonPrev: () => null, buttonNext: () => null } : null),
      }}
      download={{
        download: () => onDownload?.(),
      }}
    />
  );
}
