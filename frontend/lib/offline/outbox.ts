"use client";

/**
 * The device outbox: work done on the loader tablet or the driver's phone is saved here first and sent
 * to POST /sync whenever there is a connection. Nothing waits for the network.
 *
 * - Every action is an event with its own UUID and the time it happened on the device. The server
 *   ignores an event_id it already has, so resending after a dropped connection is always safe.
 * - Events live in localStorage; photos (bigger) in IndexedDB. Both survive a reload or a dead battery.
 * - Photos go up after the events they belong to (a delivery photo needs its delivery on the server).
 */

import { useCallback, useEffect, useSyncExternalStore } from "react";
import { apiRequest } from "@/lib/api/client";
import { useGetToken } from "@/lib/auth-client";

export type OutboxEvent = {
  event_id: string;
  type: string;
  route_id?: number | null;
  stop_id?: number | null;
  payload?: Record<string, unknown>;
  device_time: string;
};

type QueuedPhoto = {
  attachment_id: string;
  kind: "photo" | "signature";
  /** The record it belongs to: one of delivery_id / flag_id / issue_id. */
  link: Record<string, string>;
  device_time: string;
  tries: number;
};

export type SyncResult = { event_id: string; state: "applied" | "rejected" | null; reject_reason: string | null };

type State = {
  events: OutboxEvent[];
  photos: QueuedPhoto[];
  syncing: boolean;
  lastSyncAt: string | null;
  lastError: string | null;
  /** Events the server refused, with its reason (shown to the user, never retried). */
  rejected: SyncResult[];
};

const EVENTS_KEY = "wp-outbox-events";
const PHOTOS_KEY = "wp-outbox-photos";
const DEVICE_KEY = "wp-device-id";
const SYNCED_KEY = "wp-last-sync";
const SIMULATE_KEY = "wp-simulate-offline";

/**
 * "Simulate no signal": the demo switch that makes this browser behave as if it had no connection
 * (nothing is sent; everything waits in the outbox). Lets the offline scenario be shown on a laptop.
 */
let simulatedOffline = typeof window !== "undefined" && localStorage.getItem(SIMULATE_KEY) === "1";

export function setSimulatedOffline(on: boolean) {
  simulatedOffline = on;
  try {
    localStorage.setItem(SIMULATE_KEY, on ? "1" : "0");
  } catch {}
  listeners.forEach((l) => l());
}

const connected = () => typeof navigator !== "undefined" && navigator.onLine && !simulatedOffline;

// ------------------------------------------------------------------ store ----
// One queue per role on this browser (see deviceId), each persisted under its own keys.
const EMPTY: State = { events: [], photos: [], syncing: false, lastSyncAt: null, lastError: null, rejected: [] };
const stores = new Map<string, State>();
const listeners = new Set<() => void>();

function read<T>(key: string, fallback: T): T {
  try {
    return (JSON.parse(localStorage.getItem(key) ?? "null") as T) ?? fallback;
  } catch {
    return fallback;
  }
}

function get(label: string): State {
  let current = stores.get(label);
  if (!current) {
    current = typeof window === "undefined"
      ? EMPTY
      : { ...EMPTY, events: read(`${EVENTS_KEY}:${label}`, []), photos: read(`${PHOTOS_KEY}:${label}`, []),
          lastSyncAt: read(`${SYNCED_KEY}:${label}`, null) };
    if (typeof window !== "undefined") stores.set(label, current);
  }
  return current;
}

