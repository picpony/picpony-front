'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { MdDownload, MdOpenInNew, MdImage, MdSdStorage, MdPerson, MdStar, MdAccessTime, MdStarBorder, MdChatBubbleOutline, MdSend, MdShare, MdContentCopy, MdFlag, MdClose, MdFullscreen, MdChevronLeft, MdChevronRight, MdReply } from 'react-icons/md';
import Modal from '@/components/Modal';
import Zoom from 'yet-another-react-lightbox/plugins/zoom';
import Counter from 'yet-another-react-lightbox/plugins/counter';
import Fullscreen from 'yet-another-react-lightbox/plugins/fullscreen';
import Download from 'yet-another-react-lightbox/plugins/download';
import Video from 'yet-another-react-lightbox/plugins/video';
import FadeInImage from '@/components/FadeInImage';
import { api, PonyImage, Comment } from '@/lib/api';
import dynamic from 'next/dynamic';
const RichTextEditor = dynamic(() => import('@/components/RichTextEditor'), { ssr: false });
const Lightbox = dynamic(() => import('yet-another-react-lightbox'), { ssr: false });
import RichTextRenderer from '@/components/RichTextRenderer';
import { showToast } from '@/components/Toast';
import Spinner from '@/components/Spinner';

interface DictionaryEntry {
  id: number;
  en: string;
  cn: string;
  cat: string;
  count: number;
  description: string;
  aliases: string[];
}

