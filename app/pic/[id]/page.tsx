'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { MdDownload, MdOpenInNew, MdImage, MdSdStorage, MdPerson, MdStar, MdAccessTime, MdStarBorder, MdChatBubbleOutline, MdSend } from 'react-icons/md';
import FadeInImage from '@/components/FadeInImage';
import { api, PonyImage, Comment } from '@/lib/api';
import Tooltip from '@mui/material/Tooltip';
import BBCodeRenderer from '@/components/BBCodeRenderer';
import BBCodeEditor from '@/components/BBCodeEditor';
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
  bgcolor: 'var(--color-primary)',
  color: 'white',
  boxShadow: '0 1px 2px 0 rgb(0 0 0 / 0.05)',
  '&:hover': {
    bgcolor: '#555555',
    boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1), 0 2px 4px -2px rgb(0 0 0 / 0.1)',
  },
};

const viewBtnSx = {
  ...buttonBaseSx,
  bgcolor: 'var(--sidebar-hover)',
  color: 'var(--sidebar-text)',
  border: '1px solid',
  borderColor: 'rgba(128, 128, 128, 0.2)',
  boxShadow: 'none',
  '&:hover': {
    bgcolor: 'var(--sidebar-hover)',
    opacity: 0.8,
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
  const [newComment, setNewComment] = useState('');
  const [isSubmittingComment, setIsSubmittingComment] = useState(false);

  const fetchComments = async () => {
    try {
      const res = await api.getComments(id);
      if (res.success) {
        setComments(res.comments);
      }
    } catch (err) {
      console.error('Failed to load comments:', err);
    }
  };

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
      fetchComments().finally(() => {
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
    <div className="max-w-7xl mx-auto px-2 sm:px-4 py-4 sm:py-8 animate-pulse">
      <div className="flex flex-col">
          <div className="p-4 sm:p-6 bg-transparent">
            <div className="h-8 bg-slate-200 dark:bg-slate-700 rounded w-1/2 mb-4"></div>
            <div className="flex gap-4">
              <div className="h-5 bg-slate-200 dark:bg-slate-700 rounded w-20"></div>
              <div className="h-5 bg-slate-200 dark:bg-slate-700 rounded w-20"></div>
              <div className="h-5 bg-slate-200 dark:bg-slate-700 rounded w-20"></div>
            </div>
          </div>
          <div className="w-full flex items-center justify-center p-4 relative min-h-[40vh] md:min-h-[60vh]">
            <div className="w-full h-full bg-slate-200 dark:bg-slate-700 rounded-lg absolute inset-4"></div>
          </div>
          <div className="p-4 sm:p-6 flex flex-col bg-transparent">
            <div className="max-w-5xl mx-auto w-full space-y-6">
              <div className="h-4 bg-slate-200 dark:bg-slate-700 rounded w-full"></div>
              <div className="h-4 bg-slate-200 rounded w-full"></div>
              <div className="h-4 bg-slate-200 dark:bg-slate-700 rounded w-3/4"></div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (error || !image) {
    return (
      <div className="max-w-7xl mx-auto px-4 py-16 text-center">
        <h2 className="text-2xl font-bold text-slate-800 dark:text-slate-100 mb-4">加载失败</h2>
        <p className="text-slate-600 dark:text-slate-400 mb-6">图片可能不存在</p>
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

  const handlePostComment = async () => {
    if (!newComment.trim()) return;

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

    setIsSubmittingComment(true);
    try {
      const res = await api.postComment(token, Number(id), newComment);
      const data = await res.json();
      
      if (data.success) {
        showToast('评论发送成功', 'success');
        setNewComment('');
        await fetchComments();
      } else {
        showToast(data.message || '发送失败', 'error');
      }
    } catch (err) {
      console.error('Post comment error:', err);
      showToast('发送失败', 'error');
    } finally {
      setIsSubmittingComment(false);
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
      <div className="bg-transparent flex flex-col rounded-xl">
        
        <div className="p-4 sm:p-6 bg-transparent">
          <div className="flex items-start justify-between gap-4 mb-4">
            <h1 className="text-2xl md:text-3xl font-bold text-slate-800 dark:text-slate-100 break-all text-left">
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
          <div className="flex flex-wrap items-center gap-4 text-sm text-slate-600 dark:text-slate-300">
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

        <div className="p-4 sm:p-6 flex flex-col bg-transparent">
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
                <div className="w-full h-2.5 bg-slate-100 dark:bg-slate-800 rounded-full overflow-hidden flex">
                  {image.upvotes === 0 && image.downvotes === 0 ? (
                    <div className="bg-slate-300 dark:bg-slate-700 h-full w-full" />
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
                    className="bg-slate-50 dark:bg-slate-900/50 p-4 rounded-xl border border-slate-100 dark:border-slate-800 cursor-pointer hover:bg-slate-100 dark:hover:bg-slate-800/80 transition-colors"
                    onClick={() => setIsDescriptionExpanded(!isDescriptionExpanded)}
                  >
                    <p className={`text-slate-700 dark:text-slate-300 whitespace-pre-wrap break-words ${!isDescriptionExpanded ? 'line-clamp-3' : ''}`}>
                      {image.description}
                    </p>
                    <div className="text-sm text-primary mt-2 font-medium text-center">
                      {isDescriptionExpanded ? '折叠简介' : '展开简介'}
                    </div>
                  </div>
                ) : (
                  <p className="text-slate-700 dark:text-slate-300 whitespace-pre-wrap break-words bg-slate-50 dark:bg-slate-900/50 p-4 rounded-xl border border-slate-100 dark:border-slate-800">
                    {image.description}
                  </p>
                )
              ) : (
                <p className="text-slate-400 italic bg-slate-50 dark:bg-slate-900/50 p-4 rounded-xl border border-slate-100 dark:border-slate-800">滚木</p>
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
                      className="px-3 py-1.5 bg-blue-50 dark:bg-blue-900/20 text-blue-600 dark:text-blue-400 text-sm font-medium rounded-lg border border-blue-100 dark:border-blue-800/30"
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
                      className="px-3 py-1.5 bg-purple-50 dark:bg-purple-900/20 text-purple-600 dark:text-purple-400 text-sm font-medium rounded-lg border border-purple-100 dark:border-purple-800/30"
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
                    className="px-2.5 py-1 bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 text-sm rounded-lg hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors cursor-pointer"
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

            <div className="mt-8 pt-8 border-t border-slate-100 dark:border-slate-700">
              <h3 className="text-lg font-bold text-slate-800 dark:text-slate-100 mb-6 flex items-center gap-2">
                <MdChatBubbleOutline className="text-primary" size={24} />
                评论 ({comments.length})
              </h3>
              
              <div className="mb-8 flex gap-3">
                <div className="flex-1">
                  <BBCodeEditor
                    value={newComment}
                    onChange={setNewComment}
                    placeholder="写下你的评论..."
                    disabled={isSubmittingComment}
                  />
                  <div className="mt-2 flex justify-end">
                    <Button
                      onClick={handlePostComment}
                      disabled={isSubmittingComment || !newComment.trim()}
                      variant="contained"
                      sx={{
                        bgcolor: 'var(--color-primary, #063DA1)',
                        color: 'white',
                        borderRadius: '0.5rem',
                        textTransform: 'none',
                        px: 3,
                        py: 1,
                        boxShadow: 'none',
                        '&:hover': {
                          bgcolor: 'rgba(6, 61, 161, 0.9)',
                          boxShadow: '0 2px 4px rgb(0 0 0 / 0.1)',
                        },
                        '&.Mui-disabled': {
                          bgcolor: 'rgba(128, 128, 128, 0.12)',
                          color: 'rgba(128, 128, 128, 0.4)',
                        }
                      }}
                      endIcon={isSubmittingComment ? <CircularProgress size={16} color="inherit" /> : <MdSend size={18} />}
                    >
                      {isSubmittingComment ? '发送中...' : '发送评论'}
                    </Button>
                  </div>
                </div>
              </div>

              {isLoadingComments ? (
                <div className="flex justify-center py-8">
                  <CircularProgress size={32} />
                </div>
              ) : comments.length > 0 ? (
                <div className="space-y-4">
                  {comments.map((comment) => (
                    <div key={`${comment.source}-${comment.id}`} className="bg-slate-50 dark:bg-slate-900/50 rounded-xl p-4 flex gap-4">
                      <div className="flex-shrink-0">
                        {comment.avatar ? (
                          <FadeInImage 
                            src={comment.source === 'trixiebooru' ? comment.avatar : `https://picpony.top/${comment.avatar}`} 
                            alt={`${comment.username}`}
                            width={40}
                            height={40}
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
                          <div className="flex items-center gap-2">
                            <span className="font-semibold text-slate-800 text-sm">
                              {comment.username}
                            </span>
                            {comment.source === 'trixiebooru' && (
                              <span className="px-1.5 py-0.5 text-[10px] font-medium bg-blue-100 text-blue-700 rounded border border-blue-200">
                                Derpibooru
                              </span>
                            )}
                          </div>
                          <span className="text-xs text-slate-500">
                            {new Date(comment.created_at).toLocaleString('zh-CN', {
                              year: 'numeric',
                              month: '2-digit',
                              day: '2-digit',
                              hour: '2-digit',
                              minute: '2-digit'
                            })}
                          </span>
                        </div>
                        <div className="text-slate-600 text-sm whitespace-pre-wrap break-words">
                          <BBCodeRenderer content={comment.body} />
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-center py-8 text-slate-500 dark:text-slate-400 bg-slate-50 dark:bg-slate-800/50 rounded-xl border border-slate-100 dark:border-slate-700">
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
