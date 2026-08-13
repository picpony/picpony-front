'use client';

import { useState, useCallback, useMemo, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { showToast } from '@/components/Toast';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/hooks';
import { useAuthModal } from '@/components/AuthModal';
import { MdCloudUpload, MdClose, MdInfoOutline, MdOpenInNew } from 'react-icons/md';
import Button, { buttonClasses } from '@/components/Button';
import { Input, Textarea } from '@/components/Input';
import DropZone from '@/components/DropZone';
import IconButton from '@/components/IconButton';
import PageHeader from '@/components/PageHeader';
import EmptyState from '@/components/EmptyState';
import { useConfirm } from '@/components/ConfirmDialog';

export default function UploadPage() {
  const { getUserInfo } = useAuth();
  const user = getUserInfo();
  const router = useRouter();
  const { openAuth } = useAuthModal();
  const { confirm, confirmDialog } = useConfirm();

  const [file, setFile] = useState<File | null>(null);
  const [tags, setTags] = useState('');
  const [source, setSource] = useState('');
  const [description, setDescription] = useState('');
  const [isUploading, setIsUploading] = useState(false);
  const [uploadResult, setUploadResult] = useState<{ id: number } | null>(null);

  const userApiKey = user
    ? ((user as Record<string, unknown>).api_key as string | undefined)
    : undefined;

  /* One object URL per file, revoked when it is replaced. The video branch used
     to call `URL.createObjectURL(file)` inline in the JSX, which minted a fresh
     URL — and leaked the previous one — on every single render. */
  const objectUrl = useMemo(() => (file ? URL.createObjectURL(file) : null), [file]);
  useEffect(() => {
    if (!objectUrl) return;
    return () => URL.revokeObjectURL(objectUrl);
  }, [objectUrl]);

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
    if (!validTypes.includes(f.type) && !f.type.startsWith('image/')) {
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
    if (!file || !userApiKey) return;

    const trimmedTags = tags.trim();
    if (!trimmedTags) {
      showToast('标签不能为空，至少填写一个标签（如 safe）', 'error');
      return;
    }

    /* The one place in the app where a user affirms a legal condition, and it
       used to be the browser's own `confirm()` — a system box in the OS font,
       outside our scrim, our type scale and our focus trap. */
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
    if (!agreed) return;

    setIsUploading(true);
    try {
      const res = await api.uploadImageToDerpi(
        file,
        trimmedTags,
        userApiKey,
        source.trim() || undefined,
        description.trim() || undefined,
      );

      if (res.ok) {
        const data = await res.json();
        const imageId = data?.image?.id;
        if (imageId) {
          setUploadResult({ id: imageId });
          showToast(`发布成功！图片 ID: ${imageId}`, 'success');
        } else {
          showToast('上传成功，但未能获取图片 ID', 'success');
        }
        recordWeekly();
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
        showToast(errorMsg, 'error');
      }
    } catch (err) {
      /* Derpibooru 上传是异步落库的：源站可能已接收文件却在响应前断开，
         此时 fetch 抛 TypeError/Failed to fetch，作品实际上已提交。
         与完整版前端一致，按「已提交等待上架」处理而非报网络错误。 */
      const isNetworkFailure =
        err instanceof TypeError ||
        (err instanceof Error && err.message.includes('Failed to fetch'));
      if (isNetworkFailure) {
        showToast('作品已成功提交，请等待几分钟后即可上架（若内容不符合 Derpibooru 上传规则将不会上架）', 'success');
        recordWeekly();
        resetForm();
      } else {
        showToast('网络错误，请检查网络连接后重试', 'error');
      }
    } finally {
      setIsUploading(false);
    }
  };

  // 未登录 → 引导
  if (!user || !user.token) {
    return (
      <EmptyState
        icon={<MdCloudUpload size={48} />}
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
        icon={<MdInfoOutline size={48} className="text-warning" />}
        title="未配置 API Key"
        description="发布图片需要绑定 Derpibooru API Key，请先在设置中配置"
        action={
          <Button
            onClick={() => router.push('/settings')}
            variant="filled"
            icon={<MdOpenInNew size={18} />}
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
        /* The container tone is the separation; the `border-success` at 40% hairline
           it carried was an alpha on a text role and did nothing the fill was
           not already doing. The disc inside was `bg-success-container` on a
           `bg-success-container` card — the same colour on itself, so the tick
           floated with no disc behind it at all. `success-fill` gives it one
           that is the same green in both schemes, which is what the fill roles
           exist for. */
        <div className="bg-success-container text-on-success-container rounded-md p-8 text-center">
          <div className="bg-success-fill text-on-fill mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full">
            <svg
              className="w-8 h-8"
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
            图片 ID: <span className="text-body-m-emphasized font-mono">{uploadResult.id}</span>
          </p>
          <div className="flex items-center justify-center gap-3">
            <Button
              onClick={() => router.push(`/pic/${uploadResult.id}`)}
              variant="filled"
              icon={<MdOpenInNew size={18} />}
            >
              查看图片
            </Button>
            <button onClick={resetForm} className={buttonClasses({ variant: 'tonal' })}>
              继续发布
            </button>
          </div>
        </div>
      ) : (
        <>
          {/* ──── 拖拽/点击选区 ──── */}
          {/* The drag state used to add `scale-[1.02]` — an arbitrary value, and a
              transform on the container of the `<img>` preview inside it. The
              border, tone and elevation change already read as "let go here", and
              the two `/50` alphas on tokens are gone with it. */}
          <DropZone
            size="lg"
            accept="image/*,video/webm,video/mp4"
            onFile={handleFileSelect}
            filled={Boolean(file)}
            aria-label="选择或拖拽要上传的图片或视频"
            className="mb-6"
          >

            {preview ? (
              <div className="relative inline-block max-w-full animate-pop-in">
                {/* eslint-disable-next-line @next/next/no-img-element -- local blob preview */}
                <img
                  src={preview}
                  alt="Preview"
                  className="max-h-[50vh] max-w-full rounded-md object-contain mx-auto"
                />
                {/* `IconButton` gives the box, the state layer, the ripple and the
                    focus ring. What was here combined `touch-target` with a
                    hand-sized `w-8 h-8` box — and `touch-target` cannot be
                    combined with a ripple anyway, since `data-ripple`'s
                    `overflow: hidden` clips the hit-area pseudo-element out of
                    hit-testing. It also stacked `hover:rotate-90` *and*
                    `hover:scale-110`, where the app's one precedent for a
                    rotating dismiss (`Modal`'s close) uses the rotation alone. */}
                <IconButton
                  size="sm"
                  onClick={(e) => {
                    e.stopPropagation();
                    removeFile();
                  }}
                  aria-label="移除文件"
                  title="移除文件"
                  dismiss
                  className="bg-error-fill text-on-fill absolute -top-3 -right-3 shadow-e3"
                  icon={<MdClose size={16} />}
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
                  icon={<MdClose size={14} />}
                  variant="danger-text"
                  size="sm"
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
                <MdCloudUpload size={56} className="mx-auto mb-4 text-outline" />
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
          <div className="space-y-5">
            <Input
              id="upload-f1"
              type="text"
              label="标签"
              required
              value={tags}
              onChange={(e) => setTags(e.target.value)}
              placeholder="以逗号分隔，如 safe, pony, cute"
              helper="必填。请至少添加一个分级标签（safe / suggestive / questionable / explicit）"
            />

            <Input
              id="upload-f2"
              type="url"
              label="来源链接"
              value={source}
              onChange={(e) => setSource(e.target.value)}
              placeholder="Source URL (选填)"
            />

            <Textarea
              id="upload-f3"
              label="作品描述"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
              className="resize-none"
              placeholder="Description (选填)"
            />

            {/* 上传按钮 */}
            <Button
              onClick={handleUpload}
              variant="filled"
              size="lg"
              fullWidth
              loading={isUploading}
              disabled={!file}
              icon={<MdCloudUpload size={22} />}
            >
              {isUploading ? '上传中...' : '确认发布'}
            </Button>
          </div>
        </>
      )}
      {confirmDialog}
    </div>
  );
}
