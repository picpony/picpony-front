'use client';

import { useState, useLayoutEffect, useRef } from 'react';
import { MdCloudUpload } from 'react-icons/md';
import { useRouter } from 'next/navigation';
import { showToast } from './Toast';
import { api, type PonyImage } from '../lib/api';
import { processImageFile } from '../lib/utils';
import FadeInImage from './FadeInImage';
import Modal from './Modal';
import Slider from './Slider';
import Button from '@/components/Button';
import DropZone from '@/components/DropZone';
import { ICON } from '@/lib/icons';

interface ImageSearchModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSearchSuccess?: (results: PonyImage[]) => void;
}

export default function ImageSearchModal({
  isOpen,
  onClose,
  onSearchSuccess,
}: ImageSearchModalProps) {
  const [selectedImage, setSelectedImage] = useState<string | null>(null);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [distance, setDistance] = useState<number>(0.1);
  const [isUploading, setIsUploading] = useState(false);
  const [isReading, setIsReading] = useState(false);
  const generation = useRef(0);
  const fileRead = useRef(0);
  const submitting = useRef(false);
  const active = useRef(false);
  const router = useRouter();

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
        setDistance(0.1);
        setIsUploading(false);
        setIsReading(false);
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
    setSelectedFile(null);
    setSelectedImage(null);
    try {
      const dataUrl = await processImageFile(file);
      if (!active.current || current !== generation.current || request !== fileRead.current) return;
      setSelectedFile(file);
      setSelectedImage(dataUrl);
    } catch (err) {
      if (active.current && current === generation.current && request === fileRead.current) {
        showToast(err instanceof Error ? err.message : '文件处理失败', 'error');
      }
    } finally {
      if (active.current && current === generation.current && request === fileRead.current) setIsReading(false);
    }
  };




  const handleSubmit = async () => {
    if (!active.current || submitting.current || isReading) return;
    if (!selectedFile) {
      showToast('请先选择一张图片', 'warning');
      return;
    }

    const current = generation.current;
    submitting.current = true;
    setIsUploading(true);

    try {
      const data = await api.searchImage(selectedFile, distance);
      if (!active.current || current !== generation.current) return;

      if (data && data.images && data.total > 0) {
        if (onSearchSuccess) {
          onSearchSuccess(data.images);
        }
        showToast(`找到 ${data.total} 张相似图片`, 'success');
        close();
      } else if (data && data.searchQuery) {
        router.push(`/search?q=${encodeURIComponent(data.searchQuery)}`, { scroll: false });
        close();
      } else {
        showToast('未能找到相似图片', 'info');
        close();
      }
    } catch (err) {
      if (active.current && current === generation.current) showToast(err instanceof Error ? err.message : '以图搜图失败', 'error');
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
          <Button
            variant="filled"
            onClick={handleSubmit}
            disabled={!selectedFile || isReading}
            loading={isUploading}
          >
            开始搜索
          </Button>
        </>
      }
    >
      {/* `DropZone` owns the three states; the zone previously gave no
          feedback at all while a file was held over it. */}
      <DropZone
        disabled={isUploading}
        accept="image/*"
        onFile={handleFileSelect}
        filled={Boolean(selectedImage)}
        aria-label="选择或拖拽要搜索的图片"
        className="mb-6"
      >

        {selectedImage ? (
          <div className="relative w-full h-48 flex items-center justify-center">
            <FadeInImage
              src={selectedImage}
              alt="已选择的图片"
              fill
              /* The default `Modal` is `max-w-xl` (576px) less its own padding. */
              sizes="(min-width: 640px) 544px, 100vw"
              className="object-contain rounded-md"
            />
            <div className="bg-media-plate absolute inset-0 flex items-center justify-center rounded-md opacity-0 transition-opacity duration-composite ease-[var(--ease-standard)] hover:opacity-100">
              <span className="text-on-media text-label-l">更换图片</span>
            </div>
          </div>
        ) : (
          <>
            <MdCloudUpload size={ICON.display} className="text-outline mb-3" />
            <p className="text-body-m-emphasized text-on-surface mb-1">点击或拖拽图片到此处</p>
          </>
        )}
      </DropZone>

      <div className="mb-2 px-2">
        <div className="flex justify-between items-center mb-2">
          <p className="text-label-l text-on-surface">容差</p>
          <span className="text-label-l-emphasized text-primary-ink">{distance.toFixed(2)}</span>
        </div>
        <Slider
          min={0.01}
          max={1.0}
          step={0.01}
          value={distance}
          onValueChange={setDistance}
          aria-label="搜索容差"
          valueText={(v) => `容差 ${v.toFixed(2)}`}
        />
        <div className="flex justify-between text-body-s text-on-surface-variant mt-1">
          <span>精确匹配</span>
          <span>模糊匹配</span>
        </div>
      </div>
    </Modal>
  );
}
