import { NextResponse, type NextRequest } from 'next/server';

/**
 * The original front end's thread share link, `/?post=N` — its 分享 copied that form, so such
 * links are out in chats and posts. A link inside a post already routes (`inAppHref`); this is
 * the cold arrival, which landed on the gallery.
 *
 * **A proxy rather than a `next.config.ts` redirect**, because a config redirect passes the
 * request's query on: it answered `/forum/5?post=5`. Here the address is built clean. The matcher
 * keeps every other request out of this file, the home page's included.
 */
export function proxy(request: NextRequest) {
  const post = request.nextUrl.searchParams.get('post') ?? '';
  if (!/^\d+$/.test(post)) return NextResponse.next();
  return NextResponse.redirect(new URL(`/forum/${post}`, request.url), 307);
}

export const config = {
  matcher: [{ source: '/', has: [{ type: 'query', key: 'post' }] }],
};
