"use client";

import { formatTime } from "@/lib/format";
import { cn } from "@/lib/utils";

/** One trip on the timeline: a bar from departure to return; `fill` (0–1) shades part of it. */
export type LaneBar = {
  id: number;
  start: number;
  end: number;
  text: string;
  title: string;
  ariaLabel: string;
  /** Background and border of the bar. */
  className: string;
  /** Colour of the shaded part (stops done on Live, load on the plan). */
  fillClassName?: string;
  fill?: number;
  dim?: boolean;
  selected?: boolean;
  /** Predicted lateness on the trip: an amber dot at its end, filled (likely late) or outlined (at risk). */
  risk?: "likely" | "risk";
  /** Stops not delivered on this trip: a red ✕ with the count. */
  failed?: number;
  onClick: () => void;
};
export type Lane = { key: string; label: string; bars: LaneBar[] };

const HOUR = 3_600_000;

/**
 * One lane per vehicle, a bar per trip. Used by Live (where every trip is now) and by the plan
 * (how the day's trips sit on each vehicle before anything leaves).
 */
export function LaneTimeline({ lanes, now, compact = false }: { lanes: Lane[]; now?: number; compact?: boolean }) {
  const times = lanes.flatMap((l) => l.bars.flatMap((b) => [b.start, b.end])).filter(Number.isFinite);
  if (times.length === 0) return null;
  const start = Math.min(...times) - HOUR / 4;
  const end = Math.max(...times) + HOUR / 4;
  const x = (t: number) => ((t - start) / (end - start)) * 100;
  // Colombo is UTC+05:30 all year, so its whole hours fall on the half hour in UTC.
  const ticks: number[] = [];
  for (let t = Math.ceil((start - HOUR / 2) / HOUR) * HOUR + HOUR / 2; t <= end; t += HOUR) ticks.push(t);
  const showNow = now !== undefined && now >= start && now <= end;
  // The present: the time itself in the hour scale (hour labels it would cover step aside), the past lightly
  // shaded, and a thin dashed line in the text colour. Never red: on Live, red means a failed delivery.
  const nowX = showNow ? x(now!) : null;
  const clear = (t: number) => nowX === null || Math.abs(x(t) - nowX) > 7;

  return (
    <div className="flex min-h-0 flex-col">
      <div className="flex shrink-0 pl-[74px]">
        <div className="relative h-4 flex-1 text-[10px] text-wp-muted">
          {ticks.map((t, i) => clear(t) && (
            <span key={t} className={cn("absolute -translate-x-1/2", i % 2 === 1 && "max-sm:hidden")} style={{ left: `${x(t)}%` }}>
              {formatTime(new Date(t))}
            </span>
          ))}
          {nowX !== null && (
            <span className="absolute top-0 z-10 -translate-x-1/2 rounded bg-wp-text px-1 text-[10px] leading-4 font-bold text-wp-surface tabular-nums"
                  style={{ left: `${nowX}%` }} aria-label={`Now ${formatTime(new Date(now!))}`}>
              {formatTime(new Date(now!))}
            </span>
          )}
        </div>
      </div>
      <div className="relative flex min-h-0 flex-1 flex-col">
        <div className="pointer-events-none absolute inset-y-0 right-0 left-[74px]">
          {nowX !== null && <div className="absolute inset-y-0 left-0 bg-wp-surface-2/70" style={{ width: `${nowX}%` }} />}
          {ticks.map((t) => <div key={t} className="absolute inset-y-0 border-l border-wp-border/60" style={{ left: `${x(t)}%` }} />)}
          {nowX !== null && <div className="absolute inset-y-0 z-10 border-l-[1.5px] border-dashed border-wp-text/70" style={{ left: `${nowX}%` }} />}
        </div>
        {lanes.map((lane) => (
          <div key={lane.key}
               className={cn("flex flex-1 items-center border-t border-wp-border/40 first:border-t-0",
                             compact ? "h-[26px] flex-none" : "min-h-[18px] lg:max-h-[38px] lg:min-h-[14px]")}>
            <div className="w-[74px] shrink-0 truncate pr-2 text-[11px] font-semibold">{lane.label}</div>
            <div className="relative h-full flex-1">
              {lane.bars.map((b) => {
                const left = x(b.start);
                return (
                  <button key={b.id} type="button" onClick={b.onClick} title={b.title} aria-label={b.ariaLabel}
                          className={cn("absolute top-[10%] bottom-[10%] flex cursor-pointer items-center overflow-hidden rounded border text-left transition-opacity",
                                        b.className, b.dim && "opacity-25", b.selected && "ring-2 ring-wp-focus ring-offset-1")}
                          style={{ left: `${left}%`, width: `${Math.max(0.8, x(b.end) - left)}%` }}>
                    {b.fill !== undefined && (
                      <div className={cn("absolute inset-y-0 left-0", b.fillClassName)} style={{ width: `${Math.min(1, b.fill) * 100}%` }} />
                    )}
                    {b.failed ? (
                      <span className="relative shrink-0 rounded-sm bg-wp-crit px-0.5 text-[9px] leading-3 font-bold text-white" aria-hidden="true">
                        ✕{b.failed > 1 ? b.failed : ""}
                      </span>
                    ) : null}
                    <span className="relative block truncate px-1 text-[10px] leading-none font-semibold">{b.text}</span>
                    {b.risk && (
                      <span aria-hidden="true"
                            className={cn("absolute top-0.5 right-0.5 size-2 rounded-full ring-1 ring-wp-surface",
                                          b.risk === "likely" ? "bg-wp-warn" : "border border-wp-warn bg-wp-surface")} />
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
