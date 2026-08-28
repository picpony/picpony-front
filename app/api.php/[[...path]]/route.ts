import type { NextRequest } from 'next/server';

/**
 * Reverse proxy for the PicPony PHP backend.
 *
 * This replaces the old `rewrites()` entry in next.config.ts, because a rewrite
 * cannot touch upstream *response* headers — and that is exactly what the
 * slider captcha needs.
 *
 * The backend hands out its session as `Set-Cookie: PHPSESSID=...; Secure`.
 * A browser silently discards a `Secure` cookie when the page origin is not a
 * secure context, so opening the app over plain HTTP (a LAN address such as
 * http://192.168.31.12:3100 from a phone) loses the PHP session entirely:
 * `captcha_get` stores the puzzle answer in a session the browser then throws
 * away, `captcha_verify` arrives without it, and the backend answers
 * "验证失败，请重新对齐滑块" no matter how perfectly the piece is aligned.
 * http://localhost is exempt — browsers treat it as trustworthy and keep the
 * cookie — which is why this only ever reproduced on other devices.
 *
 * So: when the request did not reach us over HTTPS, drop `Secure` on the way
 * back out. Over HTTPS (production, or an HTTPS tunnel in front of dev) every
 * header passes through untouched.
 */

const UPSTREAM_ORIGIN = 'https://picpony.top';
const UPSTREAM_PATH = '/api.php';

/**
 * How long one upstream call may take before this route gives up on it.
 *
 * Generous rather than tight, and the difference from `lib/route.server.ts`'s 1500ms is
 * the point: that one bounds a *document*, where every visitor pays the wait whether or
 * not they needed the answer. This bounds a request the client explicitly made and is
 * waiting on, so the failure it is guarding against is the connection never closing at
 * all — an upstream that answers in eight seconds should still be allowed to answer.
 * The observed latency of this backend is ~9s under load, so anything much under 20s
 * would turn a slow answer into a failover.
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
  'content-encoding',
  'content-length',
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
      // `SameSite=None` is only honoured on Secure cookies, so leaving it would
      // just lose the cookie to a different rule. Lax is the safe equivalent for
      // a same-origin flow like this one.
      .replace(/;\s*SameSite\s*=\s*None\b/gi, '; SameSite=Lax')
  );
}

async function proxy(
  request: NextRequest,
  context: { params: Promise<{ path?: string[] }> },
): Promise<Response> {
  const { path } = await context.params;
  const suffix = path?.length ? `/${path.map(encodeURIComponent).join('/')}` : '';
  const target = new URL(`${UPSTREAM_PATH}${suffix}`, UPSTREAM_ORIGIN);
  target.search = request.nextUrl.search;

  const headers = new Headers();
  request.headers.forEach((value, key) => {
    if (!SKIP_REQUEST_HEADERS.has(key)) headers.set(key, value);
  });

  const hasBody = request.method !== 'GET' && request.method !== 'HEAD';
  let upstream: Response;
  try {
    upstream = await fetch(target, {
      method: request.method,
      headers,
      body: hasBody ? await request.arrayBuffer() : undefined,
      redirect: 'manual',
      cache: 'no-store',
      /* Without this the handler inherits the platform's own socket timeout, which on a
         hung upstream means this route hangs with it — holding a Node connection open for
         as long as the backend takes to give up. `app/relay/route.ts` already had the
         try/catch half of this and this route had neither half, so a network throw here
         became an unhandled rejection and a bare 500 rather than something the client
         could act on. */
      signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
    });
  } catch {
    /* The same shape `app/relay/route.ts` returns for the same condition, and for the same
       reason: `proxyFetch` (lib/api/client.ts) treats 502 as a failover trigger, which is
       exactly what it would have concluded from the network throw this is standing in for.
       A timeout and a refused connection are one answer here — the line is not answering. */
    return Response.json(
      { success: false, message: 'PicPony 接口暂时不可用' },
      { status: 502 },
    );
  }

  const secure = isSecureRequest(request);
  const responseHeaders = new Headers();
  upstream.headers.forEach((value, key) => {
    // Set-Cookie can repeat, so it is copied separately via getSetCookie().
    if (key === 'set-cookie') return;
    if (!SKIP_RESPONSE_HEADERS.has(key)) responseHeaders.set(key, value);
  });
  for (const cookie of upstream.headers.getSetCookie()) {
    responseHeaders.append('set-cookie', secure ? cookie : downgradeCookie(cookie));
  }

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
export const PUT = proxy;
export const PATCH = proxy;
export const DELETE = proxy;
export const OPTIONS = proxy;
