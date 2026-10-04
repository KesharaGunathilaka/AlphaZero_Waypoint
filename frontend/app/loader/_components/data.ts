import type { Tone } from "@/components/waypoint/status";
import { formatTime } from "@/lib/format";

// ------------------------------------------------------------- API shapes ----
// GET /loader/routes and /loader/routes/{id} (backend/app/modules/field/router.py; docs/api.md).

export type RouteRow = {
  route_id: number;
  route_seq: number;
  state: "planned" | "loading" | "loaded";
  brand_code: "F" | "S" | "T";
  district_name: string;
  vehicle_code: string;
  vehicle_source_id: string;
  vehicle_class: string;
  carries_chilled: boolean;
  depart_at: string;
  max_weight_kg: number;
  max_volume_m3: number;
  stop_count: number;
  lines_total: number;
  lines_confirmed: number;
  open_flags: number;
  plan_version: number;
  plan_released_at?: string | null;
  service_date: string;
};

export type PlanChangeRow = {
  change_id: number;
  route_id: number;
  version: number;
  changed_stops: number;
  changed_orders: number;
  created_at: string;
  retimed: boolean | null;
};

export type LoadLineRow = {
  stop_id: number;
  stop_seq: number;
  load_order: number;
  outlet_name: string;
  unload: string;
  planned_arrival: string;
  order_id: number;
  confirmation_no: string;
  line_no: number;
  product_name: string;
  unit: string;
  ordered_qty: number;
  line_temp: string;
  fragile: boolean;
  hanging: boolean;
  qty_loaded: number | null;
  line_state: "to_load" | "short" | "loaded";
  flag_id: string | null;
  flag_type: "missing" | "short" | "damaged" | null;
  flag_state: "open" | "replied" | "resolved" | null;
  flagged_at: string | null;
  flag_qty: number | null;
  flag_photos: number;
  dispatcher_reply: string | null;
  unit_weight_kg: number;
  unit_volume_m3: number;
};

// --------------------------------------------------------- screen model ----

export type LoadingVehicle = {
  /** The trip (route) id, as text: one card per trip, since a vehicle can run two. */
  id: string;
  routeId: number;
  /** "VEH057 · trip 1": the booklet's vehicle id first. */
  label: string;
  type: string;
  stops: number;
  departs: string;
  capacityKg: number;
  capacityM3: number;
  refrigerated: boolean;
  /** Released to the driver (route state "loaded"). */
  released: boolean;
  /** Set by a plan change the loader has not opened yet. */
  planChanged?: boolean;
  /** How many of the stops the latest plan change touched. */
  changedStops?: number;
};

export const FLAG_TYPES = ["Missing", "Short", "Damaged"] as const;
export type FlagType = (typeof FLAG_TYPES)[number];

/** What the loader told the dispatcher about a line that could not be loaded in full. */
export type LineFlag = {
  type: FlagType;
  /** Units affected — all of them for a missing line. */
  units: number;
  photo?: boolean;
  /** A photo taken on this tablet and not yet sent. */
  photoFile?: File;
  at: string;
  /** The dispatcher's answer, once there is one. */
  reply?: string | null;
  /** The server has it (a sent flag cannot be withdrawn, only replaced by a new one). */
  sent?: boolean;
};

export type LoadLine = {
  id: string;
  orderId: number;
  lineNo: number;
  product: string;
  units: number;
  unit: string;
  tag: string;
  /** Weight and volume of the whole line, used by the load gauges. */
  weightKg: number;
  volumeM3: number;
  confirmed: boolean;
  flag?: LineFlag;
};

export type LoadStop = {
  stop: number;
  stopId: number;
  outlet: string;
  unload: string;
  deliverBy: string;
  lines: LoadLine[];
  /**
   * The loader signed the stop off. A stop can be confirmed with a flagged line
   * on it: the flag is the record of what went wrong, not a reason to leave the
   * stop half-done.
   */
  confirmed?: boolean;
};

const BRAND_NAME = { F: "Fresh", S: "Style", T: "Tech" } as const;
const UNLOAD = { rear_dock: "rear dock", street: "curb", mall_bay: "mall bay" } as Record<string, string>;
const capitalise = (s: string) => (s.charAt(0).toUpperCase() + s.slice(1)) as FlagType;

export function toVehicle(row: RouteRow, changes: PlanChangeRow[]): LoadingVehicle {
  const mine = changes.filter((c) => c.route_id === row.route_id);
  return {
    id: String(row.route_id),
    routeId: row.route_id,
    label: `${row.vehicle_source_id} · trip ${row.route_seq}`,
    type: `${row.vehicle_class} · ${BRAND_NAME[row.brand_code]} ${row.district_name}`,
    stops: row.stop_count,
    departs: formatTime(row.depart_at),
    capacityKg: Number(row.max_weight_kg),
    capacityM3: Number(row.max_volume_m3),
    refrigerated: row.carries_chilled,
    released: row.state === "loaded",
    planChanged: mine.length > 0,
    changedStops: mine[0]?.changed_stops,
  };
}

/** The queue's progress bar comes from the server's counts, so it needs no load list per vehicle. */
export function progressFromRow(row: RouteRow): LoadProgress {
  const done = row.lines_confirmed >= row.lines_total && row.lines_total > 0;
  return {
    lines: row.lines_total,
    confirmed: row.lines_confirmed,
    outstanding: row.lines_total - row.lines_confirmed,
    flags: row.open_flags,
    stops: row.stop_count,
    stopsConfirmed: done ? row.stop_count : 0,
    weightKg: 0,
    volumeM3: 0,
  };
}

