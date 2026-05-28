/**
 * dyad-network-monitor.js – Network request interception via monkey-patching
 *
 * Replaces the previous service-worker-based approach. Patches `window.fetch`
 * and `XMLHttpRequest` so both request types are observed, and unregisters
 * any leftover Dyad service worker from prior versions.
 *
 * Emits the same { network-request | network-response | network-error }
 * postMessage protocol consumed by PreviewIframe.tsx.
 */

(function () {
  // Skip noisy dev-server paths (mirrors the old service worker's filter).
  const SKIP_PATTERNS = [
    "/node_modules",
    "/@vite/",
    "/__vite_ping",
    "/_next/static/",
    "/_next/webpack-hmr",
    "/__nextjs_original-stack-frame",
    "/__webpack_hmr",
    ".hot-update.",
  ];

  function shouldSkip(rawUrl) {
    let u;
    try {
      u = new URL(rawUrl, window.location.href);
    } catch {
      return true;
    }
    if (u.protocol !== "http:" && u.protocol !== "https:") return true;
    return SKIP_PATTERNS.some((p) => u.pathname.includes(p));
  }

  function post(msg) {
    try {
      window.parent.postMessage(msg, "*");
    } catch {
      // Cross-origin or detached parent — nothing we can do.
    }
  }

  const nowIso = () => new Date().toISOString();

  // ---- Unregister any previously-installed Dyad service worker -----------
  // Upgrade path: older Dyad versions registered "/dyad-sw.js". Removing it
  // ensures we don't run two interceptors in parallel.
  if ("serviceWorker" in navigator) {
    Promise.resolve()
      .then(() => navigator.serviceWorker.getRegistrations())
      .then((regs) => {
        for (const reg of regs) {
          reg.unregister().catch(() => {});
        }
      })
      .catch(() => {});
  }

  // ---- Patch window.fetch -----------------------------------------------
  const origFetch = window.fetch;
  if (typeof origFetch === "function") {
    window.fetch = function (input, init) {
      let method = "GET";
      let url = "";
      try {
        if (typeof input === "string" || input instanceof URL) {
          url = String(input);
          method = (init && init.method) || "GET";
        } else if (input && typeof input.url === "string") {
          // Request object: reading .url / .method does NOT consume the body.
          url = input.url;
          method = (init && init.method) || input.method || "GET";
        }
      } catch {
        // Best-effort metadata extraction.
      }
      method = String(method).toUpperCase();

      if (!url || shouldSkip(url)) {
        return origFetch.call(this, input, init);
      }

      const start = Date.now();
      post({
        type: "network-request",
        method,
        url,
        requestType: "fetch",
        timestamp: nowIso(),
      });

      return origFetch.call(this, input, init).then(
        (response) => {
          post({
            type: "network-response",
            method,
            url,
            status: response.status,
            statusText: response.statusText,
            duration: Date.now() - start,
            requestType: "fetch",
            timestamp: nowIso(),
          });
          return response;
        },
        (error) => {
          post({
            type: "network-error",
            method,
            url,
            status: 0,
            error: (error && error.message) || String(error),
            duration: Date.now() - start,
            requestType: "fetch",
            timestamp: nowIso(),
          });
          throw error;
        },
      );
    };
  }

  // ---- Patch XMLHttpRequest ---------------------------------------------
  const OrigXHR = window.XMLHttpRequest;
  if (typeof OrigXHR === "function" && OrigXHR.prototype) {
    const origOpen = OrigXHR.prototype.open;
    const origSend = OrigXHR.prototype.send;

    OrigXHR.prototype.open = function (method, url) {
      const urlStr = String(url || "");
      this.__dyadMeta = {
        method: String(method || "GET").toUpperCase(),
        url: urlStr,
        skip: !urlStr || shouldSkip(urlStr),
      };
      return origOpen.apply(this, arguments);
    };

    OrigXHR.prototype.send = function () {
      const meta = this.__dyadMeta;
      if (!meta || meta.skip) {
        return origSend.apply(this, arguments);
      }

      const start = Date.now();
      let settled = false;

      const finishResponse = () => {
        if (settled) return;
        settled = true;
        post({
          type: "network-response",
          method: meta.method,
          url: meta.url,
          status: this.status,
          statusText: this.statusText,
          duration: Date.now() - start,
          requestType: "xhr",
          timestamp: nowIso(),
        });
      };

      const finishError = (errorMessage) => {
        if (settled) return;
        settled = true;
        post({
          type: "network-error",
          method: meta.method,
          url: meta.url,
          status: 0,
          error: errorMessage,
          duration: Date.now() - start,
          requestType: "xhr",
          timestamp: nowIso(),
        });
      };

      post({
        type: "network-request",
        method: meta.method,
        url: meta.url,
        requestType: "xhr",
        timestamp: nowIso(),
      });

      // `loadend` fires once after any terminal outcome (load/error/abort/
      // timeout). status === 0 at that point indicates network/CORS/abort.
      this.addEventListener("loadend", () => {
        if (this.readyState === 4 && this.status !== 0) {
          finishResponse();
        } else {
          finishError("Network request failed");
        }
      });
      this.addEventListener("timeout", () => finishError("Request timed out"));
      this.addEventListener("abort", () => finishError("Request aborted"));

      return origSend.apply(this, arguments);
    };
  }
})();
