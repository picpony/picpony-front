'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { MdDownload, MdOpenInNew, MdArrowBack, MdImage, MdSdStorage, MdPerson, MdStar, MdAccessTime, MdStarBorder, MdChatBubbleOutline } from 'react-icons/md';
import FadeInImage from '@/components/FadeInImage';
import { api, PonyImage, Comment } from '@/lib/api';
import Tooltip from '@mui/material/Tooltip';
import Button from '@mui/material/Button';
import IconButton from '@mui/material/IconButton';
import CircularProgress from '@mui/material/CircularProgress';
import { showToast } from '@/components/Toast';

const buttonBaseSx = {
  flex: 1,
  px: 2,
  py: 1.5,
  borderRadius: '0.75rem',
  textTransform: 'none',
  fontWeight: 500,
  fontSize: '1rem',
  lineHeight: 1.5,
};

const downloadBtnSx = {
  ...buttonBaseSx,
  bgcolor: 'var(--color-primary, #063DA1)',
  color: 'white',
  boxShadow: '0 1px 2px 0 rgb(0 0 0 / 0.05)',
  '&:hover': {
    bgcolor: 'rgba(6, 61, 161, 0.9)',
    boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1), 0 2px 4px -2px rgb(0 0 0 / 0.1)',
  },
};

const viewBtnSx = {
  ...buttonBaseSx,
  bgcolor: '#f1f5f9',
  color: '#334155',
  border: '1px solid',
  borderColor: '#e2e8f0',
  boxShadow: 'none',
  '&:hover': {
    bgcolor: '#e2e8f0',
    borderColor: '#cbd5e1',
    boxShadow: 'none',
  },
};

