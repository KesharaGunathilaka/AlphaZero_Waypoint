"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { shrinkImage, useApiData } from "@/lib/api/use-api";
import { useOutbox } from "@/lib/offline/outbox";
import {
  loadedQty,
  progressFromRow,
  sortByDeparture,
  toStops,
  toVehicle,
  type LineFlag,
  type LoadLineRow,
  type LoadProgress,
  type LoadStop,
  type PlanChangeRow,
  type RouteRow,
} from "./data";

export const DEVICE_LABEL = "loader-tablet";

/** The dock queue: released trips in departure order, their progress, and unread plan changes. */
export function useDock() {
  const outbox = useOutbox(DEVICE_LABEL);
  const feed = useApiData<{ routes: RouteRow[]; changes: PlanChangeRow[] }>("/loader/routes", 20_000);
  const { reload } = feed;

  // Whatever the outbox just delivered changes the queue: fetch it again.
  useEffect(() => {
    if (outbox.lastSyncAt) void reload();
  }, [outbox.lastSyncAt, reload]);

  const rows = useMemo(() => feed.data?.routes ?? [], [feed.data]);
  const changes = useMemo(() => feed.data?.changes ?? [], [feed.data]);
  const vehicles = useMemo(() => sortByDeparture(rows.map((r) => toVehicle(r, changes))), [rows, changes]);
  const progress = useMemo(
    () => Object.fromEntries(rows.map((r) => [String(r.route_id), progressFromRow(r)])) as Record<string, LoadProgress>,
    [rows],
  );
  const plan = rows.length ? { version: `v${Math.max(...rows.map((r) => r.plan_version))}`, serviceDate: rows[0].service_date } : null;

  /** Opening a vehicle acknowledges its plan changes: its new load list is what comes up. */
  const acknowledge = useCallback(
    (routeId: number) => {
      for (const change of changes.filter((c) => c.route_id === routeId)) {
        outbox.enqueue({ type: "plan_ack", route_id: routeId, payload: { change_id: change.change_id } });
      }
    },
    [changes, outbox],
  );

  return { feed, vehicles, progress, changes, plan, acknowledge, outbox };
}

/** What this tablet has done on a trip and not yet seen come back from the server. */
type Overlay = {
  ticks: Record<string, boolean>;
  flags: Record<string, LineFlag | null>;
  signed: Record<number, boolean>;
  released?: boolean;
};

const EMPTY_OVERLAY: Overlay = { ticks: {}, flags: {}, signed: {} };
const overlayKey = (routeId: number) => `wp-load-overlay-${routeId}`;

function readOverlay(routeId: number): Overlay {
  try {
    return { ...EMPTY_OVERLAY, ...(JSON.parse(localStorage.getItem(overlayKey(routeId)) ?? "null") as Overlay | null) };
  } catch {
    return EMPTY_OVERLAY;
  }
}

/**
 * One trip's load list. The server's record (lines confirmed, flags sent) is the truth; the tablet's
 * own unsent work sits on top of it, survives a reload, and every action goes out through the outbox.
 * Mount it with `key={routeId}` so a different trip starts from its own state.
 */
