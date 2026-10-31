"use client";

import { Clock3 } from "lucide-react";
import { useState } from "react";
import { errorMessage, useApi } from "@/lib/api/use-api";
import { applyClock, type Clock, useClockOffset, useClockSync, useNow } from "@/lib/clock";
import { formatDayTime, formatTime } from "@/lib/format";
import { cn } from "@/lib/utils";

/**
 * Keeps this app on the server's clock and, while the demo clock runs, says so on every screen:
 * nobody should mistake the demo morning for the real time.
 */
export function DemoClockBar({ className }: { className?: string }) {
  useClockSync();
  const offset = useClockOffset();
  const now = useNow(15_000);
  if (offset === 0) return null;
  return (
    <div role="status" className={cn("flex items-center justify-center gap-2 bg-wp-info-tint px-3 py-1 text-[12px] font-semibold text-wp-info", className)}>
      <Clock3 aria-hidden className="size-3.5" />
      Demo clock · {formatDayTime(now)}
      <span className="font-normal text-wp-text-2">(real time {formatTime(new Date(now.getTime() - offset))})</span>
    </div>
  );
}

/** Dispatcher, demo only: jump to the delivery morning, move the clock on, or go back to real time. */
export function DemoClockControls({ morningOf, onChanged }: { morningOf: string | null; onChanged?: (message: string) => void }) {
  const request = useApi();
  const clock = useClockSync();
  const offset = useClockOffset();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!clock.data?.demo_controls) return null;
  const running = offset !== 0;

  async function set(body: { at?: string; advance_minutes?: number; real_time?: boolean }, message: string) {
    setBusy(true);
    setError(null);
    try {
      applyClock(await request<Clock>("/demo/clock", { method: "POST", body }));
      void clock.reload();
      setOpen(false);
      onChanged?.(message);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  const button = "h-8 cursor-pointer rounded-md border border-wp-border px-3 text-[12px] font-semibold hover:bg-wp-surface-2 disabled:opacity-60";
  return (
    <div className="relative">
      <button type="button" onClick={() => setOpen(!open)} aria-expanded={open}
              className={cn("inline-flex h-9 cursor-pointer items-center gap-1.5 rounded-md border px-3 text-[12px] font-semibold",
                            running ? "border-wp-info bg-wp-info-tint text-wp-info" : "border-wp-border text-wp-text")}
              title="Demo only: run the app on another time">
        <Clock3 aria-hidden className="size-3.5" /> Demo clock
      </button>
      {open && (
        <div className="absolute right-0 z-40 mt-1 flex w-[260px] flex-col gap-2 rounded-lg border border-wp-border bg-wp-surface p-3 shadow-lg">
          <div className="text-[11px] text-wp-text-2">
            Countdowns, lateness and the time on driver and loader records follow this clock. Order cutoffs stay on real time.
          </div>
          {morningOf && (
            <button type="button" className={button} disabled={busy}
                    onClick={() => void set({ at: `${morningOf}T04:30:00+05:30` }, `Demo clock set to 04:30 on the delivery morning.`)}>
              Delivery morning, 04:30
            </button>
          )}
          <div className="grid grid-cols-3 gap-1.5">
            {[15, 60, 180].map((m) => (
              <button key={m} type="button" className={button} disabled={busy}
                      onClick={() => void set({ advance_minutes: m }, `Demo clock moved on ${m >= 60 ? `${m / 60} h` : `${m} min`}.`)}>
                +{m >= 60 ? `${m / 60} h` : `${m} min`}
              </button>
            ))}
          </div>
          <button type="button" className={button} disabled={busy || !running}
                  onClick={() => void set({ real_time: true }, "Back on real time.")}>
            Back to real time
          </button>
          {error && <div role="alert" className="text-[12px] text-wp-crit">{error}</div>}
        </div>
      )}
    </div>
  );
}
