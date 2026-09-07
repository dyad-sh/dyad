import { expect } from "@playwright/test";
import { FAKE_LLM_BASE_PORT } from "./helpers/test-ports";
import { testSkipIfWindows, Timeout } from "./helpers/test_helper";

testSkipIfWindows(
  "recovers a cloud preview to ready after a failed stop re-emits the proxy line under the run ref",
  async ({ po }, testInfo) => {
    testInfo.setTimeout(Timeout.EXTRA_LONG * 3);
    await po.setUp({ autoApprove: true });

    // Enable cloud sandbox mode and provision an app.
    await po.navigation.goToSettingsTab();
    await po.page.getByRole("button", { name: "Experiments" }).click();
    await po.settings.toggleCloudSandboxExperiment();
    await po.settings.changeRuntimeMode("cloud");
    await po.navigation.goToAppsTab();
    await po.sendPrompt("hi");
    await expect(async () => {
      await po.previewPanel.expectPreviewIframeIsVisible(Timeout.SHORT);
    }).toPass({ timeout: Timeout.EXTRA_LONG * 2 });
    await expect(po.previewPanel.getCloudBadge()).toBeVisible({
      timeout: Timeout.LONG,
    });

    // Resolve the appId and the live sandboxId.
    const appName = await po.appManagement.getCurrentAppName();
    const appId = await po.page.evaluate(async (name) => {
      const { apps } = await (window as any).electron.ipcRenderer.invoke(
        "list-apps",
      );
      return apps.find((app: { name: string }) => app.name === name)
        ?.id as number;
    }, appName);
    expect(appId).toEqual(expect.any(Number));

    const sandboxId = await po.page.evaluate(async (id) => {
      const status = await (window as any).electron.ipcRenderer.invoke(
        "get-cloud-sandbox-status",
        { appId: id },
      );
      return status?.sandboxId as string | undefined;
    }, appId);
    expect(sandboxId).toBeTruthy();

    // Inject a failing cloud teardown for the next stop. The fake backend
    // returns 500 without deleting the sandbox, so runningApps[appId] (with
    // the original START invocationRef and proxy worker) survives.
    const controlPort = FAKE_LLM_BASE_PORT + testInfo.parallelIndex;
    await fetch(`http://localhost:${controlPort}/test/cloud-sandbox-control`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sandboxId, failNextDestroy: true }),
    });

    // Subscribe to the app_run snapshot so we can observe the run phase.
    const getPhase = () =>
      po.page.evaluate(async (id) => {
        const snapshot = await (window as any).electron.ipcRenderer.invoke(
          "distributed-machine:subscribe",
          {
            protocolVersion: 1,
            machineId: "app_run",
            encodedKey: { appId: id },
          },
        );
        return snapshot?.encodedState?.phase as string | undefined;
      }, appId);

    // Trigger a Stop; the injected failure makes the cloud teardown reject,
    // landing the app in `errored` under the stop ref.
    await po.page.evaluate(async (id) => {
      try {
        await (window as any).electron.ipcRenderer.invoke("stop-app", {
          appId: id,
        });
      } catch (error) {
        return error;
      }
    }, appId);

    // The app must be errored (the stop failed) before recovery can be observed.
    await expect
      .poll(getPhase, { timeout: Timeout.LONG, intervals: [500] })
      .toBe("errored");

    // Rotate the cloud preview credentials so a subsequent status fetch
    // observes `previewChanged=true` and re-emits the proxy line under the
    // surviving START ref.
    await fetch(`http://localhost:${controlPort}/test/cloud-sandbox-control`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sandboxId,
        rotatedPreviewAuthToken: "rotated-after-failed-stop",
      }),
    });

    // Drive the cloud-status handler directly (the same path the 15s poll
    // takes) so the recovery is deterministic rather than waiting on the
    // poll. The handler re-emits PROXY_READY under the original run ref;
    // with the errored exemption the app must recover to `ready` and
    // re-mount the live preview.
    await po.page.evaluate(async (id) => {
      try {
        await (window as any).electron.ipcRenderer.invoke(
          "get-cloud-sandbox-status",
          { appId: id },
        );
      } catch {
        // A thrown status fetch is not the recovery signal we are testing;
        // the phase assertion below is the source of truth.
      }
    }, appId);

    await expect
      .poll(getPhase, { timeout: Timeout.EXTRA_LONG, intervals: [500] })
      .toBe("ready");

    await expect(async () => {
      await po.previewPanel.expectPreviewIframeIsVisible(Timeout.SHORT);
    }).toPass({ timeout: Timeout.LONG });
  },
);
