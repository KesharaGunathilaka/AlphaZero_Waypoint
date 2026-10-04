import type { Brand, TimelineStep } from "@/components/waypoint/data";
import type { Tone } from "@/components/waypoint/status";
import { formatDay, formatDayTime, formatTime } from "@/lib/format";

// Shapes returned by the API (backend/app/modules/store/router.py; see docs/api.md).

export type Temp = "ambient" | "chilled";

export type Outlet = {
  outlet_id: number;
  code: string;
  name: string;
  brand_code: "F" | "S" | "T";
  brand_name: string;
  district: string;
  depot: string;
  unload: "rear_dock" | "street" | "mall_bay";
  van_only: boolean;
  windows: { kind: string; opens: string; closes: string }[] | null;
};

export type Product = {
  product_id: number;
  sku: string;
  name: string;
  temp: Temp;
  unit: string;
};

export type OrderLine = { line_no: number; product_id?: number; product: string; unit: string; qty: number };

export type StoreOrder = {
  order_id: number;
  confirmation_no: string;
  brand_code: "F" | "S" | "T";
  temp: Temp;
  status:
    | "placed" | "confirmed" | "planned" | "loading" | "loaded" | "on_the_way"
    | "delivered" | "delivered_in_part" | "not_delivered" | "received";
  delivery_date: string;
  original_delivery_date: string;
  deferral_count: number;
  placed_at: string;
  window_start: string | null;
  window_end: string | null;
  unload: Outlet["unload"];
  moved_from: string | null;
  moved_to: string | null;
  moved_reason: string | null;
  moved_consecutive: boolean | null;
  delivery_outcome: string | null;
  delivered_at: string | null;
  needs_receipt: boolean;
  receipt_at: string | null;
  stops_before_yours: number | null;
  lines: OrderLine[] | null;
};

export type ReceiptLine = {
  line_no: number;
  product_name: string;
  unit: string;
  ordered_qty: number;
  expected_qty: number | null;
  delivered_qty: number | null;
  short_loaded: boolean | null;
  issue_type: string | null;
  reference_no: string | null;
};

export type OrderDetailData = StoreOrder & {
  lines: OrderLine[];
  receipt_lines: ReceiptLine[];
  timeline: { history_id: number; from_status: string | null; to_status: string; at: string; note: string | null }[];
  proof: { attachment_id: string; kind: "photo" | "signature" }[];
  cutoff_at: string | null;
  changeable: boolean;
  delivery: {
    delivery_id: string;
    outcome: string;
    received_by: string | null;
    delivered_at: string;
    driver_name: string;
    vehicle_code: string;
    vehicle_source_id: string;
  } | null;
  issues: { issue_id: string; reference_no: string; line_no: number; type: string; qty: number | null; product: string }[];
};

export type OrderSlot = {
  delivery_date: string;
  cutoff_at: string;
  closed_date: string | null;
  joins_later_run: boolean;
  existing_order_id: number | null;
  existing_status: StoreOrder["status"] | null;
};

export type Notice = {
  notice_id: number;
  order_id: number | null;
  kind: string;
  title: string;
  body: string;
  created_at: string;
  read_at: string | null;
};

// ------------------------------------------------------------------ helpers ----

export const BRAND: Record<StoreOrder["brand_code"], Brand> = { F: "fresh", S: "style", T: "tech" };

const UNLOAD: Record<Outlet["unload"], string> = {
  rear_dock: "Unload at the rear dock",
  street: "Unload at the kerb",
  mall_bay: "Unload at the shared mall bay",
};
export const unloadNote = (unload: Outlet["unload"]) => UNLOAD[unload];

/** "Fresh · Dry groceries", "Fresh · Chilled", "Style", "Tech". */
export function orderKind(order: Pick<StoreOrder, "brand_code" | "temp">): string {
  if (order.brand_code === "F") return order.temp === "chilled" ? "Fresh · Chilled" : "Fresh · Dry groceries";
  return order.brand_code === "S" ? "Style" : "Tech";
}

export const categoryName = (brand: StoreOrder["brand_code"], temp: Temp) =>
  brand === "F" ? (temp === "chilled" ? "Chilled" : "Dry groceries") : brand === "S" ? "Garments" : "Appliances";

export const isMoved = (o: StoreOrder) => o.deferral_count > 0 && o.moved_to !== null && o.status !== "received";

export function arrivalWindow(o: StoreOrder): string | null {
  return o.window_start && o.window_end ? `${formatTime(o.window_start)}–${formatTime(o.window_end)}` : null;
}

