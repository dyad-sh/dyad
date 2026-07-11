// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from "vitest";
import { DyadErrorKind } from "@/errors/dyad_error";
import { unwrapIpcEnvelope } from "@/ipc/contracts/core";
import { configureTrustedRenderer } from "@/ipc/utils/renderer_security";
import {
  audioContracts,
  MAX_AUDIO_FILENAME_LENGTH,
  MAX_AUDIO_RECORDING_BYTES,
  MAX_AUDIO_REQUEST_ID_LENGTH,
} from "../types/audio";

const mocks = vi.hoisted(() => ({
  ipcHandlers: new Map<string, (event: unknown, input: unknown) => unknown>(),
  readSettings: vi.fn(),
  transcribeWithDyadEngine: vi.fn(),
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock("electron", () => ({
  ipcMain: {
    handle: vi.fn(
      (
        channel: string,
        handler: (event: unknown, input: unknown) => unknown,
      ) => {
        mocks.ipcHandlers.set(channel, handler);
      },
    ),
  },
}));

vi.mock("electron-log", () => ({
  default: { scope: () => mocks.logger },
}));

vi.mock("../../main/settings", () => ({
  readSettings: mocks.readSettings,
}));

vi.mock("../utils/llm_engine_provider", () => ({
  transcribeWithDyadEngine: mocks.transcribeWithDyadEngine,
}));

vi.mock("../utils/dyad_engine_url", () => ({
  getDyadEngineBaseUrl: () => "https://engine.example/v1",
}));

vi.mock("../utils/telemetry", () => ({
  sendTelemetryException: vi.fn(),
}));

vi.mock("../utils/test_utils", () => ({
  IS_TEST_BUILD: true,
}));

const { getRegisteredHandlerForTesting } = await import("./base");
const { registerProHandlers } = await import("./pro_handlers");

configureTrustedRenderer({
  devServerUrl: "http://localhost:5173",
  packagedRendererUrl: "file:///app/renderer/main_window/index.html",
});
registerProHandlers();

const transcribeAudio = getRegisteredHandlerForTesting(
  audioContracts.transcribeAudio.channel,
);

describe("pro audio transcription handler", () => {
  beforeEach(() => {
    mocks.readSettings.mockReset();
    mocks.readSettings.mockReturnValue({
      enableDyadPro: true,
      providerSettings: {
        auto: { apiKey: { value: "test-api-key" } },
      },
    });
    mocks.transcribeWithDyadEngine.mockReset();
    mocks.transcribeWithDyadEngine.mockResolvedValue("transcribed text");
  });

  it("transcribes a bounded typed array through a zero-copy Buffer view", async () => {
    const audioData = new Uint8Array([1, 2, 3, 4]);

    await expect(
      transcribeAudio({} as never, {
        audioData,
        filename: "recording.webm",
        requestId: "request-123",
      }),
    ).resolves.toEqual({ text: "transcribed text" });

    expect(mocks.transcribeWithDyadEngine).toHaveBeenCalledTimes(1);
    const audioBuffer = mocks.transcribeWithDyadEngine.mock.calls[0][0];
    expect(Buffer.isBuffer(audioBuffer)).toBe(true);
    expect([...audioBuffer]).toEqual([1, 2, 3, 4]);
    audioData[0] = 9;
    expect(audioBuffer[0]).toBe(9);
    expect(mocks.transcribeWithDyadEngine).toHaveBeenCalledWith(
      audioBuffer,
      "recording.webm",
      "request-123",
      expect.objectContaining({
        apiKey: "test-api-key",
        baseURL: "https://engine.example/v1",
      }),
    );
  });

  it.each([
    {
      name: "oversized audio",
      input: {
        audioData: new Uint8Array(MAX_AUDIO_RECORDING_BYTES + 1),
        filename: "recording.webm",
        requestId: "request-123",
      },
    },
    {
      name: "oversized filename",
      input: {
        audioData: new Uint8Array([1]),
        filename: "a".repeat(MAX_AUDIO_FILENAME_LENGTH + 1),
        requestId: "request-123",
      },
    },
    {
      name: "oversized request ID",
      input: {
        audioData: new Uint8Array([1]),
        filename: "recording.webm",
        requestId: "r".repeat(MAX_AUDIO_REQUEST_ID_LENGTH + 1),
      },
    },
    {
      name: "traversal filename",
      input: {
        audioData: new Uint8Array([1]),
        filename: "..",
        requestId: "request-123",
      },
    },
    {
      name: "whitespace-padded traversal filename",
      input: {
        audioData: new Uint8Array([1]),
        filename: " .. ",
        requestId: "request-123",
      },
    },
    {
      name: "header-unsafe request ID",
      input: {
        audioData: new Uint8Array([1]),
        filename: "recording.webm",
        requestId: "request\r\nX-Injected: true",
      },
    },
  ])("rejects $name before calling the engine", async ({ input }) => {
    await expect(transcribeAudio({} as never, input)).rejects.toMatchObject({
      kind: DyadErrorKind.Validation,
    });
    expect(mocks.transcribeWithDyadEngine).not.toHaveBeenCalled();
  });

  it("classifies a missing Pro subscription as an auth error", async () => {
    mocks.readSettings.mockReturnValue({
      enableDyadPro: false,
      providerSettings: {},
    });

    await expect(
      transcribeAudio({} as never, {
        audioData: new Uint8Array([1]),
        filename: "recording.webm",
        requestId: "request-123",
      }),
    ).rejects.toMatchObject({ kind: DyadErrorKind.Auth });
    expect(mocks.transcribeWithDyadEngine).not.toHaveBeenCalled();
  });

  it("rejects transcription IPC from an untrusted renderer", async () => {
    const ipcHandler = mocks.ipcHandlers.get(
      audioContracts.transcribeAudio.channel,
    );
    expect(ipcHandler).toBeDefined();
    const frame = { url: "https://attacker.example/" };
    const envelope = await ipcHandler!(
      { sender: { mainFrame: frame }, senderFrame: frame },
      {
        audioData: new Uint8Array([1]),
        filename: "recording.webm",
        requestId: "request-123",
      },
    );

    expect(() => unwrapIpcEnvelope(envelope as never)).toThrow(
      "trusted Dyad renderer",
    );
    expect(mocks.readSettings).not.toHaveBeenCalled();
    expect(mocks.transcribeWithDyadEngine).not.toHaveBeenCalled();
  });
});
