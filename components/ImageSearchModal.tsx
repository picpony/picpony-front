'use client';

import { useState, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { MdClose, MdCloudUpload } from 'react-icons/md';
import { useRouter } from 'next/navigation';
import Slider from '@mui/material/Slider';
import { showToast } from './Toast';
import { api } from '../lib/api';

import { PonyImage } from '../lib/api';

interface ImageSearchModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSearchSuccess?: (results: PonyImage[]) => void;
}

export default function ImageSearchModal({ isOpen, onClose, onSearchSuccess }: ImageSearchModalProps) {
  const [isClosing, setIsClosing] = useState(false);
  const [selectedImage, setSelectedImage] = useState<string | null>(null);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [distance, setDistance] = useState<number>(0.10);
  const [isUploading, setIsUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const router = useRouter();

  useEffect(() => {
    if (isOpen) {
      setIsClosing(false);
      setSelectedImage(null);
      setSelectedFile(null);
      setDistance(0.10);
    }
  }, [isOpen]);

  const handleClose = () => {
    setIsClosing(true);
    setTimeout(() => {
      onClose();
      setIsClosing(false);
    }, 200);
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith('image/')) {
      showToast('请选择有效的图片文件', 'error');
      return;
    }

    if (file.size > 5 * 1024 * 1024) {
      showToast('图片大小不能超过 5MB', 'error');
      return;
    }

    setSelectedFile(file);
    const reader = new FileReader();
    reader.onloadend = () => {
      setSelectedImage(reader.result as string);
    };
    reader.readAsDataURL(file);
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    
    const file = e.dataTransfer.files?.[0];
    if (!file) return;

    if (!file.type.startsWith('image/')) {
      showToast('请选择有效的图片文件', 'error');
      return;
    }

    setSelectedFile(file);
    const reader = new FileReader();
    reader.onloadend = () => {
      setSelectedImage(reader.result as string);
    };
    reader.readAsDataURL(file);
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
        handleClose();
      } else if (data && data.searchQuery) {
        router.push(`/?search=${encodeURIComponent(data.searchQuery)}`);
        handleClose();
      } else {
        console.log('Search results:', data);
        showToast('未能找到相似图片', 'info');
        handleClose();
      }
    } catch (err) {
      showToast(err instanceof Error ? err.message : '错误', 'error');
    } finally {
      setIsUploading(false);
    }
  };

  if (!isOpen && !isClosing) return null;

  return createPortal(
    <div 
      className={`fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/50 ${isClosing ? 'animate-modal-overlay-out' : 'animate-modal-overlay'}`}
      onClick={handleClose}
    >
      <div 
        className={`bg-white dark:bg-slate-800 rounded-xl shadow-xl w-full max-w-md overflow-hidden ${isClosing ? 'animate-modal-content-out' : 'animate-modal-content'}`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex justify-between items-center p-6 pb-2">
          <h3 className="text-lg font-semibold text-slate-800 dark:text-slate-100 flex items-center">
            以图搜图
          </h3>
          <button 
            onClick={handleClose}
            className="text-slate-400 hover:text-slate-600 transition-colors"
          >
            <MdClose size={24} />
          </button>
        </div>
        
        <div className="p-6 pt-4">
          <div 
            className={`border-2 border-dashed rounded-xl p-6 flex flex-col items-center justify-center text-center cursor-pointer transition-colors mb-6 ${
              selectedImage ? 'border-primary/50 bg-primary/5' : 'border-slate-300 dark:border-slate-600 hover:border-primary hover:bg-slate-50 dark:hover:bg-slate-700'
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
                <img 
                  src={selectedImage} 
                  alt="Selected" 
                  className="max-w-full max-h-full object-contain rounded-xl shadow-sm"
                />
                <div className="absolute inset-0 bg-black/40 opacity-0 hover:opacity-100 transition-opacity flex items-center justify-center rounded-xl">
                  <span className="text-white font-medium">更换图片</span>
                </div>
              </div>
            ) : (
              <>
                <MdCloudUpload size={48} className="text-slate-400 dark:text-slate-500 mb-3" />
                <p className="text-slate-700 dark:text-slate-300 font-medium mb-1">点击或拖拽图片到此处</p>
              </>
            )}
          </div>

          <div className="mb-6 px-2">
            <div className="flex justify-between items-center mb-2">
              <label className="text-sm font-medium text-slate-700 dark:text-slate-300">容差</label>
              <span className="text-sm font-bold text-primary">{distance.toFixed(2)}</span>
            </div>
            <Slider
              value={distance}
              min={0.01}
              max={1.00}
              step={0.01}
              onChange={(_, newValue) => setDistance(newValue as number)}
              sx={{
                color: 'var(--color-primary)',
                '& .MuiSlider-thumb': {
                  '&:hover, &.Mui-focusVisible': {
                    boxShadow: '0px 0px 0px 8px rgba(var(--color-primary-rgb), 0.16)',
                  },
                  '&.Mui-active': {
                    boxShadow: '0px 0px 0px 14px rgba(var(--color-primary-rgb), 0.16)',
                  },
                },
              }}
            />
            <div className="flex justify-between text-xs text-slate-500 dark:text-slate-400 mt-1">
              <span>精确匹配</span>
              <span>模糊匹配</span>
            </div>
          </div>

          <div className="flex justify-end gap-3">
            <button
              type="button"
              onClick={handleClose}
              className="px-4 py-2 text-sm font-medium text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-lg transition-colors"
              disabled={isUploading}
            >
              取消
            </button>
            <button
              onClick={handleSubmit}
              disabled={!selectedFile || isUploading}
              className={`px-4 py-2 text-sm font-medium text-white rounded-lg transition-colors flex items-center ${
                !selectedFile || isUploading 
                  ? 'bg-primary/50 cursor-not-allowed' 
                  : 'bg-primary hover:bg-primary-dark'
              }`}
            >
              {isUploading ? (
                <>
                  <svg className="animate-spin -ml-1 mr-2 h-4 w-4 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                  </svg>
                  请稍后
                </>
              ) : (
                '开始搜索'
              )}
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
}
