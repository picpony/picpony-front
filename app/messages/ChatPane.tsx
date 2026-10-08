'use client';

import { usePathname } from 'next/navigation';
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type MouseEvent, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import { MdOutlineChatBubbleOutline } from 'react-icons/md';
import EmptyState from '@/components/EmptyState';
import { showToast } from '@/components/Toast';
import { apiErrorMessage, isNotFound } from '@/lib/api/errors';
import { useEscapeBack } from '@/lib/hooks';
import { ICON } from '@/lib/icons';
import { OverlayLayerContext, useMounted, useOverlayLayer } from '@/lib/overlay';
import { useResource } from '@/lib/resource';
import { recentContacts, userProfile } from '@/lib/resources';
import { useScreenState } from '@/lib/screenState';
import type { ChatUser } from '@/lib/types/message';
import ContactList from './ContactList';
import Conversation from './Conversation';

/** Decision 13: the contact list re-reads this often while the 私信 tab is on screen. */
const CONTACTS_POLL_MS = 30_000;

/** 18rem of contacts plus 24rem for a readable conversation: below it the two share one column. */
const CHAT_SPLIT_MIN_REM = 42;

/**
 * A conversation left through one of its own links — a shared picture, a name, a link in a
 * message — is reopened when the screen comes back, on a phone as on a desktop: the trip was
 * out of the conversation, not out of the conversation list. Kept here, not in history, because
 * the navigation replaces the conversation's history entry (a navigation from inside a layer
 * supersedes it, `lib/historyLayers.ts`).
 */
let resume: { token: string; contact: ChatUser } | null = null;

/**
 * The open conversation, for the session, so a return to the screen finds it as it was left
 * (side by side, the pane stays open across a visit elsewhere). Written when it is set — not in
 * a state updater: a conversation closed by a navigation from inside it is closed in the render
 * that unmounts the screen, so an updater never runs, and the write went with it. Keyed by the
 * session's token, so another account never finds it.
 */
let openConversation: { token: string; contact: ChatUser | null } | null = null;

export interface Me {
  id: number | null;
  name: string;
  avatar: string | null;
}

interface ChatPaneProps {
  token: string;
  me: Me;
  /** The 私信 tab is the one on screen. */
  active: boolean;
  /** A person a link asked to open (`?to=`), until it has been dealt with. */
  target: number | null;
  onTargetConsumed: () => void;
  /** The phone's full-height conversation is open over the screen (or closed again). */
  onScreenChange: (open: boolean) => void;
}

/** Whether the column has room for contacts and a conversation side by side. */
function useSplitLayout(ref: RefObject<HTMLElement | null>): boolean | null {
  const [split, setSplit] = useState<boolean | null>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => {
      /* A pane that is not on screen measures 0: keep what it last was. */
      const width = el.clientWidth;
      if (width === 0) return;
      const rem = parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
      setSplit(width >= CHAT_SPLIT_MIN_REM * rem);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [ref]);
  return split;
}

/**
 * 私信: the contacts and the conversation.
 *
 * **Two panes when they fit, one when they do not** — decided by the column's own width
 * (42rem: 18rem of contacts beside 24rem of conversation), because the app drawer shares the
 * viewport and a breakpoint cannot say how much room the column has. Side by side, the contact
 * column collapses to its portraits to give the thread more room (a session choice, applied only
 * while both fit).
 *
 * **In one column the conversation is a screen of its own** (R6-007, decision 1): opened, it
 * covers the page — no title, tabs or footer above or below it — with its own bar, the composer
 * at the bottom sitting on the keyboard (`interactiveWidget: 'resizes-content'`), and the system
 * Back closes it back to the list, through the overlay layer's history entry. It lives over the
 * page rather than in it: the page column is a size container (the back affordance's room is
 * measured against it), and a container is a containing block for anything fixed inside it — so
 * it is portalled into the content host beside the scroller, where the image detail's overlay
 * lives too.
 *
 * Side by side, Esc (outside a field) closes the open conversation; Back leaves the screen, as
 * for any sidebar destination.
 */
