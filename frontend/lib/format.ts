/** Dates and times as people at the depots and outlets read them: Sri Lanka time, 24-hour clock. */

const TZ = "Asia/Colombo";

function parts(value: string | Date, options: Intl.DateTimeFormatOptions) {
  const date = typeof value === "string" ? new Date(value.length === 10 ? `${value}T00:00:00+05:30` : value) : value;
  return new Intl.DateTimeFormat("en-GB", { timeZone: TZ, ...options }).format(date);
}

/** "Tue 6 Oct" */
export function formatDay(value: string | Date): string {
  return parts(value, { weekday: "short", day: "numeric", month: "short" }).replace(",", "");
}

/** "Tuesday 6 Oct" */
export function formatLongDay(value: string | Date): string {
  return parts(value, { weekday: "long", day: "numeric", month: "short" }).replace(",", "");
}

/** "05:46" */
export function formatTime(value: string | Date): string {
  return parts(value, { hour: "2-digit", minute: "2-digit", hour12: false });
}

/** "Tue 6 Oct 05:46" */
export function formatDayTime(value: string | Date): string {
  return `${formatDay(value)} ${formatTime(value)}`;
}

/** "22 h 30 min left", from now until `value`. */
export function timeLeft(value: string | Date, now: Date = new Date()): string {
  const ms = new Date(value).getTime() - now.getTime();
  if (ms <= 0) return "closed";
  const minutes = Math.floor(ms / 60000);
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return h > 0 ? `${h} h ${m} min left` : `${m} min left`;
}

/** Today's date in Sri Lanka as YYYY-MM-DD. */
export function todayIso(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: TZ }).format(new Date());
}

export function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}
