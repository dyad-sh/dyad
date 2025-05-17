(function () {
  console.debug("dyad-shim.js loaded via proxy v0.6.0");
  const isInsideIframe = window.parent !== window;
  if (!isInsideIframe) return;

  let previousUrl = window.location.href;
  const PARENT_TARGET_ORIGIN = "*";

  // --- History API Overrides ---
  const originalPushState = history.pushState;
  const originalReplaceState = history.replaceState;

  const handleStateChangeAndNotify = (originalMethod, state, title, url) => {
    const oldUrlForMessage = previousUrl;
    let newUrl;
    try {
      newUrl = url
        ? new URL(url, window.location.href).href
        : window.location.href;
    } catch (e) {
      console.error("Could not parse URL", e);
      newUrl = window.location.href;
    }

    const navigationType =
      originalMethod === originalPushState ? "pushState" : "replaceState";

    try {
      // Pass the original state directly
      originalMethod.call(history, state, title, url);
      previousUrl = window.location.href;
      window.parent.postMessage(
        {
          type: navigationType,
          payload: { oldUrl: oldUrlForMessage, newUrl: newUrl },
        },
        PARENT_TARGET_ORIGIN,
      );
    } catch (e) {
      console.error(
        `[vite-dev-plugin] Error calling original ${navigationType}: `,
        e,
      );
      window.parent.postMessage(
        {
          type: "navigation-error",
          payload: {
            operation: navigationType,
            message: e.message,
            error: e.toString(),
            stateAttempted: state,
            urlAttempted: url,
          },
        },
        PARENT_TARGET_ORIGIN,
      );
    }
  };

  history.pushState = function (state, title, url) {
    handleStateChangeAndNotify(originalPushState, state, title, url);
  };

  history.replaceState = function (state, title, url) {
    handleStateChangeAndNotify(originalReplaceState, state, title, url);
  };

  // --- Listener for Back/Forward Navigation (popstate event) ---
  window.addEventListener("popstate", () => {
    const currentUrl = window.location.href;
    previousUrl = currentUrl;
  });

  // --- Listener for Commands from Parent ---
  window.addEventListener("message", (event) => {
    if (
      event.source !== window.parent ||
      !event.data ||
      typeof event.data !== "object"
    )
      return;
    if (event.data.type === "navigate") {
      const direction = event.data.payload?.direction;
      if (direction === "forward") history.forward();
      else if (direction === "backward") history.back();
    }
  });

  // --- Sourcemapped Error Handling ---
  function sendSourcemappedErrorToParent(error, sourceType) {
    if (typeof window.StackTrace === "undefined") {
      console.error("[vite-dev-plugin] StackTrace object not found.");
      // Send simplified raw data if StackTrace isn't available
      window.parent.postMessage(
        {
          type: sourceType,
          payload: {
            message: error?.message || String(error),
            stack:
              error?.stack || "<no stack available - StackTrace.js missing>",
          },
        },
        PARENT_TARGET_ORIGIN,
      );
      return;
    }

    window.StackTrace.fromError(error)
      .then((stackFrames) => {
        const sourcemappedStack = stackFrames
          .map((sf) => sf.toString())
          .join("\n");

        const payload = {
          message: error?.message || String(error),
          stack: sourcemappedStack,
        };

        window.parent.postMessage(
          {
            type: "iframe-sourcemapped-error",
            payload: { ...payload, originalSourceType: sourceType },
          },
          PARENT_TARGET_ORIGIN,
        );
      })
      .catch((mappingError) => {
        console.error(
          "[vite-dev-plugin] Error during stacktrace sourcemapping:",
          mappingError,
        );

        const payload = {
          message: error?.message || String(error),
          // Provide the raw stack or an indication of mapping failure
          stack: error?.stack
            ? `Sourcemapping failed: ${mappingError.message}\n--- Raw Stack ---\n${error.stack}`
            : `Sourcemapping failed: ${mappingError.message}\n<no raw stack available>`,
        };

        window.parent.postMessage(
          {
            type: "iframe-sourcemapped-error",
            payload: { ...payload, originalSourceType: sourceType },
          },
          PARENT_TARGET_ORIGIN,
        );
      });
  }

  window.addEventListener("error", (event) => {
    let error = event.error;
    if (!(error instanceof Error)) {
      window.parent.postMessage(
        {
          type: "window-error",
          payload: {
            message: error.toString(),
            stack: "<no stack available - an improper error was thrown>",
          },
        },
        PARENT_TARGET_ORIGIN,
      );
      return;
    }
    sendSourcemappedErrorToParent(error, "window-error");
  });

  window.addEventListener("unhandledrejection", (event) => {
    let error = event.reason;
    if (!(error instanceof Error)) {
      window.parent.postMessage(
        {
          type: "unhandled-rejection",
          payload: {
            message: event.reason.toString(),
            stack:
              "<no stack available - an improper error was thrown (promise)>",
          },
        },
        PARENT_TARGET_ORIGIN,
      );
      return;
    }
    sendSourcemappedErrorToParent(error, "unhandled-rejection");
  });

  (function watchForViteErrorOverlay() {
    // --- Configuration for the observer ---
    // We only care about direct children being added or removed.
    const config = {
      childList: true, // Observe additions/removals of child nodes
      subtree: false, // IMPORTANT: Do *not* observe descendants, only direct children
    };

    // --- Callback function executed when mutations are observed ---
    const observerCallback = function (mutationsList) {
      // Iterate through all mutations that just occurred
      for (const mutation of mutationsList) {
        // We are only interested in nodes that were added
        if (mutation.type === "childList" && mutation.addedNodes.length > 0) {
          // Check each added node
          for (const node of mutation.addedNodes) {
            // Check if it's an ELEMENT_NODE (type 1) and has the correct ID
            if (
              node.nodeType === Node.ELEMENT_NODE &&
              node.tagName === "vite-error-overlay".toUpperCase()
            ) {
              reportViteErrorOverlay(node);
            }
          }
        }
      }
    };

    function reportViteErrorOverlay(node) {
      console.log(`Detected vite error overlay: ${node}`);
      try {
        window.parent.postMessage(
          {
            type: "build-error-report",
            payload: {
              message: node.shadowRoot.querySelector(".message").textContent,
              file: node.shadowRoot.querySelector(".file").textContent,
              frame: node.shadowRoot.querySelector(".frame").textContent,
            },
          },
          PARENT_TARGET_ORIGIN,
        );
      } catch (error) {
        console.error("Could not report vite error overlay", error);
      }
    }

    // --- Wait for DOM ready logic ---
    if (document.readyState === "loading") {
      // The document is still loading, wait for DOMContentLoaded
      document.addEventListener("DOMContentLoaded", () => {
        if (!document.body) {
          console.error(
            "document.body does not exist - something very weird happened",
          );
          return;
        }

        const node = document.body.querySelector("vite-error-overlay");
        if (node) {
          reportViteErrorOverlay(node);
        }
        const observer = new MutationObserver(observerCallback);
        observer.observe(document.body, config);
      });
      console.log(
        "Document loading, waiting for DOMContentLoaded to set up observer.",
      );
    } else {
      if (!document.body) {
        console.error(
          "document.body does not exist - something very weird happened",
        );
        return;
      }
      // The DOM is already interactive or complete
      console.log("DOM already ready, setting up observer immediately.");
      const observer = new MutationObserver(observerCallback);
      observer.observe(document.body, config);
    }
  })();
})();
