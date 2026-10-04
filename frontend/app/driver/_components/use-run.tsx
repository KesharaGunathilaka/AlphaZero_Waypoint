"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { shrinkImage, useApiData } from "@/lib/api/use-api";
import { useOutbox } from "@/lib/offline/outbox";
import type { DriverRun, LocalRecord, Outcome, SnapshotOrder, SnapshotRoute, SnapshotStop } from "./data";

const RUN_CACHE = "wp-driver-run";
const RECORDS = "wp-driver-records";
const ARRIVALS = "wp-driver-arrivals";
const DEPARTURES = "wp-driver-departures";

function readJson<T>(key: string, fallback: T): T {
  try {
    return (JSON.parse(localStorage.getItem(key) ?? "null") as T) ?? fallback;
  } catch {
    return fallback;
  }
}
function writeJson(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {}
}

export type StopStatus = "done" | "current" | "todo";
export type RunStop = SnapshotStop & {
  routeId: number;
  status: StopStatus;
  opens: string | null;
  closes: string | null;
  arrivedAt: string | null;
  /** Per order: the server's delivery or the one saved on this phone. */
  outcomes: Record<number, Outcome>;
  /** Units the loader put on board per order line (`${order_id}-${line_no}`). */
  loaded: Record<string, number>;
};
export type RunTrip = Omit<SnapshotRoute, "stops"> & { state: string; departed: boolean; stops: RunStop[]; done: boolean };

type DeliveryInput = {
  stop: RunStop;
  order: SnapshotOrder;
  outcome: Outcome;
  receivedBy: string | null;
  reasonCode: string | null;
  note: string | null;
  lines: { line_no: number; delivered_qty: number; reason_code?: string | null }[];
  signature: Blob | null;
  photos: File[];
  supersedes: string | null;
};

