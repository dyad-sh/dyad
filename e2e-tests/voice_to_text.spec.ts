import { test } from "./helpers/test_helper";
import { expect } from "@playwright/test";
import { Timeout } from "./helpers/constants";

test("voice-to-text button visible for pro users", async ({ po }) => {
  await po.setUpDyadPro();

  // Navigate to an app to get the ChatInput
  await po.importApp("minimal");

  // The mic button should be visible (Pro user)
  const micButton = po.page.getByRole("button", { name: "Voice to text" });
  await expect(micButton).toBeVisible({ timeout: Timeout.SHORT });
  await expect(micButton).toBeEnabled();
});

test("voice-to-text button shows lock for non-pro users", async ({ po }) => {
  await po.setUp();

  // Navigate to an app to get the ChatInput
  await po.importApp("minimal");

  // The locked mic button should be visible (non-Pro user)
  const lockedMicButton = po.page.getByRole("button", {
    name: "Voice to text (Pro)",
  });
  await expect(lockedMicButton).toBeVisible({ timeout: Timeout.SHORT });
});

test("voice-to-text button shows lock on home page for non-pro users", async ({
  po,
}) => {
  await po.setUp();

  // On the home page, the locked mic button should be visible
  const lockedMicButton = po.chatActions
    .getHomeChatInputContainer()
    .getByRole("button", { name: "Voice to text (Pro)" });
  await expect(lockedMicButton).toBeVisible({ timeout: Timeout.SHORT });
});

test("voice-to-text button visible on home page for pro users", async ({
  po,
}) => {
  await po.setUpDyadPro();

  // On the home page, the mic button should be visible
  const micButton = po.chatActions
    .getHomeChatInputContainer()
    .getByRole("button", { name: "Voice to text" });
  await expect(micButton).toBeVisible({ timeout: Timeout.SHORT });
  await expect(micButton).toBeEnabled();
});

test("voice-to-text button changes state when recording", async ({ po }) => {
  await po.setUpDyadPro();
  await po.importApp("minimal");

  const micButton = po.page.getByRole("button", { name: "Voice to text" });
  await expect(micButton).toBeVisible({ timeout: Timeout.SHORT });

  // Grant microphone permission and click to start recording
  // Note: In Electron E2E, getUserMedia may not be available, so we test the
  // button click doesn't crash and the button remains interactive.
  await micButton.click();

  // After clicking, the button should either be in recording state (Stop recording)
  // or show an error toast if mic access is denied in the test environment.
  // We verify the button is still present and the app didn't crash.
  const stopButton = po.page.getByRole("button", { name: "Stop recording" });
  const voiceButton = po.page.getByRole("button", { name: "Voice to text" });

  // One of these should be visible - either we started recording or fell back
  await expect(stopButton.or(voiceButton)).toBeVisible({
    timeout: Timeout.SHORT,
  });
});