export default function ChatPane({ token, me, active, target, onTargetConsumed, onScreenChange }: ChatPaneProps) {
  const [selected, setSelectedState] = useState<ChatUser | null>(() =>
    openConversation?.token === token ? openConversation.contact : null,
  );
  const setSelected = useCallback(
    (next: ChatUser | null) => {
      openConversation = { token, contact: next };
      setSelectedState(next);
    },
    [token],
  );
  const [collapsed, setCollapsed] = useScreenState('messages:rail-collapsed', false);
  const contacts = useResource(recentContacts, { token }, { refetchInterval: active ? CONTACTS_POLL_MS : undefined });
  const columnRef = useRef<HTMLDivElement>(null);
  const split = useSplitLayout(columnRef);
  const screenOpen = split === false && active && selected !== null;

  const lookup = useRef(0);
  const select = useCallback(
    (person: ChatUser | null) => {
      if (person && person.id === me.id) {
        showToast('不能给自己发私信', 'info');
        return;
      }
      lookup.current += 1;
      setSelected(person);
    },
    [me.id, setSelected],
  );

  useEffect(() => {
    onScreenChange(screenOpen);
  }, [screenOpen, onScreenChange]);

  /* A link asked for somebody (`/messages?to=<id>`): straight away, with no wait for the list —
     from the contacts when they are there, else from the profile. Somebody who does not exist is
     said so; yourself is refused. The request is handed back at once (it leaves the address), so
     what guards the answer is the pane still being here and no newer link having come since. */
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  useEffect(() => {
    if (target === null) return;
    onTargetConsumed();
    const request = ++lookup.current;
    const current = () => alive.current && lookup.current === request;
    void (async () => {
      if (target === me.id) {
        showToast('不能给自己发私信', 'info');
        return;
      }
      const known = recentContacts.peek({ token }).data?.find((contact) => contact.id === target);
      if (known) {
        setSelected({ id: known.id, username: known.username, avatar: known.avatar });
        return;
      }
      try {
        const user = await userProfile.read({ id: String(target) });
        if (!current()) return;
        if (!user) throw new Error('该用户不存在');
        setSelected({ id: user.id, username: user.username, avatar: user.avatar ?? null });
      } catch (error) {
        if (!current()) return;
        showToast(isNotFound(error) ? '该用户不存在' : apiErrorMessage(error), 'error');
      }
    })();
  }, [target, token, me.id, onTargetConsumed, setSelected]);

  /* Back from a trip out of the conversation: reopen it. */
  const pathname = usePathname();
  useEffect(() => {
    if (pathname !== '/messages' || !resume) return;
    const pending = resume;
    resume = null;
    if (pending.token !== token) return;
    void Promise.resolve().then(() => setSelected(pending.contact));
  }, [pathname, token, setSelected]);

  const close = useCallback(() => { lookup.current += 1; setSelected(null); }, [setSelected]);

  /* Side by side the conversation is a pane, not a layer: Esc outside a field closes it. */
  useEscapeBack(close, split === true && active && selected !== null);

  const noteTripOut = (event: MouseEvent<HTMLElement>) => {
    if (!selected || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    const link = (event.target as Element | null)?.closest?.('a[href]');
    if (!(link instanceof HTMLAnchorElement) || link.target === '_blank') return;
    if (new URL(link.href, window.location.href).origin !== window.location.origin) return;
    resume = { token, contact: selected };
  };

  const list = (
    <ContactList
      token={token}
      myId={me.id}
      contacts={contacts}
      selectedId={selected?.id ?? null}
      onSelect={select}
      mode={split ? 'rail' : 'list'}
      collapsed={collapsed}
      onToggleCollapsed={() => setCollapsed((value) => !value)}
    />
  );

  return (
    <div ref={columnRef}>
      {split === true && (
        /* `surface-container-low`, the step the column inside it takes, so the search field's
           own tone has something to stand out from. As tall as the window allows between the
           chrome above and the footer's edge, within a readable band. */
        <div className="flex h-[min(38rem,max(26rem,calc(100dvh-15rem)))] overflow-hidden rounded-md bg-surface-container-low">
          {list}
          <div className="flex min-w-0 flex-1 flex-col">
            {selected ? (
              <Conversation key={selected.id} token={token} contact={selected} me={me} layout="pane" active={active} />
            ) : (
              <EmptyState
                size="pane"
                icon={<MdOutlineChatBubbleOutline size={ICON.display} />}
                title="选择一个联系人开始聊天"
                className="flex-1"
              />
            )}
          </div>
        </div>
      )}
      {split === false && list}
      {screenOpen && selected && (
        <ConversationScreen
          key={selected.id}
          token={token}
          contact={selected}
          me={me}
          onClose={close}
          onClickCapture={noteTripOut}
        />
      )}
    </div>
  );
}

/**
 * The phone's conversation view: a dialog-shaped layer over the content host, so Back, Esc and
 * the focus containment are the overlay layer's (`useOverlayLayer` with `history`), and focus
 * goes back to the contact's row when it closes.
 */
function ConversationScreen({
  token,
  contact,
  me,
  onClose,
  onClickCapture,
}: {
  token: string;
  contact: ChatUser;
  me: Me;
  onClose: () => void;
  onClickCapture: (event: MouseEvent<HTMLElement>) => void;
}) {
  const mounted = useMounted();
  const panelRef = useRef<HTMLElement>(null);
  const host = mounted ? (document.querySelector('[data-page-back-slot]')?.parentElement ?? null) : null;
  const layer = useOverlayLayer(host !== null, panelRef, {
    onClose,
    history: true,
    returnFocus: () => document.querySelector<HTMLElement>(`[data-contact-id="${contact.id}"]`),
  });
  if (!host) return null;
  return createPortal(
    <OverlayLayerContext.Provider value={layer}>
      <section
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={`与 ${contact.username} 的私信`}
        tabIndex={-1}
        onClickCapture={onClickCapture}
        className="animate-page-transition absolute inset-0 z-page-chrome flex flex-col bg-surface focus-visible:outline-hidden"
      >
        <Conversation
          token={token}
          contact={contact}
          me={me}
          layout="screen"
          onBack={onClose}
          historyParent={layer.history}
        />
      </section>
    </OverlayLayerContext.Provider>,
    host,
  );
}
