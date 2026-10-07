'use client';

import { useState, useLayoutEffect, useRef, type FormEvent } from 'react';
import { MdCloudUpload } from 'react-icons/md';
import type { PonyImage } from '@/lib/api';
import { apiErrorMessage } from '@/lib/api/errors';
import { searchImage } from '@/lib/api/picpony';
import { searchImageByUrl } from '@/lib/api/semantic';
import { processImageFile } from '@/lib/utils';
import FadeInImage from './FadeInImage';
import Modal from './Modal';
import Slider from './Slider';
import Spinner from './Spinner';
import Button from '@/components/Button';
import DropZone from '@/components/DropZone';
import { Input } from '@/components/Input';
import { ICON } from '@/lib/icons';

/** What a search came back with: pictures, or a query the service suggests running instead. */
export type ImageSearchOutcome =
  | { kind: 'images'; images: PonyImage[]; total: number; preview: string | null }
  | { kind: 'query'; query: string };

interface ImageSearchModalProps {
  isOpen: boolean;
  onClose: () => void;
  /** Called once, just before the dialog closes itself. The caller reports it — nothing here does. */
  onResult: (outcome: ImageSearchOutcome) => void;
}

type Status = { kind: 'idle' } | { kind: 'empty' } | { kind: 'error'; message: string };

function validLink(text: string): string | null {
  try {
    const url = new URL(text.trim());
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.toString() : null;
  } catch {
    return null;
  }
}

/**
 * 以图搜图: a picture from this device, or one at a link — the original front end's two
 * sources, here in one form rather than behind a mode switch: picking a file clears the link and
 * typing a link clears the file, so what 开始搜索 will send is always the one thing on screen.
 *
 * **It reports nothing itself.** A result goes to `onResult` and the screen that opened the
 * dialog shows it — once. The dialog and the page each used to raise a toast on top of the
 * results' own heading, so one success was announced three times. A search that found nothing,
 * or failed, is said here, under the controls, with the picture kept: the dialog stays open for
 * the next try.
 */
