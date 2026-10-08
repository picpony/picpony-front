'use client';

import {
  addTagSubscription,
  isAlreadySubscribed,
  markTagSubscriptionSeen,
  normaliseTagName,
  removeTagSubscription,
  TAG_NOT_FOUND_MESSAGE,
  type TagSubscription,
} from '@/lib/api/tagSubscriptions';
import { ApiError, apiErrorMessage } from '@/lib/api/errors';
import { formatCount } from '@/lib/format';
import { readToken, useSession } from '@/lib/hooks';
import { SKIP, useResource } from '@/lib/resource';
import { derpiTagCount, tagSubscriptions } from '@/lib/resources';
import { warmTagName } from './useTagNames';

/**
 * The sentence for an action withheld because the account changed while it was being asked
 * for — a confirmation open in this tab while another signed out or in. Nothing was sent, so it
 * is not "订阅失败" / "取消订阅失败": no request failed.
 */
export const SESSION_CHANGED_MESSAGE = '登录状态已变化，请重试';

/**
 * How long a subscribe that is about to show its row waits for the tag's Chinese name, past the
 * write itself (the two are asked for together). Long enough for the dictionary's usual answer,
 * short enough that a slow one costs the busy button little: the row then arrives holding the
 * name's place and the name follows.
 */
const NAME_GRACE_MS = 500;

/**
 * What every surface that subscribes, unsubscribes or opens a subscription shares: the
 * /subscriptions list, its gallery, and the tag dialog (`TagInfoModal`). Each corrects the
 * `tagSubscriptions` entry in place, so the list, the gallery's button and the drawer's count
 * move together without a re-read.
 */

/** The subscription for `tag` in a list, matched as Derpibooru matches names. */
export function findSubscription(list: readonly TagSubscription[] | undefined, tag: string): TagSubscription | undefined {
  const wanted = normaliseTagName(tag);
  return list?.find((entry) => normaliseTagName(entry.tagName) === wanted);
}

export { subscriptionHref, tagFromSegment } from './href';

/** Σ new pictures across the subscriptions — the drawer row's count. Nothing signed out. */
export function useSubscriptionUpdates(): number {
  const { token } = useSession();
  const read = useResource(tagSubscriptions, token ? { token } : SKIP);
  return token ? (read.data ?? []).reduce((sum, entry) => sum + entry.newCount, 0) : 0;
}

function writeList(token: string, change: (list: TagSubscription[]) => TagSubscription[]) {
  /* Only over an answer that exists: a write onto nothing would stand in for a list never read. */
  if (tagSubscriptions.peek({ token }).data === undefined) return;
  tagSubscriptions.write({ token }, (previous) => change([...(previous ?? [])]));
}

export type SubscribeOutcome =
  | { kind: 'done'; tagName: string; count: number; aliasOf: string | null }
  | { kind: 'exists'; tagName: string }
  | { kind: 'not-found' }
  /** The account changed between the lookup and the write: nothing was written. */
  | { kind: 'stale-session' }
  | { kind: 'failed'; message: string };

/** `promise`, or nothing once `ms` have passed — whichever comes first. Never rejects. */
function within(promise: Promise<unknown>, ms: number): Promise<void> {
  return new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, ms);
    void promise.then(
      () => {
        clearTimeout(timer);
        resolve();
      },
      () => {
        clearTimeout(timer);
        resolve();
      },
    );
  });
}

/**
 * Subscribe, in the original front end's two steps: the live count from Derpibooru first — it
 * is what the subscription starts from — then `add_tag_subscription` with it.
 *
 * The lookup is a Derpibooru-lane read (`derpiTagCount`), forced fresh: a count from before the
 * last minute's uploads would report them as new on the next sync. An alias is subscribed under
 * the tag it stands for (`lookupDerpiTag`).
 *
 * `awaitName` is for a caller whose list shows the new row (the /subscriptions field): the tag's
 * Chinese name is asked for beside the write and briefly waited for (`NAME_GRACE_MS`), so the
 * row arrives already named instead of arriving as `twilight sparkle` and renaming itself
 * (M1-017). It moves the list's own lookup earlier; it adds none (`warmTagName`).
 */
