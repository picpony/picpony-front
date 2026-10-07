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

/**
 * **A signed-in account's bound address is verified.** The original front end showed it that way:
 * its settings badge read 已验证 whenever the session had an address, and it read no flag at all.
 * The backend agrees:
 * - registration verifies the address before it issues a token;
 * - an account older than verification is verified as far as it is concerned, and
 *   `resend_verify_code` answers it 已验证.
 *
 * The `email_verified` column proves nothing either way. It is 0 on 40 of 44 older accounts
 * (C3's probe of public profiles), which showed as 未验证 and offered a code that the backend
 * then refused.
 *
 * The one unverified state is one this app saw begin: a change whose answer said a code was sent.
 * It is held as `EMAIL_PENDING`, the address the code went to, until the code is accepted.
 */
export const EMAIL_PENDING = 'email_pending';

export function emailVerified(record: StoredUserInfo): boolean {
  const email = text(record.email);
  return email !== '' && record[EMAIL_PENDING] !== email;
}

/** The backend's answer that there is nothing to verify: taken as the verification it reports. */
export const saysAlreadyVerified = (message: string): boolean => /已验证|已经验证|无需(?:再次|重复)?验证/.test(message);
