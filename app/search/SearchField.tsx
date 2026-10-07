'use client';

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type FormEvent,
  type KeyboardEvent,
} from 'react';
import { MdClose, MdDeleteSweep, MdHistory, MdImageSearch, MdSearch, MdWarningAmber } from 'react-icons/md';
import Button from '@/components/Button';
import IconButton from '@/components/IconButton';
import { Input } from '@/components/Input';
import Popover, { estimateMenuHeight } from '@/components/Popover';
import type { TagSuggestion } from '@/lib/api/semantic';
import { formatCount } from '@/lib/format';
import { ICON } from '@/lib/icons';
import { SKIP, useResource } from '@/lib/resource';
import { tagSuggestions } from '@/lib/resources';
import { hasCjk } from '@/lib/searchQuery';
import { tagCategory, tagCategoryDot } from '@/lib/tagCategories';
import { useCombobox } from '@/lib/useCombobox';
import { cn } from '@/lib/utils';
import { clearSearchHistory, readSearchHistory } from './searchHistory';

type FieldOption =
  | { kind: 'recent'; query: string }
  | { kind: 'clear-recent' }
  | { kind: 'tag'; tag: TagSuggestion };

/** The separators between the terms a suggestion can replace — a comma, or an operator. */
const SEPARATORS = /(?:,|，| OR | AND |\|\||&&|\n)/gi;

/** The term the caret is in: its bounds, its leading operators (`-`, `!`, `~`), the tag typed. */
function termAt(value: string, caret: number) {
  let start = 0;
  SEPARATORS.lastIndex = 0;
  for (let match = SEPARATORS.exec(value); match; match = SEPARATORS.exec(value)) {
    if (match.index >= caret) break;
    start = match.index + match[0].length;
  }
  SEPARATORS.lastIndex = caret;
  const next = SEPARATORS.exec(value);
  const end = next ? next.index : value.length;
  const raw = value.slice(start, end);
  const parts = /^([\s\-!~]*)(.*)$/.exec(raw);
  return { start, end, prefix: parts?.[1] ?? '', tag: (parts?.[2] ?? raw).trim() };
}

