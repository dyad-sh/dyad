(function () {
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
        PARENT_TARGET_ORIGIN
      );
    } catch (e) {
      console.error(
        `[vite-dev-plugin] Error calling original ${navigationType}: `,
        e
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
        PARENT_TARGET_ORIGIN
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
  window.addEventListener("popstate", (event) => {
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
        PARENT_TARGET_ORIGIN
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
          PARENT_TARGET_ORIGIN
        );
      })
      .catch((mappingError) => {
        console.error(
          "[vite-dev-plugin] Error during stacktrace sourcemapping:",
          mappingError
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
          PARENT_TARGET_ORIGIN
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
        PARENT_TARGET_ORIGIN
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
        PARENT_TARGET_ORIGIN
      );
      return;
    }
    sendSourcemappedErrorToParent(error, "unhandled-rejection");
  });
})();
