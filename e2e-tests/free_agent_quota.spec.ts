import { testSkipIfWindows, Timeout } from "./helpers/test_helper";
import { expect } from "@playwright/test";

/**
 * E2E test for Basic Agent mode quota (free users).
 *
 * Basic Agent mode is available to non-Pro users with a 5-message-per-day limit.
 * This test verifies mode availability, quota tracking, exceeded banner, and mode switching.
 */

testSkipIfWindows(
  "free agent quota - full flow: mode availability, quota tracking, exceeded banner, switch to build",
  async ({ po }) => {
    // Set up WITHOUT Dyad Pro - use test provider instead
    await po.setUp({ autoApprove: true });
    await po.importApp("minimal");

    // 1. Verify Basic Agent mode is available (not Agent v2 which is Pro-only)
    await po.page.getByTestId("chat-mode-selector").click();
    await expect(
      po.page.getByRole("option", { name: /Basic Agent/ }),
    ).toBeVisible();
    await expect(
      po.page.getByRole("option", { name: /Agent v2/ }),
    ).not.toBeVisible();

    // 2. Verify initial quota shows 5/5 remaining
    await expect(
      po.page.getByRole("option", { name: /Basic Agent.*5\/5 remaining/ }),
    ).toBeVisible();
    await po.page.keyboard.press("Escape");

    // 3. Select Basic Agent mode and verify it's selected
    await po.selectChatMode("basic-agent");
    await expect(po.page.getByTestId("chat-mode-selector")).toContainText(
      "Basic Agent",
    );

    // 4. Send 5 messages to exhaust quota, verify quota decrements
    for (let i = 0; i < 5; i++) {
      await po.sendPrompt(`tc=local-agent/simple-response message ${i + 1}`);
      await po.waitForChatCompletion();
    }

    // 5. Verify quota exceeded banner appears with correct content
    await expect(po.page.getByTestId("free-agent-quota-banner")).toBeVisible({
      timeout: Timeout.MEDIUM,
    });
    await expect(po.page.getByTestId("free-agent-quota-banner")).toContainText(
      "You have used all 5 messages for the free Agent mode today",
    );
    await expect(
      po.page.getByRole("button", { name: "Upgrade to Dyad Pro" }),
    ).toBeVisible();
    await expect(
      po.page.getByRole("button", { name: "Switch back to Build mode" }),
    ).toBeVisible();

    // 6. Try to send a 6th message - should be blocked with error
    await po.sendPrompt("tc=local-agent/simple-response message 6");
    // Verify error message appears indicating quota exceeded
    await expect(po.page.getByTestId("chat-error-box")).toBeVisible({
      timeout: Timeout.MEDIUM,
    });
    await expect(po.page.getByTestId("chat-error-box")).toContainText(
      "You have used all 5 free Agent messages for today",
    );

    // 8. Click "Switch back to Build mode" and verify mode changes
    await po.page
      .getByRole("button", { name: "Switch back to Build mode" })
      .click();
    await expect(po.page.getByTestId("chat-mode-selector")).toContainText(
      "Build",
    );
    await expect(
      po.page.getByTestId("free-agent-quota-banner"),
    ).not.toBeVisible();

    // 9. Verify user can still send messages in Build mode
    await po.sendPrompt("[dyad-qa=write] create a simple file");
    await po.waitForChatCompletion();
  },
);
