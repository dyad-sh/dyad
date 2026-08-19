import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

const toggleRecording = vi.hoisted(() => vi.fn());
const cancelRecording = vi.hoisted(() => vi.fn());

vi.mock("@/hooks/useChatVoiceInput", () => ({
  useChatVoiceInput: () => ({
    isRecording: true,
    isTranscribing: false,
    isAvailable: true,
    levels: Array.from({ length: 20 }, (_, index) => (index + 1) / 20),
    toggleRecording,
    cancelRecording,
  }),
}));

import { VoiceInputButton } from "./VoiceInputButton";

describe("VoiceInputButton recording state", () => {
  it("shows an announced recording state and a live 20-bar waveform", () => {
    render(<VoiceInputButton onTranscript={vi.fn()} />);

    expect(screen.getByRole("status").textContent).toContain("Recording");
    expect(screen.getByTestId("voice-input-waveform").children).toHaveLength(
      20,
    );
  });

  it("lets the user stop or discard the recording", async () => {
    render(<VoiceInputButton onTranscript={vi.fn()} />);

    await userEvent.click(
      screen.getByRole("button", { name: "Stop recording and send" }),
    );
    await userEvent.click(
      screen.getByRole("button", { name: "Discard recording" }),
    );

    expect(toggleRecording).toHaveBeenCalledOnce();
    expect(cancelRecording).toHaveBeenCalledOnce();
  });
});
