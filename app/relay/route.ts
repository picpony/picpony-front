import type { NextRequest } from 'next/server';
import { PICPONY_API_ORIGIN, PICPONY_RELAY_UPSTREAM } from '@/lib/constants';

/**
 * Server-side hop for the `picpony_api` request line.
 *
 * The relay at `cdn.picpony.top/relay` enforces an `Origin` allowlist of
 * `picpony.top` and `www.picpony.top` and answers everything else
 * `403 {"error":"Origin not allowed"}` — so the browser cannot use that line from
 * this app's origin at all, and a line the administrator can force site-wide has to
 * be reachable. This handler is that reachability: it forwards from the server, where
 * the `Origin` is ours to set.
 *
 * It is **not** a general proxy, and the difference is the whole security argument.
 * The relay takes a `url` parameter, so passing one through unchecked would publish an
 * open URL forwarder on this origin: anything on the server's network, any third party,
 * any credential-bearing internal address. `ALLOWED_HOSTS` is what keeps it to the one
 * job it exists for. No user authentication is required — the relay wants none, and the
 * data behind it is Derpibooru's public API — but the target is not negotiable.
 *
 * `GET` and `HEAD` only. The relay is a read path, and the accel line's worker already
 * rejects other methods, so an upload never travels a line at all
 * (`applyApiLineToWrite` in `lib/route.ts`).
 */

/** The two names Derpibooru answers on, and nothing else. */
const ALLOWED_HOSTS = new Set(['derpibooru.org', 'trixiebooru.org']);
/** And only its API. */
const ALLOWED_PATH = '/api/';
/* Long enough for a slow upstream on a bad link, short enough that a wedged one cannot hold a
   Node connection for the platform's whole socket lifetime. Matches the api.php handler. */
const RELAY_TIMEOUT_MS = 30_000;
/** `xp_user` is the relay's per-user accounting label. Bounded, because it is unauthenticated. */
const XP_USER_MAX = 64;
const XP_USER_OK = /^[\w.-]+$/;

const SKIP_RESPONSE_HEADERS = new Set([
  'connection',
  'keep-alive',
  'transfer-encoding',
  'upgrade',
  'content-encoding',
  'content-length',
  /* The relay answers with our server's Origin echoed back; re-emitting it would
     describe a cross-origin exchange the browser is not making. */
  'access-control-allow-origin',
  'access-control-allow-credentials',
  'vary',
]);

function badRequest(message: string): Response {
  return Response.json({ success: false, message }, { status: 400 });
}

async function relay(request: NextRequest): Promise<Response> {
  const raw = request.nextUrl.searchParams.get('url');
  if (!raw) return badRequest('缺少 url 参数');

  let target: URL;
  try {
    target = new URL(raw);
  } catch {
    return badRequest('url 参数不是合法地址');
  }
  /* Host, protocol, port, credentials and path all have to be right. The host check alone is
     not enough: nothing else restricts the path, and every upstream header except the skip
     list is copied through — including `content-type`. So a bare `?url=https://derpibooru.org/`
     would serve third-party HTML *from this origin*, on an unauthenticated GET, in the origin
     that holds the session token. Credentials are rejected rather than stripped, matching
     `validThirdPartyOrigin` in `lib/route.ts`. */
  if (
    target.protocol !== 'https:' ||
    !ALLOWED_HOSTS.has(target.hostname) ||
    target.port !== '' ||
    target.username !== '' ||
    target.password !== '' ||
    !target.pathname.startsWith(ALLOWED_PATH)
  ) {
    return badRequest('url 参数不在允许的范围内');
  }

  const upstream = new URL(PICPONY_RELAY_UPSTREAM);
  upstream.searchParams.set('url', target.toString());
  const xpUser = request.nextUrl.searchParams.get('xp_user');
  if (xpUser && xpUser.length <= XP_USER_MAX && XP_USER_OK.test(xpUser)) {
    upstream.searchParams.set('xp_user', xpUser);
  }

  let response: Response;
  try {
    response = await fetch(upstream, {
      /* Bounded, for the reason `app/api.php/[[...path]]/route.ts` states about itself — and
         this route needs it more, not less. `picpony_api` is the *default* line, a forced or
         defaulted policy has no failover, and `proxyFetch` retries it three times in place, so
         a wedged `cdn.picpony.top` holds three Node connections per client request for the
         platform's socket lifetime with nothing bounding them. */
      signal: AbortSignal.timeout(RELAY_TIMEOUT_MS),
      method: request.method,
      headers: {
        /* The allowlist the relay checks. Also the reason this handler exists. */
        Origin: PICPONY_API_ORIGIN,
        Referer: `${PICPONY_API_ORIGIN}/`,
        Accept: request.headers.get('accept') ?? 'application/json',
        'User-Agent': request.headers.get('user-agent') ?? 'PicPony/1.0',
      },
      redirect: 'manual',
      cache: 'no-store',
    });
  } catch {
    /* A dead line, reported as one. `proxyFetch` treats 502 as a failover trigger,
       which is the same thing it would have concluded from a network throw. */
    return Response.json({ success: false, message: 'PicPony API 线路不可用' }, { status: 502 });
  }

  /* A redirect is not passed on. `redirect: 'manual'` gives us the 3xx and its `Location`, and
     the browser's own fetch defaults to following — straight to `cdn.picpony.top`, whose
     `Origin` check is the entire reason this handler exists, so the browser would get a 403
     with no CORS headers and the line would read as dead for an obscure reason. Reported as a
     bad upstream instead, which `proxyFetch` already knows how to fail over from. */
  if (response.status >= 300 && response.status < 400) {
    return Response.json({ success: false, message: 'PicPony API 线路返回了重定向' }, { status: 502 });
  }

  const headers = new Headers();
  response.headers.forEach((value, key) => {
    if (key === 'set-cookie') return;
    if (!SKIP_RESPONSE_HEADERS.has(key)) headers.set(key, value);
  });

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

export const dynamic = 'force-dynamic';

export const GET = relay;
export const HEAD = relay;
