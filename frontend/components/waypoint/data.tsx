import type { CSSProperties, ReactNode } from "react";
import { cn } from "@/lib/utils";

export type Brand = "fresh" | "style" | "tech";

const BRANDS: Record<Brand, { letter: string; name: string; className: string }> = {
  fresh: { letter: "F", name: "Fresh", className: "bg-wp-brand-fresh" },
  style: { letter: "S", name: "Style", className: "bg-wp-brand-style" },
  tech: { letter: "T", name: "Tech", className: "bg-wp-brand-tech" },
};

/** Brand badge plus outlet name. `outlet` may already include the brand name. */
export function BrandMonogram({ brand, outlet }: { brand: Brand; outlet?: string }) {
  const b = BRANDS[brand];
  const label = outlet?.startsWith(b.name) ? outlet : `${b.name}${outlet ? ` ${outlet}` : ""}`;
  return (
    <span className="inline-flex items-center gap-2 text-[13px] font-semibold">
      <span
        aria-hidden="true"
        className={cn("inline-flex size-6 items-center justify-center rounded-md text-[13px] font-bold text-white", b.className)}
      >
        {b.letter}
      </span>
      {label}
    </span>
  );
}

export function KpiTile({
  label,
  value,
  context,
  style,
}: {
  label: string;
  value: ReactNode;
  context: ReactNode;
  style?: CSSProperties;
}) {
  return (
    <div className="flex flex-col gap-1 rounded-lg border border-wp-border bg-wp-surface p-4" style={style}>
      <div className="text-[10px] leading-[14px] font-semibold tracking-[.06em] text-wp-muted uppercase">{label}</div>
      <div className="text-[22px] leading-6 font-bold tabular-nums">{value}</div>
      <div className="text-[11px] leading-[15px] text-wp-text-2">{context}</div>
    </div>
  );
}

export type TimelineStep = {
  label: string;
  time?: string;
  status: "done" | "current" | "attention" | "future";
};

const STEP_STYLES: Record<TimelineStep["status"], { icon: string; iconClass: string; textClass: string }> = {
  done: { icon: "✓", iconClass: "text-wp-good", textClass: "text-wp-text" },
  current: { icon: "●", iconClass: "text-wp-info", textClass: "text-wp-text" },
  attention: { icon: "▲", iconClass: "text-wp-warn", textClass: "text-wp-text" },
  future: { icon: "○", iconClass: "text-wp-muted", textClass: "text-wp-muted" },
};

export function Timeline({ steps }: { steps: TimelineStep[] }) {
  return (
    <ol className="m-0 flex list-none flex-col gap-3 p-0">
      {steps.map((step) => {
        const s = STEP_STYLES[step.status];
        return (
          <li key={step.label} className={cn("flex items-baseline gap-3", s.textClass)}>
            <span aria-hidden="true" className={cn("w-4 text-center", s.iconClass)}>
              {s.icon}
            </span>
            <span className={cn("flex-1", step.status === "current" ? "font-semibold" : "font-medium")}>{step.label}</span>
            <span className="text-[11px] text-wp-muted">{step.time}</span>
          </li>
        );
      })}
    </ol>
  );
}

/** Small uppercase section label ("NEXT · STOP 5 OF 9"). */
export function Eyebrow({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cn("text-[10px] font-semibold tracking-[.06em] text-wp-muted uppercase", className)}>{children}</div>
  );
}

/** Run history glyphs: ● delivered · ○ no order · ✕ deferred. */
export function RunHistory({ history }: { history: string }) {
  const glyphs: Record<string, [string, string, string]> = {
    d: ["●", "text-wp-text-2", "Delivered"],
    n: ["○", "text-wp-muted", "No order"],
    x: ["✕", "text-wp-crit", "Deferred"],
  };
  return (
    <div className="mt-1 flex gap-2 text-[15px]">
      {history.split("").map((k, i) => {
        const [glyph, className, title] = glyphs[k];
        return (
          <span key={i} title={title} className={cn("font-bold", className)}>
            {glyph}
          </span>
        );
      })}
    </div>
  );
}
