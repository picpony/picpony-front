'use client';

import { useState } from 'react';
import Link from 'next/link';
import { MdFilterAlt, MdKey } from 'react-icons/md';
import Button from '@/components/Button';
import { buttonClasses } from '@/components/buttonStyles';
import EmptyState from '@/components/EmptyState';
import ErrorRetry from '@/components/ErrorRetry';
import Modal from '@/components/Modal';
import Skeleton from '@/components/Skeleton';
import StatusView from '@/components/StatusView';
import { settingsHref } from '@/app/settings/tabs';
import { apiErrorMessage, isRetryable } from '@/lib/api/errors';
import { getDerpiFilterTags, MAX_GROUP_NAME, MAX_TAGS_PER_LIST, type DerpiFilterSummary, type ImportedFilter } from '@/lib/api/blockGroups';
import { ICON } from '@/lib/icons';
import { SKIP, useResource } from '@/lib/resource';
import { derpiFilters } from '@/lib/resources';
import { settle } from '@/lib/settle';

/** What an import makes of a filter: its two lists, capped at a group's own bound, and the name. */
export interface FilterImport {
  name: string;
  hidden: string[];
  spoilered: string[];
  /** Tags the caps left out, to say so. */
  dropped: number;
}

export function importOf(filter: ImportedFilter): FilterImport {
  const name = Array.from(`[导入] ${filter.name}`).slice(0, MAX_GROUP_NAME).join('');
  const hidden = filter.hidden.slice(0, MAX_TAGS_PER_LIST);
  const spoilered = filter.spoilered.slice(0, MAX_TAGS_PER_LIST);
  return {
    name,
    hidden,
    spoilered,
    dropped: filter.hidden.length - hidden.length + (filter.spoilered.length - spoilered.length),
  };
}

interface DerpiFilterImportProps {
  isOpen: boolean;
  onClose: () => void;
  apiKey: string | null;
  /** Whether a new group fits under the limit. */
  canCreate: boolean;
  /** Saves the import as a new group; resolves once it is on the list (throws on a refusal). */
  onImport: (result: FilterImport) => Promise<void>;
}

function FilterRows() {
  return (
    <div aria-hidden="true">
      {[0, 1, 2].map((i) => (
        <div key={i} className="m3-row flex items-center gap-4 bg-surface-container-highest p-4">
          <div className="min-w-0 flex-1 space-y-2">
            <Skeleton className="h-4 w-32" delay={i * 90} />
            <Skeleton className="h-3 w-48" delay={i * 90 + 40} />
          </div>
          <Skeleton className="h-8 w-16 rounded-full" delay={i * 90 + 80} />
        </div>
      ))}
    </div>
  );
}

/**
 * 从 Derpibooru 导入 — the original front end's import: the filters the bound API key's account
 * made, each one turned into a new 屏蔽组 (its hidden tags and spoilered tags, ids resolved to
 * names, plus the plain tags its expressions name). A filter that is only expressions and
 * wildcards has nothing a block group can hold, and says so rather than making an empty group.
 */
export default function DerpiFilterImport({ isOpen, onClose, apiKey, canCreate, onImport }: DerpiFilterImportProps) {
  const read = useResource(derpiFilters, isOpen && apiKey ? { apiKey } : SKIP);
  const [importing, setImporting] = useState<number | null>(null);
  const [problem, setProblem] = useState<{ id: number; message: string } | null>(null);

  const run = async (filter: DerpiFilterSummary) => {
    if (!apiKey || importing !== null || !canCreate) return;
    setImporting(filter.id);
    setProblem(null);
    const read = await settle(getDerpiFilterTags(apiKey, filter.id));
    if (!read.ok) {
      setProblem({ id: filter.id, message: apiErrorMessage(read.error, '导入失败') });
    } else {
      const result = importOf(read.value);
      if (result.hidden.length === 0 && result.spoilered.length === 0) {
        setProblem({ id: filter.id, message: '这个过滤器只有搜索表达式或通配符，没有可以导入的标签' });
      } else {
        const imported = await settle(onImport(result));
        if (!imported.ok) setProblem({ id: filter.id, message: apiErrorMessage(imported.error, '导入失败') });
      }
    }
    setImporting(null);
  };

  let body;
  if (!apiKey) {
    body = (
      <StatusView
        size="pane"
        icon={<MdKey size={ICON.display} />}
        title="需要绑定 API Key"
        description="导入会读取你在 Derpibooru 上创建的过滤器，请先在设置中绑定 Derpibooru API Key。"
        action={
          <Link scroll={false} href={settingsHref('account')} className={buttonClasses({ variant: 'filled' })} onClick={onClose}>
            前往设置
          </Link>
        }
      />
    );
  } else if (read.data === undefined && read.error === undefined) {
    body = <FilterRows />;
  } else if (read.data === undefined) {
    body = (
      <ErrorRetry
        size="pane"
        title="过滤器加载失败"
        message={apiErrorMessage(read.error)}
        onRetry={isRetryable(read.error) ? read.refresh : undefined}
      />
    );
  } else if (read.data.length === 0) {
    body = (
      <EmptyState
        size="pane"
        icon={<MdFilterAlt size={ICON.display} />}
        title="没有可导入的过滤器"
        description="你在 Derpibooru 上还没有创建自己的过滤器。"
      />
    );
  } else {
    body = (
      <div>
        {!canCreate && (
          <p className="mb-3 px-1 text-body-m text-error" role="alert">
            屏蔽组已达上限，删除一些后才能导入。
          </p>
        )}
        <div role="list">
          {read.data.map((filter) => (
            <div role="listitem" key={filter.id} className="m3-row bg-surface-container-highest p-4">
              <div className="flex items-center gap-4">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-label-l text-on-surface" title={filter.name}>{filter.name}</p>
                  <p className="mt-0.5 line-clamp-2 text-body-s text-on-surface-variant">
                    {filter.description || '没有描述'}
                  </p>
                </div>
                <Button
                  size="xs"
                  variant="tonal"
                  loading={importing === filter.id}
                  disabled={!canCreate || (importing !== null && importing !== filter.id)}
                  onClick={() => void run(filter)}
                >
                  导入
                </Button>
              </div>
              {problem?.id === filter.id && (
                <p className="mt-2 text-body-s text-error" role="alert">{problem.message}</p>
              )}
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <Modal
      isOpen={isOpen}
      onClose={() => {
        if (importing === null) onClose();
      }}
      title="从 Derpibooru 导入"
      aria-describedby="derpi-import-intro"
      maxWidth="lg"
    >
      <p id="derpi-import-intro" className="mb-4 text-body-m text-on-surface-variant">
        选择一个你在 Derpibooru 上创建的过滤器，它的隐藏与遮挡标签会成为一个新的屏蔽组。
      </p>
      {body}
    </Modal>
  );
}
