import type { TimelineStep } from "@/components/waypoint/data";
import type { Tone } from "@/components/waypoint/status";

// Mock data from the store manager design (Fresh Pettah). Replace with API data.

export const DRY_GOODS = [
  { name: "Rice, 5 kg bag", usual: 12 },
  { name: "Sugar, 1 kg", usual: 20 },
  { name: "Dhal, 1 kg", usual: 15 },
  { name: "Coconut oil, 1 L", usual: 10 },
  { name: "Tea, 400 g", usual: 18 },
  { name: "Wheat flour, 1 kg", usual: 14 },
  { name: "Salt, 500 g", usual: 8 },
];

export const RECENT_DELIVERIES: { date: string; what: string; state: Tone; pill: string }[] = [
  { date: "Mon 28 Sep", what: "Fresh · Chilled, 6 lines", state: "good", pill: "Complete" },
  { date: "Fri 25 Sep", what: "Fresh · Dry groceries, 7 lines", state: "warn", pill: "1 line short" },
  { date: "Wed 23 Sep", what: "Fresh · Chilled, 6 lines", state: "info", pill: "Moved 1 day" },
  { date: "Mon 21 Sep", what: "Fresh · Dry groceries, 7 lines", state: "good", pill: "Complete" },
];

const CHILLED_LINES = [
  { name: "Chilled chicken, 1 kg", qty: 24 },
  { name: "Full-cream milk, 1 L", qty: 48 },
  { name: "Curd, 400 g", qty: 30 },
  { name: "Eggs, tray of 30", qty: 12 },
  { name: "Butter, 200 g", qty: 16 },
  { name: "Cheese slices, 200 g", qty: 10 },
];

const CHILLED_TIMELINE: TimelineStep[] = [
  { label: "Received", time: "Mon 28 Sep 14:10", status: "done" },
  { label: "Confirmed", time: "Mon 28 Sep 14:12", status: "done" },
  { label: "Planned", time: "Tue 29 Sep 16:40", status: "done" },
  { label: "Moved to Thu 1 Oct", time: "Tue 29 Sep 16:52", status: "attention" },
  { label: "Scheduled", time: "Arrival window appears after the plan is released", status: "current" },
  { label: "Delivered", status: "future" },
  { label: "Confirmed by you", status: "future" },
];

const DRY_TIMELINE: TimelineStep[] = [
  { label: "Received", time: "Mon 28 Sep 09:05", status: "done" },
  { label: "Confirmed", time: "Mon 28 Sep 09:06", status: "done" },
  { label: "Planned", time: "Tue 29 Sep 16:40", status: "done" },
  { label: "Scheduled", time: "Wed 30 Sep 08:30–10:00", status: "current" },
  { label: "Delivered", status: "future" },
  { label: "Confirmed by you", status: "future" },
];

/** One labelled block of the "why this order looks like this" panel on S3. */
type OrderSection = {
  label: string;
  text: string;
  /** The headline answer, set on the first section only. */
  lead?: boolean;
  pill?: { state: Tone; label: string };
};

export type OrderDetail = {
  title: string;
  subtitle: string;
  banner: { state: Tone; text: string };
  sections: OrderSection[];
  lines: { name: string; qty: number }[];
  timeline: TimelineStep[];
};

export type OrderId = "FP-4417" | "FP-4418";

export const ORDER_DETAILS: Record<OrderId, OrderDetail> = {
  "FP-4417": {
    title: "Order FP-4417 · Dry groceries",
    subtitle: "Fresh Pettah · Placed Mon 28 Sep 09:05",
    banner: { state: "good", text: "This order arrives Wed 30 Sep, 08:30–10:00." },
    sections: [
      {
        label: "ARRIVAL WINDOW",
        lead: true,
        text: "Wed 30 Sep, 08:30–10:00. 2 pallets, 46 lines of stock.",
      },
      {
        label: "CONTEXT",
        text: "Your last 5 dry grocery runs all arrived inside their window.",
        pill: { state: "good", label: "On plan" },
      },
      {
        label: "WHAT IT MEANS FOR YOU",
        text: "Nothing to do until it arrives. Unload at the rear door, then confirm receipt on the day so dispatch can close the run.",
      },
    ],
    lines: DRY_GOODS.map((g) => ({ name: g.name, qty: g.usual })),
    timeline: DRY_TIMELINE,
  },
  "FP-4418": {
    title: "Order FP-4418 · Chilled",
    subtitle: "Fresh Pettah · Placed Mon 28 Sep 14:10",
    banner: { state: "warn", text: "This order is moved from Wed 30 Sep to Thu 1 Oct." },
    sections: [
      {
        label: "WHY",
        lead: true,
        text: "No refrigerated van that can reach your store was free on Wed 30 Sep.",
      },
      {
        label: "CONTEXT",
        text: "This is the second move in the last 5 runs.",
        pill: { state: "warn", label: "Priority" },
      },
      {
        label: "WHAT IT MEANS FOR YOU",
        text: "Plan Wednesday’s chilled stock without this order. Dry groceries (FP-4417) are unaffected and still arrive Wed 30 Sep 08:30–10:00.",
      },
    ],
    lines: CHILLED_LINES,
    timeline: CHILLED_TIMELINE,
  },
};

export type DeliveredLine = {
  name: string;
  ordered: number;
  delivered: number;
  /** Shown under the line when the shortfall was known before delivery. */
  note?: string;
};

export const DELIVERED_LINES: DeliveredLine[] = [
  { name: "Rice, 5 kg bag", ordered: 12, delivered: 12 },
  { name: "Sugar, 1 kg", ordered: 20, delivered: 20 },
  {
    name: "Dhal, 1 kg",
    ordered: 15,
    delivered: 12,
    note: "Dispatch told you at 07:15 that 3 units were short at the warehouse. The driver delivered what was loaded.",
  },
  { name: "Coconut oil, 1 L", ordered: 10, delivered: 10 },
  { name: "Tea, 400 g", ordered: 18, delivered: 18 },
];

export const ISSUE_TYPES = ["Short", "Damaged", "Wrong item", "Not received"] as const;
export type IssueType = (typeof ISSUE_TYPES)[number];
export type Issue = { type: IssueType; qty: number; photo?: string };
/** An issue together with the delivered line it was reported against. */
export type ReportedIssue = Issue & { line: string; reference: string };
