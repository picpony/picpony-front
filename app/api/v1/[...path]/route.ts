import type { NextRequest } from 'next/server';
import { revalidateTag } from 'next/cache';
import {
  BLOCK_FILTERS_CACHE_TAG,
  PUBLIC_BLACKLIST_CACHE_TAG,
  clearBlockFiltersMemo,
  clearPublicBlacklistMemo,
} from '@/lib/blockFilters.server';
import { COOKIE_KEYS, SITE_STATUS_CACHE_TAG } from '@/lib/constants';
import { clientAddressHeaders, forwardableResponseHeaders } from '@/lib/proxyHeaders';
import { upstreamOrigin } from '@/lib/upstream.server';

/**
 * Reverse proxy for the PicPony Rust backend (`/api/v1`, api.picpony.top).
 *
 * Same-origin on purpose: the backend binds a session to an `HttpOnly` `auth_bind` cookie it sets
 * on login, and sends no CORS headers, so the browser must reach it as this origin.
 *
 * The backend sets `auth_bind=...; HttpOnly; SameSite=Lax; Secure` (on an https public base), and
 * a browser silently discards a `Secure` cookie when the page origin is not a secure context —
 * over plain HTTP (a LAN address from a phone) every write would then fail its session binding.
 * So: when the request did not reach us over HTTPS, drop `Secure` on the way back out. Over
 * HTTPS every header passes through untouched.
 */

// The same server-controlled staging/fixture origin used by the server readers. Never a
// request parameter: the public proxy still has one fixed backend and one fixed API path.
const UPSTREAM_ORIGIN = upstreamOrigin();
const UPSTREAM_PATH = '/api/v1';

/**
 * Upstream timeout. Generous by design, unlike `lib/route.server.ts`'s 1500ms: that one
 * bounds a *document* every visitor pays for; this bounds a request the client is
 * explicitly waiting on, where the guarded failure is a connection that never closes.
 * The backend's observed latency is ~9s under load, so anything much under 20s would
 * turn a slow answer into a failover.
 */
const UPSTREAM_TIMEOUT_MS = 30_000;

/**
 * A request **body** is not bounded by `UPSTREAM_TIMEOUT_MS` (review P1-F1). The backend answers only
 * after the whole multipart has arrived, so a single 30s budget for body + answer meant a 50MB
 * upload (`POST /me/uploads/works`) needed ≥ 13.3 Mbit/s of upstream bandwidth, and every slower phone saw a
 * 502 that read as an outage. Instead:
 *
 * - while the body is streaming, it must make progress: no chunk for `BODY_IDLE_MS` aborts;
 * - once it has been sent, the answer gets the usual `UPSTREAM_TIMEOUT_MS`;
 * - and the whole exchange is capped at `BODY_TOTAL_MS`, so a trickle cannot hold a connection
 *   forever (Node's own `server.requestTimeout`, 300s by default, may end it sooner).
 */
const BODY_IDLE_MS = 30_000;
const BODY_TOTAL_MS = 15 * 60_000;
/** The abort reason a stalled body carries, so the answer can tell it from a dead upstream. */
const BODY_STALLED = 'request body stalled';

/**
 * Bodies up to this size (every JSON write) are read whole and forwarded with a `Content-Length`.
 * A streamed body goes upstream as `Transfer-Encoding: chunked`, which the WAF in front of the
 * backend (宝塔「拦截分块请求」) blocks outright — and then bans the visitor's address it reads
 * from `X-Forwarded-For`. Multipart uploads and anything declared larger keep streaming (see
 * `BODY_IDLE_MS`) and carry the client's declared `Content-Length` upstream instead.
 */
const BUFFERED_BODY_MAX = 1024 * 1024;
const BODY_TOO_LARGE = 'request body too large';

/** Admin writes that change what the public site status (`get_site_status`) answers. */
const STATUS_RESOURCES = new Set([
  '/admin/api-route-policy',
  '/admin/image-route-policy',
  '/admin/maintenance',
  '/admin/translation',
  '/admin/semantic-search',
  '/admin/semantic-cloud',
]);

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
 * The app's own cookies, which the backend never reads. They are this origin's (theme, motion,
 * the hidden-tag fingerprint, the spoiler list…), and forwarding them sent a visitor's hidden
 * tags upstream with every API call and put kilobytes on requests the backend only needs
 * `auth_bind` from. Everything else in the header passes through untouched.
 */
const APP_COOKIES = new Set<string>(Object.values(COOKIE_KEYS));

function backendCookies(header: string): string {
  return header
    .split(';')
    .map((part) => part.trim())
    .filter((part) => part && !APP_COOKIES.has(part.slice(0, part.indexOf('=') === -1 ? part.length : part.indexOf('=')).trim()))
    .join('; ');
}

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

