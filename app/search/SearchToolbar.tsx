'use client';

import { useId, useRef, useState } from 'react';
import { MdArrowDownward, MdExpandMore } from 'react-icons/md';
import Button from '@/components/Button';
import Card from '@/components/Card';
import Chip from '@/components/Chip';
import { Input } from '@/components/Input';
import Select from '@/components/Select';
import {
  NO_SEARCH_FILTERS,
  countSearchFilters,
  type AspectFilter,
  type FilterComparison,
  type MediaFilter,
  type SearchFilters,
  type SinceFilter,
} from '@/lib/searchQuery';
import { useScrollFade } from '@/lib/useScrollFade';

/**
 * Every option is a real Philomena sort field (热度 was not, and returned the newest pictures).
 * 相关性 is `_score`, offered only while the query gives something to rank by — for a plain tag
 * query every match scores the same (C9).
 */
const SORT_OPTIONS = [
  { value: 'created_at', label: '上传时间' },
  { value: 'updated_at', label: '更新时间' },
  { value: 'score', label: '评分高低' },
  { value: '_score', label: '相关性' },
  { value: 'wilson_score', label: 'Wilson 评分' },
  { value: 'width', label: '像素宽' },
  { value: 'height', label: '像素高' },
  { value: 'size', label: '文件大小' },
  { value: 'random', label: '随机' },
];

const COMPARISON_OPTIONS: { value: FilterComparison; label: string }[] = [
  { value: 'gte', label: '≥' },
  { value: 'lt', label: '<' },
];

export const ASPECT_LABELS: Record<AspectFilter, { option: string; chip: string }> = {
  portrait: { option: '竖图（宽 < 高）', chip: '竖图' },
  square: { option: '正方形（宽 = 高）', chip: '正方形' },
  landscape: { option: '横图（宽 > 高）', chip: '横图' },
  ultrawide: { option: '超宽屏壁纸', chip: '超宽屏壁纸' },
};
export const MEDIA_LABELS: Record<MediaFilter, { option: string; chip: string }> = {
  animated: { option: '动态内容 (GIF/视频)', chip: '动态内容' },
  still: { option: '静态图片 (PNG/JPG)', chip: '静态图片' },
  video: { option: '仅限视频', chip: '仅限视频' },
};
export const SINCE_LABELS: Record<SinceFilter, string> = {
  day: '过去 24 小时',
  week: '过去 1 周',
  month: '过去 1 个月',
  year: '过去 1 年',
};

/** One active condition as the words a chip says. */
export function filterChipLabels(filters: SearchFilters): { key: keyof SearchFilters; label: string }[] {
  const out: { key: keyof SearchFilters; label: string }[] = [];
  const sign = (op: FilterComparison) => (op === 'gte' ? '≥' : '<');
  if (filters.upvotes) out.push({ key: 'upvotes', label: `点赞数 ${sign(filters.upvotes.op)} ${filters.upvotes.value}` });
  if (filters.score) out.push({ key: 'score', label: `净得分 ${sign(filters.score.op)} ${filters.score.value}` });
  if (filters.aspect) out.push({ key: 'aspect', label: ASPECT_LABELS[filters.aspect].chip });
  if (filters.media) out.push({ key: 'media', label: MEDIA_LABELS[filters.media].chip });
  if (filters.since) out.push({ key: 'since', label: SINCE_LABELS[filters.since] });
  return out;
}

/** The panel's editable form of a condition set: numbers as typed text, choices as keys. */
interface Draft {
  upvotesOp: FilterComparison;
  upvotes: string;
  scoreOp: FilterComparison;
  score: string;
  aspect: AspectFilter | '';
  media: MediaFilter | '';
  since: SinceFilter | '';
}

function draftOf(filters: SearchFilters): Draft {
  return {
    upvotesOp: filters.upvotes?.op ?? 'gte',
    upvotes: filters.upvotes ? String(filters.upvotes.value) : '',
    scoreOp: filters.score?.op ?? 'gte',
    score: filters.score ? String(filters.score.value) : '',
    aspect: filters.aspect ?? '',
    media: filters.media ?? '',
    since: filters.since ?? '',
  };
}

function filtersOf(draft: Draft): SearchFilters {
  const count = (text: string, op: FilterComparison) =>
    /^-?\d{1,9}$/.test(text) ? { op, value: Number(text) } : null;
  return {
    upvotes: count(draft.upvotes, draft.upvotesOp),
    score: count(draft.score, draft.scoreOp),
    aspect: draft.aspect || null,
    media: draft.media || null,
    since: draft.since || null,
  };
}

const filtersKey = (filters: SearchFilters) => JSON.stringify(filters);

interface SearchToolbarProps {
  sortBy: string;
  sortDir: 'asc' | 'desc';
  defaultSort: string;
  /** Whether 相关性 can mean anything for this query. */
  canRank: boolean;
  onSort: (sort: string) => void;
  onDirection: (direction: 'asc' | 'desc') => void;
  onResetSort: () => void;
  /** The conditions the committed query holds. */
  filters: SearchFilters;
  /**
   * New conditions: from the panel (applied to what is in the field) or from a chip / 清除筛选
   * (applied to the search on screen).
   */
  onApplyFilters: (filters: SearchFilters, from: 'panel' | 'chip') => void;
}

