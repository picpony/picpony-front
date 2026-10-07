'use client';

import Link from 'next/link';
import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type RefObject,
} from 'react';
import { MdArrowBack, MdOutlineEmojiEmotions, MdRefresh, MdSend } from 'react-icons/md';
import Avatar from '@/components/Avatar';
import IconButton from '@/components/IconButton';
import Popover from '@/components/Popover';
import { MEDIA } from '@/lib/constants';
import { useHistoryLayer, type HistoryLayer } from '@/lib/historyLayers';
import { useMediaQuery } from '@/lib/hooks';
import { SKIP, useResource } from '@/lib/resource';
import { conversationPage } from '@/lib/resources';
import { cn } from '@/lib/utils';
import type { ChatUser, ConversationPage, Message } from '@/lib/types/message';
import ChatComposer, { type ChatComposerHandle } from './ChatComposer';
import { isBlankValue, outgoingValue } from './composerModel';
import { readDraft, writeDraft } from './drafts';
import EmojiPicker, { type EmojiPick, type EmojiPickerHandle } from './EmojiPicker';
import { discardMessage, queueMessage, retryMessage, settleSent, useOutbox, type OutboxItem } from './outbox';
import Thread, { type ThreadEntry } from './Thread';
import { matchOutgoing, mergeMessages } from './threadModel';
import { markConversationRead } from './unread';

/** Decision 13: an open conversation re-reads its newest page this often while it is on screen. */
const CONVERSATION_POLL_MS = 10_000;

/** Everything the conversation has read: page 1 (polled) and the older pages scrolled back to. */
interface ThreadState {
  /** The page-1 answer last folded in. */
  source: ConversationPage | undefined;
  messages: Message[];
  /** The next older page to read, and whether there is one. */
  nextPage: number;
  hasMore: boolean;
  loadingOlder: boolean;
  olderError: unknown;
}

const EMPTY_THREAD: ThreadState = {
  source: undefined,
  messages: [],
  nextPage: 2,
  hasMore: false,
  loadingOlder: false,
  olderError: undefined,
};

function foldFirstPage(previous: ThreadState, page: ConversationPage): ThreadState {
  return {
    ...previous,
    source: page,
    messages: mergeMessages(previous.messages, page.messages),
    /* Until an older page has been read, page 1 is what says whether there is one. */
    hasMore: previous.nextPage > 2 ? previous.hasMore : page.hasMore,
  };
}

/** An outgoing item, in the shape the thread draws. `sender_id` 0 is never the contact. */
function outgoingMessage(item: OutboxItem, me: { name: string; avatar: string | null }): Message {
  return {
    id: 0,
    sender_id: 0,
    receiver_id: item.contactId,
    content: item.content,
    is_read: 0,
    created_at: item.createdAt,
    sender_name: me.name,
    sender_avatar: me.avatar,
  };
}

export interface ConversationProps {
  token: string;
  contact: ChatUser;
  me: { name: string; avatar: string | null };
  /**
   * `screen` — the phone's full-height view, with its own ← (and, under a finger, the emoji
   * panel docked where the keyboard was). `pane` — the right-hand side of the two-pane frame.
   */
  layout: 'screen' | 'pane';
  active?: boolean;
  onBack?: () => void;
  /** The screen's history layer, so the docked emoji panel's Back stacks on it. */
  historyParent?: RefObject<HistoryLayer | null> | null;
}

/**
 * One conversation: who, the thread, and the composer.
 *
 * **It stays current by itself** (decision 13): page 1 is re-read every ten seconds while it is
 * mounted and the tab is visible, through the resource layer's `refetchInterval` — quietly, the
 * rows staying on screen. ↻ re-reads it at once with the spinner on the button only; it used to
 * collapse the whole thread into its skeleton.
 *
 * **A message is shown the moment it is sent** (`outbox.ts`): 发送中… under it, then nothing
 * once the server has it, or 发送失败 with 重试 and 删除. The composer is cleared at once and
 * keeps focus, so a phone's keyboard stays up. What was typed but not sent survives switching
 * conversations and backing out — a draft per conversation for the session.
 *
 * **Reading it marks it read**: the row's count and the app bar's badge go down the moment the
 * conversation is read (and again when a new message from them arrives while it is open).
 */
