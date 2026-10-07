'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { MdAutoAwesome, MdInfoOutline, MdWarningAmber } from 'react-icons/md';
import Button from '@/components/Button';
import Chip from '@/components/Chip';
import ProgressBar from '@/components/ProgressBar';
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

/** A progress update this often reads as continuous at the spring's 235ms settle. */
const TICK_MS = 100;

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
      body = <PendingParse key={state.text} text={state.text} estimateMs={state.estimateMs} />;
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
      {body}
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
 * The wait, measured against the backend's own recent average: a determinate bar that fills
 * over the expected time, then an indeterminate one with 比预计的久 — never a bar that sits at
 * 100% claiming to be done, and never a spinner that says nothing about how long.
 */
function PendingParse({ text, estimateMs }: { text: string; estimateMs: number }) {
  const [elapsed, setElapsed] = useState(0);
  const startedAt = useRef<number | null>(null);
  useEffect(() => {
    startedAt.current = performance.now();
    const timer = window.setInterval(() => {
      const now = performance.now() - (startedAt.current ?? performance.now());
      setElapsed(now);
      if (now >= estimateMs) window.clearInterval(timer);
    }, TICK_MS);
    return () => window.clearInterval(timer);
  }, [estimateMs]);
  const late = elapsed >= estimateMs;
  const seconds = Math.max(1, Math.round(estimateMs / 1000));
  return (
    <div className="min-w-0 flex-1">
      <p className="flex min-w-0 items-center gap-2 text-body-m text-on-surface-variant">
        <MdAutoAwesome size={ICON.control} className="shrink-0 text-primary-ink" aria-hidden="true" />
        <span className="min-w-0 truncate">
          {late ? `比预计的久一些，仍在理解「${text}」…` : `正在理解「${text}」，预计 ${seconds} 秒…`}
        </span>
      </p>
      <ProgressBar
        className="mt-1.5"
        label="智能解析进度"
        value={late ? undefined : Math.min(100, (elapsed / estimateMs) * 100)}
      />
    </div>
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
