import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  settings: { jarvis: { chatReadAloudProvider: "system" } },
  synthesizeSpeech: vi.fn(),
  showError: vi.fn(),
  speak: vi.fn(),
  cancel: vi.fn(),
  audioPlay: vi.fn(),
  audioPause: vi.fn(),
  audioInstances: [] as Array<{ src: string }>,
}));

vi.mock("jotai", () => ({ useAtomValue: () => mocks.settings }));
vi.mock("@/atoms/appAtoms", () => ({ userSettingsAtom: {} }));
vi.mock("@/ipc/types/jarvis", () => ({
  jarvisClient: { synthesizeSpeech: mocks.synthesizeSpeech },
}));
vi.mock("@/lib/toast", () => ({ showError: mocks.showError }));

class SpeechUtteranceMock {
  onend: (() => void) | null = null;
  onerror: (() => void) | null = null;
  constructor(public text: string) {}
}

class AudioMock {
  onended: (() => void) | null = null;
  onerror: (() => void) | null = null;
  constructor(public src: string) {
    mocks.audioInstances.push(this);
  }
  play = mocks.audioPlay;
  pause = mocks.audioPause;
  load = vi.fn();
  removeAttribute = vi.fn();
}

vi.stubGlobal("SpeechSynthesisUtterance", SpeechUtteranceMock);
vi.stubGlobal("Audio", AudioMock);
Object.defineProperty(window, "speechSynthesis", {
  configurable: true,
  value: { speak: mocks.speak, cancel: mocks.cancel },
});

const { ChatAgentMessageActions } = await import("./ChatAgentMessageActions");

function renderActions() {
  return render(
    <ChatAgentMessageActions
      messageId="message-1"
      content="A generated AI response"
      isLastAssistant={false}
      isStreaming={false}
      feedback={null}
      onFeedback={vi.fn()}
    />,
  );
}

describe("ChatAgentMessageActions read aloud", () => {
  beforeEach(() => {
    mocks.settings.jarvis.chatReadAloudProvider = "system";
    mocks.synthesizeSpeech.mockReset();
    mocks.showError.mockReset();
    mocks.speak.mockReset();
    mocks.cancel.mockReset();
    mocks.audioPlay.mockReset().mockResolvedValue(undefined);
    mocks.audioPause.mockReset();
    mocks.audioInstances.length = 0;
  });

  it("keeps the system speech voice as the default provider", async () => {
    renderActions();
    await userEvent.click(screen.getByRole("button", { name: "Read aloud" }));

    expect(mocks.speak).toHaveBeenCalledTimes(1);
    expect(mocks.synthesizeSpeech).not.toHaveBeenCalled();
  });

  it("generates and plays ElevenLabs audio when configured", async () => {
    mocks.settings.jarvis.chatReadAloudProvider = "elevenlabs";
    mocks.synthesizeSpeech.mockResolvedValue({
      provider: "elevenlabs",
      mimeType: "audio/mpeg",
      audioBase64: "AQID",
    });
    renderActions();

    await userEvent.click(
      screen.getByRole("button", { name: "Read aloud with ElevenLabs" }),
    );

    await waitFor(() => {
      expect(mocks.synthesizeSpeech).toHaveBeenCalledWith({
        text: "A generated AI response",
      });
      expect(mocks.audioPlay).toHaveBeenCalledTimes(1);
    });
    expect(mocks.audioInstances[0]?.src).toBe("data:audio/mpeg;base64,AQID");
    expect(
      screen.getByRole("button", { name: "Stop reading aloud" }),
    ).toBeTruthy();
  });
});
