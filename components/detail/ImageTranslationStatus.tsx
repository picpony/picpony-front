'use client';

import { MdErrorOutline, MdTranslate } from 'react-icons/md';
import Button from '@/components/Button';
import Spinner from '@/components/Spinner';
import { ICON } from '@/lib/icons';
import type { ImageTranslation } from '@/lib/translation';

/** What the job is doing, in the original front end's words. */
function progressText({ phase, queueAhead }: Pick<ImageTranslation, 'phase' | 'queueAhead'>): string {
  switch (phase) {
    case 'requesting':
      return '正在提交翻译…';
    case 'queued':
      return queueAhead > 0 ? `正在排队，前面还有 ${queueAhead} 张…` : '正在等待翻译节点领取…';
    case 'translating':
      return '正在翻译…';
    case 'loading':
      return '翻译完成，正在加载译图…';
    default:
      return '';
  }
}

/**
 * The one-click image translation's status, as one 40dp line under the picture's actions: the
 * queue while it waits (a job can wait minutes — the original front end said how many were
 * ahead, and so does this), why it failed and 重试, and, while the translated picture is the one
 * on screen, a way back to the original that does not depend on reading an icon's state.
 *
 * A live region, so a screen reader hears the job move without the reader chasing it.
 */
export default function ImageTranslationStatus({ translation }: { translation: ImageTranslation }) {
  const { phase, shown, message, toggle } = translation;
  const busy = phase === 'requesting' || phase === 'queued' || phase === 'translating' || phase === 'loading';
  const visible = busy || phase === 'failed' || phase === 'stalled' || shown;

  return (
    <div role="status" className="empty:hidden">
      {visible && (
        <div className="flex min-h-10 min-w-0 items-center gap-2 text-body-m text-on-surface-variant">
          {busy ? (
            <Spinner size="sm" />
          ) : phase === 'failed' ? (
            <MdErrorOutline size={ICON.control} className="shrink-0 text-error" aria-hidden="true" />
          ) : (
            <MdTranslate size={ICON.control} className="shrink-0 text-primary-ink" aria-hidden="true" />
          )}
          <p className="min-w-0 flex-1">
            {busy
              ? progressText(translation)
              : phase === 'failed'
                ? (message ?? '翻译失败，请稍后重试')
                : phase === 'stalled'
                  ? '翻译耗时较长，任务仍在后台处理，请稍后再试'
                  : '正在显示译图'}
          </p>
          {(phase === 'failed' || phase === 'stalled') && (
            <Button variant="text" size="xs" className="shrink-0" onClick={toggle}>
              重试
            </Button>
          )}
          {shown && (
            <Button variant="text" size="xs" className="shrink-0" onClick={toggle}>
              显示原图
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
