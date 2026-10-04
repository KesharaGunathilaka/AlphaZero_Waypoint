import type { Brand } from "@/components/waypoint/data";
import type { Tone } from "@/components/waypoint/status";

// Mock data from the dispatcher design. Replace with API data.

export type Order = {
  id: string;
  brand: Brand;
  outlet: string;
  kg: number;
  m3: number;
  fuel: number;
  chilled: boolean;
  vanOnly: boolean;
  window: string;
  flags: string;
  cannotFit?: boolean;
};

export const ORDERS: Order[] = [
  { id: "o1", brand: "fresh", outlet: "Fresh Borella", kg: 260, m3: 1.8, fuel: 4, chilled: true, vanOnly: false, window: "06:30–07:30", flags: "Chilled · Rear access" },
  { id: "o2", brand: "style", outlet: "Style Kollupitiya", kg: 180, m3: 1.2, fuel: 3, chilled: false, vanOnly: true, window: "07:00–09:00", flags: "Van-only outlet" },
  { id: "o3", brand: "fresh", outlet: "Fresh Pettah", kg: 420, m3: 3.1, fuel: 12, chilled: true, vanOnly: false, window: "06:00–07:00", flags: "Chilled · Narrow lane", cannotFit: true },
  { id: "o4", brand: "style", outlet: "Style Nugegoda", kg: 310, m3: 2.4, fuel: 9, chilled: false, vanOnly: true, window: "07:30–09:30", flags: "Van-only outlet", cannotFit: true },
  { id: "o5", brand: "tech", outlet: "Tech Dehiwala", kg: 540, m3: 4.0, fuel: 14, chilled: false, vanOnly: false, window: "08:00–11:00", flags: "Loading bay 2", cannotFit: true },
];

/** Orders that D2 defers once the dispatcher confirms. */
export const DEFERRABLE_ORDER_IDS = ["o3", "o4", "o5"];

export type Vehicle = {
  id: string;
  type: string;
  truck: boolean;
  chilled: boolean;
  capKg: number;
  capM3: number;
  /** Weight used, % of limit. */
  w: number;
  /** Volume used, % of limit. */
  v: number;
  fuel: number;
  /** Planned stop times, minutes after midnight. */
  stops: number[];
  route2: string;
};

export const VEHICLES: Vehicle[] = [
  { id: "RT-03", type: "Refrigerated truck", truck: true, chilled: true, capKg: 6000, capM3: 30, w: 92, v: 96, fuel: 38, stops: [400, 430, 465, 500, 545, 600], route2: "3 stops, 10:30 to 12:00" },
  { id: "RT-07", type: "Refrigerated truck", truck: true, chilled: true, capKg: 6000, capM3: 30, w: 58, v: 61, fuel: 10, stops: [390, 420, 470, 520], route2: "No stops yet" },
  { id: "RT-09", type: "Truck, ambient", truck: true, chilled: false, capKg: 6000, capM3: 30, w: 88, v: 97, fuel: 52, stops: [410, 445, 495, 540, 590], route2: "2 stops, 11:00 to 12:00" },
  { id: "VN-12", type: "Van, ambient", truck: false, chilled: false, capKg: 1200, capM3: 10, w: 70, v: 80, fuel: 30, stops: [395, 425, 460, 505], route2: "No stops yet" },
  { id: "VN-14", type: "Refrigerated van", truck: false, chilled: true, capKg: 1200, capM3: 12, w: 50, v: 88, fuel: 24, stops: [400, 440, 480], route2: "1 stop, 10:45" },
];

/** Why a vehicle cannot take an order, or null if it fits. */
export function blockReason(order: Order, vehicle: Vehicle): string | null {
  if (order.chilled && !vehicle.chilled) return "Can't carry chilled goods";
  if (order.vanOnly && vehicle.truck) return "Van-only outlet";
  if (vehicle.fuel < order.fuel) return "Fuel quota short";
  if (vehicle.v + (order.m3 / vehicle.capM3) * 100 > 100) return "Volume full";
  if (vehicle.w + (order.kg / vehicle.capKg) * 100 > 100) return "Weight full";
  return null;
}

/** Vehicles with the dispatcher's assignments applied. */
export function withAssignments(assigned: Record<string, string>): Vehicle[] {
  return VEHICLES.map((vehicle) => {
    const x = { ...vehicle, stops: [...vehicle.stops] };
    for (const order of ORDERS) {
      if (assigned[order.id] !== vehicle.id) continue;
      x.w += (order.kg / vehicle.capKg) * 100;
      x.v += (order.m3 / vehicle.capM3) * 100;
      x.fuel -= order.fuel;
      x.stops.push(540 + x.stops.length * 5);
    }
    return x;
  });
}

export function formatMinutes(m: number): string {
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
}

