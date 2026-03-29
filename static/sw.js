const PROXY_PREFIX = "/proxy/";
const RELAY = "/relay?url=";

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));

self.addEventListener("fetch", (e) => {
  const url = e.request.url;

  // Only intercept requests going through our proxy prefix
  if (!url.includes(PROXY_PREFIX)) return;

  const encoded = url.split(PROXY_PREFIX)[1];
  if (!encoded) return;

  let target;
  try {
    target = decodeURIComponent(encoded);
  } catch {
    return;
  }

  // Resolve relative URLs
  if (!target.startsWith("http")) {
    try {
      const base = new URL(decodeURIComponent(encoded.split("?")[0]));
      target = new URL(target, base.origin).href;
    } catch {
      return;
    }
  }

  e.respondWith(
    fetch(RELAY + encodeURIComponent(target), {
      method: e.request.method,
      headers: {
        "X-Requested-With": "CheddarProxy",
      },
    }).catch((err) => {
      return new Response("Proxy fetch failed: " + err.message, { status: 500 });
    })
  );
});
