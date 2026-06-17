"use client";

import { useState, useRef } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { showToast } from "@/components/Toast";
import CaptchaModal from "@/components/CaptchaModal";
import { api } from "@/lib/api";

type RegisterStep = 'form' | 'verify';

export default function RegisterPage() {
  const [step, setStep] = useState<RegisterStep>('form');
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [showCaptchaModal, setShowCaptchaModal] = useState(false);
  const registeredUserId = useRef<number>(0);
  const registeredUsername = useRef<string>('');
  const router = useRouter();

  // 验证码输入
  const [verifyCode, setVerifyCode] = useState("");
  const [isVerifying, setIsVerifying] = useState(false);
  const [isResending, setIsResending] = useState(false);

  // ---- 客户端验证 (与后端规则对齐) ----

  const validateForm = (): string | null => {
    if (!username.trim()) return "请输入用户名";
    if (username.trim().length > 20) return "用户名长度不得超过 20 个字符";
    if (!/^[a-zA-Z0-9_\-\u4e00-\u9fa5]+$/.test(username.trim())) {
      return "用户名只能包含字母、数字、下划线、减号和中文字符";
    }
    if (!email.trim()) return "请输入邮箱";
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) return "请输入有效的邮箱地址";
    if (email.trim().length > 50) return "邮箱地址最多 50 个字符";
    if (!password) return "请输入密码";
    if (password.length < 8 || password.length > 20) return "密码长度需在 8-20 位之间";
    if (!/[A-Za-z]/.test(password) || !/[^A-Za-z]/.test(password)) {
      return "密码必须包含字母和数字或特殊字符";
    }
    return null;
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const error = validateForm();
    if (error) {
      showToast(error, "error");
      return;
    }
    setShowCaptchaModal(true);
  };

  const onCaptchaVerify = async (token: string) => {
    setShowCaptchaModal(false);
    setIsLoading(true);

    try {
      const res = await api.register({
        username: username.trim(),
        email: email.trim(),
        password,
        cf_token: token,
      });

      const data = await res.json();

      if (res.ok && data.success) {
        registeredUserId.current = data.user_id;
        registeredUsername.current = data.username;
        setStep('verify');
        showToast("验证码已发送至您的邮箱，请查收", "success");
      } else {
        showToast(data.error || data.message || "注册失败，请检查输入", "error");
      }
    } catch {
      showToast("网络错误，请稍后再试", "error");
    } finally {
      setIsLoading(false);
    }
  };

  // ---- 邮箱验证 ----

  const handleVerify = async () => {
    if (!verifyCode.trim()) {
      showToast("请输入验证码", "error");
      return;
    }
    setIsVerifying(true);
    try {
      const res = await api.verifyEmailById(registeredUserId.current, verifyCode.trim());
      const data = await res.json();

      if (data.success) {
        // 验证成功 → 自动登录
        const baseUserInfo = {
          token: data.token,
          username: data.username,
          avatar: data.avatar,
          role: data.role,
          api_key: data.api_key,
          derpi_user_id: data.derpi_user_id,
          derpi_username: data.derpi_username,
        };
        localStorage.setItem("user_info", JSON.stringify(baseUserInfo));

        showToast("邮箱验证成功，欢迎加入！", "success");
        setTimeout(() => router.push("/"), 1500);
      } else {
        showToast(data.error || data.message || "验证失败", "error");
      }
    } catch {
      showToast("网络错误，请稍后再试", "error");
    } finally {
      setIsVerifying(false);
    }
  };

  const handleResend = async () => {
    setIsResending(true);
    try {
      const res = await api.resendVerifyCodeById(registeredUserId.current);
      const data = await res.json();
      if (data.success) {
        showToast("新验证码已发送，请查收", "success");
      } else {
        showToast(data.error || data.message || "发送失败", "error");
      }
    } catch {
      showToast("网络错误，请稍后再试", "error");
    } finally {
      setIsResending(false);
    }
  };

  // ---- 渲染 ----

  const inputClass =
    "w-full px-4 py-2 rounded-lg border border-slate-200 dark:border-slate-600 dark:bg-slate-700 dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all";

  const btnClass =
    "w-full py-3 bg-primary text-white rounded-lg font-semibold transition-colors shadow-sm flex items-center justify-center disabled:opacity-70 disabled:cursor-not-allowed hover:bg-primary/90";

  return (
    <div className="max-w-md mx-auto mt-12 p-8 bg-white dark:bg-transparent rounded-xl relative">
      {step === 'form' ? (
        <>
          <div className="mb-8">
            <h1 className="text-2xl font-bold text-slate-800 dark:text-slate-100">
              注册
            </h1>
          </div>

          <form className="space-y-4" onSubmit={handleSubmit}>
            <div>
              <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
                用户名
              </label>
              <input
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                required
                className={inputClass}
                placeholder="字母、数字、下划线、中文"
                maxLength={20}
              />
              <p className="mt-0.5 text-xs text-slate-400">
                支持字母、数字、下划线(_)、减号(-)和中文字符
              </p>
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
                邮箱
              </label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                className={inputClass}
                placeholder="请输入邮箱"
                maxLength={50}
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
                密码
              </label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                className={inputClass}
                placeholder="8-20位，需包含字母和数字/字符"
                maxLength={20}
              />
              <p className="mt-0.5 text-xs text-slate-400">
                长度 8-20 位，必须包含字母和数字或特殊字符
              </p>
            </div>

            <CaptchaModal
              isOpen={showCaptchaModal}
              onClose={() => setShowCaptchaModal(false)}
              onVerify={onCaptchaVerify}
            />

            <button type="submit" disabled={isLoading} className={btnClass}>
              {isLoading ? (
                <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin"></div>
              ) : (
                "注册"
              )}
            </button>
          </form>

          <div className="mt-6 text-center">
            <p className="text-sm text-slate-500 dark:text-slate-400">
              已有账号？{" "}
              <Link
                href="/login"
                className="text-primary cursor-pointer hover:underline"
              >
                立即登录
              </Link>
            </p>
          </div>
        </>
      ) : (
        <>
          <div className="mb-6 text-center">
            <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-primary/10 flex items-center justify-center">
              <svg
                className="w-8 h-8 text-primary"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"
                />
              </svg>
            </div>
            <h1 className="text-xl font-bold text-slate-800 dark:text-slate-100 mb-2">
              验证邮箱
            </h1>
            <p className="text-sm text-slate-500 dark:text-slate-400">
              验证码已发送至 <span className="font-medium text-slate-700 dark:text-slate-300">{email}</span>
            </p>
            <p className="text-xs text-slate-400 mt-1">
              有效期为 10 分钟，请及时查收
            </p>
          </div>

          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1 text-center">
                请输入 6 位验证码
              </label>
              <input
                type="text"
                value={verifyCode}
                onChange={(e) => setVerifyCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                className={`${inputClass} text-center text-2xl tracking-[0.5em] font-mono`}
                placeholder="000000"
                maxLength={6}
                autoFocus
              />
            </div>

            <button
              onClick={handleVerify}
              disabled={isVerifying || verifyCode.length !== 6}
              className={btnClass}
            >
              {isVerifying ? (
                <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin"></div>
              ) : (
                "验证并登录"
              )}
            </button>

            <div className="text-center">
              <button
                onClick={handleResend}
                disabled={isResending}
                className="text-sm text-primary cursor-pointer hover:underline disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isResending ? "发送中..." : "未收到？重新发送验证码"}
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
