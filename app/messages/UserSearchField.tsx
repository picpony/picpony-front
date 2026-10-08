'use client';

import { Fragment, useMemo, useRef, useState } from 'react';
import Avatar from '@/components/Avatar';
import Popover, { estimateMenuHeight } from '@/components/Popover';
import SearchInput from '@/components/SearchInput';
import Spinner from '@/components/Spinner';
import { matchesName, useUserSearch } from '@/components/ShareToContactDialog';
import { apiErrorMessage } from '@/lib/api/errors';
import { useCombobox } from '@/lib/useCombobox';
import { cn } from '@/lib/utils';
import type { ChatUser, Contact } from '@/lib/types/message';

type Option =
  | { kind: 'contact'; person: ChatUser }
  | { kind: 'user'; person: ChatUser }
  | { kind: 'status'; text: string; busy: boolean };

/** Contacts shown for a query before the people the server finds. */
const CONTACT_MATCHES = 5;

/**
 * 搜索用户 — the field above the contacts, and the way to write to somebody new.
 *
 * It said 「搜索昵称发起私信…」 and only filtered the contacts already in the list; searching
 * for anybody else found nothing. It is a combobox now (`useCombobox`): what you type is matched
 * against your contacts at once and looked up with `search_users` a moment later, both in one
 * list, and picking a person opens the conversation with them — a new one if there was none.
 * You are never offered yourself.
 *
 * The lookup's own states are rows of the list (disabled options, so the arrows skip them):
 * 正在搜索用户…, 没有找到用户, or the failure's sentence.
 */
export default function UserSearchField({
  token,
  myId,
  contacts,
  onPick,
}: {
  token: string;
  myId: number | null;
  contacts: readonly Contact[] | undefined;
  onPick: (person: ChatUser) => void;
}) {
  const [query, setQuery] = useState('');
  const [listOpen, setListOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const search = useUserSearch(token, query);
  const { keyword, users, searching, error } = search;

  const options = useMemo<Option[]>(() => {
    if (!keyword) return [];
    const matches = (contacts ?? [])
      .filter((contact) => matchesName(contact.username, keyword))
      .slice(0, CONTACT_MATCHES)
      .map((contact): Option => ({
        kind: 'contact',
        person: { id: contact.id, username: contact.username, avatar: contact.avatar },
      }));
    const known = new Set((contacts ?? []).map((contact) => contact.id));
    const people = (users ?? [])
      .filter((person) => person.id !== myId && !known.has(person.id))
      .map((person): Option => ({ kind: 'user', person }));
    const list = [...matches, ...people];
    if (searching) list.push({ kind: 'status', text: '正在搜索用户…', busy: true });
    else if (error !== undefined) list.push({ kind: 'status', text: `用户搜索失败：${apiErrorMessage(error)}`, busy: false });
    else if (list.length === 0) list.push({ kind: 'status', text: '没有找到用户', busy: false });
    return list;
  }, [keyword, contacts, users, myId, searching, error]);

  const pick = (option: Option) => {
    if (option.kind === 'status') return;
    setQuery('');
    setListOpen(false);
    onPick(option.person);
  };

  const box = useCombobox({
    options,
    open: listOpen,
    onOpenChange: setListOpen,
    onSelect: pick,
    /* Enter with no row chosen looks the name up now rather than after the pause. */
    onEnterWithoutActive: search.flush,
    isOptionDisabled: (option) => option.kind === 'status',
    resetKey: keyword,
  });

  return (
    <>
      <div ref={wrapRef} className="min-w-0 flex-1">
        <SearchInput
          value={query}
          onChange={(value) => {
            setQuery(value);
            setListOpen(value.trim() !== '');
          }}
          placeholder="搜索用户，发起私信…"
          aria-label="搜索用户"
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="none"
          spellCheck={false}
          enterKeyHint="search"
          {...box.inputProps}
          onFocus={() => {
            if (query.trim()) setListOpen(true);
          }}
          onBlur={() => setListOpen(false)}
        />
      </div>
      <Popover
        open={box.isOpen}
        onClose={() => setListOpen(false)}
        anchorRef={wrapRef}
        {...box.listboxProps}
        aria-label="搜索结果"
        estimatedHeight={estimateMenuHeight(options.length, 56)}
      >
        {options.map((option, index) => {
          const kindChanged = index > 0 && options[index - 1].kind !== option.kind && option.kind !== 'status';
          return (
            <Fragment key={option.kind === 'status' ? 'status' : `${option.kind}:${option.person.id}`}>
              {/* A caption between the two groups — seen, not read: each row says which it is. */}
              {kindChanged && (
                <div aria-hidden="true" className="px-2 pt-2 pb-1 text-label-m text-on-surface-variant">
                  其他用户
                </div>
              )}
              <div
                {...box.getOptionProps(index)}
                className={cn(
                  'flex min-h-14 w-full items-center gap-3 rounded-sm px-2 py-1 text-left select-none',
                  option.kind === 'status' ? 'text-body-m text-on-surface-variant' : cn('cursor-pointer', box.optionClassName(index)),
                )}
              >
                {option.kind === 'status' ? (
                  <>
                    <span className="grid size-10 shrink-0 place-items-center" aria-hidden="true">
                      {option.busy && <Spinner size="sm" />}
                    </span>
                    <span className="min-w-0 flex-1 wrap-anywhere">{option.text}</span>
                  </>
                ) : (
                  <>
                    <Avatar src={option.person.avatar} name={option.person.username} size={40} />
                    <span className="flex min-w-0 flex-1 flex-col">
                      <span className="truncate text-label-l-emphasized text-on-surface">{option.person.username}</span>
                      <span className="truncate text-body-s text-on-surface-variant">
                        {option.kind === 'contact' ? '联系人' : '发起私信'}
                      </span>
                    </span>
                  </>
                )}
              </div>
            </Fragment>
          );
        })}
      </Popover>
    </>
  );
}
