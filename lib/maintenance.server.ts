import { cache } from 'react';
import { cookies } from 'next/headers';
import { SITE_STATUS_CACHE_TAG } from '@/lib/constants';
import { cacheSeconds } from '@/lib/serverMemo';
import type { MaintenanceStatus } from '@/lib/types/site';
import { upstreamOrigin } from '@/lib/upstream.server';

/**
 * Whether the site is in maintenance, read on the server so a visitor's first byte is the
 * maintenance screen rather than an app that then fails every request (`app/layout.tsx`).
 *
 * **What it reads.** The public `GET /api/v1/maintenance-status` (`site::public_maintenance`),
 * which answers guests and this session-less read alike with `{maintenance_mode,
 * maintenance_message}` — the message is `''` whenever maintenance is off. The route policy is a
 * separate document (`lib/route.server.ts`); the two do not share a cache entry.
 *
 * **Fails open.** A refusal, a timeout or an unreadable body all mean "not in
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
/** Bounds the development preview cookie's message (the backend's own cap is the same). */
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
    const res = await fetch(`${UPSTREAM_ORIGIN}/api/v1/maintenance-status`, {
      next: { revalidate: cacheSeconds(SERVER_STATUS_REVALIDATE_S), tags: [SITE_STATUS_CACHE_TAG] },
      signal: AbortSignal.timeout(SERVER_STATUS_TIMEOUT_MS),
    });
    if (!res.ok) return OPEN;
    const data = (await res.json()) as MaintenanceStatus;
    if (!data.maintenance_mode) return OPEN;
    /* The backend caps the message at 500 characters and rejects control characters. */
    return { active: true, message: data.maintenance_message.trim() };
  } catch {
    return OPEN;
  }
});