export const DEFERRAL_REASONS = [
  "No refrigerated capacity",
  "Van-only and vans full",
  "Window cannot be met",
  "Fuel quota exhausted",
  "Vehicle volume full",
  "Other (note required)",
];
export const OTHER_REASON = DEFERRAL_REASONS.length - 1;

export type Deferral = {
  id: string;
  brand: Brand;
  outlet: string;
  load: string;
  found: string;
  history: string;
  pill: string;
  pillState: Tone;
  consequence: string;
  blocker: string;
  defaultReason: number;
  /** Second consecutive skip: a written note is required. */
  streak?: boolean;
};

export const DEFERRALS: Deferral[] = [
  { id: "c", brand: "tech", outlet: "Tech Dehiwala", load: "540 kg · 4.0 m³", found: "Fuel quota exhausted for the only truck with free volume.", history: "dddxx", pill: "2nd consecutive skip", pillState: "warn", consequence: "Tech Dehiwala has now gone two runs without a delivery. The store manager is told the reason and Thu 1 Oct.", blocker: "RT-07", defaultReason: 3, streak: true },
  { id: "a", brand: "fresh", outlet: "Fresh Pettah", load: "420 kg · 3.1 m³", found: "No refrigerated van that can reach this store was free.", history: "ddndd", pill: "No recent skips", pillState: "good", consequence: "Fresh Pettah gets no chilled delivery on Wed 30 Sep and is moved to Thu 1 Oct.", blocker: "RT-03", defaultReason: 0 },
  { id: "b", brand: "style", outlet: "Style Nugegoda", load: "310 kg · 2.4 m³", found: "Van-only outlet and every van is full on volume.", history: "ddxdd", pill: "1 skip in last 5", pillState: "info", consequence: "Style Nugegoda is told the order moves to Thu 1 Oct.", blocker: "VN-12", defaultReason: 1 },
];

export type Attention = {
  id: string;
  type: string;
  state: Tone;
  what: string;
  detail: string;
  age: string;
  actions: string[];
};

export const ATTENTION: Attention[] = [
  { id: "a1", type: "Late", state: "warn", what: "RT-03 · Fresh Maradana is 14 min late", detail: "Stop 4 of 6. Planned 07:40, now 07:54 ETA against plan.", age: "6 min ago", actions: ["Call driver", "Tell store", "Send instruction"] },
  { id: "a2", type: "No signal", state: "offline", what: "VN-12 · silent since 05:31", detail: "Kandy road. Over the 20 min threshold. Stop 2 of 4 due 06:10.", age: "27 min ago", actions: ["Call driver", "Send instruction"] },
  { id: "a3", type: "Delivery failed", state: "crit", what: "RT-09 · Tech Wattala not delivered", detail: "Driver reason: outlet closed. 380 kg still on board.", age: "2 min ago", actions: ["Call driver", "Tell store", "Reassign to Route 2"] },
  { id: "a4", type: "Short-loaded", state: "crit", what: "RT-07 · 2 of 14 crates missing", detail: "Loader flag at dock 3. Affects Fresh Borella and Fresh Slave Island.", age: "19 min ago", actions: ["Tell store", "Send instruction"] },
  { id: "a5", type: "Driver reported", state: "info", what: "VN-14 · road flooded on Negombo Rd", detail: "Driver suggests reordering stops 3 and 4.", age: "4 min ago", actions: ["Call driver", "Send instruction"] },
];

export type FleetRow = {
  id: string;
  /** ● done · ◉ now · ○ to do · ✕ problem */
  dots: string;
  next: string;
  planned: string;
  state: Tone;
  status: string;
};

export const FLEET: FleetRow[] = [
  { id: "RT-09", dots: "●●✕◉○○", next: "Tech Wattala", planned: "07:20", state: "crit", status: "Delivery failed" },
  { id: "VN-12", dots: "●◉○○", next: "Fresh Peradeniya", planned: "06:10", state: "offline", status: "No signal" },
  { id: "RT-03", dots: "●●●◉○○", next: "Fresh Maradana", planned: "07:40", state: "warn", status: "14 min late" },
  { id: "RT-07", dots: "●◉○○", next: "Fresh Borella", planned: "06:50", state: "crit", status: "Short-loaded" },
  { id: "VN-14", dots: "●●◉", next: "Style Ja-Ela", planned: "07:15", state: "info", status: "Driver reported" },
  { id: "RT-11", dots: "●●●●◉○", next: "Tech Rajagiriya", planned: "08:05", state: "good", status: "On time" },
  { id: "VN-08", dots: "●●◉○", next: "Style Wellawatte", planned: "07:30", state: "good", status: "On time" },
  { id: "RT-05", dots: "●●●●●", next: "Depot return", planned: "09:30", state: "good", status: "On time" },
];

