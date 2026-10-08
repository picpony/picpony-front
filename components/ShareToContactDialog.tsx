'use client';

import { useCallback, useEffect, useState } from 'react';
import { MdCheck, MdFolderShared, MdImage, MdLock, MdSend } from 'react-icons/md';
import Avatar from './Avatar';
import Button from './Button';
import EmptyState from './EmptyState';
import ErrorRetry from './ErrorRetry';
import FadeInImage from './FadeInImage';
import Modal from './Modal';
import SearchInput from './SearchInput';
import SignInRequired from './SignInRequired';
import Skeleton, { SkeletonCircle } from './Skeleton';
import Spinner from './Spinner';
import { showToast } from './Toast';
import { apiErrorMessage, isRetryable } from '@/lib/api/errors';
import { encodeShare, sendMessage, type ShareTarget } from '@/lib/api/messages';
import { trackShare } from '@/lib/api/share';
import { useSession } from '@/lib/hooks';
import { ICON } from '@/lib/icons';
import { SKIP, useResource } from '@/lib/resource';
import { conversationPage, recentContacts, userSearch } from '@/lib/resources';
import { cn } from '@/lib/utils';
import type { ChatUser } from '@/lib/types/message';

export type { ShareTarget } from '@/lib/api/messages';

/** How long typing has to pause before the name is looked up. */
const USER_SEARCH_DEBOUNCE_MS = 300;

/**
 * `search_users`, as a field types: the keyword settles for a moment before it is read, so a
 * name typed at speed is one request, not one per character. `flush` reads the current text
 * at once (Enter).
 *
 * Shared by the share dialog and /messages' 搜索用户 field — one lookup, one cache
 * (`userSearch`), one wording for its states.
 */
export function useUserSearch(token: string | null, query: string) {
  const keyword = query.trim();
  const [settled, setSettled] = useState(keyword);
  useEffect(() => {
    const timer = setTimeout(() => setSettled(keyword), keyword ? USER_SEARCH_DEBOUNCE_MS : 0);
    return () => clearTimeout(timer);
  }, [keyword]);
  const current = settled === keyword;
  const read = useResource(userSearch, token && keyword && current ? { token, keyword } : SKIP);
  const flush = useCallback(() => setSettled(keyword), [keyword]);
  return {
    keyword,
    /** The people found for the current text, or `undefined` while there is none yet. */
    users: current ? read.data : undefined,
    searching: keyword !== '' && (!current || (read.data === undefined && read.error === undefined)),
    error: current ? read.error : undefined,
    retry: read.refresh,
    flush,
  };
}

/** Case-insensitive substring on the name — the only field a row shows. */
export function matchesName(name: string, keyword: string) {
  return name.toLowerCase().includes(keyword.toLowerCase());
}

type RowState = 'sending' | 'sent';

/**
 * Share a picture, a favourites folder or a privacy space with somebody, as a card in a direct
 * message — the original front end's 「分享给联系人」, with the recent contacts on top and a
 * user search for anybody else.
 *
 *     const { share, shareDialog } = useShareToContact();
 *     share({ kind: 'image', imageId, thumbUrl: shareThumbUrl(image.representations) });
 *     share({ kind: 'fave-folder', ownerUsername, folderId, folderName });
 *     …
 *     {shareDialog}
 *
 * Render `shareDialog` once, anywhere in the tree (the same shape as `useConfirm`). One tap on a
 * person sends the card (`send_message`); the row turns to 已发送 and the dialog stays open, so the
 * same thing can go to several people. The wire format is the original front end's, verbatim
 * (`encodeShare`), so a card sent from either front end renders as a card in both. Signed out,
 * the dialog says so and offers 登录 (decision 4).
 */
