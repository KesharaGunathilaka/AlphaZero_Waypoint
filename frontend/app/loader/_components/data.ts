import type { Tone } from "@/components/waypoint/status";

// Mock data from the loader design (Dock 2, Wed 30 Sep). Replace with API data.

export type LoadingVehicle = {
  id: string;
  type: string;
  stops: number;
  departs: string;
  loaded: number;
  lines: number;
  status: { tone: Tone; label: string };
  planChanged?: boolean;
};

export const VEHICLES: LoadingVehicle[] = [
  { id: "RT-01", type: "Van", stops: 6, departs: "05:15", loaded: 44, lines: 44, status: { tone: "good", label: "✓ Ready to release" } },
  { id: "RT-03", type: "Refrigerated truck", stops: 9, departs: "05:30", loaded: 31, lines: 58, status: { tone: "info", label: "● Loading" } },
  { id: "RT-05", type: "Van", stops: 7, departs: "05:45", loaded: 0, lines: 40, status: { tone: "warn", label: "▲ Plan changed" }, planChanged: true },
  { id: "RT-02", type: "Refrigerated truck", stops: 8, departs: "06:00", loaded: 0, lines: 52, status: { tone: "offline", label: "○ Not started" } },
  { id: "RT-04", type: "Van", stops: 5, departs: "06:20", loaded: 0, lines: 33, status: { tone: "offline", label: "○ Not started" } },
];

/** Stops that are fully loaded (loaded last-stop-first). */
export const LOADED_STOPS = [
  { stop: 9, outlet: "Fresh Mount Lavinia", unload: "rear dock", lines: 8 },
  { stop: 8, outlet: "Fresh Wattala", unload: "curb", lines: 9 },
  { stop: 7, outlet: "Fresh Rajagiriya", unload: "mall bay", lines: 7 },
];

export const UPCOMING_STOPS = [
  { stop: 5, outlet: "Fresh Dehiwala", unload: "rear dock", lines: 6 },
  { stop: 4, outlet: "Fresh Nugegoda", unload: "curb", lines: 5 },
];

export type LoadLine = {
  id: string;
  product: string;
  quantity: string;
  tag: string;
  confirmed: boolean;
  /** Set when the loader flagged a problem with this line. */
  shortBy?: number;
  ordered?: number;
};

export const CURRENT_STOP_LINES: LoadLine[] = [
  { id: "chicken", product: "Frozen chicken 1 kg", quantity: "18 cartons", tag: "Frozen", confirmed: true },
  { id: "eggs", product: "Eggs, tray of 30", quantity: "14 trays", tag: "Fragile", confirmed: true },
  { id: "yoghurt", product: "Chilled yoghurt cups", quantity: "12 crates", tag: "Chilled", confirmed: true, shortBy: 2, ordered: 12 },
  { id: "milk", product: "Fresh milk 1 L", quantity: "30 crates", tag: "Chilled", confirmed: false },
];

export const FLAG_TYPES = ["Missing", "Short", "Damaged"] as const;
