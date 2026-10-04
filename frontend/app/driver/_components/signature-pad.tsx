"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Finger-drawn proof of delivery.
 *
 * The strokes are handed up as a data URL at the end of each one, so a signature
 * survives the screen being left and come back to — the canvas itself does not.
 */
export function SignaturePad({ value, onChange }: { value: string | null; onChange: (value: string | null) => void }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);
  /** The signature this pad opened with, redrawn once the canvas is sized. */
  const initial = useRef(value);
  const [inked, setInked] = useState(value !== null);
  const [ink, setInk] = useState("#121c2b");

  // Match the backing store to the laid-out box so strokes land under the finger.
  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    const { width, height } = canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    ctx.scale(dpr, dpr);
    setInk(getComputedStyle(canvas).color);

    if (initial.current) {
      const image = new window.Image();
      image.onload = () => ctx.drawImage(image, 0, 0, width, height);
      image.src = initial.current;
    }
  }, []);

  function point(e: React.PointerEvent<HTMLCanvasElement>) {
    const rect = e.currentTarget.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }

  function start(e: React.PointerEvent<HTMLCanvasElement>) {
    const ctx = e.currentTarget.getContext("2d");
    if (!ctx) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    drawing.current = true;
    const { x, y } = point(e);
    ctx.beginPath();
    ctx.moveTo(x, y);
  }

  function move(e: React.PointerEvent<HTMLCanvasElement>) {
    if (!drawing.current) return;
    const ctx = e.currentTarget.getContext("2d");
    if (!ctx) return;
    const { x, y } = point(e);
    ctx.strokeStyle = ink;
    ctx.lineWidth = 2;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.lineTo(x, y);
    ctx.stroke();
    setInked(true);
  }

  function end(e: React.PointerEvent<HTMLCanvasElement>) {
    if (!drawing.current) return;
    drawing.current = false;
    onChange(e.currentTarget.toDataURL());
  }

  function clear() {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    setInked(false);
    onChange(null);
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="relative">
        <canvas
          ref={canvasRef}
          aria-label="Signature"
          onPointerDown={start}
          onPointerMove={move}
          onPointerUp={end}
          onPointerLeave={end}
          className="h-[88px] w-full touch-none rounded-[10px] border border-dashed border-wp-muted bg-wp-canvas text-wp-text"
        />
        {!inked && (
          <span className="pointer-events-none absolute inset-0 flex items-center justify-center text-wp-muted">
            Sign here
          </span>
        )}
      </div>
      {inked && (
        <button
          type="button"
          onClick={clear}
          className="flex h-11 cursor-pointer items-center justify-center rounded-[10px] border border-wp-border font-semibold"
        >
          Clear signature
        </button>
      )}
    </div>
  );
}
