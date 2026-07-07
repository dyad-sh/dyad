import { expect } from "@playwright/test";
import { Timeout, testSkipIfWindows } from "./helpers/test_helper";

/**
 * E2E test for Design mode: selecting the mode, running the design flow via the
 * write_design_spec tool, and rendering the Design preview panel with the
 * design system and interface cards.
 */
testSkipIfWindows(
  "design mode - renders design spec in panel",
  async ({ po }) => {
    // Design mode is Pro-only (image generation requires a Dyad Pro key).
    await po.setUpDyadPro({ localAgent: true });
    await po.importApp("minimal");
    await po.chatActions.clickNewChat();

    await po.chatActions.selectChatMode("design");

    await po.sendPrompt("tc=local-agent/design", {
      skipWaitForCompletion: true,
    });

    // The inline chat card for the written design appears.
    await expect(
      po.page.getByRole("button", { name: "View Design" }).last(),
    ).toBeVisible({ timeout: Timeout.MEDIUM });

    // The Design preview panel auto-opens and shows the design system + screens.
    const designPanel = po.page.getByTestId("design-panel");
    await expect(designPanel).toBeVisible({ timeout: Timeout.MEDIUM });
    await expect(designPanel).toContainText("Test Design");
    await expect(designPanel).toContainText("Design system");
    await expect(designPanel).toContainText("#4F46E5");
    await expect(designPanel).toContainText("Home screen");
    await expect(designPanel).toContainText("Settings screen");

    // Each interface offers a Regenerate action.
    await expect(po.page.getByTestId("regenerate-interface-home")).toBeVisible({
      timeout: Timeout.MEDIUM,
    });
  },
);
