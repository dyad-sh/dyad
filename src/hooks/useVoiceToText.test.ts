import { renderHook, act, waitFor } from "@testing-library/react";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { useVoiceToText } from "@/hooks/useVoiceToText";
import {
  AUDIO_RECORDING_TIMESLICE_MS,
  MAX_AUDIO_RECORDING_BYTES,
  MAX_AUDIO_RECORDING_DURATION_MS,
} from "@/ipc/types/audio";

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

  public stopPromise: Promise<void> = Promise.resolve();

  public start = vi.fn((_timeslice?: number) => {
    this.state = "recording";
  });

  public stop = vi.fn(() => {
    this.state = "inactive";
    this.stopPromise = Promise.resolve(this.onstop?.());
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

  afterEach(() => {
    vi.useRealTimers();
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

    const request = transcribeAudioMock.mock.calls[0][0];
    expect(request.audioData).toBeInstanceOf(Uint8Array);
    expect(request.audioData.byteLength).toBe(10);
    expect(recorder.start).toHaveBeenCalledWith(AUDIO_RECORDING_TIMESLICE_MS);
    expect(onTranscription).toHaveBeenCalledWith("hello world");
    expect(trackStopMock).toHaveBeenCalledTimes(1);
  });

  it("automatically stops and transcribes when the duration limit is reached", async () => {
    vi.useFakeTimers();
    transcribeAudioMock.mockResolvedValue({ text: "from timer" });
    const onTranscription = vi.fn();
    const onError = vi.fn();

    const { result } = renderHook(() =>
      useVoiceToText({
        enabled: true,
        onTranscription,
        onError,
      }),
    );

    await act(async () => {
      await result.current.toggleRecording();
    });

    const recorder = mediaRecorderInstances[0];
    recorder.ondataavailable?.({
      data: new Blob(["timer audio"], { type: "audio/webm" }),
    });

    await act(async () => {
      vi.advanceTimersByTime(MAX_AUDIO_RECORDING_DURATION_MS);
      await recorder.stopPromise;
    });

    expect(recorder.stop).toHaveBeenCalledTimes(1);
    expect(onError).toHaveBeenCalledWith(
      expect.stringContaining("maximum duration"),
    );
    expect(transcribeAudioMock).toHaveBeenCalledTimes(1);
    expect(onTranscription).toHaveBeenCalledWith("from timer");
    expect(result.current.isRecording).toBe(false);
  });

  it("stops before retaining a chunk that would exceed the byte limit", async () => {
    transcribeAudioMock.mockResolvedValue({ text: "bounded audio" });
    const onTranscription = vi.fn();
    const onError = vi.fn();

    const { result } = renderHook(() =>
      useVoiceToText({
        enabled: true,
        onTranscription,
        onError,
      }),
    );

    await act(async () => {
      await result.current.toggleRecording();
    });

    const recorder = mediaRecorderInstances[0];
    recorder.ondataavailable?.({
      data: new Blob([new Uint8Array(MAX_AUDIO_RECORDING_BYTES - 1)], {
        type: "audio/webm",
      }),
    });
    recorder.ondataavailable?.({
      data: new Blob([new Uint8Array([1, 2])], { type: "audio/webm" }),
    });

    await act(async () => {
      await recorder.stopPromise;
    });

    expect(recorder.stop).toHaveBeenCalledTimes(1);
    expect(onError).toHaveBeenCalledWith(
      expect.stringContaining("maximum size"),
    );
    expect(transcribeAudioMock).toHaveBeenCalledTimes(1);
    expect(transcribeAudioMock.mock.calls[0][0].audioData).toHaveLength(
      MAX_AUDIO_RECORDING_BYTES - 1,
    );
    expect(onTranscription).toHaveBeenCalledWith("bounded audio");
  });

  it("ignores a transcription result that resolves after unmount", async () => {
    let resolveTranscription: ((value: { text: string }) => void) | undefined;
    transcribeAudioMock.mockReturnValue(
      new Promise((resolve) => {
        resolveTranscription = resolve;
      }),
    );
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

    unmount();
    await act(async () => {
      resolveTranscription?.({ text: "too late" });
      await recorder.stopPromise;
    });

    expect(onTranscription).not.toHaveBeenCalled();
  });
});
