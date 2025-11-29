(() => {
  async function captureScreenshot() {
    try {
      // Use html-to-image if available
      if (typeof htmlToImage !== "undefined") {
        return await htmlToImage.toPng(document.body, {
          width: document.documentElement.scrollWidth,
          height: document.documentElement.scrollHeight,
        });
      }
      throw new Error("html-to-image library not found");
    } catch (error) {
      console.error("[dyad-screenshot] Failed to capture screenshot:", error);
      throw error;
    }
  }
  async function handleScreenshotRequest() {
    try {
      console.debug("[dyad-screenshot] Capturing screenshot...");

      // Save current styles
      const originalPaddingTop = document.body.style.paddingTop;
      const originalTransition = document.body.style.transition;

      // Add padding to avoid toolbar covering content
      // The toolbar is approx 60px height + offset, so 80px is safe
      document.body.style.transition = "none";
      document.body.style.paddingTop = "80px";

      // Wait a brief moment for layout to update
      await new Promise((resolve) =>
        requestAnimationFrame(() => setTimeout(resolve, 100)),
      );

      const dataUrl = await captureScreenshot();

      // Restore styles
      document.body.style.paddingTop = originalPaddingTop;
      document.body.style.transition = originalTransition;

      console.debug("[dyad-screenshot] Screenshot captured successfully");

      // Send success response to parent
      window.parent.postMessage(
        {
          type: "dyad-screenshot-response",
          success: true,
          dataUrl: dataUrl,
        },
        "*",
      );
    } catch (error) {
      console.error("[dyad-screenshot] Screenshot capture failed:", error);

      // Send error response to parent
      window.parent.postMessage(
        {
          type: "dyad-screenshot-response",
          success: false,
          error: error.message,
        },
        "*",
      );
    }
  }

  window.addEventListener("message", (event) => {
    if (event.source !== window.parent) return;

    if (event.data.type === "dyad-take-screenshot") {
      handleScreenshotRequest();
    }
  });
})();
