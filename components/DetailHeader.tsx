'use client';

import Link from 'next/link';
import {
  MdAccessTime,
  MdKeyboardArrowDown,
  MdImage,
  MdPerson,
  MdSdStorage,
  MdStar,
} from 'react-icons/md';
import {
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import type { PonyImage } from '@/lib/types/image';

type DetailHeaderProps = {
  image: PonyImage;
  layout?: 'page' | 'overlay' | 'stage';
  metadataReady?: boolean;
};

type TitleMetrics = {
  collapsed: number;
  expanded: number;
  overflowing: boolean;
};

const TITLE_COLLAPSED_LINES = 1;

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
  layout = 'page',
  metadataReady = true,
}: DetailHeaderProps) {
  const titleRef = useRef<HTMLHeadingElement>(null);
  const [expandedTitle, setExpandedTitle] = useState<string | null>(null);
  const [titleMetrics, setTitleMetrics] = useState<TitleMetrics | null>(null);
  const title = image.name || `Image #${image.id}`;
  const isStage = layout === 'stage';
  const compactMetadata = layout !== 'page';
  const isTitleExpanded = expandedTitle === title;
  const isTitleOverflowing = !isStage && Boolean(titleMetrics?.overflowing);
  const titleHeight = titleMetrics
    ? (isTitleExpanded ? titleMetrics.expanded : titleMetrics.collapsed)
    : null;

  useLayoutEffect(() => {
    const heading = titleRef.current;
    if (!heading || isStage) {
      setTitleMetrics(null);
      return;
    }

    let frame = 0;
    let observedWidth = heading.getBoundingClientRect().width;
    let cancelled = false;
    const measure = () => {
      frame = 0;
      const lineHeight = Number.parseFloat(window.getComputedStyle(heading).lineHeight)
        || heading.getBoundingClientRect().height;
      const collapsed = Math.max(1, Math.ceil(lineHeight * TITLE_COLLAPSED_LINES));
      // The first paint stays single-line. Temporarily remove that clamp only
      // for this synchronous measurement so expanded height remains accurate.
      const previousHeight = heading.style.height;
      const previousMaxHeight = heading.style.maxHeight;
      const previousWhiteSpace = heading.style.whiteSpace;
      heading.style.height = 'auto';
      heading.style.maxHeight = 'none';
      heading.style.whiteSpace = 'normal';
      const expanded = Math.max(collapsed, Math.ceil(heading.scrollHeight));
      heading.style.height = previousHeight;
      heading.style.maxHeight = previousMaxHeight;
      heading.style.whiteSpace = previousWhiteSpace;
      const next = {
        collapsed,
        expanded,
        overflowing: expanded > collapsed + 1,
      };
      setTitleMetrics((current) => (
        current &&
        current.collapsed === next.collapsed &&
        current.expanded === next.expanded &&
        current.overflowing === next.overflowing
          ? current
          : next
      ));
    };
    const scheduleMeasure = () => {
      if (!frame) frame = requestAnimationFrame(measure);
    };
    const observer = new ResizeObserver(([entry]) => {
      const width = entry?.contentRect.width ?? heading.getBoundingClientRect().width;
      if (Math.abs(width - observedWidth) < 0.5) return;
      observedWidth = width;
      scheduleMeasure();
    });
    observer.observe(heading);
    measure();
    void document.fonts.ready.then(() => {
      if (!cancelled) scheduleMeasure();
    });
    return () => {
      cancelled = true;
      cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, [isStage, title]);

  return (
    <div
      data-image-detail-reveal="header"
      className={`bg-transparent p-4 sm:p-6 ${
        isStage
          ? 'image-detail-header-stage overflow-hidden'
          : layout === 'overlay'
            ? 'image-detail-header-route'
            : ''
      }`}
    >
      <div className="mb-3 flex min-w-0 items-start gap-2 sm:gap-3">
        <h1
          ref={titleRef}
          id={`image-title-${image.id}`}
          title={isTitleOverflowing && !isTitleExpanded ? title : undefined}
          style={{
            height: titleHeight ? `${titleHeight}px` : `${TITLE_COLLAPSED_LINES}lh`,
            maxHeight: titleHeight ? `${titleHeight}px` : `${TITLE_COLLAPSED_LINES}lh`,
            whiteSpace: isTitleExpanded ? 'normal' : 'nowrap',
            textOverflow: isTitleExpanded ? 'clip' : 'ellipsis',
          }}
          className="min-w-0 flex-1 overflow-hidden text-left text-2xl font-bold leading-8 text-slate-800 transition-[height] duration-[260ms] ease-[cubic-bezier(0.22,0.61,0.36,1)] [overflow-wrap:anywhere] motion-reduce:transition-none dark:text-slate-100 md:text-3xl md:leading-9"
        >
          {title}
        </h1>
        {isTitleOverflowing && (
          <button
            type="button"
            aria-controls={`image-title-${image.id}`}
            aria-expanded={isTitleExpanded}
            onClick={() => setExpandedTitle((current) => current === title ? null : title)}
            aria-label={isTitleExpanded ? '收起完整标题' : '展开完整标题'}
            title={isTitleExpanded ? '收起完整标题' : '展开完整标题'}
            data-image-detail-title-toggle
            className="mt-0.5 inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-slate-400 transition-colors duration-[180ms] ease-out hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30 focus-visible:ring-offset-1 focus-visible:ring-offset-white motion-reduce:transition-none dark:text-slate-500 dark:hover:text-primary dark:focus-visible:ring-offset-slate-950"
          >
            <MdKeyboardArrowDown
              size={20}
              aria-hidden="true"
              className={`transition-transform duration-[260ms] ease-[cubic-bezier(0.22,0.61,0.36,1)] motion-reduce:transition-none ${isTitleExpanded ? 'rotate-180' : ''}`}
            />
          </button>
        )}
      </div>
      <div className={`image-detail-meta flex min-w-0 items-center gap-4 text-sm text-slate-600 dark:text-slate-300 ${compactMetadata ? 'flex-nowrap overflow-x-auto' : 'flex-wrap'}`}>
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