export function useShareToContact() {
  const [target, setTarget] = useState<ShareTarget | null>(null);
  const [open, setOpen] = useState(false);
  /* Bumped per share, so a second share starts from a fresh dialog: no 已发送 carried over. */
  const [round, setRound] = useState(0);

  const share = useCallback((next: ShareTarget) => {
    setTarget(next);
    setRound((value) => value + 1);
    setOpen(true);
  }, []);

  const shareDialog = target ? (
    <ShareToContactDialog key={round} target={target} isOpen={open} onClose={() => setOpen(false)} />
  ) : null;

  return { share, shareDialog };
}

function ShareToContactDialog({
  target,
  isOpen,
  onClose,
}: {
  target: ShareTarget;
  isOpen: boolean;
  onClose: () => void;
}) {
  const { token, user } = useSession();
  const myId = Number(user?.id);
  const [query, setQuery] = useState('');
  const [rows, setRows] = useState<ReadonlyMap<number, RowState>>(new Map());
  const contacts = useResource(recentContacts, token && isOpen ? { token } : SKIP);
  const search = useUserSearch(token, query);

  const send = async (person: ChatUser) => {
    if (!token || rows.has(person.id)) return;
    setRows((previous) => new Map(previous).set(person.id, 'sending'));
    try {
      await sendMessage(token, person.id, encodeShare(target));
      trackShare(token);
      setRows((previous) => new Map(previous).set(person.id, 'sent'));
      showToast('已发送');
      /* An open conversation with them shows the card on its next read; the list re-sorts. */
      conversationPage.invalidate({ token, withUserId: person.id, page: 1 });
      recentContacts.expire({ token });
    } catch (error) {
      setRows((previous) => {
        const next = new Map(previous);
        next.delete(person.id);
        return next;
      });
      showToast(apiErrorMessage(error, '发送失败'), 'error');
    }
  };

  const keyword = search.keyword;
  const contactRows = (contacts.data ?? []).filter((contact) => !keyword || matchesName(contact.username, keyword));
  const known = new Set(contactRows.map((contact) => contact.id));
  const userRows = keyword
    ? (search.users ?? []).filter((person) => person.id !== myId && !known.has(person.id))
    : [];

  const list = (() => {
    if (!token) return <SignInRequired size="inline" description="登录后即可分享给其他用户。" />;
    if (contacts.data === undefined && contacts.error === undefined) return <PersonRowsSkeleton />;
    const people = [...contactRows, ...userRows];
    return (
      <div className="flex flex-col gap-3">
        {contacts.error !== undefined && contacts.data === undefined && (
          <ErrorRetry
            size="inline"
            title="联系人加载失败"
            message={apiErrorMessage(contacts.error)}
            onRetry={isRetryable(contacts.error) ? contacts.refresh : undefined}
          />
        )}
        {people.length > 0 && (
          <ul aria-label={keyword ? '搜索结果' : '最近联系人'} className="flex flex-col gap-0.5">
            {people.map((person) => (
              <li key={person.id}>
                <PersonRow person={person} state={rows.get(person.id)} onSend={() => void send(person)} />
              </li>
            ))}
          </ul>
        )}
        <SearchStatus
          keyword={keyword}
          searching={search.searching}
          error={search.error}
          onRetry={search.retry}
          empty={people.length === 0}
          noContacts={!keyword && contacts.data !== undefined && contacts.data.length === 0}
        />
      </div>
    );
  })();

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="分享给"
      maxWidth="md"
      footer={
        <Button variant="text" onClick={onClose}>
          完成
        </Button>
      }
    >
      <div className="flex flex-col gap-4">
        <SharePreview target={target} />
        {token && (
          <SearchInput
            value={query}
            onChange={setQuery}
            placeholder="搜索联系人或用户"
            enterKeyHint="search"
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.nativeEvent.isComposing) {
                event.preventDefault();
                search.flush();
              }
            }}
          />
        )}
        {list}
      </div>
    </Modal>
  );
}

