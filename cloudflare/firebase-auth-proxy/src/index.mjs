const FIREBASE_AUTH_ORIGIN = "https://bxh-arena.firebaseapp.com";
const ALLOWED_METHODS = new Set(["GET", "HEAD", "POST", "OPTIONS"]);

function isAllowedPath(pathname) {
  return pathname.startsWith("/__/auth/") || pathname === "/__/firebase/init.json";
}

export default {
  async fetch(request) {
    const incoming = new URL(request.url);

    // This worker is a narrow Firebase Auth helper proxy, never an open proxy.
    if (!isAllowedPath(incoming.pathname)) {
      return new Response("Not found", { status: 404 });
    }
    if (!ALLOWED_METHODS.has(request.method)) {
      return new Response("Method not allowed", {
        status: 405,
        headers: { Allow: "GET, HEAD, POST, OPTIONS" },
      });
    }
    if (
      incoming.pathname === "/__/firebase/init.json" &&
      request.method !== "GET" &&
      request.method !== "HEAD"
    ) {
      return new Response("Method not allowed", {
        status: 405,
        headers: { Allow: "GET, HEAD" },
      });
    }

    const upstreamUrl = new URL(`${incoming.pathname}${incoming.search}`, FIREBASE_AUTH_ORIGIN);
    const upstreamRequest = new Request(upstreamUrl, request);
    const upstreamResponse = await fetch(upstreamRequest, { redirect: "manual" });

    // Preserve Firebase's status, redirect and headers exactly. The browser
    // sees the ARENA origin because Cloudflare serves this response on-route.
    return new Response(upstreamResponse.body, {
      status: upstreamResponse.status,
      statusText: upstreamResponse.statusText,
      headers: upstreamResponse.headers,
    });
  },
};
