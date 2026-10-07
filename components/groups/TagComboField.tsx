'use client';

import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type ReactNode,
} from 'react';
import { MdAdd, MdSearch } from 'react-icons/md';
import IconButton from '@/components/IconButton';
import { Input } from '@/components/Input';
import Popover, { estimateMenuHeight } from '@/components/Popover';
import type { TagSuggestion } from '@/lib/api/semantic';
import { formatCount } from '@/lib/format';
import { ICON } from '@/lib/icons';
import { SKIP, useResource } from '@/lib/resource';
import { tagSuggestions } from '@/lib/resources';
import { tagCategory, tagCategoryDot } from '@/lib/tagCategories';
import { lookupTerm, splitTags } from '@/lib/tagInput';
import { useCombobox } from '@/lib/useCombobox';
import { cn } from '@/lib/utils';

/** Long enough that a word typed at speed asks once, short enough to feel immediate. */
const LOOKUP_DEBOUNCE_MS = 300;

/** The ordinary autocomplete row: 40dp under a pointer, 48 under a finger, an 8dp corner. */
const ROW =
  'flex min-h-10 pointer-coarse:min-h-12 w-full cursor-pointer items-center gap-3 rounded-sm px-3 py-1.5 text-left select-none';

const HAN = /[㐀-鿿]/;

export interface TagComboFieldHandle {
  focus: () => void;
}

interface TagComboFieldProps {
  label: string;
  placeholder?: string;
  /** Tags already in the list being built; the suggestions leave them out. */
  chosen: ReadonlySet<string>;
  /** One or more tags to add — a pick, or the typed text (a comma separates tags). */
  onAdd: (tags: string[]) => void;
  disabled?: boolean;
  /** The list's own complaint (full, a duplicate), shown under the field. */
  error?: ReactNode;
  helper?: ReactNode;
}

/**
 * The one field for adding tags to a list — a block group's, a tag group's, an upload's.
 *
 * **It is `useCombobox`** (R5-036): no suggestion is active until the arrows move into the list,
 * so Enter adds what was typed — free text works, the way it must when the dictionary is slow or
 * does not know the tag — and Enter on an arrowed-to row adds that row. A press on a row does not
 * take focus from the field, so the next tag can be typed at once (R5-038); Tab moves on, Escape
 * closes the list and leaves the dialog open. An IME's composition never triggers a lookup.
 *
 * **The suggestions are the site's dictionary** (`tagSuggestions`, the search screen's source):
 * Chinese names find their English tags, which is how the original front end's editors worked.
 * Typed Chinese with no row chosen is not a tag, so Enter then asks for a pick instead of adding
 * a name nothing is tagged with.
 */
const TagComboField = forwardRef<TagComboFieldHandle, TagComboFieldProps>(function TagComboField(
  { label, placeholder = '输入标签，回车添加', chosen, onAdd, disabled = false, error, helper },
  ref,
) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [text, setText] = useState('');
  const [keyword, setKeyword] = useState('');
  const [listOpen, setListOpen] = useState(false);
  const [hint, setHint] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);

  useImperativeHandle(ref, () => ({ focus: () => inputRef.current?.focus() }), []);

  const read = useResource(tagSuggestions, keyword ? { keyword } : SKIP, { keepPrevious: 'group-tag-field' });
  const options = useMemo<TagSuggestion[]>(
    () => (keyword ? (read.data ?? []) : []).filter((tag) => !chosen.has(tag.en.toLowerCase())).slice(0, 10),
    [keyword, read.data, chosen],
  );

  const lookUp = (value: string) => {
    clearTimeout(timer.current);
    const term = lookupTerm(value);
    if (!term) {
      setKeyword('');
      return;
    }
    setListOpen(true);
    timer.current = setTimeout(() => setKeyword(term), LOOKUP_DEBOUNCE_MS);
  };

  const reset = () => {
    clearTimeout(timer.current);
    setText('');
    setKeyword('');
    setListOpen(false);
  };

  const addTyped = () => {
    const tags = splitTags(text);
    if (tags.length === 0) return;
    if (tags.some((tag) => HAN.test(tag))) {
      setHint('中文名称请从建议中选择对应的标签');
      setListOpen(true);
      return;
    }
    onAdd(tags);
    reset();
  };

  const box = useCombobox({
    options,
    open: listOpen,
    onOpenChange: setListOpen,
    onSelect: (tag) => {
      /* Typed tags before the one being looked up go in with the pick: 「pony, flutt」 then a
         pick of fluttershy adds both. */
      const earlier = splitTags(text).slice(0, -1).filter((typed) => !HAN.test(typed));
      onAdd([...earlier, tag.en.toLowerCase()]);
      reset();
      setHint(null);
    },
    onEnterWithoutActive: addTyped,
    onCompositionEnd: (committed) => lookUp(committed),
    resetKey: keyword,
  });

  const handleChange = (event: ChangeEvent<HTMLInputElement>) => {
    setText(event.target.value);
    setHint(null);
    if (box.isComposing()) return;
    lookUp(event.target.value);
  };

  return (
    <div>
      <div ref={wrapRef}>
        <Input
          ref={inputRef}
          type="text"
          label={label}
          icon={<MdSearch size={ICON.standard} />}
          value={text}
          onChange={handleChange}
          placeholder={placeholder}
          disabled={disabled}
          error={hint ?? error}
          helper={helper}
          /* A tag is a name, not prose: no capitalising, no correction, no form history laid
             over the dictionary's own list. */
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="none"
          spellCheck={false}
          enterKeyHint="done"
          {...box.inputProps}
          onBlur={() => setListOpen(false)}
          trailing={
            /* Enter's twin, for a keyboard without one in reach and for anyone who does not
               think to press it. It adds what was typed; a suggestion is added by its row. */
            <IconButton
              aria-label="添加标签"
              icon={<MdAdd />}
              disabled={disabled || splitTags(text).length === 0}
              /* The field keeps the caret, and a phone its keyboard. */
              onPointerDown={(event) => event.preventDefault()}
              onClick={addTyped}
            />
          }
        />
      </div>
      <Popover
        open={box.isOpen && !disabled}
        onClose={() => setListOpen(false)}
        anchorRef={wrapRef}
        maxHeight={288}
        estimatedHeight={estimateMenuHeight(options.length, 48)}
        className="p-2"
        {...box.listboxProps}
        aria-label="标签建议"
      >
        {options.map((tag, index) => (
          <div key={tag.en} {...box.getOptionProps(index)} className={cn(ROW, box.optionClassName(index))}>
            <span className="grid size-6 shrink-0 place-items-center" aria-hidden="true">
              <span className={cn('size-2.5 rounded-full', tagCategoryDot(tag.category))} />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-label-l text-on-surface">{tag.cn || tag.en}</span>
              <span className="block truncate text-body-s text-on-surface-variant">
                {tag.cn ? `${tag.en} · ${tagCategory(tag.category).label}` : tagCategory(tag.category).label}
              </span>
            </span>
            <span className="shrink-0 text-label-m tabular-nums text-on-surface-variant">
              <span className="sr-only">约 </span>
              {formatCount(tag.count)}
              <span className="sr-only"> 张</span>
            </span>
          </div>
        ))}
      </Popover>
    </div>
  );
});

export default TagComboField;
