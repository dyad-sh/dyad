import { expect } from "@playwright/test";
import { testSkipIfWindows } from "./helpers/test_helper";

testSkipIfWindows(
  "local-agent cancellation aborts a hanging engine tool request",
  async ({ po }) => {
    const fakeEngineStateUrl = `http://localhost:${po.fakeLlmPort}/test/engine-web-crawl-hang`;
    await fetch(`${fakeEngineStateUrl}/reset`, { method: "POST" });

    await po.setUpDyadPro({ localAgent: true });
    await po.importApp("minimal");
    await po.chatActions.selectLocalAgentMode();

    await po.sendPrompt("tc=local-agent/cancel-engine-tool", {
      skipWaitForCompletion: true,
    });

    await expect
      .poll(
        async () =>
          (
            (await (await fetch(fakeEngineStateUrl)).json()) as {
              started: boolean;
            }
          ).started,
        { timeout: 10_000 },
      )
      .toBe(true);

    const cancelButton = po.page.getByRole("button", {
      name: "Cancel generation",
    });
    const messages = po.page.getByTestId("messages-list");
    await expect(cancelButton).toBeVisible();
    await expect(messages).toContainText("Web Fetch");
    await expect(messages).toContainText("Fetching...");
    await cancelButton.click();

    await expect(cancelButton).not.toBeVisible({ timeout: 10_000 });
    await expect
      .poll(
        async () =>
          (
            (await (await fetch(fakeEngineStateUrl)).json()) as {
              closed: boolean;
            }
          ).closed,
        { timeout: 10_000 },
      )
      .toBe(true);

    await fetch(`${fakeEngineStateUrl}/release`, { method: "POST" });
    await expect
      .poll(
        async () =>
          (
            (await (await fetch(fakeEngineStateUrl)).json()) as {
              lateResponseAttempted: boolean;
            }
          ).lateResponseAttempted,
      )
      .toBe(true);
    await expect(messages).not.toContainText("LATE_CANCELLED_TOOL_SUCCESS");

    await po.chatActions.clickNewChat();
    await po.sendPrompt("tc=local-agent/simple-response");
    await expect(messages).toContainText(
      "This is a simple response from the Basic Agent mode.",
    );
    await expect(cancelButton).not.toBeVisible();
  },
);