/** What to ask the dictionary for: two characters of Latin text, or one of Chinese. */
function keywordAt(value: string, caret: number): string {
  const tag = termAt(value, caret).tag.replace(/["()[\]{}*]/g, '').trim();
  return tag.length >= 2 || hasCjk(tag) ? tag : '';
}

/** Long enough that a word typed at speed asks once, short enough to feel immediate. */
const LOOKUP_DEBOUNCE_MS = 300;

/**
 * 56dp rows, 8dp inside the 28dp view, 20dp corners — the search bar's own suggestion
 * geometry (AGENTS: "The search suggestion view belongs to the search bar"). A 24dp leading
 * slot and a 16dp gap put the label on the field's text column.
 */
const ROW = 'flex min-h-14 w-full cursor-pointer items-center gap-4 rounded-xl px-2 py-1 text-left select-none';

interface SearchFieldProps {
  value: string;
  onValueChange: (value: string) => void;
  /** Submit the field's text (the caller normalises it and decides whether it is a new search). */
  onSubmit: (text: string) => void;
  /** Search a recent query again. */
  onRecentPick: (query: string) => void;
  onImageSearch: () => void;
  /** Safe mode marks the tags the safe filter keeps out. */
  safeMode: boolean;
  placeholder: string;
  inputRef?: React.RefObject<HTMLInputElement | null>;
}

/**
 * The search bar: the field, what it suggests, and its two actions.
 *
 * **The combobox is `useCombobox`**: no row is active until the arrows move into the list, so
 * Enter searches what was typed; Tab moves on; an IME's composition never triggers a lookup.
 * **The list is kept while a new lookup is in flight** (`keepPrevious`): it closed on every
 * keystroke and reopened 300ms plus a round trip later, a list blinking under the finger. With
 * nothing typed, the list is the recent searches; it opens on a press, a clear or ArrowDown —
 * never on focus alone, so arriving on the screen does not throw a panel over it.
 */
export default function SearchField({
  value,
  onValueChange,
  onSubmit,
  onRecentPick,
  onImageSearch,
  safeMode,
  placeholder,
  inputRef: externalRef,
}: SearchFieldProps) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const ownRef = useRef<HTMLInputElement>(null);
  const inputRef = externalRef ?? ownRef;
  const [listOpen, setListOpen] = useState(false);
  const [keyword, setKeyword] = useState('');
  const [recents, setRecents] = useState<string[]>([]);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);

  const read = useResource(tagSuggestions, keyword ? { keyword } : SKIP, { keepPrevious: 'search-field' });
  const empty = value.trim() === '';
  const suggestions = keyword ? read.data : undefined;

  const options = useMemo<FieldOption[]>(() => {
    if (empty) {
      return recents.length > 0
        ? [...recents.map((query): FieldOption => ({ kind: 'recent', query })), { kind: 'clear-recent' }]
        : [];
    }
    return (suggestions ?? []).map((tag): FieldOption => ({ kind: 'tag', tag }));
  }, [empty, recents, suggestions]);

  const openRecents = () => {
    setRecents(readSearchHistory());
    setListOpen(true);
  };

  /** Schedule the lookup for the term at `caret`; a term too short to ask about closes the list. */
  const lookUp = (text: string, caret: number) => {
    clearTimeout(timer.current);
    if (text.trim() === '') {
      setKeyword('');
      openRecents();
      return;
    }
    const next = keywordAt(text, caret);
    if (!next) {
      setKeyword('');
      return;
    }
    setListOpen(true);
    timer.current = setTimeout(() => setKeyword(next), LOOKUP_DEBOUNCE_MS);
  };

  const insertTag = (tag: TagSuggestion) => {
    const input = inputRef.current;
    const caret = input?.selectionStart ?? value.length;
    const term = termAt(value, caret);
    const before = value.slice(0, term.start);
    const after = value.slice(term.end);
    /* A separator after the last term, so the next word typed is a new term. */
    const inserted = `${term.prefix}${tag.en}${after.trim() === '' ? ', ' : ''}`;
    const next = `${before}${inserted}${after.trim() === '' ? '' : after}`;
    onValueChange(next);
    setKeyword('');
    const position = before.length + inserted.length;
    requestAnimationFrame(() => {
      const field = inputRef.current;
      if (!field) return;
      field.focus({ preventScroll: true });
      field.setSelectionRange(position, position);
    });
  };

  const pick = (option: FieldOption) => {
    clearTimeout(timer.current);
    if (option.kind === 'recent') {
      setKeyword('');
      onRecentPick(option.query);
    } else if (option.kind === 'clear-recent') {
      clearSearchHistory();
      setRecents([]);
    } else {
      insertTag(option.tag);
    }
  };

  const box = useCombobox({
    options,
    open: listOpen,
    onOpenChange: (open) => {
      if (open && empty) setRecents(readSearchHistory());
      setListOpen(open);
    },
    onSelect: pick,
    onCompositionEnd: (committed) => lookUp(committed, inputRef.current?.selectionStart ?? committed.length),
    resetKey: empty ? '' : keyword,
  });

  const handleChange = (event: ChangeEvent<HTMLInputElement>) => {
    const next = event.target.value;
    onValueChange(next);
    /* Pinyin fragments are not words: the lookup waits for the committed text. */
    if (box.isComposing()) return;
    lookUp(next, event.target.selectionStart ?? next.length);
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    box.inputProps.onKeyDown(event);
    /* Escape with the list closed clears the text, as a search field's Escape does — the
       list, when open, has already taken the key. Never during a composition: an IME's
       cancel arrives as Escape. */
    if (
      event.key === 'Escape' && !event.defaultPrevented && value &&
      !event.nativeEvent.isComposing && event.keyCode !== 229
    ) {
      event.preventDefault();
      clearTimeout(timer.current);
      setKeyword('');
      onValueChange('');
    }
  };

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    clearTimeout(timer.current);
    setKeyword('');
    setListOpen(false);
    onSubmit(value);
  };

  const clear = () => {
    clearTimeout(timer.current);
    setKeyword('');
    onValueChange('');
    openRecents();
    inputRef.current?.focus();
  };

  return (
    <form role="search" onSubmit={handleSubmit} action="">
      <div ref={wrapRef}>
        <Input
          ref={inputRef}
          type="text"
          size="lg"
          icon={<MdSearch size={ICON.standard} />}
          value={value}
          onChange={handleChange}
          placeholder={placeholder}
          aria-label="搜索图片"
          /* The app bar's 搜索 finds the field by this when /search is already on screen. */
          data-search-field=""
          /* The phone keyboard's return key says 搜索, and nothing second-guesses a tag name:
             no capitalising, no autocorrect, no spellcheck underline, and no form history
             dropped over the app's own list. */
          inputMode="search"
          enterKeyHint="search"
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="none"
          spellCheck={false}
          {...box.inputProps}
          onKeyDown={handleKeyDown}
          onPointerDown={() => {
            if (empty) openRecents();
          }}
          /* Read, not opened: ArrowDown on an empty field opens the recent searches, and it can
             only open a list that has rows. */
          onFocus={() => setRecents(readSearchHistory())}
          onBlur={() => setListOpen(false)}
          /* Inside the box: the clear control while there is text (M3's search bar), then the
             two actions. Only the submit carries a container; the other two are glyphs at the
             field's trailing-icon ink. Below `sm` the submit is its glyph alone. */
          trailing={
            <>
              {value && (
                <IconButton
                  dismiss
                  aria-label="清除"
                  icon={<MdClose />}
                  onPointerDown={(event) => event.preventDefault()}
                  onClick={clear}
                />
              )}
              <IconButton variant="standard" onClick={onImageSearch} aria-label="以图搜图" icon={<MdImageSearch />} />
              <Button type="submit" variant="filled" icon={<MdSearch />} responsiveLabel>
                搜索
              </Button>
            </>
          }
        />
      </div>
      <Popover
        open={box.isOpen}
        onClose={() => setListOpen(false)}
        anchorRef={wrapRef}
        variant="search"
        {...box.listboxProps}
        aria-label={empty ? '最近搜索' : '搜索建议'}
        estimatedHeight={estimateMenuHeight(options.length, 56)}
      >
        {options.map((option, index) => (
          <div
            key={option.kind === 'tag' ? `tag:${option.tag.en}` : option.kind === 'recent' ? `recent:${option.query}` : 'clear'}
            {...box.getOptionProps(index)}
            className={cn(ROW, box.optionClassName(index))}
          >
            <OptionRow option={option} safeMode={safeMode} />
          </div>
        ))}
      </Popover>
    </form>
  );
}

