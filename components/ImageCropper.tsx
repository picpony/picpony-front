'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { MdRotateRight, MdZoomIn, MdZoomOut, MdRestartAlt } from 'react-icons/md';
import Modal from '@/components/Modal';
import Button from '@/components/Button';
import IconButton from '@/components/IconButton';
import Slider from '@/components/Slider';
import Spinner from '@/components/Spinner';
import { showToast } from '@/components/Toast';
import { ICON } from '@/lib/icons';

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
/** JPEG fallback quality. WebP is tried first and is ~30% smaller at parity. */
const QUALITY = 0.9;

interface View {
  zoom: number;
  x: number;
  y: number;
  rotation: number;
}

const INITIAL: View = { zoom: 1, x: 0, y: 0, rotation: 0 };

/**
 * Avatar / banner cropper.
 *
 * Uploading a profile image used to be: hidden `<input type=file>` → OS picker
 * → straight to the server. No preview, no framing, no size control — the crop
 * was whatever `object-fit: cover` happened to do afterwards, so a portrait
 * photo became a picture of somebody's chin.
 *
 * Geometry model, in CSS pixels relative to the centre of the crop window:
 *
 *     screen = translate(x, y) · rotate(rotation) · scale(S) · imagePoint
 *
 * with `S = base · zoom`, and `base` the scale at which the (possibly rotated)
 * image exactly covers the window. `zoom >= 1` therefore guarantees the window
 * is always full, and the pan clamp below is just "don't drag an edge inside
 * the window". Export replays the same matrix onto a canvas, so what is drawn
 * is what is saved — there is no second, subtly different code path.
 *
 * Pointer handling is hand-rolled rather than GSAP Draggable: the bounds are a
 * function of zoom and rotation and change on every wheel tick, and pinch needs
 * two-pointer tracking that Draggable does not model. The clamp is four lines;
 * keeping it explicit is smaller than reconfiguring a plugin around it.
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

  // Callback ref, not `useRef`: the stage is rendered through Modal's portal,
  // which mounts a tick after `file` is set. A plain ref meant the measuring
  // effect below ran before the node existed, returned early, and never re-ran
  // — cropBox stayed at 0, `ready` stayed false, and the spinner never left.
  // Holding the node in state re-runs both effects the moment it attaches.
  const [stage, setStage] = useState<HTMLDivElement | null>(null);
  const imgRef = useRef<HTMLImageElement>(null);
  const [cropBox, setCropBox] = useState({ w: 0, h: 0 });

  // Live pointer bookkeeping. Refs, not state: these change per pointermove and
  // must not each schedule a render.
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const panFrom = useRef<{ px: number; py: number; x: number; y: number } | null>(null);
  const pinchFrom = useRef<{ dist: number; zoom: number } | null>(null);

  const outH = outputHeight ?? Math.round(outputWidth / aspect);

  /* ---- source ---------------------------------------------------------- */
  // Derived, not synced through an effect, so `src` is never briefly stale
  // against `file`. The URL is revoked by the effect below once it is replaced.
  const src = useMemo(() => (file ? URL.createObjectURL(file) : null), [file]);
  useEffect(() => {
    if (!src) return;
    return () => URL.revokeObjectURL(src);
  }, [src]);

  // A new file is a new subject: drop the old framing. Adjusting state during
  // render is the supported way to reset on a prop change — an effect here
  // would render one frame with the previous image's zoom applied.
  const [lastFile, setLastFile] = useState(file);
  if (file !== lastFile) {
    setLastFile(file);
    setView(INITIAL);
    setNatural(null);
  }

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

  const clamp = useCallback(
    (next: View): View => {
      if (!effW || !effH || !cropBox.w) return next;
      const turned = next.rotation % 180 !== 0;
      const w = (turned ? natural!.h : natural!.w) * base * next.zoom;
      const h = (turned ? natural!.w : natural!.h) * base * next.zoom;
      const maxX = Math.max(0, (w - cropBox.w) / 2);
      const maxY = Math.max(0, (h - cropBox.h) / 2);
      return {
        ...next,
        x: Math.min(maxX, Math.max(-maxX, next.x)),
        y: Math.min(maxY, Math.max(-maxY, next.y)),
      };
    },
    [effW, effH, cropBox.w, cropBox.h, base, natural],
  );

  // Rotation changes `base`, so a pan that was legal a moment ago may not be.
  // Clamping on read rather than in an effect means the displayed value is
  // always in range without a reconciliation pass that could paint out of it.
  const v = clamp(view);
  const scale = base * v.zoom;

  const nudgeZoom = (delta: number) =>
    setView((prev) => clamp({ ...prev, zoom: Math.min(MAX_ZOOM, Math.max(1, prev.zoom + delta)) }));

  /* ---- pointer: pan + pinch -------------------------------------------- */
  const onPointerDown = (e: React.PointerEvent) => {
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.current.size === 1) {
      panFrom.current = { px: e.clientX, py: e.clientY, x: v.x, y: v.y };
    } else if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      pinchFrom.current = { dist: Math.hypot(a.x - b.x, a.y - b.y), zoom: v.zoom };
      panFrom.current = null;
    }
  };

  const onPointerMove = (e: React.PointerEvent) => {
    if (!pointers.current.has(e.pointerId)) return;
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });

    if (pointers.current.size >= 2 && pinchFrom.current) {
      const [a, b] = [...pointers.current.values()];
      const dist = Math.hypot(a.x - b.x, a.y - b.y);
      const ratio = pinchFrom.current.dist > 0 ? dist / pinchFrom.current.dist : 1;
      setView((prev) =>
        clamp({
          ...prev,
          zoom: Math.min(MAX_ZOOM, Math.max(1, pinchFrom.current!.zoom * ratio)),
        }),
      );
      return;
    }

    const from = panFrom.current;
    if (!from) return;
    setView((prev) =>
      clamp({ ...prev, x: from.x + (e.clientX - from.px), y: from.y + (e.clientY - from.py) }),
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
      nudgeZoom(e.deltaY < 0 ? ZOOM_STEP : -ZOOM_STEP);
    };
    stage.addEventListener('wheel', onWheel, { passive: false });
    return () => stage.removeEventListener('wheel', onWheel);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stage, src, clamp]);

  /* ---- export ---------------------------------------------------------- */
  const confirm = async () => {
    const img = imgRef.current;
    if (!img || !natural || !cropBox.w) return;
    setExporting(true);
    try {
      const canvas = document.createElement('canvas');
      canvas.width = outputWidth;
      canvas.height = outH;
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('canvas unavailable');

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
      showToast(err instanceof Error ? err.message : '裁剪失败', 'error');
    } finally {
      setExporting(false);
    }
  };

  const ready = Boolean(src && natural && cropBox.w > 0);
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
      footer={
        <>
          <Button variant="text" onClick={onClose} disabled={working}>
            取消
          </Button>
          <Button variant="filled" onClick={confirm} disabled={!ready || working}>
            {working ? <Spinner size="sm" tone="on-primary" /> : null}
            {working ? '处理中…' : '确认'}
          </Button>
        </>
      }
    >
      <div
        ref={setStage}
        onPointerDown={ready ? onPointerDown : undefined}
        onPointerMove={ready ? onPointerMove : undefined}
        onPointerUp={ready ? onPointerUp : undefined}
        onPointerCancel={ready ? onPointerUp : undefined}
        className="relative h-[46vh] min-h-[260px] touch-none overflow-hidden bg-media-stage select-none"
        style={{ cursor: ready ? 'grab' : 'default' }}
      >
        {src && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            ref={imgRef}
            src={src}
            alt=""
            draggable={false}
            onLoad={(e) =>
              setNatural({
                w: e.currentTarget.naturalWidth,
                h: e.currentTarget.naturalHeight,
              })
            }
            className="pointer-events-none absolute top-1/2 left-1/2 max-w-none origin-center"
            style={{
              width: natural?.w,
              height: natural?.h,
              transform: `translate(-50%, -50%) translate(${v.x}px, ${v.y}px) rotate(${v.rotation}deg) scale(${scale})`,
              visibility: ready ? 'visible' : 'hidden',
            }}
          />
        )}

        {!ready && (
          <div className="absolute inset-0 grid place-items-center">
            <Spinner size="lg" tone="on-primary" />
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
          {/* `IconButton`, not a hand-rolled `state-layer rounded-full p-2`.
              These two were the last icon buttons in the app spelling out their
              own box — and a `p-2` box is only 36dp because a 20px glyph happens
              to be inside it, so changing the glyph would have changed the
              control's size. */}
          <IconButton
            onClick={() => nudgeZoom(-ZOOM_STEP)}
            disabled={!ready || v.zoom <= 1}
            aria-label="缩小"
            icon={<MdZoomOut size={ICON.control} />}
          />
          {/* `Slider`, the primitive. This and the image-search dialog's were the
              app's two range inputs and they shared a global class rather than a
              component, so the class had to be remembered at each call site and
              neither one got a focus ring. */}
          <Slider
            min={1}
            max={MAX_ZOOM}
            step={0.01}
            value={v.zoom}
            disabled={!ready}
            aria-label="缩放"
            valueText={(z) => `缩放 ${z.toFixed(2)} 倍`}
            onValueChange={(zoom) => setView((prev) => clamp({ ...prev, zoom }))}
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
            icon={<MdRotateRight size={ICON.dense} />}
            disabled={!ready}
            onClick={() =>
              setView((prev) => clamp({ ...prev, rotation: (prev.rotation + 90) % 360 }))
            }
          >
            旋转
          </Button>
          <Button
            variant="text"
            size="xs"
            icon={<MdRestartAlt size={ICON.dense} />}
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
