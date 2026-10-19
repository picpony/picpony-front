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
/** The backend's own mascot uploads: `/api/v1/mascots/images/{64 hex}` (`mascot::read_image`), no extension. */
const UPLOAD_PATH = /^\/api\/v1\/mascots\/images\/[0-9a-f]{64}$/;
/* An upload is a few megabytes at most (the backend caps it at 5MiB); this bounds a stray one. */
const MAX_BYTES = 12 * 1024 * 1024;
const MAX_PIXELS = 40_000_000;
const TIMEOUT_MS = 15_000;

function target(raw: string | null): URL | null {
  if (!raw || raw.length > 512) return null;
  let url: URL;
  try {
    /* A backend upload arrives as the same-origin path the page shows (`getAssetUrl`); it is
       pinned to the asset host here and read from the backend itself (`source`). */
    url = new URL(raw, PICPONY_API_ORIGIN);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' || url.hostname !== ASSET_HOST || url.port !== '' || url.username || url.password) return null;
  if (url.search || url.hash || !(IMAGE_PATH.test(url.pathname) || UPLOAD_PATH.test(url.pathname))) return null;
  return url;
}

/** Where the bytes are read from: an upload straight from the backend (the browser reaches the
 *  same path through this app's `/api/v1` proxy), anything else from the asset host as named. */
function source(href: string): string {
  const url = new URL(href);
  return UPLOAD_PATH.test(url.pathname) ? `${upstreamOrigin()}${url.pathname}` : href;
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
   animation; the orientation the browser shows.

   **`turbopackIgnore`: a native package is required, not bundled.** Left to the bundler, the
   import becomes an external alias — `.next/node_modules/sharp-<hash>`, a junction Turbopack
   creates on Windows with a `Global\` target Node's `readlink` refuses — and the standalone
   copier then tries `copyFile` on that directory and logs `EPERM` for every build. Preserved as
   a runtime import it resolves like any other package (`standalone/node_modules/sharp`, which
   the optimizer's own trace already ships), and no alias exists to copy. */
async function silhouette(bytes: Uint8Array): Promise<MascotShape | null> {
  const { default: sharp } = await import(/* turbopackIgnore: true */ 'sharp');
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
      const bytes = await readImage(source(src));
      return bytes ? await silhouette(bytes) : null;
    } catch {
      return null;
    } finally {
      reading -= 1;
    }
  },
});

/**
 * The artworks the site is configured with (review P1-F8): the public `GET /api/v1/mascots` lists
 * every active mascot with its `image_url`. Only those addresses are read, so the endpoint stops
 * being a decoder for any picture on the asset host.
 *
 * `null` when the list cannot be read — the route then falls back to the host-pinned rule above
 * rather than taking the figure's shape away with the backend. A configured mascot that is newer
 * than the memo (an administrator just uploaded it) is found by one forced re-read, at most once
 * a minute, so a spray of misses cannot turn into a spray of list reads.
 */
const CONFIG_TIMEOUT_MS = 8_000;

function assetHref(value: string): string | null {
  const raw = value.trim();
  if (!raw) return null;
  try {
    const url = /^https?:\/\//.test(raw) ? new URL(raw) : new URL(`${PICPONY_API_ORIGIN}/${raw.replace(/^\/+/, '')}`);
    return url.href;
  } catch {
    return null;
  }
}

const configuredImages = createServerMemo<[], Set<string>>({
  ttlMs: 10 * 60 * 1000,
  keyOf: () => 'all',
  load: async () => {
    try {
      const response = await fetch(`${upstreamOrigin()}/api/v1/mascots`, { cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(CONFIG_TIMEOUT_MS) });
      if (!response.ok) return null;
      const data = (await response.json()) as { mascots: { image_url: string }[] };
      const images = new Set<string>();
      for (const row of data.mascots) {
        const href = assetHref(row.image_url);
        if (href) images.add(href);
      }
      return images;
    } catch {
      return null;
    }
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
