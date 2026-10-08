'use client';

import { type RefObject } from 'react';
import { MdChevronLeft, MdChevronRight, MdErrorOutline, MdOutlineChatBubbleOutline } from 'react-icons/md';
import Avatar from '@/components/Avatar';
import { CountBadge } from '@/components/Badge';
import EmptyState from '@/components/EmptyState';
import ErrorRetry from '@/components/ErrorRetry';
import IconButton from '@/components/IconButton';
import { useTooltip } from '@/components/Tooltip';
import { apiErrorMessage, isRetryable } from '@/lib/api/errors';
import { useNow } from '@/lib/hooks';
import { ICON } from '@/lib/icons';
import { cn } from '@/lib/utils';
import type { ChatUser, Contact } from '@/lib/types/message';
import { messagePreview } from './messageText';
import { ContactRowsSkeleton } from './Skeletons';
import { contactTime } from './threadModel';
import UserSearchField from './UserSearchField';

/** The drawer's springs, per direction — see the note on the rail below. */
const railSpring = (collapsed: boolean) => (collapsed ? 'spring-fast-effects' : 'spring-default-spatial');

interface ContactListProps {
  token: string;
  myId: number | null;
  contacts: {
    data: readonly Contact[] | undefined;
    error: unknown;
    refresh: () => void;
  };
  selectedId: number | null;
  onSelect: (person: ChatUser) => void;
  /**
   * `rail` — the left column of the two-pane frame, collapsible to its portraits. `list` — the
   * phone's (and any narrow column's) list, in the page's own flow: the conversation opens over
   * it as a full-height view.
   */
  mode: 'rail' | 'list';
  collapsed: boolean;
  onToggleCollapsed: () => void;
}

/**
 * The contacts: 搜索用户 on top, then everyone you have written to, newest first — each row
 * with the last message (when the backend sends one) and a day label rather than the raw
 * 19-character stamp it printed.
 *
 * **The rail.** In the two-pane frame the column collapses to its portraits, on the drawer's
 * springs per direction (`default-spatial` open, `fast-effects` closed), with every clock of the
 * gesture — width, the header's gap, the search box's width and grow, the labels' fade — on the
 * same one, because they are one movement. Nothing about a row's own layout changes: it keeps
 * its 72dp box and the rail narrows over it, clipping the text. The collapsed width is derived,
 * not chosen: the row's height plus the list's 8px inset either side (88), so the row comes out
 * square and its 48dp portrait centres itself at the row's 12px padding. Three numbers move
 * together — the rail's collapsed width, the row's height, the row's padding.
 */
export default function ContactList({
  token,
  myId,
  contacts,
  selectedId,
  onSelect,
  mode,
  collapsed: collapsedProp,
  onToggleCollapsed,
}: ContactListProps) {
  const rail = mode === 'rail';
  const collapsed = rail && collapsedProp;
  const spring = railSpring(collapsed);
  const now = useNow();
  const { data, error } = contacts;

  const rows = (() => {
    if (data === undefined && error === undefined) return <ContactRowsSkeleton flow={!rail} faded={collapsed} />;
    if (data === undefined) {
      /* Collapsed, the rail is 88px wide and a status block wraps to a column of two-character
         lines, so the state is the one control it is about: retry, named by the failure. */
      if (collapsed) {
        return (
          <div className="flex justify-center pt-2">
            <IconButton
              onClick={contacts.refresh}
              aria-label={`联系人加载失败：${apiErrorMessage(error)}，点按重试`}
              variant="danger-text"
              icon={<MdErrorOutline />}
            />
          </div>
        );
      }
      return (
        <ErrorRetry
          size="inline"
          title="联系人加载失败"
          message={apiErrorMessage(error)}
          onRetry={isRetryable(error) ? contacts.refresh : undefined}
        />
      );
    }
    if (data.length === 0) {
      /* Words are the one thing a collapsed rail has no room for; an empty rail is an empty list. */
      return collapsed ? null : (
        <EmptyState
          size="inline"
          icon={<MdOutlineChatBubbleOutline size={ICON.large} />}
          title="还没有任何私信"
          description="在上方搜索用户，即可发起私信。"
        />
      );
    }
    return (
      <ul aria-label="最近联系人" className="flex flex-col gap-0.5">
        {data.map((contact) => (
          <li key={contact.id}>
            <ContactRow
              contact={contact}
              active={contact.id === selectedId}
              collapsed={collapsed}
              spring={spring}
              now={now}
              onSelect={() => onSelect({ id: contact.id, username: contact.username, avatar: contact.avatar })}
            />
          </li>
        ))}
      </ul>
    );
  })();

  return (
    <div
      className={cn(
        'flex shrink-0 flex-col',
        rail && 'transition-[width]',
        rail && spring,
        /* One branch or the other, never both: `cn` is a plain join. */
        rail ? (collapsed ? 'w-22' : 'w-72') : 'w-full',
      )}
    >
      <div
        className={cn(
          'flex items-center gap-2',
          rail ? 'p-3' : 'pb-3',
          /* The gap is on the rail's clock and reaches 0 collapsed, or the toggle cannot end up
             centred in the 88px rail. */
          rail && 'transition-[gap]',
          rail && spring,
          collapsed && 'gap-0',
        )}
      >
        {/* Kept mounted and faded rather than unmounted while the rail collapses — pulled out
            of the row on the first frame, the toggle jumped the field's whole width before the
            rail had narrowed. `flex-grow` rides the same clock as the width, so the space is
            handed over gradually; an invisible field takes no clicks and no focus. */}
        <div
          className={cn(
            'flex min-w-0',
            rail && 'transition-[width,opacity,flex-grow]',
            rail && spring,
            collapsed ? 'pointer-events-none w-0 grow-0 opacity-0' : 'flex-1 opacity-100',
          )}
          aria-hidden={collapsed || undefined}
          inert={collapsed || undefined}
        >
          <UserSearchField token={token} myId={myId} contacts={data} onPick={onSelect} />
        </div>
        {rail && (
          <IconButton
            onClick={onToggleCollapsed}
            aria-label={collapsed ? '展开联系人列表' : '收起联系人列表'}
            aria-expanded={!collapsed}
            className="mx-auto"
            icon={collapsed ? <MdChevronRight /> : <MdChevronLeft />}
          />
        )}
      </div>
      <div className={cn(rail && 'popover-scrollbar min-h-0 flex-1 overflow-y-auto p-2')}>{rows}</div>
    </div>
  );
}