/**
 * Sort, direction and the advanced conditions — **between the field and the results**, where
 * every search app keeps them: under fifty pictures and the pager they were found only by
 * scrolling past everything they reorder. They stay whatever the search came back with, empty
 * and failed included, since the condition that emptied a list is the one to loosen.
 *
 * The conditions are the query's (`parseSearchFilters`): the panel opens on what the query
 * holds, 应用并搜索 writes them back in place, and each active one is also a chip that removes it.
 */
export default function SearchToolbar({
  sortBy,
  sortDir,
  defaultSort,
  canRank,
  onSort,
  onDirection,
  onResetSort,
  filters,
  onApplyFilters,
}: SearchToolbarProps) {
  const advancedId = useId();
  const [showAdvanced, setShowAdvanced] = useState(false);
  /* The draft follows the committed query — during render, so the panel never shows a frame of
     the previous search's conditions. Edits stay local until 应用并搜索. */
  const committedKey = filtersKey(filters);
  const [draftFor, setDraftFor] = useState(committedKey);
  const [draft, setDraft] = useState<Draft>(() => draftOf(filters));
  if (draftFor !== committedKey) {
    setDraftFor(committedKey);
    setDraft(draftOf(filters));
  }
  const edit = (patch: Partial<Draft>) => setDraft((current) => ({ ...current, ...patch }));

  const chips = filterChipLabels(filters);
  const chipRowRef = useRef<HTMLDivElement>(null);
  useScrollFade(chipRowRef);
  const pending = filtersOf(draft);
  const draftChanged = filtersKey(pending) !== committedKey;
  const draftEmpty = countSearchFilters(pending) === 0;

  const sortOptions = canRank ? SORT_OPTIONS : SORT_OPTIONS.filter((option) => option.value !== '_score');

  return (
    <div className="@container">
      <div className="flex flex-wrap items-center justify-center gap-2">
        <div className="flex min-w-0 max-w-full items-center gap-2">
          <Select
            value={sortBy}
            onChange={onSort}
            size="sm"
            shape="pill"
            aria-label="排序方式"
            options={sortOptions}
          />
          {sortBy !== 'random' && (
            <Button
              variant="surface"
              onClick={() => onDirection(sortDir === 'desc' ? 'asc' : 'desc')}
              aria-label={sortDir === 'desc' ? '当前降序，切换为升序' : '当前升序，切换为降序'}
              icon={
                <MdArrowDownward
                  className={`transition-transform spring-fast-spatial ${sortDir === 'asc' ? 'rotate-180' : ''}`}
                />
              }
            >
              {sortDir === 'desc' ? '降序' : '升序'}
            </Button>
          )}
        </div>
        <div className="flex max-w-full flex-wrap items-center justify-center gap-2">
          {/* This discloses a panel; it does not select a filter value. */}
          <Button
            variant="surface"
            onClick={() => setShowAdvanced((open) => !open)}
            aria-expanded={showAdvanced}
            aria-controls={advancedId}
            trailingIcon={
              <MdExpandMore
                className={`transition-transform ${showAdvanced ? 'spring-default-spatial rotate-180' : 'spring-fast-effects rotate-0'}`}
              />
            }
          >
            高级筛选
          </Button>
          {(sortBy !== defaultSort || sortDir !== 'desc') && (
            <Button variant="surface" onClick={onResetSort}>
              重置排序
            </Button>
          )}
        </div>
      </div>

      {chips.length > 0 && (
        /* One line, scrolling when it overflows: it sits above the results, and a row that
           wrapped would move them. */
        <div
          ref={chipRowRef}
          role="list"
          aria-label="已应用的筛选条件"
          className="scrollbar-hide scroll-fade-x mt-3 flex items-center gap-2 overflow-x-auto"
        >
          {chips.map((chip) => (
            <span role="listitem" key={chip.key} className="shrink-0">
              <Chip
                variant="input"
                onRemove={() => onApplyFilters({ ...filters, [chip.key]: null }, 'chip')}
                removeLabel={`移除条件：${chip.label}`}
              >
                {chip.label}
              </Chip>
            </span>
          ))}
        </div>
      )}

      {/* The form expands from the toolbar's own surface. */}
      <div
        id={advancedId}
        role="region"
        aria-label="高级筛选条件"
        inert={!showAdvanced}
        /* The drawer's springs, per direction — `DefaultSpatial` opening, `FastEffects`
           closing, per `NavigationDrawer.kt`. `grid-template-rows` stays as the mechanism: the
           inner track carries the whole subtree with its overflow clipped, so the contents
           are clipped rather than left behind by a resizing box. */
        className={`grid transition-[grid-template-rows,opacity] ${
          showAdvanced
            ? 'spring-default-spatial grid-rows-[1fr] opacity-100'
            : 'spring-fast-effects grid-rows-[0fr] opacity-0'
        }`}
      >
        <div className="min-h-0 overflow-hidden">
          <Card variant="elevated" className="mt-4">
            <form
              onSubmit={(event) => {
                event.preventDefault();
                onApplyFilters(pending, 'panel');
              }}
            >
              <div className="grid grid-cols-1 gap-4 @md:grid-cols-2">
                <CountCondition
                  label="点赞数"
                  op={draft.upvotesOp}
                  value={draft.upvotes}
                  allowNegative={false}
                  placeholder="例如 100"
                  onOp={(upvotesOp) => edit({ upvotesOp })}
                  onValue={(upvotes) => edit({ upvotes })}
                />
                <CountCondition
                  label="净得分"
                  op={draft.scoreOp}
                  value={draft.score}
                  allowNegative
                  placeholder="例如 50"
                  onOp={(scoreOp) => edit({ scoreOp })}
                  onValue={(score) => edit({ score })}
                />
              </div>
              <div className="mt-4 grid grid-cols-1 gap-4 @xl:grid-cols-3">
                <ChoiceCondition
                  label="宽高比"
                  value={draft.aspect}
                  onChange={(aspect) => edit({ aspect: aspect as Draft['aspect'] })}
                  options={[
                    { value: '', label: '不限比例' },
                    ...(Object.keys(ASPECT_LABELS) as AspectFilter[]).map((value) => ({ value, label: ASPECT_LABELS[value].option })),
                  ]}
                />
                <ChoiceCondition
                  label="媒体类型"
                  value={draft.media}
                  onChange={(media) => edit({ media: media as Draft['media'] })}
                  options={[
                    { value: '', label: '所有类型' },
                    ...(Object.keys(MEDIA_LABELS) as MediaFilter[]).map((value) => ({ value, label: MEDIA_LABELS[value].option })),
                  ]}
                />
                <ChoiceCondition
                  label="上传时间"
                  value={draft.since}
                  onChange={(since) => edit({ since: since as Draft['since'] })}
                  options={[
                    { value: '', label: '不限时间' },
                    ...(Object.keys(SINCE_LABELS) as SinceFilter[]).map((value) => ({ value, label: SINCE_LABELS[value] })),
                  ]}
                />
              </div>
              <div className="mt-6 flex flex-wrap items-center justify-between gap-3">
                <span className="text-body-s text-on-surface-variant">组合条件，进一步缩小搜索范围。</span>
                <div className="ml-auto flex flex-wrap gap-2">
                  <Button
                    type="button"
                    variant="surface"
                    disabled={draftEmpty && countSearchFilters(filters) === 0}
                    onClick={() => {
                      setDraft(draftOf(NO_SEARCH_FILTERS));
                      if (countSearchFilters(filters) > 0) onApplyFilters(NO_SEARCH_FILTERS, 'chip');
                    }}
                  >
                    清除筛选
                  </Button>
                  <Button type="submit" variant="filled" disabled={!draftChanged}>
                    应用并搜索
                  </Button>
                </div>
              </div>
            </form>
          </Card>
        </div>
      </div>
    </div>
  );
}

