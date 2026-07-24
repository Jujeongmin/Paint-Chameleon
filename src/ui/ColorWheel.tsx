import { useCallback, useEffect, useRef } from "react";

const SIZE = 176;

export function hsvToRgb(h: number, s: number, v: number): number {
  const i = Math.floor(h * 6);
  const f = h * 6 - i;
  const p = v * (1 - s);
  const q = v * (1 - f * s);
  const t = v * (1 - (1 - f) * s);
  let r = 0,
    g = 0,
    b = 0;
  switch (i % 6) {
    case 0: [r, g, b] = [v, t, p]; break;
    case 1: [r, g, b] = [q, v, p]; break;
    case 2: [r, g, b] = [p, v, t]; break;
    case 3: [r, g, b] = [p, q, v]; break;
    case 4: [r, g, b] = [t, p, v]; break;
    default: [r, g, b] = [v, p, q];
  }
  return (Math.round(r * 255) << 16) | (Math.round(g * 255) << 8) | Math.round(b * 255);
}

export function rgbToHsv(color: number): [number, number, number] {
  const r = ((color >> 16) & 255) / 255;
  const g = ((color >> 8) & 255) / 255;
  const b = (color & 255) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;

  let h = 0;
  if (d !== 0) {
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h /= 6;
    if (h < 0) h += 1;
  }
  return [h, max === 0 ? 0 : d / max, max];
}

export function toCss(color: number): string {
  return "#" + (color >>> 0).toString(16).padStart(6, "0");
}

interface Props {
  hue: number;
  sat: number;
  value: number;
  onChange: (hue: number, sat: number) => void;
  onValueChange: (value: number) => void;
}

export function ColorWheel({ hue, sat, value, onChange, onValueChange }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const dragging = useRef(false);

  // The wheel itself never changes — brightness is applied by the overlay below.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const img = ctx.createImageData(SIZE, SIZE);
    const r = SIZE / 2;
    for (let y = 0; y < SIZE; y++) {
      for (let x = 0; x < SIZE; x++) {
        const dx = x - r;
        const dy = y - r;
        const dist = Math.hypot(dx, dy);
        const i = (y * SIZE + x) * 4;
        if (dist > r) {
          img.data[i + 3] = 0;
          continue;
        }
        let angle = Math.atan2(dy, dx) / (Math.PI * 2);
        if (angle < 0) angle += 1;
        const rgb = hsvToRgb(angle, Math.min(1, dist / r), 1);
        img.data[i] = (rgb >> 16) & 255;
        img.data[i + 1] = (rgb >> 8) & 255;
        img.data[i + 2] = rgb & 255;
        // Feather the rim so the circle doesn't alias harshly.
        img.data[i + 3] = Math.min(255, (r - dist) * 255);
      }
    }
    ctx.putImageData(img, 0, 0);
  }, []);

  const pick = useCallback(
    (clientX: number, clientY: number) => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const rect = canvas.getBoundingClientRect();
      const r = rect.width / 2;
      const dx = clientX - rect.left - r;
      const dy = clientY - rect.top - r;
      const dist = Math.hypot(dx, dy);

      let angle = Math.atan2(dy, dx) / (Math.PI * 2);
      if (angle < 0) angle += 1;
      onChange(angle, Math.min(1, dist / r));
    },
    [onChange]
  );

  const markerX = 50 + Math.cos(hue * Math.PI * 2) * sat * 50;
  const markerY = 50 + Math.sin(hue * Math.PI * 2) * sat * 50;

  return (
    <div className="wheel-block">
      <div
        className="wheel-wrap"
        onPointerDown={(e) => {
          dragging.current = true;
          e.currentTarget.setPointerCapture(e.pointerId);
          pick(e.clientX, e.clientY);
        }}
        onPointerMove={(e) => dragging.current && pick(e.clientX, e.clientY)}
        onPointerUp={(e) => {
          dragging.current = false;
          e.currentTarget.releasePointerCapture(e.pointerId);
        }}
      >
        <canvas ref={canvasRef} width={SIZE} height={SIZE} className="wheel-canvas" />
        {/* Darkening overlay mirrors the value slider so the wheel previews brightness. */}
        <div className="wheel-shade" style={{ opacity: 1 - value }} />
        <div className="wheel-marker" style={{ left: `${markerX}%`, top: `${markerY}%` }} />
      </div>

      <input
        className="value-slider"
        type="range"
        min={0}
        max={100}
        value={Math.round(value * 100)}
        onChange={(e) => onValueChange(Number(e.target.value) / 100)}
        style={{
          background: `linear-gradient(to right, #000, ${toCss(hsvToRgb(hue, sat, 1))})`,
        }}
      />

      <div className="current-swatch" style={{ background: toCss(hsvToRgb(hue, sat, value)) }} />
    </div>
  );
}
