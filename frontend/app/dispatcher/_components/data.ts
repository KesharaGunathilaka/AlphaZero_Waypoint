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
};

// ---------------------------------------------------------------- monitor ----
export type RunProgress = {
  run_id: number;
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
};
export type Exception = {
  kind: string;
  urgency: number;
  severity: string;
  route_id: number | null;
  stop_id: number | null;
  order_id: number | null;
  flag_id: string | null;
  since: string | null;
  detail: string;
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
export type Monitor = { runs: RunProgress[]; fleet: FleetRow[]; exceptions: Exception[]; stops: MonitorStop[]; server_time: string };

export const EXCEPTION_STYLE: Record<string, { label: string; state: Tone }> = {
  delivery_failed: { label: "Delivery failed", state: "crit" },
  driver_reported: { label: "Driver reported", state: "info" },
  short_loaded: { label: "Short-loaded", state: "crit" },
  no_signal: { label: "No signal", state: "offline" },
  late: { label: "Late", state: "warn" },
  loader_flag: { label: "Loader flag", state: "warn" },
  plan_conflict: { label: "Plan conflict", state: "warn" },
  instruction_unseen: { label: "Instruction unseen", state: "info" },
  rejected_event: { label: "Record rejected", state: "warn" },
};

// ----------------------------------------------------------------- ledger ----
export type LedgerRecord = {
  record_type: "deferral" | "delivery";
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

export type OrderRecord = {
  order_id: number;
  confirmation_no: string;
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
