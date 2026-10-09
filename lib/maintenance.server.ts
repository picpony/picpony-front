import { cache } from 'react';
import { cookies } from 'next/headers';
import { PICPONY_API_BASE, SITE_STATUS_CACHE_TAG } from '@/lib/constants';
import { cacheSeconds } from '@/lib/serverMemo';
import type { SiteStatusResponse } from '@/lib/types/site';
import { upstreamOrigin } from '@/lib/upstream.server';

/**
 * Whether the site is in maintenance, read on the server so a visitor's first byte is the
 * maintenance screen rather than an app that then fails every request (`app/layout.tsx`).
 *
 * **The same document, the same request.** It is the status document `lib/route.server.ts`
 * reads for the route policy, at the same URL and with the same request options, so the two
 * reads share one Data Cache entry: Next keys that cache on the URL and the request options,
 * not on the `next` or `signal` fields, and serialises concurrent misses on one key. With
 * caching switched off (the audits' TTL override) they are two requests.
 *
 * **Fails open.** A timeout, an HTML error page or a missing field all mean "not in
 * maintenance": a status read that is slow or broken must never lock every visitor out. The
 * bound, reuse window and invalidation tag are the route policy's own. An accepted local
 * admin write expires that tag before the next document reads it.
 */

export interface MaintenanceState {
  active: boolean;
  /** The administrator's message, or `''` for the screen's own default. */
  message: string;
}

const OPEN: MaintenanceState = { active: false, message: '' };

const SERVER_STATUS_TIMEOUT_MS = 1500;
const SERVER_STATUS_REVALIDATE_S = 30;
/** The message is typed into an admin field; a runaway one is cut rather than trusted. */
const MAX_MESSAGE_LENGTH = 500;

const UPSTREAM_ORIGIN = upstreamOrigin();

/** Development only: a browser carrying this cookie is shown maintenance with the cookie's
 *  value as the message (empty for the default), so the screen and the staff path can be
 *  exercised without flipping the shared backend's switch for everyone. The branch is
 *  compiled out of a production build. */
const DEV_PREVIEW_COOKIE = 'devMaintenancePreview';

/** Once per request, however many server components ask. */
export const readMaintenance = cache(async (): Promise<MaintenanceState> => {
  if (process.env.NODE_ENV === 'development') {
    const preview = (await cookies()).get(DEV_PREVIEW_COOKIE)?.value;
    if (preview !== undefined) {
      let message = preview;
      try {
        message = decodeURIComponent(preview);
      } catch {
        /* Not percent-encoded: taken as typed. */
      }
      return { active: true, message: message.slice(0, MAX_MESSAGE_LENGTH) };
    }
  }
  try {
    const res = await fetch(`${UPSTREAM_ORIGIN}${PICPONY_API_BASE}?action=get_maintenance_status`, {
      next: { revalidate: cacheSeconds(SERVER_STATUS_REVALIDATE_S), tags: [SITE_STATUS_CACHE_TAG] },
      signal: AbortSignal.timeout(SERVER_STATUS_TIMEOUT_MS),
    });
    if (!res.ok) return OPEN;
    const data = (await res.json()) as SiteStatusResponse;
    if (data?.success !== true || data.maintenance_mode !== true) return OPEN;
    const message = typeof data.maintenance_message === 'string' ? data.maintenance_message.trim() : '';
    return { active: true, message: message.slice(0, MAX_MESSAGE_LENGTH) };
  } catch {
    return OPEN;
  }
});
