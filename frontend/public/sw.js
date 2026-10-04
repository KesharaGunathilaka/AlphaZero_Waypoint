/*
 * Waypoint driver service worker (registered by app/driver only, in production builds).
 *
 * Its one job: the driver's app opens again after a reload in a dead zone. The run itself and the
 * records waiting to send live in localStorage / IndexedDB (lib/offline/outbox.ts), not here.
 *
 * - Build assets (/_next/static) never change once built: cache first.
 * - Driver pages: network first, falling back to the last copy when there is no signal.
 * - Everything else (the API, Clerk, maps) is left alone.
 */
const CACHE = "waypoint-driver-v1";

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (url.pathname.startsWith("/_next/static/")) {
    event.respondWith(
      caches.open(CACHE).then(async (cache) => {
        const hit = await cache.match(request);
        if (hit) return hit;
        const response = await fetch(request);
        if (response.ok) cache.put(request, response.clone());
        return response;
      }),
    );
    return;
  }

  if (request.mode === "navigate" && url.pathname.startsWith("/driver")) {
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (response.ok) caches.open(CACHE).then((cache) => cache.put("/driver", response.clone()));
          return response;
        })
        .catch(async () => (await caches.match("/driver")) ?? Response.error()),
    );
  }
});
