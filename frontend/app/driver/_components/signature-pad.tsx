"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Finger-drawn proof of delivery. The strokes stay on the canvas; the screen only
 * needs to know whether anything was signed, so that is all this reports upwards.
 */
export function SignaturePad({ signed, onSignedChange }: { signed: boolean; onSignedChange: (signed: boolean) => void }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);
  const [ink, setInk] = useState("#121c2b");

  // Match the backing store to the laid-out box so strokes land under the finger.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const { width, height } = canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    canvas.getContext("2d")?.scale(dpr, dpr);
    setInk(getComputedStyle(canvas).color);
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
    if (!signed) onSignedChange(true);
  }

  function clear() {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    onSignedChange(false);
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="relative">
        <canvas
          ref={canvasRef}
          aria-label="Signature"
          onPointerDown={start}
          onPointerMove={move}
          onPointerUp={() => (drawing.current = false)}
          onPointerLeave={() => (drawing.current = false)}
          className="h-[88px] w-full touch-none rounded-[10px] border border-dashed border-wp-muted bg-wp-canvas text-wp-text"
        />
        {!signed && (
          <span className="pointer-events-none absolute inset-0 flex items-center justify-center text-wp-muted">
            Sign here
          </span>
        )}
      </div>
      <button
        type="button"
        onClick={clear}
        disabled={!signed}
        className="flex h-11 cursor-pointer items-center justify-center rounded-[10px] border border-wp-border font-semibold disabled:cursor-not-allowed disabled:opacity-50"
      >
        Clear signature
      </button>
    </div>
  );
}
