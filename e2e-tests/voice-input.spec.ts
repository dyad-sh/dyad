import { expect } from "@playwright/test";
import { test, Timeout } from "./helpers/test_helper";

test("voice toggle injects text into chat input (mocked)", async ({
  electronApp,
}) => {
  const page = await electronApp.firstWindow();

  await page.evaluate(() => {
    (window as any).__DYAD_TEST_VOICE__ = true;
  });

  const voiceToggle = page.getByTestId("voice-toggle");
  await voiceToggle.waitFor({ timeout: Timeout.MEDIUM });

  await voiceToggle.click();

  await page.evaluate(() => {
    window.dispatchEvent(
      new CustomEvent("dyad-test-voice", {
        detail: { text: "hello voice world", final: true },
      }),
    );
  });

  const input = page.getByTestId("lexical-chat-input");
  await expect(input).toHaveText(/hello voice world/i, {
    timeout: Timeout.MEDIUM,
  });
});
