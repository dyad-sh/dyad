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
      console.error("[coney-screenshot] Failed to capture screenshot:", error);
      throw error;
    }
  }
  async function handleScreenshotRequest() {
    try {
      console.debug("[coney-screenshot] Capturing screenshot...");

      const dataUrl = await captureScreenshot();

      console.debug("[coney-screenshot] Screenshot captured successfully");

      // Send success response to parent
      window.parent.postMessage(
        {
          type: "coney-screenshot-response",
          success: true,
          dataUrl: dataUrl,
        },
        "*",
      );
    } catch (error) {
      console.error("[coney-screenshot] Screenshot capture failed:", error);

      // Send error response to parent
      window.parent.postMessage(
        {
          type: "coney-screenshot-response",
          success: false,
          error: error.message,
        },
        "*",
      );
    }
  }

  window.addEventListener("message", (event) => {
    if (event.source !== window.parent) return;

    if (event.data.type === "coney-take-screenshot") {
      handleScreenshotRequest();
    }
  });
})();