/** What is being shared, above the people it can go to. */
function SharePreview({ target }: { target: ShareTarget }) {
  const Glyph = target.kind === 'image' ? MdImage : target.kind === 'fave-folder' ? MdFolderShared : MdLock;
  const title =
    target.kind === 'image'
      ? `图片 #${target.imageId}`
      : target.kind === 'fave-folder'
        ? target.folderName
        : `${target.ownerName} 的隐私空间`;
  const kind = target.kind === 'image' ? '图片卡片' : target.kind === 'fave-folder' ? '收藏夹卡片' : '隐私空间卡片';
  return (
    <div className="flex items-center gap-3 rounded-md bg-surface-container-highest p-3">
      <span
        aria-hidden="true"
        className="relative flex size-12 shrink-0 items-center justify-center overflow-hidden rounded-sm bg-secondary-container text-on-secondary-container"
      >
        {target.kind === 'image' && target.thumbUrl ? (
          <FadeInImage src={target.thumbUrl} alt="" fill sizes="48px" resilient proxyThumb className="object-cover" />
        ) : (
          <Glyph size={ICON.standard} />
        )}
      </span>
      <span className="flex min-w-0 flex-col">
        <span className="truncate text-title-s text-on-surface">{title}</span>
        <span className="text-body-s text-on-surface-variant">以{kind}发送</span>
      </span>
    </div>
  );
}

function PersonRow({ person, state, onSend }: { person: ChatUser; state: RowState | undefined; onSend: () => void }) {
  return (
    <button
      type="button"
      onClick={onSend}
      aria-disabled={state ? true : undefined}
      aria-label={state === 'sent' ? `已发送给 ${person.username}` : `发送给 ${person.username}`}
      data-ripple=""
      className={cn(
        'flex min-h-14 w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-on-surface',
        'transition-ui focus-visible:outline-hidden focus-visible:ring-2 focus-ring',
        state ? 'cursor-default' : 'state-layer cursor-pointer',
      )}
    >
      <Avatar src={person.avatar} name={person.username} size={40} />
      <span className="min-w-0 flex-1 truncate text-label-l-emphasized">{person.username}</span>
      <span aria-hidden="true" className="flex shrink-0 items-center gap-1 text-label-l text-on-surface-variant">
        {state === 'sending' ? (
          <Spinner size="sm" tone="inherit" />
        ) : state === 'sent' ? (
          <>
            <MdCheck size={ICON.control} />
            已发送
          </>
        ) : (
          <MdSend size={ICON.control} />
        )}
      </span>
    </button>
  );
}

/** The line under the people: searching, nothing found, the lookup failed, or no contacts yet. */
function SearchStatus({
  keyword,
  searching,
  error,
  onRetry,
  empty,
  noContacts,
}: {
  keyword: string;
  searching: boolean;
  error: unknown;
  onRetry: () => void;
  empty: boolean;
  noContacts: boolean;
}) {
  if (keyword && searching) {
    return (
      <p role="status" className="flex items-center gap-2 px-3 text-body-m text-on-surface-variant">
        <Spinner size="sm" />
        正在搜索用户…
      </p>
    );
  }
  if (keyword && error !== undefined) {
    return (
      <ErrorRetry
        size="inline"
        title="用户搜索失败"
        message={apiErrorMessage(error)}
        onRetry={isRetryable(error) ? onRetry : undefined}
      />
    );
  }
  if (keyword && empty) return <EmptyState size="inline" title="没有找到用户" />;
  if (noContacts) return <EmptyState size="inline" title="还没有联系人" description="搜索用户名即可分享给任何人。" />;
  return null;
}

function PersonRowsSkeleton() {
  return (
    <div className="flex flex-col gap-0.5" aria-hidden="true">
      {[0, 1, 2].map((i) => (
        <div key={i} className="flex min-h-14 items-center gap-3 px-3 py-2">
          <SkeletonCircle size={40} delay={i * 80} />
          <Skeleton className="h-4 w-1/2" delay={i * 80 + 40} />
        </div>
      ))}
    </div>
  );
}
