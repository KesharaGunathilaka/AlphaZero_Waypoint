import type { Brand } from "@/components/waypoint/data";
import type { Tone } from "@/components/waypoint/status";

// Shapes returned by the API (backend/app/modules/dispatch/router.py; see docs/api.md).

export type BrandCode = "F" | "S" | "T";
export const BRAND: Record<BrandCode, Brand> = { F: "fresh", S: "style", T: "tech" };
export const BRAND_NAME: Record<BrandCode, string> = { F: "Fresh", S: "Style", T: "Tech" };

export type Me = { name: string; role: string; depot: string | null; all_depots?: boolean };
export type Depots = { current: number | null; depots: { depot_id: number; name: string }[] };

export type Run = {
  run_id: number;
  service_date: string;
  state: "open" | "closed" | "planned" | "in_progress" | "complete";
  cutoff_at: string;
  plan_id: number | null;
  plan_state: "draft" | "released" | null;
  version: number | null;
  orders: number;
  /** When orders closed (the plan opened); null while still open. */
  closed_at: string | null;
  /** Closed by the 16:00 cutoff on its own, not by the dispatcher's button. */
  closed_automatically: boolean;
};
export type Runs = { next_open_date: string; runs: Run[] };

export type StopOrder = { order_id: number; ref: string; temp: "ambient" | "chilled"; kg: number; m3: number; status: string };
export type Stop = {
  route_id: number;
  stop_id: number;
  seq: number;
  outlet_code: string;
  outlet_name: string;
  planned_arrival: string;
  service_minutes: number;
  unload: string;
  van_only: boolean;
  /** The store's delivery window that day ("05:00:00"). */
  window_opens: string | null;
  window_closes: string | null;
  orders: StopOrder[] | null;
};

export type Route = {
  route_id: number;
  route_seq: 1 | 2;
  state: string;
  brand_code: BrandCode;
  district_name: string;
  trip_minutes: number;
  vehicle_id: number;
  vehicle_code: string;
  vehicle_class: string;
  is_van: boolean;
  carries_chilled: boolean;
  driver_name: string | null;
  depart_at: string;
  return_at: string;
  weight_kg: number;
  volume_m3: number;
  max_weight_kg: number;
  max_volume_m3: number;
  weight_pct: number;
  volume_pct: number;
  fuel_left_l: number | null;
  est_fuel_l: number | null;
  stop_count: number;
  stops: Stop[];
};

export type Unplanned = {
  order_id: number;
  confirmation_no: string;
  temp: "ambient" | "chilled";
  deferral_count: number;
  outlet_id: number;
  outlet_name: string;
  outlet_code: string;
  district: string;
  brand_code: BrandCode;
  weight_kg: number;
  volume_m3: number;
  van_only: boolean;
  unload: string;
  suggested_reason: string | null;
  suggested_label: string | null;
  drafted_reason: string | null;
  drafted_note: string | null;
  skips_last5: number;
  skip_streak: number;
  consecutive_skip: boolean;
  history: { day: string; outcome: "delivered" | "deferred" | "no_order" }[] | null;
};

export type Vehicle = {
  vehicle_id: number;
  code: string;
  source_id: string;
  class: string;
  is_van: boolean;
  carries_chilled: boolean;
  active: boolean;
  max_weight_kg: number;
  max_volume_m3: number;
  fuel_left_l: number | null;
};

export type Violation = { code: string; route_id: number | null; stop_id: number | null; order_id: number | null; message: string };
export type Reason = { code: string; label: string; needs_note: boolean };

export type PlanView = {
  plan: { plan_id: number; run_id: number; service_date: string; state: "draft" | "released"; version: number; dirty: boolean; edited_at: string };
  summary: {
    orders_confirmed: number;
    orders_planned: number;
    cannot_fit: number;
    rule_conflicts: number;
    refrigerated_routes: number;
    refrigerated_free: number;
    refrigerated_total: number;
  } | null;
  routes: Route[];
  unplanned: Unplanned[];
  violations: Violation[];
  vehicles: Vehicle[];
  reasons: Reason[];
  next_operating_day: string | null;
  lateness: Lateness | null;
};

/** Our Datathon Task 1 model on one stop: chance of arriving after the window closes, expected arrival and handling. */
export type StopForecast = {
  late_probability: number;
  level: "likely" | "risk" | "ok";
  service_minutes: number;
  allowance_minutes: number;
  expected_arrival: string;
  window_closes?: string | null;
  why: string[];
  /** Live: the chance recorded when the plan was sent. */
  was?: number;
};
/** The store's answer to "likely after your window". */
export type ReceivingReply = { answer: "will_receive" | "cannot_receive"; receive_until: string | null; replied_at: string };
/** Null when no model is installed on the server. In Live, `level` is "likely" only where today's delays raised a
 *  stop's chance since the plan was sent (an alert); elsewhere "ok". */
