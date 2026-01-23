import { expect } from "@playwright/test";
import { test, testSkipIfWindows, Timeout } from "./helpers/test_helper";

const E2E_TRANSCRIBED_TEXT = "E2E transcribed text";

/**
 * Mocks navigator.mediaDevices.getUserMedia to return a silent audio stream
 * (AudioContext + oscillator + MediaStreamDestination). Required for E2E
 * because CI has no microphone; the real MediaRecorder records this stream,
 * and the fake-llm-server returns mock transcription.
 */
async function mockGetUserMedia(page: {
  evaluate: (fn: () => void) => Promise<void>;
}) {
  await page.evaluate(() => {
    const AudioContextClass =
      (window as any).AudioContext || (window as any).webkitAudioContext;
    const ctx = new AudioContextClass();
    const dest = ctx.createMediaStreamDestination();
    const osc = ctx.createOscillator();
    osc.connect(dest);
    osc.start(0);
    (window as any).__voiceTestStream = dest.stream;
    const orig = navigator.mediaDevices.getUserMedia.bind(
      navigator.mediaDevices,
    );
    (navigator.mediaDevices as any).getUserMedia = function (constraints: any) {
      if (constraints?.audio) return Promise.resolve(dest.stream);
      return orig(constraints);
    };
  });
}

testSkipIfWindows(
  "voice transcription - home chat: record, transcribe, append to input",
  async ({ po }) => {
    await po.setUpDyadPro();

    await mockGetUserMedia(po.page);

    await expect(po.getHomeChatInputContainer()).toBeVisible({
      timeout: Timeout.MEDIUM,
    });

    const voiceBtn = po
      .getHomeChatInputContainer()
      .getByTestId("voice-input-button");
    await expect(voiceBtn).toBeVisible();
    await expect(voiceBtn).toHaveAttribute("title", "Start voice input");

    await voiceBtn.click();

    await expect(po.page.getByTestId("voice-waveform")).toBeVisible({
      timeout: Timeout.MEDIUM,
    });

    await expect(voiceBtn).toHaveAttribute("title", "Stop recording");
    await voiceBtn.click();

    await expect(voiceBtn).toHaveAttribute("title", "Start voice input", {
      timeout: Timeout.MEDIUM,
    });

    await expect(po.getChatInput()).toContainText(E2E_TRANSCRIBED_TEXT);
  },
);

test("voice input - non-Pro user sees Pro-only disabled state", async ({
  po,
}) => {
  await po.setUp();

  await expect(po.getHomeChatInputContainer()).toBeVisible({
    timeout: Timeout.MEDIUM,
  });

  const voiceBtn = po
    .getHomeChatInputContainer()
    .getByTestId("voice-input-button");
  await expect(voiceBtn).toBeVisible();
  await expect(voiceBtn).toHaveAttribute("title", "Pro feature only");
  await expect(voiceBtn).toBeDisabled();
});
