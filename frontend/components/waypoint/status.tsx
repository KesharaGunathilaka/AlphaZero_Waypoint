import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/** Every state pairs an icon with a colour, so status is never shown by colour alone. */
export type Tone = "good" | "warn" | "crit" | "info" | "offline";

export const TONES: Record<Tone, { icon: string; className: string }> = {
  good: { icon: "✓", className: "bg-wp-good-tint text-wp-good" },
  warn: { icon: "▲", className: "bg-wp-warn-tint text-wp-warn" },
  crit: { icon: "✕", className: "bg-wp-crit-tint text-wp-crit" },
  info: { icon: "●", className: "bg-wp-info-tint text-wp-info" },
  offline: { icon: "⊘", className: "bg-wp-offline-tint text-wp-offline" },
};

export function StatusPill({
  state = "good",
  children,
  className,
}: {
  state?: Tone;
  children: ReactNode;
  className?: string;
}) {
  const tone = TONES[state];
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] leading-[15px] font-semibold",
        tone.className,
        className,
      )}
    >
      <span aria-hidden="true">{tone.icon}</span>
      {children}
    </span>
  );
}

export function Banner({
  state = "info",
  action,
  onAction,
  children,
}: {
  state?: Tone;
  action?: string;
  onAction?: () => void;
  children: ReactNode;
}) {
  const tone = TONES[state];
  return (
    <div
      role="status"
      className={cn("flex items-center gap-3 rounded-lg px-4 py-3 text-[13px] leading-[18px] font-medium", tone.className)}
    >
      <span aria-hidden="true">{tone.icon}</span>
      <span className="flex-1">{children}</span>
      {action && (
        <button
          type="button"
          onClick={onAction}
          className="cursor-pointer rounded-md border border-current px-3 py-1 font-semibold"
        >
          {action}
        </button>
      )}
    </div>
  );
}

const SYNC: Record<"synced" | "saved" | "sending" | "retrying", Tone> = {
  synced: "good",
  saved: "offline",
  sending: "info",
  retrying: "warn",
};

export function SyncIndicator({
  state = "synced",
  children,
}: {
  state?: keyof typeof SYNC;
  children: ReactNode;
}) {
  const tone = TONES[SYNC[state]];
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] leading-[15px] font-semibold",
        tone.className,
      )}
    >
      <span aria-hidden="true">{tone.icon}</span>
      {children}
    </span>
  );
}

export function CapacityGauge({ label = "Weight", value = 0 }: { label?: string; value?: number }) {
  const fill = value >= 100 ? "bg-wp-crit" : value >= 90 ? "bg-wp-gauge-amber" : "bg-wp-offline";
  return (
    <div className="flex items-center gap-3 text-[11px] font-semibold">
      <span className="min-w-14 text-wp-text-2">{label}</span>
      <div
        role="img"
        aria-label={`${label} ${value} percent of limit`}
        className="h-2 flex-1 overflow-hidden rounded bg-wp-surface-2"
      >
        <div className={cn("h-full", fill)} style={{ width: `${Math.min(value, 100)}%` }} />
      </div>
      <span className="min-w-9 text-right text-wp-text">{value}%</span>
    </div>
  );
}

/** Thin horizontal progress bar used across the loader and driver screens. */
export function ProgressBar({ value, className }: { value: number; className?: string }) {
  return (
    <div className="h-2 rounded bg-wp-surface-2">
      {value > 0 && <div className={cn("h-2 rounded", className ?? "bg-wp-text-2")} style={{ width: `${value}%` }} />}
    </div>
  );
}
