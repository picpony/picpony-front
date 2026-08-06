'use client';

import { useState, useRef, useEffect } from 'react';
import { MdCloudUpload } from 'react-icons/md';
import { useRouter } from 'next/navigation';
import { showToast } from './Toast';
import { api } from '../lib/api';
import { processImageFile } from '../lib/utils';
import { PonyImage } from '../lib/api';
import FadeInImage from './FadeInImage';
import Modal from './Modal';
import Button from '@/components/Button';

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
  const fileInputRef = useRef<HTMLInputElement>(null);
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

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) handleFileSelect(file);
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const file = e.dataTransfer.files?.[0];
    if (file) handleFileSelect(file);
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
      showToast(err instanceof Error ? err.message : '错误', 'error');
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
          {' '}
          <Button variant="text" type="button" onClick={onClose} disabled={isUploading}>
            {' '}
            取消{' '}
          </Button>{' '}
          <button
            onClick={handleSubmit}
            disabled={!selectedFile || isUploading}
            className={`px-4 py-2 text-label-l text-on-primary rounded-full transition-ui flex items-center ${
              !selectedFile || isUploading
                ? 'bg-primary/50 cursor-not-allowed'
                : 'bg-primary hover:bg-primary/90'
            }`}
          >
            {isUploading ? '请稍后' : '开始搜索'}
          </button>
        </>
      }
    >
      <div
        className={`border-2 border-dashed rounded-md p-6 flex flex-col items-center justify-center text-center cursor-pointer transition-ui mb-6 ${
          selectedImage
            ? 'border-primary/50 bg-primary/5'
            : 'border-outline hover:border-primary hover:bg-surface-container-high'
        }`}
        onClick={() => fileInputRef.current?.click()}
        onDragOver={handleDragOver}
        onDrop={handleDrop}
      >
        <input
          type="file"
          ref={fileInputRef}
          onChange={handleFileChange}
          accept="image/*"
          className="hidden"
        />

        {selectedImage ? (
          <div className="relative w-full h-48 flex items-center justify-center">
            <FadeInImage
              src={selectedImage}
              alt="Selected"
              fill
              className="object-contain rounded-md shadow-e1"
            />
            <div className="absolute inset-0 bg-scrim/40 opacity-0 hover:opacity-100 transition-opacity flex items-center justify-center rounded-md">
              <span className="text-on-media font-medium">更换图片</span>
            </div>
          </div>
        ) : (
          <>
            <MdCloudUpload size={48} className="text-outline mb-3" />
            <p className="text-on-surface font-medium mb-1">点击或拖拽图片到此处</p>
          </>
        )}
      </div>

      <div className="mb-2 px-2">
        <div className="flex justify-between items-center mb-2">
          <label className="text-label-l text-on-surface">容差</label>
          <span className="text-label-l-emphasized text-primary">{distance.toFixed(2)}</span>
        </div>
        <input
          type="range"
          min={0.01}
          max={1.0}
          step={0.01}
          value={distance}
          onChange={(e) => setDistance(parseFloat(e.target.value))}
          className="range-slider w-full"
        />
        <div className="flex justify-between text-body-s text-on-surface-variant mt-1">
          <span>精确匹配</span>
          <span>模糊匹配</span>
        </div>
      </div>
    </Modal>
  );
}
