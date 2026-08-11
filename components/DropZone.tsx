'use client';

import { useCallback, useRef, useState, type DragEvent, type ReactNode } from 'react';
import { cn } from '@/lib/utils';

export type DropZoneState = 'idle' | 'dragging' | 'filled';

interface DropZoneProps {
  /** Called with the first accepted file, from either a drop or the picker. */
  onFile: (file: File) => void;
  /** `accept` for the hidden input, and what a drop is filtered against. */
  accept?: string;
  /** Something is already selected — the zone shows its preview, not its prompt. */
  filled?: boolean;
  disabled?: boolean;
  /** Padding scale. `lg` for a whole-page upload target, `sm` for a form row. */
  size?: 'sm' | 'md' | 'lg';
  className?: string;
  /** Preview or prompt. Receives the live state so a caller can react to a drag. */
  children: ReactNode | ((state: DropZoneState) => ReactNode);
  'aria-label'?: string;
}

/**
 * Click-or-drag file target.
 *
 * Three screens had one and no two agreed. Same job, same dashed rectangle, three
 * sets of numbers and three different ideas of what a drag should look like:
 *
 *   /upload            `p-8 sm:p-12`; on drag `border-primary`, a 5% wash of
 *                      `primary`, a 1.02 scale, `shadow-e3` and a 10% primary
 *                      shadow tint
 *   ImageSearchModal   `p-6`; on drag nothing at all — `onDragOver` only
 *                      prevented the default, so dragging a file over it gave no
 *                      feedback whatsoever
 *   /forum/create      `px-4 py-3`, and no drop handling at all — it was a
 *                      click-to-open button wearing a dropzone's dashed border,
 *                      which is a promise the control did not keep
 *
 * So the states are the component's, not the call site's:
 *
 *   idle      dashed `outline`, and the M3 state layer for hover — not a
 *             hand-picked hover pair on `border-primary` and the container-high tone
 *             pair, which is two properties to keep in step per site.
 *   dragging  `primary` border on the `primary-container` tone, lifted to `e3`.
 *             The `scale-[1.02]` is dropped: it is an arbitrary value, it is a
 *             transform on a container whose children include an `<img>` being
 *             measured for a preview, and the border + tone + elevation change
 *             already reads unambiguously as "let go here".
 *   filled     `primary` border on the same tone, flat. It is not inviting a
 *             drop any more; it is showing you what you chose.
 *
 * `dragenter`/`dragleave` are counted rather than toggled. A single boolean flips
 * off the moment the pointer crosses onto a *child* element, because `dragleave`
 * fires on the parent as `dragenter` fires on the child — so a zone containing a
 * preview image flickered its highlight the whole time a file was held over it.
 */
const SIZES = {
  sm: 'px-4 py-3',
  md: 'p-6',
  lg: 'p-8 sm:p-12',
} as const;

export default function DropZone({
  onFile,
  accept,
  filled = false,
  disabled = false,
  size = 'md',
  className = '',
  children,
  'aria-label': ariaLabel = '选择或拖拽文件',
}: DropZoneProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const depth = useRef(0);
  const [dragging, setDragging] = useState(false);

  const state: DropZoneState = dragging ? 'dragging' : filled ? 'filled' : 'idle';

  const take = useCallback(
    (file: File | undefined | null) => {
      if (!file || disabled) return;
      onFile(file);
    },
    [onFile, disabled],
  );

  const onDragEnter = useCallback((e: DragEvent) => {
    e.preventDefault();
    depth.current += 1;
    setDragging(true);
  }, []);

  const onDragLeave = useCallback((e: DragEvent) => {
    e.preventDefault();
    depth.current = Math.max(0, depth.current - 1);
    if (depth.current === 0) setDragging(false);
  }, []);

  const onDrop = useCallback(
    (e: DragEvent) => {
      e.preventDefault();
      depth.current = 0;
      setDragging(false);
      take(e.dataTransfer?.files?.[0]);
    },
    [take],
  );

  return (
    <div
      role="button"
      tabIndex={disabled ? -1 : 0}
      aria-label={ariaLabel}
      aria-disabled={disabled || undefined}
      onClick={() => !disabled && inputRef.current?.click()}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          if (!disabled) inputRef.current?.click();
        }
      }}
      // `dragover` must be prevented too or the browser navigates to the file.
      onDragOver={(e) => e.preventDefault()}
      onDragEnter={onDragEnter}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
      className={cn(
        'relative flex flex-col items-center justify-center rounded-md border-2 border-dashed text-center outline-none',
        'transition-[background-color,border-color,box-shadow] duration-200 ease-[var(--ease-standard)]',
        'focus-visible:ring-2 focus-ring',
        SIZES[size],
        disabled ? 'cursor-not-allowed disabled-content' : 'cursor-pointer',
        state === 'idle' && !disabled && 'state-layer border-outline',
        state === 'dragging' && 'border-primary bg-primary-container shadow-e3',
        state === 'filled' && 'border-primary bg-primary-container',
        className,
      )}
    >
      <input
        ref={inputRef}
        type="file"
        accept={accept}
        disabled={disabled}
        className="hidden"
        onChange={(e) => {
          take(e.target.files?.[0]);
          // Cleared so re-picking the same file still fires `change`.
          e.target.value = '';
        }}
      />
      {typeof children === 'function' ? children(state) : children}
    </div>
  );
}
