'use client';

import { useRef, useState } from 'react';
import Link from 'next/link';
import { MdNotificationsOff, MdRssFeed } from 'react-icons/md';
import Badge from '@/components/Badge';
import EmptyState from '@/components/EmptyState';
import ErrorRetry from '@/components/ErrorRetry';
import IconButton from '@/components/IconButton';
import PageHeader from '@/components/PageHeader';
import PresenceBlock from '@/components/PresenceBlock';
import PresenceList from '@/components/PresenceList';
import SignInRequired from '@/components/SignInRequired';
import Skeleton from '@/components/Skeleton';
import { useConfirm } from '@/components/ConfirmDialog';
import { showToast } from '@/components/Toast';
import { normaliseTagName, type TagSubscription } from '@/lib/api/tagSubscriptions';
import { apiErrorMessage, isRetryable } from '@/lib/api/errors';
import { formatCount } from '@/lib/format';
import { useSession } from '@/lib/hooks';
import { ICON } from '@/lib/icons';
import { SKIP, useResource } from '@/lib/resource';
import { tagSubscriptions } from '@/lib/resources';
import { cn } from '@/lib/utils';
import { SESSION_CHANGED_MESSAGE, subscriptionHref, unsubscribeConfirmed } from './actions';
import NameFade from './NameFade';
import SubscribeField from './SubscribeField';
import { useTagNames } from './useTagNames';

/** A two-line list item's height, so the placeholder rows are the rows' own geometry. */
const ROW = 'm3-row flex min-h-18 items-center bg-surface-container-low';

function RowsSkeleton() {
  return (
    <ul data-page-loading aria-hidden="true">
      {Array.from({ length: 5 }, (_, index) => (
        <li key={index} className={`${ROW} gap-4 px-4 py-3`}>
          <div className="min-w-0 flex-1 space-y-2">
            <Skeleton className="h-5 w-1/3" delay={index * 60} />
            <Skeleton className="h-3.5 w-1/2" delay={index * 60} />
          </div>
          <Skeleton className="size-10 shrink-0 rounded-full" delay={index * 60} />
        </li>
      ))}
    </ul>
  );
}

/**
 * One subscription. While the dictionary is still asked for the tag's Chinese name (`useTagNames`
 * answers `undefined`), the name's place is held by a placeholder in the line it will take and
 * the tag itself is shown where it will end up, in the line under it — the slot's final content is
 * not known yet, and painting the tag in it only to rename it a moment later was the defect
 * (M1-017). The name then fades in (`NameFade`). A tag the dictionary has no name for takes the
 * first line itself, and both lines fade to their final words.
 */
function SubscriptionRow({
  presenceKey,
  entry,
  chinese,
  onRemove,
}: {
  presenceKey: string;
  entry: TagSubscription;
  chinese: string | null | undefined;
  onRemove: () => void;
}) {
  const asking = chinese === undefined;
  const name = chinese ?? entry.tagName;
  return (
    <li data-presence-key={presenceKey} className={`${ROW} overflow-hidden`}>
      {/* The row's link and its trailing control are siblings — a button inside a link is a
          control no keyboard reaches separately. The link carries the inset ring, since the
          grouped row clips. */}
      <Link
        scroll={false}
        href={subscriptionHref(entry.tagName)}
        data-ripple
        className="state-layer flex min-w-0 flex-1 items-center gap-4 self-stretch py-3 pr-2 pl-4 transition-ui focus-visible:outline-hidden focus-visible:inset-ring-2 focus-visible:focus-ring-inset"
      >
        <div className="min-w-0 flex-1">
          <NameFade as="div" name={asking ? undefined : name} className="truncate text-title-m text-on-surface">
            {asking ? <Skeleton className="inline-block h-4 w-1/3 align-middle" /> : name}
          </NameFade>
          {/* The tag leaves this line for the one above when the dictionary turns out to have no
              name for it, so that answer fades this line too. */}
          <NameFade as="div" name={chinese === null ? 'tag' : 'name'} className="truncate text-body-s text-on-surface-variant tabular-nums">
            {chinese !== null ? `${entry.tagName} · ` : ''}记录 {formatCount(entry.imageCount)} 张
          </NameFade>
        </div>
        {entry.newCount > 0 && (
          <Badge tone="primary" size="md" className="shrink-0 tabular-nums">
            新增 {formatCount(entry.newCount)}
          </Badge>
        )}
      </Link>
      <IconButton className="mr-2 shrink-0" aria-label={`取消订阅 ${name}`} icon={<MdNotificationsOff />} onClick={onRemove} />
    </li>
  );
}