export default function PicPage() {
  const params = useParams();
  const router = useRouter();
  const id = params.id as string;

  const [image, setImage] = useState<PonyImage | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  
  const [isDescriptionExpanded, setIsDescriptionExpanded] = useState(false);
  const [cdnEnabled, setCdnEnabled] = useState(false);
  const [isFaved, setIsFaved] = useState(false);
  const [isFaveLoading, setIsFaveLoading] = useState(false);

  const [comments, setComments] = useState<Comment[]>([]);
  const [isLoadingComments, setIsLoadingComments] = useState(false);

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
    const checkFaveStatus = async () => {
      try {
        const userInfoStr = localStorage.getItem('user_info');
        if (userInfoStr) {
          const userInfo = JSON.parse(userInfoStr);
          if (userInfo.token) {
            const res = await api.getFaves(userInfo.token);
            if (res.success && res.faves) {
              setIsFaved(res.faves.includes(Number(id)));
            }
          }
        }
      } catch (err) {
        console.error('Failed to get faves:', err);
      }
    };

    if (id) {
      checkFaveStatus();
    }
  }, [id]);

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

      setIsLoadingComments(true);
      api.getComments(id)
        .then((res) => {
          if (isMounted && res.success) {
            setComments(res.comments);
          }
        })
        .catch((err) => {
          console.error('Failed to load comments:', err);
        })
        .finally(() => {
          if (isMounted) {
            setIsLoadingComments(false);
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

  const handleToggleFave = async () => {
    let token = null;
    try {
      const userInfoStr = localStorage.getItem('user_info');
      if (userInfoStr) {
        token = JSON.parse(userInfoStr).token;
      }
    } catch (e) {
      console.error('Failed to parse user info', e);
    }

    if (!token) {
      showToast('请先登录', 'error');
      router.push('/login');
      return;
    }

    if (isFaveLoading || !image) return;

    setIsFaveLoading(true);
    try {
      const res = await api.toggleFave(token, image.id);
      const data = await res.json();
      
      if (data.success) {
        const newFavedStatus = data.is_faved !== undefined ? data.is_faved : !isFaved;
        setIsFaved(newFavedStatus);
        showToast(newFavedStatus ? '收藏成功' : '已取消收藏', 'success');
      } else {
        showToast(data.message || '操作失败', 'error');
      }
    } catch (err) {
      console.error('Toggle fave error:', err);
      showToast('操作失败', 'error');
    } finally {
      setIsFaveLoading(false);
    }
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
          <div className="flex items-start justify-between gap-4 mb-4">
            <h1 className="text-2xl md:text-3xl font-bold text-slate-800 break-all text-left">
              {image.name || `Image #${image.id}`}
            </h1>
            <Tooltip title={isFaved ? '取消收藏' : '收藏'} placement="top">
              <IconButton 
                onClick={handleToggleFave}
                disabled={isFaveLoading}
                sx={{ 
                  color: isFaved ? '#eab308' : '#94a3b8',
                  transition: 'color 0.2s',
                  '&:hover': {
                    color: isFaved ? '#ca8a04' : '#eab308',
                    backgroundColor: 'rgba(234, 179, 8, 0.08)'
                  }
                }}
              >
                {isFaveLoading ? (
                  <CircularProgress size={28} thickness={5} sx={{ color: 'inherit' }} />
                ) : isFaved ? (
                  <MdStar size={28} />
                ) : (
                  <MdStarBorder size={28} />
                )}
              </IconButton>
            </Tooltip>
          </div>
          <div className="flex flex-wrap items-center gap-4 text-sm text-slate-600">
            <Tooltip title="尺寸" placement="top" arrow>
              <div className="flex items-center gap-1.5 cursor-pointer">
                <MdImage size={18} className="text-slate-400" />
                <span>{image.width} × {image.height} px</span>
              </div>
            </Tooltip>
            <Tooltip title="大小" placement="top" arrow>
              <div className="flex items-center gap-1.5 cursor-pointer">
                <MdSdStorage size={18} className="text-slate-400" />
                <span>{(image.size / 1024 / 1024).toFixed(2)} MB</span>
              </div>
            </Tooltip>
            <Tooltip title="上传者" placement="top" arrow>
              <div className="flex items-center gap-1.5 cursor-pointer">
                <MdPerson size={18} className="text-slate-400" />
                <span className="truncate max-w-[150px]">{image.uploader || '匿名用户'}</span>
              </div>
            </Tooltip>
            <Tooltip title="评分" placement="top" arrow>
              <div className="flex items-center gap-1.5 cursor-pointer">
                <MdStar size={18} className="text-slate-400" />
                <span>{image.score}</span>
              </div>
            </Tooltip>
            <Tooltip title="上传日期" placement="top" arrow>
              <div className="flex items-center gap-1.5 cursor-pointer">
                <MdAccessTime size={18} className="text-slate-400" />
                <span>
                  {new Date(image.created_at).toLocaleString('zh-CN', {
                    year: 'numeric',
                    month: '2-digit',
                    day: '2-digit',
                    hour: '2-digit',
                    minute: '2-digit'
                  })}
                </span>
              </div>
            </Tooltip>
          </div>
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
            
            {image.upvotes !== undefined && image.downvotes !== undefined && (
              <div className="mb-6">
                <div className="flex justify-between text-sm font-medium mb-1.5">
                  <span className="text-green-600 flex items-center gap-1">
                    <MdStar size={16} /> {image.upvotes}
                  </span>
                  <span className="text-red-500 flex items-center gap-1">
                    {image.downvotes} <MdStar size={16} />
                  </span>
                </div>
                <div className="w-full h-2.5 bg-slate-100 rounded-full overflow-hidden flex">
                  {image.upvotes === 0 && image.downvotes === 0 ? (
                    <div className="bg-slate-300 h-full w-full" />
                  ) : (
                    <>
                      <div 
                        className="bg-green-500 h-full transition-all duration-500" 
                        style={{ width: `${(image.upvotes / (image.upvotes + image.downvotes)) * 100}%` }}
                      />
                      <div 
                        className="bg-red-500 h-full transition-all duration-500" 
                        style={{ width: `${(image.downvotes / (image.upvotes + image.downvotes)) * 100}%` }}
                      />
                    </>
                  )}
                </div>
              </div>
            )}

            <div>
              <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">简介</h3>
              {image.description ? (
                image.description.length > 100 || (image.description.match(/\n/g) || []).length >= 3 ? (
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
                )
              ) : (
                <p className="text-slate-400 italic bg-slate-50 p-4 rounded-xl border border-slate-100">滚木</p>
              )}
            </div>

            {image.source_url && (
              <div>
                <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">来源</h3>
                <a 
                  href={image.source_url} 
                  target="_blank" 
                  rel="noopener noreferrer"
                  className="inline-block text-blue-600 hover:text-blue-800 break-all"
                >
                  {image.source_url}
                </a>
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
              <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">标签 (Tag)</h3>
              <div className="flex flex-wrap gap-2">
                {image.tags.map((tag: string, index: number) => (
                  <span 
                    key={index}
                    onClick={() => router.push(`/?search=${encodeURIComponent(tag)}`)}
                    className="px-2.5 py-1 bg-slate-100 text-slate-600 text-sm rounded-lg hover:bg-slate-200 transition-colors cursor-pointer"
                  >
                    {tag}
                  </span>
                ))}
              </div>
            </div>

            <div className="pt-6 flex flex-col sm:flex-row gap-3">
              <Button 
                onClick={handleDownload}
                sx={downloadBtnSx}
                startIcon={<MdDownload size={22} />}
              >
                下载原图
              </Button>
              <Button 
                component="a"
                href={`https://trixiebooru.org/${image.id}`}
                target="_blank"
                rel="noopener noreferrer"
                sx={viewBtnSx}
                startIcon={<MdOpenInNew size={20} />}
              >
                在 Derpibooru 查看
              </Button>
            </div>

            <div className="mt-8 pt-8 border-t border-slate-100">
              <h3 className="text-lg font-bold text-slate-800 mb-6 flex items-center gap-2">
                <MdChatBubbleOutline className="text-primary" size={24} />
                评论 ({comments.length})
              </h3>
              
              {isLoadingComments ? (
                <div className="flex justify-center py-8">
                  <CircularProgress size={32} />
                </div>
              ) : comments.length > 0 ? (
                <div className="space-y-4">
                  {comments.map((comment) => (
                    <div key={comment.id} className="bg-slate-50 rounded-xl p-4 flex gap-4">
                      <div className="flex-shrink-0">
                        {comment.avatar ? (
                          <img 
                            src={`https://picpony.top/${comment.avatar}`} 
                            alt={`${comment.username}`}
                            className="w-10 h-10 rounded-full object-cover border border-slate-200"
                          />
                        ) : (
                          <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center text-primary font-bold border border-primary/20">
                            {comment.username.charAt(0).toUpperCase()}
                          </div>
                        )}
                      </div>
                      
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between mb-1">
                          <span className="font-semibold text-slate-800 text-sm">
                            {comment.username}
                          </span>
                          <span className="text-xs text-slate-500">
                            {comment.created_at}
                          </span>
                        </div>
                        <p className="text-slate-600 text-sm whitespace-pre-wrap break-words">
                          {comment.body}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-center py-8 text-slate-500 bg-slate-50 rounded-xl border border-slate-100">
                  滚木
                </div>
              )}
            </div>

          </div>
        </div>
      </div>
    </div>
  );
}
