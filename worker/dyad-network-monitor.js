/**
 * dyad-network-monitor.js – Conditional network observability bootstrap
 *
 * Default path: register Dyad's service worker at /__dyad-sw__.js and forward
 * its postMessages to window.parent. The SW sees more than fetch/XHR (images,
 * stylesheets, fonts) so it's the preferred observer.
 *
 * Fallback path: if the user app has its own service worker (already
 * installed from a prior session, or registered at runtime), the Dyad SW
 * cannot coexist with it at the same scope — so we activate monkey-patches
 * on window.fetch and XMLHttpRequest instead. Dyad's SW is identified by the
 * `/__dyad-sw__.js` scriptURL; anything else is treated as a user SW.
 *
 * Either path emits the same { network-request | network-response |
 * network-error } message protocol consumed by PreviewIframe.tsx.
 */

(function () {
  const DYAD_SW_PATH = "/__dyad-sw__.js";

  // Skip noisy dev-server paths (mirrors the service worker's filter list).
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

  function isDyadSw(scriptURL) {
    if (!scriptURL) return false;
    try {
      return new URL(scriptURL, window.location.href).pathname === DYAD_SW_PATH;
    } catch {
      return false;
    }
  }

  // ---- fetch / XHR monkey-patches (only installed if needed) ------------

  let patchedAlready = false;

  function patchFetch() {
    const origFetch = window.fetch;
    if (typeof origFetch !== "function") return;
    window.fetch = function (input, init) {
      let method = "GET";
      let url = "";
      try {
        if (typeof input === "string" || input instanceof URL) {
          url = String(input);
          method = (init && init.method) || "GET";
        } else if (input && typeof input.url === "string") {
          // Request object — reading .url/.method does NOT consume the body.
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

  function patchXhr() {
    const OrigXHR = window.XMLHttpRequest;
    if (typeof OrigXHR !== "function" || !OrigXHR.prototype) return;
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

      // `loadend` fires once after any terminal outcome. status === 0 at that
      // point indicates a network/CORS/abort/timeout failure.
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

  function activateMonkeyPatches() {
    if (patchedAlready) return;
    patchedAlready = true;
    patchFetch();
    patchXhr();

    // Drop the Dyad SW once patches are live so we don't double-log. If the
    // user SW is at the same scope the browser already replaced ours, but if
    // scopes differ both can coexist — be explicit.
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker
        .getRegistrations()
        .then((regs) => {
          for (const reg of regs) {
            const sw = reg.active || reg.installing || reg.waiting;
            if (sw && isDyadSw(sw.scriptURL)) {
              reg.unregister().catch(() => {});
            }
          }
        })
        .catch(() => {});
    }
  }

  // ---- SW message forwarder ---------------------------------------------
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.addEventListener("message", (event) => {
      try {
        window.parent.postMessage(event.data, "*");
      } catch {
        // Cross-origin or detached parent — ignore.
      }
    });
  }

  // ---- Wrap register() to detect user SW registrations at runtime -------
  // Install the wrapper BEFORE any user script runs (this script is injected
  // at the top of <head>). Ignore Dyad's own scriptURL so we don't self-fire
  // when we call register() below.
  if ("serviceWorker" in navigator) {
    const origRegister = navigator.serviceWorker.register.bind(
      navigator.serviceWorker,
    );
    navigator.serviceWorker.register = function (scriptURL, options) {
      if (!isDyadSw(scriptURL)) {
        activateMonkeyPatches();
      }
      return origRegister(scriptURL, options);
    };
  }

  // ---- Decide what to do at page load -----------------------------------
  if (!("serviceWorker" in navigator)) {
    activateMonkeyPatches();
  } else {
    navigator.serviceWorker
      .getRegistrations()
      .then((regs) => {
        const hasUserSw = regs.some((r) => {
          const sw = r.active || r.installing || r.waiting;
          return sw && !isDyadSw(sw.scriptURL);
        });
        if (hasUserSw) {
          activateMonkeyPatches();
          return;
        }
        navigator.serviceWorker
          .register(DYAD_SW_PATH, { scope: "/" })
          .catch(() => activateMonkeyPatches());
      })
      .catch(() => activateMonkeyPatches());
  }
})();
