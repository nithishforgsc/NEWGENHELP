const CACHE_NAME = "newgenhelp-v5-tactical";
const STATIC_ASSETS =[
    "./index.html",
    "./style.css",
    "./script.js",
    "./firebase.js",
    "./manifest.json",
    "https://fonts.googleapis.com/css2?family=Montserrat:wght@300;400;600;800&family=Playfair+Display:ital,wght@0,400;0,600;0,800;1,400&display=swap",
    "https://unpkg.com/deck.gl@8.9.0/dist.min.js",
    "https://unpkg.com/maplibre-gl@3.6.2/dist/maplibre-gl.js",
    "https://unpkg.com/maplibre-gl@3.6.2/dist/maplibre-gl.css",
    "https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js",
    "https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js",
    "https://cdn.jsdelivr.net/npm/@tensorflow/tfjs",
    "https://cdn.jsdelivr.net/npm/chart.js"
];

self.addEventListener("install", (evt) => {
    evt.waitUntil(
        caches.open(CACHE_NAME).then((cache) => {
            return cache.addAll(STATIC_ASSETS);
        })
    );
    self.skipWaiting();
});

self.addEventListener("activate", (evt) => {
    evt.waitUntil(
        caches.keys().then((keys) => {
            return Promise.all(
                keys.map((key) => {
                    if (key !== CACHE_NAME) return caches.delete(key);
                })
            );
        })
    );
    self.clients.claim();
});

self.addEventListener("fetch", (evt) => {
    if (evt.request.method !== "GET") return;
    evt.respondWith(
        fetch(evt.request).catch(() => caches.match(evt.request))
    );
});