export async function subscribeToTag(
  token: string,
  tag: string,
  { awaitName = false }: { awaitName?: boolean } = {},
): Promise<SubscribeOutcome> {
  let found;
  try {
    found = await derpiTagCount.read({ tag }, { force: true });
  } catch (error) {
    if (error instanceof ApiError && error.notFound) return { kind: 'not-found' };
    return { kind: 'failed', message: apiErrorMessage(error, '标签收录量查询失败') };
  }
  if (readToken() !== token) return { kind: 'stale-session' };
  const naming = awaitName ? warmTagName(found.name) : null;
  try {
    await addTagSubscription(token, found.name, found.count);
  } catch (error) {
    if (isAlreadySubscribed(error)) return { kind: 'exists', tagName: found.name };
    return { kind: 'failed', message: apiErrorMessage(error, '订阅失败') };
  }
  if (naming) await within(naming, NAME_GRACE_MS);
  writeList(token, (list) =>
    findSubscription(list, found.name)
      ? list
      : [...list, { tagName: found.name, imageCount: found.count, newCount: 0 }],
  );
  return { kind: 'done', tagName: found.name, count: found.count, aliasOf: found.aliasOf };
}

/** `remove_tag_subscription`; throws an `ApiError` carrying the backend's words on refusal. */
export async function unsubscribeFromTag(token: string, tagName: string): Promise<void> {
  await removeTagSubscription(token, tagName);
  const wanted = normaliseTagName(tagName);
  writeList(token, (list) => list.filter((entry) => normaliseTagName(entry.tagName) !== wanted));
}

export type UnsubscribeOutcome =
  | { kind: 'done' }
  /** The account changed while the confirmation was open: nothing was sent. */
  | { kind: 'stale-session' }
  /** The sentence to show, already saying what failed. */
  | { kind: 'failed'; message: string };

/**
 * 取消订阅 once its confirmation has been answered. The session is read again first: a
 * confirmation can outlive the session that opened it (another tab signs out or in), and the
 * removal must not go out on the token captured before it — the subscribe step above and the
 * shop's checkout check the same way (G3-018).
 */
export async function unsubscribeConfirmed(token: string, tagName: string): Promise<UnsubscribeOutcome> {
  if (readToken() !== token) return { kind: 'stale-session' };
  try {
    await unsubscribeFromTag(token, tagName);
    return { kind: 'done' };
  } catch (error) {
    return { kind: 'failed', message: failureSentence('取消订阅失败', apiErrorMessage(error)) };
  }
}

/**
 * Seen-marks on their way. A second call for the same subscription before the first settles
 * sends nothing: an effect runs twice in development, and a render can come between the
 * corrected list being written and its being published.
 */
const seenInFlight = new Set<string>();

/**
 * The subscription's new pictures have been opened: its count drops at once, here and in the
 * drawer, and the backend is told. A failure is the original front end's too — ignored: the
 * next read of the list brings the count back, which is the honest result.
 */
export function markSubscriptionSeen(token: string, tagName: string): void {
  const wanted = normaliseTagName(tagName);
  const key = `${token}\n${wanted}`;
  if (seenInFlight.has(key)) return;
  seenInFlight.add(key);
  writeList(token, (list) =>
    list.map((entry) => (normaliseTagName(entry.tagName) === wanted ? { ...entry, newCount: 0 } : entry)),
  );
  void markTagSubscriptionSeen(token, tagName)
    .catch(() => {})
    .finally(() => seenInFlight.delete(key));
}

/** `<what>：<why>` — unless the backend's own words already begin by saying what failed. */
export function failureSentence(what: string, why: string): string {
  return why.startsWith(what) ? why : `${what}：${why}`;
}

/** The toast a subscribe outcome is worth, as `[message, tone]`. */
export function subscribeMessage(outcome: SubscribeOutcome): [string, 'success' | 'warning' | 'error'] {
  switch (outcome.kind) {
    case 'done':
      return [
        outcome.aliasOf
          ? `「${outcome.aliasOf}」是「${outcome.tagName}」的别名，已订阅「${outcome.tagName}」`
          : `已订阅「${outcome.tagName}」，当前记录 ${formatCount(outcome.count)} 张图片`,
        'success',
      ];
    case 'exists':
      return [`标签「${outcome.tagName}」已在订阅中`, 'warning'];
    case 'not-found':
      return [TAG_NOT_FOUND_MESSAGE, 'warning'];
    case 'stale-session':
      return [SESSION_CHANGED_MESSAGE, 'warning'];
    case 'failed':
      return [failureSentence('订阅失败', outcome.message), 'error'];
  }
}