export type Lateness = { model: string; history_cutoff: string; stops: Record<string, StopForecast>; alerts?: Record<string, unknown> };

/** Before the plan: what is coming in for a delivery day against the fleet that can carry it. */
export type Outlook = {
  service_date: string;
  cutoff_at: string;
  demand: { brand: BrandCode; temp: "ambient" | "chilled"; orders: number; kg: number; m3: number; van_only: number; moved_in: number }[];
  fleet: { is_van: boolean; carries_chilled: boolean; available: number; m3_per_trip: number | null; kg_per_trip: number | null; in_workshop: string[] }[];
  fresh_budget_minutes: number;
};

/** Would a vehicle in the workshop, back in service, let a deferred order go? */
export type WhatIf = {
  order_id: number;
  today: { orders_served: number; orders_total: number } | null;
  options: { vehicle_id: number; vehicle: string; serves_order: boolean; orders_served: number; orders_total: number }[];
};

/** Plan future capacity: the demand forecast by week and brand, and the depot's fleet. */
export type Capacity = {
  forecast: {
    iso_year: number; iso_week: number; week_start: string; brand: BrandCode; total_m3: number; chilled_m3: number;
    source: string; loaded_at: string; operating_days: number; festival: string | null; payday: boolean | null;
  }[];
  fleet: { vehicle: string; class: string; is_van: boolean; carries_chilled: boolean; active: boolean; m3: number; kg: number }[];
  /** Average of the last released plans: how many vehicles and trips a day's volume really took. */
  recent: { days: number; since: string | null; vehicles: number | null; trips: number | null; m3: number | null };
};

// ---------------------------------------------------------------- monitor ----
export type RunProgress = {
  run_id: number;
  depot_id: number;
  depot: string;
  service_date: string;
  state: string;
  routes_total: number;
  routes_departed: number;
  orders_total: number;
  orders_delivered: number;
  orders_due_by_now: number;
  fresh_at_risk: number;
  needs_attention: number;
};
export type FleetRow = {
  route_id: number;
  depot: string;
  run_id: number;
  district: string;
  brand_code: BrandCode;
  return_at: string;
  trip_minutes: number | null;
  vehicle_code: string;
  vehicle_source_id: string;
  route_seq: number;
  state: string;
  driver_name: string | null;
  depart_at: string;
  stops_total: number;
  stops_done: number;
  next_outlet: string | null;
  next_planned: string | null;
  last_seen_at: string | null;
  no_signal: boolean;
  exception_count: number;
  /** The worst alert on this trip (worked out in the browser from the alerts): sets its colour on Live. */
  worst?: Severity | null;
};
export type Severity = "crit" | "warn" | "info";
export type Exception = {
  kind: string;
  depot: string | null;
  urgency: number;
  severity: string;
  route_id: number | null;
  stop_id: number | null;
  order_id: number | null;
  flag_id: string | null;
  since: string | null;
  detail: string;
  /** likely_late only: the model's chance now and when the plan was sent, why, and the store's answer. */
  late_probability?: number;
  was?: number;
  why?: string[];
  reply?: ReceivingReply | null;
};
export type MonitorStop = {
  route_id: number;
  stop_id: number;
  seq: number;
  outlet_code: string;
  outlet_name: string;
  planned_arrival: string;
  arrived_at: string | null;
  delivered_at: string | null;
  outcomes: string | null;
  proof_files: number;
};
/** End of the day for one run: outcomes, failed deliveries still to move, and each vehicle's fuel. */
export type Closeout = {
  run_id: number;
  service_date: string;
  state: string;
  depot: string;
  delivered: number;
  delivered_in_part: number;
  /** Of those: the driver handed over all that was on board, but the loader had left some short. */
  loaded_short?: number;
  not_delivered: number;
  not_yet: number;
  confirmed_by_store: number;
  awaiting_store: number;
  failed: { order_id: number; confirmation_no: string; outlet_code: string; outlet_name: string; temp: string;
            reason_code: string | null; reason: string | null; note: string | null; device_time: string }[];
  fuel: { vehicle_id: number; source_id: string; today_l: number; today_km: number; quota_l: number | null;
          used_week_l: number; left_week_l: number | null }[];
};
export type Monitor = {
  depots: { depot_id: number; name: string }[];
  runs: RunProgress[];
  fleet: FleetRow[];
  exceptions: Exception[];
  stops: MonitorStop[];
  closeout: Closeout[];
  lateness: Lateness | null;
  server_time: string;
};

export const EXCEPTION_LABEL: Record<string, string> = {
  delivery_failed: "Delivery failed",
  driver_reported: "Driver reported",
  short_loaded: "Short-loaded",
  no_signal: "No signal",
  late: "Late",
  likely_late: "Likely to miss window",
  loader_flag: "Loader flag",
  plan_conflict: "Plan conflict",
  instruction_unseen: "Not opened yet",
  rejected_event: "Record refused",
};

