'use client';

import {
  useEffectEvent,
  useLayoutEffect,
  useRef,
  type CanvasHTMLAttributes,
} from 'react';

type HeroFrameProps = Omit<CanvasHTMLAttributes<HTMLCanvasElement>, 'width' | 'height'> & {
  frame: HTMLCanvasElement;
  onDrawn?: () => void;
};

export default function HeroFrame({ frame, onDrawn, ...props }: HeroFrameProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const notifyDrawn = useEffectEvent(() => onDrawn?.());

  useLayoutEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const context = canvas.getContext('2d');
    if (!context) return;
    context.drawImage(frame, 0, 0, canvas.width, canvas.height);
    notifyDrawn();
  }, [frame]);

  return (
    <canvas
      {...props}
      ref={canvasRef}
      width={frame.width}
      height={frame.height}
    />
  );
}
