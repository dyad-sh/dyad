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
    const introText = po.page.getByText("I'll create a file for you.");
    const completionText = po.page.getByText(
      "Successfully created the file after automatic retry.",
    );
    await expect(introText).toHaveCount(1);
    await expect(completionText).toHaveCount(1);
    await expect(introText).toBeVisible();
    await expect(completionText).toBeVisible();
    // Partial chunks from the dropped attempt must not leak into final UI.
    await expect(
      po.page.getByText("Partial response before connection dr"),
    ).toHaveCount(0);

    // Verify exactly one recovered.ts edit card is shown in chat.
    const recoveredEditCard = po.page.getByRole("button", {
      name: /recovered\.ts .*src\/recovered\.ts.*Edit/,
    });
    await expect(recoveredEditCard).toHaveCount(1);

    // The replayed conversation order must stay:
    // intro assistant text -> tool edit card -> completion assistant text.
    const introY = (await introText.boundingBox())?.y;
    const editCardY = (await recoveredEditCard.boundingBox())?.y;
    const completionY = (await completionText.boundingBox())?.y;
    expect(introY).toBeDefined();
    expect(editCardY).toBeDefined();
    expect(completionY).toBeDefined();
    expect(introY!).toBeLessThan(editCardY!);
    expect(editCardY!).toBeLessThan(completionY!);

    // Snapshot end state for chat + filesystem.
    await po.snapshotMessages();
    await po.snapshotAppFiles({
      name: "after-connection-retry",
      files: ["src/recovered.ts"],
    });
  },
);

testSkipIfWindows(
  "local-agent - recovers when drop happens after tool-call stream",
  async ({ po }) => {
    await po.setUpDyadPro({ localAgent: true });
    await po.importApp("minimal");
    await po.chatActions.selectLocalAgentMode();

    await po.sendPrompt("tc=local-agent/connection-drop-after-tool-call");

    await expect(po.page.getByTestId("chat-error-box")).toHaveCount(0);
    await expect(
      po.page.getByText(
        "Successfully created the file after retrying from a tool-call termination.",
      ),
    ).toBeVisible();

    await expect(
      po.page
        .getByRole("button", {
          name: /recovered-after-tool-call\.ts .*src\/recovered-after-tool-call\.ts.*Edit/,
        })
        .first(),
    ).toBeVisible();

    await po.snapshotAppFiles({
      name: "after-tool-call-connection-retry",
      files: ["src/recovered-after-tool-call.ts"],
    });
  },
);
