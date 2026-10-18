'use client';

import { isAnimatedVisualSource, isVolatileVisualMedia } from './dom';
import { repaintHeroFrame } from './frameCache';

/**
 * **The flyer sharpens in the air.**
 *
 * The flyer is one canvas captured from the card at the press. In production the card's bitmap
 * is a `/_next/image` variant sized *for a card* (~300–640px), and the flight stretches it to
 * the ~900px well; development hides this because `images.unoptimized` hands the card the raw
 * 800px `medium`.
 *
 * Nothing sharper is required before take-off — any pre-take-off source races the press and
 * loses on exactly the first open. Instead the detail's final `<img>` (mounted at route render,
 * during the flight, `fetchpriority=high`) repaints the flyer's canvas in place the moment it
 * **decodes**. Geometry never reads the canvas's backing-store size (every transform is relative
 * to `flight.base`, a CSS box), so a bigger bitmap is purely a resolution change: no layout, no
 * animation restart. If the final has not decoded by the landing, the flight keeps the card's
 * frame and the handoff shows the detail as usual.
 */

const FINAL_SELECTOR = 'img.image-detail-final';

function isDetailFinalOf(node: EventTarget | null, imageId: number): node is HTMLImageElement {
  if (!(node instanceof HTMLImageElement) || !node.classList.contains('image-detail-final')) {
    return false;
  }
  const owner = node.closest('[data-image-hero-role="detail"]');
  return owner?.getAttribute('data-image-hero-id') === String(imageId);
}

/**
 * Watch for the detail's final bitmap of `imageId` while `canvas` is flying, and repaint it in place.
 * Returns the disposer; hand it to the session's visual lease so it ends with the flyer.
 *
 * Stills only: an animated source decodes at frame 0, and repainting a GIF mid-flight would
 * jump frames — those keep the frame the user pressed.
 */
export function watchImageHeroFlightUpgrade(canvas: HTMLCanvasElement, imageId: number): () => void {
  if (typeof document === 'undefined') return () => {};
  let disposed = false;

  const upgrade = (media: HTMLImageElement) => {
    if (disposed || !canvas.isConnected) return;
    if (isVolatileVisualMedia(media) || isAnimatedVisualSource(media.currentSrc || media.src)) return;
    repaintHeroFrame(canvas, media);
  };

  /* `load` is not `decoded`: a `drawImage` of a loaded-but-undecoded 1280px JPEG decodes it
     synchronously on the main thread, mid-flight. `decode()` moves that off the frame. */
  const decodeThenUpgrade = (media: HTMLImageElement) => {
    void media.decode().then(
      () => upgrade(media),
      () => {
        /* A broken or replaced source: the flight keeps what it has. */
      },
    );
  };

  /* `load` does not bubble, so capture on the document; the final layer mounts inside the
     route tree, which may not exist yet when the flight launches. */
  const onLoad = (event: Event) => {
    if (isDetailFinalOf(event.target, imageId)) decodeThenUpgrade(event.target);
  };
  document.addEventListener('load', onLoad, true);

  document
    .querySelectorAll<HTMLImageElement>(
      `[data-image-hero-role="detail"][data-image-hero-id="${imageId}"] ${FINAL_SELECTOR}`,
    )
    .forEach((media) => {
      if (media.complete && media.naturalWidth > 0) decodeThenUpgrade(media);
    });

  return () => {
    disposed = true;
    document.removeEventListener('load', onLoad, true);
  };
}
