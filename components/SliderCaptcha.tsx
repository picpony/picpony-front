"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { api } from "@/lib/api";
import { encodeTrack } from "@/lib/utils";

interface SliderCaptchaProps {
  onVerify: (token: string) => void;
  onClose: () => void;
}

export default function SliderCaptcha({ onVerify, onClose }: SliderCaptchaProps) {
  const [bgImage, setBgImage] = useState("");
  const [pieceImage, setPieceImage] = useState("");
  const [pieceY, setPieceY] = useState(0);
  const [sliderX, setSliderX] = useState(0);
  const [loading, setLoading] = useState(true);
  const [verifying, setVerifying] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");
  const [isDragging, setIsDragging] = useState(false);
  const startXRef = useRef(0);
  const sliderXRef = useRef(0);
  const sliderBtnRef = useRef<HTMLDivElement>(null);
  const fetchedRef = useRef(false);

  const trackRef = useRef<[number, number, number][]>([]);
  const dragStartTimeRef = useRef(0);
  const lastSampleTimeRef = useRef(0);

  const maxSliderX = 260;
  const btnWidth = 50;

  const getClientX = (e: MouseEvent | TouchEvent | React.MouseEvent | React.TouchEvent): number => {
    if ("touches" in e) return e.touches[0].clientX;
    return e.clientX;
  };

  const getClientY = (e: MouseEvent | TouchEvent | React.MouseEvent | React.TouchEvent): number => {
    if ("touches" in e) return e.touches[0].clientY;
    return e.clientY;
  };

  const fetchCaptcha = useCallback(async () => {
    setLoading(true);
    setSliderX(0);
    setErrorMsg("");
    sliderXRef.current = 0;
    trackRef.current = [];
    try {
      const data = await api.captchaGet();
      if (data.success) {
        setBgImage(data.bg);
        setPieceImage(data.piece);
        setPieceY(data.y);
      } else {
        setErrorMsg("获取验证码失败");
      }
    } catch {
      setErrorMsg("网络错误，请重试");
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    if (!fetchedRef.current) {
      fetchedRef.current = true;
      api.captchaGet()
        .then((data) => {
          if (data.success) {
            setBgImage(data.bg);
            setPieceImage(data.piece);
            setPieceY(data.y);
          } else {
            setErrorMsg("获取验证码失败");
          }
        })
        .catch(() => setErrorMsg("网络错误，请重试"))
        .finally(() => setLoading(false));
    }
  }, []);

  const handleStart = useCallback(
    (e: React.MouseEvent | React.TouchEvent) => {
      if (loading || verifying || errorMsg) return;
      e.preventDefault();
      const refX = getClientX(e);
      const refY = getClientY(e);
      setIsDragging(true);
      startXRef.current = refX;

      const now = Date.now();
      dragStartTimeRef.current = now;
      lastSampleTimeRef.current = now;
      trackRef.current = [[0, refY, 0]];

      const handleMove = (moveEvent: MouseEvent | TouchEvent) => {
        moveEvent.preventDefault();
        const currentClientX = getClientX(moveEvent);
        const currentClientY = getClientY(moveEvent);
        let moveX = currentClientX - refX;
        if (moveX < 0) moveX = 0;
        if (moveX > maxSliderX) moveX = maxSliderX;
        sliderXRef.current = moveX;
        setSliderX(moveX);

        const nowMove = Date.now();
        const elapsed = nowMove - dragStartTimeRef.current;
        if (nowMove - lastSampleTimeRef.current < 16) return;
        lastSampleTimeRef.current = nowMove;

        trackRef.current.push([moveX, currentClientY, elapsed]);
      };

      const handleEnd = async () => {
        setIsDragging(false);
        document.removeEventListener("mousemove", handleMove);
        document.removeEventListener("touchmove", handleMove);
        document.removeEventListener("mouseup", handleEnd);
        document.removeEventListener("touchend", handleEnd);

        const finalX = sliderXRef.current;
        if (finalX < 5) return;

        const endTime = Date.now();
        const totalElapsed = endTime - dragStartTimeRef.current;
        const lastY = trackRef.current.length > 0
          ? trackRef.current[trackRef.current.length - 1][1]
          : 0;
        trackRef.current.push([finalX, lastY, totalElapsed]);

        if (trackRef.current.length < 5) {
          setSliderX(0);
          setErrorMsg("请从起点开始完整滑动");
          return;
        }

        setVerifying(true);
        try {
          const encodedTrack = encodeTrack(trackRef.current);
          const data = await api.captchaVerify(finalX, encodedTrack);
          if (data.success && data.token) {
            onVerify(data.token);
          } else {
            setSliderX(0);
            setErrorMsg("验证失败，请重试");
            setTimeout(() => fetchCaptcha(), 500);
          }
        } catch {
          setSliderX(0);
          setErrorMsg("网络错误，请重试");
          setTimeout(() => fetchCaptcha(), 500);
        }
        setVerifying(false);
      };

      document.addEventListener("mousemove", handleMove);
      document.addEventListener("touchmove", handleMove, { passive: false });
      document.addEventListener("mouseup", handleEnd);
      document.addEventListener("touchend", handleEnd);
    },
    [loading, verifying, errorMsg, maxSliderX, onVerify, fetchCaptcha]
  );

  return (
    <div className="flex flex-col items-center gap-4 w-[340px]">
      <div className="flex justify-center items-center w-full">
        <span className="font-semibold text-slate-800 dark:text-slate-100">请完成安全验证</span>
      </div>
      <div className="relative w-[310px]">
        {loading && !bgImage && (
          <div className="w-[310px] h-[155px] flex items-center justify-center bg-white/80 dark:bg-slate-800/80 rounded-md">
            <div className="w-8 h-8 rounded-full animate-spin border-[3px] border-slate-300/50 dark:border-slate-600/70 border-t-[#E06C9F] dark:border-t-pink-300" />
          </div>
        )}

        {bgImage && (
          <div className="relative w-[310px] h-[155px] bg-slate-200 dark:bg-slate-600 rounded-md overflow-hidden animate-fade-in">
            <img
              src={bgImage}
              alt="验证码背景"
              className="w-full h-full block"
              draggable={false}
            />
            {pieceImage && (
              <img
                src={pieceImage}
                alt="滑动拼图"
                className="absolute w-[50px] h-[50px] drop-shadow-[0_0_5px_rgba(0,0,0,0.5)] pointer-events-none"
                style={{ top: `${pieceY}px`, left: `${sliderX}px` }}
                draggable={false}
              />
            )}
            {verifying && (
              <div className="absolute inset-0 flex items-center justify-center bg-white/60 dark:bg-black/50 z-20 animate-fade-in">
                <div className="w-8 h-8 rounded-full animate-spin border-[3px] border-slate-300/50 dark:border-slate-600/70 border-t-[#E06C9F] dark:border-t-pink-300" />
              </div>
            )}
            {errorMsg && !verifying && (
              <div className="absolute inset-0 flex items-center justify-center bg-red-500/15 dark:bg-red-900/40 z-20 animate-fade-in">
                <svg viewBox="0 0 24 24" className="w-12 h-12 text-red-500 drop-shadow-md" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="12" r="10" />
                  <line x1="15" y1="9" x2="9" y2="15" />
                  <line x1="9" y1="9" x2="15" y2="15" />
                </svg>
              </div>
            )}
          </div>
        )}
      </div>

      {bgImage && (
        <div
          className="relative w-[310px] h-10 bg-slate-100 dark:bg-slate-700 rounded-full border border-slate-200 dark:border-slate-600 mt-2"
          style={{ touchAction: "none" }}
        >
          <div
            className="h-full bg-emerald-500/20 rounded-full transition-none"
            style={{ width: `${sliderX + btnWidth}px` }}
          />

          <div
            ref={sliderBtnRef}
            className={`absolute top-[-1px] w-[50px] h-10 bg-white dark:bg-slate-700 border border-slate-300 dark:border-slate-500 rounded-full flex items-center justify-center shadow-md select-none z-10 text-lg transition-colors ${
              isDragging
                ? "cursor-grabbing bg-emerald-500 text-white border-emerald-500 dark:bg-emerald-600 dark:border-emerald-600"
                : "cursor-grab text-slate-600 dark:text-slate-300"
            } ${verifying ? "pointer-events-none opacity-70" : ""}`}
            style={{ left: `${sliderX}px` }}
            onMouseDown={handleStart}
            onTouchStart={handleStart}
          >
            &rarr;
          </div>
        </div>
      )}
    </div>
  );
}
