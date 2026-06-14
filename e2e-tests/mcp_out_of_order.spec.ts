// Out-of-order parallel MCP tool results. Two tools run in one step; the
// "slow_add" tool finishes after "calculator_add". This exercises the merged
// tool card: the call/result blocks arrive interleaved (callA, callB, resultB,
// resultA) yet must collapse into exactly two cards, with the slow card
// showing a pending spinner while the fast card has already resolved.
import path from "path";
import { expect } from "@playwright/test";
import { testSkipIfWindows } from "./helpers/test_helper";

testSkipIfWindows(
  "mcp - out-of-order parallel tool results merge into one card each",
  async ({ po }) => {
    await po.setUp();
    await po.navigation.goToSettingsTab();
    await po.settings.scrollToSettingsSection("advanced");
    await po.settings.toggleEnableMcpServersForBuildMode();
    await po.settings.scrollToSettingsSection("tools-mcp");

    await po.page
      .getByRole("textbox", { name: "My MCP Server" })
      .fill("testing-mcp-server");
    await po.page.getByRole("textbox", { name: "node" }).fill("node");
    const testMcpServerPath = path.join(
      __dirname,
      "..",
      "testing",
      "fake-stdio-mcp-server.mjs",
    );
    await po.page
      .getByRole("textbox", { name: "path/to/mcp-server.js --flag" })
      .fill(testMcpServerPath);
    await po.page.getByRole("button", { name: "Add Server" }).click();

    // Widen the slow tool's delay so the pending window is comfortably
    // observable from the test.
    await po.page
      .getByRole("button", { name: "Add Environment Variable" })
      .click();
    await po.page
      .getByRole("textbox", { name: "Key" })
      .fill("SLOW_ADD_DELAY_MS");
    await po.page.getByRole("textbox", { name: "Value" }).fill("12000");
    await po.page.getByRole("button", { name: "Save" }).click();

    await po.navigation.goToAppsTab();
    await po.chatActions.selectChatMode("build");
    await po.sendPrompt("[call_tools_out_of_order]", {
      skipWaitForCompletion: true,
    });

    // Two parallel tools => two consent prompts, possibly shown at once. A
    // bare "Always allow" locator would be a strict-mode violation with two
    // banners, so always click the first visible one. Wait up to 8s for the
    // first prompt, then drain the rest with quick visibility probes so we
    // don't burn the slow tool's pending window waiting on a phantom banner.
    const firstAllow = po.page
      .getByRole("button", { name: "Always allow" })
      .first();
    await firstAllow.waitFor({ state: "visible", timeout: 8000 });
    for (let i = 0; i < 4; i++) {
      const allow = po.page
        .getByRole("button", { name: "Always allow" })
        .first();
      if (!(await allow.isVisible())) break;
      await allow.click();
      await po.page.waitForTimeout(300);
    }

    const slowCard = po.page
      .getByRole("button")
      .filter({ hasText: "slow_add" });
    const fastCard = po.page
      .getByRole("button")
      .filter({ hasText: "calculator_add" });

    // Merge: two cards, not four separate call/result blocks.
    await expect(
      po.page.getByRole("button").filter({ hasText: "testing-mcp-server" }),
    ).toHaveCount(2);

    // Out-of-order: the fast card is on screen and the slow card is still
    // pending (spinner) while we are inside the slow tool's delay window.
    await expect(fastCard).toBeVisible();
    await expect(slowCard.getByText("Running")).toBeVisible();

    // Settle: the slow card resolves and nothing is left pending.
    await expect(slowCard.getByText("Running")).toHaveCount(0, {
      timeout: 15000,
    });
    await expect(po.page.getByText("Running")).toHaveCount(0);
  },
);
