const VERSION = "ghost-v1";

// Sites to proxy through a CORS relay since GH Pages can't make cross-origin requests directly
const CORS_RELAY = "https://corsproxy.io/?";

// Encode/decode target URLs
function encodeTarget(url) {
  return btoa(url).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function decodeTarget(enc) {
  try {
    const b64 = enc.replace(/-/g, "+").replace(/_/g, "/");
    return atob(b64);
  } catch {
    return null;
  }
}

// Resolve a potentially relative URL against a base
function resolveUrl(url, base) {
  try {
    return new URL(url, base).href;
  } catch {
    return null;
  }
}

// Build a proxied URL that routes back through our SW
function proxyUrl(url, base) {
  try {
    const resolved = resolveUrl(url, base);
    if (!resolved) return url;
    // Don't re-proxy data URIs, blobs, or already-proxied URLs
    if (
      resolved.startsWith("data:") ||
      resolved.startsWith("blob:") ||
      resolved.includes("/ghost-proxy/")
    ) {
      return resolved;
    }
    return "/ghost-proxy/" + encodeTarget(resolved);
  } catch {
    return url;
  }
}

// Rewrite HTML content — fix all URLs to go through proxy
function rewriteHtml(html, targetUrl) {
  const base = new URL(targetUrl);

  // Remove existing <base> tags
  html = html.replace(/<base[^>]*>/gi, "");

  // Rewrite src, href, action, srcset attributes
  html = html.replace(
    /(\s(?:src|href|action|data-src|data-href))=(["'])([^"']*)\2/gi,
    (match, attr, quote, val) => {
      if (
        !val ||
        val.startsWith("data:") ||
        val.startsWith("blob:") ||
        val.startsWith("javascript:") ||
        val.startsWith("#") ||
        val.startsWith("mailto:") ||
        val.startsWith("tel:")
      ) {
        return match;
      }
      return `${attr}=${quote}${proxyUrl(val, targetUrl)}${quote}`;
    }
  );

  // Rewrite srcset
  html = html.replace(
    /(\ssrcset=)(["'])([^"']*)\2/gi,
    (match, attr, quote, val) => {
      const rewritten = val.replace(/([^\s,]+)(\s+\d+[wx])?/g, (m, url, descriptor) => {
        if (!url || url.startsWith("data:")) return m;
        return proxyUrl(url, targetUrl) + (descriptor || "");
      });
      return `${attr}${quote}${rewritten}${quote}`;
    }
  );

  // Rewrite inline style url()
  html = html.replace(/url\(["']?([^"')]+)["']?\)/gi, (match, url) => {
    if (url.startsWith("data:")) return match;
    return `url("${proxyUrl(url, targetUrl)}")`;
  });

  // Inject service worker helper script before </head>
  const swHelper = `
<script>
(function() {
  const _base = ${JSON.stringify(targetUrl)};
  const _origin = ${JSON.stringify(base.origin)};

  function ghostEncode(url) {
    try {
      let r = url;
      if (url.startsWith("//")) r = location.protocol + url;
      else if (url.startsWith("/")) r = _origin + url;
      else if (!url.startsWith("http")) r = new URL(url, _base).href;
      return "/ghost-proxy/" + btoa(r).replace(/\\+/g,"-").replace(/\\//g,"_").replace(/=+$/,"");
    } catch(e) { return url; }
  }

  // Intercept all link clicks
  document.addEventListener("click", function(e) {
    const a = e.target.closest("a[href]");
    if (!a) return;
    const href = a.getAttribute("href");
    if (!href || href.startsWith("#") || href.startsWith("javascript:") || href.startsWith("mailto:") || href.startsWith("tel:")) return;
    if (href.includes("/ghost-proxy/")) return;
    e.preventDefault();
    e.stopPropagation();
    window.location.href = ghostEncode(href);
  }, true);

  // Intercept form submissions
  document.addEventListener("submit", function(e) {
    const form = e.target;
    if (!form) return;
    const action = form.getAttribute("action") || location.href;
    if (action.includes("/ghost-proxy/")) return;
    e.preventDefault();
    form.action = ghostEncode(action);
    form.submit();
  }, true);

  // Override fetch
  const _fetch = window.fetch;
  window.fetch = function(input, init) {
    try {
      let url = typeof input === "string" ? input : input.url;
      if (!url.startsWith("data:") && !url.startsWith("blob:") && !url.includes("/ghost-proxy/")) {
        url = ghostEncode(url);
        input = typeof input === "string" ? url : new Request(url, input);
      }
    } catch(e) {}
    return _fetch(input, init);
  };

  // Override XMLHttpRequest
  const _open = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function(method, url, ...args) {
    try {
      if (typeof url === "string" && !url.startsWith("data:") && !url.startsWith("blob:") && !url.includes("/ghost-proxy/")) {
        url = ghostEncode(url);
      }
    } catch(e) {}
    return _open.call(this, method, url, ...args);
  };

  // Override history API for SPAs
  const _push = history.pushState;
  const _replace = history.replaceState;
  history.pushState = function(state, title, url) {
    if (url && !url.includes("/ghost-proxy/")) url = ghostEncode(url);
    return _push.call(this, state, title, url);
  };
  history.replaceState = function(state, title, url) {
    if (url && !url.includes("/ghost-proxy/")) url = ghostEncode(url);
    return _replace.call(this, state, title, url);
  };
})();
</script>`;

  if (/<\/head>/i.test(html)) {
    html = html.replace(/<\/head>/i, swHelper + "</head>");
  } else {
    html = swHelper + html;
  }

  return html;
}

// Rewrite CSS content
function rewriteCss(css, targetUrl) {
  return css.replace(/url\(["']?([^"')]+)["']?\)/gi, (match, url) => {
    if (url.startsWith("data:")) return match;
    return `url("${proxyUrl(url, targetUrl)}")`;
  });
}

// Rewrite JS — best-effort rewrite of absolute URLs
function rewriteJs(js, targetUrl) {
  // Rewrite fetch("https://...")
  js = js.replace(
    /\bfetch\s*\(\s*(["'`])([^"'`]+)\1/g,
    (match, quote, url) => {
      if (url.startsWith("data:") || url.startsWith("blob:") || url.includes("/ghost-proxy/")) return match;
      try { new URL(url); return `fetch(${quote}${proxyUrl(url, targetUrl)}${quote}`; } catch { return match; }
    }
  );
  return js;
}

// Service Worker install + activate
self.addEventListener("install", (e) => {
  self.skipWaiting();
});

self.addEventListener("activate", (e) => {
  e.waitUntil(clients.claim());
});

// Main fetch intercept
self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);

  // Only intercept /ghost-proxy/... paths
  if (!url.pathname.startsWith("/ghost-proxy/")) return;

  e.respondWith(handleProxyRequest(e.request, url));
});

async function handleProxyRequest(request, swUrl) {
  // Extract encoded target from path
  const encoded = swUrl.pathname.replace("/ghost-proxy/", "");
  const targetUrl = decodeTarget(encoded);

  if (!targetUrl) {
    return new Response("Invalid proxy URL", { status: 400 });
  }

  let target;
  try {
    target = new URL(targetUrl);
  } catch {
    return new Response("Malformed URL", { status: 400 });
  }

  // Build fetch headers — forward relevant ones, fix host
  const headers = new Headers();
  for (const [key, val] of request.headers.entries()) {
    const lower = key.toLowerCase();
    if (["host", "origin", "referer", "sec-fetch-site", "sec-fetch-mode", "sec-fetch-dest"].includes(lower)) continue;
    headers.set(key, val);
  }
  headers.set("origin", target.origin);
  headers.set("referer", target.href);

  // Use CORS relay to bypass browser CORS restrictions
  const relayUrl = CORS_RELAY + encodeURIComponent(targetUrl);

  let response;
  try {
    response = await fetch(relayUrl, {
      method: request.method,
      headers,
      body: ["GET", "HEAD"].includes(request.method) ? undefined : await request.blob(),
      redirect: "follow",
    });
  } catch (err) {
    return new Response(`Could not fetch: ${err.message}`, { status: 502 });
  }

  const contentType = response.headers.get("content-type") || "";
  const isHtml = contentType.includes("text/html");
  const isCss = contentType.includes("text/css");
  const isJs = contentType.includes("javascript");

  // Pass binary content through unchanged
  if (!isHtml && !isCss && !isJs) {
    const newHeaders = new Headers(response.headers);
    newHeaders.delete("content-security-policy");
    newHeaders.delete("x-frame-options");
    newHeaders.delete("content-security-policy-report-only");
    return new Response(response.body, {
      status: response.status,
      headers: newHeaders,
    });
  }

  // Rewrite text content
  let body = await response.text();

  if (isHtml) body = rewriteHtml(body, targetUrl);
  else if (isCss) body = rewriteCss(body, targetUrl);
  else if (isJs) body = rewriteJs(body, targetUrl);

  const outHeaders = new Headers();
  outHeaders.set("content-type", contentType);
  // Strip headers that would block the proxy
  return new Response(body, {
    status: response.status,
    headers: outHeaders,
  });
}
