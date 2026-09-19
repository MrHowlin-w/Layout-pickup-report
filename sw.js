/* ══════════════════════════════════════════════════════════════════
   S³ Layout / Pick-Up Report — Service Worker v2
   • Rend l'app installable sur Android
   • Cache offline network-first
   • Intercepte le partage WhatsApp (Web Share Target)
   ══════════════════════════════════════════════════════════════════ */

const CACHE_NAME = 'lp-report-v1';
const SHARE_KEY  = '/__shared-kmz__';
const DEBUG_KEY  = '/__share-debug__';

/* ── INSTALL ─────────────────────────────────────────────────────── */
self.addEventListener('install', () => self.skipWaiting());

/* ── ACTIVATE ────────────────────────────────────────────────────── */
self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(
      names.filter(n => n !== CACHE_NAME).map(n => caches.delete(n))
    );
    await self.clients.claim();
  })());
});

/* ── Trace de diagnostic lisible par l'app ───────────────────────── */
async function writeDebug(obj) {
  try {
    const cache = await caches.open(CACHE_NAME);
    await cache.put(DEBUG_KEY, new Response(JSON.stringify(obj), {
      headers: { 'Content-Type': 'application/json' }
    }));
  } catch (e) { /* ignore */ }
}

/* ── FETCH ───────────────────────────────────────────────────────── */
self.addEventListener('fetch', event => {
  const req = event.request;
  const url = new URL(req.url);

  /* ---- 1. Partage entrant : tout POST contenant "share-target" ---- */
  const isShare = req.method === 'POST' && url.pathname.indexOf('share-target') !== -1;

  if (isShare) {
    event.respondWith((async () => {
      const dbg = { at: new Date().toISOString(), path: url.pathname, fields: [], stored: false };
      try {
        const formData = await req.formData();

        let file = null;
        for (const [key, value] of formData.entries()) {
          const isFile = value && typeof value !== 'string';
          dbg.fields.push({
            key: key,
            type: isFile ? (value.type || 'sans-type') : 'texte',
            name: isFile ? (value.name || 'sans-nom') : undefined,
            size: isFile ? value.size : undefined
          });
          // Premier fichier non vide, quel que soit le nom du champ
          if (isFile && !file && value.size > 0) file = value;
        }

        if (file) {
          const cache = await caches.open(CACHE_NAME);
          const headers = new Headers({
            'Content-Type': 'application/octet-stream',
            'X-Filename': encodeURIComponent(file.name || 'shared.kmz')
          });
          await cache.put(SHARE_KEY, new Response(file, { headers }));
          dbg.stored = true;
          dbg.storedName = file.name;
          dbg.storedSize = file.size;
        } else {
          dbg.error = 'aucun fichier recu dans le partage';
        }
      } catch (err) {
        dbg.error = 'formData: ' + (err && err.message ? err.message : String(err));
      }

      await writeDebug(dbg);

      // Prévient l'app si elle tourne déjà
      try {
        const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
        clients.forEach(c => c.postMessage({ type: 'SHARED_FILE_READY' }));
      } catch (e) { /* ignore */ }

      return Response.redirect(self.registration.scope + '?shared=1', 303);
    })());
    return;
  }

  /* ---- 2. GET : network-first, cache en secours ---- */
  if (req.method !== 'GET') return;
  if (url.origin !== self.location.origin) return;
  if (url.pathname.indexOf('__shared-kmz__') !== -1) return;
  if (url.pathname.indexOf('__share-debug__') !== -1) return;

  event.respondWith((async () => {
    try {
      const fresh = await fetch(req);
      if (fresh && fresh.status === 200 && fresh.type === 'basic') {
        const cache = await caches.open(CACHE_NAME);
        cache.put(req, fresh.clone());
      }
      return fresh;
    } catch (err) {
      const cached = await caches.match(req);
      if (cached) return cached;
      if (req.mode === 'navigate') {
        const home = await caches.match(self.registration.scope);
        if (home) return home;
      }
      throw err;
    }
  })());
});
