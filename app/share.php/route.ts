import type { NextRequest } from 'next/server';
import { upstreamOrigin } from '@/lib/upstream.server';

/**
 * PicPony's short links (`share.php?id=<share_id>`) on this origin — the ones `lib/api/share.ts`
 * makes through the Rust backend's share-link resource, and the ones the PHP site handed out
 * before the move (their rows carry over in `share_links`).
 *
 * **A visited link is redirected, not proxied**, to the backend's preview page,
 * `GET /api/v1/share-links/{id}/page`: the metadata a chat app reads, then the way on to the
 * target. That page is built from a title and description anybody could store, so it is served
 * from the backend's own origin (sandboxed, no script) and never from this one, which holds the
 * session token; a chat app's preview follows the redirect to it. The page's only way out is the
 * stored same-site target — the backend refuses any other target when a link is made, and checks
 * the origin again when it is read, so a short link is never an open redirect.
 *
 * The answer carries the backend proxy's sandbox, which stands because `next.config.ts`'s
 * `headers()` excludes `/share.php`: a policy set there replaces a route handler's own rather
 * than adding to it. Making a link is `POST /api/v1/share-links` (the `/api/v1` proxy), so
 * anything but a visited, well-formed link answers 404 here.
 */

const POLICY = "sandbox; default-src 'none'; frame-ancestors 'none'";

/** The backend's share id: base64url, as both the PHP and the Rust backends mint them. */
const SHARE_ID = /^[A-Za-z0-9_-]{16,64}$/;

function answer(request: NextRequest): Response {
  const id = request.nextUrl.searchParams.get('id') ?? '';
  if ((request.method === 'GET' || request.method === 'HEAD') && SHARE_ID.test(id)) {
    const page = new URL(`/api/v1/share-links/${encodeURIComponent(id)}/page`, upstreamOrigin());
    return new Response(null, {
      status: 302,
      headers: { Location: page.href, 'Cache-Control': 'private, no-store', 'Content-Security-Policy': POLICY },
    });
  }
  return Response.json(
    { error: { code: 'SHARE_LINK_NOT_FOUND', message: '分享链接无效' } },
    { status: 404, headers: { 'Cache-Control': 'private, no-store', 'Content-Security-Policy': POLICY } },
  );
}

export const dynamic = 'force-dynamic';

export const GET = answer;
export const HEAD = answer;
export const POST = answer;
