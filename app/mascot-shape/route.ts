import type { NextRequest } from 'next/server';
import { PICPONY_API_ORIGIN } from '@/lib/constants';
import { createServerMemo } from '@/lib/serverMemo';
import { MASCOT_SHAPE_GRID, shapeRows, type MascotShape } from '@/lib/mascot/shapeModel';

/**
 * The mascot's silhouette, read from its artwork's alpha: a coarse grid's rows with the runs where
 * the character is (`lib/mascot/shapeModel.ts`). The figure makes it its hit region — only the
 * character answers a pointer, not the transparent margins around it — and points its speech
 * bubble at the head with it.
 *
 * **Why the server reads it.** The artwork is an administrator's upload on the asset host, served
 * without CORS headers, so a canvas holding it is tainted and the page cannot read a pixel of it;
 * the image optimizer would hand out a same-origin copy, but it is off in development, where the
 * figure would then have no shape at all. Here no origin applies, and what goes back is a
 * kilobyte of runs rather than the picture.
 *
 * **Not a proxy, and that is the security of the endpoint**: the upstream bytes never leave this
 * handler — only the runs do — and the target is pinned to the asset host the optimizer already
 * allows (`remotePatterns`), an image path with no query, no credentials and no redirect. Each
 * answer is memoised per address, so a page view costs no upstream read after the first.
 */

const ASSET_HOST = new URL(PICPONY_API_ORIGIN).hostname;
const IMAGE_PATH = /^\/[\w\-./%]+\.(?:png|webp|gif|jpe?g|avif)$/i;
/* An upload is a few megabytes at most (the current artwork is 2.1MB); this bounds a stray one. */
const MAX_BYTES = 12 * 1024 * 1024;
const MAX_PIXELS = 40_000_000;
const TIMEOUT_MS = 15_000;

function target(raw: string | null): URL | null {
  if (!raw || raw.length > 512) return null;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' || url.hostname !== ASSET_HOST || url.port !== '' || url.username || url.password) return null;
  if (url.search || url.hash || !IMAGE_PATH.test(url.pathname)) return null;
  return url;
}

async function readImage(url: string): Promise<Uint8Array | null> {
  const response = await fetch(url, { redirect: 'error', cache: 'no-store', signal: AbortSignal.timeout(TIMEOUT_MS) });
  const type = response.headers.get('content-type')?.split(';', 1)[0].trim().toLowerCase() ?? '';
  if (!response.ok || !response.body || !type.startsWith('image/') || Number(response.headers.get('content-length') ?? 0) > MAX_BYTES) {
    void response.body?.cancel().catch(() => {});
    return null;
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_BYTES) {
      await reader.cancel().catch(() => {});
      return null;
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks);
}

/* `sharp` is the optimizer's own decoder — Next installs it for `/_next/image` — imported where it
   is used, so a host without it answers this one route with a failure the figure falls back from
   (to an ellipse over the artwork) rather than failing the route module. The first frame of an
   animation; the orientation the browser shows. */
async function silhouette(bytes: Uint8Array): Promise<MascotShape | null> {
  const { default: sharp } = await import('sharp');
  const image = sharp(bytes, { limitInputPixels: MAX_PIXELS, animated: false, failOn: 'error' });
  const meta = await image.metadata();
  if (!meta.width || !meta.height) return null;
  const turned = (meta.orientation ?? 1) >= 5;
  const width = turned ? meta.height : meta.width;
  const height = turned ? meta.width : meta.height;
  const scale = MASCOT_SHAPE_GRID / Math.max(width, height);
  const w = Math.max(1, Math.round(width * scale));
  const h = Math.max(1, Math.round(height * scale));
  const alpha = await image.rotate().resize(w, h, { fit: 'fill' }).ensureAlpha().extractChannel(3).raw().toBuffer();
  if (alpha.length !== w * h) return null;
  return { w, h, rows: shapeRows(alpha, w, h) };
}

const shapeOf = createServerMemo<[string], MascotShape>({
  ttlMs: 6 * 60 * 60 * 1000,
  max: 16,
  keyOf: (src) => src,
  load: async (src) => {
    try {
      const bytes = await readImage(src);
      return bytes ? await silhouette(bytes) : null;
    } catch {
      return null;
    }
  },
});

export async function GET(request: NextRequest): Promise<Response> {
  const url = target(request.nextUrl.searchParams.get('src'));
  if (!url) {
    return Response.json({ success: false, message: '不是可读取的吉祥物图片' }, { status: 400, headers: { 'Cache-Control': 'no-store' } });
  }
  const shape = await shapeOf(url.href);
  if (!shape) {
    return Response.json({ success: false, message: '吉祥物图片暂时无法读取' }, { status: 502, headers: { 'Cache-Control': 'no-store' } });
  }
  /* An upload's address names its content, so an answer holds for as long as the address does. */
  return Response.json(shape, { headers: { 'Cache-Control': 'public, max-age=86400, stale-while-revalidate=604800' } });
}

export const dynamic = 'force-dynamic';
