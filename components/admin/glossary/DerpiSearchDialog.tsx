'use client';

import { useState } from 'react';
import { MdAdd, MdSearch } from 'react-icons/md';
import Badge from '@/components/Badge';
import Button from '@/components/Button';
import EmptyState from '@/components/EmptyState';
import ErrorRetry from '@/components/ErrorRetry';
import { Input } from '@/components/Input';
import Modal from '@/components/Modal';
import Skeleton from '@/components/Skeleton';
import { SKIP, useResource } from '@/lib/resource';
import { apiErrorMessage, isRetryable } from '@/lib/api/errors';
import { formatCount } from '@/lib/format';
import { ICON } from '@/lib/icons';
import { tagCategoryChip } from '@/lib/tagCategories';
import { derpiTagSearch } from './resources';
import type { DerpiTagRow } from './model';

/**
 * 搜原站标签: a search of Derpibooru's tags, each result a row with one control — 导入, which
 * opens 添加新标签 on it. The rows are not controls themselves, so they take no state layer
 * (R9-037), and the dialog's own body scrolls them: no second scroller inside it. They sit one
 * container step above the dialog (`highest` on its `high`), as every list in a dialog does — on
 * `low` they read as a hole two steps down (G4-009).
 */
export default function DerpiSearchDialog({
  open,
  onClose,
  onImport,
}: {
  open: boolean;
  onClose: () => void;
  onImport: (tag: DerpiTagRow) => void;
}) {
  const [draft, setDraft] = useState('');
  const [query, setQuery] = useState('');
  const read = useResource(derpiTagSearch, query ? { query } : SKIP);
  const rows = read.data ?? [];

  return (
    <Modal isOpen={open} onClose={onClose} title="搜索原站标签" maxWidth="lg">
      <div className="space-y-4">
        <form
          role="search"
          className="flex items-start gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            const term = draft.trim();
            if (!term) return;
            if (term === query) read.refresh();
            else setQuery(term);
          }}
        >
          <Input
            size="sm"
            aria-label="原站标签"
            icon={<MdSearch size={ICON.control} />}
            placeholder="输入英文标签名…"
            autoComplete="off"
            autoCapitalize="none"
            spellCheck={false}
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            fieldClassName="min-w-0 flex-1"
            data-autofocus=""
          />
          <Button type="submit" variant="filled" loading={Boolean(query) && read.isLoading && read.data === undefined}>
            搜索
          </Button>
        </form>
        {!query ? (
          <EmptyState size="inline" title="输入标签名后搜索原站标签" />
        ) : read.data === undefined && read.error ? (
          <ErrorRetry
            size="inline"
            title="原站标签搜索失败"
            message={apiErrorMessage(read.error)}
            onRetry={isRetryable(read.error) ? read.refresh : undefined}
          />
        ) : read.data === undefined ? (
          <div aria-hidden="true">
            {[0, 1, 2, 3].map((index) => (
              <div key={index} className="m3-row flex items-center gap-3 bg-surface-container-highest p-3">
                <Skeleton className="h-5 w-16 rounded-xs" delay={index * 80} />
                <Skeleton className="h-5 w-40" delay={index * 80 + 40} />
              </div>
            ))}
          </div>
        ) : rows.length === 0 ? (
          <EmptyState size="inline" title="原站没有匹配的标签" />
        ) : (
          <ul aria-label="原站标签">
            {rows.map((tag) => (
              <li key={tag.name} className="m3-row flex flex-wrap items-center gap-x-3 gap-y-2 bg-surface-container-highest p-3">
                <Badge colors={tagCategoryChip(tag.category)}>{tag.category || 'general'}</Badge>
                <span className="min-w-0 flex-1 font-mono text-body-m text-on-surface wrap-anywhere">{tag.name}</span>
                <span className="text-body-s tabular-nums text-on-surface-variant">{`（${formatCount(tag.images)} 图）`}</span>
                <Button type="button" variant="tonal" size="xs" icon={<MdAdd />} onClick={() => onImport(tag)}>
                  导入
                </Button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Modal>
  );
}
