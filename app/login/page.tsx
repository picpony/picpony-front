"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { showToast } from "@/components/Toast";
import CaptchaModal from "@/components/CaptchaModal";
import Spinner from "@/components/Spinner";
import Reveal from "@/components/Reveal";
import { api } from "@/lib/api";

export default function LoginPage() {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [success, setSuccess] = useState(false);
  const [showCaptchaModal, setShowCaptchaModal] = useState(false);
  const router = useRouter();

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    if (!username || !password) {
      showToast("请输入用户名和密码", "error");
      return;
    }

    setShowCaptchaModal(true);
  };

  const onCaptchaVerify = async (token: string) => {
    setShowCaptchaModal(false);
    setIsLoading(true);

    try {
      const res = await api.login({
        username,
        password,
        cf_token: token,
      });

      const data = await res.json();

      if (res.ok && data.success) {
        setSuccess(true);
        showToast("登录成功", "success");

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

        try {
          const userRes = await api.getUser(data.token);
          const userData = await userRes.json();
          if (userData.success && userData.user) {
            const fullUserInfo = {
              ...baseUserInfo,
              ...userData.user,
              token: data.token,
              api_key: data.api_key,
              derpi_user_id: data.derpi_user_id,
              derpi_username: data.derpi_username,
            };
            localStorage.setItem("user_info", JSON.stringify(fullUserInfo));
          }
        } catch (err) {
          console.error("Failed to fetch user info after login", err);
        }

        setTimeout(() => {
          router.push("/");
        }, 1000);
      } else {
        showToast(data.message || "登录失败，请检查用户名和密码", "error");
      }
    } catch {
      showToast("网络错误，请稍后再试", "error");
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <Reveal className="max-w-md mx-auto mt-12 p-8 bg-white dark:bg-transparent rounded-xl relative">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-slate-800 dark:text-slate-100">
          登录
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
            className="w-full px-4 py-2 rounded-lg border border-slate-200 dark:border-slate-600 dark:bg-slate-700 dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all"
            placeholder="请输入用户名"
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
            className="w-full px-4 py-2 rounded-lg border border-slate-200 dark:border-slate-600 dark:bg-slate-700 dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all"
            placeholder="请输入密码"
          />
        </div>

        <CaptchaModal
          isOpen={showCaptchaModal}
          onClose={() => setShowCaptchaModal(false)}
          onVerify={onCaptchaVerify}
        />

        <button
          type="submit"
          disabled={isLoading || success}
          data-ripple
          className={`w-full py-3 bg-primary text-white rounded-lg font-semibold transition-all duration-200 shadow-sm flex items-center justify-center ${
            isLoading || success
              ? "opacity-70 cursor-not-allowed"
              : "hover:bg-primary/90 hover:shadow-md hover:shadow-primary/25 active:scale-[0.98]"
          }`}
        >
          {isLoading ? (
            <Spinner size="sm" white />
          ) : (
            "登录"
          )}
        </button>
      </form>

      <div className="mt-6 text-center space-y-2">
        <p className="text-sm text-slate-500 dark:text-slate-400">
          还没有账号？{" "}
          <Link
            href="/register"
            className="text-primary cursor-pointer hover:underline"
          >
            立即注册
          </Link>
        </p>
        <p className="text-sm text-slate-500 dark:text-slate-400">
          <Link href="/reset-password" className="text-primary hover:underline">
            忘记密码？
          </Link>
        </p>
      </div>
    </Reveal>
  );
}