function ContactRow({
  contact,
  active,
  collapsed,
  spring,
  now,
  onSelect,
}: {
  contact: Contact;
  active: boolean;
  collapsed: boolean;
  spring: string;
  now: number | null;
  onSelect: () => void;
}) {
  const unread = contact.unread_count;
  const name = unread > 0 ? `${contact.username}，${unread} 条未读` : contact.username;
  /* Collapsed, the row is its portrait: the name comes back as the plain tooltip. */
  const { anchorRef, anchorProps, tooltip } = useTooltip(collapsed ? contact.username : undefined);
  const preview = contact.last_message ? messagePreview(contact.last_message) : '';
  /* The open row's supporting lines take its container's ink: under forced colors the row wears
     the system's selection pair, and a line keeping its own ink read dim on it. */
  const supporting = active ? undefined : 'text-on-surface-variant';
  const time = contactTime(contact.last_msg_time, now);
  return (
    <>
      <button
        ref={anchorRef as RefObject<HTMLButtonElement | null>}
        {...anchorProps}
        type="button"
        onClick={onSelect}
        data-contact-id={contact.id}
        aria-current={active ? 'true' : undefined}
        aria-label={name}
        data-ripple=""
        /* **72dp at every density** (`ItemTwoLineContainerHeight`), a pill like the drawer's
           rows, the state layer for hover and press and the container pair for the one that is
           open — "selected" and "hovered" must not look alike. */
        className={cn(
          'flex h-18 w-full cursor-pointer items-center gap-3 overflow-hidden rounded-full px-3 text-left',
          'transition-ui focus-visible:outline-hidden focus-visible:ring-2 focus-ring',
          active ? 'forced-selected bg-secondary-container text-on-secondary-container' : 'state-layer text-on-surface',
        )}
      >
        <span className="relative shrink-0">
          <Avatar src={contact.avatar} name={contact.username} size={48} />
          <span className="absolute -top-0.5 -right-0.5">
            <CountBadge count={unread} label={`${unread} 条未读`} />
          </span>
        </span>
        {/* Faded, never unmounted: removing it on the first frame made the row change height the
            instant the toggle was pressed. */}
        <span aria-hidden="true" className={cn('flex min-w-0 flex-1 flex-col transition-opacity', spring, collapsed && 'opacity-0')}>
          <span className="flex items-baseline gap-2">
            <span className="text-label-l-emphasized min-w-0 flex-1 truncate">{contact.username}</span>
            {time && <span className={cn('text-label-s shrink-0 tabular-nums', supporting)}>{time}</span>}
          </span>
          {preview && <span className={cn('text-body-s mt-0.5 truncate', supporting)}>{preview}</span>}
        </span>
      </button>
      {tooltip}
    </>
  );
}
