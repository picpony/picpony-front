'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { MdDownload, MdOpenInNew, MdArrowBack } from 'react-icons/md';
import FadeInImage from '@/components/FadeInImage';
import { api, PonyImage } from '@/lib/api';

export default function PicPage() {
  const params = useParams();
  const router = useRouter();
  const id = params.id as string;

  const [image, setImage] = useState<PonyImage | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  
  const [isDescriptionExpanded, setIsDescriptionExpanded] = useState(false);
  const [cdnEnabled, setCdnEnabled] = useState(false);

  useEffect(() => {
    const checkCdn = () => {
      const storedCdn = localStorage.getItem('cdn_enabled');
      setCdnEnabled(storedCdn === 'true');
    };
    
    checkCdn();
    window.addEventListener('cdn_settings_updated', checkCdn);
    return () => window.removeEventListener('cdn_settings_updated', checkCdn);
  }, []);

  useEffect(() => {
    let isMounted = true;
    setIsLoading(true);
    
    if (id) {
      api.getImage(id)
        .then((res) => {
          if (isMounted) {
            setImage(res.image);
            setIsLoading(false);
          }
        })
        .catch((err) => {
          if (isMounted) {
            setError(err);
            setIsLoading(false);
          }
        });
    }

    return () => {
      isMounted = false;
    };
  }, [id]);

  if (isLoading) {
    return (
      <div className="max-w-7xl mx-auto px-4 py-8 animate-pulse flex flex-col md:flex-row gap-6">
        <div className="flex-1 bg-slate-200 rounded-xl h-[60vh]"></div>
        <div className="w-full md:w-96 bg-slate-200 rounded-xl h-[60vh]"></div>
      </div>
    );
  }

  if (error || !image) {
    return (
      <div className="max-w-7xl mx-auto px-4 py-16 text-center">
        <h2 className="text-2xl font-bold text-slate-800 mb-4">加载失败</h2>
        <p className="text-slate-600 mb-6">图片可能不存在</p>
        <button 
          onClick={() => router.back()}
          className="px-6 py-2 bg-primary text-white rounded-lg hover:bg-primary/90 transition-colors"
        >
          返回上一页
        </button>
      </div>
    );
  }

  const artists = image.tags
    .filter(tag => tag.startsWith('artist:'))
    .map(tag => tag.replace('artist:', ''));

  const ocs = image.tags
    .filter(tag => tag.startsWith('oc:'))
    .map(tag => tag.replace('oc:', ''));

  const getCdnUrl = (url: string) => {
    if (!cdnEnabled || !url) return url;
    return `https://wsrv.nl/?url=${encodeURIComponent(url)}`;
  };

  const handleDownload = async (e: React.MouseEvent) => {
    e.preventDefault();
    try {
      const response = await fetch(image.representations.full);
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      const fileName = image.representations.full.split('/').pop() || `image-${image.id}`;
      a.download = fileName;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
    } catch (error) {
      console.error('Download failed:', error);
      window.open(image.representations.full, '_blank');
    }
  };

  return (
    <div className="max-w-7xl mx-auto px-2 sm:px-4 py-4 sm:py-8 animate-fade-in">
      <div className="bg-white flex flex-col">
        
        <div className="p-4 sm:p-6 bg-white">
          <h1 className="text-2xl md:text-3xl font-bold text-slate-800 break-all text-center">
            {image.name || `Image #${image.id}`}
          </h1>
        </div>

        <div className="w-full flex items-center justify-center p-4 relative min-h-[40vh] md:min-h-[60vh]">
          {image.representations.full.endsWith('.webm') ? (
            <video
              src={getCdnUrl(image.representations.full)}
              controls
              autoPlay
              loop
              className="max-w-full max-h-[80vh] object-contain rounded-lg"
            />
          ) : (
            <FadeInImage
              src={getCdnUrl(image.representations.large || image.representations.full)}
              alt={image.name || `Image ${image.id}`}
              width={image.width}
              height={image.height}
              className="max-w-full max-h-[80vh] object-contain rounded-lg"
            />
          )}
        </div>

        <div className="p-4 sm:p-6 flex flex-col bg-white">
          <div className="max-w-5xl mx-auto w-full space-y-6">
            <div className="grid grid-cols-2 gap-4">
              <div className="bg-slate-50 p-3 rounded-xl border border-slate-100">
                <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1">尺寸</h3>
                <p className="text-slate-700 font-medium">{image.width} × {image.height} px</p>
              </div>
              
              <div className="bg-slate-50 p-3 rounded-xl border border-slate-100">
                <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1">大小</h3>
                <p className="text-slate-700 font-medium">{(image.size / 1024 / 1024).toFixed(2)} MB</p>
              </div>

              <div className="bg-slate-50 p-3 rounded-xl border border-slate-100">
                <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1">上传者</h3>
                <p className="text-slate-700 font-medium truncate" title={image.uploader || '匿名用户'}>
                  {image.uploader || '匿名用户'}
                </p>
              </div>

              <div className="bg-slate-50 p-3 rounded-xl border border-slate-100">
                <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1">评分</h3>
                <p className="text-slate-700 font-medium">{image.score}</p>
              </div>
            </div>

            <div>
              <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1">上传日期</h3>
              <p className="text-slate-700">
                {new Date(image.created_at).toLocaleString('zh-CN', {
                  year: 'numeric',
                  month: '2-digit',
                  day: '2-digit',
                  hour: '2-digit',
                  minute: '2-digit'
                })}
              </p>
            </div>

            {image.description && (
              <div>
                <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">简介</h3>
                {image.description.length > 100 || (image.description.match(/\n/g) || []).length >= 3 ? (
                  <div 
                    className="bg-slate-50 p-4 rounded-xl border border-slate-100 cursor-pointer hover:bg-slate-100 transition-colors"
                    onClick={() => setIsDescriptionExpanded(!isDescriptionExpanded)}
                  >
                    <p className={`text-slate-700 whitespace-pre-wrap break-words ${!isDescriptionExpanded ? 'line-clamp-3' : ''}`}>
                      {image.description}
                    </p>
                    <div className="text-sm text-primary mt-2 font-medium text-center">
                      {isDescriptionExpanded ? '折叠简介' : '展开简介'}
                    </div>
                  </div>
                ) : (
                  <p className="text-slate-700 whitespace-pre-wrap break-words bg-slate-50 p-4 rounded-xl border border-slate-100">
                    {image.description}
                  </p>
                )}
              </div>
            )}

            {artists.length > 0 && (
              <div>
                <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">艺术家</h3>
                <div className="flex flex-wrap gap-2">
                  {artists.map((artist, index) => (
                    <span 
                      key={index}
                      className="px-3 py-1.5 bg-blue-50 text-blue-600 text-sm font-medium rounded-lg border border-blue-100"
                    >
                      {artist}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {ocs.length > 0 && (
              <div>
                <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">图中包含的 OC</h3>
                <div className="flex flex-wrap gap-2">
                  {ocs.map((oc, index) => (
                    <span 
                      key={index}
                      className="px-3 py-1.5 bg-purple-50 text-purple-600 text-sm font-medium rounded-lg border border-purple-100"
                    >
                      {oc}
                    </span>
                  ))}
                </div>
              </div>
            )}

            <div>
              <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">标签</h3>
              <div className="flex flex-wrap gap-2">
                {image.tags.map((tag: string, index: number) => (
                  <span 
                    key={index}
                    className="px-2.5 py-1 bg-slate-100 text-slate-600 text-sm rounded-lg hover:bg-slate-200 transition-colors cursor-pointer"
                  >
                    {tag}
                  </span>
                ))}
              </div>
            </div>

            <div className="pt-6 flex flex-col sm:flex-row gap-3">
              <button 
                onClick={handleDownload}
                className="flex items-center justify-center flex-1 px-4 py-3 bg-primary text-white rounded-xl hover:bg-primary/90 transition-all font-medium shadow-sm hover:shadow-md"
              >
                <MdDownload size={22} className="mr-2" />
                <span>下载原图</span>
              </button>
              <a 
                href={`https://trixiebooru.org/${image.id}`}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center justify-center flex-1 px-4 py-3 bg-slate-100 text-slate-700 rounded-xl hover:bg-slate-200 transition-colors font-medium border border-slate-200"
              >
                <MdOpenInNew size={20} className="mr-2" />
                <span>在 Derpibooru 查看</span>
              </a>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
