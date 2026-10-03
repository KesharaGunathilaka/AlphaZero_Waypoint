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

export type RecentDelivery = {
  date: string;
  what: string;
  state: Tone;
  pill: string;
  /** The brief record shown when the row is opened. */
  order: string;
  arrived: string;
  driver: string;
  counted: string;
  confirmed: string;
  summary: string;
  /** Issues raised against this delivery, with the reference dispatch holds. */
  issues?: string[];
};

export const RECENT_DELIVERIES: RecentDelivery[] = [
  {
    date: "Mon 28 Sep",
    what: "Fresh · Chilled, 6 lines",
    state: "good",
    pill: "Complete",
    order: "FP-4402",
    arrived: "Mon 28 Sep 08:52",
    driver: "K. Perera · RT-03",
    counted: "6 lines · 140 units",
    confirmed: "Mon 28 Sep 09:20",
    summary: "Every line arrived inside the 08:30–10:00 window and matched your order.",
  },
  {
    date: "Fri 25 Sep",
    what: "Fresh · Dry groceries, 7 lines",
    state: "warn",
    pill: "1 issue raised",
    order: "FP-4388",
    arrived: "Fri 25 Sep 09:05",
    driver: "M. Silva · RT-07",
    counted: "7 lines · 93 of 97 units",
    confirmed: "Fri 25 Sep 09:40",
    summary:
      "The driver recorded 20 units of Sugar 1 kg, but only 16 came off the van. Dispatch issued a reference the same morning.",
    issues: ["IS-7694 · Sugar, 1 kg · 4 missing"],
  },
  {
    date: "Wed 23 Sep",
    what: "Fresh · Chilled, 6 lines",
    state: "info",
    pill: "Moved 1 day",
    order: "FP-4371",
    arrived: "Thu 24 Sep 08:40",
    driver: "K. Perera · RT-03",
    counted: "6 lines · 140 units",
    confirmed: "Thu 24 Sep 09:05",
    summary: "No refrigerated van was free on Wed 23 Sep, so this order came a day later. Everything arrived.",
  },
  {
    date: "Mon 21 Sep",
    what: "Fresh · Dry groceries, 7 lines",
    state: "good",
    pill: "Complete",
    order: "FP-4355",
    arrived: "Mon 21 Sep 08:48",
    driver: "S. Bandara · RT-11",
    counted: "7 lines · 97 units",
    confirmed: "Mon 21 Sep 09:12",
    summary: "Every line matched your order. Nothing reported.",
  },
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

export type OrderId = "FP-4417" | "FP-4418";

export type OrderDetail = {
  id: OrderId;
  /** What the order is made of, which decides the list you edit when you change it. */
  category: string;
  title: string;
  subtitle: string;
  delivery: string;
  banner: { state: Tone; text: string };
  /** An order can be changed until its cutoff passes; after that only dispatch can move it. */
  change: { open: boolean; cutoff: string; note: string };
  sections: OrderSection[];
  lines: { name: string; qty: number }[];
  timeline: TimelineStep[];
};

export const ORDER_DETAILS: Record<OrderId, OrderDetail> = {
  "FP-4417": {
    id: "FP-4417",
    category: "Dry groceries",
    title: "Order FP-4417 · Dry groceries",
    subtitle: "Fresh Pettah · Placed Mon 28 Sep 09:05",
    delivery: "Wed 30 Sep, 08:30–10:00",
    banner: { state: "good", text: "This order arrives Wed 30 Sep, 08:30–10:00." },
    change: {
      open: false,
      cutoff: "Tue 29 Sep 16:00",
      note: "This order is already on a van plan, so it can no longer be changed here. Call the dispatch desk if something must move.",
    },
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
    id: "FP-4418",
    category: "Chilled",
    title: "Order FP-4418 · Chilled",
    subtitle: "Fresh Pettah · Placed Mon 28 Sep 14:10",
    delivery: "Thu 1 Oct",
    banner: { state: "warn", text: "This order is moved from Wed 30 Sep to Thu 1 Oct." },
    change: {
      open: true,
      cutoff: "Wed 30 Sep 16:00",
      note: "The move reopened this order. You can change what is on it until the 16:00 cutoff on Wed 30 Sep.",
    },
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

export type Issue = {
  type: IssueType;
  /** Units affected. "Nothing arrived" always covers the whole line. */
  qty: number;
  /** What arrived instead, for a wrong item. */
  instead?: string;
  photo?: string;
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
