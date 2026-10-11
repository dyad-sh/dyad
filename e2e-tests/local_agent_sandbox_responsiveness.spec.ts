import { expect } from "@playwright/test";
import { test, Timeout } from "./helpers/test_helper";

/**
 * Regression test for #4728. A CPU-bound sandbox script used to run on the
 * Electron main thread, where nothing could interrupt it, so every IPC request
 * stalled until the script finished and Windows reported the app as not
 * responding. Scripts now run on a worker thread: while the fixture's script
 * runs for several seconds, renderer-to-main round trips must keep completing
 * promptly.
 */
test("local-agent - long sandbox script keeps the main process responsive", async ({
  po,
}) => {
  await po.setUpDyadPro({ autoApprove: true, localAgent: true });
  await po.importApp("minimal");
  await po.chatActions.selectLocalAgentMode();

  await po.sendPrompt("tc=local-agent/sandbox-long-script", {
    skipWaitForCompletion: true,
  });

  // Probe the main process until the turn ends. Each probe is an ordinary
  // renderer-to-main IPC request, the same path the UI stalls on when the
  // main thread is busy.
  const roundTripsMs: number[] = [];
  let completed = false;
  const completion = po.chatActions
    .waitForChatCompletion({ timeout: Timeout.LONG })
    .finally(() => {
      completed = true;
    });
  while (!completed) {
    const startedAt = Date.now();
    await po.page.evaluate(() =>
      (window as any).electron.ipcRenderer.invoke("get-user-settings"),
    );
    roundTripsMs.push(Date.now() - startedAt);
    await po.page.waitForTimeout(250);
  }
  await completion;

  await expect(
    po.page.getByText("The long sandbox script finished."),
  ).toBeVisible();

  // The script card reports interpreter time. It must be long enough that the
  // probes above overlapped it; otherwise the responsiveness check is vacuous.
  const card = po.page.getByTestId("dyad-script-card");
  await expect(card).toBeVisible();
  const executionMs = Number((await card.innerText()).match(/(\d+)ms/)?.[1]);
  const slowestRoundTripMs = Math.max(...roundTripsMs);
  const probeSummary = `script ${executionMs}ms, ${roundTripsMs.length} probes, slowest round trip ${slowestRoundTripMs}ms`;
  test
    .info()
    .annotations.push({ type: "sandbox-probe", description: probeSummary });
  console.log(`[sandbox-probe] ${probeSummary}`);
  expect(executionMs).toBeGreaterThan(2_000);

  expect(slowestRoundTripMs).toBeLessThan(2_000);
});
