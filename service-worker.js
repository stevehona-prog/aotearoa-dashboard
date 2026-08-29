// Bump this string on every deploy you want viewers to pick up promptly.
// It's what forces old caches to be thrown away — see the "activate" handler below.
const CACHE_VERSION = "v7";
const CACHE_NAME = `aotearoa-dashboard-${CACHE_VERSION}`;

const PRECACHE_ASSETS = [
  "./",
  "./index.html",
  "./manifest.webmanifest",
  "./icon-192.png",
  "./icon-512.png",
  "./apple-touch-icon.png",
  "./favicon.png"
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(PRECACHE_ASSETS))
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key)))
    )
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  // Leave cross-origin requests (Google sign-in, Gmail API) to the browser's
  // normal fetch handling — they carry auth headers and must never be cached
  // or served stale from here.
  if (!request.url.startsWith(self.location.origin)) return;

  const isHTML =
    request.mode === "navigate" ||
    (request.headers.get("accept") || "").includes("text/html");

  if (isHTML) {
    // Network-first for the page itself, so a change you deploy shows up on the
    // next load instead of being masked by a stale cached copy. Falls back to
    // the cached shell only if the phone is offline.
    event.respondWith(
      fetch(request)
        .then((response) => {
          const copy = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
          return response;
        })
        .catch(() => caches.match(request).then((cached) => cached || caches.match("./index.html")))
    );
    return;
  }

  // Cache-first for static assets (icons, manifest) — they rarely change and
  // this is what lets the app open instantly and work offline.
  event.respondWith(
    caches.match(request).then(
      (cached) =>
        cached ||
        fetch(request).then((response) => {
          const copy = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
          return response;
        })
    )
  );
});
