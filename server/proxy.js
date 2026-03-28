const http = require("http");
const https = require("https");
const { URL } = require("url");
const zlib = require("zlib");

// Decode the proxied URL from the request path
function decodeTarget(raw) {
  try {
    const decoded = Buffer.from(raw, "base64url").toString("utf8");
    new URL(decoded); // validate
    return decoded;
  } catch {
    return null;
  }
}

// Rewrite URLs in HTML/CSS/JS so they route back through the proxy
function rewriteContent(content, baseUrl, proxyBase) {
  const base = new URL(baseUrl);

  function encodeUrl(url) {
    try {
      let resolved;
      if (url.startsWith("//")) {
        resolved = base.protocol + url;
      } else if (url.startsWith("/")) {
        resolved = base.origin + url;
      } else if (!url.startsWith("http")) {
        resolved = new URL(url, baseUrl).href;
      } else {
        resolved = url;
      }
      return proxyBase + "/go/" + Buffer.from(resolved).toString("base64url");
    } catch {
      return url;
    }
  }

  // Rewrite src, href, action attributes
  content = content.replace(
    /(src|href|action)=["']([^"']+)["']/gi,
    (match, attr, url) => {
      if (
        url.startsWith("data:") ||
        url.startsWith("javascript:") ||
        url.startsWith("#") ||
        url.startsWith("mailto:")
      ) {
        return match;
      }
      return `${attr}="${encodeUrl(url)}"`;
    }
  );

  // Rewrite CSS url()
  content = content.replace(/url\(["']?([^"')]+)["']?\)/gi, (match, url) => {
    if (url.startsWith("data:")) return match;
    return `url("${encodeUrl(url)}")`;
  });

  // Rewrite fetch() and XMLHttpRequest calls in JS
  content = content.replace(
    /(\bfetch\s*\(\s*)["']([^"']+)["']/gi,
    (match, prefix, url) => {
      if (url.startsWith("data:") || url.startsWith("blob:")) return match;
      return `${prefix}"${encodeUrl(url)}"`;
    }
  );

  // Rewrite window.location references in scripts
  content = content.replace(
    /(['"])https?:\/\/[^'"]+['"]/g,
    (match, quote, offset, str) => {
      const url = match.slice(1, -1);
      try {
        new URL(url);
        return `${quote}${encodeUrl(url)}${quote}`;
      } catch {
        return match;
      }
    }
  );

  // Rewrite <base> tag if present
  content = content.replace(/<base\s+href=["'][^"']*["'][^>]*>/gi, "");

  // Inject our proxy script into <head>
  const injectedScript = `
<script>
(function() {
  const _proxyBase = "${proxyBase}";
  const _originBase = "${base.origin}";

  function proxyEncode(url) {
    try {
      let resolved = url;
      if (url.startsWith("//")) resolved = location.protocol + url;
      else if (url.startsWith("/")) resolved = _originBase + url;
      else if (!url.startsWith("http")) resolved = new URL(url, location.href).href;
      return _proxyBase + "/go/" + btoa(resolved).replace(/\\+/g,"-").replace(/\\//g,"_").replace(/=/g,"");
    } catch(e) { return url; }
  }

  // Override pushState/replaceState for SPA navigation
  const _push = history.pushState.bind(history);
  const _replace = history.replaceState.bind(history);
  history.pushState = function(state, title, url) {
    if (url && !url.startsWith(_proxyBase)) {
      url = proxyEncode(url);
    }
    return _push(state, title, url);
  };
  history.replaceState = function(state, title, url) {
    if (url && !url.startsWith(_proxyBase)) {
      url = proxyEncode(url);
    }
    return _replace(state, title, url);
  };

  // Intercept link clicks
  document.addEventListener("click", function(e) {
    const a = e.target.closest("a");
    if (!a) return;
    const href = a.getAttribute("href");
    if (!href || href.startsWith("#") || href.startsWith("javascript:") || href.startsWith("mailto:")) return;
    e.preventDefault();
    try {
      let resolved = href;
      if (href.startsWith("//")) resolved = location.protocol + href;
      else if (href.startsWith("/")) resolved = _originBase + href;
      else if (!href.startsWith("http")) resolved = new URL(href, location.href).href;
      window.location.href = proxyEncode(resolved);
    } catch(err) {}
  }, true);

  // Intercept form submissions
  document.addEventListener("submit", function(e) {
    const form = e.target;
    const action = form.action || location.href;
    e.preventDefault();
    try {
      form.action = proxyEncode(action);
      form.submit();
    } catch(err) {}
  }, true);
})();
</script>`;

  content = content.replace(/<head([^>]*)>/i, `<head$1>${injectedScript}`);
  if (!content.includes(injectedScript)) {
    content = injectedScript + content;
  }

  return content;
}

function createProxyMiddleware() {
  return async function (req, res) {
    // Extract encoded URL from path: /go/<base64url>
    const rawPath = req.path.replace(/^\//, "");
    if (!rawPath) {
      return res.status(400).send("No target URL provided.");
    }

    const targetUrl = decodeTarget(rawPath);
    if (!targetUrl) {
      return res.status(400).send("Invalid proxy URL.");
    }

    let parsed;
    try {
      parsed = new URL(targetUrl);
    } catch {
      return res.status(400).send("Malformed URL.");
    }

    const isHttps = parsed.protocol === "https:";
    const lib = isHttps ? https : http;

    // Forward headers but strip problematic ones
    const forwardHeaders = { ...req.headers };
    delete forwardHeaders["host"];
    delete forwardHeaders["origin"];
    delete forwardHeaders["referer"];
    forwardHeaders["host"] = parsed.host;

    const options = {
      hostname: parsed.hostname,
      port: parsed.port || (isHttps ? 443 : 80),
      path: parsed.pathname + parsed.search,
      method: req.method,
      headers: forwardHeaders,
    };

    const proxyReq = lib.request(options, (proxyRes) => {
      const contentType = proxyRes.headers["content-type"] || "";
      const encoding = proxyRes.headers["content-encoding"];

      // Rewrite location header for redirects
      if (proxyRes.headers["location"]) {
        try {
          const loc = new URL(proxyRes.headers["location"], targetUrl).href;
          const proxyBase = req.protocol + "://" + req.get("host");
          proxyRes.headers["location"] =
            proxyBase +
            "/go/" +
            Buffer.from(loc).toString("base64url");
        } catch {}
      }

      // Strip security headers that block our proxy
      delete proxyRes.headers["content-security-policy"];
      delete proxyRes.headers["content-security-policy-report-only"];
      delete proxyRes.headers["x-frame-options"];
      delete proxyRes.headers["strict-transport-security"];
      delete proxyRes.headers["content-encoding"]; // we'll handle compression

      const isRewritable =
        contentType.includes("text/html") ||
        contentType.includes("text/css") ||
        contentType.includes("javascript");

      if (!isRewritable) {
        // Stream binary content directly
        res.writeHead(proxyRes.statusCode, proxyRes.headers);
        proxyRes.pipe(res);
        return;
      }

      // Decompress if needed
      let stream = proxyRes;
      if (encoding === "gzip") {
        stream = proxyRes.pipe(zlib.createGunzip());
      } else if (encoding === "br") {
        stream = proxyRes.pipe(zlib.createBrotliDecompress());
      } else if (encoding === "deflate") {
        stream = proxyRes.pipe(zlib.createInflate());
      }

      const chunks = [];
      stream.on("data", (chunk) => chunks.push(chunk));
      stream.on("end", () => {
        let body = Buffer.concat(chunks).toString("utf8");
        const proxyBase = req.protocol + "://" + req.get("host");

        if (contentType.includes("text/html")) {
          body = rewriteContent(body, targetUrl, proxyBase);
        } else if (
          contentType.includes("text/css") ||
          contentType.includes("javascript")
        ) {
          // Light rewrite for CSS/JS
          body = body.replace(/url\(["']?([^"')]+)["']?\)/gi, (match, url) => {
            if (url.startsWith("data:")) return match;
            try {
              const resolved = new URL(url, targetUrl).href;
              return `url("${proxyBase}/go/${Buffer.from(resolved).toString("base64url")}")`;
            } catch {
              return match;
            }
          });
        }

        res.writeHead(proxyRes.statusCode, {
          ...proxyRes.headers,
          "content-type": contentType,
        });
        res.end(body);
      });

      stream.on("error", (err) => {
        console.error("Stream error:", err.message);
        res.status(500).send("Proxy stream error.");
      });
    });

    proxyReq.on("error", (err) => {
      console.error("Proxy request error:", err.message);
      res.status(502).send("Could not reach target site.");
    });

    // Forward request body for POST etc.
    if (["POST", "PUT", "PATCH"].includes(req.method)) {
      req.pipe(proxyReq);
    } else {
      proxyReq.end();
    }
  };
}

module.exports = { createProxyMiddleware };
