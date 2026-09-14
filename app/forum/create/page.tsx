'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
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
import Button, { buttonClasses } from '@/components/Button';
import DropZone from '@/components/DropZone';
import IconButton from '@/components/IconButton';
import Chip from '@/components/Chip';
import { ICON } from '@/lib/icons';
const RichTextEditor = dynamic(() => import('@/components/RichTextEditor'), { ssr: false });
import PageHeader from '@/components/PageHeader';
import { readToken, readUserInfo, useSession } from '@/lib/hooks';
import { processImageFile } from '@/lib/utils';

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
  const submitting = useRef(false);
  const coverRead = useRef(0);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => { alive.current = false; coverRead.current += 1; };
  }, []);
  const { token, ready } = useSession();
  const isLoggedIn = Boolean(token);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (ready && !isLoggedIn) {
      openAuth('login');
    }
  }, [ready, isLoggedIn, openAuth]);

  const handleCoverFile = useCallback(async (file: File) => {
    const request = ++coverRead.current;
    try {
      const preview = await processImageFile(file, 5);
      if (!alive.current || request !== coverRead.current) return;
      setSelectedCoverFile(file);
      setCoverPreview(preview);
    } catch (err) {
      if (!alive.current || request !== coverRead.current) return;
      showToast(err instanceof Error ? err.message : '请选择有效的图片文件', 'error');
    }
  }, []);

  const removeCover = useCallback(() => {
    coverRead.current += 1;
    setCoverPreview(null);
    setSelectedCoverFile(null);
  }, []);

  const handleSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      if (submitting.current || !token || readToken() !== token) return;

      if (!title.trim()) {
        showToast('请输入标题', 'error');
        return;
      }
      if (!content.trim() && category !== 'commission') {
        showToast('请输入内容', 'error');
        return;
      }

      submitting.current = true;
      setIsSubmitting(true);
      setError(null);

      try {
        const user = readUserInfo();
        if (!user) throw new Error('未登录');

        let coverImagePath: string | undefined;
        if (selectedCoverFile) {
          const res = await api.uploadForumImage(user.token, selectedCoverFile);
          const data = await res.json();
          if (!alive.current || readToken() !== user.token) return;
          if (!res.ok || !data.success || !data.image_url) throw new Error(data.error || data.message || '封面上传失败，请重试');
          coverImagePath = data.image_url;
        }

        const res = await api.createForumPost(user.token, {
          title: title.trim(),
          content: content.trim(),
          cover_image: coverImagePath,
          category,
        });

        const data = await res.json();
        if (!alive.current || readToken() !== user.token) return;
        if (data.success) {
          const postId = Number(data.post_id);
          if (!Number.isSafeInteger(postId) || postId <= 0) throw new Error('服务器未返回有效帖子 ID，请检查帖子是否已发布');
          showToast('发帖成功', 'success');
          router.push(`/forum/${postId}`, { scroll: false });
        } else {
          setError(data.error || '发帖失败');
          showToast(data.error || '发帖失败', 'error');
        }
      } catch (err) {
        if (!alive.current || readToken() !== token) return;
        setError(err instanceof Error ? err.message : '网络错误，请稍后再试');
        showToast('发帖失败，请稍后重试', 'error');
      } finally {
        submitting.current = false;
        setIsSubmitting(false);
      }
    },
    [title, content, category, selectedCoverFile, router, token],
  );
  if (!isLoggedIn) return null;
  return (
    <div className="max-w-4xl mx-auto">
      {' '}
      <div className="mb-6">
        {' '}
        <Link
          scroll={false}
          href="/forum"
          className="flex items-center text-on-surface-variant hover:text-on-surface transition-ui"
        >
          
          <MdArrowBack size={ICON.control} className="mr-1" /> <span>返回论坛</span>
        </Link>
      </div>
      <PageHeader title="发布新帖" />
      <form onSubmit={handleSubmit} className="space-y-6">
        {' '}
        <div>
          {' '}
          <p className="block text-label-l text-on-surface mb-2"> 分类 </p>
          <div className="flex gap-3">
            
            {/* Single-select over a small set: M3 filter chips (`Chip variant="filter"`),
                which bring the leading check on selection, the container/on-container tone
                pair and the ripple. Hand-rolled, "which category am I in" was carried by a
                full `bg-primary` fill that outweighed the field label above it. */}
            {categories.map((cat) => (
              <Chip
                key={cat.value}
                variant="filter"
                selected={category === cat.value}
                onClick={() => setCategory(cat.value)}
              >
                {cat.label}
              </Chip>
            ))}
          </div>
        </div>
        <div>
          <Input
            id="title"
            label="标题"
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="输入帖子标题…"
            maxLength={100}
          />
        </div>
        <div>
          <p className="block text-label-l text-on-surface mb-2">封面图片（可选）</p>
          {coverPreview ? (
            <div className="relative inline-block">
              <FadeInImage
                src={coverPreview}
                alt="封面预览"
                width={192}
                height={128}
                className="object-cover rounded-md border border-outline-variant"
              />
              {/* `IconButton` gives the 32dp box, the state layer and the focus ring;
                  `touch-target` was standing in for a box the primitive already provides,
                  and cannot be combined with `data-ripple` anyway — that clips the
                  pseudo-element out of hit-testing. */}
              <IconButton
                size="sm"
                variant="filled"
                onClick={removeCover}
                aria-label="移除封面"

                className="bg-error-fill text-on-fill absolute -top-3 -right-3"
                icon={<MdClose size={ICON.dense} />}
              />
            </div>
          ) : (
            /* A real dropzone now, not a click-only button wearing a dashed border —
               and it stops emitting two radii: `rounded-md` sat beside the recipe's own
               `rounded-full`, and `px-4 py-3` beside its `h-10 px-5`. */
            <DropZone
              size="sm"
              accept="image/*"
              onFile={handleCoverFile}
              aria-label="选择或拖拽封面图片"
              className="flex-row gap-2"
            >
              <MdImage size={ICON.control} />
              <span className="text-body-m">选择或拖拽封面图片</span>
            </DropZone>
          )}
        </div>
        <div>
          <p className="block text-label-l text-on-surface mb-2">内容</p>
          <RichTextEditor value={content} onChange={setContent} placeholder="写下你的帖子内容…" />
        </div>
        {error && (
          <div className="bg-error-container text-on-error-container rounded-md p-4 text-body-m">
            {error}
          </div>
        )}
        <div className="flex justify-end gap-3 pt-4 border-t border-outline-variant">
          {/* A `<Link>` wearing the recipe, not the component: a `<button>` may not be
              nested in an `<a>`, which is the case `buttonClasses` exists for. Hand-writing
              the padding made the cancel link and the submit button 44px and 40px tall in
              the same footer row. */}
          <Link scroll={false} href="/forum" className={buttonClasses({ variant: 'text' })}>
            取消
          </Link>
          <Button variant="filled" type="submit" disabled={isSubmitting || !title.trim()}>
            {isSubmitting ? (
              <>
                <Spinner size="sm" tone="on-primary" />
                发布中…
              </>
            ) : (
              <>
                <MdSend size={ICON.dense} />
                发布帖子
              </>
            )}
          </Button>
        </div>
      </form>
    </div>
  );
}