/**
 * 标签订阅 (decision 15): the tags the account follows, each with the count recorded for it and
 * the pictures added since it was last opened; a field to subscribe to another; and the way to
 * stop following one. Opening a row shows that tag's pictures (`SubscriptionView`) and marks its
 * new ones seen there.
 *
 * The counts come from the sync (`./sync.ts`), which the shell runs at load, after a sign-in and
 * every ten minutes — this screen only reads what it left. Removing confirms first: a
 * subscription's count of new pictures cannot be brought back by subscribing again.
 *
 * Rows come and go in place (M1-017): a removed row fades where it stood while the rows under it
 * close the gap, a new one fades in where it lands, and the list stays mounted while empty so the
 * last row leaving fades over the empty state arriving, and the first arriving fades the empty
 * state out (`PresenceList`, `PresenceBlock`).
 */
export default function SubscriptionsScreen() {
  const { token, ready } = useSession();
  const { confirm, confirmDialog } = useConfirm();
  const read = useResource(tagSubscriptions, token ? { token } : SKIP);
  const list = read.data;
  const nameOf = useTagNames(list?.map((entry) => entry.tagName) ?? []);
  const presence = useRef<PresenceList<TagSubscription>>(null);

  /* An empty state that replaces the last row answers the press that removed it: it arrives on
     the pane-swap clock rather than with an entrance of its own. Only one that is there from the
     start enters as the screen's own. */
  const [hadRows, setHadRows] = useState(false);
  if (!hadRows && list && list.length > 0) setHadRows(true);
  const emptyAfterRows = hadRows && list !== undefined && list.length === 0;

  /* **Where focus goes as the row leaves is the list's business** (G3-018's companion: the press
     that removed it must not leave focus nowhere): to the same control of the row now in its place,
     else of the row before it, or to the field once no row is left. The removal is claimed as the
     user's, because the confirmation's own return of focus to the row's button races the list's
     commit — the focus may be on the document, or still in the leaving dialog, when the row goes;
     a claimed removal places it all the same (`PresenceList`'s `claimFocus`), and the dialog's
     later return then finds it placed and keeps it (`lib/overlay.ts`). */
  const remove = async (entry: TagSubscription, name: string) => {
    if (!token) return;
    const confirmed = await confirm({
      title: '确认取消订阅',
      message: `确定要取消订阅标签「${name}」吗？取消后不再追踪它的新图片。`,
    });
    if (!confirmed) return;
    const release = presence.current?.claimFocus([normaliseTagName(entry.tagName)]);
    const outcome = await unsubscribeConfirmed(token, entry.tagName);
    if (outcome.kind !== 'done') release?.();
    if (outcome.kind === 'stale-session') {
      showToast(SESSION_CHANGED_MESSAGE, 'warning');
      return;
    }
    if (outcome.kind === 'failed') {
      showToast(outcome.message, 'error');
      return;
    }
    showToast(`已取消订阅「${name}」`, 'success');
  };

  let body: React.ReactNode;
  if (!ready) body = <RowsSkeleton />;
  else if (!token) body = <SignInRequired description="登录后即可订阅标签，追踪它们的新图片。" />;
  else if (list === undefined && read.error !== undefined) {
    body = (
      <ErrorRetry
        title="订阅加载失败"
        message={apiErrorMessage(read.error)}
        onRetry={isRetryable(read.error) ? read.refresh : undefined}
      />
    );
  } else if (list === undefined) body = <RowsSkeleton />;
  else {
    body = (
      <PresenceList
        ref={presence}
        items={list}
        getKey={(entry) => normaliseTagName(entry.tagName)}
        variant="list"
        resetKey={token}
        fallbackFocus={() => document.querySelector<HTMLElement>('[data-subscribe-field] input')}
      >
        {(entries, ref) => (
          /* Positioned for the empty state, which leaves where it stood as the first row arrives. */
          <div className="relative">
            <ul ref={ref} aria-label="已订阅的标签" aria-busy={read.isLoading || undefined}>
              {entries.map(({ item: entry, key }) => {
                const chinese = nameOf(entry.tagName);
                return (
                  <SubscriptionRow
                    key={key}
                    presenceKey={key}
                    entry={entry}
                    chinese={chinese}
                    onRemove={() => void remove(entry, chinese ?? entry.tagName)}
                  />
                );
              })}
            </ul>
            <PresenceBlock show={list.length === 0}>
              <div className={cn(emptyAfterRows && 'animate-page-transition')}>
                <EmptyState
                  size="pane"
                  entrance={!emptyAfterRows}
                  icon={<MdRssFeed size={ICON.display} />}
                  title="还没有订阅标签"
                  description="在上方输入一个感兴趣的标签开始追踪，也可以在图片的标签上点「订阅」"
                />
              </div>
            </PresenceBlock>
          </div>
        )}
      </PresenceList>
    );
  }

  return (
    <div className="mx-auto w-full max-w-4xl">
      <PageHeader
        title="标签订阅"
        subtitle={token ? '订阅的标签出现新图片时，这里会显示新增的数量，并发送系统通知' : undefined}
      />
      {/* Keyed on the session: a field typed into under one account starts empty under the next. */}
      {token && <SubscribeField key={token} token={token} />}
      {body}
      {confirmDialog}
    </div>
  );
}
