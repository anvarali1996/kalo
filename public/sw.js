/* The offline cache contains the fallback page and its icon. */
const CACHE_NAME = "kalo-offline-v5";
const OFFLINE_PAGE = "/offline.html";
const OFFLINE_ICON = "/icons/kalo-balance-192.png";
const FILES = [OFFLINE_PAGE, OFFLINE_ICON];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(FILES))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(
      keys.filter((key) => key.startsWith("kalo-offline-") && key !== CACHE_NAME)
        .map((key) => caches.delete(key))
    )).then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (request.destination === "image" && url.pathname === OFFLINE_ICON && !url.search) {
    event.respondWith(caches.match(OFFLINE_ICON, { cacheName: CACHE_NAME }).then((cached) => cached ?? fetch(request)));
    return;
  }

  if (request.mode !== "navigate" || url.pathname === "/api" || url.pathname.startsWith("/api/")) return;

  // Keep app pages on the network and use the static fallback for a lost connection.
  event.respondWith(
    fetch(request).catch(async () => {
      const cache = await caches.open(CACHE_NAME);
      return (await cache.match(OFFLINE_PAGE)) ?? Response.error();
    })
  );
});
