'use client';

import { useId, type ReactNode } from 'react';
import Chip from '@/components/Chip';
import EmptyState from '@/components/EmptyState';
import SectionHeading from '@/components/SectionHeading';
import { cn } from '@/lib/utils';

interface TagWellProps {
  title: string;
  /** A glyph before the title, at the dense size. */
  icon?: ReactNode;
  tags: readonly string[];
  /** The list's cap, shown as `n / max`; without one the heading shows the count alone. */
  max?: number;
  onRemove: (tag: string) => void;
  /** The sentence for an empty list. */
  empty: string;
  /** The list's own complaint (nothing in it yet, over its cap) — under the well, as a field's. */
  error?: ReactNode;
  disabled?: boolean;
  /** The heading's level: 3 inside a dialog (under its title), 2 directly under a page's `<h1>`. */
  level?: 2 | 3;
  className?: string;
}

/**
 * One list of tags being built, in a group editor: a heading with its count against the cap,
 * the tags as input chips (each with its own 移除 cross), and — the way a field says it — the
 * list's complaint under it.
 *
 * The heading is a group caption (`SectionHeading level="group"`, G4-031) — it names a run of
 * chips inside a dialog's form, not a section of the page — and its count is the caption's `aside`,
 * in the error ink once the list is over its cap.
 *
 * The well **grows with its tags** and the dialog's body scrolls (R5-041): a 120px well that
 * scrolled inside a scrolling dialog put two scrollers under one finger. One container step above
 * the dialog's own tone, without a keyline: this app separates by tone.
 */
export default function TagWell({
  title,
  icon,
  tags,
  max,
  onRemove,
  empty,
  error,
  disabled = false,
  level = 3,
  className = '',
}: TagWellProps) {
  const headingId = useId();
  const errorId = useId();
  const over = max !== undefined && tags.length > max;
  return (
    <section aria-labelledby={headingId} className={className}>
      <SectionHeading
        as={level === 2 ? 'h2' : 'h3'}
        level="group"
        id={headingId}
        icon={icon}
        aside={
          <span className={cn('tabular-nums', over && 'text-error')}>
            {max !== undefined ? `${tags.length} / ${max}` : `${tags.length} 个`}
          </span>
        }
      >
        {title}
      </SectionHeading>
      <div
        role={tags.length > 0 ? 'list' : undefined}
        aria-describedby={error ? errorId : undefined}
        className="flex min-h-14 flex-wrap content-start items-center gap-2 rounded-md bg-surface-container-highest p-3 forced-boundary"
      >
        {tags.length === 0 ? (
          <EmptyState size="inline" title={empty} />
        ) : (
          tags.map((tag) => (
            <span role="listitem" key={tag} className="max-w-full">
              <Chip variant="input" onRemove={() => onRemove(tag)} disabled={disabled} title={tag}>
                {tag}
              </Chip>
            </span>
          ))
        )}
      </div>
      {error && (
        <p id={errorId} role="alert" className="mt-1.5 px-4 text-body-s text-error">
          {error}
        </p>
      )}
    </section>
  );
}
