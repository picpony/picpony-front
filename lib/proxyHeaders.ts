/**
 * The header rules the server hops share (`app/api/v1/[...path]`, `app/relay`, `app/upload/submit`)
 * — review P1-F12. They had drifted: one hop dropped the headers its upstream's `Connection` named,
 * another did not, and each kept its own copy of the hop-by-hop list.
 *
 * What stays **per hop** is deliberate and is not here: which cookies travel (only the `/api/v1`
 * proxy forwards any), and the extra response headers a hop refuses (`set-cookie` on
 * the anonymous hops, CORS headers echoing our server's own `Origin`). A hop passes those as
 * `extra`.
 *
 * Pure: no Next import, so the VM-loaded route tests can load it as it is.
 */

/** RFC 9110 §7.6.1 hop-by-hop headers, plus the ones a re-encoded body invalidates. */
export const HOP_BY_HOP_RESPONSE_HEADERS: ReadonlySet<string> = new Set([
  'connection',
  'keep-alive',
  'transfer-encoding',
  'upgrade',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailer',
  /* `fetch` has already decoded the body, so its encoding and length no longer describe it. */
  'content-encoding',
  'content-length',
  /* Instructions for a CDN in front of the upstream, not for whoever is in front of us. */
  'cdn-cache-control',
  'vercel-cdn-cache-control',
  /* The upstream's software banner is not ours to advertise. */
  'x-powered-by',
  'server',
]);

/** The header names a message's own `Connection` header declares hop-by-hop, lower-cased. */
export function connectionTokens(headers: Headers): Set<string> {
  return new Set(
    headers.get('connection')?.toLowerCase().split(',').map((value) => value.trim()).filter(Boolean) ?? [],
  );
}

/**
 * The upstream response's headers a hop may pass on: everything except the hop-by-hop set, what
 * the upstream's own `Connection` names, and the hop's `extra` refusals. `set-cookie` is never
 * copied here — it can repeat, so a hop that forwards cookies appends `getSetCookie()` itself.
 */
export function forwardableResponseHeaders(upstream: Headers, extra: ReadonlySet<string> = new Set()): Headers {
  const named = connectionTokens(upstream);
  const out = new Headers();
  upstream.forEach((value, key) => {
    if (key === 'set-cookie') return;
    if (HOP_BY_HOP_RESPONSE_HEADERS.has(key) || extra.has(key) || named.has(key)) return;
    out.set(key, value);
  });
  return out;
}

/** One IP literal (v4 or v6, no port, no zone), or `''` — a header entry is never trusted as text. */
function ipLiteral(value: string): string {
  const text = value.trim();
  if (/^(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}$/.test(text)) return text;
  if (!text.includes(':') || !/^[0-9A-Fa-f:.]{2,45}$/.test(text)) return '';
  try {
    /* The URL parser is a complete IPv6 grammar; anything it rejects is not an address. */
    new URL(`http://[${text}]/`);
    return text;
  } catch {
    return '';
  }
}

/**
 * The visitor's address for an upstream hop, from the request's own headers (a route handler is
 * not given the socket): `X-Real-IP` when the reverse proxy in front of us set one, otherwise the
 * last `X-Forwarded-For` entry — the hop nearest us, which our own proxy (or Next's server, which
 * fills in the socket's address when the header is absent) wrote; the leftmost entries are
 * whatever the client claimed. The outgoing `X-Forwarded-For` is the received chain (only entries
 * that are addresses) with that address appended when it is not already its last entry;
 * `X-Real-IP` is that address. Both are dropped when no address is known, never passed through
 * as the client sent them.
 */
export function clientAddressHeaders(incoming: Headers): { forwardedFor: string; realIp: string } {
  const chain = (incoming.get('x-forwarded-for') ?? '').split(',').map(ipLiteral).filter(Boolean);
  const realIp = ipLiteral(incoming.get('x-real-ip') ?? '') || chain.at(-1) || '';
  if (realIp && chain.at(-1) !== realIp) chain.push(realIp);
  return { forwardedFor: chain.join(', '), realIp };
}

/**
 * True iff `Cache-Control` explicitly carries the standalone `public` directive
 * (case-insensitive) and does not carry `private` or `no-store`.
 */
export function isPublicCacheControl(value: string | null | undefined): boolean {
  if (!value) return false;
  let hasPublic = false;
  for (const part of value.split(',')) {
    const eq = part.indexOf('=');
    const token = (eq === -1 ? part : part.slice(0, eq)).trim().toLowerCase();
    if (!token) continue;
    if (token === 'private' || token === 'no-store') return false;
    if (token === 'public') hasPublic = true;
  }
  return hasPublic;
}

/**
 * Merge header names into a `Vary` value without duplicates (case-insensitive),
 * preserving `*` when already present.
 */
export function mergeVary(existing: string | null | undefined, ...tokens: string[]): string {
  const parts: string[] = [];
  const seen = new Set<string>();
  if (existing) {
    for (const raw of existing.split(',')) {
      const name = raw.trim();
      if (!name) continue;
      if (name === '*') return '*';
      const key = name.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      parts.push(name);
    }
  }
  for (const raw of tokens) {
    const name = raw.trim();
    if (!name) continue;
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    parts.push(name);
  }
  return parts.join(', ');
}

export interface PublicCachePolicyInput {
  method: string;
  hasAuthorization: boolean;
  hasBackendCookie: boolean;
  hasSetCookie: boolean;
  upstreamStatus: number;
  upstreamCacheControl: string | null;
}

/**
 * Security gate for forwarding upstream `Cache-Control` from `/api/v1/[...path]`:
 * - Anonymous `GET`/`HEAD` (no `Authorization`, no backend cookie, no `Set-Cookie`, `200`/`304`,
 *   explicit upstream `public` without `private`/`no-store`) keeps the upstream `Cache-Control`.
 * - Cookie-only `GET`/`HEAD` (e.g. a signed-in browser's same-origin `<img>` carrying `auth_bind`
 *   without `Authorization`) downgrades `public` to `private` and strips `s-maxage`, so the user's
 *   browser still caches public assets while shared proxies/CDNs never store a credentialed answer.
 * - Everything else (including any `Authorization` header or non-`public` upstream) returns `null`,
 *   which the route handler writes as `private, no-store`.
 */
export function resolveProxyCacheControl(input: PublicCachePolicyInput): string | null {
  const method = input.method.toUpperCase();
  if (method !== 'GET' && method !== 'HEAD') return null;
  if (input.hasAuthorization || input.hasSetCookie) return null;
  if (input.upstreamStatus !== 200 && input.upstreamStatus !== 304) return null;
  if (!isPublicCacheControl(input.upstreamCacheControl)) return null;
  const raw = input.upstreamCacheControl!.trim();
  if (!input.hasBackendCookie) return raw;
  const directives: string[] = [];
  for (const part of raw.split(',')) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    const eq = trimmed.indexOf('=');
    const token = (eq === -1 ? trimmed : trimmed.slice(0, eq)).trim().toLowerCase();
    if (token === 'public' || token === 's-maxage') continue;
    directives.push(trimmed);
  }
  return ['private', ...directives].join(', ');
}

/** True iff the request qualifies for un-downgraded `public` caching (anonymous, no credentials). */
export function canForwardPublicCache(input: PublicCachePolicyInput): boolean {
  return !input.hasBackendCookie && resolveProxyCacheControl(input) !== null;
}
