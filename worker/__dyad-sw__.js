/**
 * __dyad-sw__.js – Service Worker for network request interception
 *
 * The unique filename serves as the marker that distinguishes Dyad's SW from
 * any service worker the user app may register. See dyad-network-monitor.js,
 * which keys off `scriptURL.pathname === "/__dyad-sw__.js"` to decide whether
 * to keep the SW or fall back to fetch/XHR monkey-patching.
 */

self.addEventListener("install", (_event) => {
  console.log("[Dyad SW] Installing...");
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  console.log("[Dyad SW] Activating...");
  event.waitUntil(self.clients.claim());
});

self.addEventListener("fetch", (event) => {
  const request = event.request;

  // ---- Guardrails: avoid breaking things we shouldn't touch ----
  // Skip navigations (HTML document loads) to reduce dev-time weirdness.
  if (request.mode === "navigate") return;
  // Re-fetching script/worker requests from a service worker can change
  // browser metadata like Sec-Fetch-Dest and break Nitro+Vite dev module
  // serving (the dev server returns the wrong MIME type for an unexpected
  // destination). Other destinations (`style`, `image`, `font`, etc.) are
  // intentionally NOT filtered out — they don't trigger the same Vite/Nitro
  // dev-server quirk, and the network panel relies on these events to
  // surface CSS/image/font loads.
  if (request.destination === "script" || request.destination === "worker")
    return;

  let urlObj;
  try {
    urlObj = new URL(request.url);
  } catch {
    return;
  }
  if (urlObj.protocol !== "http:" && urlObj.protocol !== "https:") return;

  // Chrome SW footgun: only-if-cached must be same-origin or it throws.
  if (request.cache === "only-if-cached" && request.mode !== "same-origin")
    return;

  const pathname = urlObj.pathname;
  if (
    pathname.includes("/node_modules") ||
    pathname.includes("/@vite/") ||
    pathname.includes("/__vite_ping") ||
    pathname.includes("/_next/static/") ||
    pathname.includes("/_next/webpack-hmr") ||
    pathname.includes("/__nextjs_original-stack-frame") ||
    pathname.includes("/__webpack_hmr") ||
    pathname.includes(".hot-update.")
  ) {
    return;
  }

  const startTime = Date.now();
  const url = request.url;
  const method = request.method;

  const postMessage = (message) => {
    const sendMessage = async () => {
      if (event.clientId) {
        const client = await self.clients.get(event.clientId);
        if (client) {
          client.postMessage(message);
          return;
        }
      }
      const clients = await self.clients.matchAll({
        type: "window",
        includeUncontrolled: true,
      });
      for (const client of clients) {
        client.postMessage(message);
      }
    };
    event.waitUntil(sendMessage());
  };

  postMessage({
    type: "network-request",
    method,
    url,
    requestType: "fetch",
    timestamp: new Date().toISOString(),
  });

  event.respondWith(
    fetch(event.request)
      .then((response) => {
        const duration = Date.now() - startTime;
        postMessage({
          type: "network-response",
          method,
          url,
          status: response.status,
          statusText: response.statusText,
          duration,
          requestType: "fetch",
          timestamp: new Date().toISOString(),
        });
        return response;
      })
      .catch((error) => {
        const duration = Date.now() - startTime;
        postMessage({
          type: "network-error",
          method,
          url,
          status: 0,
          error: error.message,
          duration,
          requestType: "fetch",
          timestamp: new Date().toISOString(),
        });
        throw error;
      }),
  );
});
