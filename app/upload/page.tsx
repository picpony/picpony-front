'use client';

import { useState, useRef, useCallback, useMemo, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { showToast } from '@/components/Toast';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/hooks';
import { useAuthModal } from '@/components/AuthModal';
import { MdCloudUpload, MdClose, MdInfoOutline, MdOpenInNew } from 'react-icons/md';
import Button, { buttonClasses } from '@/components/Button';
import { Input, Textarea } from '@/components/Input';

export default function UploadPage() {
  const { getUserInfo } = useAuth();
  const user = getUserInfo();
  const router = useRouter();
  const { openAuth } = useAuthModal();

  const [file, setFile] = useState<File | null>(null);
  const [tags, setTags] = useState('');
  const [source, setSource] = useState('');
  const [description, setDescription] = useState('');
  const [isDragging, setIsDragging] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadResult, setUploadResult] = useState<{ id: number } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

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

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (f) handleFileSelect(f);
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };
  const handleDragLeave = () => setIsDragging(false);
  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const f = e.dataTransfer.files?.[0];
    if (f) handleFileSelect(f);
  };

  const removeFile = () => {
    setFile(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  // ---- 上传 ----

  const handleUpload = async () => {
    if (!file || !userApiKey) return;

    const trimmedTags = tags.trim();
    if (!trimmedTags) {
      showToast('标签不能为空，至少填写一个标签（如 safe）', 'error');
      return;
    }

    if (
      !confirm(
        '请遵守 Derpibooru 上传准则：\n' +
          '• 您必须拥有上传作品的版权或授权\n' +
          '• 请正确添加分级标签（safe / suggestive / questionable / explicit）\n' +
          '• 请勿上传重复图片\n' +
          '确认发布？',
      )
    )
      return;

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
    } catch {
      showToast('网络错误，请检查网络连接后重试', 'error');
    } finally {
      setIsUploading(false);
    }
  };

  // 未登录 → 引导
  if (!user || !user.token) {
    return (
      <div className="max-w-lg mx-auto mt-12 p-8 text-center animate-fade-in">
        <MdCloudUpload size={64} className="mx-auto mb-4 text-outline" />
        <h1 className="text-title-l text-on-surface mb-2">需要登录</h1>
        <p className="text-body-m text-on-surface-variant mb-6">请先登录后再发布图片</p>
        <Button onClick={() => openAuth('login')} variant="filled">
          前往登录
        </Button>
      </div>
    );
  }

  if (!userApiKey) {
    return (
      <div className="max-w-lg mx-auto mt-12 p-8 text-center animate-fade-in">
        <MdInfoOutline size={64} className="mx-auto mb-4 text-warning" />
        <h1 className="text-title-l text-on-surface mb-2">未配置 API Key</h1>
        <p className="text-body-m text-on-surface-variant mb-6">
          发布图片需要绑定 Derpibooru API Key，请先在设置中配置
        </p>
        <Button
          onClick={() => router.push('/settings')}
          variant="filled"
          icon={<MdOpenInNew size={18} />}
        >
          前往设置
        </Button>
      </div>
    );
  }

  // ---- 渲染 ----


  return (
    <div className="max-w-2xl mx-auto px-4 py-6 sm:py-10 animate-fade-in">
      <div className="mb-8">
        <h1 className="text-headline-s text-on-surface flex items-center gap-2">
          发布图片
        </h1>
      </div>

      {uploadResult ? (
        /* ──── 上传成功 ──── */
        <div className="bg-success-container border border-success/40 rounded-md p-8 text-center">
          <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-success-container flex items-center justify-center">
            <svg
              className="w-8 h-8 text-success"
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
          <h2 className="text-title-l text-on-surface mb-2">发布成功</h2>
          <p className="text-body-m text-on-surface-variant mb-6">
            图片 ID: <span className="font-mono font-medium text-primary">{uploadResult.id}</span>
          </p>
          <div className="flex items-center justify-center gap-3">
            <Button
              onClick={() => router.push(`/pic/${uploadResult.id}`)}
              variant="filled"
              icon={<MdOpenInNew size={18} />}
            >
              查看图片
            </Button>
            <button
              onClick={() => {
                setFile(null);
                setTags('');
                setSource('');
                setDescription('');
                setUploadResult(null);
              }}
              className={buttonClasses({ variant: 'outlined' })}
            >
              继续发布
            </button>
          </div>
        </div>
      ) : (
        <>
          {/* ──── 拖拽/点击选区 ──── */}
          <div
            onClick={() => fileInputRef.current?.click()}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
            className={`relative border-2 border-dashed rounded-md p-8 sm:p-12 text-center cursor-pointer transition-ui duration-300 ease-[var(--ease-standard)] mb-6 ${
              isDragging
                ? 'border-primary bg-primary/5 scale-[1.02] shadow-e3 shadow-primary/10'
                : file
                  ? 'border-success/40 bg-success-container/50'
                  : 'border-outline hover:border-primary/50 hover:bg-surface-container-high/50'
            }`}
          >
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*,video/webm,video/mp4"
              className="hidden"
              onChange={handleInputChange}
            />

            {preview ? (
              <div className="relative inline-block max-w-full animate-pop-in">
                {/* eslint-disable-next-line @next/next/no-img-element -- local blob preview */}
                <img
                  src={preview}
                  alt="Preview"
                  className="max-h-[50vh] max-w-full rounded-md object-contain mx-auto"
                />
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    removeFile();
                  }}
                  aria-label="移除文件"
                  className="touch-target absolute -top-3 -right-3 w-8 h-8 bg-error-fill text-on-fill rounded-full flex items-center justify-center shadow-e3 hover:bg-error-fill/90 hover:rotate-90 hover:scale-110 transition-ui"
                >
                  <MdClose size={16} />
                </button>
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
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    removeFile();
                  }}
                  className="state-layer mt-3 inline-flex items-center gap-1 rounded-full px-2 py-1 text-body-s text-error"
                >
                  <MdClose size={14} /> 移除
                </button>
                <p className="mt-1 text-body-s text-on-surface-variant">
                  {(file!.size / 1024 / 1024).toFixed(2)} MB
                </p>
              </div>
            ) : (
              <>
                <MdCloudUpload size={56} className="mx-auto mb-4 text-outline" />
                <p className="text-body-l font-medium text-on-surface-variant mb-1">
                  点击选择或拖拽文件到此处
                </p>
                <p className="text-body-m text-outline">
                  支持 PNG / JPG / GIF / WebP / WebM / MP4（最大 50MB）
                </p>
              </>
            )}
          </div>

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
    </div>
  );
}
