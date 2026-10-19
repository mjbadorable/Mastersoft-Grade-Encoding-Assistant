// Offline support: the service worker. The `offline` plugin in vite.config.ts fills in
// VERSION and FILES (the app's own built files) and writes it to dist/sw.js. Class records
// are not touched here: they stay in IndexedDB, which this worker never reads or clears.
const VERSION = __VERSION__;
const FILES = __FILES__;
const PREFIX = 'mastersoft-grade-encoding-';
const CACHE = PREFIX + VERSION;
const PAGE = new URL('./', self.location).href;

// First visit (and each new version): save every file the app needs. If one download
// fails, this version is not installed and the previous one keeps working.
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(FILES.map((f) => new Request(new URL(f, self.location), { cache: 'reload' })))),
  );
});

// A new version takes over only when the teacher clicks "Reload" (see src/app/offline.ts),
// so an open tab never switches files halfway through encoding.
self.addEventListener('message', (event) => {
  if (event.data === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      for (const key of await caches.keys()) if (key.startsWith(PREFIX) && key !== CACHE) await caches.delete(key);
      await self.clients.claim();
    })(),
  );
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== self.location.origin) return;
  if (request.mode === 'navigate') {
    if (url.pathname === new URL(PAGE).pathname || url.pathname.endsWith('/index.html')) event.respondWith(page(request));
    return;
  }
  event.respondWith(file(request));
});

/** The app page: the saved copy, so it opens (and reloads) without internet. */
async function page(request) {
  const saved = await caches.match(PAGE, { cacheName: CACHE });
  if (saved) return saved;
  try {
    return await fetch(request);
  } catch {
    return new Response(OFFLINE_PAGE, { status: 503, headers: { 'Content-Type': 'text/html; charset=utf-8' } });
  }
}

/** Scripts, styles, fonts: the saved copy, else the network (saving what it returns). */
async function file(request) {
  const saved = await caches.match(request, { cacheName: CACHE });
  if (saved) return saved;
  const response = await fetch(request);
  if (response.ok && new URL(request.url).pathname.includes('/assets/')) {
    const copy = response.clone();
    caches
      .open(CACHE)
      .then((cache) => cache.put(request, copy))
      .catch(() => {});
  }
  return response;
}

// Shown only when the app was never saved on this computer (or the browser cleared it)
// and there is no internet.
const OFFLINE_PAGE = `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Mastersoft Grade Encoding Assistant</title>
<body style="font-family:system-ui,sans-serif;max-width:32rem;margin:15vh auto;padding:0 1rem;color:#0f172a">
<h1 style="font-size:1.25rem">You're offline</h1>
<p>The app isn't saved on this computer yet, so it can't open without internet. Connect once, open the app, and it will work offline after that.</p>
<p>Classes you already saved in this browser are not affected.</p>
<p><a href="./">Try again</a></p>
</body></html>`;
