import { useEffect, useRef } from "react";

type Props = {
  analyser: AnalyserNode | null;
  color: string;
  muted?: boolean;
};

/** Live mirrored bar waveform driven by the analyser. Flat, solid color. */
export function Waveform({ analyser, color, muted = false }: Props) {
  const ref = useRef<HTMLCanvasElement>(null);
  const mutedRef = useRef(muted);
  mutedRef.current = muted;

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const cx = canvas.getContext("2d");
    if (!cx) return;

    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    let raf = 0;
    const bins = 28;
    const data = analyser ? new Uint8Array(analyser.frequencyBinCount) : null;

    const resolveColor = () => {
      const m = /^var\((--[\w-]+)\)$/.exec(color);
      if (!m) return color;
      return getComputedStyle(document.documentElement)
        .getPropertyValue(m[1])
        .trim();
    };

    const draw = () => {
      const w = canvas.clientWidth;
      const h = canvas.clientHeight;
      if (canvas.width !== w * dpr || canvas.height !== h * dpr) {
        canvas.width = w * dpr;
        canvas.height = h * dpr;
      }
      cx.setTransform(dpr, 0, 0, dpr, 0, 0);
      cx.clearRect(0, 0, w, h);
      cx.fillStyle = resolveColor();
      const dim = mutedRef.current;
      cx.globalAlpha = dim ? 0.22 : 1;

      const gap = 4;
      const bw = (w - gap * (bins - 1)) / bins;
      const mid = h / 2;

      for (let i = 0; i < bins; i++) {
        let v = 0.05;
        if (analyser && data && !dim) {
          analyser.getByteFrequencyData(data);
          const idx = Math.floor((i / bins) * (data.length * 0.6));
          v = Math.max(0.05, data[idx] / 255);
        }
        const bh = Math.max(3, v * (h - 6));
        const x = i * (bw + gap);
        const r = Math.min(bw / 2, 3);
        roundRect(cx, x, mid - bh / 2, bw, bh, r);
        cx.fill();
      }
      raf = requestAnimationFrame(draw);
    };
    draw();
    return () => cancelAnimationFrame(raf);
  }, [analyser, color]);

  return <canvas ref={ref} className="wave" />;
}

function roundRect(
  cx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
) {
  cx.beginPath();
  cx.moveTo(x + r, y);
  cx.arcTo(x + w, y, x + w, y + h, r);
  cx.arcTo(x + w, y + h, x, y + h, r);
  cx.arcTo(x, y + h, x, y, r);
  cx.arcTo(x, y, x + w, y, r);
  cx.closePath();
}
