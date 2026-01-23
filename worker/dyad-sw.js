/**
 * dyad-sw.js – Service Worker for network request interception
 * Intercepts all fetch requests and reports them to the client
 */

// Service Worker installation
self.addEventListener("install", (_event) => {
  console.log("[Dyad SW] Installing...");
  // Skip waiting to activate immediately
  self.skipWaiting();
});

// Service Worker activation
self.addEventListener("activate", (event) => {
  console.log("[Dyad SW] Activating...");
  // Claim all clients immediately
  event.waitUntil(self.clients.claim());
});

// Intercept all fetch requests
self.addEventListener("fetch", (event) => {
  const request = event.request;

  // ---- Guardrails: avoid breaking things we shouldn't touch ----
  // Skip navigations (HTML document loads) to reduce dev-time weirdness.
  if (request.mode === "navigate") return;

  // Only handle http(s)
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

  // Skip noisy Vite and Next.js development module requests
  const pathname = urlObj.pathname;
  if (
    // Vite
    pathname.includes("/node_modules") || // Vite deps
    pathname.includes("/@vite/") || // Vite client/HMR
    pathname.includes("/__vite_ping") || // Vite ping
    // Next.js
    pathname.includes("/_next/static/") || // Static assets (chunks, CSS, media)
    pathname.includes("/_next/webpack-hmr") || // Next.js HMR
    pathname.includes("/__nextjs_original-stack-frame") || // Error overlay internals
    pathname.includes("/__webpack_hmr") || // Webpack HMR
    pathname.includes(".hot-update.") // HMR update chunks
  ) {
    return;
  }

  const startTime = Date.now();
  const url = request.url;
  const method = request.method;

  // Helper to send message to the initiating client or broadcast as fallback
  const postMessage = (message) => {
    const sendMessage = async () => {
      // Prefer sending to the initiating client
      if (event.clientId) {
        const client = await self.clients.get(event.clientId);
        if (client) {
          client.postMessage(message);
          return;
        }
      }

      // Fallback: broadcast to all clients within SW scope
      const clients = await self.clients.matchAll({
        type: "window",
        includeUncontrolled: true,
      });
      for (const client of clients) {
        client.postMessage(message);
      }
    };

    // Wrap with event.waitUntil to ensure completion
    event.waitUntil(sendMessage());
  };

  // Send initial request info
  postMessage({
    type: "network-request",
    method,
    url,
    requestType: "fetch",
    timestamp: new Date().toISOString(),
  });

  // Pass through the request and monitor the response
  event.respondWith(
    fetch(event.request)
      .then((response) => {
        const duration = Date.now() - startTime;

        // Send response info
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

        // Return the response unchanged
        return response;
      })
      .catch((error) => {
        const duration = Date.now() - startTime;

        // Send error info
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

        // Re-throw the error
        throw error;
      }),
  );
});
