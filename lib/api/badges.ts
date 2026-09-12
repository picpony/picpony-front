import { PICPONY_API_BASE } from '@/lib/constants';

export interface ClaimBadgeResult {
  success: boolean;
  badge_name?: string;
  error?: string;
}

/** The existing public site's user_claim_badge contract: the authenticated user
 *  is in the Authorization header; `token` in the body is the badge-link token.
 *  Keep this mutation out of the admin namespace and never retry it implicitly. */
export async function claimBadge(userToken: string, claimToken: string): Promise<ClaimBadgeResult> {
  const response = await fetch(`${PICPONY_API_BASE}?action=user_claim_badge`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${userToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ token: claimToken }),
  });
  const data: unknown = await response.json();
  if (!data || typeof data !== 'object' || !('success' in data)) {
    throw new Error('徽章领取响应无效');
  }
  const result = data as Record<string, unknown>;
  return {
    success: response.ok && result.success === true,
    badge_name: typeof result.badge_name === 'string' ? result.badge_name : undefined,
    error: typeof result.error === 'string' ? result.error : undefined,
  };
}
