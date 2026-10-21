import { getRawImageUrl, OPTIMIZER_ACTIVE } from '@/lib/imageLoader';

/**
 * Derpibooru's own derivatives: `large`, `medium`, `small`, the thumbs. These are already
 * size-appropriate files off a CDN, which is what makes running them through `/_next/image` a pure
 * loss — see `shouldBypassImageOptimization`.
 *
 * Matched on the *raw* URL, because the image line may have wrapped it in a proxy's `?url=`.
 */
const CDN_DERIVATIVE = /\/(?:large|medium|small|tall|thumb|thumb_small|thumb_tiny)\.[a-z0-9]+$/;

/**
 * **The detail's picture is served as-is, not re-encoded — this is the fix for the
 * blur.** The source is already one of Derpibooru's CDN derivatives, sized for
 * exactly this job; running it through `/_next/image` at `q=82` measurably destroys
 * it (a real picture, at identical pixel dimensions: 373KB source → 171KB re-encoded)
 * and costs 3–4 seconds of server CPU per variant. That is why the report was
 * "production is soft, dev is completely fine": dev skips the optimizer. The bytes
 * given up are the right way round — the picture *is* the content — and gallery
 * cards keep the optimizer, where a small card from a large source is a real saving.
 */
export function shouldBypassImageOptimization(src: string) {
  const raw = getRawImageUrl(src);
  /* A URL the image line has wrapped is the line's to deliver, never the optimizer's:
     `remotePatterns` admits only the raw hosts, so `/_next/image` answers it with a 400. It
     reaches here only for a record with no `large`/`medium` rendition — the `full` / `view_url`
     fallback, the one detail source that is not a derivative. */
  if (raw !== src) return true;
  const pathname = raw.split(/[?#]/, 1)[0].toLowerCase();
  if (pathname.endsWith('.gif') || pathname.endsWith('.svg') || pathname.endsWith('.apng')) {
    return true;
  }
  return CDN_DERIVATIVE.test(pathname);
}

/** Whether the final layer's first attempt goes through `/_next/image`. */
export function isDetailFinalOptimized(src: string) {
  return OPTIMIZER_ACTIVE && !shouldBypassImageOptimization(src);
}
