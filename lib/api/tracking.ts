import { apiRequest } from './http';

/**
 * Anonymous visit counting (`track_visitor`, decision 15): `POST /api/v1/site-visits
 * {visitor_id, path?}` → 204 (`site::track_visit`). The backend keeps only a hash of the id per
 * Asia/Shanghai day and when it was last seen, validates `path` (≤ 512 bytes, starting with `/`,
 * no control characters) without storing it, rate-limits per visitor and per peer, and does not
 * count a request that carries `Authorization` — so the beacon is sent with no token
 * (`components/VisitorTracker.tsx` already skips a signed-in visitor, `lib/visitor.ts`). The
 * route takes no session and therefore no CSRF token.
 */
export const VISITOR_TRACKING_AVAILABLE = true;

/** A count is statistics, never worth holding a page for: bounded, and allowed to outlive it. */
const TRACK_TIMEOUT_MS = 5000;

/** Fire and forget: resolves once the request settled, and never rejects. */
export async function trackVisitor(visitorId: string, path: string): Promise<void> {
  try {
    const response = await apiRequest('POST', '/site-visits', {
      json: { visitor_id: visitorId, path },
      keepalive: true,
      cache: 'no-store',
      timeoutMs: TRACK_TIMEOUT_MS,
    });
    /* Nothing to read (204, or a refusal nobody is shown); drained so the connection is freed. */
    await response.body?.cancel().catch(() => {});
  } catch {
    /* A dead line or a timeout: this count is simply lost. */
  }
}
