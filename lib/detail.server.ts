import { DERPIBOORU_API_BASE, PICPONY_API_BASE } from '@/lib/constants';
import type { DetailSeed, PonyImage } from '@/lib/types/image';
import type { ImageLine } from '@/lib/route';
import { buildImageUrl, getRawImageUrl } from '@/lib/imageLoader';
import { createServerMemo } from '@/lib/serverMemo';
import { tagTranslationKey } from '@/lib/tagTranslations';
import { upstreamOrigin } from '@/lib/upstream.server';

/**
 * The opened picture's record, read on the server for a direct `/pic/:id` — a shared link, a
 * reload, a new tab — so the document arrives with the picture's header, a media box already at
 * its aspect ratio, and the body under it. Read in the browser instead, the page sat on skeletons
 * for the relay's round trip (over six seconds measured) and then re-laid itself out when the
 * record landed: the media well grew from its placeholder height to the picture's, and the body
 * placeholder collapsed (R12-015).
 *
 * The glossary's names for the picture's tags ride along when they land in time, so the tag list
 * in that first paint is the one the browser will keep rather than English words that change width
 * a moment later.
 *
 * Safe to share across visitors: an `images/<id>` read is anonymous and the same for everyone,
 * and so is the glossary. The rows come back on no image line (raw derpicdn URLs); the page puts
 * them on the document's line, per request (`detailSeedOnImageLine`), exactly as the home page
 * does with its feed. Not `proxyFetch`, for `lib/feed.server.ts`'s reasons: the server goes
 * direct, and a server read may not wait on the browser's line policy.
 *
 * Only the page presentation reads this. The overlay (an intercepted navigation from a list)
 * already has the list's row, and a server read in its RSC payload would sit inside the hero
 * flight's window.
 */

/** Matches `lib/detail.ts`'s own TTL, so both sides of the handoff share a clock. */
const TTL_MS = 2 * 60 * 1000;

/** The content, not a hint: the home feed's bound. The document streams meanwhile. */
const TIMEOUT_MS = 2500;

/**
 * The glossary's names get what is left of the read's budget, up to this. Worth waiting for: a
 * name that misses the first paint cannot be swapped in while the tag list is on screen (it would
 * re-flow the chips under the reader), so it waits for the list to leave the screen.
 */
const TRANSLATION_BUDGET_MS = 1200;

/** Distinct pictures held. One is a record of a few KB. */
const MAX_SLOTS = 64;

/** Derpibooru's ids are positive integers well inside this. */
const MAX_ID = 2 ** 31 - 1;

/**
 * After a rate limit or an outage the server leaves Derpibooru alone for a while: every SSR read
 * comes from one address, so a 429 is the whole site's (`lib/feed.server.ts` keeps its own pause
 * for the same reason). `Retry-After` is honoured up to the cap.
 */
const BACKOFF_DEFAULT_MS = 15_000;
const BACKOFF_MAX_MS = 60_000;
let backoffUntil = 0;

function backoffFrom(response: Response): number {
  const header = response.headers.get('retry-after');
  if (header) {
    const seconds = Number(header);
    const ms = Number.isFinite(seconds) ? seconds * 1000 : Date.parse(header) - Date.now();
    if (Number.isFinite(ms) && ms > 0) return Math.min(ms, BACKOFF_MAX_MS);
  }
  return BACKOFF_DEFAULT_MS;
}

const DERPI_UPSTREAM = process.env.PICPONY_DERPI_ORIGIN || DERPIBOORU_API_BASE;
/** The absolute origin: `PICPONY_API_BASE` is relative, and Node's `fetch` rejects that. */
const PICPONY_UPSTREAM = upstreamOrigin();

/**
 * The record fields the detail reads. Derpibooru sends about twice as many (hashes, tag ids,
 * intensities, processing flags); none reaches the screen, and every one would ride in the RSC
 * payload.
 */
const DETAIL_FIELDS = [
  'id', 'width', 'height', 'aspect_ratio', 'representations', 'format', 'name', 'view_url',
  'source_url', 'source_urls', 'uploader', 'uploader_id', 'created_at', 'updated_at', 'first_seen_at',
  'size', 'score', 'comment_count', 'tags', 'description', 'upvotes', 'downvotes', 'faves',
  'animated', 'duration', 'mime_type', 'spoilered',
] as const;

