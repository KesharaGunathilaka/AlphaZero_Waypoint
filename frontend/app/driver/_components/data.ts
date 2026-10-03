// Shapes of GET /driver/run (backend/app/modules/field/router.py; see docs/api.md) and the model the
// driver's screens use. The run is the plan snapshot the dispatcher released, kept on the phone.

/** Dispatch desk, dialled from the call buttons. A demo number: the booklet gives none. */
export const DISPATCHER = { name: "Dispatch desk", tel: "+94810000000" };

export type SnapshotLine = { line_no: number; product_id: number; sku: string; name: string; qty: number; unit: string; temp: string };
export type SnapshotOrder = { order_id: number; ref: string; temp: "ambient" | "chilled"; deferral_count: number; lines: SnapshotLine[] | null };
export type SnapshotStop = {
  stop_id: number;
  seq: number;
  planned_arrival: string;
  deliver_by: string | null;
  service_minutes: number;
  outlet: {
    outlet_id: number;
    code: string;
    name: string;
    brand: "F" | "S" | "T";
    address: string | null;
    unload: "rear_dock" | "street" | "mall_bay";
    access_note: string | null;
    contact_name: string | null;
    contact_phone: string | null;
  };
  proof: { need_signature: boolean; need_photo: boolean } | null;
  orders: SnapshotOrder[];
};
export type SnapshotRoute = {
  route_id: number;
  seq: number;
  vehicle_code: string;
  vehicle_class: string;
  refrigerated: boolean;
  depart_at: string;
  return_at: string;
  stops: SnapshotStop[];
};

export type DriverRun = {
  driver: { name: string; vehicle_source_id: string | null; vehicle_code: string | null; vehicle_class: string | null; depot: string | null } | null;
  plans: { plan_id: number; version: number; service_date: string; released_at: string; routes: SnapshotRoute[] }[];
  deliveries: { delivery_id: string; order_id: number; stop_id: number; outcome: Outcome; device_time: string }[];
  route_states: { route_id: number; state: string; departed_at: string | null }[];
  loaded: { order_id: number; line_no: number; qty_loaded: number }[];
  windows: { stop_id: number; opens: string; closes: string }[];
  instructions: { instruction_id: string; route_id: number; stop_id: number | null; type: string; text: string | null; sent_at: string; state: string }[];
  server_time: string;
};

export type Outcome = "delivered" | "delivered_in_part" | "not_delivered";

export const UNLOAD_LABEL: Record<SnapshotStop["outlet"]["unload"], string> = {
  rear_dock: "Rear dock",
  street: "Kerbside",
  mall_bay: "Shared mall bay",
};

export const BRAND_CLASS: Record<"F" | "S" | "T", string> = {
  F: "bg-wp-brand-fresh",
  S: "bg-wp-brand-style",
  T: "bg-wp-brand-tech",
};

/** Reasons the database accepts (reason_code), in the driver's words. */
export const NOT_DELIVERED_REASONS = [
  { code: "outlet_closed", label: "Outlet closed" },
  { code: "access_blocked", label: "Access blocked" },
  { code: "refused", label: "Refused" },
  { code: "window_missed", label: "Window missed" },
  { code: "other", label: "Other (note required)" },
] as const;

export const SHORT_REASONS = [
  { code: "damaged", label: "Damaged in transit" },
  { code: "refused_item", label: "Store refused the item" },
  { code: "not_on_vehicle", label: "Not on the vehicle" },
  { code: "other", label: "Other (note required)" },
] as const;

export const PROBLEMS = [
  { code: "running_late", label: "Running late" },
  { code: "cannot_reach", label: "Can’t reach the outlet" },
  { code: "outlet_closed", label: "Outlet closed" },
  { code: "vehicle_problem", label: "Vehicle problem" },
  { code: "load_problem", label: "Load problem" },
  { code: "other", label: "Something else" },
] as const;

/** Opens the phone's map app at the outlet, rather than shipping our own turn-by-turn. */
export function navigationUrl(stop: SnapshotStop) {
  const q = stop.outlet.address ?? `Waypoint ${stop.outlet.name}, Sri Lanka`;
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(q)}`;
}

/** A delivery saved on this phone, kept so the driver can see and correct it before and after it is sent. */
export type LocalRecord = {
  delivery_id: string;
  event_id: string;
  order_id: number;
  stop_id: number;
  route_id: number;
  outcome: Outcome;
  received_by: string | null;
  reason: string | null;
  lines: { line_no: number; delivered_qty: number }[];
  photos: number;
  signed: boolean;
  recorded_at: string;
  supersedes_id: string | null;
};
