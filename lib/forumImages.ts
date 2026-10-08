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
    /* A PNG small enough to stay lossless stays PNG (its transparency with it); anything else
       becomes a JPEG, whose quality is the lever. */
    const type = file.type === 'image/png' && file.size <= FORUM_IMAGE_MAX_BYTES ? 'image/png' : 'image/jpeg';
    for (let quality = 0.9; ; quality -= 0.15) {
      const blob = await canvasBlob(canvas, type, quality);
      if (!blob) return file;
      if (blob.size <= FORUM_IMAGE_MAX_BYTES || quality <= 0.35) {
        const name = `${(file.name || 'image').replace(/\.[^/.]+$/, '')}${type === 'image/png' ? '.png' : '.jpg'}`;
        return new File([blob], name, { type, lastModified: Date.now() });
      }
    }
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
