import { expect } from "@playwright/test";
import type { PageObject } from "./helpers/page-objects";
import { test, Timeout } from "./helpers/test_helper";

const BUILD_TIMEOUT = 10 * 60_000;
const TEST_TIMEOUT = 20 * 60_000;

async function runBuildAndVerifyPreview({
  po,
  fixture,
  expectedScript,
  expectedMode,
  previewText,
}: {
  po: PageObject;
  fixture: "run-build-vite" | "run-build-next";
  expectedScript: "vite build" | "next build";
  expectedMode: "isolated" | "in-place";
  previewText: string;
}) {
  const preview = po.previewPanel.getPreviewIframeElement();
  await expect(preview).toBeVisible({ timeout: Timeout.EXTRA_LONG });
  await expect(preview.contentFrame().locator("body")).toContainText(
    previewText,
    { timeout: Timeout.EXTRA_LONG },
  );
  const previewProcessId = await po.appManagement.getCurrentAppProcessId();
  expect(previewProcessId).not.toBeNull();

  await po.sendPrompt(`tc=local-agent/${fixture}`, {
    skipWaitForCompletion: true,
  });
  await po.agentConsent.waitForAgentConsentBanner(Timeout.EXTRA_LONG);
  await expect(
    po.page.getByText(`build: ${expectedScript}`, { exact: false }).last(),
  ).toBeVisible();
  await expect(
    po.page.getByText("not a security sandbox", { exact: false }).last(),
  ).toBeVisible();
  await expect(preview).toBeVisible();
  await po.agentConsent.clickAgentConsentAllowOnce();

  await po.chatActions.waitForChatCompletion({ timeout: BUILD_TIMEOUT });
  const buildCard = po.page
    .getByRole("button", { name: /Build passed/ })
    .last();
  await expect(buildCard).toBeVisible({ timeout: BUILD_TIMEOUT });
  await buildCard.click();
  await expect(buildCard).toContainText(`Mode: ${expectedMode}`);
  expect(await po.appManagement.getCurrentAppProcessId()).toBe(
    previewProcessId,
  );

  // A loaded iframe can survive a dead server. Reload it so this assertion
  // proves the existing preview server still answers after the build.
  await preview
    .contentFrame()
    .locator("body")
    .evaluate(() => location.reload());
  await expect(preview.contentFrame().locator("body")).toContainText(
    previewText,
    { timeout: Timeout.EXTRA_LONG },
  );
}

test("local-agent builds Vite, Next.js 15, and Next.js 16 without stopping previews", async ({
  po,
}, testInfo) => {
  testInfo.setTimeout(TEST_TIMEOUT);
  await po.setUpDyadPro({ autoApprove: true, localAgent: true });

  // Build mode creates an app from the actual bundled Vite scaffold.
  await po.chatActions.selectChatMode("build");
  await po.sendPrompt("tc=edit-made-with-dyad", {
    timeout: Timeout.EXTRA_LONG,
  });
  await po.appManagement.ensurePnpmInstall();
  await po.previewPanel.expectPreviewIframeIsVisible(Timeout.EXTRA_LONG);
  await po.appManagement.setNeedsAppBlueprintForCurrentApp(false);
  await po.chatActions.selectLocalAgentMode();
  await runBuildAndVerifyPreview({
    po,
    fixture: "run-build-vite",
    expectedScript: "vite build",
    expectedMode: "isolated",
    previewText: "Welcome to Your Blank App",
  });

  await po.navigation.goToAppsTab();
  await po.importApp("next15-build");
  await po.chatActions.selectLocalAgentMode();
  await po.appManagement.ensurePnpmInstall();
  await runBuildAndVerifyPreview({
    po,
    fixture: "run-build-next",
    expectedScript: "next build",
    expectedMode: "isolated",
    previewText: "Next.js 15 build fixture",
  });

  await po.navigation.goToAppsTab();
  await po.importApp("next16-build");
  await po.chatActions.selectLocalAgentMode();
  await po.appManagement.ensurePnpmInstall();
  await runBuildAndVerifyPreview({
    po,
    fixture: "run-build-next",
    expectedScript: "next build",
    expectedMode: "in-place",
    previewText: "Next.js 16 build fixture",
  });
});
