'use client';

import Logo from './Logo';

export default function LoadingOverlay() {
  return (
    <div
      id="loading-overlay"
      className="fixed inset-0 z-[9999] bg-white dark:bg-slate-900 flex items-center justify-center animate-[fadeOut_0.5s_ease-in-out_0.5s_forwards]"
    >
      <Logo className="w-32 h-auto opacity-10" />
      <style dangerouslySetInnerHTML={{ __html: `
        @keyframes fadeOut {
          from { opacity: 1; pointer-events: auto; }
          to { opacity: 0; pointer-events: none; }
        }
      `}} />
    </div>
  );
}
