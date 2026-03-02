import { expect } from "@playwright/test";
import { testSkipIfWindows } from "./helpers/test_helper";

/**
 * E2E test for local-agent connection retry resilience.
 * Verifies that the agent automatically recovers from transient connection
 * drops (e.g., TCP terminated mid-stream) by retrying the stream.
 */

testSkipIfWindows(
  "local-agent - recovers from connection drop",
  async ({ po }) => {
    await po.setUpDyadPro({ localAgent: true });
    await po.importApp("minimal");
    await po.chatActions.selectLocalAgentMode();

    // The connection-drop fixture drops on turn 1 (after a tool turn already
    // completed) to simulate a realistic interrupted follow-up request.
    await po.sendPrompt("tc=local-agent/connection-drop");

    // Verify the turn still completed and no error box leaked to the UI.
    await expect(po.page.getByTestId("chat-error-box")).toHaveCount(0);
    await expect(
      po.page.getByText("Successfully created the file after automatic retry."),
    ).toBeVisible();

    // Verify exactly one recovered.ts edit card is shown in chat.
    await expect(
      po.page.getByRole("button", {
        name: /recovered\.ts .*src\/recovered\.ts.*Edit/,
      }),
    ).toHaveCount(1);

    // Snapshot end state for chat + filesystem.
    await po.snapshotMessages();
    await po.snapshotAppFiles({
      name: "after-connection-retry",
      files: ["src/recovered.ts"],
    });
  },
);