export default function PicPage() {
  const params = useParams();
  const router = useRouter();
  const id = params.id as string;

  const [image, setImage] = useState<PonyImage | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  
  const [isDescriptionExpanded, setIsDescriptionExpanded] = useState(false);
  const [isFaved, setIsFaved] = useState(false);
  const [isFaveLoading, setIsFaveLoading] = useState(false);

  const [comments, setComments] = useState<Comment[]>([]);
  const [isLoadingComments, setIsLoadingComments] = useState(false);
  const [newComment, setNewComment] = useState('');
  const [isSubmittingComment, setIsSubmittingComment] = useState(false);
  const [isShareOpen, setIsShareOpen] = useState(false);
  const [isReportModalOpen, setIsReportModalOpen] = useState(false);
  const [reportReason, setReportReason] = useState('');
  const [isReporting, setIsReporting] = useState(false);

  // --- Lightbox state ---
  const [isLightboxOpen, setIsLightboxOpen] = useState(false);

  // --- Image navigation state ---
  const [navHistory, setNavHistory] = useState<number[]>([]);
  const [currentNavIndex, setCurrentNavIndex] = useState(-1);

  // --- Tag info modal state ---
  const [tagInfoModal, setTagInfoModal] = useState<{ open: boolean; tag: string; data: DictionaryEntry | null; loading: boolean }>({
    open: false, tag: '', data: null, loading: false
  });

  // --- Comment reply state ---
  const [replyTo, setReplyTo] = useState<{ id: number; username: string; body: string } | null>(null);

  const tokenRef = useRef<string | null>(null);

  // Load token once
  useEffect(() => {
    try {
      const userInfoStr = localStorage.getItem('user_info');
      if (userInfoStr) {
        const userInfo = JSON.parse(userInfoStr);
        tokenRef.current = userInfo.token || null;
      }
    } catch {}
  }, []);

  // Tag count map: tag name → image count
  const [tagCounts, setTagCounts] = useState<Record<string, number>>({});
  useEffect(() => {
    if (!image?.tags || image.tags.length === 0) return;
    const token = tokenRef.current;
    if (!token) return;
    const uniqueTags = [...new Set(image.tags)];
    let cancelled = false;
    (async () => {
      const results = await Promise.allSettled(
        uniqueTags.map(tag =>
          api.getDictionary(token, { keyword: tag, limit: 1 })
            .then(res => {
              if (res.success && res.tags?.length > 0) {
                const match = res.tags.find((t: DictionaryEntry) => t.en === tag);
                if (match) return { tag, count: match.count };
              }
              return { tag, count: undefined as number | undefined };
            })
        )
      );
      if (cancelled) return;
      const map: Record<string, number> = {};
      results.forEach(r => {
        if (r.status === 'fulfilled' && r.value.count !== undefined) {
          map[r.value.tag] = r.value.count;
        }
      });
      setTagCounts(map);
    })();
    return () => { cancelled = true; };
  }, [image]);

  // Dynamically import lightbox CSS
  useEffect(() => {
    import('yet-another-react-lightbox/styles.css');
  }, []);

  // Track navigation context from sessionStorage
  useEffect(() => {
    try {
      const stored = sessionStorage.getItem('picpony_nav_history');
      if (stored) {
        const ids: number[] = JSON.parse(stored);
        const currentIdNum = Number(id);
        const idx = ids.indexOf(currentIdNum);
        if (idx !== -1) {
          setNavHistory(ids);
          setCurrentNavIndex(idx);
        }
      }
    } catch {}
  }, [id]);

  // Save current image ID to navigation history
  useEffect(() => {
    if (image) {
      try {
        const stored = sessionStorage.getItem('picpony_nav_history');
        let ids: number[] = stored ? JSON.parse(stored) : [];
        const currentIdNum = image.id;
        if (!ids.includes(currentIdNum)) {
          ids.push(currentIdNum);
          if (ids.length > 200) ids = ids.slice(-200);
          sessionStorage.setItem('picpony_nav_history', JSON.stringify(ids));
        }
        const idx = ids.indexOf(currentIdNum);
        setCurrentNavIndex(idx);
        setNavHistory(ids);
      } catch {}
    }
  }, [image?.id]);

  // Keyboard shortcuts (for detail page only - YARL handles its own)
  useEffect(() => {
    if (isLightboxOpen) return;
    if (tagInfoModal.open) return;
    if (isReportModalOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (isShareOpen) setIsShareOpen(false);
        if (replyTo) setReplyTo(null);
        return;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isLightboxOpen, tagInfoModal.open, isReportModalOpen, isShareOpen, replyTo]);

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
    setIsLoadingComments(true);

    if (id) {
      Promise.all([
        api.getImage(id),
        fetchComments()
      ]).then(([imageRes, _]) => {
        if (isMounted) {
          setImage(imageRes.image);
          setIsLoading(false);
          setIsLoadingComments(false);
        }
      }).catch((err) => {
        if (isMounted) {
          setError(err);
          setIsLoading(false);
          setIsLoadingComments(false);
        }
      });
    }

    return () => {
      isMounted = false;
    };
  }, [id]);

  // --- Lightbox handlers ---
  const handleOpenLightbox = useCallback(() => {
    setIsLightboxOpen(true);
  }, []);

  const handleCloseLightbox = useCallback(() => {
    setIsLightboxOpen(false);
  }, []);

  // --- Navigation handlers ---
  const handleNavigate = useCallback((direction: number) => {
    const newIndex = currentNavIndex + direction;
    if (newIndex >= 0 && newIndex < navHistory.length) {
      const targetId = navHistory[newIndex];
      if (targetId !== Number(id)) {
        router.push(`/pic/${targetId}`);
      }
    } else {
      showToast(direction > 0 ? '已是最后一张' : '已是第一张', 'info');
    }
  }, [currentNavIndex, navHistory, id, router]);

  // --- Tag info modal ---
  const handleTagClick = async (tag: string) => {
    setTagInfoModal({ open: true, tag, data: null, loading: true });
    try {
      const token = tokenRef.current;
      if (token) {
        const res = await api.getDictionary(token, {
          keyword: tag,
          limit: 5
        });
        if (res.success && res.tags) {
          const match = res.tags.find((t: DictionaryEntry) => t.en.toLowerCase() === tag.toLowerCase());
          setTagInfoModal(prev => ({ ...prev, data: match || null, loading: false }));
        } else {
          setTagInfoModal(prev => ({ ...prev, data: null, loading: false }));
        }
      } else {
        setTagInfoModal(prev => ({ ...prev, data: null, loading: false }));
      }
    } catch {
      setTagInfoModal(prev => ({ ...prev, data: null, loading: false }));
    }
  };

  // --- Uploader profile ---
  const handleUploaderClick = () => {
    if (image?.uploader && image.uploader !== '匿名用户' && image.uploader_id) {
      router.push(`/derpi/user/${image.uploader_id}`);
    }
  };

  // --- Comment reply ---
  const handleReply = (comment: Comment) => {
    setReplyTo({ id: comment.id, username: comment.username, body: comment.body });
    window.scrollTo({ top: document.getElementById('comment-editor-area')?.offsetTop || 0, behavior: 'smooth' });
  };

  const handleCancelReply = () => {
    setReplyTo(null);
  };

  // --- Fave toggle ---
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

  // --- Post comment ---
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
      const replyPrefix = replyTo ? `@${replyTo.username} ` : '';
      const res = await api.postComment(token, Number(id), replyPrefix + newComment);
      const data = await res.json();
      
      if (data.success) {
        showToast('评论发送成功', 'success');
        setNewComment('');
        setReplyTo(null);
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

  // --- Download ---
  const handleDownload = async (e: React.MouseEvent) => {
    e.preventDefault();
    if (!image?.representations?.full && !image?.view_url) {
      showToast('无法下载：图片地址缺失', 'error');
      return;
    }
    const downloadUrl = image.representations?.full || image.view_url || '';
    try {
      const response = await fetch(downloadUrl);
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      const fileName = downloadUrl.split('/').pop() || `image-${image!.id}`;
      a.download = fileName;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
    } catch (error) {
      console.error('Download failed:', error);
      window.open(downloadUrl, '_blank');
    }
  };

  // --- Report ---
  const handleReport = async () => {
    if (!reportReason.trim()) {
      showToast('请填写举报原因', 'error');
      return;
    }
    let token = null;
    try {
      const userInfoStr = localStorage.getItem('user_info');
      if (userInfoStr) token = JSON.parse(userInfoStr).token;
    } catch {}
    if (!token) {
      showToast('请先登录', 'error');
      router.push('/login');
      return;
    }
    setIsReporting(true);
    try {
      const res = await api.reportImage(token, Number(id), reportReason);
      const data = await res.json();
      if (data.success) {
        showToast('举报已提交，感谢您的反馈', 'success');
        setIsReportModalOpen(false);
        setReportReason('');
      } else {
        showToast(data.message || '提交失败', 'error');
      }
    } catch {
      showToast('提交失败', 'error');
    } finally {
      setIsReporting(false);
    }
  };

  // --- Helpers ---
  const getImageFormat = (url: string): string => {
    const lower = url.toLowerCase();
    if (lower.endsWith('.webm')) return 'WEBM';
    if (lower.endsWith('.png')) return 'PNG';
    if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) return 'JPEG';
    if (lower.endsWith('.gif')) return 'GIF';
    if (lower.endsWith('.webp')) return 'WEBP';
    if (lower.endsWith('.svg')) return 'SVG';
    return '未知';
  };

  // Build YARL slides array
  const imageSrc = image?.representations?.full || image?.view_url || '';
  const yarlSlides = image && imageSrc
    ? (imageSrc.endsWith('.webm')
        ? [{
            type: 'video' as const,
            sources: [{ src: imageSrc, type: 'video/webm' }],
            autoPlay: true,
            controls: true,
            loop: true,
          }]
        : [{
            src: imageSrc,
            alt: image.name || `Image ${image.id}`,
            width: image.width ?? undefined,
            height: image.height ?? undefined,
            download: {
              url: imageSrc,
              filename: `image-${image.id}.${getImageFormat(imageSrc).toLowerCase()}`,
            },
          }])
    : [];

  const zoomPlugin = Zoom;
  const counterPlugin = Counter;
  const fullscreenPlugin = Fullscreen;
  const downloadPlugin = Download;
  const videoPlugin = Video;

  // --- Loading skeleton ---
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
        </div>
      </div>
    );
  }

  // --- Error state ---
  if (error || !image) {
    return (
      <div className="max-w-7xl mx-auto px-4 py-16 text-center">
        <h2 className="text-2xl font-bold text-slate-800 dark:text-slate-100 mb-4">加载失败</h2>
        <p className="text-slate-600 dark:text-slate-400 mb-6">图片可能不存在或已被删除</p>
        <div className="flex gap-4 justify-center">
          <button 
            onClick={() => router.back()}
            className="px-6 py-2 bg-primary text-white rounded-lg hover:bg-primary/90 transition-colors"
          >
            返回上一页
          </button>
          {navHistory.length > 0 && currentNavIndex > 0 && (
            <button
              onClick={() => handleNavigate(-1)}
              className="px-6 py-2 bg-slate-200 dark:bg-slate-700 text-slate-700 dark:text-slate-300 rounded-lg hover:bg-slate-300 dark:hover:bg-slate-600 transition-colors"
            >
              上一张
            </button>
          )}
        </div>
      </div>
    );
  }

  const tags = image.tags ?? [];

  const artists = tags
    .filter(tag => tag.startsWith('artist:'))
    .map(tag => tag.replace('artist:', ''));

  const ocs = tags
    .filter(tag => tag.startsWith('oc:'))
    .map(tag => tag.replace('oc:', ''));

  const regularTags = tags
    .filter(tag => !tag.startsWith('artist:') && !tag.startsWith('oc:'))
    .filter(tag => !tag.startsWith('spoiler:') && !tag.startsWith('suggestion:'));

  const imageFormat = getImageFormat(image.representations?.full || image.view_url || '');

  return (
    <div className="max-w-7xl mx-auto px-2 sm:px-4 py-4 sm:py-8 animate-fade-in">
      <div className="bg-transparent flex flex-col rounded-xl">
        
        {/* === Title & Meta === */}
        <div className="p-4 sm:p-6 bg-transparent">
          <div className="flex items-start justify-between gap-4 mb-4">
            <h1 className="text-2xl md:text-3xl font-bold text-slate-800 dark:text-slate-100 break-all text-left">
              {image.name || `Image #${image.id}`}
            </h1>
          </div>
          <div className="flex flex-wrap items-center gap-4 text-sm text-slate-600 dark:text-slate-300">
            <div title="尺寸" className="flex items-center gap-1.5 cursor-pointer">
                <MdImage size={18} className="text-slate-400" />
                <span>{image.width} × {image.height} px</span>
              </div>
            <div title="大小" className="flex items-center gap-1.5 cursor-pointer">
                <MdSdStorage size={18} className="text-slate-400" />
                <span>{(image.size / 1024 / 1024).toFixed(2)} MB</span>
              </div>
            <div title="格式" className="flex items-center gap-1.5 cursor-pointer">
                <span className="px-1.5 py-0.5 text-xs font-medium bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400 rounded border border-slate-200 dark:border-slate-700">
                  {imageFormat}
                </span>
              </div>
            <div 
              title="上传者" 
              className="flex items-center gap-1.5 cursor-pointer hover:text-primary transition-colors relative"
              onClick={handleUploaderClick}
            >
                <MdPerson size={18} className="text-slate-400" />
                <span className="truncate max-w-[150px] underline decoration-dotted underline-offset-2">{image.uploader || '匿名用户'}</span>
              </div>
            <div title="评分" className="flex items-center gap-1.5 cursor-pointer">
                <MdStar size={18} className="text-slate-400" />
                <span>{image.score}</span>
              </div>
            <div title="上传日期" className="flex items-center gap-1.5 cursor-pointer">
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
          </div>
        </div>

        {/* === Image Display (clickable to open lightbox) === */}
        <div className="w-full flex items-center justify-center p-4 relative min-h-[40vh] md:min-h-[60vh]">
          {(image.representations?.full || image.view_url || '').endsWith('.webm') ? (
            <video
              src={image.representations?.full || image.view_url || ''}
              controls
              autoPlay
              loop
              className="max-w-full max-h-[80vh] object-contain rounded-lg cursor-pointer"
              onClick={() => handleOpenLightbox()}
            />
          ) : (
            <div className="relative group cursor-pointer" onClick={() => handleOpenLightbox()}>
              <FadeInImage
                src={image.representations?.large || image.representations?.full || image.view_url || ''}
                alt={image.name || `Image ${image.id}`}
                width={image.width}
                height={image.height}
                className="max-w-full max-h-[80vh] object-contain rounded-lg"
              />
              <div className="absolute inset-0 bg-black/0 group-hover:bg-black/10 transition-colors rounded-lg flex items-center justify-center">
                <MdFullscreen size={32} className="text-white/0 group-hover:text-white/70 transition-all" />
              </div>
            </div>
          )}
        </div>

        {/* === Detail Info === */}
        <div className="p-4 sm:p-6 flex flex-col bg-transparent">
          <div className="max-w-5xl mx-auto w-full space-y-6">
            
            {/* Votes */}
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

            {/* Action buttons */}
            <div className="flex items-center justify-center gap-3 mb-2">
              {/* Navigation */}
              {navHistory.length > 0 && (
                <>
                  <button
                    onClick={() => handleNavigate(-1)}
                    disabled={currentNavIndex <= 0}
                    title="上一张 (←)"
                    className="p-2.5 rounded-full transition-colors duration-200 text-slate-500 hover:text-slate-700 hover:bg-slate-100 dark:text-slate-400 dark:hover:text-slate-300 dark:hover:bg-slate-700 disabled:opacity-30 disabled:cursor-not-allowed"
                  >
                    <MdChevronLeft size={20} />
                  </button>
                  <button
                    onClick={() => handleNavigate(1)}
                    disabled={currentNavIndex >= navHistory.length - 1}
                    title="下一张 (→)"
                    className="p-2.5 rounded-full transition-colors duration-200 text-slate-500 hover:text-slate-700 hover:bg-slate-100 dark:text-slate-400 dark:hover:text-slate-300 dark:hover:bg-slate-700 disabled:opacity-30 disabled:cursor-not-allowed"
                  >
                    <MdChevronRight size={20} />
                  </button>
                </>
              )}

              <div className="w-px h-6 bg-slate-200 dark:bg-slate-700" />

              <button
                onClick={handleToggleFave}
                disabled={isFaveLoading}
                title={isFaved ? '取消收藏' : '收藏'}
                className={`p-2.5 rounded-full transition-colors duration-200 ${
                  isFaved
                    ? 'text-yellow-600 border border-yellow-300 bg-yellow-50 hover:bg-yellow-100 dark:text-yellow-400 dark:border-yellow-700 dark:bg-yellow-900/20 dark:hover:bg-yellow-900/30'
                    : 'text-slate-500 hover:text-slate-700 hover:bg-slate-100 dark:text-slate-400 dark:hover:text-slate-300 dark:hover:bg-slate-700'
                } disabled:opacity-50`}
              >
                {isFaveLoading ? (
                  <Spinner size="sm" />
                ) : isFaved ? (
                  <MdStar size={20} />
                ) : (
                  <MdStarBorder size={20} />
                )}
              </button>
              <div className="relative">
                <button
                  onClick={() => setIsShareOpen(!isShareOpen)}
                  title="分享"
                  className="p-2.5 rounded-full transition-colors duration-200 text-slate-500 hover:text-slate-700 hover:bg-slate-100 dark:text-slate-400 dark:hover:text-slate-300 dark:hover:bg-slate-700"
                >
                  <MdShare size={20} />
                </button>
                {isShareOpen && (
                  <>
                    <div className="fixed inset-0 z-10" onClick={() => setIsShareOpen(false)} />
                    <div className="absolute left-1/2 -translate-x-1/2 top-full mt-1 w-40 bg-white dark:bg-slate-800 rounded-lg shadow-lg border border-slate-200 dark:border-slate-700 py-1 z-20 animate-fade-in">
                      <button
                        onClick={() => {
                          navigator.clipboard.writeText(window.location.href);
                          showToast('链接已复制', 'success');
                          setIsShareOpen(false);
                        }}
                        className="flex items-center gap-2 w-full px-3 py-2 text-sm text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700/50 transition-colors"
                      >
                        <MdContentCopy size={16} />
                        复制链接
                      </button>
                    </div>
                  </>
                )}
              </div>
              <button
                onClick={() => setIsReportModalOpen(true)}
                title="举报"
                className="p-2.5 rounded-full transition-colors duration-200 text-red-400 hover:text-red-500 hover:bg-red-50 dark:text-red-400 dark:hover:text-red-300 dark:hover:bg-red-950/30"
              >
                <MdFlag size={20} />
              </button>
            </div>

            {/* Description */}
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

            {/* Source URL */}
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

            {/* Artists */}
            {artists.length > 0 && (
              <div>
                <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">艺术家</h3>
                <div className="flex flex-wrap gap-2">
                  {artists.map((artist, index) => (
                    <span 
                      key={index}
                      onClick={() => router.push(`/search?q=${encodeURIComponent(`artist:${artist}`)}`)}
                      className="px-3 py-1.5 bg-blue-50 dark:bg-blue-900/20 text-blue-600 dark:text-blue-400 text-sm font-medium rounded-lg border border-blue-100 dark:border-blue-800/30 cursor-pointer hover:bg-blue-100 dark:hover:bg-blue-900/30 transition-colors"
                    >
                      {artist}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {/* OCs */}
            {ocs.length > 0 && (
              <div>
                <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">图中包含的 OC</h3>
                <div className="flex flex-wrap gap-2">
                  {ocs.map((oc, index) => (
                    <span 
                      key={index}
                      onClick={() => router.push(`/search?q=${encodeURIComponent(`oc:${oc}`)}`)}
                      className="px-3 py-1.5 bg-purple-50 dark:bg-purple-900/20 text-purple-600 dark:text-purple-400 text-sm font-medium rounded-lg border border-purple-100 dark:border-purple-800/30 cursor-pointer hover:bg-purple-100 dark:hover:bg-purple-900/30 transition-colors"
                    >
                      {oc}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {/* Tags */}
            <div>
              <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">标签 (Tag)</h3>
              <div className="flex flex-wrap gap-2">
                {regularTags.map((tag: string, index: number) => (
                  <span 
                    key={index}
                    onClick={() => handleTagClick(tag)}
                    className="px-2.5 py-1 bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 text-sm rounded-lg hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors cursor-pointer border border-transparent hover:border-primary/30 max-w-full truncate"
                    title="点击查看词库信息"
                  >
                    {tag}
                  {tagCounts[tag] !== undefined && (
                    <span className="ml-1 text-[10px] text-slate-400 dark:text-slate-500 font-normal">
                      {tagCounts[tag].toLocaleString()}
                    </span>
                  )}
                  </span>
                ))}
              </div>
            </div>

            {/* Action buttons */}
            <div className="pt-6 flex flex-col sm:flex-row gap-3">
              <button
                onClick={handleDownload}
                className="flex-1 px-2 py-1.5 rounded-xl font-medium text-base leading-relaxed bg-primary text-white shadow-sm hover:bg-[#555555] hover:shadow-md transition-all flex items-center justify-center gap-2"
              >
                <MdDownload size={22} />
                下载原图
              </button>
              <a
                href={`https://trixiebooru.org/${image.id}`}
                target="_blank"
                rel="noopener noreferrer"
                className="flex-1 px-2 py-1.5 rounded-xl font-medium text-base leading-relaxed bg-[var(--sidebar-hover)] text-[var(--sidebar-text)] border border-gray-500/20 hover:opacity-80 transition-all flex items-center justify-center gap-2"
              >
                <MdOpenInNew size={20} />
                在 Derpibooru 查看
              </a>
            </div>

            {/* === Comments Section === */}
            <div className="mt-8 pt-8 border-t border-slate-100 dark:border-slate-700">
              <h3 className="text-lg font-bold text-slate-800 dark:text-slate-100 mb-6 flex items-center gap-2">
                <MdChatBubbleOutline className="text-primary" size={24} />
                评论 ({comments.length})
              </h3>
              
              {/* Comment editor */}
              <div className="mb-8 flex gap-3" id="comment-editor-area">
                <div className="flex-1">
                  {/* Reply indicator */}
                  {replyTo && (
                    <div className="mb-2 flex items-center gap-2 text-sm text-slate-500 dark:text-slate-400 bg-slate-50 dark:bg-slate-900/50 px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700">
                      <MdReply size={14} />
                      <span>回复 <strong className="text-primary">{replyTo.username}</strong>：</span>
                      <span className="truncate flex-1 text-xs opacity-70">{replyTo.body.slice(0, 80)}{replyTo.body.length > 80 ? '...' : ''}</span>
                      <button
                        onClick={handleCancelReply}
                        className="text-red-400 hover:text-red-600 ml-auto"
                      >
                        <MdClose size={16} />
                      </button>
                    </div>
                  )}
                  <RichTextEditor
                    value={newComment}
                    onChange={setNewComment}
                    placeholder={replyTo ? `回复 @${replyTo.username}...` : "写下你的评论..."}
                    disabled={isSubmittingComment}
                  />
                  <div className="mt-2 flex justify-end">
                    <button
                      onClick={handlePostComment}
                      disabled={isSubmittingComment || !newComment.trim()}
                      className="px-3 py-1 rounded-lg text-sm font-medium bg-primary text-white shadow-none hover:bg-primary/90 hover:shadow-sm transition-all disabled:bg-gray-500/10 disabled:text-gray-500/40 flex items-center gap-1.5"
                    >
                      {isSubmittingComment ? (
                        <>
                          <Spinner size="sm" />
                          发送中...
                        </>
                      ) : (
                        <>
                          {replyTo ? '发送回复' : '发送评论'}
                          <MdSend size={18} />
                        </>
                      )}
                    </button>
                  </div>
                </div>
              </div>

              {/* Comments list */}
              {isLoadingComments ? (
                <div className="flex justify-center py-8">
                  <Spinner size="lg" />
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
                            className="w-10 h-10 rounded-full object-cover border border-slate-200 dark:border-slate-600"
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
                            <span className="font-semibold text-slate-800 dark:text-slate-200 text-sm">
                              {comment.username}
                            </span>
                            {comment.source === 'trixiebooru' && (
                              <span className="px-1.5 py-0.5 text-[10px] font-medium bg-blue-100 text-blue-700 rounded border border-blue-200">
                                Derpibooru
                              </span>
                            )}
                          </div>
                          <div className="flex items-center gap-2">
                            <button
                              onClick={() => handleReply(comment)}
                              title="回复"
                              className="text-slate-400 hover:text-primary transition-colors p-1 rounded"
                            >
                              <MdReply size={14} />
                            </button>
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
                        </div>
                        <div className="text-slate-600 dark:text-slate-300 text-sm whitespace-pre-wrap break-words">
                          <RichTextRenderer content={comment.body} />
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

      {/* ========== YARL Fullscreen Lightbox (replaces custom lightbox) ========== */}
      <Lightbox
        open={isLightboxOpen}
        close={handleCloseLightbox}
        slides={yarlSlides}
        plugins={[zoomPlugin, counterPlugin, fullscreenPlugin, downloadPlugin, videoPlugin]}
        zoom={{
          maxZoomPixelRatio: 3,
          scrollToZoom: true,
        }}
        counter={{ separator: ' / ' }}
        labels={{
          'Close': '关闭 (Esc)',
          'Download': '下载',
          'Zoom in': '放大',
          'Zoom out': '缩小',
          'Enter Fullscreen': '全屏',
          'Exit Fullscreen': '退出全屏',
        }}
        carousel={{
          finite: true,
        }}
        download={{
          download: ({ slide, saveAs }) => {
            const s = slide as unknown as Record<string, unknown>;
            const dl = s.download;
            if (dl && typeof dl === 'object' && 'url' in dl) {
              saveAs((dl as { url: string; filename?: string }).url, (dl as { url: string; filename?: string }).filename);
            } else if (typeof s.src === 'string') {
              saveAs(s.src);
            }
          }
        }}
      />

      {/* ========== Tag Info Modal ========== */}
      <Modal
        isOpen={tagInfoModal.open}
        onClose={() => setTagInfoModal({ open: false, tag: '', data: null, loading: false })}
        title={tagInfoModal.tag}
        maxWidth="max-w-md"
        zIndex={9998}
      >
        {tagInfoModal.loading ? (
          <Spinner label="查询词库中..." className="py-8" />
        ) : tagInfoModal.data ? (
          <div className="space-y-3">
            {tagInfoModal.data.cn && (
              <div>
                <span className="text-xs text-slate-400 uppercase tracking-wider">中文翻译</span>
                <p className="text-slate-700 dark:text-slate-300 mt-1 font-medium">{tagInfoModal.data.cn}</p>
              </div>
            )}
            {tagInfoModal.data.description && (
              <div>
                <span className="text-xs text-slate-400 uppercase tracking-wider">标签简介</span>
                <p className="text-slate-600 dark:text-slate-400 mt-1 text-sm">{tagInfoModal.data.description}</p>
              </div>
            )}
            {tagInfoModal.data.cat && (
              <div>
                <span className="text-xs text-slate-400 uppercase tracking-wider">分类</span>
                <p className="text-slate-600 dark:text-slate-400 mt-1 text-sm">{tagInfoModal.data.cat}</p>
              </div>
            )}
            {tagInfoModal.data.aliases && tagInfoModal.data.aliases.length > 0 && (
              <div>
                <span className="text-xs text-slate-400 uppercase tracking-wider">别名</span>
                <div className="flex flex-wrap gap-1.5 mt-1">
                  {tagInfoModal.data.aliases.map((alias, i) => (
                    <span key={i} className="px-2 py-0.5 bg-slate-100 dark:bg-slate-700 text-slate-500 dark:text-slate-400 text-xs rounded">{alias}</span>
                  ))}
                </div>
              </div>
            )}
          </div>
        ) : (
          <div className="text-center py-6 text-slate-500 dark:text-slate-400">
            <p>词库中暂无此标签的详细信息</p>
            <p className="text-xs mt-2">登录后可以查询更多标签信息</p>
          </div>
        )}
        <div className="flex gap-3 mt-4">
          <button
            onClick={() => { router.push(`/search?q=${encodeURIComponent(tagInfoModal.tag)}`); setTagInfoModal(prev => ({ ...prev, open: false })); }}
            className="flex-1 px-3 py-2 text-sm bg-primary/10 text-primary rounded-lg hover:bg-primary/20 transition-colors"
          >
            搜索此标签
          </button>
        </div>
      </Modal>

      {/* ========== Report Modal ========== */}
      <Modal
        isOpen={isReportModalOpen}
        onClose={() => { if (!isReporting) { setIsReportModalOpen(false); setReportReason(''); } }}
        title="举报图片"
        zIndex={100}
        closeOnOverlayClick={!isReporting}
        footer={
          <>
            <button onClick={() => { setIsReportModalOpen(false); setReportReason(''); }} disabled={isReporting}
              className="px-4 py-2 text-sm text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-lg">取消</button>
            <button onClick={handleReport} disabled={isReporting || !reportReason.trim()}
              className="px-4 py-2 text-sm text-white bg-red-500 hover:bg-red-600 rounded-lg disabled:opacity-50">
              {isReporting ? '提交中...' : '提交举报'}
            </button>
          </>
        }
      >
        <p className="text-sm text-slate-500 dark:text-slate-400 mb-4">
          请描述违规原因，管理员将会审核处理。
        </p>
        <textarea
          value={reportReason}
          onChange={(e) => setReportReason(e.target.value)}
          placeholder="请详细描述违规原因..."
          rows={4}
          disabled={isReporting}
          className="w-full px-4 py-3 border border-slate-300 dark:border-slate-600 dark:bg-slate-700 dark:text-slate-200 rounded-xl focus:ring-2 focus:ring-primary/20 focus:border-primary outline-none resize-none text-sm"
        />
      </Modal>
    </div>
  );
}
