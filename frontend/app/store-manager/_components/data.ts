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

export const CHILLED_LINES = [
  { name: "Chilled chicken, 1 kg", qty: 24 },
  { name: "Full-cream milk, 1 L", qty: 48 },
  { name: "Curd, 400 g", qty: 30 },
  { name: "Eggs, tray of 30", qty: 12 },
  { name: "Butter, 200 g", qty: 16 },
  { name: "Cheese slices, 200 g", qty: 10 },
];

export const CHILLED_ORDER_TIMELINE: TimelineStep[] = [
  { label: "Received", time: "Mon 28 Sep 14:10", status: "done" },
  { label: "Confirmed", time: "Mon 28 Sep 14:12", status: "done" },
  { label: "Planned", time: "Tue 29 Sep 16:40", status: "done" },
  { label: "Moved to Thu 1 Oct", time: "Tue 29 Sep 16:52", status: "attention" },
  { label: "Scheduled", time: "Arrival window appears after the plan is released", status: "current" },
  { label: "Delivered", status: "future" },
  { label: "Confirmed by you", status: "future" },
];

export type DeliveredLine = {
  name: string;
  ordered: number;
  delivered: number;
  /** Shown under the line when the shortfall was known before delivery. */
  note?: string;
  /** The line the store manager can report an issue against in this prototype. */
  reportable?: boolean;
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
  { name: "Coconut oil, 1 L", ordered: 10, delivered: 10, reportable: true },
  { name: "Tea, 400 g", ordered: 18, delivered: 18 },
];

export const ISSUE_TYPES = ["Short", "Damaged", "Wrong item", "Not received"] as const;
export type IssueType = (typeof ISSUE_TYPES)[number];
export type Issue = { type: IssueType; qty: number };
