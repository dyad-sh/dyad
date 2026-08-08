import { renderHook, act, waitFor } from "@testing-library/react";
import { describe, it, expect, beforeEach, vi } from "vitest";
import { useVoiceToText } from "@/hooks/useVoiceToText";

const { transcribeAudioMock } = vi.hoisted(() => ({
  transcribeAudioMock: vi.fn(),
}));

vi.mock("@/ipc/types", () => ({
  ipc: {
    audio: {
      transcribeAudio: transcribeAudioMock,
    },
  },
}));

class MockMediaRecorder {
  public state: "inactive" | "recording" | "paused" = "inactive";
  public ondataavailable: ((event: { data: Blob }) => void) | null = null;
  public onstop: (() => void | Promise<void>) | null = null;

  public start = vi.fn(() => {
    this.state = "recording";
  });

  public stop = vi.fn(() => {
    this.state = "inactive";
    void this.onstop?.();
  });
}

describe("useVoiceToText", () => {
  let trackStopMock: ReturnType<typeof vi.fn>;
  let mediaRecorderInstances: MockMediaRecorder[];

  beforeEach(() => {
    transcribeAudioMock.mockReset();
    mediaRecorderInstances = [];
    trackStopMock = vi.fn();

    const stream = {
      getTracks: () => [{ stop: trackStopMock }],
    } as unknown as MediaStream;

    Object.defineProperty(globalThis.navigator, "mediaDevices", {
      value: {
        getUserMedia: vi.fn().mockResolvedValue(stream),
      },
      configurable: true,
    });

    const MediaRecorderConstructor = vi.fn(() => {
      const instance = new MockMediaRecorder();
      mediaRecorderInstances.push(instance);
      return instance;
    });

    Object.defineProperty(globalThis, "MediaRecorder", {
      value: MediaRecorderConstructor,
      configurable: true,
      writable: true,
    });
  });

  it("stops the active microphone stream when unmounted mid-recording", async () => {
    const onTranscription = vi.fn();

    const { result, unmount } = renderHook(() =>
      useVoiceToText({
        enabled: true,
        onTranscription,
      }),
    );

    await act(async () => {
      await result.current.toggleRecording();
    });

    expect(result.current.isRecording).toBe(true);

    unmount();

    expect(mediaRecorderInstances).toHaveLength(1);
    expect(mediaRecorderInstances[0].stop).toHaveBeenCalledTimes(1);
    expect(trackStopMock).toHaveBeenCalledTimes(1);
    expect(transcribeAudioMock).not.toHaveBeenCalled();
    expect(onTranscription).not.toHaveBeenCalled();
  });

  it("still transcribes when recording is stopped by the user", async () => {
    transcribeAudioMock.mockResolvedValue({ text: "  hello world  " });
    const onTranscription = vi.fn();

    const { result } = renderHook(() =>
      useVoiceToText({
        enabled: true,
        onTranscription,
      }),
    );

    await act(async () => {
      await result.current.toggleRecording();
    });

    const recorder = mediaRecorderInstances[0];
    recorder.ondataavailable?.({
      data: new Blob(["test audio"], { type: "audio/webm" }),
    });

    await act(async () => {
      await result.current.toggleRecording();
    });

    await waitFor(() => {
      expect(transcribeAudioMock).toHaveBeenCalledTimes(1);
    });

    expect(onTranscription).toHaveBeenCalledWith("hello world");
    expect(trackStopMock).toHaveBeenCalledTimes(1);
  });
});
