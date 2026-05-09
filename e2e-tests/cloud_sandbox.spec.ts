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

    const getIframe = () =>
      po.previewPanel.getPreviewIframeElement().contentFrame();
    const getCloudSnapshotDigest = async () => {
      const digestText = await getIframe()
        .getByTestId("cloud-snapshot-digest")
        .textContent({ timeout: Timeout.SHORT });
      const digest = digestText?.split(": ").at(-1)?.trim();
      expect(digest).toBeTruthy();
      return digest;
    };
    const getCurrentAppId = async () => {
      const result = await po.page.evaluate(async () => {
        return (window as any).electron.ipcRenderer.invoke(
          "list-apps",
          undefined,
        );
      });
      return result.apps[0].id as number;
    };
    const getCloudSyncRevision = async (appId: number) => {
      const status = await po.page.evaluate(async (id) => {
        return (window as any).electron.ipcRenderer.invoke(
          "get-cloud-sandbox-status",
          { appId: id },
        );
      }, appId);
      return status?.syncRevision ?? 0;
    };

    await po.navigation.goToAppsTab();
    await po.sendPrompt("tc=write-index");
    await po.previewPanel.expectPreviewIframeIsVisible(Timeout.EXTRA_LONG);

    const appId = await getCurrentAppId();
    await expect(async () => {
      expect(await getCloudSyncRevision(appId)).toBeGreaterThanOrEqual(1);
    }).toPass({ timeout: Timeout.EXTRA_LONG });

    await expect(async () => {
      await po.previewPanel.clickPreviewRefresh();
      await getCloudSnapshotDigest();
    }).toPass({ timeout: Timeout.EXTRA_LONG });
    const updatedRevision = await getCloudSyncRevision(appId);
    const updatedDigest = await getCloudSnapshotDigest();

    await po.chatActions.clickUndo();

    await expect(async () => {
      expect(await getCloudSyncRevision(appId)).toBeGreaterThan(
        updatedRevision,
      );
      await po.previewPanel.clickPreviewRefresh();
      await expect(await getCloudSnapshotDigest()).not.toBe(updatedDigest);
    }).toPass({ timeout: Timeout.EXTRA_LONG });
  },
);
