'use client';

import { useRouter } from 'next/navigation';
import Badge from '@/components/Badge';
import Button from '@/components/Button';
import EmptyState from '@/components/EmptyState';
import ErrorRetry from '@/components/ErrorRetry';
import Modal from '@/components/Modal';
import Spinner from '@/components/Spinner';
import { useSession } from '@/lib/hooks';
import { SKIP, useResource } from '@/lib/resource';
import { dictionaryTag } from '@/lib/resources';

export default function TagInfoModal({ tag, onClose }: {
  tag: string | null;
  onClose: () => void;
}) {
  const router = useRouter();
  const { token } = useSession();
  const result = useResource(dictionaryTag, tag && token ? { tag, token } : SKIP);
  const entry = result.data;
  const loading = Boolean(tag && token && entry === undefined && !result.error);

  return (
    <Modal
      isOpen={tag !== null}
      onClose={onClose}
      title={tag ?? ''}
      maxWidth="md"
      footer={
        <Button
          variant="accent"
          fullWidth
          onClick={() => {
            if (tag === null) return;
            router.push(`/search?q=${encodeURIComponent(tag)}`, { scroll: false });
            onClose();
          }}
        >
          搜索此标签
        </Button>
      }
    >
      {loading ? (
        <Spinner label="查询词库中…" className="py-8" />
      ) : result.error && entry === undefined ? (
        <ErrorRetry size="inline" title="词库查询失败" onRetry={result.refresh} />
      ) : entry ? (
        <div className="space-y-3">
          {[
            ['中文翻译', entry.cn],
            ['标签简介', entry.description],
            ['分类', entry.cat],
          ].map(([label, value]) => value ? (
            <div key={label}>
              <span className="text-label-m-emphasized text-on-surface-variant">{label}</span>
              <p className="text-body-m text-on-surface-variant mt-1">{value}</p>
            </div>
          ) : null)}
          {entry.aliases?.length > 0 && (
            <div>
              <span className="text-label-m-emphasized text-on-surface-variant">别名</span>
              <div className="flex flex-wrap gap-1.5 mt-1">
                {entry.aliases.map((alias, index) => <Badge key={index}>{alias}</Badge>)}
              </div>
            </div>
          )}
        </div>
      ) : (
        <EmptyState
          size="inline"
          title="词库中暂无此标签的详细信息"
          description={token ? undefined : '登录后可以查询更多标签信息'}
        />
      )}
    </Modal>
  );
}
