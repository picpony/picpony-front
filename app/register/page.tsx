'use client';

import { useState, useRef, useEffect } from "react";
import { createPortal } from "react-dom";
import { MdArrowBack } from "react-icons/md";
import Link from "next/link";
import { useRouter } from "next/navigation";
import ReCAPTCHA from "react-google-recaptcha";
import { showToast } from "@/components/Toast";
import { api } from "@/lib/api";

export default function RegisterPage() {
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [success, setSuccess] = useState(false);
  const [showCaptchaModal, setShowCaptchaModal] = useState(false);
  const [isClosingCaptcha, setIsClosingCaptcha] = useState(false);
  const [mounted, setMounted] = useState(false);
  const recaptchaRef = useRef<ReCAPTCHA>(null);
  const router = useRouter();

  useEffect(() => {
    document.title = "注册 - PicPony";
  }, []);

  useEffect(() => {
    setMounted(true);
  }, []);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!username || !email || !password) {
      showToast("请填写所有字段", "error");
      return;
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      showToast("请输入有效的邮箱地址", "error");
      return;
    }

    setShowCaptchaModal(true);
  };

  const closeCaptchaModal = () => {
    setIsClosingCaptcha(true);
    setTimeout(() => {
      setShowCaptchaModal(false);
      setIsClosingCaptcha(false);
    }, 200);
  };

  const onReCAPTCHAChange = async (token: string | null) => {
    if (!token) {
      setIsLoading(false);
      return;
    }

    closeCaptchaModal();
    setIsLoading(true);

    try {
      const res = await api.register({
        username,
        email,
        password,
        cf_token: token,
      });

      const data = await res.json();

      if (res.ok && data.success) {
        setSuccess(true);
        showToast('注册成功，请登录', 'success');
        
        setTimeout(() => {
          router.push('/login');
        }, 1500);
      } else {
        showToast(data.message || "注册失败，请检查输入", "error");
        recaptchaRef.current?.reset();
      }
    } catch (err) {
      showToast("网络错误，请稍后再试", "error");
      recaptchaRef.current?.reset();
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="max-w-md mx-auto mt-12 p-8 bg-white rounded-xl relative">
      <div className="flex items-center mb-8">
        <Link 
          href="/login"
          className="p-2 -ml-2 rounded-full hover:bg-slate-100 text-slate-500 transition-colors"
        >
          <MdArrowBack size={24} />
        </Link>
        <h1 className="text-2xl font-bold ml-2 text-slate-800">注册</h1>
      </div>

      <form className="space-y-4" onSubmit={handleSubmit}>
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1">用户名</label>
          <input 
            type="text" 
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            required
            className="w-full px-4 py-2 rounded-lg border border-slate-200 focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all"
            placeholder="请输入用户名"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1">邮箱</label>
          <input 
            type="email" 
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            className="w-full px-4 py-2 rounded-lg border border-slate-200 focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all"
            placeholder="请输入邮箱"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1">密码</label>
          <input 
            type="password" 
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            className="w-full px-4 py-2 rounded-lg border border-slate-200 focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all"
            placeholder="请输入密码"
          />
        </div>
        
        {showCaptchaModal && mounted && createPortal(
          <div 
            className={`fixed top-0 left-0 w-screen h-screen bg-black/50 flex items-center justify-center z-[9999] ${isClosingCaptcha ? 'animate-modal-overlay-out' : 'animate-modal-overlay'}`}
          >
            <div 
              className={`bg-white p-6 rounded-xl shadow-xl max-w-sm w-full mx-4 relative ${isClosingCaptcha ? 'animate-modal-content-out' : 'animate-modal-content'}`}
            >
              <h3 className="text-lg font-semibold mb-4 text-slate-800 text-center">请先完成验证码</h3>
              <div className="flex justify-center">
                <ReCAPTCHA
                  ref={recaptchaRef}
                  sitekey="6LfOWossAAAAAB8yn0r5JPp_7aCVm4KA1TdEd0Py"
                  onChange={onReCAPTCHAChange}
                />
              </div>
            </div>
          </div>,
          document.body
        )}

        <button 
          type="submit"
          disabled={isLoading || success}
          className={`w-full py-3 bg-primary text-white rounded-lg font-semibold transition-colors shadow-sm flex items-center justify-center ${
            isLoading || success ? 'opacity-70 cursor-not-allowed' : 'hover:bg-primary/90'
          }`}
        >
          {isLoading ? (
            <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin"></div>
          ) : "注册"}
        </button>
      </form>

      <div className="mt-6 text-center">
        <p className="text-sm text-slate-500">
          已有账号？ <Link href="/login" className="text-primary cursor-pointer hover:underline">立即登录</Link>
        </p>
      </div>
    </div>
  );
}
