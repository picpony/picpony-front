'use client';

import { SKIP, useResource } from '@/lib/resource';
import { sessionUser } from '@/lib/resources';
import { readUserInfo, updateUserInfo, useSession, type StoredUserInfo } from '@/lib/hooks';

/**
 * The signed-in account as /settings shows it.
 *
 * **The stored session first, the read second.** The session already holds every field the
 * account rows show (the shell folds each `get_user` answer into it), so the rows paint from it at
 * once; the read — the same `sessionUser` entry the shell reads, so no second request — only says
 * whether that copy is current. A read that fails is said so above the rows ("账户信息加载失败",
 * with 重试), rather than the rows reporting the email and the API key as missing, which is what
 * they did when this screen held only what its own fetch returned.
 */
export interface Account {
  token: string;
  record: StoredUserInfo;
  /** `loading` until the first answer of this session; `error` if it failed or was unreadable. */
  status: 'loading' | 'ready' | 'error';
  error: unknown;
  retry: () => void;
}

export function useAccount(): Account | null {
  const { user, token } = useSession();
  const read = useResource(sessionUser, token ? { token } : SKIP);
  if (!user || !token) return null;
  const answered = read.data?.kind === 'ok';
  const status: Account['status'] =
    read.error !== undefined || read.data?.kind === 'unreadable'
      ? 'error'
      : answered || !read.isLoading
        ? 'ready'
        : 'loading';
  return { token, record: user, status, error: read.error, retry: read.refresh };
}

/**
 * Fold a successful change into the session and the cached read together, for the current account
 * only — so neither a stale read nor a response for a previous login can replay over it.
 */
export function saveAccountFields(token: string, fields: Record<string, unknown>): boolean {
  const current = readUserInfo();
  if (!current || current.token !== token) return false;
  const cached = sessionUser.peek({ token }).data;
  if (cached?.kind === 'ok') sessionUser.write({ token }, { kind: 'ok', user: { ...cached.user, ...fields } });
  return updateUserInfo(token, fields);
}

export const text = (value: unknown): string => (typeof value === 'string' ? value : '');

/** The account's profile version (`profile_revision` from `GET /me`), which a profile or name change names. */
export function profileRevision(record: StoredUserInfo | null): number {
  return typeof record?.profile_revision === 'number' ? record.profile_revision : 0;
}

/**
 * **A signed-in account's bound address is verified.** The backend signs nobody in whose address is
 * not (`auth::authenticate` requires `email_verified`), and an address change replaces the bound one
 * only once its code is confirmed — until then the old address stays bound and verified.
 *
 * The one pending state is a change this app began: `POST /me/email-changes` answered with a
 * `verification`, and the code went to the new address. It is held as `EMAIL_PENDING` (the new
 * address) and `EMAIL_PENDING_VERIFICATION` (the request's id) until the code is accepted, and only
 * the session that asked can confirm it.
 */
export const EMAIL_PENDING = 'email_pending';
export const EMAIL_PENDING_VERIFICATION = 'email_pending_verification';

export function emailVerified(record: StoredUserInfo): boolean {
  return text(record.email) !== '';
}

/** The address change awaiting its code, if this session began one. */
export function pendingEmailChange(record: StoredUserInfo): { email: string; verification: string } | null {
  const email = text(record[EMAIL_PENDING]);
  const verification = text(record[EMAIL_PENDING_VERIFICATION]);
  return email && verification ? { email, verification } : null;
}