/**
 * The incoming body, re-streamed so its pace can be watched: aborts `controller` when no chunk
 * arrives for `BODY_IDLE_MS`, and once the last chunk is through, gives the upstream
 * `UPSTREAM_TIMEOUT_MS` to answer. `done()` clears whichever timer is pending.
 */
function pacedBody(body: ReadableStream<Uint8Array>, controller: AbortController) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const arm = (ms: number, reason: string) => {
    clearTimeout(timer);
    timer = setTimeout(() => controller.abort(new DOMException(reason, 'TimeoutError')), ms);
  };
  arm(BODY_IDLE_MS, BODY_STALLED);
  const stream = body.pipeThrough(new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, sink) {
      arm(BODY_IDLE_MS, BODY_STALLED);
      sink.enqueue(chunk);
    },
    flush() {
      arm(UPSTREAM_TIMEOUT_MS, 'upstream did not answer');
    },
  }));
  return { stream, done: () => clearTimeout(timer) };
}

/** True when the body should be buffered rather than streamed (see `BUFFERED_BODY_MAX`). */
function shouldBuffer(request: NextRequest): boolean {
  const type = request.headers.get('content-type')?.toLowerCase() ?? '';
  if (type.startsWith('multipart/')) return false;
  const declared = request.headers.get('content-length');
  if (declared === null) return true; // read with the cap; over it answers 413
  const length = Number(declared);
  return Number.isFinite(length) && length >= 0 && length <= BUFFERED_BODY_MAX;
}

/**
 * Reads a small body whole, under the same pace rule as `pacedBody`: no chunk for `BODY_IDLE_MS`
 * aborts with `BODY_STALLED`. Past `BUFFERED_BODY_MAX` it throws `BODY_TOO_LARGE`.
 */
async function readBounded(body: ReadableStream<Uint8Array>, signal: AbortSignal): Promise<ArrayBuffer> {
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const onAbort = () => void reader.cancel(signal.reason).catch(() => {});
  signal.addEventListener('abort', onAbort, { once: true });
  try {
    for (;;) {
      const stalled = new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new DOMException(BODY_STALLED, 'TimeoutError')), BODY_IDLE_MS);
      });
      const { done, value } = await Promise.race([reader.read(), stalled]).finally(() => clearTimeout(timer));
      if (done) break;
      total += value.byteLength;
      if (total > BUFFERED_BODY_MAX) throw new DOMException(BODY_TOO_LARGE, 'QuotaExceededError');
      chunks.push(value);
    }
  } catch (error) {
    void reader.cancel().catch(() => {});
    throw error;
  } finally {
    clearTimeout(timer);
    signal.removeEventListener('abort', onAbort);
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out.buffer as ArrayBuffer;
}