/** The one-word state of an order, with the tone of its pill. */
export function orderPill(o: StoreOrder): { state: Tone; label: string } {
  if (o.needs_receipt) return { state: "warn", label: "Confirm receipt" };
  switch (o.status) {
    case "placed": return { state: "info", label: "Received" };
    case "confirmed": return isMoved(o) ? { state: "warn", label: "Moved" } : { state: "info", label: "Confirmed" };
    case "planned": return isMoved(o) ? { state: "warn", label: "Moved" } : { state: "good", label: "Scheduled" };
    case "loading": case "loaded": return { state: "good", label: "Loading at depot" };
    case "on_the_way": return { state: "info", label: "On the way" };
    case "not_delivered": return { state: "crit", label: "Not delivered" };
    case "received": return { state: "good", label: "Complete" };
    default: return { state: "info", label: o.status };
  }
}

/** The status spine as the design's timeline: what happened, when, and what comes next. */
export function orderTimeline(o: OrderDetailData): TimelineStep[] {
  const at = (status: string) => o.timeline.find((t) => t.to_status === status)?.at;
  const reached = (status: string) => Boolean(at(status));
  const steps: TimelineStep[] = [
    { label: "Received", time: at("placed") && formatDayTime(at("placed")!), status: "done" },
    { label: "Confirmed at cutoff", time: at("confirmed") && formatDayTime(at("confirmed")!),
      status: reached("confirmed") ? "done" : "current" },
  ];
  if (o.moved_to && o.moved_from) {
    steps.push({ label: `Moved to ${formatDay(o.moved_to)}`, time: `from ${formatDay(o.moved_from)}`, status: "attention" });
  }
  const window = arrivalWindow(o);
  steps.push(
    { label: "Scheduled", time: window ? `${formatDay(o.delivery_date)} ${window}` : "Arrival window appears after the plan is released",
      status: reached("planned") ? "done" : reached("confirmed") ? "current" : "future" },
    { label: "Loaded", time: at("loaded") && formatDayTime(at("loaded")!),
      status: reached("loaded") ? "done" : reached("planned") ? "current" : "future" },
    { label: "Delivered", time: o.delivered_at ? formatDayTime(o.delivered_at) : undefined,
      status: o.delivered_at ? "done" : reached("on_the_way") ? "current" : "future" },
    { label: "Confirmed by you", time: o.receipt_at ? formatDayTime(o.receipt_at) : undefined,
      status: o.receipt_at ? "done" : o.needs_receipt ? "current" : "future" },
  );
  // Only one step is "current": the first one not done.
  let seen = false;
  return steps.map((s) => (s.status === "current" ? (seen ? { ...s, status: "future" } : ((seen = true), s)) : s));
}

/**
 * A delivered line has two separate gaps, so neither is called "short" on its own:
 *
 * - ordered → driver delivered: the warehouse could not supply it. Known before the van left,
 *   explained by dispatch, and not something the manager reports. Shown as "short at the warehouse".
 * - driver delivered → you received: the manager cannot find what the driver's record says was
 *   handed over. That is the gap these issue types describe.
 */
export const ISSUE_TYPES = ["Missing", "Damaged", "Wrong item", "Nothing arrived"] as const;
export type IssueType = (typeof ISSUE_TYPES)[number];

/** How each issue type is sent to the API (receipt_issue.type). */
export const ISSUE_API_TYPE: Record<IssueType, "short" | "damaged" | "wrong_item" | "not_received"> = {
  Missing: "short",
  Damaged: "damaged",
  "Wrong item": "wrong_item",
  "Nothing arrived": "not_received",
};

export type Issue = {
  type: IssueType;
  /** Units affected. "Nothing arrived" always covers the whole line. */
  qty: number;
  /** What arrived instead, for a wrong item. */
  instead?: string;
  photo?: File;
};

/** An issue together with the delivered line it was reported against. */
export type ReportedIssue = Issue & { line: string; reference: string };

/**
 * How each issue reads on the line, and whether it changes the count you received.
 * "Damaged" units did arrive, so they are received but unusable.
 */
export const ISSUE_RULES: Record<IssueType, { prompt: string; qtyLabel: string; reducesReceived: boolean }> = {
  Missing: {
    prompt: "How many of the units the driver recorded are missing?",
    qtyLabel: "Units missing",
    reducesReceived: true,
  },
  Damaged: { prompt: "How many units are damaged?", qtyLabel: "Units damaged", reducesReceived: false },
  "Wrong item": { prompt: "How many units are the wrong item?", qtyLabel: "Wrong units", reducesReceived: true },
  "Nothing arrived": { prompt: "None of this line arrived.", qtyLabel: "Units missing", reducesReceived: true },
};
