'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { MdExpandMore, MdPsychology } from 'react-icons/md';
import Collapse from '@/components/Collapse';
import LoadingIndicator from '@/components/LoadingIndicator';
import ScrollArea from '@/components/ScrollArea';
import { ICON } from '@/lib/icons';
import { cn } from '@/lib/utils';

export interface ThinkingBlockProps {
  text: string;
  /** True while the model is actively streaming reasoning tokens into this block. */
  isActive?: boolean;
  /** Pause the live morph indicator while the enclosing panel is closed or exiting. */
  paused?: boolean;
  className?: string;
}

/**
 * Collapsible reasoning trace for 彩彩 AI.
 *
 * Active thinking streams open inside a bounded scroller that follows the newest line until
 * the visitor scrolls up. Once reply text or a tool call follows (`isActive` drops to false),
 * the header settles to `思考过程` and collapses smoothly unless the visitor manually toggled it.
 * Persisted history messages start collapsed so threads stay scannable.
 */
export default function ThinkingBlock({ text, isActive = false, paused = false, className = '' }: ThinkingBlockProps) {
  const contentId = useId();
  const [userOpen, setUserOpen] = useState<boolean | null>(null);
  const open = userOpen ?? isActive;
  const scrollerRef = useRef<HTMLDivElement>(null);
  const nearBottomRef = useRef(true);

  const displayText = isActive ? text.replace(/^\n+/, '') : text.trim();

  useEffect(() => {
    if (!isActive || !open || !nearBottomRef.current) return;
    const node = scrollerRef.current;
    if (node) node.scrollTop = node.scrollHeight;
  }, [displayText, isActive, open]);

  if (!isActive && !displayText) return null;

  return (
    <div
      className={cn(
        'w-full min-w-0 rounded-md border border-outline-variant bg-surface-container forced-boundary',
        className,
      )}
    >
      <button
        type="button"
        aria-expanded={open}
        aria-controls={displayText ? contentId : undefined}
        data-ripple=""
        onClick={() => setUserOpen(!open)}
        className={cn(
          'state-layer touch-target-block flex min-h-10 w-full cursor-pointer select-none touch-manipulation items-center gap-2 px-3 py-2 text-left',
          'transition-[color,background-color] spring-fast-effects focus-visible:outline-hidden focus-visible:ring-2 focus-ring',
          open && displayText ? 'rounded-t-md' : 'rounded-md',
        )}
      >
        {isActive ? (
          <LoadingIndicator
            size="xs"
            variant="default"
            tone="primary"
            decorative
            paused={paused}
            className="size-4.5"
          />
        ) : (
          <MdPsychology size={ICON.dense} aria-hidden="true" className="shrink-0 text-on-surface-variant" />
        )}
        <span
          className={cn('text-label-m min-w-0 flex-1 truncate', isActive ? 'text-shimmer' : 'text-on-surface-variant')}
        >
          {isActive ? '正在思考…' : '思考过程'}
        </span>
        <MdExpandMore
          size={ICON.control}
          aria-hidden="true"
          className={cn(
            'shrink-0 text-on-surface-variant transition-[rotate] spring-fast-spatial',
            open && 'rotate-180',
          )}
        />
      </button>

      {displayText ? (
        <Collapse id={contentId} open={open}>
          <div className="border-t border-outline-variant">
            <ScrollArea
              axis="y"
              viewportRef={scrollerRef}
              viewportClassName="popover-scrollbar max-h-48 overflow-y-auto overscroll-y-contain px-3 py-2.5"
              viewportProps={{
                onScroll: (event) => {
                  const node = event.currentTarget;
                  nearBottomRef.current = node.scrollHeight - node.scrollTop - node.clientHeight < 24;
                },
              }}
            >
              <div className="text-body-s whitespace-pre-wrap wrap-anywhere text-on-surface-variant">{displayText}</div>
            </ScrollArea>
          </div>
        </Collapse>
      ) : null}
    </div>
  );
}
