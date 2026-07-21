import Link from 'next/link';
import {
  MdAccessTime,
  MdImage,
  MdPerson,
  MdSdStorage,
  MdStar,
} from 'react-icons/md';
import type { ReactNode } from 'react';
import type { PonyImage } from '@/lib/types/image';

type DetailHeaderProps = {
  image: PonyImage;
  compact?: boolean;
  metadataReady?: boolean;
};

function getImageFormat(image: PonyImage) {
  const source = image.format || image.representations?.full || image.view_url || '';
  return source.split('.').pop()?.toUpperCase() || 'UNKNOWN';
}

function MetaValue({ ready, children, width }: {
  ready: boolean;
  children: ReactNode;
  width: string;
}) {
  if (ready) return children;
  return (
    <span
      aria-hidden="true"
      data-image-detail-meta-loading
      className={`inline-block h-4 animate-pulse rounded bg-slate-200 dark:bg-slate-700 ${width}`}
    />
  );
}

export default function DetailHeader({
  image,
  compact = false,
  metadataReady = true,
}: DetailHeaderProps) {
  return (
    <div
      data-image-detail-reveal="header"
      className={`bg-transparent p-4 sm:p-6 ${compact ? 'image-detail-header-stage overflow-hidden' : ''}`}
    >
      <div className="mb-3 flex items-start justify-between gap-4">
        <h1 className="line-clamp-2 text-left text-2xl font-bold leading-8 text-slate-800 [overflow-wrap:anywhere] dark:text-slate-100 md:text-3xl md:leading-9">
          {image.name || `Image #${image.id}`}
        </h1>
      </div>
      <div className={`image-detail-meta flex min-w-0 items-center gap-4 text-sm text-slate-600 dark:text-slate-300 ${compact ? 'flex-nowrap overflow-x-auto' : 'flex-wrap'}`}>
        <div title="尺寸" className="flex shrink-0 items-center gap-1.5 cursor-pointer">
          <MdImage size={18} className="text-slate-400" />
          <MetaValue ready={metadataReady} width="w-24">
            <span>{image.width} × {image.height} px</span>
          </MetaValue>
        </div>
        <div title="大小" className="flex shrink-0 items-center gap-1.5 cursor-pointer">
          <MdSdStorage size={18} className="text-slate-400" />
          <MetaValue ready={metadataReady} width="w-16">
            <span>{((image.size || 0) / 1024 / 1024).toFixed(2)} MB</span>
          </MetaValue>
        </div>
        <div title="格式" className="flex shrink-0 items-center gap-1.5 cursor-pointer">
          <span className="rounded border border-slate-200 bg-slate-100 px-1.5 py-0.5 text-xs font-medium text-slate-500 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-400">
            {getImageFormat(image)}
          </span>
        </div>
        <Link
          href={image.uploader && image.uploader !== '匿名用户' && image.uploader_id ? `/derpi/user/${image.uploader_id}` : '#'}
          onClick={(event) => {
            if (!image.uploader || image.uploader === '匿名用户' || !image.uploader_id) event.preventDefault();
          }}
          scroll={false}
          title="上传者"
          className="relative flex shrink-0 items-center gap-1.5 cursor-pointer transition-colors hover:text-primary"
        >
          <MdPerson size={18} className="text-slate-400" />
          <span className="max-w-[150px] truncate underline decoration-dotted underline-offset-2">{image.uploader || '匿名用户'}</span>
        </Link>
        <div title="评分" className="flex shrink-0 items-center gap-1.5 cursor-pointer">
          <MdStar size={18} className="text-slate-400" />
          <MetaValue ready={metadataReady} width="w-8">
            <span>{image.score}</span>
          </MetaValue>
        </div>
        <div title="上传日期" className="flex shrink-0 items-center gap-1.5 cursor-pointer">
          <MdAccessTime size={18} className="text-slate-400" />
          <span>
            {new Date(image.created_at).toLocaleString('zh-CN', {
              year: 'numeric',
              month: '2-digit',
              day: '2-digit',
              hour: '2-digit',
              minute: '2-digit',
            })}
          </span>
        </div>
      </div>
    </div>
  );
}
