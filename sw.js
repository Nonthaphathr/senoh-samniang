const V = 'senoh-v2-3';
const SHELL = ['./', 'index.html', 'manifest.webmanifest', 'css/app.css', 'js/config.js', 'js/forms.js', 'js/analyzer.js', 'js/segment.js', 'js/analyzer.worker.js', 'js/data.js', 'js/student.js', 'js/teacher.js', 'poems/index.json', 'assets/logo.png', 'assets/logo-256.png', 'assets/favicon-32.png', 'assets/icon-192.png', 'assets/btn-listen.png', 'assets/btn-record.png', 'assets/btn-result.png', 'assets/btn-history.png'];
self.addEventListener('install', e => { e.waitUntil(caches.open(V).then(c => c.addAll(SHELL)).then(() => self.skipWaiting())); });
self.addEventListener('activate', e => { e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== V).map(k => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener('fetch', e => {
  const r = e.request;
  if (r.method !== 'GET' || new URL(r.url).origin !== location.origin) return;
  e.respondWith(fetch(r).then(res => { if (res.status === 200) { const cp = res.clone(); caches.open(V).then(c => c.put(r, cp)); } return res; }).catch(() => caches.match(r)));
});
