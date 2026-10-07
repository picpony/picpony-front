'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import dynamic from 'next/dynamic';
import { useResource, SKIP } from '@/lib/resource';
import { faveIds, faveFolders, favePictures } from '@/lib/resources';
import { useDeviceRules } from '@/components/favorites/FaveGrid';
import { useSpoilerMatch } from '@/lib/spoilers';
import { FAVE_PAGE_SIZE } from '@/lib/favorites';
import { clamp } from '@/lib/utils';
import { readToken, useSession } from '@/lib/hooks';
import { useDocumentVisible } from '@/lib/mascot/visibility';
import { describeImage } from '@/lib/imageDescription';
import type { PicLightboxSlide } from '@/components/PicLightbox';
import type { AssistantSlideshowReceipt, AssistantSlideshowRequest } from '@/lib/assistant/slideshow';

const PicLightbox = dynamic(() => import('@/components/PicLightbox'), { ssr: false });

export default function FolderSlideshow({ request, onReady, onStarted, onError, onClose }: {
  request: AssistantSlideshowRequest;
  onReady: () => Promise<void>;
  onStarted: (receipt: AssistantSlideshowReceipt) => void;
  onError: (error: unknown) => void;
  onClose: () => void;
}) {
  const { token } = useSession();
  const visible = useDocumentVisible();
  const allowed = token === request.token;
  const folders = useResource(faveFolders, allowed ? { token: request.token } : SKIP);
  const index = useResource(faveIds, allowed ? { token: request.token, folderId: request.folderId } : SKIP);
  const totalPages = Math.max(1, Math.ceil((index.data?.ids.length ?? 0) / FAVE_PAGE_SIZE));
  const page = clamp(request.page, 1, totalPages);
  const ids = useMemo(() => index.data?.ids.slice((page - 1) * FAVE_PAGE_SIZE, page * FAVE_PAGE_SIZE) ?? [], [index.data, page]);
  const pictures = useResource(favePictures, allowed && ids.length ? { ids } : SKIP);
  const rules = useDeviceRules();
  const filtered = useMemo(() => pictures.data ? rules.withhold(pictures.data.images, pictures.data.ids) : null, [pictures.data, rules]);
  const allTags = useMemo(() => [...new Set(filtered?.images.flatMap(image => image.tags) ?? [])], [filtered]);
  const spoilers = useSpoilerMatch(allTags);
  const images = useMemo(() => filtered?.images.filter(image => !image.tags.some(tag => spoilers.includes(tag))) ?? [], [filtered, spoilers]);
  const slides = useMemo<PicLightboxSlide[]>(() => images.flatMap<PicLightboxSlide>(image => {
    const src = image.representations.full || image.view_url;
    if (!src || !/^https?:\/\//.test(src)) return [];
    const format = image.format?.toLowerCase();
    if (format === 'webm' || format === 'mp4') return [{ type: 'video', sources: [{ src, type: `video/${format}` }], controls: true, autoPlay: false, width: image.width, height: image.height } satisfies PicLightboxSlide];
    return [{ src, alt: describeImage(image), width: image.width, height: image.height } satisfies PicLightboxSlide];
  }), [images]);
  const [open, setOpen] = useState(false);
  const started = useRef(false);
  const opening = useRef(false);
  const error = index.error ?? pictures.error ?? folders.error;
  const ready = index.data !== undefined && folders.data !== undefined && (ids.length === 0 || pictures.data !== undefined);
  useEffect(() => {
    if (!allowed) { onError(new Error('账号已切换，已停止放映')); return; }
    if (error) { onError(error); return; }
    if (!ready || !visible) return;
    if (!folders.data?.folders.some(folder => folder.id === request.folderId)) { onError(new Error('未找到该收藏夹')); return; }
    if (slides.length < 2) { onError(new Error('当前页不足两张可放映的图片，请到收藏夹查看')); return; }
    if (opening.current) return;
    opening.current = true;
    void onReady().then(() => {
      if (readToken() !== request.token) { onError(new Error('账号已切换，已停止放映')); return; }
      setOpen(true);
    }, onError);
  }, [allowed, error, ready, visible, folders.data, request.folderId, request.token, slides.length, onReady, onError]);
  useEffect(() => {
    if (!open) return;
    const timer = setTimeout(() => { if (!started.current) onError(new Error('放映未能启动，请稍后再试')); }, 15000);
    return () => clearTimeout(timer);
  }, [open, onError]);
  return open && allowed && slides.length >= 2 ? <PicLightbox open close={onClose} slides={slides} slideshow onSlideshowStart={() => {
    if (started.current) return;
    started.current = true;
    onStarted({ folderId: request.folderId, page, totalPages, count: slides.length, withheld: ids.length - slides.length });
  }} /> : null;
}
