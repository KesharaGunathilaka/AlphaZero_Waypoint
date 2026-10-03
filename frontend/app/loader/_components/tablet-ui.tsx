import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import type { Tone } from "@/components/waypoint/status";
import type { PlanVersion } from "./data";

// Building blocks for the loader's shared dock tablet: dark theme, 56px+ touch targets.

export function TabletScreen({ label, children, className }: { label: string; children: ReactNode; className?: string }) {
  return (
    <section
      data-screen-label={label}
      className={cn(
        "flex min-h-[800px] w-[1280px] max-w-full flex-col overflow-hidden rounded-xl border border-wp-border bg-wp-canvas text-wp-text",
        className,
      )}
    >
      {children}
    </section>
  );
}

const PILL_TONES: Record<Tone, string> = {
  good: "bg-wp-good-tint text-wp-good",
  warn: "bg-wp-warn-tint text-wp-warn",
  crit: "bg-wp-crit-tint text-wp-crit",
  info: "bg-wp-info-tint text-wp-info",
  offline: "bg-wp-offline-tint text-wp-offline",
};

/** Larger status pill for arm's-length reading on the tablet. Text carries its own glyph. */
export function TabletPill({ tone, children, className }: { tone: Tone; children: ReactNode; className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex h-9 items-center gap-2 rounded-full px-3.5 text-sm font-semibold whitespace-nowrap",
        PILL_TONES[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}

/** Who is signed in to the shared tablet, and which plan the dock is working to. */
export function LiveStatus({ plan }: { plan: PlanVersion }) {
  return (
    <div className="flex items-center gap-4">
      <span className="text-wp-text-2">Nuwan</span>
      <TabletPill tone="good">● Live</TabletPill>
      <span className="font-semibold">
        Plan {plan.version} · {plan.at}
      </span>
    </div>
  );
}

export function Meter({ label, value, percent, fillClassName }: { label: string; value: string; percent: number; fillClassName: string }) {
  return (
    <div>
      <div className="mb-2 flex justify-between">
        <span>{label}</span>
        <b>{value}</b>
      </div>
      <div className="h-2 rounded bg-wp-surface-2">
        <div className={cn("h-2 rounded", fillClassName)} style={{ width: `${percent}%` }} />
      </div>
    </div>
  );
}

export const CARD = "rounded-[10px] border border-wp-border bg-wp-surface";
export const TOUCH_BUTTON =
  "inline-flex h-14 cursor-pointer items-center justify-center rounded-lg border border-wp-border px-5 font-semibold";
export const PRIMARY_TOUCH_BUTTON =
  "inline-flex h-14 cursor-pointer items-center justify-center rounded-lg bg-wp-action px-6 font-semibold text-wp-on-action";
