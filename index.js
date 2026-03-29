const express = require("express");
const http = require("http");
const https = require("https");
const path = require("path");
const { URL } = require("url");

const app = express();

app.use(express.static(path.join(__dirname, "static")));

// Main relay endpoint - fetches any URL on behalf of the browser
app.get("/relay", async (req, res) => {
  const target = req.query.url;
  if (!target) return res.status(400).send("No URL provided");

  let parsed;
  try {
    parsed = new URL(target);
  } catch {
    return res.status(400).send("Invalid URL");
  }

  const lib = parsed.protocol === "https:" ? https : http;

  const options = {
    hostname: parsed.hostname,
    port: parsed.port || (parsed.protocol === "https:" ? 443 : 80),
    path: parsed.pathname + parsed.search,
    method: "GET",
    headers: {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36",
      "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
      "Accept-Language": "en-US,en;q=0.9",
      "Accept-Encoding": "identity",
    },
  };

  const proxyReq = lib.request(options, (proxyRes) => {
    // Strip headers that would block the response
    const blocked = [
      "content-security-policy",
      "x-frame-options",
      "strict-transport-security",
      "x-content-type-options",
      "set-cookie",
    ];

    const headers = {};
    for (const [key, val] of Object.entries(proxyRes.headers)) {
      if (!blocked.includes(key.toLowerCase())) {
        headers[key] = val;
      }
    }

    // Follow redirects
    if ([301, 302, 303, 307, 308].includes(proxyRes.statusCode)) {
      const location = proxyRes.headers["location"];
      if (location) {
        const redirectUrl = new URL(location, target).href;
        return res.redirect(`/relay?url=${encodeURIComponent(redirectUrl)}`);
      }
    }

    res.writeHead(proxyRes.statusCode, headers);
    proxyRes.pipe(res);
  });

  proxyReq.on("error", (err) => {
    console.error("Relay error:", err.message);
    res.status(500).send("Failed to fetch: " + err.message);
  });

  proxyReq.end();
});

const server = http.createServer(app);

const PORT = process.env.PORT || 8080;
server.listen(PORT, () => {
  console.log(`\n✅ CheddarOS Proxy running at http://localhost:${PORT}\n`);
});
