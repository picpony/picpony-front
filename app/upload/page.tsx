'use client';

import { useState, useCallback, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { showToast } from '@/components/Toast';
import { api } from '@/lib/api';
import { readToken, useSession } from '@/lib/hooks';
import { useAuthModal } from '@/components/AuthModal';
import { MdCloudUpload, MdClose, MdInfoOutline, MdOpenInNew } from 'react-icons/md';
import Button from '@/components/Button';
import Skeleton from '@/components/Skeleton';
import { Input, Textarea } from '@/components/Input';
import DropZone from '@/components/DropZone';
import IconButton from '@/components/IconButton';
import PageHeader from '@/components/PageHeader';
import EmptyState from '@/components/EmptyState';
import { useConfirm } from '@/components/ConfirmDialog';
import { ICON } from '@/lib/icons';

export default function UploadPage() {
  const { user, ready } = useSession();
  const router = useRouter();
  const { openAuth } = useAuthModal();
  const { confirm, confirmDialog } = useConfirm();

  const [file, setFile] = useState<File | null>(null);
  const [tags, setTags] = useState('');
  const [source, setSource] = useState('');
  const [description, setDescription] = useState('');
  const [isUploading, setIsUploading] = useState(false);
  const uploadPending = useRef(false);
  const [uploadResult, setUploadResult] = useState<{ id: number } | null>(null);

  const userApiKey = user
    ? ((user as Record<string, unknown>).api_key as string | undefined)
    : undefined;

  /* One object URL per file, revoked when it is replaced — the video branch used to
     mint a fresh URL, leaking the previous one, on every render. */
  const [filePreview, setFilePreview] = useState<{ file: File | null; url: string | null } | null>(null);
  const objectUrl = filePreview?.file === file ? filePreview.url : null;
  useEffect(() => {
    const url = file ? URL.createObjectURL(file) : null;
    let current = true;
    queueMicrotask(() => { if (current) setFilePreview({ file, url }); });
    return () => {
      current = false;
      if (url) URL.revokeObjectURL(url);
    };
  }, [file]);

  const isVideoFile = Boolean(file?.type.startsWith('video/'));
  const preview = !isVideoFile ? objectUrl : null;

  // ---- 文件选择 (hooks must stay above early returns) ----

  const handleFileSelect = useCallback((f: File) => {
    const maxSize = 50 * 1024 * 1024; // 50MB
    if (f.size > maxSize) {
      showToast('文件大小不能超过 50MB', 'error');
      return;
    }
    const validTypes = [
      'image/jpeg',
      'image/png',
      'image/gif',
      'image/webp',
      'video/webm',
      'video/mp4',
    ];
    if (!validTypes.includes(f.type)) {
      showToast('不支持的文件格式，请选择图片或 WebM/MP4 视频', 'error');
      return;
    }
    setFile(f);
    setUploadResult(null);
  }, []);

  const removeFile = () => {
    // No input to reset: `DropZone` clears its own `value` after each pick, which
    // is also what makes re-selecting the same file fire `change` again.
    setFile(null);
  };

  /** 清空整个表单（成功/已提交后复位，供继续发布） */
  const resetForm = () => {
    setFile(null);
    setTags('');
    setSource('');
    setDescription('');
    setUploadResult(null);
  };

  /** 记录每周上传任务进度，fire-and-forget（与完整版前端一致） */
  const recordWeekly = () => {
    if (!user?.token) return;
    void api.recordWeeklyUpload(user.token).catch(() => {});
  };

  // ---- 上传 ----

  const handleUpload = async () => {
    if (uploadPending.current || !file || !userApiKey || !user?.token) return;

    const trimmedTags = tags.trim();
    if (!trimmedTags) {
      showToast('标签不能为空，至少填写一个标签（如 safe）', 'error');
      return;
    }

    uploadPending.current = true;
    try {
      /* The one place in the app where a user affirms a legal condition — through
         the app's own confirm dialog. Lock before awaiting it, so a second
         activation cannot enqueue another confirmation or another upload. */
      const agreed = await confirm({
        title: '确认发布',
        message:
          '请遵守 Derpibooru 上传准则：\n' +
          '• 您必须拥有上传作品的版权或授权\n' +
          '• 请正确添加分级标签（safe / suggestive / questionable / explicit）\n' +
          '• 请勿上传重复图片',
        confirmLabel: '确认发布',
        tone: 'filled',
      });
      if (!agreed || readToken() !== user.token) return;

      setIsUploading(true);
      const res = await api.uploadImageToDerpi(
        file,
        trimmedTags,
        userApiKey,
        source.trim() || undefined,
        description.trim() || undefined,
      );
      if (readToken() !== user.token) return;

      if (res.ok) {
        const data = await res.json();
        if (readToken() !== user.token) return;
        const imageId = Number(data?.image?.id);
        if (Number.isSafeInteger(imageId) && imageId > 0) {
          setUploadResult({ id: imageId });
          showToast(`发布成功，图片 ID：${imageId}`, 'success');
          recordWeekly();
        } else {
          showToast('服务器未返回有效图片 ID，无法确认上传结果；文件和填写内容已保留', 'error');
        }
      } else {
        let errorMsg = `上传失败 (HTTP ${res.status})`;
        try {
          const errData = await res.json();
          if (errData?.errors?.image?.[0]) {
            errorMsg = errData.errors.image[0];
          } else if (errData?.error) {
            errorMsg = errData.error;
          } else if (res.status === 401 || res.status === 403) {
            errorMsg = 'API Key 无效或已过期，请在设置中重新配置';
          }
        } catch {
          /* ignore */
        }
        if (readToken() === user.token) showToast(errorMsg, 'error');
      }
    } catch {
      // A missing response proves neither acceptance nor rejection. Keep the
      // draft and record progress only after an acknowledged successful upload.
      if (readToken() === user.token) {
        showToast('未能确认上传结果，文件和填写内容已保留。请先检查 Derpibooru 是否已有此图片，再重试', 'error');
      }
    } finally {
      uploadPending.current = false;
      setIsUploading(false);
    }
  };

  // 未登录 → 引导
  if (!ready) return <div className="max-w-2xl mx-auto space-y-5"><PageHeader title="发布图片" /><Skeleton className="h-56 w-full" /><Skeleton className="h-14 w-full" /><Skeleton className="h-14 w-full" /></div>;
  if (!user || !user.token) {
    return (
      <EmptyState
        icon={<MdCloudUpload size={ICON.display} />}
        title="需要登录"
        description="请先登录后再发布图片"
        action={
          <Button onClick={() => openAuth('login')} variant="filled">
            前往登录
          </Button>
        }
      />
    );
  }

  if (!userApiKey) {
    return (
      <EmptyState
        icon={<MdInfoOutline size={ICON.display} className="text-warning" />}
        title="未配置 API Key"
        description="发布图片需要绑定 Derpibooru API Key，请先在设置中配置"
        action={
          <Button
            onClick={() => router.push('/settings', { scroll: false })}
            variant="filled"
            icon={<MdOpenInNew />}
          >
            前往设置
          </Button>
        }
      />
    );
  }

  // ---- 渲染 ----

  return (
    <div className="max-w-2xl mx-auto">
      <PageHeader title="发布图片" />

      {uploadResult ? (
        /* ──── 上传成功 ──── */
      /* The container tone is the separation; the 40% hairline it carried was an alpha
         on a text role doing nothing the fill was not already doing. The disc inside
         was the container colour on itself, so the tick floated with no disc behind it;
         `success-fill` gives it one that is the same green in both schemes. */
        <div className="bg-success-container text-on-success-container rounded-md p-8 text-center">
          <div className="bg-success-fill text-on-fill mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full">
            <svg
              className="size-9"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2.5}
                d="M5 13l4 4L19 7"
              />
            </svg>
          </div>
          <h2 className="text-title-l mb-2">发布成功</h2>
          <p className="text-body-m mb-6">
            图片 ID：<span className="text-body-m-emphasized font-mono">{uploadResult.id}</span>
          </p>
          <div className="flex items-center justify-center gap-3">
            <Button
              onClick={() => router.push(`/pic/${uploadResult.id}`, { scroll: false })}
              variant="filled"
              icon={<MdOpenInNew />}
            >
              查看图片
            </Button>
            <Button onClick={resetForm} variant="tonal">
              继续发布
            </Button>
          </div>
        </div>
      ) : (
        <>
          {/* ──── 拖拽/点击选区 ──── */}
          {/* The drag state used to add a 2% `scale` — an arbitrary value, and a
              transform on the container of the `<img>` preview inside it. The border,
              tone and elevation change already read as "let go here". */}
          <DropZone
            size="lg"
            disabled={isUploading}
            accept="image/*,video/webm,video/mp4"
            onFile={handleFileSelect}
            filled={Boolean(file)}
            aria-label="选择或拖拽要上传的图片或视频"
            className="mb-6"
          >

            {preview ? (
              /* A fade, not the floating-surface pop: pop's rise-plus-scale is right for
                 a popover appearing out of its anchor and wrong for a half-viewport image
                 in a drop zone — the scale made the preview visibly settle into its own
                 box, as if it had been dropped slightly off-target. */
              <div className="relative inline-block max-w-full animate-fade-in">
                {/* eslint-disable-next-line @next/next/no-img-element -- local blob preview */}
                <img
                  src={preview}
                  alt="预览"
                  className="max-h-[50vh] max-w-full rounded-md object-contain mx-auto"
                />
                {/* `IconButton` gives the box, the state layer, the ripple and the focus
                    ring. `touch-target` cannot be combined with a ripple anyway —
                    `data-ripple`'s `overflow: hidden` clips the hit-area pseudo-element
                    out of hit-testing — and it stacked the dismiss rotation *and* a hover
                    scale, where the app's one precedent for a rotating dismiss uses the
                    rotation alone. */}
                <IconButton
                  size="sm"
                  disabled={isUploading}
                  onClick={(e) => {
                    e.stopPropagation();
                    removeFile();
                  }}
                  aria-label="移除文件"

                  dismiss
                  variant="danger"
                  className="absolute -top-3 -right-3"
                  icon={<MdClose size={ICON.dense} />}
                />
                <p className="mt-2 text-body-s text-on-surface-variant">
                  {(file!.size / 1024 / 1024).toFixed(2)} MB — 点击更换
                </p>
              </div>
            ) : isVideoFile ? (
              <div className="py-8">
                <video
                  src={objectUrl ?? undefined}
                  className="max-h-[40vh] max-w-full rounded-md mx-auto"
                  controls
                />
                <Button
                  disabled={isUploading}
                  icon={<MdClose />}
                  variant="danger-text"
                  size="xs"
                  className="mt-3"
                  onClick={(e) => {
                    e.stopPropagation();
                    removeFile();
                  }}
                >
                  移除
                </Button>
                <p className="mt-1 text-body-s text-on-surface-variant">
                  {(file!.size / 1024 / 1024).toFixed(2)} MB
                </p>
              </div>
            ) : (
              <>
                <MdCloudUpload size={ICON.display} className="mx-auto mb-4 text-outline" />
                <p className="text-body-l-emphasized text-on-surface-variant mb-1">
                  点击选择或拖拽文件到此处
                </p>
                <p className="text-body-m text-on-surface-variant">
                  支持 PNG / JPG / GIF / WebP / WebM / MP4（最大 50MB）
                </p>
              </>
            )}
          </DropZone>

          {/* ──── 表单 ──── */}
          <form className="space-y-5" onSubmit={(event) => { event.preventDefault(); void handleUpload(); }}>
            <Input
              id="upload-f1"
              type="text"
              label="标签"
              required
              disabled={isUploading}
              value={tags}
              onChange={(e) => setTags(e.target.value)}
              placeholder="以逗号分隔，如 safe, pony, cute"
              helper="必填。请至少添加一个分级标签（safe / suggestive / questionable / explicit）"
            />

            <Input
              id="upload-f2"
              type="url"
              disabled={isUploading}
              label="来源链接"
              value={source}
              onChange={(e) => setSource(e.target.value)}
              placeholder="例如 https://derpibooru.org/…（选填）"
            />

            <Textarea
              id="upload-f3"
              label="作品描述"
              disabled={isUploading}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
              className="resize-none"
              placeholder="简单描述这张作品（选填）"
            />

            {/* 上传按钮 */}
            <Button
              type="submit"
              variant="filled"
              size="lg"
              fullWidth
              loading={isUploading}
              disabled={!file}
              icon={<MdCloudUpload />}
            >
              {isUploading ? '上传中…' : '确认发布'}
            </Button>
          </form>
        </>
      )}
      {confirmDialog}
    </div>
  );
}
