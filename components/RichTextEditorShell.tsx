'use client';

import type { CSSProperties } from 'react';
import LoadingIndicator from '@/components/LoadingIndicator';
import { cn } from '@/lib/utils';

/**
 * What a caller needs from the rich-text editor without loading it: the handle type, the size
 * axis and the placeholder its `dynamic()` import shows while the editor's chunk loads. Kept out
 * of `RichTextEditor.tsx` so its package loader, panel adapter and stylesheet stay behind the
 * editor's lazy boundary.
 */

export interface RichTextEditorHandle {
  /** Moves focus into the text (to its end). Queued if the editor has not mounted yet. */
  focus: () => void;
}

/**
 * The editing area's height, by what is being written. `post` is an article's body, `reply` a
 * remark under one; phones get a shorter box either way, since the toolbar and the keyboard share
 * the rest of the screen (R6-044). Without a size the editor keeps the fixed 300px it always had.
 */
export type RichTextEditorSize = 'post' | 'reply';

/**
 * The editing area's minimum height in px: [phone, from `sm` up]. The editor's stylesheet and
 * the placeholder below both read this table, so the box the chunk lands in is the box it fills.
 */
export const EDITOR_MIN_HEIGHT: Record<RichTextEditorSize | 'default', readonly [number, number]> = {
  post: [200, 300],
  reply: [120, 160],
  default: [300, 300],
};

/** Shared geometry for the loaded field and its lazy placeholder. */
export const EDITOR_FRAME_CLASS_NAME = 'rich-text-editor relative w-full min-w-0 rounded-md border bg-surface';
export const EDITOR_TOOLBAR_CLASS_NAME = 'flex min-h-[calc(max(40px,var(--touch-floor))+13px)] rounded-t-[calc(var(--radius-md)-1px)] border-b border-outline-variant bg-surface-container-low';

/**
 * The editor's footprint while its chunk loads: preserves the exact toolbar and editing-area
 * minimum height with a centred M3E loading indicator so nothing shifts when the chunk lands.
 */
export function EditorPlaceholder({ size }: { size?: RichTextEditorSize }) {
  const [phone, wide] = EDITOR_MIN_HEIGHT[size ?? 'default'];
  return (
    <div aria-hidden="true" className={cn(EDITOR_FRAME_CLASS_NAME, 'overflow-hidden border-outline')}>
      <div className={EDITOR_TOOLBAR_CLASS_NAME} />
      <div
        className="flex items-center justify-center p-4 h-(--editor-phone) sm:h-(--editor-wide)"
        style={{ '--editor-phone': `${phone}px`, '--editor-wide': `${wide}px` } as CSSProperties}
      >
        <LoadingIndicator variant="contained" size="md" decorative delay={120} />
      </div>
    </div>
  );
}
