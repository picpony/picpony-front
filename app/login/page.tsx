'use client';

import { useState, useRef } from "react";
import { MdPerson, MdArrowBack, MdErrorOutline, MdCheckCircleOutline } from "react-icons/md";
import Link from "next/link";
import { useRouter } from "next/navigation";
import ReCAPTCHA from "react-google-recaptcha";

export default function LoginPage() {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [showCaptchaModal, setShowCaptchaModal] = useState(false);
  const recaptchaRef = useRef<ReCAPTCHA>(null);
  const router = useRouter();

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    
    if (!username || !password) {
      setError("请输入用户名和密码");
      return;
    }

    setShowCaptchaModal(true);
  };

  const onReCAPTCHAChange = async (token: string | null) => {
    if (!token) {
      setIsLoading(false);
      return;
    }

    setShowCaptchaModal(false);
    setIsLoading(true);

    try {
      const res = await fetch("https://picpony.top/api.php?action=login", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          username,
          password,
          cf_token: token,
        }),
      });

      const data = await res.json();

      if (res.ok && data.success) {
        setSuccess(true);
        localStorage.setItem('user_info', JSON.stringify({
          token: data.token,
          username: data.username,
          avatar: data.avatar,
          role: data.role,
          api_key: data.api_key,
          derpi_user_id: data.derpi_user_id,
          derpi_username: data.derpi_username
        }));
        
        setTimeout(() => {
          router.push('/');
        }, 1000);
      } else {
        setError(data.message || "登录失败，请检查用户名和密码");
        recaptchaRef.current?.reset();
      }
    } catch (err) {
      setError("网络错误，请稍后再试");
      recaptchaRef.current?.reset();
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="max-w-md mx-auto mt-12 p-8 bg-white rounded-xl relative">
      <div className="flex items-center mb-8">
        <Link 
          href="/"
          className="p-2 -ml-2 rounded-full hover:bg-slate-100 text-slate-500 transition-colors"
        >
          <MdArrowBack size={24} />
        </Link>
        <h1 className="text-2xl font-bold ml-2 text-slate-800">登录</h1>
      </div>

      {error && (
        <div className="mb-6 p-4 bg-red-50 border border-red-100 rounded-lg flex items-center text-red-600">
          <MdErrorOutline size={20} className="shrink-0 mr-2" />
          <p className="text-sm">{error}</p>
        </div>
      )}

      {success && (
        <div className="mb-6 p-4 bg-green-50 border border-green-100 rounded-lg flex items-center text-green-600">
          <MdCheckCircleOutline size={20} className="shrink-0 mr-2" />
          <p className="text-sm">登录成功！正在跳转...</p>
        </div>
      )}

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
        
        {showCaptchaModal && (
          <div className="fixed top-0 left-0 w-screen h-screen bg-black/50 flex items-center justify-center z-[9999] animate-modal-overlay">
            <div className="bg-white p-6 rounded-xl shadow-xl max-w-sm w-full mx-4 animate-modal-content">
              <h3 className="text-lg font-semibold mb-4 text-slate-800 text-center">人机验证</h3>
              <div className="flex justify-center">
                <ReCAPTCHA
                  ref={recaptchaRef}
                  sitekey="6LfOWossAAAAAB8yn0r5JPp_7aCVm4KA1TdEd0Py"
                  onChange={onReCAPTCHAChange}
                />
              </div>
            </div>
          </div>
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
          ) : "登录"}
        </button>
      </form>

      <div className="mt-6 text-center">
        <p className="text-sm text-slate-500">
          还没有账号？ <span className="text-primary cursor-pointer hover:underline">立即注册</span>
        </p>
      </div>
    </div>
  );
}
