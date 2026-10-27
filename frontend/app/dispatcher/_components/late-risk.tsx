import { formatTime } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { Lateness, StopForecast } from "./data";

/**
 * Predicted lateness from our Datathon Task 1 model: the chance a stop is reached after its window closes,
 * the expected arrival and handling time, and the reasons behind it. Shown before departure on the plan and
 * for the stops still ahead in Live.
 */

export const forecastOf = (l: Lateness | null | undefined, stopId: number): StopForecast | undefined => l?.stops[String(stopId)];

/** The trip's worst stop among the given ones (by default all of them). */
export function worstStop(l: Lateness | null | undefined, stopIds: number[]): { stopId: number; f: StopForecast } | null {
  let best: { stopId: number; f: StopForecast } | null = null;
  for (const id of stopIds) {
    const f = forecastOf(l, id);
    if (f && (!best || f.late_probability > best.f.late_probability)) best = { stopId: id, f };
  }
  return best;
}

export const countLevel = (l: Lateness | null | undefined, stopIds: number[], level: StopForecast["level"]) =>
  stopIds.filter((id) => forecastOf(l, id)?.level === level).length;

export const percent = (p: number) => (p >= 0.995 ? ">99%" : p < 0.01 ? "<1%" : `${Math.round(p * 100)}%`);

/** "Likely late 96%" (red) or "Late risk 31%" (amber); nothing when the model expects it on time. */
export function LateRisk({ f, at, className }: {
  f?: StopForecast; className?: string;
  /** The stop it is about, where the badge sits beside another one. */
  at?: string;
}) {
  if (!f || f.level === "ok") return null;
  return (
    <span
      title={f.why.join(" · ")}
      className={cn(
        "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] leading-[15px] font-semibold whitespace-nowrap",
        f.level === "likely" && "bg-wp-crit-tint text-wp-crit",
        f.level === "risk" && "bg-wp-warn-tint text-wp-warn",
        className,
      )}
    >
      <span aria-hidden="true">{f.level === "likely" ? "◆" : "▲"}</span>
      {f.level === "likely" ? "Likely late" : "Late risk"} {percent(f.late_probability)}{f.was != null ? ` · was ${percent(f.was)}` : ""}{at ? ` at ${at}` : ""}
    </span>
  );
}

/** "expected 09:13 · handling ~21 min (15 planned) · expected 73 min after the window closes · …" */
export function ForecastLine({ f, className }: { f?: StopForecast; className?: string }) {
  if (!f) return null;
  const longer = f.service_minutes > f.allowance_minutes + 3;
  return (
    <span className={cn("text-[11px] text-wp-text-2", className)}>
      model: arrives ~<b className="text-wp-text">{formatTime(f.expected_arrival)}</b>
      {" · "}handling ~<span className={longer ? "font-semibold text-wp-warn" : undefined}>{Math.round(f.service_minutes)} min</span>
      {" "}({f.allowance_minutes} planned)
      {f.level !== "ok" && f.why.length > 0 && <> · {f.why.join(" · ")}</>}
    </span>
  );
}

/** Where the numbers come from, for anyone who asks. */
export function ModelNote({ l, className }: { l: Lateness; className?: string }) {
  return (
    <p className={cn("text-[11px] text-wp-muted", className)}>
      Predicted by our Datathon Task 1 model, unchanged: LightGBM, three seeds, validated on five time folds (late log loss 0.143,
      AUC 0.979; handling time within 3.9 min on average against 7.4 for the planning allowance). History up to{" "}
      {l.history_cutoff}. It replays each trip with traffic, the day’s road disruption and each outlet’s own handling times,
      which the free-flow plan leaves out. <span className="whitespace-nowrap">{l.model}</span>
    </p>
  );
}