const STOP_NAMES = ["Fresh Fort", "Style Bambalapitiya", "Tech Havelock", "Fresh Mount Lavinia", "Style Maharagama", "Tech Kotte"];

/** Stop-by-stop plan against actual for one vehicle (mocked from its status dots). */
export function stopDetail(row: FleetRow) {
  const glyphs = row.dots.split("");
  return glyphs.map((glyph, i) => {
    const plan = 380 + i * 32 + row.id.length * 3;
    const done = glyph === "●";
    const failed = glyph === "✕";
    const isDepotReturn = row.id === "RT-05" && i === glyphs.length - 1;
    return {
      glyph,
      name: isDepotReturn ? "Depot return" : STOP_NAMES[(i + row.id.charCodeAt(3)) % STOP_NAMES.length],
      plan: formatMinutes(plan),
      actual: done ? formatMinutes(plan + (i === 2 ? 14 : 2)) : failed ? "Failed" : "—",
      failed,
      proof: done ? "Signature, photo" : failed ? "Outlet closed" : "",
    };
  });
}

export type LedgerRow = {
  outlet: string;
  brand: Brand;
  order: string;
  run: string;
  outcome: "Deferred" | "Delivered with an issue";
  state: Tone;
  reason: string;
  by: string;
  when: string;
  /** Consecutive runs skipped. */
  streak: number;
  history: string;
  timeline: [time: string, text: string][];
  proof: "yes" | "none" | "na";
  deviceTime?: string;
};

export const LEDGER: LedgerRow[] = [
  { outlet: "Tech Dehiwala", brand: "tech", order: "#4821", run: "Tue 29 Sep", outcome: "Deferred", state: "warn", reason: "Fuel quota exhausted", by: "Kasun", when: "Mon 28 Sep 16:42", streak: 2, history: "dddxx", timeline: [["15:58", "Order confirmed"], ["16:20", "Plan v3 built"], ["16:42", "Deferred by Kasun: fuel quota exhausted. Note: second run without delivery, truck refuelled Wed."], ["16:43", "Store manager told"], ["16:51", "Store manager read"]], proof: "na" },
  { outlet: "Fresh Kirulapone", brand: "fresh", order: "#4790", run: "Mon 28 Sep", outcome: "Deferred", state: "warn", reason: "No refrigerated capacity", by: "Kasun", when: "Sun 27 Sep 16:31", streak: 2, history: "ddxxn", timeline: [["15:40", "Order confirmed"], ["16:31", "Deferred by Kasun: no refrigerated capacity"], ["16:32", "Store manager told"], ["17:05", "Store manager read"]], proof: "na" },
  { outlet: "Style Nugegoda", brand: "style", order: "#4755", run: "Sat 26 Sep", outcome: "Deferred", state: "info", reason: "Van-only and vans full", by: "Nimali", when: "Fri 25 Sep 16:18", streak: 1, history: "ddxdd", timeline: [["15:22", "Order confirmed"], ["16:18", "Deferred by Nimali: vans full"], ["16:19", "Store manager told"], ["16:40", "Store manager read"]], proof: "na" },
  { outlet: "Fresh Pettah", brand: "fresh", order: "#4741", run: "Fri 25 Sep", outcome: "Delivered with an issue", state: "warn", reason: "2 of 40 crates damaged", by: "Driver RT-03", when: "Fri 25 Sep 07:42", streak: 0, history: "ddddd", timeline: [["15:58", "Order confirmed"], ["16:20", "Plan v3 released"], ["07:42", "Delivered. Driver flagged 2 damaged crates."]], proof: "yes", deviceTime: "07:42" },
  { outlet: "Tech Rajagiriya", brand: "tech", order: "#4736", run: "Fri 25 Sep", outcome: "Delivered with an issue", state: "warn", reason: "Signature missing", by: "Driver RT-11", when: "Fri 25 Sep 08:12", streak: 0, history: "ddddd", timeline: [["16:20", "Plan v3 released"], ["08:12", "Delivered. Store contact unavailable, photo taken."]], proof: "none" },
  { outlet: "Style Wellawatte", brand: "style", order: "#4720", run: "Thu 24 Sep", outcome: "Deferred", state: "info", reason: "Window cannot be met", by: "Kasun", when: "Wed 23 Sep 16:25", streak: 1, history: "dxddn", timeline: [["15:10", "Order confirmed"], ["16:25", "Deferred by Kasun: window cannot be met"], ["16:26", "Store manager told"]], proof: "na" },
];

/** Deferrals per day over the last week; null = depot closed. */
export const DEFERRALS_PER_DAY: [day: string, count: number | null][] = [
  ["Tue", 2], ["Wed", 1], ["Thu", 3], ["Fri", 2], ["Sat", 4], ["Sun", null], ["Mon", 2],
];
