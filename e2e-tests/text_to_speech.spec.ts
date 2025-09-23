import { test } from "./helpers/test_helper";
import { expect } from "@playwright/test";

test("text to speech - basic functionality", async ({ po }) => {
  await po.setUp({ autoApprove: true });

  // Mock speechSynthesis API
  await po.page.addInitScript(() => {
    let isPlaying = false;

    class MockSpeechSynthesisUtterance {
      onstart: (() => void) | null = null;
      onend: (() => void) | null = null;
      constructor(public text: string) {}
    }

    interface MockSpeechSynthesis {
      speak: (utterance: MockSpeechSynthesisUtterance) => void;
      cancel: () => void;
      getVoices: () => Array<{ name: string; default: boolean }>;
      readonly speaking: boolean;
    }

    (
      globalThis as {
        SpeechSynthesisUtterance: typeof MockSpeechSynthesisUtterance;
      }
    ).SpeechSynthesisUtterance = MockSpeechSynthesisUtterance;

    (
      globalThis as unknown as { speechSynthesis: MockSpeechSynthesis }
    ).speechSynthesis = {
      speak: (utterance: MockSpeechSynthesisUtterance) => {
        isPlaying = true;
        setTimeout(() => utterance.onstart?.(), 10);
        setTimeout(() => utterance.onend?.(), 100);
      },
      cancel: () => {
        isPlaying = false;
      },
      getVoices: () => [{ name: "Test Voice", default: true }],
      get speaking() {
        return isPlaying;
      },
    };
  });

  await po.importApp("minimal");
  await po.sendPrompt("Say hello");

  const ttsButton = po.page.getByTestId("tts-button").first();
  await ttsButton.click();

  // Verify button changes to stop state
  await expect(ttsButton.locator('text="Stop"')).toBeVisible();
});