/** The server's load list as stops in load order (the last stop to deliver comes first). */
export function toStops(rows: LoadLineRow[]): LoadStop[] {
  const stops = new Map<number, LoadStop>();
  for (const r of rows) {
    let stop = stops.get(r.stop_id);
    if (!stop) {
      stop = { stop: r.stop_seq, stopId: r.stop_id, outlet: r.outlet_name, unload: UNLOAD[r.unload] ?? r.unload,
               deliverBy: formatTime(r.planned_arrival), lines: [] };
      stops.set(r.stop_id, stop);
    }
    const units = Number(r.ordered_qty);
    const loaded = r.qty_loaded === null ? null : Number(r.qty_loaded);
    const flagType = r.flag_type ? capitalise(r.flag_type) : null;
    stop.lines.push({
      id: `${r.order_id}-${r.line_no}`,
      orderId: r.order_id,
      lineNo: r.line_no,
      product: r.product_name,
      units,
      unit: r.unit,
      tag: r.line_temp === "chilled" ? "Chilled" : r.fragile ? "Fragile" : r.hanging ? "Hanging" : "Dry",
      weightKg: units * Number(r.unit_weight_kg),
      volumeM3: units * Number(r.unit_volume_m3),
      confirmed: loaded !== null,
      flag: flagType
        ? {
            type: flagType,
            units: Number(r.flag_qty ?? (flagType === "Missing" ? units : units - (loaded ?? units))),
            photo: r.flag_photos > 0,
            at: r.flagged_at ? formatTime(r.flagged_at) : "",
            reply: r.dispatcher_reply,
            sent: true,
          }
        : undefined,
    });
  }
  return [...stops.values()].map((s) => ({ ...s, confirmed: s.lines.every((l) => l.confirmed) }));
}

// --------------------------------------------------------------- progress ----

export type LoadProgress = {
  lines: number;
  confirmed: number;
  /** Lines neither loaded nor flagged: what still has to be dealt with. */
  outstanding: number;
  flags: number;
  stops: number;
  stopsConfirmed: number;
  weightKg: number;
  volumeM3: number;
};

/** How much of a line is really on board: a flag can leave part of it, or none. */
export function loadedShare(line: LoadLine) {
  if (line.flag) {
    return line.flag.type === "Missing" ? 0 : (line.units - line.flag.units) / line.units;
  }
  return line.confirmed ? 1 : 0;
}

/** The quantity that goes on board for a line, which is what the stop sign-off reports. */
export function loadedQty(line: LoadLine) {
  if (!line.flag) return line.units;
  return line.flag.type === "Missing" ? 0 : Math.max(0, line.units - line.flag.units);
}

export function progressOf(stops: LoadStop[]): LoadProgress {
  const progress: LoadProgress = {
    lines: 0, confirmed: 0, outstanding: 0, flags: 0, stops: stops.length, stopsConfirmed: 0, weightKg: 0, volumeM3: 0,
  };
  for (const stop of stops) {
    if (stop.confirmed) progress.stopsConfirmed += 1;
    for (const line of stop.lines) {
      const share = loadedShare(line);
      progress.lines += 1;
      if (line.confirmed) progress.confirmed += 1;
      if (line.flag) progress.flags += 1;
      else if (!line.confirmed) progress.outstanding += 1;
      progress.weightKg += line.weightKg * share;
      progress.volumeM3 += line.volumeM3 * share;
    }
  }
  return progress;
}

/** Every line is loaded or flagged, and the loader has signed off every stop. */
export function isFullyLoaded(progress: LoadProgress) {
  return progress.outstanding === 0 && progress.stopsConfirmed === progress.stops;
}

/** One status per vehicle, derived so a plan change shows up without touching the card. */
export function vehicleStatus(vehicle: LoadingVehicle, progress: LoadProgress): { tone: Tone; label: string } {
  if (vehicle.planChanged) return { tone: "warn", label: "▲ Plan changed" };
  if (vehicle.released) return { tone: "good", label: "✓ Released to driver" };
  if (isFullyLoaded(progress)) return { tone: "good", label: "✓ Ready to release" };
  if (progress.confirmed > 0) return { tone: "info", label: "● Loading" };
  return { tone: "offline", label: "○ Not started" };
}

/** The flagged lines of a run, for the departure check. */
export function flaggedLines(stops: LoadStop[]) {
  return stops.flatMap((stop) => stop.lines.filter((line) => line.flag).map((line) => ({ stop, line })));
}

/** What a flag left on board, in the loader's words. */
export function flagSummary(line: LoadLine) {
  const flag = line.flag;
  if (!flag) return "";
  if (flag.type === "Missing") return `None of the ${line.units} ${line.unit} loaded`;
  const loaded = line.units - flag.units;
  const what = flag.type === "Short" ? "short" : "damaged";
  return `${flag.units} ${line.unit} ${what} · ${loaded} of ${line.units} loaded`;
}

/** The same thing short enough for a pill. */
export function flagLabel(line: LoadLine) {
  const flag = line.flag;
  if (!flag) return "";
  return `${flag.units} ${line.unit} ${flag.type.toLowerCase()}`;
}

/**
 * The queue is worked in departure order, so it is always sorted by time rather
 * than by the order the vehicles arrived in. Times are zero-padded 24h, which
 * sorts correctly as text.
 */
export function sortByDeparture(vehicles: LoadingVehicle[]) {
  return [...vehicles].sort((a, b) => a.departs.localeCompare(b.departs));
}