function set(label: string, next: Partial<State>) {
  const current = { ...get(label), ...next };
  stores.set(label, current);
  try {
    localStorage.setItem(`${EVENTS_KEY}:${label}`, JSON.stringify(current.events));
    localStorage.setItem(`${PHOTOS_KEY}:${label}`, JSON.stringify(current.photos));
    if (current.lastSyncAt) localStorage.setItem(`${SYNCED_KEY}:${label}`, JSON.stringify(current.lastSyncAt));
  } catch {
    // Storage full or blocked: the queue still works for this session.
  }
  listeners.forEach((l) => l());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/**
 * One device id per role on this browser: the server registers a device as a loader tablet or a
 * driver phone, and a judge may try both roles in the same browser.
 */
export function deviceId(label: string): string {
  const key = `${DEVICE_KEY}:${label}`;
  let id = localStorage.getItem(key);
  if (!id) {
    id = crypto.randomUUID();
    localStorage.setItem(key, id);
  }
  return id;
}

// ------------------------------------------------------------- photo blobs ----
function photoDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open("waypoint-outbox", 1);
    req.onupgradeneeded = () => req.result.createObjectStore("photos");
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function blobStore<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await photoDb();
  return new Promise((resolve, reject) => {
    const req = run(db.transaction("photos", mode).objectStore("photos"));
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

// ------------------------------------------------------------------- send ----
type GetToken = () => Promise<string | null>;

async function flush(getToken: GetToken, label: string) {
  const state = () => get(label);
  if (state().syncing || !connected()) return;
  if (state().events.length === 0 && state().photos.length === 0) return;
  set(label, { syncing: true, lastError: null });
  try {
    const batch = state().events.slice(0, 200);
    if (batch.length) {
      const res = await apiRequest<{ results: SyncResult[]; server_time: string }>("/sync", {
        method: "POST",
        getToken,
        body: { device_id: deviceId(label), label, client_now: new Date().toISOString(), events: batch },
      });
      const sent = new Set(batch.map((e) => e.event_id));
      const refused = res.results.filter((r) => r.state === "rejected");
      // Applied, pending (the server retries it) or rejected: the server has it either way.
      set(label, {
        events: state().events.filter((e) => !sent.has(e.event_id)),
        rejected: [...refused, ...state().rejected].slice(0, 20),
      });
    }
    for (const photo of [...state().photos]) {
      const blob = await blobStore<Blob | undefined>("readonly", (s) => s.get(photo.attachment_id));
      if (!blob) {
        set(label, { photos: state().photos.filter((p) => p.attachment_id !== photo.attachment_id) });
        continue;
      }
      const form = new FormData();
      form.append("file", blob, `${photo.attachment_id}.jpg`);
      form.append("kind", photo.kind);
      form.append("attachment_id", photo.attachment_id);
      form.append("device_time", photo.device_time);
      for (const [k, v] of Object.entries(photo.link)) form.append(k, v);
      const token = await getToken();
      const base = (process.env.NEXT_PUBLIC_API_URL ?? "").replace(/\/+$/, "");
      const res = await fetch(`${base}/api/v1/attachments`, {
        method: "POST",
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        body: form,
      });
      if (res.ok || photo.tries >= 5) {
        await blobStore("readwrite", (s) => s.delete(photo.attachment_id));
        set(label, { photos: state().photos.filter((p) => p.attachment_id !== photo.attachment_id) });
      } else {
        set(label, {
          photos: state().photos.map((p) => (p.attachment_id === photo.attachment_id ? { ...p, tries: p.tries + 1 } : p)),
        });
      }
    }
    set(label, { lastSyncAt: new Date().toISOString() });
  } catch (e) {
    set(label, { lastError: e instanceof Error ? e.message : "Sync failed" });
  } finally {
    set(label, { syncing: false });
  }
}

// ------------------------------------------------------------------- hook ----
export function useOutbox(label: string) {
  const getToken = useGetToken();
  const snapshot = useSyncExternalStore(subscribe, () => get(label), () => EMPTY);
  const online = useSyncExternalStore(
    (cb) => {
      window.addEventListener("online", cb);
      window.addEventListener("offline", cb);
      listeners.add(cb);
      return () => {
        window.removeEventListener("online", cb);
        window.removeEventListener("offline", cb);
        listeners.delete(cb);
      };
    },
    connected,
    () => true,
  );
  const simulated = useSyncExternalStore(subscribe, () => simulatedOffline, () => false);

  const sync = useCallback(() => flush(() => getToken(), label), [getToken, label]);

  // Send whenever the connection comes back, and every 20 s while there is anything waiting.
  useEffect(() => {
    void sync();
    const timer = setInterval(() => void sync(), 20_000);
    window.addEventListener("online", sync);
    return () => {
      clearInterval(timer);
      window.removeEventListener("online", sync);
    };
  }, [sync]);

  /** Record an action. Returns at once; the outbox sends it when it can. */
  const enqueue = useCallback(
    (event: Omit<OutboxEvent, "event_id" | "device_time"> & { event_id?: string }) => {
      const full: OutboxEvent = { event_id: crypto.randomUUID(), device_time: new Date().toISOString(), ...event };
      set(label, { events: [...get(label).events, full] });
      void sync();
      return full;
    },
    [label, sync],
  );

  /** Queue a photo for a record (sent after the record's own event). */
  const enqueuePhoto = useCallback(
    async (blob: Blob, kind: "photo" | "signature", link: Record<string, string>) => {
      const attachment_id = crypto.randomUUID();
      await blobStore("readwrite", (s) => s.put(blob, attachment_id));
      set(label, {
        photos: [...get(label).photos, { attachment_id, kind, link, device_time: new Date().toISOString(), tries: 0 }],
      });
      void sync();
      return attachment_id;
    },
    [label, sync],
  );

  const dismissRejected = useCallback(() => set(label, { rejected: [] }), [label]);

  const simulate = useCallback(
    (on: boolean) => {
      setSimulatedOffline(on);
      if (!on) void sync();
    },
    [sync],
  );

  return {
    online,
    simulated,
    simulate,
    pending: snapshot.events.length + snapshot.photos.length,
    pendingEvents: snapshot.events,
    syncing: snapshot.syncing,
    lastSyncAt: snapshot.lastSyncAt,
    lastError: snapshot.lastError,
    rejected: snapshot.rejected,
    enqueue,
    enqueuePhoto,
    sync,
    dismissRejected,
  };
}
