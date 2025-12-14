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
  const startTime = Date.now();
  const request = event.request;
  const url = request.url;
  const method = request.method;

  // Send initial request info to all clients
  event.waitUntil(
    self.clients.matchAll().then((clients) => {
      clients.forEach((client) => {
        client.postMessage({
          type: "network-request",
          method,
          url,
          requestType: "fetch",
          timestamp: new Date().toISOString(),
        });
      });
    }),
  );

  // Pass through the request and monitor the response
  event.respondWith(
    fetch(event.request)
      .then((response) => {
        const duration = Date.now() - startTime;

        // Send response info to all clients
        self.clients.matchAll().then((clients) => {
          clients.forEach((client) => {
            client.postMessage({
              type: "network-response",
              method,
              url,
              status: response.status,
              statusText: response.statusText,
              duration,
              requestType: "fetch",
              timestamp: new Date().toISOString(),
            });
          });
        });

        // Return the response unchanged
        return response;
      })
      .catch((error) => {
        const duration = Date.now() - startTime;

        // Send error info to all clients
        self.clients.matchAll().then((clients) => {
          clients.forEach((client) => {
            client.postMessage({
              type: "network-error",
              method,
              url,
              status: 0,
              error: error.message,
              duration,
              requestType: "fetch",
              timestamp: new Date().toISOString(),
            });
          });
        });

        // Re-throw the error
        throw error;
      }),
  );
});
