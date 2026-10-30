// Offline support: the app shell is cached on install; models and thumbnails are cached the first time they are opened.
const VERSION = 'gkb-v0.8.1';
const SHELL = [
  './', 'index.html', 'kocka.html', 'staze.html', 'css/staze.css', 'js/staze.js', 'manifest.webmanifest', 'css/museum.css', 'css/kocka.css',
  'js/museum.js', 'js/kocka.js', 'js/i18n.js', 'js/cv/detector.js', 'js/cv/pose.js', 'js/cv/tracker.js',
  'js/vendor/three/three.module.min.js', 'js/vendor/three/three.core.min.js',
  'js/vendor/three/addons/loaders/GLTFLoader.js', 'js/vendor/three/addons/utils/BufferGeometryUtils.js', 'js/vendor/three/addons/utils/SkeletonUtils.js',
  'js/vendor/three/addons/libs/meshopt_decoder.module.js', 'js/vendor/three/addons/environments/RoomEnvironment.js',
  'js/vendor/three/addons/controls/OrbitControls.js', 'data/layout.json', 'data/exhibits.json', 'data/skyline.json', 'icons/icon-192.png',
];
self.addEventListener('install', e => {
  e.waitUntil(caches.open(VERSION).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== VERSION).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;
  const isData = url.pathname.endsWith('.json');
  if (isData) {   // data: network first so new exhibits appear, cache as fallback
    e.respondWith(fetch(e.request).then(r => { const copy = r.clone(); caches.open(VERSION).then(c => c.put(e.request, copy)); return r; })
      .catch(() => caches.match(e.request)));
    return;
  }
  e.respondWith(caches.match(e.request, { ignoreSearch: url.pathname.endsWith('.html') || url.pathname.endsWith('/') }).then(hit => hit || fetch(e.request).then(r => {
    if (r.ok && /\.(glb|png|jpg|webp|js|css|html)$/.test(url.pathname)) { const copy = r.clone(); caches.open(VERSION).then(c => c.put(e.request, copy)); }
    return r;
  })));
});
