import { isApiError } from './errors';
import { api, seg } from './http';

export interface ClaimBadgeResult {
  success: boolean;
  badge_name?: string;
  error?: string;
}

/**
 * Claim a campaign badge: `POST /me/badges/claims/{token}` (`badges::claim`), the signed-in user in
 * the session, the link's token in the path. Keep this mutation out of the admin namespace and
 * never retry it implicitly.
 *
 * Three answers, and the difference is load-bearing:
 * - claimed — `{ id, name }`;
 * - refused — a 4xx the backend explains (`BADGE_LINK_UNAVAILABLE`, `BADGE_ALREADY_CLAIMED`,
 *   `BADGE_ALREADY_OWNED`, `BADGE_LOCATION_REQUIRED`, a malformed token): `success: false` with
 *   its sentence;
 * - unknown — a network failure, a 5xx, a rate limit or a dead session throws, because whether the
 *   claim was applied is then unknown, which is a different thing to tell the user than "refused".
 */
export async function claimBadge(userToken: string, claimToken: string): Promise<ClaimBadgeResult> {
  try {
    const claimed = await api<{ id: number; name: string }>('POST', `/me/badges/claims/${seg(claimToken)}`, {
      token: userToken,
    });
    return { success: true, badge_name: claimed.name };
  } catch (error) {
    if (
      isApiError(error) && error.kind === 'http' && error.status !== undefined &&
      error.status >= 400 && error.status < 500 && error.status !== 401 && error.status !== 429
    ) {
      return { success: false, error: error.serverMessage ?? error.message };
    }
    throw error;
  }
}
