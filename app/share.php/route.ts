import type { NextRequest } from 'next/server';
import { COOKIE_KEYS, PICPONY_API_ORIGIN } from '@/lib/constants';
import { upstreamOrigin } from '@/lib/upstream.server';

/**
 * PicPony's short links (`lib/api/share.ts`) on this origin: `share.php?action=create` is
 * proxied, and a visited `share.php?id=` is sent on to the backend's own page.
 *
 * **Creating** is forwarded the way `app/api.php/[[...path]]/route.ts` forwards, and for the same
 * reasons (read that file first): hop-by-hop headers dropped both ways, this app's own cookies
 * kept off the upstream request, `Secure` dropped from the backend's cookies when the browser did
 * not speak HTTPS, the upstream's software banner removed, nothing cached, `api.php`'s sandbox on
 * the answer.
 *
 * **A visited link is redirected, not proxied.** `?id=` answers an HTML page — the metadata a
 * chat app's link preview reads — built from a title and description anybody can store. Served
 * from this origin it would run in the origin that holds the session token. So the page stays on
 * the backend's origin, where it always lived, and a chat app's preview follows the redirect to
 * it. Every answer here carries `api.php`'s sandbox, which stands because `next.config.ts`'s
 * `headers()` excludes `/share.php` beside `api.php` and `relay`: a policy set there replaces a
 * route handler's own rather than adding to it (measured — before the exclusion, the answer
 * carried only the config's `frame-ancestors 'self'`).
 */

/** Where a visited link is sent: the public page, on the backend's public origin. */
const UPSTREAM = new URL('/share.php', PICPONY_API_ORIGIN);
/**
 * Where `create` is forwarded: the same server-controlled origin as the api.php handler and the
 * `*.server.ts` readers, so a fixture or staging run never writes to production (review P1-F7).
 */
const CREATE_UPSTREAM = new URL('/share.php', upstreamOrigin());

/** A person is waiting on either answer; the backend's observed worst case is ~9s. */
const UPSTREAM_TIMEOUT_MS = 20_000;

/** As in the api.php handler: hop-by-hop headers, plus ones `fetch` recomputes. */
const SKIP_REQUEST_HEADERS = new Set([
  'host',
  'connection',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
  'content-length',
  'accept-encoding',
]);

/** As in the api.php handler: hop-by-hop, the upstream body's framing, and its banner. */
const SKIP_RESPONSE_HEADERS = new Set([
  'connection',
  'keep-alive',
  'transfer-encoding',
  'upgrade',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailer',
  'content-encoding',
  'content-length',
  'cdn-cache-control',
  'vercel-cdn-cache-control',
  'x-powered-by',
  'server',
  /* Replaced below, on every answer; and a redirect is not relayed (`redirect: 'manual'`). */
  'content-security-policy',
  'location',
]);

const APP_COOKIES = new Set<string>(Object.values(COOKIE_KEYS));

const POLICY = "sandbox; default-src 'none'; frame-ancestors 'none'";

function backendCookies(header: string): string {
  return header
    .split(';')
    .map((part) => part.trim())
    .filter((part) => part && !APP_COOKIES.has(part.slice(0, part.indexOf('=') === -1 ? part.length : part.indexOf('=')).trim()))
    .join('; ');
}

function isSecureRequest(request: NextRequest): boolean {
  const forwarded = request.headers.get('x-forwarded-proto');
  if (forwarded) return forwarded.split(',')[0].trim().toLowerCase() === 'https';
  return request.nextUrl.protocol === 'https:';
}

function downgradeCookie(cookie: string): string {
  return cookie.replace(/;\s*Secure\b/gi, '').replace(/;\s*SameSite\s*=\s*None\b/gi, '; SameSite=Lax');
}

async function proxy(request: NextRequest): Promise<Response> {
  const id = request.nextUrl.searchParams.get('id');
  if ((request.method === 'GET' || request.method === 'HEAD') && id) {
    const page = new URL(UPSTREAM);
    page.searchParams.set('id', id);
    return new Response(null, {
      status: 302,
      headers: { Location: page.href, 'Cache-Control': 'private, no-store', 'Content-Security-Policy': POLICY },
    });
  }
  /* Nothing else here is this app's to relay: the backend's other answers are HTML pages. */
  if (request.method !== 'POST' || request.nextUrl.searchParams.get('action') !== 'create') {
    return Response.json(
      { success: false, message: '分享链接无效' },
      { status: 404, headers: { 'Cache-Control': 'private, no-store', 'Content-Security-Policy': POLICY } },
    );
  }

  const target = new URL(CREATE_UPSTREAM);
  target.search = request.nextUrl.search;

  const headers = new Headers();
  const connectionHeaders = new Set(
    request.headers.get('connection')?.toLowerCase().split(',').map((value) => value.trim()) ?? [],
  );
  request.headers.forEach((value, key) => {
    if (SKIP_REQUEST_HEADERS.has(key) || connectionHeaders.has(key)) return;
    if (key === 'cookie') {
      const forwarded = backendCookies(value);
      if (forwarded) headers.set(key, forwarded);
      return;
    }
    headers.set(key, value);
  });

  let upstream: Response;
  try {
    const init: RequestInit & { duplex: 'half' } = {
      method: request.method,
      headers,
      body: request.body,
      duplex: 'half',
      redirect: 'manual',
      cache: 'no-store',
      signal: AbortSignal.any([request.signal, AbortSignal.timeout(UPSTREAM_TIMEOUT_MS)]),
    };
    upstream = await fetch(target, init);
  } catch {
    return Response.json(
      { success: false, message: '分享服务暂时不可用' },
      { status: 502, headers: { 'Cache-Control': 'private, no-store', 'Content-Security-Policy': POLICY } },
    );
  }

  const responseHeaders = new Headers();
  const upstreamConnectionHeaders = new Set(
    upstream.headers.get('connection')?.toLowerCase().split(',').map((value) => value.trim()) ?? [],
  );
  upstream.headers.forEach((value, key) => {
    if (key === 'set-cookie') return;
    if (!SKIP_RESPONSE_HEADERS.has(key) && !upstreamConnectionHeaders.has(key)) responseHeaders.set(key, value);
  });
  const secure = isSecureRequest(request);
  for (const cookie of upstream.headers.getSetCookie()) {
    responseHeaders.append('set-cookie', secure ? cookie : downgradeCookie(cookie));
  }
  responseHeaders.set('Cache-Control', 'private, no-store');
  responseHeaders.set('X-Content-Type-Options', 'nosniff');

  responseHeaders.set('Content-Security-Policy', POLICY);
  return new Response(upstream.body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers: responseHeaders,
  });
}

export const dynamic = 'force-dynamic';

export const GET = proxy;
export const HEAD = proxy;
export const POST = proxy;
