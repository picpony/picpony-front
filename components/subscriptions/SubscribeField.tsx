'use client';

import { useEffect, useMemo, useRef, useState, type ChangeEvent, type FormEvent } from 'react';
import { MdClose, MdNotificationAdd } from 'react-icons/md';
import Button from '@/components/Button';
import IconButton from '@/components/IconButton';
import { Input } from '@/components/Input';
import Popover, { estimateMenuHeight } from '@/components/Popover';
import { showToast } from '@/components/Toast';
import type { TagSuggestion } from '@/lib/api/semantic';
import { formatCount } from '@/lib/format';
import { readToken } from '@/lib/hooks';
import { SKIP, useResource } from '@/lib/resource';
import { tagSuggestions } from '@/lib/resources';
import { hasCjk } from '@/lib/searchQuery';
import { tagCategory, tagCategoryDot } from '@/lib/tagCategories';
import { useCombobox } from '@/lib/useCombobox';
import { cn } from '@/lib/utils';
import { subscribeMessage, subscribeToTag } from './actions';

/** Two Latin characters or one Chinese one before the dictionary is asked — /search's rule. */
function keywordOf(text: string): string {
  const tag = text.replace(/["()[\]{}*]/g, '').trim();
  return tag.length >= 2 || hasCjk(tag) ? tag : '';
}

const LOOKUP_DEBOUNCE_MS = 300;

/** 56dp rows, 8dp inside the panel, 8dp corners — the ordinary autocomplete row. */
const ROW = 'flex min-h-14 w-full cursor-pointer items-center gap-3 rounded-sm px-2 py-1 text-left select-none';

/**
 * 订阅标签: type a tag (or pick one the dictionary suggests — a Chinese name finds its English tag)
 * and subscribe. One tag per field, unlike /search's: the whole text is the tag.
 *
 * The combobox is `useCombobox`: nothing is active until the arrows enter the list, so Enter
 * subscribes to what was typed; picking a suggestion subscribes to that tag. An IME's pinyin
 * fragments never trigger a lookup. While the live count is read and the subscription written
 * the submit is busy; the field clears once it has landed.
 */
export default function SubscribeField({ token, onSubscribed }: { token: string; onSubscribed?: (tag: string) => void }) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [value, setValue] = useState('');
  const [keyword, setKeyword] = useState('');
  const [listOpen, setListOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);

  const read = useResource(tagSuggestions, keyword ? { keyword } : SKIP, { keepPrevious: 'subscribe-field' });
  const options = useMemo<TagSuggestion[]>(() => (keyword ? read.data ?? [] : []), [keyword, read.data]);

  const lookUp = (text: string) => {
    clearTimeout(timer.current);
    const next = keywordOf(text);
    if (!next) {
      setKeyword('');
      return;
    }
    setListOpen(true);
    timer.current = setTimeout(() => setKeyword(next), LOOKUP_DEBOUNCE_MS);
  };

  const submit = async (tag: string) => {
    const text = tag.trim();
    if (!text || busy) return;
    clearTimeout(timer.current);
    setKeyword('');
    setListOpen(false);
    setBusy(true);
    /* The list under this field shows the new row: it waits briefly for the tag's Chinese name,
       so the row arrives named (M1-017). */
    const outcome = await subscribeToTag(token, text, { awaitName: true });
    setBusy(false);
    /* Answered for an account that has since gone: that screen is not this one any more — unless
       the change is the answer itself (nothing was written, and the toast says why). */
    if (outcome.kind !== 'stale-session' && readToken() !== token) return;
    const [message, tone] = subscribeMessage(outcome);
    showToast(message, tone);
    if (outcome.kind === 'done' || outcome.kind === 'exists') {
      setValue('');
      if (outcome.kind === 'done') onSubscribed?.(outcome.tagName);
    }
  };

  const box = useCombobox({
    options,
    open: listOpen,
    onOpenChange: setListOpen,
    onSelect: (option) => {
      setValue(option.en);
      void submit(option.en);
    },
    onCompositionEnd: (committed) => lookUp(committed),
    resetKey: keyword,
  });

  const handleChange = (event: ChangeEvent<HTMLInputElement>) => {
    setValue(event.target.value);
    if (box.isComposing()) return;
    lookUp(event.target.value);
  };

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    void submit(value);
  };

  return (
    <form onSubmit={handleSubmit} action="" className="mb-6" data-subscribe-field>
      <div ref={wrapRef}>
        <Input
          ref={inputRef}
          type="text"
          value={value}
          onChange={handleChange}
          placeholder="输入标签订阅，例如 rainbow dash"
          aria-label="要订阅的标签"
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="none"
          spellCheck={false}
          enterKeyHint="go"
          /* Read-only, never disabled, while it runs: the field keeps the focus Enter left in it. */
          readOnly={busy}
          {...box.inputProps}
          onBlur={() => setListOpen(false)}
          trailing={
            <>
              {value && !busy && (
                <IconButton
                  dismiss
                  aria-label="清除"
                  icon={<MdClose />}
                  onPointerDown={(event) => event.preventDefault()}
                  onClick={() => {
                    clearTimeout(timer.current);
                    setKeyword('');
                    setValue('');
                    inputRef.current?.focus();
                  }}
                />
              )}
              <Button type="submit" variant="filled" icon={<MdNotificationAdd />} loading={busy} responsiveLabel>
                订阅
              </Button>
            </>
          }
        />
      </div>
      <Popover
        open={box.isOpen}
        onClose={() => setListOpen(false)}
        anchorRef={wrapRef}
        {...box.listboxProps}
        aria-label="标签建议"
        className="p-2"
        estimatedHeight={estimateMenuHeight(options.length, 56)}
      >
        {options.map((option, index) => {
          const category = tagCategory(option.category);
          return (
            <div key={option.en} {...box.getOptionProps(index)} className={cn(ROW, box.optionClassName(index))}>
              <span className="grid size-6 shrink-0 place-items-center" aria-hidden="true">
                <span className={cn('size-2.5 rounded-full', tagCategoryDot(option.category))} />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-body-l text-on-surface">{option.cn || option.en}</span>
                <span className="block truncate text-body-s text-on-surface-variant">
                  {option.cn ? `${option.en} · ${category.label}` : category.label}
                </span>
              </span>
              {option.count > 0 && (
                <span className="shrink-0 text-label-m text-on-surface-variant tabular-nums">{formatCount(option.count)}</span>
              )}
            </div>
          );
        })}
      </Popover>
      <p className="sr-only" aria-live="polite">
        {busy ? '正在查询标签收录量并订阅…' : ''}
      </p>
    </form>
  );
}
