import type { NextRequest } from 'next/server';
import { revalidateTag } from 'next/cache';
import { BLOCK_FILTERS_CACHE_TAG, clearBlockFiltersMemo } from '@/lib/blockFilters.server';

/**
 * Reverse proxy for the PicPony PHP backend.
 *
 * Replaces the old `rewrites()` entry in next.config.ts, because a rewrite cannot touch
 * upstream *response* headers — and that is exactly what the slider captcha needs: the
 * backend hands out its session as `Set-Cookie: PHPSESSID=...; Secure`, and a browser
 * silently discards a `Secure` cookie when the page origin is not a secure context.
 * Over plain HTTP (e.g. a LAN address from a phone) the PHP session is lost entirely —
 * `captcha_get` stores the puzzle answer in a session the browser throws away, so
 * `captcha_verify` fails no matter how well the piece is aligned. http://localhost is
 * exempt (browsers treat it as trustworthy), which is why this only reproduced on other
 * devices.
 *
 * So: when the request did not reach us over HTTPS, drop `Secure` on the way back out.
 * Over HTTPS every header passes through untouched.
 */

const UPSTREAM_ORIGIN = 'https://picpony.top';
const UPSTREAM_PATH = '/api.php';

/**
 * Upstream timeout. Generous by design, unlike `lib/route.server.ts`'s 1500ms: that one
 * bounds a *document* every visitor pays for; this bounds a request the client is
 * explicitly waiting on, where the guarded failure is a connection that never closes.
 * The backend's observed latency is ~9s under load, so anything much under 20s would
 * turn a slow answer into a failover.
 */
const UPSTREAM_TIMEOUT_MS = 30_000;

/** Hop-by-hop headers, plus ones `fetch` must recompute for the new request. */
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
  // fetch negotiates and transparently decodes its own encoding.
  'accept-encoding',
]);

/**
 * Hop-by-hop headers, plus the framing headers that describe the *upstream*
 * body. fetch hands us an already-decoded stream, so passing `content-encoding`
 * through would tell the browser to inflate plain bytes.
 */
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
]);

/** True when the *browser* spoke HTTPS, honouring a proxy in front of us. */
function isSecureRequest(request: NextRequest): boolean {
  const forwarded = request.headers.get('x-forwarded-proto');
  if (forwarded) {
    return forwarded.split(',')[0].trim().toLowerCase() === 'https';
  }
  return request.nextUrl.protocol === 'https:';
}

function downgradeCookie(cookie: string): string {
  return (
    cookie
      .replace(/;\s*Secure\b/gi, '')
      // `SameSite=None` is only honoured on Secure cookies, so leaving it would lose
      // the cookie to a different rule; Lax is the safe equivalent for this
      // same-origin flow.
      .replace(/;\s*SameSite\s*=\s*None\b/gi, '; SameSite=Lax')
  );
}

async function proxy(
  request: NextRequest,
  context: { params: Promise<{ path?: string[] }> },
): Promise<Response> {
  const { path } = await context.params;
  /* A decoded catch-all segment must stay a segment. URL normalisation removes dots and
     upstream servers may decode escaped separators again, escaping the /api.php namespace. */
  if (path?.some((part) => part === '.' || part === '..' || /[/\\%\u0000-\u001f\u007f]/.test(part))) {
    return Response.json({ success: false, message: '接口路径无效' }, { status: 400 });
  }
  const suffix = path?.length ? `/${path.map(encodeURIComponent).join('/')}` : '';
  const target = new URL(`${UPSTREAM_PATH}${suffix}`, UPSTREAM_ORIGIN);
  target.search = request.nextUrl.search;

  const headers = new Headers();
  const connectionHeaders = new Set(
    request.headers.get('connection')?.toLowerCase().split(',').map((value) => value.trim()) ?? [],
  );
  request.headers.forEach((value, key) => {
    if (!SKIP_REQUEST_HEADERS.has(key) && !connectionHeaders.has(key)) headers.set(key, value);
  });

  const hasBody = request.method !== 'GET' && request.method !== 'HEAD';
  let upstream: Response;
  try {
    const init: RequestInit & { duplex: 'half' } = {
      method: request.method,
      headers,
      /* Stream uploads with backpressure instead of buffering an unauthenticated request of
         unbounded size in Node. The timeout now also bounds the incoming body transfer. */
      body: hasBody ? request.body : undefined,
      duplex: 'half',
      redirect: 'manual',
      cache: 'no-store',
      /* Bounded: without this the handler inherits the platform's socket timeout, so a
         hung upstream hangs this route with it, holding a Node connection open. */
      signal: AbortSignal.any([request.signal, AbortSignal.timeout(UPSTREAM_TIMEOUT_MS)]),
    };
    upstream = await fetch(target, init);
  } catch {
    /* Same shape `app/relay/route.ts` returns for the same condition: `proxyFetch`
       (lib/api/client.ts) treats 502 as a failover trigger, which is exactly what it
       would have concluded from the network throw this is standing in for. A timeout
       and a refused connection are one answer here — the line is not answering. */
    return Response.json(
      { success: false, message: 'PicPony 接口暂时不可用' },
      { status: 502 },
    );
  }

  /* Only a write the backend has actually authorised and accepted may invalidate the public
     search definitions. Expire immediately: showing old filters after a successful edit can
     expose a picture the newly saved rules exclude. */
  const action = request.nextUrl.searchParams.get('action');
  if (request.method === 'POST' && !suffix && upstream.ok &&
      (action === 'admin_add_block_tag' || action === 'admin_remove_block_tag')) {
    const result: unknown = await upstream.clone().json().catch(() => null);
    if (result && typeof result === 'object' && 'success' in result && result.success === true) {
      revalidateTag(BLOCK_FILTERS_CACHE_TAG, { expire: 0 });
      clearBlockFiltersMemo();
    }
  }

  const secure = isSecureRequest(request);
  const responseHeaders = new Headers();
  const upstreamConnectionHeaders = new Set(
    upstream.headers.get('connection')?.toLowerCase().split(',').map((value) => value.trim()) ?? [],
  );
  upstream.headers.forEach((value, key) => {
    // Set-Cookie can repeat, so it is copied separately via getSetCookie().
    if (key === 'set-cookie') return;
    if (!SKIP_RESPONSE_HEADERS.has(key) && !upstreamConnectionHeaders.has(key)) responseHeaders.set(key, value);
  });
  for (const cookie of upstream.headers.getSetCookie()) {
    responseHeaders.append('set-cookie', secure ? cookie : downgradeCookie(cookie));
  }
  /* Responses can contain an account or a PHP session. Next's internal no-store does not
     control browser/CDN caches; make the same boundary explicit on the outgoing response. */
  responseHeaders.set('Cache-Control', 'private, no-store');
  responseHeaders.set('X-Content-Type-Options', 'nosniff');
  responseHeaders.set('Content-Security-Policy', "sandbox; default-src 'none'; frame-ancestors 'none'");

  return new Response(request.method === 'HEAD' ? null : upstream.body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers: responseHeaders,
  });
}

export const dynamic = 'force-dynamic';

export const GET = proxy;
export const HEAD = proxy;
export const POST = proxy;
export const PUT = proxy;
export const PATCH = proxy;
export const DELETE = proxy;
export const OPTIONS = proxy;
