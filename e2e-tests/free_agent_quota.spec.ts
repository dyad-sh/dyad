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

    // 2. Verify quota display is present (may not be 5/5 if AI_RULES.md generation consumed quota)
    await expect(
      po.page.getByRole("option", { name: /Basic Agent.*\d\/5 remaining/ }),
    ).toBeVisible();
    await po.page.keyboard.press("Escape");

    // 3. Select Basic Agent mode and verify it's selected
    await po.selectChatMode("basic-agent");
    await expect(po.page.getByTestId("chat-mode-selector")).toContainText(
      "Basic Agent",
    );

    // 4. Send 5 messages to exhaust quota (this will exhaust quota even if some was already used)
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

testSkipIfWindows(
  "free agent quota - quota resets after 24 hours",
  async ({ po }) => {
    // Set up WITHOUT Dyad Pro - use test provider instead
    await po.setUp({ autoApprove: true });
    await po.importApp("minimal");

    // 1. Select Basic Agent mode and send messages to use some quota
    await po.selectChatMode("basic-agent");
    await expect(po.page.getByTestId("chat-mode-selector")).toContainText(
      "Basic Agent",
    );

    // Send 3 messages to use some quota
    for (let i = 0; i < 3; i++) {
      await po.sendPrompt(`tc=local-agent/simple-response message ${i + 1}`);
      await po.waitForChatCompletion();
    }

    // 2. Verify quota decreased (exact count may vary due to setup messages)
    await po.page.getByTestId("chat-mode-selector").click();
    // The quota should be less than 5/5 after sending messages
    await expect(
      po.page.getByRole("option", { name: /Basic Agent.*[0-4]\/5 remaining/ }),
    ).toBeVisible();
    await po.page.keyboard.press("Escape");

    // 3. Simulate 25 hours passing by calling the test-only IPC handler
    // This modifies the database timestamps directly within the Electron app's process
    await po.page.evaluate(async () => {
      await (window as any).electron.ipcRenderer.invoke(
        "test:simulateQuotaTimeElapsed",
        25,
      );
    });

    // 4. Wait for React Query cache to become stale (staleTime is 500ms in test mode)
    // then navigate to force a refetch with the updated timestamps
    await po.page.waitForTimeout(1000);
    await po.goToSettingsTab();
    await po.page.waitForTimeout(500);
    await po.goToChatTab();
    // Wait for the chat mode selector to be visible
    await expect(po.page.getByTestId("chat-mode-selector")).toBeVisible({
      timeout: Timeout.MEDIUM,
    });

    // 5. Verify quota has reset to 5/5 remaining
    await po.page.getByTestId("chat-mode-selector").click();
    await expect(
      po.page.getByRole("option", { name: /Basic Agent.*5\/5 remaining/ }),
    ).toBeVisible();
    await po.page.keyboard.press("Escape");

    // 6. Verify we can send messages again in Basic Agent mode (proves reset worked)
    await po.selectChatMode("basic-agent");
    await po.sendPrompt("tc=local-agent/simple-response post-reset message");
    await po.waitForChatCompletion();
    // Successfully sending a message in Basic Agent mode after reset proves the quota was reset
    // and is usable again. No need to verify the exact quota count as that would require
    // waiting for React Query cache to become stale again.
  },
);