export default function ImageSearchModal({ isOpen, onClose, onResult }: ImageSearchModalProps) {
  const [selectedImage, setSelectedImage] = useState<string | null>(null);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [link, setLink] = useState('');
  const [distance, setDistance] = useState<number>(0.1);
  const [isUploading, setIsUploading] = useState(false);
  const [isReading, setIsReading] = useState(false);
  const [status, setStatus] = useState<Status>({ kind: 'idle' });
  const generation = useRef(0);
  const fileRead = useRef(0);
  const submitting = useRef(false);
  const active = useRef(false);

  useLayoutEffect(() => {
    active.current = isOpen;
    const current = ++generation.current;
    submitting.current = false;
    fileRead.current += 1;
    if (isOpen) {
      queueMicrotask(() => {
        if (generation.current !== current) return;
        setSelectedImage(null);
        setSelectedFile(null);
        setLink('');
        setDistance(0.1);
        setIsUploading(false);
        setIsReading(false);
        setStatus({ kind: 'idle' });
      });
    }
    return () => { active.current = false; generation.current += 1; };
  }, [isOpen]);

  const close = () => {
    active.current = false;
    generation.current += 1;
    fileRead.current += 1;
    onClose();
  };

  const handleFileSelect = async (file: File) => {
    if (!active.current || submitting.current) return;
    const request = ++fileRead.current;
    const current = generation.current;
    setIsReading(true);
    setStatus({ kind: 'idle' });
    setSelectedFile(null);
    setSelectedImage(null);
    setLink('');
    try {
      const dataUrl = await processImageFile(file);
      if (!active.current || current !== generation.current || request !== fileRead.current) return;
      setSelectedFile(file);
      setSelectedImage(dataUrl);
    } catch (err) {
      if (active.current && current === generation.current && request === fileRead.current) {
        setStatus({ kind: 'error', message: apiErrorMessage(err, '无法读取此图片，换一张试试') });
      }
    } finally {
      if (active.current && current === generation.current && request === fileRead.current) setIsReading(false);
    }
  };

  const linkTarget = validLink(link);
  const linkInvalid = link.trim() !== '' && !linkTarget;
  const ready = !isReading && (Boolean(selectedFile) || Boolean(linkTarget));

  const handleSubmit = async (event?: FormEvent) => {
    event?.preventDefault();
    if (!active.current || submitting.current || !ready) return;
    const current = generation.current;
    submitting.current = true;
    setIsUploading(true);
    setStatus({ kind: 'idle' });

    try {
      const byFile = Boolean(selectedFile);
      const data = byFile && selectedFile
        ? await searchImage(selectedFile, distance)
        : await searchImageByUrl(linkTarget as string, distance);
      if (!active.current || current !== generation.current) return;

      const images = Array.isArray(data?.images) ? (data.images as PonyImage[]) : [];
      if (images.length > 0) {
        onResult({ kind: 'images', images, total: Number(data.total) || images.length, preview: byFile ? selectedImage : null });
        close();
      } else if (typeof data?.searchQuery === 'string' && data.searchQuery.trim()) {
        onResult({ kind: 'query', query: data.searchQuery.trim() });
        close();
      } else {
        setStatus({ kind: 'empty' });
      }
    } catch (err) {
      if (active.current && current === generation.current) {
        setStatus({ kind: 'error', message: apiErrorMessage(err, '以图搜图失败，请稍后再试') });
      }
    } finally {
      if (active.current && current === generation.current) {
        submitting.current = false;
        setIsUploading(false);
      }
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={close}
      title="以图搜图"
      footer={
        <>
          <Button variant="text" type="button" onClick={close}>
            取消
          </Button>
          <Button variant="filled" onClick={() => void handleSubmit()} disabled={!ready} loading={isUploading}>
            开始搜索
          </Button>
        </>
      }
    >
      {/* `DropZone` owns the three states; the zone previously gave no feedback at all while a
          file was held over it. */}
      <DropZone
        disabled={isUploading}
        accept="image/*"
        onFile={handleFileSelect}
        filled={Boolean(selectedImage)}
        aria-label="选择或拖拽要搜索的图片"
        className="mb-4"
      >
        {/* One height for the prompt, the file being read and the picture, so picking a file
            does not grow the dialog. The way to change the picture is said in words under it: a
            veil that appeared on hover never appeared on a touch screen. */}
        <div className="flex h-48 w-full flex-col items-center justify-center">
          {selectedImage ? (
            <>
              <div className="relative min-h-0 w-full flex-1">
                <FadeInImage
                  src={selectedImage}
                  alt="已选择的图片"
                  fill
                  /* The dialog's default width (448px) less its own 24px inset each side and
                     the zone's padding and border. */
                  sizes="(min-width: 640px) 344px, 100vw"
                  className="object-contain rounded-md"
                />
              </div>
              <p className="text-body-s text-on-surface-variant mt-3">点击或拖拽以更换图片</p>
            </>
          ) : isReading ? (
            <Spinner size="lg" />
          ) : (
            <>
              <MdCloudUpload size={ICON.display} className="text-outline mb-3" />
              <p className="text-body-m-emphasized text-on-surface">点击或拖拽图片到此处</p>
            </>
          )}
        </div>
      </DropZone>

      {/* The second source: a picture on the web. Enter searches, like the dialog's own button. */}
      <form className="mb-6" onSubmit={(event) => void handleSubmit(event)} noValidate>
        <Input
          type="url"
          inputMode="url"
          label="或粘贴图片链接"
          value={link}
          onChange={(event) => {
            setLink(event.target.value);
            setStatus({ kind: 'idle' });
            if (event.target.value.trim()) {
              fileRead.current += 1;
              setIsReading(false);
              setSelectedFile(null);
              setSelectedImage(null);
            }
          }}
          disabled={isUploading}
          enterKeyHint="search"
          autoComplete="off"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          error={linkInvalid ? '请输入以 http:// 或 https:// 开头的图片链接' : undefined}
        />
      </form>

      <div className="mb-2 px-2">
        <div className="flex justify-between items-center mb-2">
          <p className="text-label-l text-on-surface">容差</p>
          {/* A value is text: `on-surface`, not the brand ink (2.5:1 at this size). */}
          <span className="text-label-l-emphasized text-on-surface tabular-nums">{distance.toFixed(2)}</span>
        </div>
        <Slider
          min={0.01}
          max={1.0}
          step={0.01}
          value={distance}
          onValueChange={(value) => {
            setDistance(value);
            if (status.kind === 'empty') setStatus({ kind: 'idle' });
          }}
          aria-label="搜索容差"
          valueText={(v) => `容差 ${v.toFixed(2)}`}
        />
        <div className="flex justify-between text-body-s text-on-surface-variant mt-1">
          <span>精确匹配</span>
          <span>模糊匹配</span>
        </div>
        {/* Always in the tree, so the sentence is announced when it arrives; empty, it takes
            no space. A failure is an alert, "nothing found" a status. */}
        <p role="status" className="text-body-m text-on-surface-variant mt-4 empty:mt-0">
          {status.kind === 'empty' ? '未找到相似图片，试试调大容差' : ''}
        </p>
        <p role="alert" className="text-body-m text-error mt-4 empty:mt-0">
          {status.kind === 'error' ? status.message : ''}
        </p>
      </div>
    </Modal>
  );
}
