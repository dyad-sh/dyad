import { testSkipIfWindows, Timeout } from "./helpers/test_helper";
import { expect } from "@playwright/test";

testSkipIfWindows(
  "preview loading screen shows spinner and server logs",
  async ({ po }) => {
    await po.setUp({ autoApprove: true });
    await po.sendPrompt("hi");

    // Force the loading state so we can observe the new loading screen.
    await po.clickRestart();

    await expect(po.previewPanel.locateLoadingAppPreview()).toBeVisible({
      timeout: Timeout.MEDIUM,
    });
    // Debug: dump element with the spinner text and its ancestors
    const dump = await po.page.evaluate(() => {
      const para = Array.from(document.querySelectorAll("p")).find((p) =>
        p.textContent?.includes("Preparing app preview"),
      );
      if (!para) return "spinner paragraph not found";
      const chain: string[] = [];
      let el: HTMLElement | null = para as HTMLElement;
      for (let i = 0; i < 6 && el; i++) {
        chain.push(
          `${el.tagName}.${el.className.slice(0, 60)} testid=${
            (el as HTMLElement).dataset.testid
          }`,
        );
        el = el.parentElement;
      }
      return chain.join("\n  -> ");
    });
    console.log("[DEBUG] spinner ancestor chain:\n  ", dump);
    const loadingScreen = po.previewPanel.locatePreviewLoadingScreen();
    await expect(loadingScreen).toBeVisible({ timeout: Timeout.MEDIUM });

    // Log strip renders the "Server logs" header and the log list container.
    await expect(loadingScreen.getByText("Server logs")).toBeVisible();
    await expect(po.previewPanel.locatePreviewLoadingLogList()).toBeVisible();

    // The loading screen animates out once the iframe is ready.
    await expect(loadingScreen).toBeHidden({ timeout: Timeout.LONG });
    await po.previewPanel.expectPreviewIframeIsVisible();
  },
);

testSkipIfWindows(
  "preview loading screen surfaces errors when dev script is missing",
  async ({ po }) => {
    await po.setUp({ autoApprove: true });

    // Bring up a working app first so node_modules are populated and we
    // know a clean restart would normally succeed.
    await po.sendPrompt("hi");
    await po.previewPanel.expectPreviewIframeIsVisible(Timeout.EXTRA_LONG);

    // Overwrite package.json with a version that has no "dev" script.
    // The next `npm run dev` will exit non-zero with "Missing script: dev",
    // producing server-level error entries that should flow into the
    // loading screen's error banner.
    await po.sendPrompt("tc=break-package-json");

    await po.clickRestart();

    const loadingScreen = po.previewPanel.locatePreviewLoadingScreen();
    await expect(loadingScreen).toBeVisible({ timeout: Timeout.MEDIUM });

    // Wait for the error banner inside the loading screen to surface.
    const errorBanner = po.previewPanel.locatePreviewLoadingErrorBanner();
    await expect(errorBanner).toBeVisible({ timeout: Timeout.EXTRA_LONG });

    // The loading screen must still be up — we haven't reached an iframe.
    await expect(loadingScreen).toBeVisible();

    // Expand the collapsed error list and verify at least one entry shows.
    await po.previewPanel.clickPreviewLoadingErrorToggle();
    const errorList = errorBanner.locator("ul li");
    await expect(errorList.first()).toBeVisible();

    // Fix-with-AI button should reflect the error count and trigger a chat.
    const fixButton = po.page.getByTestId("preview-loading-fix-errors-button");
    await expect(fixButton).toBeVisible();
    await expect(fixButton).toContainText(/Fix \d+ error\(s\) with AI/);

    await po.previewPanel.clickPreviewLoadingFixErrors();
    await po.chatActions.waitForChatCompletion();
  },
);
