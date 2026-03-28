'use client';

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { MdClose, MdDownload, MdOpenInNew } from 'react-icons/md';
import FadeInImage from './FadeInImage';
import { PonyImage } from '@/lib/api';

interface ImageModalProps {
  image: PonyImage | null;
  onClose: () => void;
}

export default function ImageModal({ image, onClose }: ImageModalProps) {
  const [render, setRender] = useState(false);
  const [isVisible, setIsVisible] = useState(false);
  const [displayImage, setDisplayImage] = useState<PonyImage | null>(null);
  const [isDescriptionExpanded, setIsDescriptionExpanded] = useState(false);

  useEffect(() => {
    let timer: NodeJS.Timeout;

    if (image) {
      setDisplayImage(image);
      setRender(true);
      setIsVisible(true);
      setIsDescriptionExpanded(false);
      
      document.body.style.overflow = 'hidden';
    } else {
      setIsVisible(false);
      timer = setTimeout(() => {
        setRender(false);
        setDisplayImage(null);
      }, 200);
      document.body.style.overflow = 'unset';
    }

    return () => {
      if (timer) clearTimeout(timer);
      document.body.style.overflow = 'unset';
    };
  }, [image]);

  if (!render || !displayImage) return null;

  const artists = displayImage.tags
    .filter(tag => tag.startsWith('artist:'))
    .map(tag => tag.replace('artist:', ''));

  const ocs = displayImage.tags
    .filter(tag => tag.startsWith('oc:'))
    .map(tag => tag.replace('oc:', ''));

  const modalContent = (
    <div 
      className={`fixed inset-0 z-[100] flex items-center justify-center p-0 sm:p-4 md:p-6 bg-black/50 ${isVisible ? 'animate-modal-overlay' : 'animate-modal-overlay-out'}`}
      onClick={onClose}
    >
      <div 
        className={`bg-white sm:rounded-xl overflow-hidden w-full h-full sm:h-auto sm:max-w-6xl sm:max-h-[90vh] flex flex-col md:flex-row shadow-2xl ${isVisible ? 'animate-modal-content' : 'animate-modal-content-out'}`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex-[1.5] md:flex-1 bg-black sm:bg-slate-100 flex items-center justify-center overflow-hidden relative min-h-[40vh] md:min-h-0">
          {displayImage.representations.full.endsWith('.webm') ? (
            <video
              src={displayImage.representations.full}
              controls
              autoPlay
              loop
              className="max-w-full max-h-full object-contain"
            />
          ) : (
            <FadeInImage
              src={displayImage.representations.large || displayImage.representations.full}
              alt={displayImage.name || `Image ${displayImage.id}`}
              width={displayImage.width}
              height={displayImage.height}
              className="max-w-full max-h-full object-contain"
            />
          )}
          <button 
            onClick={onClose}
            className="absolute top-2 right-2 sm:top-4 sm:right-4 p-2 bg-black/40 hover:bg-black/60 text-white rounded-full transition-colors md:hidden z-10"
          >
            <MdClose size={24} />
          </button>
        </div>

        <div className="flex-1 md:w-80 lg:w-96 p-4 sm:p-6 flex flex-col overflow-y-auto overflow-x-hidden bg-white">
          <div className="flex justify-between items-start mb-4 sm:mb-6">
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
            <div className="grid grid-cols-2 gap-3 sm:gap-4">
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
                <p className="text-slate-700 text-sm truncate" title={displayImage.uploader || '匿名用户'}>
                  {displayImage.uploader || '匿名用户'}
                </p>
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
                {displayImage.description.length > 100 || (displayImage.description.match(/\n/g) || []).length >= 3 ? (
                  <div 
                    className="bg-slate-50 p-3 rounded-lg border border-slate-100 cursor-pointer hover:bg-slate-100 transition-colors"
                    onClick={() => setIsDescriptionExpanded(!isDescriptionExpanded)}
                  >
                    <p className={`text-slate-700 text-sm whitespace-pre-wrap break-words ${!isDescriptionExpanded ? 'line-clamp-3' : ''}`}>
                      {displayImage.description}
                    </p>
                    <div className="text-xs text-primary mt-1.5 font-medium text-center">
                      {isDescriptionExpanded ? '折叠' : '展开'}
                    </div>
                  </div>
                ) : (
                  <p className="text-slate-700 text-sm whitespace-pre-wrap break-words bg-slate-50 p-3 rounded-lg border border-slate-100">
                    {displayImage.description}
                  </p>
                )}
              </div>
            )}

            {artists.length > 0 && (
              <div>
                <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1">艺术家</h3>
                <div className="flex flex-wrap gap-1.5">
                  {artists.map((artist, index) => (
                    <span 
                      key={index}
                      className="px-2 py-1 bg-blue-50 text-blue-600 text-xs font-medium rounded-md border border-blue-100"
                    >
                      {artist}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {ocs.length > 0 && (
              <div>
                <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1">图中包含的 OC</h3>
                <div className="flex flex-wrap gap-1.5">
                  {ocs.map((oc, index) => (
                    <span 
                      key={index}
                      className="px-2 py-1 bg-purple-50 text-purple-600 text-xs font-medium rounded-md border border-purple-100"
                    >
                      {oc}
                    </span>
                  ))}
                </div>
              </div>
            )}

            <div>
              <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1 mb-2">标签</h3>
              <div className="flex flex-wrap gap-1.5">
                {displayImage.tags.map((tag: string, index: number) => (
                  <span 
                    key={index}
                    className="px-2 py-1 bg-slate-100 text-slate-600 text-xs rounded-md hover:bg-slate-200 transition-colors cursor-pointer"
                  >
                    {tag}
                  </span>
                ))}
              </div>
            </div>

            <div className="pt-4 space-y-2 sm:space-y-3 mt-auto pb-4 sm:pb-0">
              <a 
                href={displayImage.representations.full}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center justify-center w-full px-4 py-2 sm:py-2.5 bg-primary text-white rounded-lg hover:bg-primary/90 transition-colors font-medium text-center text-sm sm:text-base"
              >
                <MdDownload size={20} className="mr-2 flex-shrink-0" />
                <span className="truncate">下载原图</span>
              </a>
              <a 
                href={`https://trixiebooru.org/${displayImage.id}`}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center justify-center w-full px-4 py-2 sm:py-2.5 bg-slate-100 text-slate-700 rounded-lg hover:bg-slate-200 transition-colors font-medium text-center text-sm sm:text-base"
              >
                <MdOpenInNew size={18} className="mr-2 flex-shrink-0 sm:w-5 sm:h-5" />
                <span className="truncate">在 Derpibooru 查看</span>
              </a>
            </div>
          </div>
        </div>
      </div>
    </div>
  );

  return typeof document !== 'undefined' ? createPortal(modalContent, document.body) : null;
}
