'use client';

import { useState, useEffect } from 'react';
import { MdCloudUpload } from 'react-icons/md';
import { useRouter } from 'next/navigation';
import { showToast } from './Toast';
import { api } from '../lib/api';
import { processImageFile } from '../lib/utils';
import { PonyImage } from '../lib/api';
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
  const router = useRouter();

  useEffect(() => {
    if (isOpen) {
      queueMicrotask(() => {
        setSelectedImage(null);
        setSelectedFile(null);
        setDistance(0.1);
      });
    }
  }, [isOpen]);

  const handleFileSelect = async (file: File) => {
    try {
      const dataUrl = await processImageFile(file);
      setSelectedFile(file);
      setSelectedImage(dataUrl);
    } catch (err) {
      showToast(err instanceof Error ? err.message : '文件处理失败', 'error');
    }
  };




  const handleSubmit = async () => {
    if (!selectedFile) {
      showToast('请先选择一张图片', 'warning');
      return;
    }

    setIsUploading(true);

    try {
      const data = await api.searchImage(selectedFile, distance);

      if (data && data.images && data.total > 0) {
        if (onSearchSuccess) {
          onSearchSuccess(data.images);
        }
        showToast(`找到 ${data.total} 张相似图片`, 'success');
        onClose();
      } else if (data && data.searchQuery) {
        router.push(`/search?q=${encodeURIComponent(data.searchQuery)}`);
        onClose();
      } else {
        showToast('未能找到相似图片', 'info');
        onClose();
      }
    } catch (err) {
      showToast(err instanceof Error ? err.message : '以图搜图失败', 'error');
    } finally {
      setIsUploading(false);
    }
  };
  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="以图搜图"
      footer={
        <>
          <Button variant="text" type="button" onClick={onClose} disabled={isUploading}>
            取消
          </Button>
          <Button
            variant="filled"
            onClick={handleSubmit}
            disabled={!selectedFile}
            loading={isUploading}
          >
            开始搜索
          </Button>
        </>
      }
    >
      {/* This zone previously handled `dragover` only — enough to stop the
          browser navigating to the dropped file, but it gave no feedback at all
          while one was held over it, so the affordance its dashed border promised
          was invisible. `DropZone` owns the three states. */}
      <DropZone
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
              className="object-contain rounded-md"
            />
            <div className="bg-media-plate absolute inset-0 flex items-center justify-center rounded-md opacity-0 transition-opacity duration-300 ease-[var(--ease-standard)] hover:opacity-100">
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
          <span className="text-label-l-emphasized text-primary">{distance.toFixed(2)}</span>
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