/** An alert's colour comes from how serious it is (the server's severity), so red always means critical. */
export function exceptionTone(e: Pick<Exception, "kind" | "severity">): Tone {
  if (e.kind === "no_signal") return "offline";
  return e.severity === "crit" ? "crit" : e.severity === "info" ? "info" : "warn";
}

/** The worst severity among a trip's alerts (no signal is shown on its own, so it doesn't count here). */
export function worstSeverity(alerts: Exception[]): Severity | null {
  const seen = new Set(alerts.filter((e) => e.kind !== "no_signal").map((e) => e.severity));
  return seen.has("crit") ? "crit" : seen.has("warn") ? "warn" : seen.has("info") ? "info" : null;
}

// ----------------------------------------------------------------- ledger ----
export type LedgerRecord = {
  record_type: "deferral" | "delivery";
  depot: string;
  record_id: string;
  order_id: number;
  confirmation_no: string;
  outlet_id: number;
  outlet_name: string;
  brand_code: BrandCode;
  temp: string;
  service_date: string;
  outcome: string;
  reason: string | null;
  note: string | null;
  decided_by: string;
  at: string;
  received_at: string | null;
  consecutive_skip: boolean;
  awaiting_store: boolean;
  disputed: boolean;
  proof_complete: boolean | null;
};
export type Ledger = {
  headline: {
    deferred_last_7d: number;
    deferred_prev_7d: number;
    outlets_skipped_twice_running: number;
    delivered_with_issue_last_7d: number;
    data_through: string | null;
  } | null;
  records: LedgerRecord[];
  per_day: { day: string; is_working: boolean; deferred: number | null }[];
};

/** One order and where it is now (GET /dispatch/orders?date= rows; also the head of an OrderRecord). */
export type OrderRow = {
  order_id: number;
  confirmation_no: string;
  status: string;
  temp: "ambient" | "chilled";
  delivery_date: string;
  deferral_count: number;
  original_delivery_date: string;
  source: "store" | "dispatcher";
  placed_at: string;
  outlet_id: number;
  outlet_code: string;
  outlet_name: string;
  van_only: boolean;
  unload: string;
  brand_code: BrandCode;
  brand_name: string;
  district: string;
  weight_kg: number;
  volume_m3: number;
  line_count: number;
  route_id: number | null;
  route_seq: number | null;
  stop_seq: number | null;
  planned_arrival: string | null;
  vehicle: string | null;
  delivery_outcome: "delivered" | "delivered_in_part" | "not_delivered" | null;
  delivered_at: string | null;
  receipt_at: string | null;
  receipt_ok: boolean | null;
  draft_reason: string | null;
  /** An earlier delivery attempt failed and the order was moved to this day. */
  failed_before: boolean;
};
/** An order moved off the day: deferred by the dispatcher, or requeued after a failed delivery. */
export type MovedOrder = OrderRow & {
  to_date: string;
  moved_kind: "deferred" | "requeued_after_failure";
  moved_reason: string;
  moved_note: string | null;
};
export type DayOrders = { date: string; orders: OrderRow[]; moved_away: MovedOrder[] };

export type OrderLine = { line_no: number; sku: string; name: string; unit: string; qty: number; kg: number; m3: number; fragile: boolean; high_value: boolean };

export type OrderRecord = Partial<OrderRow> & {
  order_id: number;
  confirmation_no: string;
  lines?: OrderLine[];
  outlet?: {
    address: string | null;
    access_note: string | null;
    gate_contact_name: string | null;
    depot: string;
    windows: { kind: "delivery" | "mall_access"; opens: string; closes: string }[] | null;
  } | null;
  timeline: { to_status: string; at: string; note: string | null }[];
  deferrals: { from_date: string; to_date: string; reason: string; note: string | null; decided_by: string; decided_at: string }[];
  notices: { kind: string; title: string; created_at: string; read_at: string | null }[];
  proof: { attachment_id: string; kind: string; device_time: string }[];
  history: { day: string; outcome: string }[];
};

// ---------------------------------------------------------------- helpers ----

/** Run history glyph string for <RunHistory>: d delivered · n no order · x deferred. */
export function historyGlyphs(history: { outcome: string }[] | null | undefined): string {
  return (history ?? []).map((h) => (h.outcome === "delivered" ? "d" : h.outcome === "deferred" ? "x" : "n")).join("");
}

/** Quick check of the two access rules a vehicle can fail at a glance; the server checks every rule. */
export function quickBlock(order: { temp: string; van_only: boolean }, v: { carries_chilled: boolean; is_van: boolean; active: boolean }) {
  if (!v.active) return "In the workshop";
  if (order.temp === "chilled" && !v.carries_chilled) return "Can't carry chilled goods";
  if (order.van_only && !v.is_van) return "Van-only outlet";
  return null;
}

export const vehicleLabel = (v: { source_id?: string; code: string }) => (v.source_id ? `${v.source_id} · ${v.code}` : v.code);
