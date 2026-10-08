'use client';

import { PICPONY_API_ORIGIN } from '@/lib/constants';
import { uploadForumImage } from '@/lib/api/forum';
import { apiErrorMessage, isAborted } from '@/lib/api/errors';

/**
 * A picture for the forum — in a post, in a reply, as a cover — made fit to upload, then
 * uploaded. The limits and the compression are the original front end's (`uploadForumImageFile`
 * / `compressImageIfNeeded`): the backend takes 5MB, so a larger photo is redrawn at most 2048px
 * on its long edge and re-encoded, stepping the quality down until it fits; a GIF is never
 * redrawn, because a canvas keeps only its first frame.
 */

/** The largest file `upload_forum_image` accepts. */
export const FORUM_IMAGE_MAX_BYTES = 5 * 1024 * 1024;
/** The largest original the browser is asked to shrink. */
const MAX_SOURCE_BYTES = 50 * 1024 * 1024;
/** The long edge a shrunken picture is drawn at. */
const MAX_EDGE = 2048;

function canvasBlob(canvas: HTMLCanvasElement, type: string, quality: number): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, type, quality));
}

/** The formats whose pictures can be transparent, and so are tried as PNG before JPEG. */
const MAY_BE_TRANSPARENT = new Set(['image/png', 'image/webp']);
/** The JPEG qualities tried, best first; the last is taken whatever it weighs. */
const JPEG_QUALITIES = [0.9, 0.75, 0.6, 0.45, 0.3];

/** What `encodeWithinLimit` draws with — a canvas, or a stand-in in the tests. */
export interface PictureEncoder {
  encode(type: 'image/png' | 'image/jpeg', quality: number): Promise<Blob | null>;
  /** Lay the picture over an opaque white ground, so a JPEG keeps what was transparent white. */
  flatten(): void;
}

/**
 * Encode a redrawn picture to fit `FORUM_IMAGE_MAX_BYTES`. A picture that may be transparent is
 * tried as a PNG first and kept as one when that fits; otherwise it becomes a JPEG, laid over white
 * first, whose quality steps down until it fits (the last step is taken as it is). `null` when the
 * engine cannot encode.
 *
 * Review P4-F4: the PNG branch was keyed on the *original's* size being within the limit — but only
 * an original over the limit is ever redrawn, so every PNG became a JPEG, and a canvas encodes
 * transparent pixels as black in a JPEG: a sticker or a cut-out came back on a black square.
 */
export async function encodeWithinLimit(
  encoder: PictureEncoder,
  sourceType: string,
): Promise<{ blob: Blob; type: 'image/png' | 'image/jpeg' } | null> {
  if (MAY_BE_TRANSPARENT.has(sourceType)) {
    const png = await encoder.encode('image/png', 1);
    if (png && png.size <= FORUM_IMAGE_MAX_BYTES) return { blob: png, type: 'image/png' };
  }
  encoder.flatten();
  for (let step = 0; step < JPEG_QUALITIES.length; step += 1) {
    const blob = await encoder.encode('image/jpeg', JPEG_QUALITIES[step]);
    if (!blob) return null;
    if (blob.size <= FORUM_IMAGE_MAX_BYTES || step === JPEG_QUALITIES.length - 1) return { blob, type: 'image/jpeg' };
  }
  return null;
}

/** Redraws `file` at most `MAX_EDGE` on its long edge and re-encodes it until it fits. */
async function shrink(file: File): Promise<File> {
  const bitmap = await createImageBitmap(file);
  try {
    const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const context = canvas.getContext('2d');
    if (!context) return file;
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = 'high';
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const encoded = await encodeWithinLimit(
      {
        encode: (type, quality) => canvasBlob(canvas, type, quality),
        flatten: () => {
          context.globalCompositeOperation = 'destination-over';
          context.fillStyle = '#ffffff';
          context.fillRect(0, 0, canvas.width, canvas.height);
          context.globalCompositeOperation = 'source-over';
        },
      },
      file.type,
    );
    if (!encoded) return file;
    const name = `${(file.name || 'image').replace(/\.[^/.]+$/, '')}${encoded.type === 'image/png' ? '.png' : '.jpg'}`;
    return new File([encoded.blob], name, { type: encoded.type, lastModified: Date.now() });
  } finally {
    bitmap.close();
  }
}

/**
 * Checks and, if it must, shrinks a picture before upload. Throws an `Error` whose message is the
 * sentence to show (`apiErrorMessage` passes a Chinese message through).
 */
export async function prepareForumImage(file: File): Promise<File> {
  if (!file.type.startsWith('image/')) throw new Error('请选择图片文件');
  if (file.size > MAX_SOURCE_BYTES) throw new Error('原图不能超过 50MB');
  if (file.type === 'image/gif') {
    if (file.size > FORUM_IMAGE_MAX_BYTES) throw new Error('动图超过 5MB，压缩会丢失动画，请缩小后再上传');
    return file;
  }
  if (file.size <= FORUM_IMAGE_MAX_BYTES) return file;
  let shrunk: File;
  try {
    shrunk = await shrink(file);
  } catch {
    /* A format the browser cannot decode (HEIC on most desktops): nothing to redraw. */
    throw new Error('图片超过 5MB，且无法在浏览器中压缩，请缩小后再上传');
  }
  if (shrunk.size > FORUM_IMAGE_MAX_BYTES) throw new Error('图片压缩后仍超过 5MB，请降低分辨率后再试');
  return shrunk;
}

export type ForumUploadOutcome = { ok: true; path: string } | { ok: false; message: string; aborted: boolean };

/**
 * Prepares and uploads one picture; resolves with the path the backend stored it at (what a post
 * lists in `draft_images`) or with the sentence to show. Never throws — callers are components,
 * and a component with a `try`/`finally` is one the React Compiler leaves alone.
 */
export async function uploadForumPicture(
  token: string,
  file: File,
  options: { signal?: AbortSignal; onProgress?: (fraction: number) => void } = {},
): Promise<ForumUploadOutcome> {
  try {
    const prepared = await prepareForumImage(file);
    if (options.signal?.aborted) return { ok: false, message: '上传已取消', aborted: true };
    const path = await uploadForumImage(token, prepared, options);
    return { ok: true, path };
  } catch (error) {
    return { ok: false, message: apiErrorMessage(error, '图片上传失败'), aborted: isAborted(error) };
  }
}

/**
 * A PicPony asset URL as the backend stores it — `/uploads/…` rather than the absolute address the
 * editor shows. A post's cover is read that way by the original front end too (one of its screens
 * prefixes the origin), so a first-picture cover taken from the body goes back to the stored form.
 */
export function storedAssetPath(url: string): string {
  const origin = `${PICPONY_API_ORIGIN}/`;
  return url.startsWith(origin) ? `/${url.slice(origin.length)}` : url;
}
