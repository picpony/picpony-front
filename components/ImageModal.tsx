'use client';

import { useEffect, useState } from 'react';
import { MdClose, MdDownload, MdOpenInNew } from 'react-icons/md';
import FadeInImage from './FadeInImage';
import { PonyImage } from '@/app/page';

interface ImageModalProps {
  image: PonyImage | null;
  onClose: () => void;
}

export default function ImageModal({ image, onClose }: ImageModalProps) {
  const [render, setRender] = useState(false);
  const [isVisible, setIsVisible] = useState(false);
  const [displayImage, setDisplayImage] = useState<PonyImage | null>(null);

  useEffect(() => {
    let timer: NodeJS.Timeout;
    let frameId: number;

    if (image) {
      setDisplayImage(image);
      setRender(true);
      
      frameId = requestAnimationFrame(() => {
        frameId = requestAnimationFrame(() => {
          setIsVisible(true);
        });
      });
      
      document.body.style.overflow = 'hidden';
    } else {
      setIsVisible(false);
      timer = setTimeout(() => {
        setRender(false);
        setDisplayImage(null);
      }, 300);
      document.body.style.overflow = 'unset';
    }

    return () => {
      if (timer) clearTimeout(timer);
      if (frameId) cancelAnimationFrame(frameId);
      document.body.style.overflow = 'unset';
    };
  }, [image]);

  if (!render || !displayImage) return null;

  return (
    <div 
      className={`fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6 transition-opacity duration-300 ease-in-out ${isVisible ? 'opacity-100' : 'opacity-0'}`}
      style={{ backgroundColor: 'rgba(0, 0, 0, 0.75)' }}
      onClick={onClose}
    >
      <div 
        className={`bg-white rounded-xl overflow-hidden w-full max-w-6xl max-h-[90vh] flex flex-col md:flex-row shadow-2xl transition-all duration-300 ease-in-out ${isVisible ? 'scale-100 translate-y-0' : 'scale-95 translate-y-4'}`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex-1 bg-slate-100 flex items-center justify-center overflow-hidden relative min-h-[300px] md:min-h-0">
          <FadeInImage
            src={displayImage.representations.large || displayImage.representations.full}
            alt={displayImage.name || `Image ${displayImage.id}`}
            width={displayImage.width}
            height={displayImage.height}
            className="max-w-full max-h-full object-contain"
          />
          <button 
            onClick={onClose}
            className="absolute top-4 right-4 p-2 bg-black/20 hover:bg-black/40 text-white rounded-full transition-colors md:hidden"
          >
            <MdClose size={24} />
          </button>
        </div>

        <div className="w-full md:w-80 lg:w-96 p-6 flex flex-col overflow-y-auto overflow-x-hidden bg-white">
          <div className="flex justify-between items-start mb-6">
            <h2 className="text-xl font-bold text-slate-800 break-all pr-8">
              {displayImage.name || `Image #${displayImage.id}`}
            </h2>
            <button 
              onClick={onClose}
              className="hidden md:block p-1 text-slate-400 hover:text-slate-600 transition-colors flex-shrink-0"
            >
              <MdClose size={28} />
            </button>
          </div>

          <div className="space-y-4 flex-1">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1">尺寸</h3>
                <p className="text-slate-700 text-sm">{displayImage.width} × {displayImage.height} px</p>
              </div>
              
              <div>
                <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1">大小</h3>
                <p className="text-slate-700 text-sm">{(displayImage.size / 1024 / 1024).toFixed(2)} MB</p>
              </div>

              <div>
                <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1">上传者</h3>
                <p className="text-slate-700 text-sm truncate" title={displayImage.uploader}>{displayImage.uploader}</p>
              </div>

              <div>
                <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1">评分</h3>
                <p className="text-slate-700 text-sm">{displayImage.score}</p>
              </div>
            </div>

            <div>
              <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1">上传日期</h3>
              <p className="text-slate-700 text-sm">
                {new Date(displayImage.created_at).toLocaleString('zh-CN', {
                  year: 'numeric',
                  month: '2-digit',
                  day: '2-digit',
                  hour: '2-digit',
                  minute: '2-digit'
                })}
              </p>
            </div>

            {displayImage.description && (
              <div>
                <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1">简介</h3>
                <p className="text-slate-700 text-sm whitespace-pre-wrap break-words bg-slate-50 p-3 rounded-lg border border-slate-100">
                  {displayImage.description}
                </p>
              </div>
            )}

            <div>
              <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1 mb-2">标签</h3>
              <div className="flex flex-wrap gap-1.5">
                {displayImage.tags.map((tag, index) => (
                  <span 
                    key={index}
                    className="px-2 py-1 bg-slate-100 text-slate-600 text-xs rounded-md hover:bg-slate-200 transition-colors cursor-pointer"
                  >
                    {tag}
                  </span>
                ))}
              </div>
            </div>

            <div className="pt-4 space-y-3 mt-auto">
              <a 
                href={displayImage.representations.full}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center justify-center w-full px-4 py-2.5 bg-primary text-white rounded-lg hover:bg-primary/90 transition-colors font-medium text-center"
              >
                <MdDownload size={20} className="mr-2 flex-shrink-0" />
                <span className="truncate">下载原图</span>
              </a>
              <a 
                href={`https://trixiebooru.org/${displayImage.id}`}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center justify-center w-full px-4 py-2.5 bg-slate-100 text-slate-700 rounded-lg hover:bg-slate-200 transition-colors font-medium text-center"
              >
                <MdOpenInNew size={20} className="mr-2 flex-shrink-0" />
                <span className="truncate">在 Derpibooru 查看</span>
              </a>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
