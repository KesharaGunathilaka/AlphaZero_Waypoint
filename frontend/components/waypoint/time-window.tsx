import { formatTime } from "@/lib/format";
import { cn } from "@/lib/utils";

/**
 * One way to show a stop's time on every screen: when we plan to be there, the store's delivery window,
 * and how many minutes are spare before the window closes. Under 15 min spare is amber; past it is red.
 */

const minutesOfDay = (hhmm: string) => {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
};

/** "07:45:00" -> "07:45" */
export const clockTime = (t: string) => t.slice(0, 5);

/** Minutes between the planned arrival and the window closing (negative = after it closes). */
export function spareMinutes(planned: string, closes: string | null | undefined): number | null {
  if (!closes) return null;
  return minutesOfDay(clockTime(closes)) - minutesOfDay(formatTime(planned));
}

/** "2 h 05 min" / "25 min" */
export function minutesText(minutes: number): string {
  const m = Math.abs(minutes);
  return m >= 60 ? `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, "0")} min` : `${m} min`;
}

export function spareTone(spare: number | null): "ok" | "tight" | "late" {
  return spare === null || spare >= 15 ? "ok" : spare >= 0 ? "tight" : "late";
}

export function SpareBadge({ spare, className }: { spare: number | null; className?: string }) {
  if (spare === null) return null;
  const tone = spareTone(spare);
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] leading-[15px] font-semibold whitespace-nowrap",
        tone === "ok" && "bg-wp-surface-2 text-wp-text-2",
        tone === "tight" && "bg-wp-warn-tint text-wp-warn",
        tone === "late" && "bg-wp-crit-tint text-wp-crit",
        className,
      )}
    >
      {tone !== "ok" && <span aria-hidden="true">{tone === "late" ? "✕" : "▲"}</span>}
      {spare >= 0 ? `${minutesText(spare)} spare` : `${minutesText(spare)} after the window`}
    </span>
  );
}

/** "planned 05:44 · window 05:00–07:45 · [2 h 01 min spare]" */
export function TimeWindow({
  planned,
  opens,
  closes,
  className,
  showPlanned = true,
}: {
  planned: string;
  opens?: string | null;
  closes?: string | null;
  className?: string;
  /** Off where the planned time is already shown big next to it. */
  showPlanned?: boolean;
}) {
  const spare = spareMinutes(planned, closes);
  return (
    <span className={cn("inline-flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-[12px] text-wp-text-2", className)}>
      {showPlanned && (
        <span>
          planned <b className="text-wp-text">{formatTime(planned)}</b>
        </span>
      )}
      {closes && (
        <>
          {showPlanned && <span aria-hidden="true">·</span>}
          <span>
            window {opens ? `${clockTime(opens)}–` : "to "}
            {clockTime(closes)}
          </span>
          <SpareBadge spare={spare} />
        </>
      )}
    </span>
  );
}
