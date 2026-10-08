'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { MdClose, MdImage } from 'react-icons/md';
import DropZone from '@/components/DropZone';
import FadeInImage from '@/components/FadeInImage';
import IconButton from '@/components/IconButton';
import ProgressBar from '@/components/ProgressBar';
import { uploadForumPicture } from '@/lib/forumImages';
import { readToken } from '@/lib/hooks';
import { ICON } from '@/lib/icons';
import { getAssetUrl } from '@/lib/utils';

interface CoverFieldProps {
  /** The uploaded cover's stored path. */
  value: string | null;
  onChange: (path: string | null) => void;
  onBusyChange: (busy: boolean) => void;
}

interface Upload {
  preview: string;
  progress: number;
  controller: AbortController;
}

/**
 * 封面（选填）. The picture uploads the moment it is chosen, with its progress shown, and the post
 * keeps the stored path — so 发布, and a 发布 retried after a failure, send a path rather than
 * the file again (R6-047: the cover used to upload at submit, once per attempt).
 */
export default function CoverField({ value, onChange, onBusyChange }: CoverFieldProps) {
  const headingId = useId();
  const helperId = useId();
  const [upload, setUpload] = useState<Upload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const current = useRef<Upload | null>(null);

  /* Leaving mid-upload abandons it and frees the local preview. */
  useEffect(
    () => () => {
      const pending = current.current;
      if (!pending) return;
      pending.controller.abort();
      URL.revokeObjectURL(pending.preview);
    },
    [],
  );

  const finish = (entry: Upload) => {
    if (current.current !== entry) return false;
    current.current = null;
    URL.revokeObjectURL(entry.preview);
    setUpload(null);
    onBusyChange(false);
    return true;
  };

  const start = async (file: File) => {
    const token = readToken();
    if (!token) return;
    current.current?.controller.abort();
    const entry: Upload = { preview: URL.createObjectURL(file), progress: 0, controller: new AbortController() };
    current.current = entry;
    setUpload(entry);
    setError(null);
    onBusyChange(true);
    const outcome = await uploadForumPicture(token, file, {
      signal: entry.controller.signal,
      onProgress: (fraction) => {
        if (current.current === entry) setUpload({ ...entry, progress: fraction });
      },
    });
    if (!finish(entry) || readToken() !== token) return;
    if (outcome.ok) onChange(outcome.path);
    else if (!outcome.aborted) setError(outcome.message);
  };

  const cancel = () => {
    const entry = current.current;
    if (!entry) return;
    entry.controller.abort();
    finish(entry);
  };

  return (
    <div role="group" aria-labelledby={headingId}>
      <p id={headingId} className="mb-2 text-title-s text-on-surface">
        封面<span className="text-body-m text-on-surface-variant">（选填）</span>
      </p>
      {upload ? (
        <div className="relative w-full max-w-80 overflow-hidden rounded-md bg-surface-container-high">
          {/* The chosen file itself, while it travels. A blob URL: nothing to optimise. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={upload.preview} alt="" className="aspect-[2/1] w-full object-cover" />
          <div className="absolute inset-x-0 bottom-0 bg-media-plate px-3 py-2">
            <ProgressBar value={upload.progress * 100} surface="media" label="封面上传进度" />
          </div>
          <IconButton
            variant="media"
            size="sm"
            dismiss
            aria-label="取消上传"
            icon={<MdClose />}
            onClick={cancel}
            className="absolute top-2 right-2"
          />
        </div>
      ) : value ? (
        <div className="relative w-full max-w-80 overflow-hidden rounded-md bg-surface-container-high">
          <div className="relative aspect-[2/1] w-full">
            <FadeInImage src={getAssetUrl(value)} alt="封面" fill sizes="320px" className="object-cover" />
          </div>
          <IconButton
            variant="media"
            size="sm"
            dismiss
            aria-label="移除封面"
            icon={<MdClose />}
            onClick={() => onChange(null)}
            className="absolute top-2 right-2"
          />
        </div>
      ) : (
        <DropZone size="sm" accept="image/*" onFile={(file) => void start(file)} aria-label="选择或拖拽封面图片" className="flex-row gap-2">
          <MdImage size={ICON.control} aria-hidden="true" />
          <span className="text-body-m">选择或拖拽封面图片</span>
        </DropZone>
      )}
      <p
        id={helperId}
        role={error ? 'alert' : undefined}
        className={error ? 'mt-1.5 px-4 text-body-s text-error' : 'mt-1.5 px-4 text-body-s text-on-surface-variant'}
      >
        {error ?? '最大 5MB，更大的照片会自动压缩'}
      </p>
    </div>
  );
}
