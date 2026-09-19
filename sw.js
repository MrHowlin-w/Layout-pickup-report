/* ══════════════════════════════════════════════════════════════════
   S³ Layout / Pick-Up Report — Service Worker
   • Rend l'app installable sur Android (Chrome exige un SW + fetch)
   • Cache offline en "network-first" : toujours la dernière version
     quand il y a du réseau, le cache sert uniquement de secours
   • Intercepte le partage WhatsApp (Web Share Target)
   ══════════════════════════════════════════════════════════════════ */

const CACHE_NAME = 'lp-report-v1';
const SHARE_KEY  = '/__shared-kmz__';   // clé du fichier partagé dans le cache

/* ── INSTALL ─────────────────────────────────────────────────────── */
self.addEventListener('install', event => {
  self.skipWaiting();                    // active la nouvelle version tout de suite
});

/* ── ACTIVATE ────────────────────────────────────────────────────── */
self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    // Purge les anciens caches
    const names = await caches.keys();
    await Promise.all(
      names.filter(n => n !== CACHE_NAME).map(n => caches.delete(n))
    );
    await self.clients.claim();
  })());
});

/* ── FETCH ───────────────────────────────────────────────────────── */
self.addEventListener('fetch', event => {
  const req = event.request;
  const url = new URL(req.url);

  /* ---- 1. Partage WhatsApp : POST sur ./share-target/ ---- */
  if (req.method === 'POST' && url.pathname.endsWith('/share-target/')) {
    event.respondWith((async () => {
      try {
        const formData = await req.formData();
        let file = formData.get('kmzfile');
        if (!file || typeof file === 'string') {
          // Certaines apps envoient le fichier sous un autre nom de champ
          for (const value of formData.values()) {
            if (value && typeof value !== 'string') { file = value; break; }
          }
        }
        if (file) {
          const cache = await caches.open(CACHE_NAME);
          const headers = new Headers({
            'Content-Type': 'application/octet-stream',
            'X-Filename': encodeURIComponent(file.name || 'shared.kmz')
          });
          await cache.put(SHARE_KEY, new Response(file, { headers }));
        }
      } catch (err) {
        // On redirige quand même pour ne pas bloquer l'utilisateur
      }
      return Response.redirect(self.registration.scope + '?shared=1', 303);
    })());
    return;
  }

  /* ---- 2. Requêtes GET : network-first, cache en secours ---- */
  if (req.method !== 'GET') return;

  // On ne met en cache que notre propre origine (pas les tuiles de carte)
  if (url.origin !== self.location.origin) return;

  event.respondWith((async () => {
    try {
      const fresh = await fetch(req);
      if (fresh && fresh.status === 200 && fresh.type === 'basic') {
        const cache = await caches.open(CACHE_NAME);
        cache.put(req, fresh.clone());
      }
      return fresh;
    } catch (err) {
      // Hors ligne : on sert le cache
      const cached = await caches.match(req);
      if (cached) return cached;
      // Navigation hors ligne sans cache exact → on sert la page d'accueil
      if (req.mode === 'navigate') {
        const home = await caches.match(self.registration.scope);
        if (home) return home;
      }
      throw err;
    }
  })());
});
