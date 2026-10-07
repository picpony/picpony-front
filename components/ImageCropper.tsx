'use client';

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { MdRotateRight, MdZoomIn, MdZoomOut, MdRestartAlt } from 'react-icons/md';
import Modal from '@/components/Modal';
import Button from '@/components/Button';
import IconButton from '@/components/IconButton';
import Slider from '@/components/Slider';
import Spinner from '@/components/Spinner';
import ErrorRetry from '@/components/ErrorRetry';
import { showToast } from '@/components/Toast';
import { apiErrorMessage } from '@/lib/api/errors';
import { ICON } from '@/lib/icons';
import { clamp } from '@/lib/utils';

export type CropShape = 'circle' | 'rect';

interface ImageCropperProps {
  /** The picked file. The modal is driven by this being non-null. */
  file: File | null;
  onClose: () => void;
  onCropped: (blob: Blob) => void | Promise<void>;
  /** Crop window aspect ratio, width / height. */
  aspect: number;
  shape?: CropShape;
  /** Exported pixel size. Height is derived from `aspect` when omitted. */
  outputWidth: number;
  outputHeight?: number;
  title?: string;
  /** Shows a spinner on the confirm button while the caller uploads. */
  busy?: boolean;
}

const MAX_ZOOM = 4;
const ZOOM_STEP = 0.2;
/**
 * Wheel zoom is proportional to the distance scrolled, not a fixed step per event: a mouse
 * notch (about 100px) is roughly one button step, and a trackpad's stream of small deltas
 * glides instead of slamming to the limit in one swipe — twelve 3px ticks used to add 2.4.
 * A trackpad pinch arrives as wheel events with `ctrlKey` and much smaller deltas.
 */
const WHEEL_ZOOM_RATE = 0.002;
const PINCH_WHEEL_ZOOM_RATE = 0.01;
/** Arrow-key pan, in CSS pixels; Shift moves five times as far. */
const KEY_PAN = 10;
/** JPEG fallback quality. WebP is tried first and is ~30% smaller at parity. */
const QUALITY = 0.9;

interface View {
  zoom: number;
  x: number;
  y: number;
  rotation: number;
}

/** A point on the stage, relative to the crop window's centre (the geometry's origin). */
interface Point {
  x: number;
  y: number;
}

const INITIAL: View = { zoom: 1, x: 0, y: 0, rotation: 0 };

/**
 * Avatar / banner cropper.
 *
 * Geometry model, in CSS pixels relative to the centre of the crop window:
 *
 *     screen = translate(x, y) · rotate(rotation) · scale(S) · imagePoint
 *
 * with `S = base · zoom`, `base` the scale at which the (possibly rotated) image
 * exactly covers the window. `zoom >= 1` therefore guarantees the window is
 * always full, and the pan clamp is just "don't drag an edge inside the window".
 * Export replays the same matrix onto a canvas — what is drawn is what is saved.
 *
 * Pointer handling is hand-rolled rather than GSAP Draggable: the bounds are a
 * function of zoom and rotation and change on every wheel tick, and pinch needs
 * two-pointer tracking. Zoom is anchored where it is asked for — under the cursor for
 * the wheel, between the fingers for a pinch — so the point being looked at stays put;
 * zooming about the window's centre pushed it out of view.
 *
 * **What is on screen outlives the file.** Closing clears `file` at the start of the
 * dialog's exit, and the picture used to go with it: every exit frame showed the
 * loading spinner where the image had been, including after each successful upload.
 * The last file (and its object URL) is kept until the dialog has finished leaving.
 */
