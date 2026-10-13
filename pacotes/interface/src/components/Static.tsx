import { useEffect, useRef } from 'react';

/** Animated TV static ("chuvisco"), drawn small and scaled up. */
export function Static({ className = '' }: { className?: string }) {
  const canvas = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const context = canvas.current?.getContext('2d');
    if (!context) return;
    const { width, height } = context.canvas;
    const image = context.createImageData(width, height);
    const pixels = new Uint32Array(image.data.buffer);
    let frame = 0;
    let lastDraw = 0;

    const draw = (time: number) => {
      frame = requestAnimationFrame(draw);
      if (time - lastDraw < 40) return; // ~25 fps, like the real thing
      lastDraw = time;
      for (let i = 0; i < pixels.length; i++) {
        const v = (Math.random() * 255) | 0;
        pixels[i] = 0xff000000 | (v << 16) | (v << 8) | v;
      }
      context.putImageData(image, 0, 0);
    };
    frame = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(frame);
  }, []);

  return <canvas ref={canvas} className={`static ${className}`} width={200} height={150} aria-hidden="true" />;
}