function OptionRow({ option, safeMode }: { option: FieldOption; safeMode: boolean }) {
  if (option.kind === 'recent') {
    return (
      <>
        <span className="grid size-6 shrink-0 place-items-center text-on-surface-variant" aria-hidden="true">
          <MdHistory size={ICON.standard} />
        </span>
        <span className="min-w-0 flex-1 truncate text-body-l text-on-surface">{option.query}</span>
      </>
    );
  }
  if (option.kind === 'clear-recent') {
    return (
      <>
        <span className="grid size-6 shrink-0 place-items-center text-on-surface-variant" aria-hidden="true">
          <MdDeleteSweep size={ICON.standard} />
        </span>
        <span className="min-w-0 flex-1 truncate text-body-l text-on-surface-variant">清空搜索历史</span>
      </>
    );
  }
  const { tag } = option;
  const category = tagCategory(tag.category);
  const restricted = safeMode && tag.restricted;
  return (
    <>
      {/* The category's ink tone at 10px: a container-weight dot is invisible on the view. */}
      <span className="grid size-6 shrink-0 place-items-center" aria-hidden="true">
        <span className={cn('size-2.5 rounded-full', tagCategoryDot(tag.category))} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-body-l text-on-surface">{tag.cn || tag.en}</span>
        <span className="block truncate text-body-s text-on-surface-variant">
          {tag.cn ? `${tag.en} · ${category.label}` : category.label}
        </span>
      </span>
      {restricted && (
        <span className="shrink-0 text-warning" role="img" aria-label="安全模式下不显示此标签的图片">
          <MdWarningAmber size={ICON.dense} aria-hidden="true" />
        </span>
      )}
      <span className="shrink-0 text-label-m tabular-nums text-on-surface-variant">
        <span className="sr-only">约 </span>
        {formatCount(tag.count)}
        <span className="sr-only"> 张</span>
      </span>
    </>
  );
}