export function useLoadPlan(routeId: number, outbox: ReturnType<typeof useOutbox>) {
  const detail = useApiData<RouteRow & { lines: LoadLineRow[] }>(`/loader/routes/${routeId}`, 20_000);
  const { reload } = detail;
  const [overlay, setOverlayState] = useState<Overlay>(() => readOverlay(routeId));

  useEffect(() => {
    if (outbox.lastSyncAt) void reload();
  }, [outbox.lastSyncAt, reload]);

  const setOverlay = useCallback(
    (edit: (o: Overlay) => Overlay) =>
      setOverlayState((current) => {
        const next = edit(current);
        try {
          // Photos are not stored here (they wait in the outbox); keep the flag without the file.
          const flags = Object.fromEntries(
            Object.entries(next.flags).map(([k, f]) => [k, f ? { ...f, photoFile: undefined } : f]),
          );
          localStorage.setItem(overlayKey(routeId), JSON.stringify({ ...next, flags }));
        } catch {}
        return next;
      }),
    [routeId],
  );

  const stops: LoadStop[] = useMemo(() => {
    if (!detail.data) return [];
    return toStops(detail.data.lines).map((stop) => {
      const lines = stop.lines.map((line) => {
        const local = overlay.flags[line.id];
        // A flag the server has is sent; a newer one from this tablet replaces it until it syncs.
        const flag = local === undefined ? line.flag : local === null ? line.flag : local;
        return { ...line, confirmed: line.confirmed || Boolean(overlay.ticks[line.id]) || Boolean(local && local.type !== "Missing"), flag };
      });
      const signed = overlay.signed[stop.stopId];
      return { ...stop, lines, confirmed: signed === undefined ? stop.confirmed : signed };
    });
  }, [detail.data, overlay]);

  const toggleLine = useCallback(
    (stopNumber: number, lineId: string) => {
      const stop = stops.find((s) => s.stop === stopNumber);
      const line = stop?.lines.find((l) => l.id === lineId);
      if (!stop || !line || line.flag) return; // a flagged line is settled with the dispatcher
      setOverlay((o) => ({ ...o, ticks: { ...o.ticks, [lineId]: !line.confirmed }, signed: { ...o.signed, [stop.stopId]: false } }));
    },
    [setOverlay, stops],
  );

  /** Sign the stop off: report what went on board for every line (flags reduce it). */
  const confirmStop = useCallback(
    (stopNumber: number) => {
      const stop = stops.find((s) => s.stop === stopNumber);
      if (!stop) return;
      outbox.enqueue({
        type: "load_confirm",
        route_id: routeId,
        payload: {
          lines: stop.lines.map((line) => ({
            confirmation_id: crypto.randomUUID(),
            order_id: line.orderId,
            line_no: line.lineNo,
            qty_loaded: loadedQty(line),
          })),
        },
      });
      setOverlay((o) => ({
        ...o,
        signed: { ...o.signed, [stop.stopId]: true },
        ticks: { ...o.ticks, ...Object.fromEntries(stop.lines.map((l) => [l.id, true])) },
      }));
    },
    [outbox, routeId, setOverlay, stops],
  );

  /** Send a flag to the dispatcher (queued if offline). Removing only withdraws one not yet sent. */
  const setFlag = useCallback(
    async (stopNumber: number, lineId: string, flag: LineFlag | null) => {
      const stop = stops.find((s) => s.stop === stopNumber);
      const line = stop?.lines.find((l) => l.id === lineId);
      if (!stop || !line) return;
      setOverlay((o) => ({ ...o, flags: { ...o.flags, [lineId]: flag }, signed: { ...o.signed, [stop.stopId]: false } }));
      if (!flag) return;
      const flagId = crypto.randomUUID();
      outbox.enqueue({
        type: "flag",
        route_id: routeId,
        payload: {
          flag_id: flagId,
          type: flag.type.toLowerCase(),
          order_id: line.orderId,
          line_no: line.lineNo,
          qty: flag.units,
          note: `${line.product}: ${flag.type.toLowerCase()} ${flag.units} ${line.unit}`,
        },
      });
      if (flag.photoFile) await outbox.enqueuePhoto(await shrinkImage(flag.photoFile), "photo", { flag_id: flagId });
    },
    [outbox, routeId, setOverlay, stops],
  );

  const release = useCallback(() => {
    outbox.enqueue({ type: "route_release", route_id: routeId, payload: { release_id: crypto.randomUUID() } });
    setOverlay((o) => ({ ...o, released: true }));
  }, [outbox, routeId, setOverlay]);

  const reopen = useCallback(() => {
    outbox.enqueue({ type: "route_reopen", route_id: routeId, payload: { release_id: crypto.randomUUID() } });
    setOverlay((o) => ({ ...o, released: false }));
  }, [outbox, routeId, setOverlay]);

  const released = overlay.released ?? detail.data?.state === "loaded";
  return { detail, stops, released, toggleLine, confirmStop, setFlag, release, reopen };
}
