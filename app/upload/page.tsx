"use client";

import { useState, useRef, useCallback } from "react";
import { useRouter } from "next/navigation";
import { showToast } from "@/components/Toast";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/hooks";
import { MdCloudUpload, MdClose, MdLink, MdDescription, MdLocalOffer, MdInfoOutline, MdOpenInNew } from "react-icons/md";

export default function UploadPage() {
  const { getUserInfo } = useAuth();
  const user = getUserInfo();
  const router = useRouter();

  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [tags, setTags] = useState("");
  const [source, setSource] = useState("");
  const [description, setDescription] = useState("");
  const [isDragging, setIsDragging] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadResult, setUploadResult] = useState<{ id: number } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // 未登录 → 引导
  if (!user || !user.token) {
    return (
      <div className="max-w-lg mx-auto mt-12 p-8 text-center animate-fade-in">
        <MdCloudUpload size={64} className="mx-auto mb-4 text-slate-300 dark:text-slate-600" />
        <h1 className="text-xl font-bold text-slate-800 dark:text-slate-100 mb-2">需要登录</h1>
        <p className="text-sm text-slate-500 dark:text-slate-400 mb-6">请先登录后再发布图片</p>
        <button
          onClick={() => router.push("/login")}
          className="px-6 py-2.5 bg-primary text-white rounded-lg font-medium hover:opacity-90 transition-opacity"
        >
          前往登录
        </button>
      </div>
    );
  }

  const userApiKey = (user as Record<string, unknown>).api_key as string | undefined;

  if (!userApiKey) {
    return (
      <div className="max-w-lg mx-auto mt-12 p-8 text-center animate-fade-in">
        <MdInfoOutline size={64} className="mx-auto mb-4 text-amber-400" />
        <h1 className="text-xl font-bold text-slate-800 dark:text-slate-100 mb-2">未配置 API Key</h1>
        <p className="text-sm text-slate-500 dark:text-slate-400 mb-6">
          发布图片需要绑定 Derpibooru API Key，请先在设置中配置
        </p>
        <button
          onClick={() => router.push("/settings")}
          className="px-6 py-2.5 bg-primary text-white rounded-lg font-medium hover:opacity-90 transition-opacity inline-flex items-center gap-2"
        >
          <MdOpenInNew size={18} />
          前往设置
        </button>
      </div>
    );
  }

  // ---- 文件选择 ----

  const handleFileSelect = useCallback((f: File) => {
    const maxSize = 50 * 1024 * 1024; // 50MB
    if (f.size > maxSize) {
      showToast("文件大小不能超过 50MB", "error");
      return;
    }
    const validTypes = ["image/jpeg", "image/png", "image/gif", "image/webp", "video/webm", "video/mp4"];
    if (!validTypes.includes(f.type) && !f.type.startsWith("image/")) {
      showToast("不支持的文件格式，请选择图片或 WebM/MP4 视频", "error");
      return;
    }
    setFile(f);
    setUploadResult(null);
    if (f.type.startsWith("image/")) {
      const url = URL.createObjectURL(f);
      setPreview(url);
    } else {
      setPreview(null); // 视频不显示预览缩略图
    }
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
    setPreview(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const isVideo = file?.type.startsWith("video/");

  // ---- 上传 ----

  const handleUpload = async () => {
    if (!file || !userApiKey) return;

    const trimmedTags = tags.trim();
    if (!trimmedTags) {
      showToast("标签不能为空，至少填写一个标签（如 safe）", "error");
      return;
    }

    if (!confirm(
      "请遵守 Derpibooru 上传准则：\n" +
      "• 您必须拥有上传作品的版权或授权\n" +
      "• 请正确添加分级标签（safe / suggestive / questionable / explicit）\n" +
      "• 请勿上传重复图片\n" +
      "确认发布？"
    )) return;

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
          showToast(`发布成功！图片 ID: ${imageId}`, "success");
        } else {
          showToast("上传成功，但未能获取图片 ID", "success");
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
            errorMsg = "API Key 无效或已过期，请在设置中重新配置";
          }
        } catch { /* ignore */ }
        showToast(errorMsg, "error");
      }
    } catch (err) {
      showToast("网络错误，请检查网络连接后重试", "error");
    } finally {
      setIsUploading(false);
    }
  };

  // ---- 渲染 ----

  const inputClass =
    "w-full px-4 py-2.5 rounded-lg border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary transition-all";

  return (
    <div className="max-w-2xl mx-auto px-4 py-6 sm:py-10 animate-fade-in">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-slate-800 dark:text-slate-100 flex items-center gap-2">
          发布图片
        </h1>
      </div>

      {uploadResult ? (
        /* ──── 上传成功 ──── */
        <div className="bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-xl p-8 text-center">
          <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-green-100 dark:bg-green-800/40 flex items-center justify-center">
            <svg className="w-8 h-8 text-green-600 dark:text-green-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
            </svg>
          </div>
          <h2 className="text-xl font-bold text-slate-800 dark:text-slate-100 mb-2">发布成功</h2>
          <p className="text-sm text-slate-500 dark:text-slate-400 mb-6">
            图片 ID: <span className="font-mono font-medium text-primary">{uploadResult.id}</span>
          </p>
          <div className="flex items-center justify-center gap-3">
            <button
              onClick={() => router.push(`/pic/${uploadResult.id}`)}
              className="px-5 py-2 bg-primary text-white rounded-lg font-medium hover:opacity-90 transition-opacity inline-flex items-center gap-2"
            >
              <MdOpenInNew size={18} />
              查看图片
            </button>
            <button
              onClick={() => {
                setFile(null);
                setPreview(null);
                setTags("");
                setSource("");
                setDescription("");
                setUploadResult(null);
              }}
              className="px-5 py-2 border border-slate-300 dark:border-slate-600 text-slate-600 dark:text-slate-300 rounded-lg font-medium hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors"
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
            className={`relative border-2 border-dashed rounded-xl p-8 sm:p-12 text-center cursor-pointer transition-all duration-200 mb-6 ${
              isDragging
                ? "border-primary bg-primary/5 scale-[1.02]"
                : file
                  ? "border-green-300 dark:border-green-700 bg-green-50/50 dark:bg-green-900/10"
                  : "border-slate-300 dark:border-slate-600 hover:border-primary/50 hover:bg-slate-50 dark:hover:bg-slate-800/50"
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
              <div className="relative inline-block max-w-full">
                <img
                  src={preview}
                  alt="Preview"
                  className="max-h-[50vh] max-w-full rounded-lg object-contain mx-auto"
                />
                <button
                  onClick={(e) => { e.stopPropagation(); removeFile(); }}
                  className="absolute -top-3 -right-3 w-8 h-8 bg-red-500 text-white rounded-full flex items-center justify-center shadow-lg hover:bg-red-600 transition-colors"
                >
                  <MdClose size={16} />
                </button>
                <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">
                  {(file!.size / 1024 / 1024).toFixed(2)} MB — 点击更换
                </p>
              </div>
            ) : isVideo ? (
              <div className="py-8">
                <video
                  src={URL.createObjectURL(file!)}
                  className="max-h-[40vh] max-w-full rounded-lg mx-auto"
                  controls
                />
                <button
                  onClick={(e) => { e.stopPropagation(); removeFile(); }}
                  className="inline-flex mt-3 items-center gap-1 text-xs text-red-500 hover:text-red-600 transition-colors"
                >
                  <MdClose size={14} /> 移除
                </button>
                <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                  {(file!.size / 1024 / 1024).toFixed(2)} MB
                </p>
              </div>
            ) : (
              <>
                <MdCloudUpload size={56} className="mx-auto mb-4 text-slate-300 dark:text-slate-500" />
                <p className="text-base font-medium text-slate-600 dark:text-slate-300 mb-1">
                  点击选择或拖拽文件到此处
                </p>
                <p className="text-sm text-slate-400 dark:text-slate-500">
                  支持 PNG / JPG / GIF / WebP / WebM / MP4（最大 50MB）
                </p>
              </>
            )}
          </div>

          {/* ──── 表单 ──── */}
          <div className="space-y-5">
            {/* 标签 */}
            <div>
              <label className="flex items-center gap-1.5 text-sm font-medium text-slate-700 dark:text-slate-300 mb-1.5">
                标签 <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                value={tags}
                onChange={(e) => setTags(e.target.value)}
                className={inputClass}
                placeholder="以逗号分隔，如 safe, pony, cute"
              />
              <p className="mt-1 text-xs text-slate-400">
                必填。请至少添加一个分级标签（safe / suggestive / questionable / explicit）
              </p>
            </div>

            {/* 来源 */}
            <div>
              <label className="flex items-center gap-1.5 text-sm font-medium text-slate-700 dark:text-slate-300 mb-1.5">
                来源链接
              </label>
              <input
                type="url"
                value={source}
                onChange={(e) => setSource(e.target.value)}
                className={inputClass}
                placeholder="Source URL (选填)"
              />
            </div>

            {/* 描述 */}
            <div>
              <label className="flex items-center gap-1.5 text-sm font-medium text-slate-700 dark:text-slate-300 mb-1.5">
                作品描述
              </label>
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={3}
                className={`${inputClass} resize-none`}
                placeholder="Description (选填)"
              />
            </div>

            {/* 上传按钮 */}
            <button
              onClick={handleUpload}
              disabled={!file || isUploading}
              className="w-full py-3 bg-primary text-white rounded-lg font-semibold hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed transition-all flex items-center justify-center gap-2"
            >
              {isUploading ? (
                <>
                  <svg className="animate-spin h-5 w-5" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                  </svg>
                  上传中...
                </>
              ) : (
                <>
                  <MdCloudUpload size={22} />
                  确认发布
                </>
              )}
            </button>
          </div>
        </>
      )}
    </div>
  );
}