function useRunState() {
  const outbox = useOutbox("driver-phone");
  const api = useApiData<DriverRun>("/driver/run", 30_000);
  const { reload } = api;
  const [cache] = useState<DriverRun | null>(() => readJson<DriverRun | null>(RUN_CACHE, null));
  const [records, setRecords] = useState<Record<number, LocalRecord>>(() => readJson(RECORDS, {}));
  const [arrivals, setArrivals] = useState<Record<number, string>>(() => readJson(ARRIVALS, {}));
  const [departures, setDepartures] = useState<Record<number, string>>(() => readJson(DEPARTURES, {}));

  // Keep the last run on the phone: it is what the driver works from when there is no signal.
  useEffect(() => {
    if (api.data) writeJson(RUN_CACHE, api.data);
  }, [api.data]);
  // Whatever the outbox just delivered changes the run: fetch it again.
  useEffect(() => {
    if (outbox.lastSyncAt) void reload();
  }, [outbox.lastSyncAt, reload]);

  const run = api.data ?? cache;

  const trips: RunTrip[] = useMemo(() => {
    if (!run) return [];
    const states = new Map(run.route_states.map((r) => [r.route_id, r]));
    const windows = new Map(run.windows.map((w) => [w.stop_id, w]));
    const delivered = new Map<number, Outcome>(run.deliveries.map((d) => [d.order_id, d.outcome]));
    for (const r of Object.values(records)) delivered.set(r.order_id, r.outcome);
    const loaded = new Map(run.loaded.map((l) => [`${l.order_id}-${l.line_no}`, Number(l.qty_loaded)]));
    const routes = run.plans.flatMap((p) => p.routes).sort((a, b) => a.depart_at.localeCompare(b.depart_at));

    let currentFound = false;
    return routes.map((route) => {
      const state = states.get(route.route_id);
      const stops: RunStop[] = route.stops.map((stop) => {
        const outcomes: Record<number, Outcome> = {};
        for (const o of stop.orders) {
          const d = delivered.get(o.order_id);
          if (d) outcomes[o.order_id] = d;
        }
        const done = stop.orders.length > 0 && stop.orders.every((o) => outcomes[o.order_id]);
        let status: StopStatus = done ? "done" : "todo";
        if (!done && !currentFound) {
          status = "current";
          currentFound = true;
        }
        const w = windows.get(stop.stop_id);
        const lineLoads: Record<string, number> = {};
        for (const o of stop.orders) for (const l of o.lines ?? []) {
          const key = `${o.order_id}-${l.line_no}`;
          lineLoads[key] = loaded.get(key) ?? Number(l.qty);
        }
        return { ...stop, routeId: route.route_id, status, opens: w?.opens ?? null, closes: w?.closes ?? null,
                 arrivedAt: arrivals[stop.stop_id] ?? null, outcomes, loaded: lineLoads };
      });
      const departed = Boolean(state?.departed_at) || ["on_the_way", "complete"].includes(state?.state ?? "") || Boolean(departures[route.route_id]);
      return { ...route, state: state?.state ?? "planned", departed, stops, done: stops.every((s) => s.status === "done") };
    });
  }, [run, records, arrivals, departures]);

  const currentTrip = trips.find((t) => !t.done) ?? trips[trips.length - 1] ?? null;
  const currentStop = currentTrip?.stops.find((s) => s.status === "current") ?? null;

  const depart = useCallback(
    (trip: RunTrip) => {
      if (trip.departed) return;
      outbox.enqueue({ type: "depart", route_id: trip.route_id, payload: {} });
      setDepartures((d) => {
        const next = { ...d, [trip.route_id]: new Date().toISOString() };
        writeJson(DEPARTURES, next);
        return next;
      });
    },
    [outbox],
  );

  const arrive = useCallback(
    (stop: RunStop) => {
      if (arrivals[stop.stop_id]) return;
      const trip = trips.find((t) => t.route_id === stop.routeId);
      if (trip) depart(trip); // arriving at a stop means the trip has left the depot
      const at = new Date().toISOString();
      outbox.enqueue({ type: "arrive", route_id: stop.routeId, stop_id: stop.stop_id, payload: {} });
      setArrivals((a) => {
        const next = { ...a, [stop.stop_id]: at };
        writeJson(ARRIVALS, next);
        return next;
      });
    },
    [arrivals, depart, outbox, trips],
  );

  /** Save one order's delivery on the phone; the outbox sends it, then its signature and photos. */
  const saveDelivery = useCallback(
    async (input: DeliveryInput) => {
      const { stop, order } = input;
      if (!arrivals[stop.stop_id]) arrive(stop);
      const deliveryId = crypto.randomUUID();
      const event = outbox.enqueue({
        type: "delivery",
        route_id: stop.routeId,
        stop_id: stop.stop_id,
        payload: {
          delivery_id: deliveryId,
          order_id: order.order_id,
          outcome: input.outcome,
          received_by: input.receivedBy,
          reason_code: input.reasonCode,
          note: input.note,
          supersedes_id: input.supersedes,
          lines: input.lines,
        },
      });
      if (input.signature) await outbox.enqueuePhoto(input.signature, "signature", { delivery_id: deliveryId });
      for (const photo of input.photos) await outbox.enqueuePhoto(await shrinkImage(photo), "photo", { delivery_id: deliveryId });
      const record: LocalRecord = {
        delivery_id: deliveryId,
        event_id: event.event_id,
        order_id: order.order_id,
        stop_id: stop.stop_id,
        route_id: stop.routeId,
        outcome: input.outcome,
        received_by: input.receivedBy,
        reason: input.reasonCode,
        lines: input.lines.map((l) => ({ line_no: l.line_no, delivered_qty: l.delivered_qty })),
        photos: input.photos.length,
        signed: Boolean(input.signature),
        recorded_at: event.device_time,
        supersedes_id: input.supersedes,
      };
      setRecords((r) => {
        const next = { ...r, [order.order_id]: record };
        writeJson(RECORDS, next);
        return next;
      });
      return record;
    },
    [arrivals, arrive, outbox],
  );

  const reportProblem = useCallback(
    (type: string, minutesLate: number | null, note: string | null) => {
      const trip = currentTrip;
      if (!trip) return;
      outbox.enqueue({
        type: "flag",
        route_id: trip.route_id,
        stop_id: currentStop?.stop_id ?? null,
        payload: { flag_id: crypto.randomUUID(), type, minutes_late: minutesLate, note },
      });
    },
    [currentStop, currentTrip, outbox],
  );

  const seeInstruction = useCallback(
    (instruction: DriverRun["instructions"][number]) =>
      outbox.enqueue({ type: "instruction_seen", route_id: instruction.route_id, payload: { instruction_id: instruction.instruction_id } }),
    [outbox],
  );

  // Heartbeat while a trip is on the road and there is signal, so the dispatcher sees a live phone.
  useEffect(() => {
    const onRoad = trips.some((t) => t.departed && !t.done);
    if (!onRoad) return;
    const timer = setInterval(() => {
      if (outbox.online) outbox.enqueue({ type: "heartbeat", route_id: currentTrip?.route_id ?? null, payload: {} });
    }, 60_000);
    return () => clearInterval(timer);
  }, [currentTrip, outbox, trips]);

  /** Whether a saved record has left the phone. */
  const isSent = useCallback((record: LocalRecord) => !outbox.pendingEvents.some((e) => e.event_id === record.event_id), [outbox.pendingEvents]);

  return {
    outbox,
    run,
    fromCache: !api.data && Boolean(cache),
    error: api.error,
    trips,
    currentTrip,
    currentStop,
    records,
    instructions: (run?.instructions ?? []).filter((i) => !outbox.pendingEvents.some((e) => e.payload?.instruction_id === i.instruction_id)),
    depart,
    arrive,
    saveDelivery,
    reportProblem,
    seeInstruction,
    isSent,
  };
}

export type RunState = ReturnType<typeof useRunState>;
const RunContext = createContext<RunState | null>(null);

export function RunProvider({ children }: { children: ReactNode }) {
  const state = useRunState();
  return <RunContext.Provider value={state}>{children}</RunContext.Provider>;
}

export function useRun(): RunState {
  const run = useContext(RunContext);
  if (!run) throw new Error("useRun is only available inside <RunProvider>.");
  return run;
}
