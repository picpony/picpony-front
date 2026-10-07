'use client';

import { useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import PageHeader from '@/components/PageHeader';
import TabPanes, { TabPane } from '@/components/TabPanes';
import Tabs, { type TabItem } from '@/components/Tabs';
import { isHistoryLayerState } from '@/lib/historyLayers';
import { useSession } from '@/lib/hooks';
import { hasModalLayer, isScreenQuiet, subscribeScreenQuiet } from '@/lib/overlay';
import { SKIP, useResource } from '@/lib/resource';
import { unreadCounts, type UnreadBreakdown } from '@/lib/resources';
import { useScreenState } from '@/lib/screenState';
import AnnouncementsPane from './AnnouncementsPane';
import ChatPane, { type Me } from './ChatPane';
import NotificationsPane from './NotificationsPane';
import { ListRowsSkeleton } from './Skeletons';
import {
  chooseInitialTab,
  isMessagesTab,
  landingTab,
  personalRequest,
  type MessagesTab,
  type PersonalRequest,
  type UnreadByTab,
} from './threadModel';

/**
 * How long a visit waits for the unread counts before choosing its tab without them. The shell
 * reads them on every screen, so they are normally there already; this only bounds a slow one.
 */
const TAB_CHOICE_WAIT_MS = 800;

function byTab(counts: UnreadBreakdown): UnreadByTab {
  return { notification: counts.notifications, interaction: counts.interactions, chat: counts.messages };
}

/** A positive user id off the address, or `null`. */
function userIdParam(value: string | null): number | null {
  if (!value || !/^\d+$/.test(value)) return null;
  const id = Number(value);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

const noSubscription = () => () => {};
const notQuiet = () => false;

/* Address writes waiting for a modal surface to close (`replaceMessagesUrl`). */
let queuedAddress: ((params: URLSearchParams) => void)[] = [];
let stopWaiting: (() => void) | null = null;

/**
 * Rewrite this screen's address in place. Never a new entry (decision 18: an in-page switch
 * never writes history), and never while the screen is the background of an open picture (its
 * entry is not the current one then).
 *
 * **Under a layer the write waits; it is not dropped.** While a modal surface owns the current
 * entry, a write that changes the address would supersede it (`lib/historyLayers.ts`), so the
 * write waits for the screen to go quiet. A layer that has only begun to close — its step back
 * not yet landed — needs no wait: the history layer holds the write and replays it on the entry
 * beneath. Skipped instead, as it once was, a sign-in (the dialog still stepping back) or a
 * session ending with a conversation open left the address naming a tab the screen had left.
 */
function replaceMessagesUrl(update: (params: URLSearchParams) => void) {
  if (typeof window === 'undefined') return;
  queuedAddress.push(update);
  writeQueuedAddress();
}

function writeQueuedAddress() {
  const here = window.location.pathname === '/messages';
  if (here && queuedAddress.length && isHistoryLayerState(window.history.state) && hasModalLayer()) {
    stopWaiting ??= subscribeScreenQuiet(writeQueuedAddress);
    return;
  }
  stopWaiting?.();
  stopWaiting = null;
  const updates = queuedAddress;
  queuedAddress = [];
  if (!here || !updates.length) return;
  const params = new URLSearchParams(window.location.search);
  for (const update of updates) update(params);
  const query = params.toString();
  const href = query ? `/messages?${query}` : '/messages';
  if (href !== `${window.location.pathname}${window.location.search}`) window.history.replaceState(null, '', href);
}

/** A screen's waiting writes go with it: the next one decides its own address. */
function dropQueuedAddress() {
  queuedAddress = [];
  stopWaiting?.();
  stopWaiting = null;
}

/**
 * /messages: 公告, 系统, 互动 and 私信.
 *
 * **It opens on the tab with something unread** (R6-015) — the one you were last on if it has
 * some, else the first that has any — unless a link names a tab (`?tab=`) or a person
 * (`?to=` / `?user=`, which opens that conversation at once). With nothing unread it opens where
 * you were last, or on 公告. The bell used to land on 公告 while the unread messages waited two
 * tabs away.
 *
 * **Signed out, the row is 公告 and 系统** (decision 22): the site's own notices, which read
 * without a token, as the original front end allowed. 互动 and 私信 are not in it at all —
 * neither a tab nor a pane, so nothing personal is read and the tab row's keys walk two tabs. A
 * link into either, or to a person, lands on 系统 (`landingTab`), its address is corrected to
 * say so, and what it asked for is kept: signing in on the spot adds the two tabs in place —
 * the screen survives a sign-in (`page.tsx`) — and opens that tab or conversation once the
 * sign-in dialog has gone, so the change happens in view and a conversation never opens under a
 * dialog that still holds the focus. A tab the visitor picks meanwhile supersedes the link.
 * Signing out replaces the screen, and the fresh one lands the same way.
 *
 * A pane is mounted the first time its tab is shown and kept after (`TabPanes`), so a visit
 * reads only what it shows. Switching tabs rewrites `?tab=` in place.
 */
export default function MessagesScreen({ token }: { token: string | null }) {
  const signedIn = token !== null;
  const { user } = useSession();
  const me = useMemo<Me>(() => {
    const id = Number(user?.id);
    return {
      id: Number.isSafeInteger(id) && id > 0 ? id : null,
      name: typeof user?.username === 'string' ? user.username : '我',
      avatar: typeof user?.avatar === 'string' ? user.avatar : null,
    };
  }, [user]);

  const searchParams = useSearchParams();
  const tabParam = searchParams.get('tab');
  const requestedTab = isMessagesTab(tabParam) ? tabParam : null;
  const linkedUser = userIdParam(searchParams.get('to') ?? searchParams.get('user'));

  const [storedTab, setStoredTab] = useScreenState<MessagesTab | null>('messages:tab', null);
  const unread = useResource(unreadCounts, token ? { token } : SKIP);
  const counts = token && unread.data ? byTab(unread.data) : null;

  const [tab, setTab] = useState<MessagesTab | null>(() => {
    const requested = linkedUser !== null ? 'chat' : requestedTab;
    if (!token || requested) return chooseInitialTab({ requested, stored: storedTab, unread: null, signedIn });
    const known = unreadCounts.peek({ token }).data;
    return known ? chooseInitialTab({ requested: null, stored: storedTab, unread: byTab(known), signedIn }) : null;
  });
  /* Waiting on the counts: choose the moment they (or their failure) arrive… */
  if (tab === null && (counts !== null || unread.error !== undefined)) {
    setTab(chooseInitialTab({ requested: null, stored: storedTab, unread: counts, signedIn }));
  }
  /* …or after a beat without them. */
  useEffect(() => {
    if (tab !== null) return;
    const timer = setTimeout(() => setTab(storedTab ?? 'announcement'), TAB_CHOICE_WAIT_MS);
    return () => clearTimeout(timer);
  }, [tab, storedTab]);

  /* Signed out, what a link asked for that only an account can show. */
  const [pending, setPending] = useState<PersonalRequest | null>(() =>
    token ? null : personalRequest(requestedTab, linkedUser),
  );

  /* A link followed while the screen is up: a named tab is selected, a named person opened —
     signed out, both land where `landingTab` puts them, and the request is kept. */
  const [seen, setSeen] = useState({ tab: requestedTab, user: linkedUser });
  const [target, setTarget] = useState<number | null>(() => (token ? linkedUser : null));
  if (seen.tab !== requestedTab || seen.user !== linkedUser) {
    setSeen({ tab: requestedTab, user: linkedUser });
    const person = linkedUser !== null && linkedUser !== seen.user ? linkedUser : null;
    const named = person !== null ? 'chat' : requestedTab !== seen.tab ? requestedTab : null;
    if (named) {
      const landing = landingTab(named, signedIn);
      if (token) {
        if (person !== null) setTarget(person);
      } else {
        const personal = personalRequest(named, person);
        /* A link to a public tab other than the one on screen replaces an older request; the
           screen's own correction of its address (to the tab it is on) does not. */
        if (personal) setPending(personal);
        else if (landing !== tab) setPending(null);
      }
      setTab(landing);
    }
  }

  /* Signed in on the spot, the request is opened — once the screen is quiet (the sign-in
     dialog gone), so the tab changes in view. */
  const quiet = useSyncExternalStore(
    token && pending ? subscribeScreenQuiet : noSubscription,
    isScreenQuiet,
    notQuiet,
  );
  if (token && pending && quiet) {
    setPending(null);
    if (pending.user !== null) setTarget(pending.user);
    setTab(pending.tab);
  }

  /* The address names what is on screen. A person is taken out of it as soon as they are read,
     so a reload or a Back does not open them again, and an address naming a tab the screen is
     not showing — one the row does not offer signed out, one a sign-in has just opened, or a
     name that is no tab — is corrected to the one it is. A bare address stays bare. */
  const addressed = tabParam !== null || linkedUser !== null;
  useEffect(() => {
    if (tab === null || !addressed || (linkedUser === null && requestedTab === tab)) return;
    replaceMessagesUrl((params) => {
      params.delete('to');
      params.delete('user');
      params.set('tab', tab);
    });
  }, [tab, addressed, linkedUser, requestedTab]);
  useEffect(() => dropQueuedAddress, []);

  const [visited, setVisited] = useState<ReadonlySet<MessagesTab>>(() => new Set(tab ? [tab] : []));
  if (tab !== null && !visited.has(tab)) setVisited(new Set([...visited, tab]));

  const selectTab = (next: MessagesTab) => {
    if (next !== tab) setPending(null);
    setTab(next);
    setStoredTab(next);
    replaceMessagesUrl((params) => params.set('tab', next));
  };

  const [screenOpen, setScreenOpen] = useState(false);
  const consumeTarget = useCallback(() => setTarget(null), []);

  /* The row never selects a tab it does not offer. */
  const shown = landingTab(tab ?? storedTab ?? 'announcement', signedIn);
  const tabs: TabItem<MessagesTab>[] = [
    { value: 'announcement', label: '公告' },
    { value: 'notification', label: '系统', badge: counts?.notification },
    ...(token
      ? [
          { value: 'interaction' as const, label: '互动', badge: counts?.interaction },
          { value: 'chat' as const, label: '私信', badge: counts?.chat },
        ]
      : []),
  ];
  return (
    /* Behind the phone's conversation view the screen is out of reach — for the keyboard, for a
       screen reader's virtual cursor and for a stray tap alike. */
    <div className="mx-auto max-w-4xl" inert={screenOpen || undefined}>
      <PageHeader title="消息" />
      <Tabs className="mb-3" value={shown} onChange={selectTab} label="消息分类" tabs={tabs} />
      {tab === null ? (
        <ListRowsSkeleton />
      ) : (
        <TabPanes value={shown} lean>
          <TabPane value="announcement">
            {visited.has('announcement') && <AnnouncementsPane active={shown === 'announcement'} />}
          </TabPane>
          <TabPane value="notification">
            {visited.has('notification') && (
              <NotificationsPane
                token={token}
                type="system"
                active={shown === 'notification'}
                unread={counts?.notification ?? 0}
              />
            )}
          </TabPane>
          {/* Last in the row, so appending them keeps the panes in the tabs' order. */}
          {token && (
            <>
              <TabPane value="interaction">
                {visited.has('interaction') && (
                  <NotificationsPane
                    token={token}
                    type="interaction"
                    active={shown === 'interaction'}
                    unread={counts?.interaction ?? 0}
                  />
                )}
              </TabPane>
              <TabPane value="chat">
                {visited.has('chat') && (
                  <ChatPane
                    token={token}
                    me={me}
                    active={shown === 'chat'}
                    target={target}
                    onTargetConsumed={consumeTarget}
                    onScreenChange={setScreenOpen}
                  />
                )}
              </TabPane>
            </>
          )}
        </TabPanes>
      )}
    </div>
  );
}
