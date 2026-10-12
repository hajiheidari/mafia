// کش آفلاین: بعد از اولین بار باز شدن، ابزار بدون اینترنت هم کار می‌کند.
const CACHE = 'mafia-tool-__VERSION__';
const FILES = [
  './', 'index.html', 'style.css', 'app.js', 'logic.js', 'scenarios.js', 'i18n.js',
  'lang/fa.js', 'lang/en.js', 'lang/ar.js', 'lang/ru.js', 'lang/ur.js', 'manifest.webmanifest', 'icon.svg', 'icon-192.png', 'icon-512.png',
  'fonts/vazirmatn-arabic-400-normal.woff2', 'fonts/vazirmatn-arabic-700-normal.woff2', 'fonts/vazirmatn-arabic-900-normal.woff2',
  'fonts/vazirmatn-latin-400-normal.woff2', 'fonts/vazirmatn-latin-700-normal.woff2', 'fonts/vazirmatn-latin-900-normal.woff2',
];
self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(FILES)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});
// Network first (so updates show up), cache as fallback when offline.
self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;
  e.respondWith(
    fetch(e.request)
      .then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(e.request, copy));
        return res;
      })
      .catch(() => caches.match(e.request).then((r) => r || caches.match('index.html'))),
  );
});
