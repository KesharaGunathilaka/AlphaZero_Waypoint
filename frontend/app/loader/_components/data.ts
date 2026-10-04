import type { Tone } from "@/components/waypoint/status";

// Mock data from the loader design (Dock 2, Wed 30 Sep). Replace with API data.

export type LoadingVehicle = {
  id: string;
  type: string;
  stops: number;
  departs: string;
  /** What the load is measured against, derived from the plan the vehicle carries. */
  capacityKg: number;
  capacityM3: number;
  /** Set by a plan change the loader has not opened yet, of either kind. */
  planChanged?: boolean;
  /** The departure time a plan change moved this vehicle away from. Outlives the notice. */
  retimedFrom?: string;
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
  at: string;
};

export type LoadLine = {
  id: string;
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

const PRODUCTS = [
  { product: "Frozen chicken 1 kg", units: 18, unit: "cartons", tag: "Frozen", weightKg: 54, volumeM3: 0.42 },
  { product: "Eggs, tray of 30", units: 14, unit: "trays", tag: "Fragile", weightKg: 28, volumeM3: 0.36 },
  { product: "Chilled yoghurt cups", units: 12, unit: "crates", tag: "Chilled", weightKg: 38, volumeM3: 0.3 },
  { product: "Fresh milk 1 L", units: 30, unit: "crates", tag: "Chilled", weightKg: 62, volumeM3: 0.45 },
  { product: "Bread loaves", units: 20, unit: "crates", tag: "Dry", weightKg: 24, volumeM3: 0.38 },
  { product: "Bottled water 1.5 L", units: 15, unit: "crates", tag: "Dry", weightKg: 68, volumeM3: 0.26 },
  { product: "Leafy greens", units: 10, unit: "crates", tag: "Chilled", weightKg: 22, volumeM3: 0.33 },
  { product: "Rice 5 kg", units: 16, unit: "bags", tag: "Dry", weightKg: 80, volumeM3: 0.24 },
  { product: "Butter 200 g", units: 8, unit: "crates", tag: "Chilled", weightKg: 18, volumeM3: 0.14 },
  { product: "Frozen prawns 500 g", units: 9, unit: "cartons", tag: "Frozen", weightKg: 36, volumeM3: 0.2 },
  { product: "Tomatoes", units: 11, unit: "crates", tag: "Fragile", weightKg: 44, volumeM3: 0.28 },
  { product: "Cooking oil 1 L", units: 12, unit: "cases", tag: "Dry", weightKg: 52, volumeM3: 0.22 },
];

/** Outlets repeat across vehicles in the mock; a real run comes from the plan. */
const OUTLETS = [
  "Fresh Mount Lavinia",
  "Fresh Wattala",
  "Fresh Rajagiriya",
  "Fresh Borella",
  "Fresh Dehiwala",
  "Fresh Nugegoda",
  "Fresh Kotte",
  "Fresh Maharagama",
  "Fresh Pettah",
  "Fresh Moratuwa",
  "Fresh Kelaniya",
  "Fresh Battaramulla",
];

const UNLOAD = ["rear dock", "curb", "mall bay", "curb", "rear dock", "curb", "mall bay", "rear dock", "curb"];

type VehicleSeed = {
  id: string;
  type: string;
  departs: string;
  /** Lines per stop in load order: the last stop of the run loads first. */
  lineCounts: number[];
  /** Lines already on board when this shift picked up the tablet. */
  loaded: number;
  outletFrom: number;
};

const SEEDS: VehicleSeed[] = [
  { id: "RT-01", type: "Van", departs: "05:15", lineCounts: [8, 7, 8, 7, 7, 7], loaded: 44, outletFrom: 6 },
  { id: "RT-03", type: "Refrigerated truck", departs: "05:30", lineCounts: [8, 9, 7, 9, 6, 5, 5, 4, 5], loaded: 31, outletFrom: 0 },
  { id: "RT-05", type: "Van", departs: "05:45", lineCounts: [6, 6, 6, 6, 6, 5, 5], loaded: 0, outletFrom: 3 },
  { id: "RT-02", type: "Refrigerated truck", departs: "06:00", lineCounts: [7, 7, 7, 6, 6, 6, 7, 6], loaded: 0, outletFrom: 9 },
  { id: "RT-04", type: "Van", departs: "06:20", lineCounts: [7, 7, 7, 6, 6], loaded: 0, outletFrom: 1 },
];

/** Stop 1 delivers first at 06:10, and every later stop is twelve minutes behind it. */
function deliverBy(stop: number) {
  const minutes = 6 * 60 + 10 + (stop - 1) * 12;
  return `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
}

/** Builds a run's stops in load order, with the lines that were already on board confirmed. */
function buildStops(seed: VehicleSeed): LoadStop[] {
  const stopCount = seed.lineCounts.length;
  let lineIndex = 0;

  return seed.lineCounts.map((count, index) => {
    const stop = stopCount - index;
    const lines = Array.from({ length: count }, (_, i) => {
      const line: LoadLine = {
        ...PRODUCTS[lineIndex % PRODUCTS.length],
        id: `s${stop}-l${i + 1}`,
        confirmed: lineIndex < seed.loaded,
      };
      lineIndex += 1;
      return line;
    });

    return {
      stop,
      outlet: OUTLETS[(seed.outletFrom + index) % OUTLETS.length],
      unload: UNLOAD[index % UNLOAD.length],
      deliverBy: deliverBy(stop),
      lines,
      // Stops finished before this shift came on were signed off by the last one.
      confirmed: lines.every((line) => line.confirmed),
    };
  });
}

/** A full load sits just under capacity, which is what the departure check reports. */
function capacityFor(stops: LoadStop[]) {
  const lines = stops.flatMap((s) => s.lines);
  const kg = lines.reduce((total, l) => total + l.weightKg, 0);
  const m3 = lines.reduce((total, l) => total + l.volumeM3, 0);
  return {
    capacityKg: Math.round(kg / 0.93 / 50) * 50,
    capacityM3: Math.round((m3 / 0.93) * 2) / 2,
  };
}

const RUNS = SEEDS.map((seed) => ({ seed, stops: buildStops(seed) }));

/** The load list each vehicle starts the shift with, by vehicle. */
export const LOAD_PLANS: Record<string, LoadStop[]> = Object.fromEntries(
  RUNS.map(({ seed, stops }) => [seed.id, stops]),
);

export const VEHICLES: LoadingVehicle[] = RUNS.map(({ seed, stops }) => ({
  id: seed.id,
  type: seed.type,
  departs: seed.departs,
  stops: stops.length,
  ...capacityFor(stops),
}));

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

export function progressOf(stops: LoadStop[]): LoadProgress {
  const progress: LoadProgress = {
    lines: 0,
    confirmed: 0,
    outstanding: 0,
    flags: 0,
    stops: stops.length,
    stopsConfirmed: 0,
    weightKg: 0,
    volumeM3: 0,
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

export type PlanVersion = { version: string; at: string };

/** A plan the dispatcher re-issued to this dock, for one vehicle. */
export type PlanChange = {
  plan: PlanVersion;
  vehicleId: string;
  /** The new departure time, when the plan moved it. */
  departs?: string;
  /** Stops whose order or contents changed, when the plan re-ordered the run. */
  changedStops?: number;
};

/**
 * The queue is worked in departure order, so it is always sorted by time rather
 * than by the order the vehicles arrived in. Times are zero-padded 24h, which
 * sorts correctly as text.
 */
export function sortByDeparture(vehicles: LoadingVehicle[]) {
  return [...vehicles].sort((a, b) => a.departs.localeCompare(b.departs));
}

/** Falls back to the first vehicle so a screen always has one to render. */
export function findVehicle(vehicles: LoadingVehicle[], id: string) {
  return vehicles.find((v) => v.id === id) ?? vehicles[0];
}

/**
 * Applies a re-issued plan: the vehicle keeps its new departure time, is marked
 * so the loader can see what changed, and the queue re-sorts around it.
 */
export function applyPlanChange(vehicles: LoadingVehicle[], change: PlanChange) {
  return sortByDeparture(
    vehicles.map((vehicle) => {
      if (vehicle.id !== change.vehicleId) return vehicle;
      const retimed = change.departs !== undefined && change.departs !== vehicle.departs;
      return {
        ...vehicle,
        departs: change.departs ?? vehicle.departs,
        retimedFrom: retimed ? vehicle.departs : vehicle.retimedFrom,
        changedStops: change.changedStops ?? vehicle.changedStops,
        planChanged: true,
      };
    }),
  );
}

/**
 * Clears the notice once the loader has opened that vehicle's new load list.
 * The new departure time and where it moved the vehicle to are not a notice, so
 * `retimedFrom` stays on the card for the rest of the shift.
 */
export function acknowledgePlanChange(vehicles: LoadingVehicle[], id: string) {
  return vehicles.map((vehicle) =>
    vehicle.id === id ? { ...vehicle, planChanged: undefined, changedStops: undefined } : vehicle,
  );
}

export const INITIAL_PLAN: PlanVersion = { version: "v18", at: "03:48" };

/** Changes that arrived before this shift opened the tablet. */
export const RECEIVED_PLAN_CHANGES: PlanChange[] = [
  { plan: INITIAL_PLAN, vehicleId: "RT-05", changedStops: 2 },
];

/**
 * Changes the dispatcher has yet to re-issue. Stand-in for the live plan
 * subscription: `use-plan-feed` delivers them on a timer so the queue behaves
 * the way it will once the feed is real.
 */
export const INCOMING_PLAN_CHANGES: PlanChange[] = [
  { plan: { version: "v19", at: "04:06" }, vehicleId: "RT-02", departs: "05:20" },
];

export const PLAN_FEED_DELAY_MS = 6000;
