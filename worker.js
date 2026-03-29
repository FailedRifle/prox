export default {
  async fetch(request) {
    const url = new URL(request.url);

    // Serve static files from assets
    if (url.pathname === '/' || url.pathname === '/index.html') {
      return fetch(request);
    }

    // Relay endpoint
    if (url.pathname === '/relay') {
      const target = url.searchParams.get('url');
      if (!target) return new Response('No URL', { status: 400 });

      try {
        const res = await fetch(target, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36',
            'Accept': 'text/html,application/xhtml+xml,*/*;q=0.8',
            'Accept-Language': 'en-US,en;q=0.9',
          },
          redirect: 'follow',
        });

        const headers = new Headers(res.headers);
        headers.delete('content-security-policy');
        headers.delete('x-frame-options');
        headers.delete('strict-transport-security');
        headers.set('Access-Control-Allow-Origin', '*');
        headers.set('X-Frame-Options', 'ALLOWALL');

        return new Response(res.body, {
          status: res.status,
          headers,
        });
      } catch (e) {
        return new Response('Fetch failed: ' + e.message, { status: 500 });
      }
    }

    return fetch(request);
  }
};
