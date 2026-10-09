/**
 * A small fixed-window limiter for the anonymous hops (review P1-F11): `/relay` and
 * `/upload/submit` forward to Derpibooru from this server's address with no sign-in, so without a
 * ceiling anybody can borrow the server's egress — and one abuser's volume becomes a Derpibooru
 * rate limit on every PicPony visitor.
 *
 * **Process-local by design.** The deployment is one `next start` (`output: 'standalone'`); behind
 * several replicas each one counts on its own, which still bounds a client to N × the limit. A
 * shared store is the upgrade path if that ever matters — nothing here pretends otherwise.
 *
 * The limits are generous on purpose: a gallery page fans out into dozens of relay reads, and a
 * school or carrier NAT puts many people behind one address. They exist to stop volume, not to
 * meter people.
 */

export interface RateLimit {
  /** Requests allowed per window, per client address. */
  limit: number;
  windowMs: number;
}

interface Window {
  start: number;
  count: number;
}

/** Bounded so a spray of spoofed addresses cannot grow the map without limit. */
const MAX_TRACKED = 10_000;

/**
 * The address a request came from, as the reverse proxy in front of us reports it. `x-real-ip` is
 * nginx's own; the first `x-forwarded-for` hop is the client's when nginx appends to it. Without
 * either (a direct connection in development) every caller shares one bucket, which is the
 * conservative direction.
 */
export function clientAddress(headers: Headers): string {
  const real = headers.get('x-real-ip')?.trim();
  if (real) return real.slice(0, 64);
  const forwarded = headers.get('x-forwarded-for')?.split(',', 1)[0]?.trim();
  if (forwarded) return forwarded.slice(0, 64);
  return 'local';
}

export function createRateLimiter(options: RateLimit, now: () => number = Date.now) {
  const windows = new Map<string, Window>();
  /** Seconds until `key` may try again, or 0 when this request is allowed (and counted). */
  return function take(key: string): number {
    const at = now();
    let entry = windows.get(key);
    if (!entry || at - entry.start >= options.windowMs) {
      windows.delete(key);
      /* Insertion order: the first key is the window that started longest ago. */
      if (windows.size >= MAX_TRACKED) windows.delete(windows.keys().next().value as string);
      entry = { start: at, count: 0 };
      windows.set(key, entry);
    }
    if (entry.count >= options.limit) return Math.max(1, Math.ceil((entry.start + options.windowMs - at) / 1000));
    entry.count += 1;
    return 0;
  };
}

/** The answer a limited hop gives: a 429 the client already reads as "rate limited, not down". */
export function rateLimited(retryAfterSeconds: number): Response {
  return Response.json(
    { success: false, message: '请求过于频繁，请稍后再试' },
    { status: 429, headers: { 'Retry-After': String(retryAfterSeconds), 'Cache-Control': 'private, no-store' } },
  );
}