async function proxy(
  request: NextRequest,
  context: { params: Promise<{ path: string[] }> },
): Promise<Response> {
  const { path } = await context.params;
  /* A decoded catch-all segment must stay a segment. URL normalisation removes dots and
     upstream servers may decode escaped separators again, escaping the /api/v1 namespace. */
  if (path?.some((part) => part === '.' || part === '..' || /[/\\%\u0000-\u001f\u007f]/.test(part))) {
    return Response.json({ error: { code: 'INVALID_PATH', message: '接口路径无效' } }, { status: 400 });
  }
  const suffix = path?.length ? `/${path.map(encodeURIComponent).join('/')}` : '';
  const target = new URL(`${UPSTREAM_PATH}${suffix}`, UPSTREAM_ORIGIN);
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
  /* The visitor's address, for the backend's per-address limits and logs (`clientAddressHeaders`):
     validated and appended rather than passed through as the client wrote it. Note: the Rust
     backend currently limits by its socket peer only (`ConnectInfo`), which behind this proxy is
     this server; it reads neither header yet. */
  const address = clientAddressHeaders(request.headers);
  headers.delete('x-forwarded-for');
  headers.delete('x-real-ip');
  if (address.forwardedFor) headers.set('x-forwarded-for', address.forwardedFor);
  if (address.realIp) headers.set('x-real-ip', address.realIp);

  const hasBody = request.method !== 'GET' && request.method !== 'HEAD' && request.body !== null;

  /* A small body is read whole so it goes upstream with a Content-Length, never chunked
     (see `BUFFERED_BODY_MAX`). */
  let buffered: ArrayBuffer | null = null;
  if (hasBody && shouldBuffer(request)) {
    try {
      buffered = await readBounded(request.body!, request.signal);
    } catch (error) {
      const message = error instanceof DOMException ? error.message : '';
      if (message === BODY_TOO_LARGE) {
        return Response.json(
          { error: { code: 'BODY_TOO_LARGE', message: '请求内容过大' } },
          { status: 413, headers: { 'Cache-Control': 'private, no-store' } },
        );
      }
      if (message === BODY_STALLED) {
        return Response.json(
          { error: { code: 'BODY_STALLED', message: '请求中断，请检查网络后重试' } },
          { status: 408, headers: { 'Cache-Control': 'private, no-store' } },
        );
      }
      /* The client went away mid-body; nobody is left to read an answer. */
      return new Response(null, { status: 499 });
    }
  }

  /* Bounded: without a signal the handler inherits the platform's socket timeout, so a hung
     upstream hangs this route with it, holding a Node connection open. A bodyless or buffered
     request gets one budget; a streamed body gets a pace instead (see `BODY_IDLE_MS`). */
  const streamed = hasBody && buffered === null;
  const paceController = streamed ? new AbortController() : null;
  const paced = streamed && paceController ? pacedBody(request.body!, paceController) : null;
  /* A streamed body with a declared length (every browser upload, XHR or fetch with FormData)
     keeps that length upstream, so it is not sent chunked either. Without one it has to be. */
  const declaredLength = request.headers.get('content-length');
  if (streamed && declaredLength !== null && /^\d+$/.test(declaredLength)) {
    headers.set('content-length', declaredLength);
  }
  let upstream: Response;
  try {
    const init: RequestInit & { duplex: 'half' } = {
      method: request.method,
      headers,
      /* Small bodies go whole (fetch sets Content-Length). Uploads stream with backpressure
         instead of buffering an unauthenticated request of unbounded size in Node. */
      body: buffered ?? (paced ? paced.stream : undefined),
      duplex: 'half',
      redirect: 'manual',
      cache: 'no-store',
      signal: paceController
        ? AbortSignal.any([request.signal, paceController.signal, AbortSignal.timeout(BODY_TOTAL_MS)])
        : AbortSignal.any([request.signal, AbortSignal.timeout(UPSTREAM_TIMEOUT_MS)]),
    };
    upstream = await fetch(target, init);
  } catch {
    paced?.done();
    /* The client's own body stopped arriving while its connection stayed open (review P4-O2): that
       is the visitor's network, not ours, and a 502 read as 「服务暂时不可用」. A 408 is the honest
       status — the request never finished — and `stageUpload` words it as an interrupted upload.
       Nothing reached the backend as a complete request, so nothing happened there. */
    const reason: unknown = paceController?.signal.reason;
    if (reason instanceof DOMException && reason.message === BODY_STALLED) {
      return Response.json(
        { error: { code: 'BODY_STALLED', message: '上传中断，请检查网络后重试' } },
        { status: 408, headers: { 'Cache-Control': 'private, no-store' } },
      );
    }
    /* Same shape `app/relay/route.ts` returns for the same condition: `proxyFetch`
       (lib/api/client.ts) treats 502 as a failover trigger, which is exactly what it
       would have concluded from the network throw this is standing in for. A timeout
       and a refused connection are one answer here — the line is not answering. */
    return Response.json(
      { error: { code: 'UPSTREAM_UNAVAILABLE', message: 'PicPony 接口暂时不可用' } },
      { status: 502 },
    );
  }

  /* Headers are in: the answer's own body is bounded by the total cap, not the pace. */
  paced?.done();

  /* Only a write the backend has actually accepted may invalidate the public search definitions,
     the public image blacklist or the site status. Expire immediately: showing old rules after a
     successful edit can expose a picture the newly saved rules exclude. */
  if (request.method !== 'GET' && request.method !== 'HEAD' && upstream.ok) {
    const resource = suffix;
    if (resource.startsWith('/admin/filters/block-tags')) {
      revalidateTag(BLOCK_FILTERS_CACHE_TAG, { expire: 0 });
      clearBlockFiltersMemo();
    } else if (resource.startsWith('/admin/image-blocklist/')) {
      revalidateTag(PUBLIC_BLACKLIST_CACHE_TAG, { expire: 0 });
      clearPublicBlacklistMemo();
    } else if (STATUS_RESOURCES.has(resource)) {
      revalidateTag(SITE_STATUS_CACHE_TAG, { expire: 0 });
    }
  }

  const secure = isSecureRequest(request);
  /* The shared hop-by-hop rules (`lib/proxyHeaders.ts`); Set-Cookie can repeat, so it is copied
     separately via getSetCookie(). */
  const responseHeaders = forwardableResponseHeaders(upstream.headers);
  for (const cookie of upstream.headers.getSetCookie()) {
    responseHeaders.append('set-cookie', secure ? cookie : downgradeCookie(cookie));
  }
  /* Responses can contain an account or a session. Next's internal no-store does not
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
