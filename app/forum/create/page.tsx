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
const RichTextEditor = dynamic(() => import('@/components/RichTextEditor'), { ssr: false });

const categories = [
  { value: 'discussion', label: '综合讨论' },
  { value: 'commission', label: '委托/约稿' },
];

export default function CreateForumPostPage() {
  const router = useRouter();
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
      router.push('/login');
    }
  }, [isLoggedIn, router]);

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

  const handleSubmit = useCallback(async (e: React.FormEvent) => {
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
        category
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
  }, [title, content, category, selectedCoverFile, router]);

  if (!isLoggedIn) return null;

  return (
    <div className="max-w-4xl mx-auto px-4 py-8 animate-fade-in">
      <div className="mb-6">
        <Link
          href="/forum"
          className="flex items-center text-slate-500 hover:text-slate-700 dark:hover:text-slate-300 transition-colors"
        >
          <MdArrowBack size={20} className="mr-1" />
          <span>返回论坛</span>
        </Link>
      </div>

      <h1 className="text-2xl font-bold text-slate-800 dark:text-slate-100 mb-8">发布新帖</h1>

      <form onSubmit={handleSubmit} className="space-y-6">
        <div>
          <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
            分类
          </label>
          <div className="flex gap-3">
            {categories.map((cat) => (
              <button
                key={cat.value}
                type="button"
                onClick={() => setCategory(cat.value)}
                className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                  category === cat.value
                    ? 'bg-primary text-white'
                    : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 hover:bg-slate-200 dark:hover:bg-slate-700'
                }`}
              >
                {cat.label}
              </button>
            ))}
          </div>
        </div>

        <div>
          <label htmlFor="title" className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
            标题
          </label>
          <input
            id="title"
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="输入帖子标题..."
            maxLength={100}
            className="w-full px-4 py-3 border border-slate-300 dark:border-slate-600 dark:bg-slate-700 dark:text-slate-200 rounded-xl focus:ring-2 focus:ring-primary/20 focus:border-primary outline-none text-base transition-all"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
            封面图片（可选）
          </label>
          {coverPreview ? (
            <div className="relative inline-block">
              <FadeInImage
                src={coverPreview}
                alt="封面预览"
                width={192}
                height={128}
                className="object-cover rounded-xl border border-slate-200 dark:border-slate-700"
              />
              <button
                type="button"
                onClick={removeCover}
                className="absolute -top-2 -right-2 p-1 bg-red-500 text-white rounded-full hover:bg-red-600 transition-colors"
              >
                <MdClose size={16} />
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="flex items-center gap-2 px-4 py-3 border-2 border-dashed border-slate-300 dark:border-slate-600 rounded-xl text-slate-500 dark:text-slate-400 hover:border-primary hover:text-primary transition-colors"
            >
              <MdImage size={20} />
              <span className="text-sm">选择封面图片</span>
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
          <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
            内容
          </label>
          <RichTextEditor
            value={content}
            onChange={setContent}
            placeholder="写下你的帖子内容..."
          />
        </div>

        {error && (
          <div className="p-4 bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-900/30 rounded-xl text-red-600 dark:text-red-400 text-sm">
            {error}
          </div>
        )}

        <div className="flex justify-end gap-3 pt-4 border-t border-slate-200 dark:border-slate-700">
          <Link
            href="/forum"
            className="px-6 py-2.5 text-sm font-medium text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg transition-colors"
          >
            取消
          </Link>
          <button
            type="submit"
            disabled={isSubmitting || !title.trim()}
            className="flex items-center gap-2 px-6 py-2.5 text-sm font-medium text-white bg-primary hover:bg-primary/90 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
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