function trimRecord(image: PonyImage): PonyImage {
  const source = image as unknown as Record<string, unknown>;
  const row: Record<string, unknown> = {};
  for (const field of DETAIL_FIELDS) if (field in source) row[field] = source[field];
  return row as unknown as PonyImage;
}

async function readTranslations(tags: string[], deadline: number): Promise<Record<string, string | null> | null> {
  const keys = [...new Set(tags.map(tagTranslationKey).filter(Boolean))].slice(0, 500);
  if (keys.length === 0) return {};
  const budget = Math.min(TRANSLATION_BUDGET_MS, deadline - Date.now());
  if (budget <= 50) return null;
  try {
    const res = await fetch(`${PICPONY_UPSTREAM}${PICPONY_API_BASE}?action=get_tag_translations`, {
      method: 'POST',
      cache: 'no-store',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tags: keys }),
      signal: AbortSignal.timeout(budget),
    });
    if (!res.ok) {
      void res.body?.cancel().catch(() => {});
      return null;
    }
    const data = (await res.json()) as { success?: unknown; translations?: unknown };
    if (data?.success !== true || !data.translations || typeof data.translations !== 'object') return null;
    const table = data.translations as Record<string, unknown>;
    return Object.fromEntries(
      keys.map((key) => [key, typeof table[key] === 'string' && table[key] ? (table[key] as string) : null]),
    );
  } catch {
    return null;
  }
}

const read = createServerMemo<[number], DetailSeed>({
  ttlMs: TTL_MS,
  max: MAX_SLOTS,
  keyOf: (id) => String(id),
  load: async (id: number): Promise<DetailSeed | null> => {
    if (Date.now() < backoffUntil) return null;
    const deadline = Date.now() + TIMEOUT_MS;
    try {
      const res = await fetch(`${DERPI_UPSTREAM}/images/${id}`, {
        cache: 'no-store',
        signal: AbortSignal.timeout(TIMEOUT_MS),
        /* A server may name itself (Derpibooru asks API clients to); only a browser must not. */
        headers: { 'User-Agent': 'PicPony/1.0' },
      });
      if (res.status === 404) {
        void res.body?.cancel().catch(() => {});
        return { id, image: null, translations: null, generatedAt: Date.now() };
      }
      if (!res.ok) {
        if (res.status === 429 || res.status >= 500) backoffUntil = Date.now() + backoffFrom(res);
        void res.body?.cancel().catch(() => {});
        return null;
      }
      const body = (await res.json()) as { image?: unknown };
      const image = body?.image as PonyImage | undefined;
      if (!image || typeof image !== 'object' || image.id !== id) return null;
      const tags = Array.isArray(image.tags) ? image.tags.filter((tag): tag is string => typeof tag === 'string') : [];
      const translations = await readTranslations(tags, deadline);
      return { id, image: trimRecord(image), translations, generatedAt: Date.now() };
    } catch {
      /* A timeout, an offline upstream, an HTML error page: no seed, and the page reads the
         record in the browser as it always could. Not logged — it would log on every miss. */
      return null;
    }
  },
});

/** The seed for `/pic/<id>`, or `null` when the id is not one or the read did not land in time. */
export async function readImageDetailSeed(rawId: string | number): Promise<DetailSeed | null> {
  const id = typeof rawId === 'number' ? rawId : Number(rawId);
  if (!Number.isSafeInteger(id) || id <= 0 || id > MAX_ID || String(id) !== String(rawId).trim()) return null;
  return read(id);
}

const TIER_OF = { picpony: 0, cdn: 1, direct: 2 } as const;

function onLine(url: unknown, tier: 0 | 1 | 2): string {
  return typeof url === 'string' && url ? buildImageUrl(getRawImageUrl(url), tier) : '';
}

/**
 * The seed with its URLs on the image line the document renders with — the same URLs the
 * browser's own read gets from `applyImageLine`, so a server-rendered `<img src>` and its
 * hydration agree. `null` line means the defaults (the PicPony worker), as on the home page.
 */
export function detailSeedOnImageLine(seed: DetailSeed | null, line: ImageLine | null): DetailSeed | null {
  if (!seed?.image) return seed;
  const tier = TIER_OF[line ?? 'picpony'];
  const image = seed.image;
  return {
    ...seed,
    image: {
      ...image,
      representations: Object.fromEntries(
        Object.entries(image.representations ?? {}).map(([name, url]) => [name, onLine(url, tier)]),
      ) as unknown as PonyImage['representations'],
      view_url: onLine(image.view_url, tier),
    },
  };
}