export default function Conversation({ token, contact, me, layout, onBack, historyParent = null, active = true }: ConversationProps) {
  const contactId = contact.id;
  const first = useResource(
    conversationPage,
    active ? { token, withUserId: contactId, page: 1 } : SKIP,
    { refetchInterval: active ? CONVERSATION_POLL_MS : undefined },
  );
  const [thread, setThread] = useState<ThreadState>(() =>
    first.data ? foldFirstPage(EMPTY_THREAD, first.data) : EMPTY_THREAD,
  );
  /* Every answer for page 1 (the poll, ↻, a send's re-read) is folded into what the thread
     already holds — an adjustment during render, so the rows and the answer arrive together. */
  if (first.data && first.data !== thread.source) setThread(foldFirstPage(thread, first.data));

  const latest = useRef(thread);
  useLayoutEffect(() => {
    latest.current = thread;
  });
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const olderInFlight = useRef(false);
  const loadOlder = useCallback(async () => {
    const { nextPage, hasMore } = latest.current;
    if (!active || olderInFlight.current || !hasMore) return;
    olderInFlight.current = true;
    setThread((previous) => ({ ...previous, loadingOlder: true, olderError: undefined }));
    try {
      const page = await conversationPage.read({ token, withUserId: contactId, page: nextPage });
      if (!alive.current) return;
      setThread((previous) => ({
        ...previous,
        messages: mergeMessages(previous.messages, page.messages),
        nextPage: nextPage + 1,
        hasMore: page.hasMore && page.messages.length > 0,
        loadingOlder: false,
      }));
    } catch (error) {
      if (!alive.current) return;
      setThread((previous) => ({ ...previous, loadingOlder: false, olderError: error }));
    } finally {
      olderInFlight.current = false;
    }
  }, [token, contactId, active]);

  const isOwn = useCallback((message: Message) => message.sender_id !== contactId, [contactId]);

  /* Outgoing messages until the server's copy is in the thread. */
  const outgoing = useOutbox(token, contactId);
  const { pending, arrived } = useMemo(
    () => matchOutgoing(thread.messages, outgoing, isOwn),
    [thread.messages, outgoing, isOwn],
  );
  useEffect(() => {
    settleSent(token, contactId, arrived);
  }, [token, contactId, arrived]);

  const entries = useMemo<ThreadEntry[]>(
    () => [
      ...thread.messages.map((message) => ({ key: `m${message.id}`, message })),
      ...pending.map((item) => ({ key: `o${item.localId}`, message: outgoingMessage(item, me), outgoing: item })),
    ],
    [thread.messages, pending, me],
  );

  /* Read on screen is read: once for the conversation, then for each newer message of theirs. */
  const markedUpTo = useRef<number | null>(null);
  useEffect(() => {
    const data = first.data;
    if (!active || !data) return;
    let newest = 0;
    let unreadSeen = 0;
    for (const message of data.messages) {
      if (message.sender_id !== contactId) continue;
      newest = Math.max(newest, message.id);
      if (!message.is_read) unreadSeen += 1;
    }
    if (markedUpTo.current !== null && newest <= markedUpTo.current) return;
    markedUpTo.current = newest;
    markConversationRead(token, contactId, unreadSeen);
  }, [first.data, token, contactId, active]);

  /* ---- The composer ---- */
  const composerRef = useRef<ChatComposerHandle>(null);
  const [initialDraft] = useState(() => readDraft(token, contactId));
  const [blank, setBlank] = useState(() => isBlankValue(initialDraft));
  const finePointer = useMediaQuery(MEDIA.pointerFine);

  const send = () => {
    const value = outgoingValue(composerRef.current?.value() ?? '');
    if (isBlankValue(value)) return;
    const afterId = latest.current.messages.reduce((max, message) => Math.max(max, message.id), 0);
    queueMessage(token, contactId, value, afterId);
    composerRef.current?.clear();
  };

  const newestKnownId = () => latest.current.messages.reduce((max, message) => Math.max(max, message.id), 0);

  /* ---- Emoji ---- */
  const wide = useMediaQuery(MEDIA.sm);
  /* Under a phone's width the picker takes the keyboard's place under the composer, as a
     messenger's does, so the message stays in view while it is picked into; wider, it is a
     popover off its button. */
  const docked = layout === 'screen' && !wide;
  const [emojiOpen, setEmojiOpen] = useState(false);
  const emojiButtonRef = useRef<HTMLButtonElement>(null);
  const pickerRef = useRef<EmojiPickerHandle>(null);
  const panelId = useId();
  const closeEmoji = useCallback(() => setEmojiOpen(false), []);
  /* Back closes the docked panel before it closes the conversation (decision 1). */
  useHistoryLayer(emojiOpen && docked, closeEmoji, { parent: historyParent });

  /* The grid takes focus when it opens — the popover's panel is laid out a frame after it
     mounts, so a second frame is allowed for. */
  useEffect(() => {
    if (!emojiOpen) return;
    let frame = requestAnimationFrame(() => {
      pickerRef.current?.focus();
      frame = requestAnimationFrame(() => pickerRef.current?.focus());
    });
    return () => cancelAnimationFrame(frame);
  }, [emojiOpen]);

  const onPick = (pick: EmojiPick) => {
    if (pick.kind === 'pony') composerRef.current?.insertEmoji(pick.name);
    else composerRef.current?.insertText(pick.glyph);
  };

  const toggleEmoji = () => {
    if (!emojiOpen) {
      setEmojiOpen(true);
      return;
    }
    setEmojiOpen(false);
    composerRef.current?.focus();
  };

  const leaveEmoji = (direction: 'forward' | 'backward' | 'escape') => {
    setEmojiOpen(false);
    if (direction === 'backward') emojiButtonRef.current?.focus();
    else composerRef.current?.focus();
  };

  const picker = (
    <EmojiPicker
      ref={pickerRef}
      onPick={onPick}
      onLeave={leaveEmoji}
      captionClassName={docked ? 'pb-[max(0.5rem,env(safe-area-inset-bottom))]' : 'pb-2'}
    />
  );
  const refreshing = first.isLoading && first.data !== undefined;

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      <header className="flex min-w-0 shrink-0 items-center gap-1 bg-surface-container px-2 py-2 sm:px-3">
        {layout === 'screen' && <IconButton onClick={onBack} aria-label="返回联系人列表" icon={<MdArrowBack />} />}
        {/* Who this is, and the way to their profile. */}
        <Link
          href={`/user/${contactId}`}
          scroll={false}
          data-ripple=""
          className="state-layer flex min-w-0 items-center gap-3 rounded-full py-1 pr-4 pl-1 focus-visible:outline-hidden focus-visible:ring-2 focus-ring"
        >
          <Avatar src={contact.avatar} name={contact.username} size={40} />
          <span className="text-title-m text-on-surface min-w-0 truncate">{contact.username}</span>
        </Link>
        <IconButton
          onClick={first.refresh}
          loading={refreshing}
          aria-label="刷新消息"
          className="ms-auto"
          icon={<MdRefresh />}
        />
      </header>

      <Thread
        entries={entries}
        isOwn={isOwn}
        me={me}
        contact={{ name: contact.username, avatar: contact.avatar }}
        loading={first.data === undefined && first.error === undefined}
        error={first.data === undefined ? first.error : undefined}
        onRetry={first.refresh}
        older={{
          hasMore: thread.hasMore,
          loading: thread.loadingOlder,
          error: thread.olderError,
          load: () => void loadOlder(),
        }}
        onRetrySend={(item) => retryMessage(token, contactId, item.localId, newestKnownId())}
        onDiscardSend={(item) => discardMessage(token, contactId, item.localId)}
        label={`与 ${contact.username} 的聊天记录`}
      />

      {/* 8dp around three 48dp targets: the dense composer row (AGENTS: the chat composer). The
          two controls stay outside the field and at its bottom as it grows. The safe-area inset
          keeps them above the home indicator — or goes to the emoji panel when it is below. */}
      <div
        className={cn(
          'flex shrink-0 items-end gap-2 bg-surface-container p-2 [--touch-floor:48px]',
          !(docked && emojiOpen) && 'pb-[max(0.5rem,env(safe-area-inset-bottom))]',
        )}
      >
        <IconButton
          ref={emojiButtonRef}
          onClick={toggleEmoji}
          aria-label="表情"
          aria-expanded={emojiOpen}
          aria-haspopup="dialog"
          aria-controls={docked && emojiOpen ? panelId : undefined}
          size="md"
          shape="square"
          variant="tonal"
          className="touch-size rounded-l-lg rounded-r-xs"
          icon={<MdOutlineEmojiEmotions />}
        />
        {!docked && (
          <Popover
            open={emojiOpen}
            onClose={(refocus) => {
              setEmojiOpen(false);
              if (refocus) composerRef.current?.focus();
            }}
            anchorRef={emojiButtonRef}
            role="dialog"
            aria-label="表情"
            matchAnchorWidth={false}
            maxHeight={320}
            estimatedHeight={320}
            className="w-84 max-w-[calc(100vw-2rem)] px-2 pt-2"
          >
            {picker}
          </Popover>
        )}
        <div className="min-w-0 flex-1">
          <ChatComposer
            ref={composerRef}
            initialValue={initialDraft}
            placeholder="输入消息…"
            label={`发给 ${contact.username} 的消息`}
            onChange={(value) => {
              setBlank(isBlankValue(value));
              writeDraft(token, contactId, value);
            }}
            onSubmit={send}
            onFocus={() => {
              /* Back to the keyboard: the docked panel gives up its place. */
              if (docked && emojiOpen) setEmojiOpen(false);
            }}
            onEscape={() => {
              if (emojiOpen) setEmojiOpen(false);
            }}
            autoFocus={finePointer}
          />
        </div>
        <IconButton
          onClick={send}
          /* Pressing it must not take focus from the field — that closed a phone's keyboard on
             every message sent. */
          onPointerDown={(event) => event.preventDefault()}
          variant="filled"
          size="md"
          shape="square"
          className="touch-size rounded-r-lg rounded-l-xs"
          disabled={blank}
          aria-label="发送"
          icon={<MdSend />}
        />
      </div>

      {docked && emojiOpen && (
        <div
          id={panelId}
          role="dialog"
          aria-label="表情"
          className="popover-scrollbar h-72 max-h-[45dvh] shrink-0 overflow-y-auto overscroll-contain bg-surface-container px-3 pt-1"
        >
          {picker}
        </div>
      )}
    </div>
  );
}