export default function ImageCropper({
  file,
  onClose,
  onCropped,
  aspect,
  shape = 'rect',
  outputWidth,
  outputHeight,
  title = '调整图片',
  busy = false,
}: ImageCropperProps) {
  const [natural, setNatural] = useState<{ w: number; h: number } | null>(null);
  const [view, setView] = useState<View>(INITIAL);
  const [exporting, setExporting] = useState(false);
  const [imageError, setImageError] = useState(false);
  /* The file being shown: `file` while open, and the last one through the exit. A new file
     is a new subject, so the framing is dropped with it — adjusted during render, the
     supported way to reset on a prop change (an effect would paint one frame of the
     previous image's zoom). */
  const [shownFile, setShownFile] = useState(file);
  if (file && file !== shownFile) {
    setShownFile(file);
    setView(INITIAL);
    setNatural(null);
    setImageError(false);
  }
  const latestFile = useRef(file);
  useLayoutEffect(() => {
    latestFile.current = file;
  });

  // Callback ref, not `useRef`: the stage is rendered through Modal's portal,
  // which mounts a tick after `file` is set. A plain ref meant the measuring
  // effect ran before the node existed and never re-ran. Holding the node in
  // state re-runs both effects the moment it attaches.
  const [stage, setStage] = useState<HTMLDivElement | null>(null);
  const imgRef = useRef<HTMLImageElement>(null);
  const [cropBox, setCropBox] = useState({ w: 0, h: 0 });

  // Live pointer bookkeeping. Refs, not state: these change per pointermove and
  // must not each schedule a render.
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const panFrom = useRef<{ px: number; py: number; x: number; y: number } | null>(null);
  const pinchFrom = useRef<{ dist: number; zoom: number; mid: Point; x: number; y: number } | null>(null);

  const outH = outputHeight ?? Math.round(outputWidth / aspect);

  /* ---- source ---------------------------------------------------------- */
  /* The object URL lives exactly as long as the file on screen: made when a file arrives,
     revoked when it is replaced or the cropper goes. Made in an effect, not during render —
     a render can run twice (and does, in development), and a URL made there leaks. It is
     handed to state a microtask later, the effect body itself setting none; a URL for a
     file that has already been replaced is never used (`src` checks whose it is). */
  const [source, setSource] = useState<{ file: File; url: string } | null>(null);
  useEffect(() => {
    if (!shownFile) return;
    const url = URL.createObjectURL(shownFile);
    queueMicrotask(() => setSource({ file: shownFile, url }));
    return () => URL.revokeObjectURL(url);
  }, [shownFile]);
  const src = source && source.file === shownFile ? source.url : null;

  /* ---- crop window size ------------------------------------------------ */
  useEffect(() => {
    if (!stage || !src) return;
    const measure = () => {
      const { width, height } = stage.getBoundingClientRect();
      // Largest box of `aspect` that fits the stage, with a little breathing
      // room so the dimmed surround is visible on every side.
      const pad = 24;
      const availW = Math.max(0, width - pad * 2);
      const availH = Math.max(0, height - pad * 2);
      const w = Math.min(availW, availH * aspect);
      setCropBox({ w, h: w / aspect });
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(stage);
    return () => ro.disconnect();
  }, [stage, src, aspect]);

  /* ---- geometry -------------------------------------------------------- */
  const quarterTurned = view.rotation % 180 !== 0;
  const effW = natural ? (quarterTurned ? natural.h : natural.w) : 0;
  const effH = natural ? (quarterTurned ? natural.w : natural.h) : 0;
  const base = effW && effH && cropBox.w ? Math.max(cropBox.w / effW, cropBox.h / effH) : 1;

  const constrainView = useCallback(
    (next: View): View => {
      if (!effW || !effH || !cropBox.w) return next;
      const turned = next.rotation % 180 !== 0;
      const w = (turned ? natural!.h : natural!.w) * base * next.zoom;
      const h = (turned ? natural!.w : natural!.h) * base * next.zoom;
      const maxX = Math.max(0, (w - cropBox.w) / 2);
      const maxY = Math.max(0, (h - cropBox.h) / 2);
      return {
        ...next,
        x: clamp(next.x, -maxX, maxX),
        y: clamp(next.y, -maxY, maxY),
      };
    },
    [effW, effH, cropBox.w, cropBox.h, base, natural],
  );

  // Rotation changes `base`, so a pan that was legal a moment ago may not be.
  // Clamping on read rather than in an effect means the displayed value is
  // always in range without a reconciliation pass that could paint out of it.
  const v = constrainView(view);
  const scale = base * v.zoom;

  /**
   * Zoom to `next(zoom)`, keeping the picture point under `anchor` where it is. With
   * `screen = t + S·R·p`, holding `p` under `anchor` while `S` becomes `S·ratio` needs
   * `t' = anchor − ratio·(anchor − t)`; no anchor zooms about the window's centre.
   */
  const zoomAt = useCallback(
    (next: (zoom: number) => number, anchor?: Point) => {
      setView((prev) => {
        const from = constrainView(prev);
        const zoom = clamp(next(from.zoom), 1, MAX_ZOOM);
        if (!anchor || zoom === from.zoom) return constrainView({ ...from, zoom });
        const ratio = zoom / from.zoom;
        return constrainView({
          ...from,
          zoom,
          x: anchor.x - (anchor.x - from.x) * ratio,
          y: anchor.y - (anchor.y - from.y) * ratio,
        });
      });
    },
    [constrainView],
  );

  const nudgeZoom = useCallback(
    (delta: number) => zoomAt((zoom) => zoom + delta),
    [zoomAt],
  );

  /** A client position as a point relative to the crop window's centre. */
  const toStagePoint = useCallback(
    (clientX: number, clientY: number): Point => {
      const rect = stage?.getBoundingClientRect();
      if (!rect) return { x: 0, y: 0 };
      return { x: clientX - rect.left - rect.width / 2, y: clientY - rect.top - rect.height / 2 };
    },
    [stage],
  );

  /* ---- pointer: pan + pinch -------------------------------------------- */
  const onPointerDown = (e: React.PointerEvent) => {
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.current.size === 1) {
      panFrom.current = { px: e.clientX, py: e.clientY, x: v.x, y: v.y };
    } else if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      pinchFrom.current = {
        dist: Math.hypot(a.x - b.x, a.y - b.y),
        zoom: v.zoom,
        mid: toStagePoint((a.x + b.x) / 2, (a.y + b.y) / 2),
        x: v.x,
        y: v.y,
      };
      panFrom.current = null;
    }
  };

  const onPointerMove = (e: React.PointerEvent) => {
    if (!pointers.current.has(e.pointerId)) return;
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });

    if (pointers.current.size >= 2 && pinchFrom.current) {
      const [a, b] = [...pointers.current.values()];
      const start = pinchFrom.current;
      const dist = Math.hypot(a.x - b.x, a.y - b.y);
      const zoom = clamp(start.zoom * (start.dist > 0 ? dist / start.dist : 1), 1, MAX_ZOOM);
      const ratio = zoom / start.zoom;
      /* The point that was between the fingers stays between them — wherever they have
         moved to, so a pinch can pan as it zooms. */
      const mid = toStagePoint((a.x + b.x) / 2, (a.y + b.y) / 2);
      setView((prev) =>
        constrainView({
          ...prev,
          zoom,
          x: mid.x - (start.mid.x - start.x) * ratio,
          y: mid.y - (start.mid.y - start.y) * ratio,
        }),
      );
      return;
    }

    const from = panFrom.current;
    if (!from) return;
    setView((prev) =>
      constrainView({ ...prev, x: from.x + (e.clientX - from.px), y: from.y + (e.clientY - from.py) }),
    );
  };

  const onPointerUp = (e: React.PointerEvent) => {
    pointers.current.delete(e.pointerId);
    if (pointers.current.size < 2) pinchFrom.current = null;
    if (pointers.current.size === 1) {
      // Lifting one finger of a pinch must re-seat the pan origin, or the image
      // jumps by however far that finger had travelled.
      const [only] = [...pointers.current.values()];
      panFrom.current = { px: only.x, py: only.y, x: v.x, y: v.y };
    } else if (pointers.current.size === 0) {
      panFrom.current = null;
    }
  };

  // Non-passive so the page behind the modal doesn't scroll while zooming.
  useEffect(() => {
    if (!stage || !src) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? stage.clientHeight : 1;
      const rate = e.ctrlKey ? PINCH_WHEEL_ZOOM_RATE : WHEEL_ZOOM_RATE;
      zoomAt((zoom) => zoom * Math.exp(-e.deltaY * unit * rate), toStagePoint(e.clientX, e.clientY));
    };
    stage.addEventListener('wheel', onWheel, { passive: false });
    return () => stage.removeEventListener('wheel', onWheel);
  }, [stage, src, zoomAt, toStagePoint]);

  /* The keyboard's way to frame the picture: arrows pan it, + and − zoom. The window stays
     still and the picture moves, as with a drag — an arrow moves the picture that way. */
  const onStageKeyDown = (e: React.KeyboardEvent) => {
    const step = e.shiftKey ? KEY_PAN * 5 : KEY_PAN;
    const pan: Record<string, Point> = {
      ArrowLeft: { x: -step, y: 0 },
      ArrowRight: { x: step, y: 0 },
      ArrowUp: { x: 0, y: -step },
      ArrowDown: { x: 0, y: step },
    };
    if (pan[e.key]) {
      e.preventDefault();
      const { x, y } = pan[e.key]!;
      setView((prev) => {
        const from = constrainView(prev);
        return constrainView({ ...from, x: from.x + x, y: from.y + y });
      });
    } else if (e.key === '+' || e.key === '=') {
      e.preventDefault();
      nudgeZoom(ZOOM_STEP);
    } else if (e.key === '-' || e.key === '_') {
      e.preventDefault();
      nudgeZoom(-ZOOM_STEP);
    }
  };

  /* ---- export ---------------------------------------------------------- */
  const confirm = async () => {
    const img = imgRef.current;
    if (!img || !natural || !cropBox.w || imageError || exporting || busy) return;
    setExporting(true);
    try {
      const canvas = document.createElement('canvas');
      canvas.width = outputWidth;
      canvas.height = outH;
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('浏览器无法处理此图片');

      ctx.imageSmoothingQuality = 'high';
      // Same matrix as the preview, expressed from the crop window's centre.
      const k = outputWidth / cropBox.w;
      ctx.translate(outputWidth / 2, outH / 2);
      ctx.scale(k, k);
      ctx.translate(v.x, v.y);
      ctx.rotate((v.rotation * Math.PI) / 180);
      ctx.scale(scale, scale);
      ctx.drawImage(img, -natural.w / 2, -natural.h / 2, natural.w, natural.h);

      const blob = await new Promise<Blob | null>((resolve) =>
        canvas.toBlob(resolve, 'image/webp', QUALITY),
      ).then(
        (b) =>
          b ?? new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', QUALITY)),
      );

      if (!blob) throw new Error('导出失败');
      await onCropped(blob);
    } catch (err) {
      showToast(apiErrorMessage(err, '裁剪失败'), 'error');
    } finally {
      setExporting(false);
    }
  };

  const ready = Boolean(src && natural && cropBox.w > 0 && !imageError);
  const working = exporting || busy;

  return (
    <Modal
      isOpen={Boolean(file)}
      onClose={working ? () => {} : onClose}
      title={title}
      maxWidth="2xl"
      bodyClassName="p-0"
      closeOnOverlayClick={!working}
      closeOnEscape={!working}
      // The picture has gone with the dialog; its URL can go too (unless a new file arrived).
      onExited={() => {
        if (!latestFile.current) setShownFile(null);
      }}
      footer={
        <>
          <Button variant="text" onClick={onClose} disabled={working}>
            取消
          </Button>
          {/* One label throughout: busy is the spinner inside the same footprint. */}
          <Button variant="filled" onClick={confirm} disabled={!ready} loading={working}>
            确认
          </Button>
        </>
      }
    >
      <div
        ref={setStage}
        role="application"
        aria-roledescription="裁剪区域"
        aria-label="拖动或用方向键移动图片，滚轮、双指或加减键缩放"
        tabIndex={ready ? 0 : -1}
        onKeyDown={ready ? onStageKeyDown : undefined}
        onPointerDown={ready ? onPointerDown : undefined}
        onPointerMove={ready ? onPointerMove : undefined}
        onPointerUp={ready ? onPointerUp : undefined}
        onPointerCancel={ready ? onPointerUp : undefined}
        /* The stage is a photograph's plate and clips its content, so its focus ring is
           drawn inward, in the media ring. */
        className="relative h-[46vh] min-h-[260px] touch-none overflow-hidden bg-media-stage select-none focus-visible:outline-hidden focus-visible:inset-ring-2 focus-visible:focus-ring-on-media"
        style={{ cursor: ready ? 'grab' : 'default' }}
      >
        {src && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            ref={imgRef}
            src={src}
            alt=""
            draggable={false}
            onLoad={(e) => {
              const { naturalWidth, naturalHeight } = e.currentTarget;
              if (!naturalWidth || !naturalHeight) {
                setImageError(true);
                return;
              }
              setNatural({ w: naturalWidth, h: naturalHeight });
            }}
            onError={() => setImageError(true)}
            className="pointer-events-none absolute top-1/2 left-1/2 max-w-none origin-center"
            style={{
              width: natural?.w,
              height: natural?.h,
              transform: `translate(-50%, -50%) translate(${v.x}px, ${v.y}px) rotate(${v.rotation}deg) scale(${scale})`,
              visibility: ready ? 'visible' : 'hidden',
            }}
          />
        )}

        {imageError ? (
          <div className="absolute inset-0 grid place-items-center bg-surface-container-low">
            <ErrorRetry size="inline" title="图片无法读取，请选择其他图片" onRetry={onClose} retryLabel="重新选择" />
          </div>
        ) : !ready && (
          <div className="text-on-media absolute inset-0 grid place-items-center">
            <Spinner size="lg" tone="inherit" />
          </div>
        )}

        {/* Mask. One element with a huge spread shadow rather than four dimming
            panels — it stays exact at any crop size and follows the radius. */}
        {ready && (
          <div
            aria-hidden="true"
            className="pointer-events-none absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 shadow-[0_0_0_9999px_var(--md-sys-color-crop-mask)]"
            style={{
              width: cropBox.w,
              height: cropBox.h,
              borderRadius: shape === 'circle' ? '9999px' : 12,
            }}
          >
            <div
              className="border-on-media-variant absolute inset-0 border"
              style={{ borderRadius: shape === 'circle' ? '9999px' : 12 }}
            />
            {/* Rule of thirds, rectangles only — on a circle the lines read as
                clutter rather than as guides. */}
            {shape === 'rect' && (
              <>
                <div className="absolute inset-y-0 left-1/3 w-px bg-media-outline" />
                <div className="absolute inset-y-0 left-2/3 w-px bg-media-outline" />
                <div className="absolute inset-x-0 top-1/3 h-px bg-media-outline" />
                <div className="absolute inset-x-0 top-2/3 h-px bg-media-outline" />
              </>
            )}
          </div>
        )}
      </div>

      <div className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center">
        <div className="flex items-center gap-2">
          {/* `IconButton`, not a hand-rolled box: a padding-sized box changes
              the control's size whenever the glyph changes. */}
          <IconButton
            onClick={() => nudgeZoom(-ZOOM_STEP)}
            disabled={!ready || v.zoom <= 1}
            aria-label="缩小"
            icon={<MdZoomOut size={ICON.control} />}
          />
          {/* `Slider`, the primitive — not a global class remembered at each
              call site, which left the two range inputs without a focus ring. */}
          <Slider
            min={1}
            max={MAX_ZOOM}
            step={0.01}
            value={v.zoom}
            disabled={!ready}
            aria-label="缩放"
            valueText={(z) => `缩放 ${z.toFixed(2)} 倍`}
            onValueChange={(zoom) => setView((prev) => constrainView({ ...prev, zoom }))}
            className="min-w-32 flex-1 sm:w-40"
          />
          <IconButton
            onClick={() => nudgeZoom(ZOOM_STEP)}
            disabled={!ready || v.zoom >= MAX_ZOOM}
            aria-label="放大"
            icon={<MdZoomIn size={ICON.control} />}
          />
        </div>

        <div className="flex items-center gap-2 sm:ml-auto">
          <Button
            variant="text"
            size="xs"
            icon={<MdRotateRight />}
            disabled={!ready}
            onClick={() =>
              setView((prev) => constrainView({ ...prev, rotation: (prev.rotation + 90) % 360 }))
            }
          >
            旋转
          </Button>
          <Button
            variant="text"
            size="xs"
            icon={<MdRestartAlt />}
            disabled={!ready}
            onClick={() => setView(INITIAL)}
          >
            重置
          </Button>
        </div>
      </div>
    </Modal>
  );
}
