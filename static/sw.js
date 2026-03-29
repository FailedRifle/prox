const RELAY = '/relay?url=';

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil(self.clients.claim()));

self.addEventListener('fetch', e => {
  const url = e.request.url;
  if (!url.includes('/proxy/')) return;

  const encoded = url.split('/proxy/')[1];
  if (!encoded) return;

  let target;
  try { target = decodeURIComponent(encoded); } catch { return; }

  if (!target.startsWith('http')) return;

  e.respondWith(
    fetch(RELAY + encodeURIComponent(target)).catch(err =>
      new Response('Failed: ' + err.message, { status: 500 })
    )
  );
});
