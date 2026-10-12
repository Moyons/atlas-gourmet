const V = 'atlas-v6';
const CORE = ['./', 'index.html', 'styles.css', 'app.js', 'manifest.webmanifest', 'icon-192.png', 'icon-512.png'];
const SAME_ORIGIN_CORE = new Set(CORE.map(p => new URL(p, self.registration.scope).href));
self.addEventListener('install', e => { e.waitUntil(caches.open(V).then(c => c.addAll(CORE))); self.skipWaiting(); });
self.addEventListener('activate', e => { e.waitUntil(caches.keys().then(k => Promise.all(k.filter(x => x !== V).map(x => caches.delete(x))))); self.clients.claim(); });
// Red primero (siempre la última versión), caché solo del armazón de la app si no hay conexión.
// Nunca se cachean datos del usuario: ni Supabase (base de datos/fotos/sesión) ni Nominatim.
// Los ficheros propios (HTML/CSS/JS) se piden siempre con cache:'reload': así nunca hay
// mezcla de una versión nueva de un fichero con una vieja de otro (lo que rompía la app).
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  const u = new URL(e.request.url);
  if (u.hostname === 'nominatim.openstreetmap.org' || u.hostname.endsWith('.supabase.co')) return;
  const req = SAME_ORIGIN_CORE.has(u.href) ? new Request(e.request, { cache: 'reload' }) : e.request;
  e.respondWith(fetch(req).then(r => { if (r.ok || r.type === 'opaque') { const c = r.clone(); caches.open(V).then(x => x.put(e.request, c)); } return r; })
    .catch(() => caches.match(e.request).then(r => r || caches.match('index.html'))));
});