function ConditionCaption({ id, children }: { id: string; children: string }) {
  return (
    <p id={id} className="mb-1 block text-body-s text-on-surface-variant">
      {children}
    </p>
  );
}

function CountCondition({
  label,
  op,
  value,
  allowNegative,
  placeholder,
  onOp,
  onValue,
}: {
  label: string;
  op: FilterComparison;
  value: string;
  allowNegative: boolean;
  placeholder: string;
  onOp: (op: FilterComparison) => void;
  onValue: (value: string) => void;
}) {
  const captionId = useId();
  return (
    <div role="group" aria-labelledby={captionId}>
      <ConditionCaption id={captionId}>{label}</ConditionCaption>
      <div className="flex gap-2">
        <Select
          value={op}
          onChange={(next) => onOp(next as FilterComparison)}
          size="sm"
          aria-label={`${label}比较符`}
          options={COMPARISON_OPTIONS}
        />
        {/* Text with a numeric keyboard rather than `type="number"`: the value is cleaned as it
            is typed, so what the field shows is always what 应用 will send. */}
        <Input
          type="text"
          inputMode="numeric"
          aria-label={label}
          size="sm"
          value={value}
          onChange={(event) => {
            const digits = event.target.value.replace(allowNegative ? /[^\d-]/g : /\D/g, '');
            onValue(allowNegative ? digits.replace(/(?!^)-/g, '') : digits);
          }}
          placeholder={placeholder}
          autoComplete="off"
          fieldClassName="flex-1"
        />
      </div>
    </div>
  );
}

function ChoiceCondition({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: { value: string; label: string }[];
}) {
  const captionId = useId();
  return (
    <div>
      <ConditionCaption id={captionId}>{label}</ConditionCaption>
      <Select value={value} onChange={onChange} size="sm" className="w-full" aria-label={label} options={options} />
    </div>
  );
}
