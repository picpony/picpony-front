'use client';

import Lightbox from 'yet-another-react-lightbox';
import Zoom from 'yet-another-react-lightbox/plugins/zoom';
import Counter from 'yet-another-react-lightbox/plugins/counter';
import Fullscreen from 'yet-another-react-lightbox/plugins/fullscreen';
import Download from 'yet-another-react-lightbox/plugins/download';
import Video from 'yet-another-react-lightbox/plugins/video';
import type { Slide } from 'yet-another-react-lightbox';
import Spinner from '@/components/Spinner';

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
 * The type is re-exported rather than redeclared. `download` on a slide comes from the Download
 * plugin's own module augmentation, so it is only in scope where that plugin is imported — which
 * is here. `PicDetail` takes `PicLightboxSlide` as a type-only import, which SWC erases, so it
 * gets the augmented shape without pulling the module back into its bundle.
 */
export type PicLightboxSlide = Slide;

export default function PicLightbox({
  open,
  close,
  slides,
}: {
  open: boolean;
  close: () => void;
  slides: PicLightboxSlide[];
}) {
  return (
    <Lightbox
      open={open}
      close={close}
      slides={slides}
      plugins={[Zoom, Counter, Fullscreen, Download, Video]}
      zoom={{
        maxZoomPixelRatio: 3,
        scrollToZoom: true,
      }}
      counter={{ separator: ' / ' }}
      labels={{
        Close: '关闭 (Esc)',
        Download: '下载',
        'Zoom in': '放大',
        'Zoom out': '缩小',
        'Enter Fullscreen': '全屏',
        'Exit Fullscreen': '退出全屏',
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
      }}
      download={{
        download: ({ slide, saveAs }) => {
          const s = slide as unknown as Record<string, unknown>;
          const dl = s.download;
          if (dl && typeof dl === 'object' && 'url' in dl) {
            saveAs(
              (dl as { url: string; filename?: string }).url,
              (dl as { url: string; filename?: string }).filename,
            );
          } else if (typeof s.src === 'string') {
            saveAs(s.src);
          }
        },
      }}
    />
  );
}
