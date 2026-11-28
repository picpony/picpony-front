import { ApiError } from './errors';
import { randomId } from '@/lib/utils';

/**
 * `Idempotency-Key`s for writes a person may press again (a post, a reply, a purchase).
 *
 * A key names one intended write. The backend answers the same key with the same body by
 * replaying the first result, so a press that follows a *lost* answer — the write may have
 * happened — reuses the key and cannot write twice; a changed body, or a press after a definite
 * answer (success or refusal), is a new write and gets a new key.
 */
export function createRetryKeys() {
  const pending = new Map<string, { body: string; key: string }>();
  return {
    /** The key for writing `body` under `scope` (a thread, a draft): the lost one's, if it matches. */
    key(scope: string, body: unknown): { key: string; settle: (error?: unknown) => void } {
      const text = JSON.stringify(body);
      const lost = pending.get(scope);
      const key = lost && lost.body === text ? lost.key : randomId();
      return {
        key,
        settle(error?: unknown) {
          if (error !== undefined && !isDefiniteRefusal(error)) pending.set(scope, { body: text, key });
          else pending.delete(scope);
        },
      };
    },
  };
}

/** A 4xx other than 408 / 429 is the backend's verdict: nothing was written. */
export function isDefiniteRefusal(error: unknown): boolean {
  if (!(error instanceof ApiError) || error.kind !== 'http' || error.status === undefined) return false;
  return error.status >= 400 && error.status < 500 && error.status !== 408 && error.status !== 429;
}
