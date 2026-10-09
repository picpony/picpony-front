import type { NextRequest } from 'next/server';
import { PICPONY_API_ORIGIN } from '@/lib/constants';
import { createServerMemo } from '@/lib/serverMemo';
import { upstreamOrigin } from '@/lib/upstream.server';
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

/* `sharp` is the optimizer's own decoder — declared in package.json rather than left to Next's
   optional dependency (review P1-F8) — imported where it
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

/**
 * How many uncached reads may run at once (review P1-F8). The route is anonymous and a failed read
 * is not memoised, so rotating `src` across the asset host's images made every request a fresh
 * download (≤ 12MB) and decode (≤ 40MP). A real page view asks for one address and is served from
 * the memo after the first; past this many concurrent misses the answer is the same failure the
 * figure already falls back from.
 */
const MAX_CONCURRENT_READS = 2;
let reading = 0;

const shapeOf = createServerMemo<[string], MascotShape>({
  ttlMs: 6 * 60 * 60 * 1000,
  max: 16,
  keyOf: (src) => src,
  load: async (src) => {
    if (reading >= MAX_CONCURRENT_READS) return null;
    reading += 1;
    try {
      const bytes = await readImage(src);
      return bytes ? await silhouette(bytes) : null;
    } catch {
      return null;
    } finally {
      reading -= 1;
    }
  },
});

/**
 * The artworks the site is configured with (review P1-F8): the public `get_mascot_config` names
 * every mascot, and each one's image comes from asking for it by id. Only those addresses are read,
 * so the endpoint stops being a decoder for any picture on the asset host.
 *
 * `null` when the configuration cannot be read — the route then falls back to the host-pinned rule
 * above rather than taking the figure's shape away with the backend. A configured mascot that is
 * newer than the memo (an administrator just uploaded it) is found by one forced re-read, at most
 * once a minute, so a spray of misses cannot turn into a spray of configuration reads.
 */
const MASCOT_LIST_MAX = 20;
const CONFIG_TIMEOUT_MS = 8_000;

function assetHref(value: unknown): string | null {
  if (typeof value !== 'string' || !value.trim()) return null;
  const raw = value.trim();
  try {
    const url = /^https?:\/\//.test(raw) ? new URL(raw) : new URL(`${PICPONY_API_ORIGIN}/${raw.replace(/^\/+/, '')}`);
    return url.href;
  } catch {
    return null;
  }
}

async function readMascotConfig(selected?: string): Promise<Record<string, unknown> | null> {
  const address = new URL('/api.php', upstreamOrigin());
  address.searchParams.set('action', 'get_mascot_config');
  if (selected) address.searchParams.set('selected_id', selected);
  try {
    const response = await fetch(address, { cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(CONFIG_TIMEOUT_MS) });
    if (!response.ok) return null;
    const data: unknown = await response.json();
    return data && typeof data === 'object' && (data as { success?: unknown }).success === true ? data as Record<string, unknown> : null;
  } catch {
    return null;
  }
}

const configuredImages = createServerMemo<[], Set<string>>({
  ttlMs: 10 * 60 * 1000,
  keyOf: () => 'all',
  load: async () => {
    const first = await readMascotConfig();
    if (!first) return null;
    const images = new Set<string>();
    const own = assetHref(first.mascot_image);
    if (own) images.add(own);
    const ids = (Array.isArray(first.mascots) ? first.mascots : [])
      .map((row) => (row && typeof row === 'object' ? Number((row as { id?: unknown }).id) : NaN))
      .filter((id) => Number.isSafeInteger(id) && id > 0 && String(id) !== String(first.id))
      .slice(0, MASCOT_LIST_MAX);
    const others = await Promise.all(ids.map((id) => readMascotConfig(String(id))));
    for (const other of others) {
      const href = other && assetHref(other.mascot_image);
      if (href) images.add(href);
    }
    return images;
  },
});

const RECHECK_MS = 60_000;
let lastRecheck = 0;

/** Whether `href` is a configured artwork — `true` too when the configuration cannot be read. */
async function isConfigured(href: string): Promise<boolean> {
  const images = await configuredImages();
  if (!images) return true;
  if (images.has(href)) return true;
  if (Date.now() - lastRecheck < RECHECK_MS) return false;
  lastRecheck = Date.now();
  configuredImages.clear();
  const fresh = await configuredImages();
  return !fresh || fresh.has(href);
}

export async function GET(request: NextRequest): Promise<Response> {
  const url = target(request.nextUrl.searchParams.get('src'));
  if (!url || !(await isConfigured(url.href))) {
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
