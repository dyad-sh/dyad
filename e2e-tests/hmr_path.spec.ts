import { testSkipIfWindows, Timeout } from "./helpers/test_helper";
import { expect } from "@playwright/test";
import * as fs from "fs";
import * as path from "path";

// This test reproduces a regression from PR #2336 where navigating back to root
// doesn't clear the preserved URL, causing the wrong route to load after HMR
testSkipIfWindows(
  "HMR after navigating back to root should stay on root",
  async ({ po }) => {
    await po.setUp({ autoApprove: true });

    // Create a multi-page app with react-router navigation
    await po.sendPrompt("tc=multi-page");

    // Wait for the preview iframe to be visible and loaded
    await po.expectPreviewIframeIsVisible();

    // Wait for the Home Page content to be visible in the iframe
    await expect(
      po
        .getPreviewIframeElement()
        .contentFrame()
        .getByRole("heading", { name: "Home Page" }),
    ).toBeVisible({ timeout: Timeout.LONG });

    // Navigate to /about by clicking the link
    await po
      .getPreviewIframeElement()
      .contentFrame()
      .getByText("Go to About Page")
      .click();

    // Wait for About Page to be visible
    await expect(
      po
        .getPreviewIframeElement()
        .contentFrame()
        .getByRole("heading", { name: "About Page" }),
    ).toBeVisible({ timeout: Timeout.MEDIUM });

    // Navigate back to / by clicking the link (triggers pushState with pathname "/")
    // This is the scenario that triggers the bug - pushState to "/" doesn't clear preserved URL
    await po
      .getPreviewIframeElement()
      .contentFrame()
      .getByText("Go to Home Page")
      .click();

    // Wait for Home Page to be visible
    await expect(
      po
        .getPreviewIframeElement()
        .contentFrame()
        .getByRole("heading", { name: "Home Page" }),
    ).toBeVisible({ timeout: Timeout.MEDIUM });

    // Verify address bar shows root path
    await expect(po.page.getByTestId("preview-address-bar-path")).toHaveText(
      "/",
    );

    // Get the app path to modify the Index.tsx file
    const appPath = await po.getCurrentAppPath();
    if (!appPath) {
      throw new Error("No app path found");
    }

    // Trigger HMR by modifying the Index.tsx file
    const indexPath = path.join(appPath, "src/pages/Index.tsx");
    const originalContent = fs.readFileSync(indexPath, "utf-8");
    // Add a comment to trigger HMR without changing behavior
    const modifiedContent = originalContent.replace(
      "<h1",
      "{/* HMR trigger */}\n        <h1",
    );
    fs.writeFileSync(indexPath, modifiedContent);

    // Wait for HMR to complete - the page should reload but stay on root
    // Give time for the file watcher and HMR to process
    await po.page.waitForTimeout(2000);

    // After HMR, the page should still be on Home Page (/)
    // BUG: Due to the regression, it might incorrectly load /about
    await expect(
      po
        .getPreviewIframeElement()
        .contentFrame()
        .getByRole("heading", { name: "Home Page" }),
    ).toBeVisible({ timeout: Timeout.MEDIUM });
    await expect(
      po
        .getPreviewIframeElement()
        .contentFrame()
        .getByRole("heading", { name: "About Page" }),
    ).not.toBeVisible();
  },
);
