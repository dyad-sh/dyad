import { expect } from "@playwright/test";
import { testSkipIfWindows, Timeout } from "./helpers/test_helper";

testSkipIfWindows(
  "cloud sandbox runtime mode runs previews",
  async ({ po }) => {
    await po.setUp({ autoApprove: true });

    await po.navigation.goToSettingsTab();
    await po.page.getByRole("button", { name: "Experiments" }).click();
    await po.settings.toggleCloudSandboxExperiment();
    await po.settings.changeRuntimeMode("cloud");
    expect(po.settings.recordSettings()).toMatchObject({
      runtimeMode2: "cloud",
    });

    await po.navigation.goToAppsTab();
    await po.sendPrompt("hi");

    await po.previewPanel.expectPreviewIframeIsVisible(Timeout.EXTRA_LONG);
    await expect(po.previewPanel.getCloudBadge()).toBeVisible({
      timeout: Timeout.LONG,
    });
    await expect(
      po.previewPanel
        .getPreviewIframeElement()
        .contentFrame()
        .getByRole("heading", { name: "Cloud Sandbox Preview" }),
    ).toBeVisible({ timeout: Timeout.LONG });
  },
);

testSkipIfWindows(
  "cloud sandbox undo restores the remote snapshot",
  async ({ po }) => {
    await po.setUp({ autoApprove: true });

    await po.navigation.goToSettingsTab();
    await po.page.getByRole("button", { name: "Experiments" }).click();
    await po.settings.toggleCloudSandboxExperiment();
    await po.settings.changeRuntimeMode("cloud");

    await po.navigation.goToAppsTab();
    await po.sendPrompt("hi");

    await po.previewPanel.expectPreviewIframeIsVisible(Timeout.EXTRA_LONG);
    let iframe = po.previewPanel.getPreviewIframeElement().contentFrame();
    const updatedDigestText = await iframe
      .getByTestId("cloud-snapshot-digest")
      .textContent({ timeout: Timeout.LONG });
    const updatedDigest = updatedDigestText?.split(": ").at(-1)?.trim();

    expect(updatedDigest).toBeTruthy();

    await po.page.getByRole("button", { name: "Undo" }).click();

    await expect
      .poll(
        async () => {
          await po.previewPanel.clickPreviewRefresh();
          iframe = po.previewPanel.getPreviewIframeElement().contentFrame();
          const digestText = await iframe
            .getByTestId("cloud-snapshot-digest")
            .textContent({ timeout: Timeout.LONG });
          return digestText?.split(": ").at(-1)?.trim();
        },
        { timeout: Timeout.LONG },
      )
      .not.toBe(updatedDigest);
  },
);
