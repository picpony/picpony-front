import { ApiError } from './errors';
import { envelopeMessage, picponyPostJson, readObject } from './http';

export interface ClaimBadgeResult {
  success: boolean;
  badge_name?: string;
  error?: string;
}

/** The existing public site's user_claim_badge contract: the authenticated user
 *  is in the Authorization header; `token` in the body is the badge-link token.
 *  Keep this mutation out of the admin namespace and never retry it implicitly.
 *
 *  A body that is not the badge envelope — an HTML error page, an empty 502 — throws
 *  `ApiError('invalid')` rather than reporting a refusal: whether the claim was applied is
 *  then unknown, which is a different thing to tell the user than "it was refused". */
export async function claimBadge(userToken: string, claimToken: string): Promise<ClaimBadgeResult> {
  const response = await picponyPostJson('user_claim_badge', { token: claimToken }, { token: userToken });
  const result = await readObject<Record<string, unknown>>(response);
  if (!('success' in result)) throw new ApiError('invalid', { status: response.status });
  return {
    success: response.ok && result.success === true,
    badge_name: typeof result.badge_name === 'string' ? result.badge_name : undefined,
    error: result.success === true && response.ok ? undefined : envelopeMessage(result),
  };
}
