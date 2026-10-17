'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { MdAutoAwesome, MdInfoOutline, MdWarningAmber } from 'react-icons/md';
import Button from '@/components/Button';
import Chip from '@/components/Chip';
import SwapContent from '@/components/SwapContent';
import { ICON } from '@/lib/icons';
import { useScrollFade } from '@/lib/useScrollFade';

export type SemanticLineState =
  | { kind: 'pending'; text: string; estimateMs: number }
  /** `tags` is every tag known for the words (the parse's and any the URL pinned); `included` is what runs. */
  | { kind: 'converted'; text: string; tags: string[]; included: string[] }
  | { kind: 'literal'; text: string }
  | { kind: 'failed'; text: string; timedOut: boolean; retryable: boolean }
  | { kind: 'untagged'; text: string }
  | { kind: 'disabled'; text: string };

interface SemanticLineProps {
  state: SemanticLineState;
  onSearchOriginal: () => void;
  onUseTags: () => void;
  onToggleTag: (tag: string) => void;
  onRetry: () => void;
}

/**
 * How Chinese or natural-language words were read — one 40dp row under the field, in **every**
 * state: waiting for the parse, the tags it produced, the words searched as typed, or why they
 * were. One height for all of them, so the row changing its mind never moves the results under
 * it; and the tags are one scrolling line of chips for the same reason.
 *
 * What the old front end said in a transient toast (已转换为标签：…) stays on screen here, as
 * chips: each can be left out of the search, and 搜索原文 runs the words as typed instead.
 */
export default function SemanticLine({ state, onSearchOriginal, onUseTags, onToggleTag, onRetry }: SemanticLineProps) {
  let body: ReactNode;
  let action: ReactNode = null;
  let announcement = '';

  switch (state.kind) {
    case 'pending':
      /* Keyed on the estimate too: a re-parse that lands a different seconds figure restarts the
         wait rather than inheriting 比预计的久. */
      body = (
        <PendingParse key={`${state.text}:${state.estimateMs}`} text={state.text} estimateMs={state.estimateMs} />
      );
      action = (
        <Button variant="text" className="shrink-0" onClick={onSearchOriginal}>
          直接搜索原文
        </Button>
      );
      announcement = '正在理解搜索内容';
      break;
    case 'converted':
      body = (
        <ConvertedTags tags={state.tags} included={state.included} onToggle={onToggleTag} />
      );
      action = (
        <Button variant="text" className="shrink-0" onClick={onSearchOriginal}>
          搜索原文
        </Button>
      );
      announcement = `已转换为标签：${state.included.join('、')}`;
      break;
    case 'literal':
      body = <Note icon={<MdInfoOutline size={ICON.control} />}>已按原文搜索</Note>;
      action = (
        <Button variant="text" className="shrink-0" onClick={onUseTags}>
          转换为标签搜索
        </Button>
      );
      announcement = '已按原文搜索';
      break;
    case 'failed':
      announcement = state.timedOut ? '智能解析超时，已按原内容搜索' : '智能解析暂时不可用，已按原内容搜索';
      body = <Note icon={<MdWarningAmber size={ICON.control} className="text-warning" />}>{announcement}</Note>;
      if (state.retryable) {
        action = (
          <Button variant="text" className="shrink-0" onClick={onRetry}>
            重试
          </Button>
        );
      }
      break;
    case 'untagged':
      announcement = '未能识别出标签，已按原内容搜索';
      body = <Note icon={<MdInfoOutline size={ICON.control} />}>{announcement}</Note>;
      break;
    case 'disabled':
      announcement = '智能解析未开启，已按原内容搜索';
      body = <Note icon={<MdInfoOutline size={ICON.control} />}>{announcement}</Note>;
      break;
  }

  return (
    <div className="flex h-10 min-w-0 items-center gap-2">
      {/* Keyed on what the row is *saying* rather than on every field of it: a chip left out of
          the search is the same sentence with one word changed, and re-entering the row for it
          would be a swap nobody asked for. */}
      <SwapContent contentKey={`${state.kind}:${state.text}`} className="min-w-0 flex-1">
        {body}
      </SwapContent>
      {action}
      {/* The row's news, once per change, without the chips: a live region full of
          buttons would read every one of them out. */}
      <span className="sr-only" role="status">
        {announcement}
      </span>
    </div>
  );
}

function Note({ icon, children }: { icon: ReactNode; children: ReactNode }) {
  return (
    <p className="flex min-w-0 flex-1 items-center gap-2 text-body-m text-on-surface-variant">
      <span className="grid shrink-0 place-items-center" aria-hidden="true">
        {icon}
      </span>
      <span className="min-w-0 truncate">{children}</span>
    </p>
  );
}

/**
 * The wait, told by the sentence itself: **no bar under it**, and the estimate only ever quoted in
 * words (「预计 8 秒…」, then 比预计的久 once it is past).
 *
 * A determinate bar was honest about the backend's *average* and dishonest about this run — the
 * estimate has a spread, so the bar either sat full while the parse was still going or had to
 * flip to indeterminate, which is the state `ProgressBar`'s own note forbids. It was also the only
 * reason this state needed a second line inside the 40dp row every state shares. The sweep over
 * the words carries "still running" instead (`text-shimmer`, globals.css), so nothing the row
 * promises the reader rests on a figure that cannot be kept.
 */
function PendingParse({ text, estimateMs }: { text: string; estimateMs: number }) {
  /* One timer, not a ticker: with no progress to interpolate, the only thing left to notice is the
     moment the estimate runs out. Nothing is written back here — the call site's `key` covers both
     a new parse and an estimate that changed under one, and a remount is what resets the flag
     (`set-state-in-effect` would refuse the alternative). */
  const [late, setLate] = useState(false);
  useEffect(() => {
    const timer = window.setTimeout(() => setLate(true), estimateMs);
    return () => window.clearTimeout(timer);
  }, [estimateMs]);
  const seconds = Math.max(1, Math.round(estimateMs / 1000));
  return (
    <p className="flex min-w-0 flex-1 items-center gap-2 text-body-m text-on-surface-variant">
      <MdAutoAwesome size={ICON.control} className="shrink-0 text-primary-ink" aria-hidden="true" />
      <span className="text-shimmer min-w-0 truncate">
        {late ? `比预计的久一些，仍在理解「${text}」…` : `正在理解「${text}」，预计 ${seconds} 秒…`}
      </span>
    </p>
  );
}

function ConvertedTags({
  tags,
  included,
  onToggle,
}: {
  tags: string[];
  included: string[];
  onToggle: (tag: string) => void;
}) {
  const rowRef = useRef<HTMLDivElement>(null);
  useScrollFade(rowRef);
  const kept = new Set(included.map((tag) => tag.toLowerCase()));
  return (
    <div className="flex min-w-0 flex-1 items-center gap-2">
      <span className="flex shrink-0 items-center gap-1.5 text-body-m text-on-surface-variant">
        <MdAutoAwesome size={ICON.control} className="text-primary-ink" aria-hidden="true" />
        已转换为
      </span>
      <div
        ref={rowRef}
        role="group"
        aria-label="转换得到的标签"
        className="scrollbar-hide scroll-fade-x flex min-w-0 flex-1 items-center gap-2 overflow-x-auto"
      >
        {tags.map((tag) => (
          <Chip
            key={tag}
            variant="filter"
            selected={kept.has(tag.toLowerCase())}
            onClick={() => onToggle(tag)}
            className="shrink-0"
          >
            {tag}
          </Chip>
        ))}
      </div>
    </div>
  );
}
