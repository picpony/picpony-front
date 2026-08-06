'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { MdArrowBack, MdSend, MdImage, MdClose } from 'react-icons/md';
import { showToast } from '@/components/Toast';
import Spinner from '@/components/Spinner';
import { api } from '@/lib/api';
import FadeInImage from '@/components/FadeInImage';
import dynamic from 'next/dynamic';
import { Input } from '@/components/Input';
import { useAuthModal } from '@/components/AuthModal';
const RichTextEditor = dynamic(() => import('@/components/RichTextEditor'), { ssr: false });

const categories = [
  { value: 'discussion', label: '综合讨论' },
  { value: 'commission', label: '委托/约稿' },
];

export default function CreateForumPostPage() {
  const router = useRouter();
  const { openAuth } = useAuthModal();
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [category, setCategory] = useState('discussion');
  const [coverPreview, setCoverPreview] = useState<string | null>(null);
  const [selectedCoverFile, setSelectedCoverFile] = useState<File | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isLoggedIn] = useState(() => {
    if (typeof window === 'undefined') return false;
    return !!localStorage.getItem('user_info');
  });
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isLoggedIn) {
      openAuth('login');
    }
  }, [isLoggedIn, openAuth]);

  const handleCoverSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith('image/')) {
      showToast('请选择图片文件', 'error');
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      showToast('图片大小不能超过 5MB', 'error');
      return;
    }

    setSelectedCoverFile(file);
    const reader = new FileReader();
    reader.onload = () => setCoverPreview(reader.result as string);
    reader.readAsDataURL(file);
  }, []);

  const removeCover = useCallback(() => {
    setCoverPreview(null);
    setSelectedCoverFile(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
  }, []);

  const handleSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();

      if (!title.trim()) {
        showToast('请输入标题', 'error');
        return;
      }
      if (!content.trim() && category !== 'commission') {
        showToast('请输入内容', 'error');
        return;
      }

      setIsSubmitting(true);
      setError(null);

      try {
        const storedUser = localStorage.getItem('user_info');
        if (!storedUser) throw new Error('未登录');
        const user = JSON.parse(storedUser);

        let coverImagePath: string | undefined;
        if (selectedCoverFile) {
          const res = await api.uploadForumImage(user.token, selectedCoverFile);
          const data = await res.json();
          if (data.success && data.image_url) {
            coverImagePath = data.image_url;
          }
        }

        const res = await api.createForumPost(user.token, {
          title: title.trim(),
          content: content.trim(),
          cover_image: coverImagePath,
          category,
        });

        const data = await res.json();

        if (data.success) {
          showToast('发帖成功', 'success');
          router.push(`/forum/${data.post_id}`);
        } else {
          setError(data.error || '发帖失败');
          showToast(data.error || '发帖失败', 'error');
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : '网络错误');
        showToast('发帖失败，请稍后重试', 'error');
      } finally {
        setIsSubmitting(false);
      }
    },
    [title, content, category, selectedCoverFile, router],
  );
  if (!isLoggedIn) return null;
  return (
    <div className="max-w-4xl mx-auto px-4 py-8 animate-fade-in">
      {' '}
      <div className="mb-6">
        {' '}
        <Link
          href="/forum"
          className="flex items-center text-on-surface-variant hover:text-on-surface transition-ui"
        >
          {' '}
          <MdArrowBack size={20} className="mr-1" /> <span>返回论坛</span>{' '}
        </Link>{' '}
      </div>{' '}
      <h1 className="text-headline-s text-on-surface mb-8">发布新帖</h1>{' '}
      <form onSubmit={handleSubmit} className="space-y-6">
        {' '}
        <div>
          {' '}
          <label className="block text-label-l text-on-surface mb-2"> 分类 </label>{' '}
          <div className="flex gap-3">
            {' '}
            {categories.map((cat) => (
              <button
                key={cat.value}
                type="button"
                onClick={() => setCategory(cat.value)}
                className={`px-4 py-2 rounded-full text-label-l transition-ui ${
                  category === cat.value
                    ? 'bg-primary text-on-primary'
                    : 'bg-surface-container-high text-on-surface-variant hover:bg-surface-container-highest '
                }`}
              >
                {cat.label}
              </button>
            ))}
          </div>
        </div>
        <div>
          <label htmlFor="title" className="block text-label-l text-on-surface mb-2">
            标题
          </label>
          <Input
            id="title"
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="输入帖子标题..."
            maxLength={100}
          />
        </div>
        <div>
          <label className="block text-label-l text-on-surface mb-2">封面图片（可选）</label>
          {coverPreview ? (
            <div className="relative inline-block">
              <FadeInImage
                src={coverPreview}
                alt="封面预览"
                width={192}
                height={128}
                className="object-cover rounded-md border border-outline-variant"
              />
              <button
                type="button"
                onClick={removeCover}
                aria-label="移除封面"
                className="touch-target absolute -top-2 -right-2 p-1 bg-error-fill text-on-fill rounded-full hover:bg-error-fill/90 transition-ui"
              >
                <MdClose size={16} />
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="flex items-center gap-2 px-4 py-3 border-2 border-dashed border-outline rounded-md text-on-surface-variant hover:border-primary hover:text-primary transition-ui"
            >
              <MdImage size={20} />
              <span className="text-body-m">选择封面图片</span>
            </button>
          )}
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            onChange={handleCoverSelect}
            className="hidden"
          />
        </div>
        <div>
          <label className="block text-label-l text-on-surface mb-2">内容</label>
          <RichTextEditor value={content} onChange={setContent} placeholder="写下你的帖子内容..." />
        </div>
        {error && (
          <div className="p-4 bg-error-container border border-error/40 rounded-md text-error text-body-m">
            {error}
          </div>
        )}
        <div className="flex justify-end gap-3 pt-4 border-t border-outline-variant">
          <Link
            href="/forum"
            className="px-6 py-2.5 text-label-l text-on-surface-variant hover:bg-surface-container-high rounded-full transition-ui"
          >
            取消
          </Link>
          <button
            type="submit"
            disabled={isSubmitting || !title.trim()}
            className="flex items-center gap-2 px-6 py-2.5 text-label-l text-on-primary bg-primary hover:bg-primary/90 rounded-full transition-ui disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isSubmitting ? (
              <>
                <Spinner size="sm" white />
                发布中...
              </>
            ) : (
              <>
                <MdSend size={18} />
                发布帖子
              </>
            )}
          </button>
        </div>
      </form>
    </div>
  );
}
